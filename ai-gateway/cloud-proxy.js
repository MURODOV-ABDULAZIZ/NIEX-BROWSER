// ============================================================
// CLOUD AI PROXY — kalitsiz cloud tahlil
//
// MAQSAD: AI provayder kalitlari (Groq / Gemini / OpenRouter) ILOVADA
// SAQLANMAYDI. Ular Supabase secrets'da (GROQ_API_KEYS, GEMINI_API_KEYS,
// OPENROUTER_API_KEYS) turadi va faqat server tomonida ishlatiladi.
// Brauzer bu yerdan o'zining `browser_access` tokeni bilan murojaat qiladi.
//
// NEGA SHUNDAY: Electron paketi (`app.asar`) shifrlangan emas — bir buyruq
// bilan ochiladi. Ilovaga joylangan har qanday kalitni foydalanuvchi topib
// oladi (network trafikda ham ko'rinadi). Yagona ishonchli yechim — kalitni
// serverda ushlash. ChatGPT desktop ilovasi ham aynan shu tamoyilda ishlaydi.
//
// XAVFSIZ MIGRATSIYA: proxy hali deploy qilinmagan bo'lsa (404 / tarmoq
// xatosi), `isAvailable()` false qaytaradi va gateway hozirgi mahalliy
// yo'l bilan davom etadi. Ya'ni bu fayl qo'shilishi hech narsani buzmaydi.
// ============================================================
'use strict';

// AYNAN mahalliy yo'ldagi promptlar va verdikt tahlili ishlatiladi —
// proxy orqali ham, kalitlar bilan ham bir xil qaror chiqishi shart.
const { parseVerdict, MODERATION_PROMPT, TEXT_MODERATION_PROMPT } = require('./providers');

let _log = () => {};
let _authCtx = null;          // () => { ready, base, apikey, accessToken, refresh }

// Proxy mavjudligi holati: null = hali sinalmagan, true/false = aniqlangan
let _available = null;
let _lastProbeAt = 0;
const REPROBE_MS = 5 * 60 * 1000;   // 5 daqiqada bir qayta sinash

const TIMEOUT_MS = 20000;

function init({ logger, authContextProvider } = {}) {
  _log = logger || (() => {});
  _authCtx = authContextProvider || null;
}

function ctx() {
  try { return _authCtx ? _authCtx() : null; } catch { return null; }
}

/** Proxy ishlatishga tayyormi (token bor va endpoint mavjud). */
function isReady() {
  const c = ctx();
  return !!(c && c.ready && c.accessToken && c.base);
}

async function call(pathname, body, token) {
  const c = ctx();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(c.base + pathname, {
      method: 'POST',
      headers: {
        apikey: c.apikey,
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const txt = await res.text();
    let json; try { json = JSON.parse(txt); } catch { json = { _raw: txt.slice(0, 200) }; }
    return { status: res.status, body: json };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Cloud proxy orqali tahlil.
 *
 * @returns {Promise<null|{should_block:boolean, block_reason:string, provider:string, exhaustedAll?:boolean}>}
 *          `null` — proxy ishlatilmadi (mavjud emas / token yo'q / limit).
 *          Bu holda gateway mahalliy yo'lga qaytadi.
 */
async function analyze(payload) {
  if (!isReady()) return null;

  // Avval aniqlangan "mavjud emas" holatini vaqti-vaqti bilan qayta sinaymiz —
  // sayt deploy qilinganda ilova o'zi ulanib ketadi, qayta o'rnatish shart emas.
  if (_available === false && Date.now() - _lastProbeAt < REPROBE_MS) return null;

  const c = ctx();
  const isImage = !!payload.image_base64;
  const pathname = isImage ? '/api/v1/ai/image' : '/api/v1/ai/text';

  // Proxy — xom AI passthrough: promptni BIZ yuboramiz, javobni BIZ tahlil
  // qilamiz. Shu sabab moderatsiya prompti mahalliy yo'ldagi bilan bir xil.
  const body = isImage
    ? {
        imageBase64: String(payload.image_base64).replace(/^data:[\w/]+;base64,/, ''),
        prompt: MODERATION_PROMPT,
      }
    : { prompt: `${TEXT_MODERATION_PROMPT}\n\n${String(payload.text || '').slice(0, 4000)}` };

  let token = c.accessToken;
  try {
    let r = await call(pathname, body, token);

    // Token eskirgan / yaroqsiz — bir marta yangilab qayta urinamiz
    if (r.status === 401 || r.status === 403) {
      const fresh = c.refresh ? await c.refresh() : null;
      if (!fresh) {
        // Token yangilanmadi. Backoff qo'yamiz — aks holda sahifadagi HAR bir
        // rasm uchun muvaffaqiyatsiz tarmoq so'rovi ketadi.
        _lastProbeAt = Date.now();
        _available = false;
        _log('⚠️', 'AI proxy', 'token yangilanmadi — mahalliy yo\'l');
        return null;
      }
      token = fresh;
      r = await call(pathname, body, token);
    }

    _lastProbeAt = Date.now();

    // Endpoint yo'q — proxy hali deploy qilinmagan
    if (r.status === 404) {
      if (_available !== false) _log('ℹ️', 'AI proxy', 'hali deploy qilinmagan — mahalliy yo\'l ishlatiladi');
      _available = false;
      return null;
    }

    // Kvota tugagan — bu HAQIQIY javob, mahalliy yo'lga qaytmaymiz
    // (aks holda foydalanuvchi limitni chetlab o'tardi).
    if (r.status === 429) {
      _available = true;
      const reason = (r.body && r.body.reason) || 'limit';
      _log('⏳', 'AI proxy', `kvota tugagan (${reason})`);
      return { should_block: false, block_reason: '', provider: 'proxy-quota', exhaustedAll: true };
    }

    if (r.status >= 500 || !r.body || r.body.ok === false) {
      _log('⚠️', 'AI proxy', `xato ${r.status} — mahalliy yo'lga qaytamiz`);
      return null;
    }

    _available = true;

    // `result` — model qaytargan XOM matn. Mahalliy yo'ldagi AYNAN shu
    // parseVerdict bilan verdiktga aylantiramiz (JSON topilmasa — bloklamaydi,
    // ya'ni false positive'dan himoyalangan).
    const raw = typeof r.body.result === 'string'
      ? r.body.result
      : JSON.stringify(r.body.result ?? r.body.data ?? '');
    const v = parseVerdict(raw);
    return {
      should_block: v.should_block,
      block_reason: v.block_reason,
      provider: 'proxy:' + String(r.body.provider || 'cloud'),
    };
  } catch (e) {
    _lastProbeAt = Date.now();
    _available = false;
    _log('⚠️', 'AI proxy', `ulanmadi (${e.message}) — mahalliy yo'l`);
    return null;
  }
}

function getStatus() {
  return {
    ready: isReady(),
    available: _available,
    lastProbeAt: _lastProbeAt || null,
  };
}

module.exports = { init, analyze, isReady, getStatus };
