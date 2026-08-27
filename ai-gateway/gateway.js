// ============================================================
// AI GATEWAY — YAGONA KIRISH NUQTASI
// Browser FAQAT shu Gateway bilan gaplashadi (bitta unified API).
// Ichkarida barcha provayderlarni Provider Manager boshqaradi.
//
// PIPELINE (TASK talabi):
//   1. Local AI BIRINCHI qaror qiladi (renderer'da — NSFW model, KB, qoidalar).
//      Local AI YUQORI ishonch bilan bloklasa → bu Gateway CHAQIRILMAYDI.
//   2. Faqat local AI ISHONCHSIZ bo'lganda → Gateway chaqiriladi (cloud).
//   3. Bloklangan kontent QAYTA tahlil qilinmaydi (dedup kesh — limit tejash).
//
// LOGGING: har so'rov (provider, vaqt, natija) qayd qilinadi.
// ============================================================
'use strict';

const crypto = require('crypto');
const { ProviderManager } = require('./provider-manager');
const cloudProxy = require('./cloud-proxy');

let _manager = null;
let _log = () => {};

// Dedup + natija keshi — bir xil kontent qayta so'ralmaydi (limit tejash)
const _cache = new Map();          // hash → { verdict, t }
const CACHE_TTL_MS = 30 * 60 * 1000;
const CACHE_MAX = 2000;

// So'rovlar jurnali (dashboard uchun oxirgi N ta)
const _logs = [];
const LOG_MAX = 200;

function hashPayload(payload) {
  const basis = payload.image_base64
    ? 'img:' + payload.image_base64.slice(0, 200)
    : 'txt:' + String(payload.text || '').slice(0, 200);
  return crypto.createHash('sha1').update(basis).digest('hex');
}

function cacheGet(h) {
  const it = _cache.get(h);
  if (!it) return null;
  if (Date.now() - it.t > CACHE_TTL_MS) { _cache.delete(h); return null; }
  return it.verdict;
}

function cacheSet(h, verdict) {
  _cache.set(h, { verdict, t: Date.now() });
  if (_cache.size > CACHE_MAX) {
    const firstKey = _cache.keys().next().value;
    if (firstKey) _cache.delete(firstKey);
  }
}

function recordLog(entry) {
  _logs.push({ ...entry, t: Date.now() });
  if (_logs.length > LOG_MAX) _logs.shift();
}

function init(logger, options = {}) {
  _log = logger || (() => {});
  _manager = new ProviderManager(_log);
  // Cloud proxy — kalitlar serverda. `authContextProvider` browser-cloud'dan
  // keladi (BASE + apikey + browser tokeni; AI kaliti EMAS).
  cloudProxy.init({ logger: _log, authContextProvider: options.authContextProvider });
  return _manager;
}

function ensure() {
  if (!_manager) init(_log);
  return _manager;
}

/**
 * Yagona tahlil funksiyasi.
 * @param {{ type?: 'image'|'video'|'text', image_base64?: string, text?: string }} req
 * @returns {Promise<{ should_block, block_reason, provider, cached, exhaustedAll }>}
 */
async function analyze(req) {
  const mgr = ensure();
  const payload = { image_base64: req.image_base64, text: req.text };

  if (!payload.image_base64 && !payload.text) {
    return { should_block: false, block_reason: '', provider: 'none', cached: false };
  }

  // 1. Dedup kesh — bloklangan yoki tekshirilgan kontent qayta so'ralmaydi
  const h = hashPayload(payload);
  const cached = cacheGet(h);
  if (cached) {
    return { ...cached, cached: true };
  }

  const t0 = Date.now();

  // 2. CLOUD PROXY — kalitlar serverda (Supabase secrets).
  //    Proxy deploy qilinmagan yoki xato bo'lsa `null` qaytaradi va
  //    quyidagi mahalliy yo'l ishlaydi. Ya'ni uzilish bo'lmaydi.
  let r = await cloudProxy.analyze(payload);
  let viaProxy = !!r;

  // 3. Mahalliy Provider Manager (o'tish davri: .env kalitlari bilan).
  //    Proxy barqaror ishlagach bu tarmoq va .env kalitlari olib tashlanadi.
  if (!r) r = await mgr.analyze(payload);
  const ms = Date.now() - t0;
  void viaProxy;

  const verdict = {
    should_block: !!r.should_block,
    block_reason: r.block_reason || '',
    provider: r.provider,
    exhaustedAll: !!r.exhaustedAll,
  };

  // Natijani keshlaymiz (exhausted bo'lmasa — aks holda qayta sinash mumkin)
  if (!r.exhaustedAll) cacheSet(h, verdict);

  recordLog({
    type: req.type || (payload.image_base64 ? 'image' : 'text'),
    provider: r.provider,
    response_ms: ms,
    should_block: verdict.should_block,
    reason: verdict.block_reason,
  });

  _log(verdict.should_block ? '⛔' : '✅', `Gateway[${r.provider}]`, `${ms}ms ${verdict.block_reason || 'safe'}`);
  return { ...verdict, cached: false };
}

// Dashboard/admin panel uchun
function getStats() {
  return {
    ...ensure().getStats(),
    cache_size: _cache.size,
    recent_logs: _logs.slice(-50).reverse(),
  };
}

// Voice STT uchun — provayder kalitini oladi (non-mutating). Kalit MAIN'da qoladi,
// renderer'ga BERILMAYDI. Groq Whisper transkripsiyasi shu kalit bilan ishlaydi.
function getKey(provider) {
  try {
    const m = ensure();
    const slots = (m.slots && m.slots[provider]) || [];
    for (const s of slots) if (!s.exhausted && s.key) return s.key;
    return slots[0] && slots[0].key ? slots[0].key : null;
  } catch { return null; }
}

module.exports = { init, analyze, getStats, getKey };
