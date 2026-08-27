/**
 * Block Reporter — AI Brain block hodisalarini parent'ga jo'natadi
 * ================================================================
 *
 * Bu skript har brauzer sahifasiga inject qilinadi (monitor.js yonida).
 * AI Brain bloklaganda `window.postMessage({type:'CIA_BLOCK', ...})` yuboradi,
 * bu esa preload orqali main.js'ga uzatiladi va Firestore'ga yoziladi.
 *
 * Faqat role=child bo'lgan foydalanuvchilar uchun ishlaydi.
 * Toza kontent uchun hech qanday tarmoq so'rovi bo'lmaydi.
 */

(function () {
  'use strict';

  const REPORT_QUEUE = [];
  const RATE_LIMIT_MS = 2000; // bir xil kontent 2 soniyada bir marta yuborilsin
  const _recentKeys = new Map();

  function shouldSend(key) {
    const now = Date.now();
    const last = _recentKeys.get(key) || 0;
    if (now - last < RATE_LIMIT_MS) return false;
    _recentKeys.set(key, now);
    // Cache tozalash
    if (_recentKeys.size > 100) {
      const oldest = [..._recentKeys.entries()].sort((a, b) => a[1] - b[1])[0];
      if (oldest) _recentKeys.delete(oldest[0]);
    }
    return true;
  }

  // Kategoriyani reason'dan aniqlash
  function detectCategory(reason) {
    const r = String(reason || '').toLowerCase();
    if (/porn|nsfw|nude|erotic|xxx|sex|adult|onlyfans|hentai/.test(r)) return 'pornography';
    if (/gambl|casino|bet|slot/.test(r)) return 'gambling';
    if (/drug|cocaine|heroin|meth|marijuana/.test(r)) return 'drugs';
    if (/violence|gore|kill|behead|weapon/.test(r)) return 'violence';
    return 'unknown';
  }

  function reportBlock(payload) {
    try {
      const key = (payload.category || '') + '|' + (payload.searchQuery || '') + '|' + (payload.url || '').slice(0, 50);
      if (!shouldSend(key)) return;

      // Main process'ga IPC orqali yuborish (preload orqali)
      if (window.__parentControlBridge && typeof window.__parentControlBridge.reportBlock === 'function') {
        window.__parentControlBridge.reportBlock(payload);
      } else {
        REPORT_QUEUE.push(payload);
      }
    } catch (e) {
      console.warn('[block-reporter]', e);
    }
  }

  // AI Brain'dan `window.postMessage` orqali signal
  window.addEventListener('message', (event) => {
    if (event.source !== window) return;
    const data = event.data;
    if (!data || data.type !== 'CIA_BLOCK') return;

    reportBlock({
      category: data.category || detectCategory(data.reason),
      searchQuery: data.searchQuery || '',
      url: data.url || location.href,
      reason: data.reason || '',
      device: navigator.platform,
      browser: 'Niex',
    });
  });

  // Domain blocklar uchun URL orqali kategoriya
  const urlLower = location.href.toLowerCase();
  const HARMFUL_URL_KEYS = {
    pornography: /porn|xxx|xhamster|onlyfans|chaturbate|hentai|stripchat|xvideos|redtube|youporn/,
    gambling: /casino|bet365|poker|slots|gambling/,
    drugs: /drugs|cocaine|marijuana|heroin/,
    violence: /gore|violence|torture/,
  };
  for (const [cat, rx] of Object.entries(HARMFUL_URL_KEYS)) {
    if (rx.test(urlLower)) {
      reportBlock({
        category: cat,
        searchQuery: '',
        url: location.href,
        reason: 'URL domain match',
        device: navigator.platform,
        browser: 'Niex',
      });
      break;
    }
  }

  // Bridge kelganda queue'ni yuborish
  const checkBridge = setInterval(() => {
    if (window.__parentControlBridge && REPORT_QUEUE.length) {
      while (REPORT_QUEUE.length) {
        const p = REPORT_QUEUE.shift();
        window.__parentControlBridge.reportBlock(p);
      }
      clearInterval(checkBridge);
    }
  }, 500);
  setTimeout(() => clearInterval(checkBridge), 10000);
})();
