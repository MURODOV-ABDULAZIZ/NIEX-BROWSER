// ═══════════════════════════════════════════════════════════════════
// NIEX YOUTUBE BOOSTER — monitor.js dan qo'shimcha qatlam
// ═══════════════════════════════════════════════════════════════════
// Muammo:
//   1. Playlist (Mix, related videos) thumbnaillar monitor.js scanidan o'tib ketadi
//      (lazy-load, iframe emas, alohida selectorlar)
//   2. Shorts 5 sekundlik adult burst frame-scanner debounce'idan chetlab o'tadi
//   3. Fashion/music-video style kontent lokal NSFW.js chegarasidan past qoladi
//
// Yechim (bu skript):
//   1. YouTube-specific selectorlar bilan qo'shimcha scan (playlist, sidebar, shorts)
//   2. Kengaytirilgan keyword-list (music-video adult patterns)
//   3. Uncertain thumbnailar → CLOUD AI (window.safenet.checkImageData → aiGateway → Gemini)
//   4. Cloud "harmful" desa → shu itemga shield qo'yamiz (monitor.js block system'iga uyg'un)

(function () {
  'use strict';
  if (window.__NIEX_YT_BOOST__) return;   // duplicate guard
  window.__NIEX_YT_BOOST__ = true;
  const H = location.hostname || '';
  if (!/youtube\.com$/i.test(H) && !/^m\.youtube\.com$/i.test(H)) return;
  console.log('[YT-BOOST] Loaded on', H);

  // ── Kengaytirilgan music-video adult keyword patternlar ──
  const HARMFUL_TITLE_RX = [
    /\bvevo\b/i,
    /\bbikini\b/i, /\blingerie\b/i, /\bgravure\b/i,
    /\bbunny\s*girl\b/i, /\bnaked\b/i, /\bnude\b/i,
    /\bsexy\b/i, /\bsensual\b/i, /\bhot\s*(girl|model|dance)\b/i,
    /\btouch\s*me\b/i, /\bgirlz?\s*(night|kiss|dance)\b/i,
    /\bbbl\b/i, /\bbig\s*(ass|butt|boobs)\b/i,
    /\btwerk/i, /\bboo?ty/i, /\bthicc\b/i,
    /\bkean\s*dysso\b/i, /\bkristafoxx\b/i, /\bdeelize\b/i,
    /\blabarbie\b/i, /\bmax\s*asia\b/i, /\bcherry\s*(trang|frang)\b/i,
    /\b400cc\s*plus\b/i, /\blion\s*fiah\b/i,
    /\btry-?on\s*(haul|outfit)/i, /\bblazer\s*bikini\b/i,
    /\bwick\s*x\b/i,
  ];

  const SAFE_TITLE_RX = [
    /world\s*cup/i, /football/i, /soccer/i,
    /messi|ronaldo|neymar|mbappe|haaland/i,
    /grand\s*prix/i, /formula/i, /f1\s*(race|highlights)/i,
    /basketball|nba|fifa/i,
  ];

  function classifyTitle(title) {
    if (!title) return { verdict: 'unknown', reason: '' };
    for (const rx of SAFE_TITLE_RX) if (rx.test(title)) return { verdict: 'safe', reason: 'safe-kw' };
    for (const rx of HARMFUL_TITLE_RX) if (rx.test(title)) return { verdict: 'harmful', reason: 'harmful-kw:' + rx.source };
    return { verdict: 'unknown', reason: '' };
  }

  // ── Qo'shimcha selectorlar ──
  const YT_ITEM_SELECTORS = [
    'ytd-playlist-panel-video-renderer',        // Watch page: Mix/playlist right panel
    'ytd-compact-video-renderer',               // Watch page: related videos
    'ytd-compact-radio-renderer',                // Watch page: Mix cards
    'ytd-compact-playlist-renderer',
    'ytd-video-renderer',                        // Search results
    'ytd-rich-item-renderer',                    // Home page grid
    'ytd-grid-video-renderer',
    'ytd-reel-item-renderer',                    // Shorts shelf
    'ytm-shorts-lockup-view-model',              // Shorts variant
    'yt-lockup-view-model',                      // New YouTube design
    'ytd-shelf-renderer ytd-grid-video-renderer',
  ];

  // ── Shield qo'llash (monitor.js kabi ko'rinishda) ──
  function shieldItem(el, reason) {
    if (!el || el.dataset.niexYtBlocked === '1') return;
    el.dataset.niexYtBlocked = '1';

    // Overlay
    const overlay = document.createElement('div');
    overlay.style.cssText = 'position:absolute;inset:0;background:linear-gradient(135deg,rgba(20,10,30,.98),rgba(10,5,20,.98));border-radius:12px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:6px;z-index:9999;pointer-events:auto;font-family:system-ui,-apple-system,sans-serif;user-select:none;cursor:not-allowed';
    overlay.innerHTML = `
      <div style="width:44px;height:44px;border-radius:50%;background:rgba(0,229,160,.15);display:flex;align-items:center;justify-content:center;font-size:22px;box-shadow:0 0 20px rgba(0,229,160,.3)">🛡️</div>
      <div style="color:#eaf0fb;font-size:13px;font-weight:800;letter-spacing:.5px">Bloklandi</div>
      <div style="color:#a5b1c8;font-size:10px;text-align:center;padding:0 12px;line-height:1.35">${reason || 'Video preview: harmful'}</div>
    `;

    const cs = getComputedStyle(el);
    if (cs.position === 'static') el.style.position = 'relative';
    el.appendChild(overlay);

    // Click / keyboard blokini o'rnatamiz
    const stop = (ev) => { ev.preventDefault(); ev.stopPropagation(); ev.stopImmediatePropagation(); };
    ['click', 'mousedown', 'mouseup', 'pointerdown', 'pointerup', 'touchstart', 'touchend', 'keydown', 'keyup', 'auxclick', 'contextmenu'].forEach(t => {
      el.addEventListener(t, stop, { capture: true });
    });

    // href tozalash
    el.querySelectorAll('a[href]').forEach(a => {
      a.dataset.origHref = a.href;
      a.removeAttribute('href');
    });

    // Counterni oshirish
    try { if (window.__ciaBridge && window.__ciaBridge.reportBlock) window.__ciaBridge.reportBlock(); } catch (e) {}
  }

  // ── Cloud AI (Gemini/Groq/OpenRouter) chaqirish ──
  function classifyImageCloud(url) {
    return new Promise((resolve) => {
      if (!window.safenet || !window.safenet.checkImages) {
        resolve({ ok: false, should_block: false });
        return;
      }
      let done = false;
      const timer = setTimeout(() => {
        if (done) return; done = true;
        resolve({ ok: false, should_block: false, timeout: true });
      }, 3500);
      try {
        window.safenet.checkImages([url], (r) => {
          if (done) return; done = true; clearTimeout(timer);
          const item = Array.isArray(r) && r[0] ? r[0] : r;
          resolve({
            ok: true,
            should_block: !!(item && (item.should_block || item.blocked || item.harmful)),
            reason: (item && (item.block_reason || item.reason)) || '',
          });
        });
      } catch (e) {
        if (done) return; done = true; clearTimeout(timer);
        resolve({ ok: false, should_block: false, error: e.message });
      }
    });
  }

  // Per-URL cloud call rate limit (sahifa uchun umuman ~15 ta max)
  const CLOUD_CALL_MAX = 15;
  let cloudCalls = 0;
  const cloudCheckedUrls = new Set();

  async function analyzeThumbnail(imgEl, contextTitle) {
    if (!imgEl || !imgEl.src) return null;
    const src = imgEl.src;
    if (cloudCheckedUrls.has(src)) return null;
    if (cloudCalls >= CLOUD_CALL_MAX) return null;
    cloudCheckedUrls.add(src);
    cloudCalls++;
    return await classifyImageCloud(src);
  }

  // ── Har playlist/related itemni tekshirish ──
  const processed = new WeakSet();
  async function processItem(item) {
    if (!item || processed.has(item)) return;
    processed.add(item);

    // Sarlavhani turli xil YouTube selectorlar'dan olamiz
    const titleEl = item.querySelector('#video-title, h3, .yt-lockup-view-model-wiz__title, span[title], a[title]');
    const title = (titleEl && (titleEl.textContent || titleEl.getAttribute('title') || '').trim()) || '';

    // 1. Keyword-level tez tekshiruv
    const kw = classifyTitle(title);
    if (kw.verdict === 'safe') return;
    if (kw.verdict === 'harmful') {
      shieldItem(item, 'Sarlavha: adult kontent');
      return;
    }

    // 2. Sarlavha noaniq — thumbnailni cloud'ga yuboramiz (agar limit qolgan bo'lsa)
    const img = item.querySelector('img[src]:not([src=""])');
    if (!img) return;
    const result = await analyzeThumbnail(img, title);
    if (result && result.ok && result.should_block) {
      shieldItem(item, 'AI: cloud harmful');
    }
  }

  function scanAll() {
    const sel = YT_ITEM_SELECTORS.join(', ');
    const items = document.querySelectorAll(sel);
    items.forEach(processItem);
  }

  // ── SHORTS: agressiv frame scan ──
  //   Har 1.5 sekund (5s emas), Shorts video kadrini cloud'ga yuboramiz.
  //   Shorts qisqa bo'lgani uchun tez tekshirish MUHIM — 5s adult burst monitor.js'da
  //   ko'rinmasdan o'tib ketadi.
  const shortsChecked = new WeakSet();
  const shortsCloudLimit = 8; // Shorts uchun alohida limit
  let shortsCalls = 0;

  function grabVideoFrame(video) {
    try {
      if (video.readyState < 2 || video.videoWidth === 0) return null;
      const w = 320, h = Math.round(320 * (video.videoHeight / video.videoWidth));
      const canvas = document.createElement('canvas');
      canvas.width = w; canvas.height = h;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(video, 0, 0, w, h);
      return canvas.toDataURL('image/jpeg', 0.72);
    } catch (e) { return null; }
  }

  function classifyImageDataCloud(base64) {
    return new Promise((resolve) => {
      if (!window.safenet || !window.safenet.checkImageData) { resolve({ ok: false }); return; }
      let done = false;
      const timer = setTimeout(() => { if (done) return; done = true; resolve({ ok: false, timeout: true }); }, 3500);
      try {
        window.safenet.checkImageData({ base64 }, (r) => {
          if (done) return; done = true; clearTimeout(timer);
          resolve({ ok: true, should_block: !!(r && (r.should_block || r.blocked)), reason: r && (r.block_reason || r.reason) });
        });
      } catch (e) {
        if (done) return; done = true; clearTimeout(timer);
        resolve({ ok: false, error: e.message });
      }
    });
  }

  async function scanShortsFrames() {
    if (!/\/shorts\//i.test(location.pathname)) return;
    if (shortsCalls >= shortsCloudLimit) return;
    const video = document.querySelector('ytd-reel-video-renderer[is-active] video, .html5-main-video');
    if (!video || shortsChecked.has(video)) return;
    if (video.paused || video.currentTime < 1) return;
    // Har video uchun keyingi cloud call'gacha 1.5s cooldown
    if (video.__niexNextScan && Date.now() < video.__niexNextScan) return;
    video.__niexNextScan = Date.now() + 1500;

    const dataUrl = grabVideoFrame(video);
    if (!dataUrl) return;
    const base64 = dataUrl.split(',')[1];
    if (!base64) return;

    shortsCalls++;
    const res = await classifyImageDataCloud(base64);
    if (res && res.should_block) {
      // Shortni bloklash — pauza + shield + navigatsiya oldini olish
      try { video.pause(); video.muted = true; } catch (e) {}
      const container = video.closest('ytd-reel-video-renderer') || video.parentElement;
      if (container) shieldItem(container, 'Shorts: cloud harmful (' + (res.reason || 'AI') + ')');
      shortsChecked.add(video);
    }
  }

  // ── Mutation Observer + interval sikllar ──
  let mutTimer = null;
  const debouncedScan = () => {
    if (mutTimer) return;
    mutTimer = setTimeout(() => { mutTimer = null; scanAll(); }, 300);
  };

  new MutationObserver(debouncedScan).observe(document.documentElement, {
    childList: true, subtree: true,
  });

  // SPA navigation hook — URL o'zgarsa qayta scan
  let lastUrl = location.href;
  setInterval(() => {
    if (location.href !== lastUrl) {
      lastUrl = location.href;
      cloudCalls = 0; shortsCalls = 0;
      cloudCheckedUrls.clear();
      setTimeout(scanAll, 800);
    }
    scanShortsFrames();
  }, 700);

  // Initial scan (500ms delay for initial hydration)
  setTimeout(scanAll, 500);
  setTimeout(scanAll, 2500);
  setTimeout(scanAll, 6000);

  console.log('[YT-BOOST] Ready — playlist/shorts scanner + cloud fallback active');
})();
