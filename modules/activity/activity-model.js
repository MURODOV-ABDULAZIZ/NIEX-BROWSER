/**
 * NIEX — Activity Intelligence: Domain Model (yagona, platformadan mustaqil).
 * =========================================================================
 *
 * Spec "PARENTAL CONTROL / ACTIVITY INTELLIGENCE" §3 — Desktop va Mobile
 * BIR XIL modeldan foydalanadi. Bu fayl sof: DOM/Electron/Flutter'ga bog'liq
 * EMAS. Faqat kanonik turlar + domen normalizatsiyasi + shakllar.
 *
 * ASOSIY QOIDA (§3): SCROLLING ≠ VIDEO_WATCHING ≠ CHAT ≠ READING ≠ page time.
 *
 * Node'da `require`, brauzerda global `NIEXActivityModel` sifatida ishlaydi.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.NIEXActivityModel = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  // ── Activity turlari (§3) ─────────────────────────────────────────
  const ACTIVITY_TYPE = Object.freeze({
    SCROLLING: 'scrolling',
    VIDEO_WATCHING: 'video_watching',
    SEARCHING: 'searching',
    READING: 'reading',
    CHAT: 'chat',
    NAVIGATION: 'navigation',
    FOCUS_WORK: 'focus_work',
    IDLE: 'idle',
    BLOCKED_CONTENT: 'blocked_content',
    UNKNOWN: 'unknown',
  });

  // scroll-activity-core.js `activityType` (snapshot) → kanonik ACTIVITY_TYPE.
  const CORE_ACTIVITY_MAP = Object.freeze({
    scrolling: ACTIVITY_TYPE.SCROLLING,
    video_watching: ACTIVITY_TYPE.VIDEO_WATCHING,
    searching: ACTIVITY_TYPE.SEARCHING,
    reading: ACTIVITY_TYPE.READING,
    chat: ACTIVITY_TYPE.CHAT,
    idle: ACTIVITY_TYPE.IDLE,
  });

  // ── Content kategoriyalari (§5) ───────────────────────────────────
  const CONTENT_CATEGORY = Object.freeze({
    EDUCATION: 'education',
    PROGRAMMING: 'programming',
    TECHNOLOGY: 'technology',
    SCIENCE: 'science',
    RESEARCH: 'research',
    NEWS: 'news',
    PRODUCTIVITY: 'productivity',
    ENTERTAINMENT: 'entertainment',
    GAMING: 'gaming',
    SHORTFORM_VIDEO: 'shortform_video',
    PODCAST: 'podcast',
    SOCIAL_MEDIA: 'social_media',
    COMMUNICATION: 'communication',
    SPORTS: 'sports',
    SHOPPING: 'shopping',
    OTHER: 'other',
  });

  // ── Qiymat darajasi (§6) — UNKNOWN majburiy (§23: noaniqni RED qilma) ─
  const VALUE_LEVEL = Object.freeze({
    HIGH: 'high_value',
    MEDIUM: 'medium_value',
    LOW: 'low_value',
    UNKNOWN: 'unknown',
  });

  // ── Domen → platforma kaliti (§12: youtube.com/m.youtube.com/www → youtube) ─
  // Faqat mashhur platformalar aniq nomlanadi; qolganlari domenning o'zi.
  const PLATFORM_ALIASES = Object.freeze({
    'youtube.com': 'youtube', 'youtu.be': 'youtube', 'm.youtube.com': 'youtube',
    'instagram.com': 'instagram',
    'tiktok.com': 'tiktok',
    'facebook.com': 'facebook', 'fb.com': 'facebook',
    'twitter.com': 'x', 'x.com': 'x',
    'reddit.com': 'reddit',
    'pinterest.com': 'pinterest',
    'telegram.org': 'telegram', 'web.telegram.org': 'telegram', 't.me': 'telegram',
    'google.com': 'google', 'google.co.uk': 'google',
    'wikipedia.org': 'wikipedia',
    'github.com': 'github',
    'stackoverflow.com': 'stackoverflow',
    'chat.openai.com': 'chatgpt', 'chatgpt.com': 'chatgpt',
    'linkedin.com': 'linkedin',
    'twitch.tv': 'twitch',
    'netflix.com': 'netflix',
    'spotify.com': 'spotify',
    'coursera.org': 'coursera', 'udemy.com': 'udemy', 'khanacademy.org': 'khanacademy',
    'medium.com': 'medium',
    'amazon.com': 'amazon', 'aliexpress.com': 'aliexpress', 'olx.uz': 'olx', 'uzum.uz': 'uzum',
  });

  /** URL/host'dan xavfsiz hostname (protokolsiz kirsa ham ishlaydi). */
  function hostFromUrl(url) {
    if (!url) return '';
    let h = String(url).trim();
    try {
      if (!/^[a-z]+:\/\//i.test(h)) h = 'http://' + h;
      h = new URL(h).hostname;
    } catch {
      h = String(url).replace(/^[a-z]+:\/\//i, '').split('/')[0].split('?')[0];
    }
    return h.toLowerCase().replace(/^www\./, '');
  }

  /** Registrable domain (eng oxirgi ikki bo'lak) — subdomenlarni birlashtiradi. */
  function normalizeDomain(url) {
    const host = hostFromUrl(url);
    if (!host) return '';
    // m.youtube.com → youtube.com (alias jadvali uchun)
    const stripped = host.replace(/^m\./, '');
    if (PLATFORM_ALIASES[stripped]) return stripped;
    if (PLATFORM_ALIASES[host]) return host;
    // Ikki bo'lakli domen (co.uk kabi ikkilamchi TLD'larni oddiy qoldiramiz — MVP)
    const parts = host.split('.');
    if (parts.length <= 2) return host;
    return parts.slice(-2).join('.');
  }

  /** Domen → platforma kaliti (§12). Aliasda bo'lmasa domenning o'zi. */
  function platformFromDomain(domainOrUrl) {
    const domain = normalizeDomain(domainOrUrl);
    if (!domain) return null;
    return PLATFORM_ALIASES[domain] || domain.replace(/\.[a-z.]+$/, '');
  }

  /** scroll-core snapshot activityType → kanonik. */
  function canonicalActivity(coreType) {
    return CORE_ACTIVITY_MAP[coreType] || ACTIVITY_TYPE.UNKNOWN;
  }

  /** ISO sana kaliti (mahalliy kun chegarasi — §15/§27 timezone-aware). */
  function localDateKey(ts = Date.now()) {
    const d = new Date(ts);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }

  /** Mahalliy hafta boshi (Dushanba 00:00) sana kaliti — §15. */
  function localWeekStartKey(ts = Date.now()) {
    const d = new Date(ts);
    d.setHours(0, 0, 0, 0);
    const dow = (d.getDay() + 6) % 7; // Dushanba=0 ... Yakshanba=6
    d.setDate(d.getDate() - dow);
    return localDateKey(d.getTime());
  }

  return {
    ACTIVITY_TYPE, CONTENT_CATEGORY, VALUE_LEVEL,
    PLATFORM_ALIASES,
    hostFromUrl, normalizeDomain, platformFromDomain,
    canonicalActivity, localDateKey, localWeekStartKey,
  };
}));
