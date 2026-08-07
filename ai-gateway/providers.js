// ============================================================
// AI GATEWAY — PROVIDER CALLERS
// Har bir provayder bitta kalit bilan bitta so'rovni bajaradi.
//
// Barcha caller BIR XIL interfeys qaytaradi:
//   { should_block: bool, block_reason: string, raw: string }
// yoki xato:  throws { status, message }  (status=429 → quota tugagan)
//
// TASK talabiga muvofiq: browser HECH QACHON to'g'ridan-to'g'ri chaqirmaydi.
//   Bu modul FAQAT main process (backend) ichida ishlaydi.
//
// Vision (rasm/kadr) va Text tahlili qo'llab-quvvatlanadi.
//   Video → renderer kadr (frame) oladi → shu yerda RASM sifatida tahlil qilinadi.
// ============================================================
'use strict';

const fetch = require('node-fetch');

const TIMEOUT_MS = 20000;

// NSFW moderatsiya prompti — barcha provayderlar uchun bir xil.
// Faqat TASDIQLANGAN zararli kontent bloklanadi (selective blocking qoidasi).
const MODERATION_PROMPT =
  'You are a strict content-safety classifier for a child-safe browser. ' +
  'Look at this image and decide if it contains pornography, explicit sexual content, ' +
  'nudity, or strongly sexually-suggestive content (e.g. lingerie/bikini posing meant to arouse). ' +
  'Normal photos (people fully dressed, sports, news, food, nature, memes, products) are SAFE. ' +
  'Respond ONLY with compact JSON: {"harmful":true|false,"reason":"short reason"}. No other text.';

const TEXT_MODERATION_PROMPT =
  'You are a strict content-safety classifier for a child-safe browser. ' +
  'Decide if the following text is pornographic, sexually explicit, or solicits sexual content. ' +
  'Normal text is SAFE. Respond ONLY with compact JSON: {"harmful":true|false,"reason":"short reason"}.';

function stripDataPrefix(b64) {
  return String(b64 || '').replace(/^data:[\w/]+;base64,/, '');
}

// Model javobidan JSON verdict'ni ajratib olish (matn ichida bo'lsa ham)
function parseVerdict(text) {
  const raw = String(text || '');
  try {
    const m = raw.match(/\{[\s\S]*?"harmful"[\s\S]*?\}/);
    if (m) {
      const j = JSON.parse(m[0]);
      return {
        should_block: !!j.harmful,
        block_reason: String(j.reason || '').slice(0, 120),
        raw,
      };
    }
  } catch { /* pastdagi fallback */ }
  // JSON topilmasa — konservativ: bloklamaymiz (false positive oldini olish)
  const lower = raw.toLowerCase();
  const harmful = /"harmful"\s*:\s*true/.test(lower) || /\bharmful\b/.test(lower) && !/not harmful|harmful.*false/.test(lower);
  return { should_block: harmful, block_reason: harmful ? 'flagged' : '', raw };
}

async function postJSON(url, headers, body) {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const txt = await res.text();
    if (!res.ok) {
      const err = new Error(`HTTP ${res.status}: ${txt.slice(0, 200)}`);
      err.status = res.status;
      throw err;
    }
    try { return JSON.parse(txt); } catch { return { _raw: txt }; }
  } finally {
    clearTimeout(t);
  }
}

// ── GEMINI (Google AI Studio) — rasm + video kadr + matn ──
async function geminiAnalyze(key, { image_base64, text }) {
  const model = 'gemini-2.0-flash';
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(key)}`;
  const parts = [];
  if (image_base64) {
    parts.push({ text: MODERATION_PROMPT });
    parts.push({ inline_data: { mime_type: 'image/jpeg', data: stripDataPrefix(image_base64) } });
  } else {
    parts.push({ text: `${TEXT_MODERATION_PROMPT}\n\nTEXT:\n${String(text || '').slice(0, 4000)}` });
  }
  const j = await postJSON(url, {}, {
    contents: [{ parts }],
    generationConfig: { temperature: 0, maxOutputTokens: 80 },
  });
  const out = j?.candidates?.[0]?.content?.parts?.map(p => p.text).join('') || '';
  return parseVerdict(out);
}

// ── GROQ (llama vision) — rasm + matn ──
async function groqAnalyze(key, { image_base64, text }) {
  const url = 'https://api.groq.com/openai/v1/chat/completions';
  let messages, model;
  if (image_base64) {
    model = 'meta-llama/llama-4-scout-17b-16e-instruct'; // vision
    const dataUrl = image_base64.startsWith('data:')
      ? image_base64
      : `data:image/jpeg;base64,${stripDataPrefix(image_base64)}`;
    messages = [{
      role: 'user',
      content: [
        { type: 'text', text: MODERATION_PROMPT },
        { type: 'image_url', image_url: { url: dataUrl } },
      ],
    }];
  } else {
    model = 'llama-3.1-8b-instant';
    messages = [{ role: 'user', content: `${TEXT_MODERATION_PROMPT}\n\nTEXT:\n${String(text || '').slice(0, 4000)}` }];
  }
  const j = await postJSON(url, { Authorization: `Bearer ${key}` }, {
    model, messages, temperature: 0, max_tokens: 80,
  });
  return parseVerdict(j?.choices?.[0]?.message?.content || '');
}

// ── OPENROUTER (vision proxy) — rasm + matn ──
async function openrouterAnalyze(key, { image_base64, text }) {
  const url = 'https://openrouter.ai/api/v1/chat/completions';
  let messages, model;
  if (image_base64) {
    model = 'google/gemma-4-31b-it:free'; // bepul vision-instruct (OpenRouter)
    const dataUrl = image_base64.startsWith('data:')
      ? image_base64
      : `data:image/jpeg;base64,${stripDataPrefix(image_base64)}`;
    messages = [{
      role: 'user',
      content: [
        { type: 'text', text: MODERATION_PROMPT },
        { type: 'image_url', image_url: { url: dataUrl } },
      ],
    }];
  } else {
    model = 'google/gemma-4-31b-it:free';
    messages = [{ role: 'user', content: `${TEXT_MODERATION_PROMPT}\n\nTEXT:\n${String(text || '').slice(0, 4000)}` }];
  }
  const j = await postJSON(url, {
    Authorization: `Bearer ${key}`,
    'HTTP-Referer': 'https://narimon.local',
    'X-Title': 'Narimon SafeNet',
  }, { model, messages, temperature: 0, max_tokens: 80 });
  return parseVerdict(j?.choices?.[0]?.message?.content || '');
}

// Provayder ta'riflari — priority tartibida.
// Groq eng ishonchli/tez (free tier saxiy) → 1-o'rin.
// Gemini video-frame + rasm uchun kuchli → 2-o'rin.
// OpenRouter zaxira → 3-o'rin.
// vision:true = rasm/kadr tahlil qila oladi.
const PROVIDERS = [
  { name: 'groq',       priority: 1, vision: true, call: groqAnalyze },
  { name: 'gemini',     priority: 2, vision: true, call: geminiAnalyze },
  { name: 'openrouter', priority: 3, vision: true, call: openrouterAnalyze },
];

// MODERATION_PROMPT / TEXT_MODERATION_PROMPT ham eksport qilinadi — cloud-proxy
// AYNAN shu promptlarni ishlatishi shart, aks holda proxy va mahalliy yo'l
// turlicha qaror qabul qilib, bloklash xatti-harakati o'zgarib ketardi.
module.exports = { PROVIDERS, parseVerdict, MODERATION_PROMPT, TEXT_MODERATION_PROMPT };
