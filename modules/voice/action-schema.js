/**
 * NIEX Voice Agent — Action Schema (Prompt 3/4).
 * ==============================================
 *
 * MVP uchun DETERMINISTIK, minimal action to'plami. Har action faqat kerakli
 * parametrga ega. LLM (Qwen) FAQAT shu allowlist'dan action so'ray oladi —
 * ixtiyoriy kod/JS EMAS (xavfsizlik).
 *
 * Sof modul (Node + brauzer). Desktop va mobil BIR XIL schema ishlatadi.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.NIEXVoiceSchema = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  // Ruxsat etilgan action turlari (allowlist). Boshqasi — RAD.
  const ACTIONS = Object.freeze({
    open_site:      { params: { url: 'url' }, required: ['url'] },
    search:         { params: { query: 'text', engine: 'text?' }, required: ['query'] },
    play:           { params: {}, required: [] },
    pause:          { params: {}, required: [] },
    next_video:     { params: {}, required: [] },
    previous_video: { params: {}, required: [] },
    scroll:         { params: { direction: 'enum', amount: 'int?' }, required: ['direction'] },
    new_tab:        { params: { url: 'url?' }, required: [] },
    close_tab:      { params: {}, required: [] },
    go_back:        { params: {}, required: [] },
    go_forward:     { params: {}, required: [] },
    reload:         { params: {}, required: [] },
    // MVP kengaytmasi — aktiv input'ga xavfsiz matn yozish (search/textarea/text).
    //   submit:true → yozgandan keyin Enter (qidiruvni ishga tushiradi).
    type_text:      { params: { query: 'text', target: 'text?', submit: 'bool?' }, required: ['query'] },
    // MVP kengaytmasi — juda ehtiyotkor click. Faqat aniq matching, ko'p mos → clarify.
    click:          { params: { target: 'text' }, required: ['target'] },
    // Natija/videoni ochish — "birinchi videoni qoy" (YouTube/qidiruv 1-natija).
    open_result:    { params: { index: 'int?' }, required: [] },
    // Ovoz balandligi — "louder 5" (delta +50) / "lower 3" (delta -30) / absolute level.
    //   delta: 0..100 oralig'ida qo'shiladi/ayiriladi; level: to'g'ridan-to'g'ri 0..100.
    set_volume:     { params: { delta: 'int?', level: 'int?' }, required: [] },
  });

  const SCROLL_DIRECTIONS = Object.freeze(['up', 'down', 'left', 'right']);

  const STATUS = Object.freeze({
    OK: 'ok',
    NEEDS_CLARIFICATION: 'needs_clarification',
    UNSUPPORTED: 'unsupported',
    BLOCKED: 'blocked',
    ERROR: 'error',
  });

  const LIMITS = Object.freeze({
    MAX_ACTIONS: 8,
    MAX_QUERY: 200,
    MAX_URL: 2000,
    MAX_SCROLL: 5000,
    SCROLL_DEFAULT: 600,
  });

  // Ma'lum saytlar — "youtube ni och" kabi buyruqlar uchun (local + LLM).
  const KNOWN_SITES = Object.freeze({
    youtube: 'https://www.youtube.com',
    google: 'https://www.google.com',
    gmail: 'https://mail.google.com',
    instagram: 'https://www.instagram.com',
    telegram: 'https://web.telegram.org',
    wikipedia: 'https://www.wikipedia.org',
    github: 'https://github.com',
    facebook: 'https://www.facebook.com',
    twitter: 'https://x.com',
    x: 'https://x.com',
    reddit: 'https://www.reddit.com',
    chatgpt: 'https://chatgpt.com',
    maps: 'https://maps.google.com',
    'google maps': 'https://maps.google.com',
    yandex: 'https://yandex.uz',
    olx: 'https://www.olx.uz',
    kun: 'https://kun.uz',
  });

  // Qidiruv URL'lari (search action → site-aware).
  function searchUrl(query, engine) {
    const q = encodeURIComponent(String(query || '').slice(0, LIMITS.MAX_QUERY));
    switch (String(engine || '').toLowerCase()) {
      case 'youtube': return `https://www.youtube.com/results?search_query=${q}`;
      case 'google': return `https://www.google.com/search?q=${q}`;
      case 'wikipedia': return `https://www.wikipedia.org/search-redirect.php?search=${q}`;
      case 'yandex': return `https://yandex.uz/search/?text=${q}`;
      default: return `https://duckduckgo.com/?q=${q}`; // NIEX default (main.js navigate bilan bir xil)
    }
  }

  return { ACTIONS, SCROLL_DIRECTIONS, STATUS, LIMITS, KNOWN_SITES, searchUrl };
}));
