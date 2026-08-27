/**
 * NIEX Focus — Scroll Detector (content script, desktop).
 *
 * Sahifaga `executeJavaScript` orqali inject qilinadi (monitor.js / youtube-boost.js
 * kabi). `NIEXScrollCore` (scroll-activity-core.js) undan oldin inject qilinadi.
 *
 * Vazifa: HAQIQIY feed-scroll faoliyatini aniqlash va `window.safenet_focus_activity`
 * orqali main'ga xabar berish. Faqat feed kontekstida (YouTube Home/Shorts,
 * Instagram feed/Reels) scroll hisoblanadi — video/qidiruv/chat/o'qish EMAS.
 *
 * Xavfsizlik/performans (spec §14): idempotent (takroriy listener yo'q), scroll
 * hodisalari throttle qilinadi, SPA route o'zgarishi kuzatiladi, sahifa yopilganda
 * tozalanadi.
 */
(function () {
  'use strict';
  if (window.__niexScrollDetector) return;      // takroriy inject himoyasi
  var Core = window.NIEXScrollCore;
  var bridge = window.safenet_focus_activity;
  if (!Core || !Core.ScrollActivityCore || !bridge || typeof bridge.report !== 'function') return;
  window.__niexScrollDetector = true;

  var CT = Core.CONTEXT_TYPE;
  var core = new Core.ScrollActivityCore();

  // ── SITE ADAPTERLAR ──────────────────────────────────────────────
  // Har biri joriy URL/DOM'ga qarab kontekst qaytaradi. YouTube va Instagram
  // DOM'lari har xil va o'zgarishi mumkin — shuning uchun alohida adapterlar.

  function ytAdapter(loc) {
    var p = loc.pathname;
    if (p === '/' || p.indexOf('/feed') === 0) return { type: CT.FEED, feedMode: 'scroll', platform: 'youtube', name: 'home' };
    if (p.indexOf('/shorts') === 0) return { type: CT.FEED, feedMode: 'shortform', platform: 'youtube', name: 'shorts' };
    if (p.indexOf('/results') === 0) return { type: CT.SEARCH, platform: 'youtube', name: 'search' };
    if (p.indexOf('/watch') === 0) return { type: CT.VIDEO, platform: 'youtube', name: 'watch' };
    if (p.indexOf('/channel') === 0 || p.indexOf('/@') === 0 || p.indexOf('/c/') === 0 || p.indexOf('/user') === 0)
      return { type: CT.READING, platform: 'youtube', name: 'channel' };
    return { type: CT.READING, platform: 'youtube', name: 'other' };
  }

  function igAdapter(loc) {
    var p = loc.pathname;
    if (p === '/') return { type: CT.FEED, feedMode: 'scroll', platform: 'instagram', name: 'feed' };
    if (p.indexOf('/reels') === 0) return { type: CT.FEED, feedMode: 'shortform', platform: 'instagram', name: 'reels' };
    if (p.indexOf('/reel/') === 0) return { type: CT.READING, platform: 'instagram', name: 'reel' };
    if (p.indexOf('/direct') === 0) return { type: CT.CHAT, platform: 'instagram', name: 'dm' };
    if (p.indexOf('/explore') === 0) return { type: CT.SEARCH, platform: 'instagram', name: 'explore' };
    if (p.indexOf('/p/') === 0) return { type: CT.READING, platform: 'instagram', name: 'post' };
    if (p.indexOf('/accounts') === 0 || p.indexOf('/settings') === 0)
      return { type: CT.READING, platform: 'instagram', name: 'settings' };
    return { type: CT.READING, platform: 'instagram', name: 'profile' };
  }

  function detectContext() {
    var host = location.hostname.replace(/^www\./, '');
    try {
      if (host.indexOf('youtube.com') !== -1 || host === 'youtu.be') return ytAdapter(location);
      if (host.indexOf('instagram.com') !== -1) return igAdapter(location);
    } catch (e) {}
    // Boshqa saytlar: oddiy o'qish/navigatsiya — distraction scroll EMAS (spec §4/§5).
    return { type: CT.READING, platform: host || null, name: 'generic' };
  }

  function applyContext() { core.setContext(detectContext()); }

  // ── SCROLL SIGNALI (throttled) ───────────────────────────────────
  var lastScrollTick = 0;
  var SCROLL_THROTTLE = 250; // ms — bir scroll "urinishi" uchun eng ko'p 1 ta hodisa
  function onScrollSignal() {
    var t = Date.now();
    if (t - lastScrollTick < SCROLL_THROTTLE) return;
    lastScrollTick = t;
    core.onScroll();
  }

  // Klaviatura orqali feed aylantirish (PageDown/Space/Arrow) ham scroll signali
  function onKey(e) {
    var k = e.key;
    if (k === 'PageDown' || k === 'PageUp' || k === ' ' || k === 'ArrowDown' || k === 'ArrowUp') onScrollSignal();
  }

  // ── HISOBOT ──────────────────────────────────────────────────────
  var lastReportKey = '';
  var lastReportAt = 0;
  function report(force) {
    try {
      var snap = core.snapshot();
      snap.url = location.href.slice(0, 300);
      // Sahifa sarlavhasi — content classification uchun ASOSIY signal (mavzu).
      snap.title = (document.title || '').slice(0, 200);
      // Faqat mazmunli o'zgarishda yoki majburiy — spam bo'lmasin.
      var key = snap.state + '|' + Math.round(snap.scrollingMs / 1000) + '|' + snap.activityType;
      if (!force && key === lastReportKey) return;
      lastReportKey = key;
      lastReportAt = Date.now();
      bridge.report(snap);
    } catch (e) {}
  }

  // ── LOOP ─────────────────────────────────────────────────────────
  var tickTimer = null;
  var HEARTBEAT_MS = 12000; // non-feed activity (video ko'rish/o'qish) vaqti ham hisoblanishi uchun
  function loop() {
    core.tick();
    // Feed yoki scrolling bo'lsa har ~1s hisobot; aks holda kamdan-kam.
    if (core.isFeed || core.liveScrollingMs() > 0) report(false);
    // Heartbeat — active+ko'rinadigan tab bo'lsa main wall-clock vaqtni yozadi (§4).
    if (Date.now() - lastReportAt >= HEARTBEAT_MS) report(true);
  }
  function startLoop() { if (!tickTimer) tickTimer = setInterval(loop, 1000); }
  function stopLoop() { if (tickTimer) { clearInterval(tickTimer); tickTimer = null; } }

  // ── SPA ROUTE O'ZGARISHI (spec §15) ──────────────────────────────
  function hookHistory() {
    var fire = function () { setTimeout(function () { applyContext(); report(true); }, 30); };
    ['pushState', 'replaceState'].forEach(function (m) {
      var orig = history[m];
      if (typeof orig === 'function' && !orig.__niexHooked) {
        history[m] = function () { var r = orig.apply(this, arguments); fire(); return r; };
        history[m].__niexHooked = true;
      }
    });
    window.addEventListener('popstate', fire, { passive: true });
    // yt-navigate-finish — YouTube o'z SPA eventi
    window.addEventListener('yt-navigate-finish', fire, { passive: true });
  }

  // ── VISIBILITY (fon tab — spec §14: faqat active tab hisoblanadi) ─
  function onVisibility() {
    if (document.hidden) { core.tick(); report(true); stopLoop(); }
    else { applyContext(); startLoop(); report(true); }
  }

  // ── ULASH ────────────────────────────────────────────────────────
  var listenerOpts = { passive: true, capture: true };
  window.addEventListener('scroll', onScrollSignal, listenerOpts);
  window.addEventListener('wheel', onScrollSignal, listenerOpts);
  window.addEventListener('touchmove', onScrollSignal, listenerOpts);
  window.addEventListener('keydown', onKey, listenerOpts);
  document.addEventListener('visibilitychange', onVisibility, false);
  window.addEventListener('pagehide', function () { core.tick(); report(true); stopLoop(); }, false);

  hookHistory();
  applyContext();
  if (!document.hidden) startLoop();
  report(true);
})();
