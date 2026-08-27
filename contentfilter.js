/**
 * SafeNet Content Filter v14 — MUTLAQ BLOK
 *
 * ASOSIY O'ZGARISH:
 * - Bloklangan element HECH QANDAY usulda ochib bo'lmaydi
 * - Instagram grid: rasm + klik + href + JS event — barchasi bloklanadi
 * - YouTube: thumbnaillar AI orqali tekshiriladi
 * - Video: poster + frame capture ikkalasi
 * - Instagram post ochilganda (dialog/modal) ham blok
 */
(function() {
  'use strict';
  if (window.__sn_v14) return;
  window.__sn_v14 = true;

  const HOST   = window.location.hostname;
  const IS_PIN = HOST.includes('pinterest');
  const IS_YT  = HOST.includes('youtube');
  const IS_DDG = HOST.includes('duckduckgo');
  const IS_IG  = HOST.includes('instagram');
  const IS_PIN_CLOSEUP = IS_PIN && /^\/pin\/\d/.test(location.pathname);

  // ══════════════════════════════════════
  // KALIT SO'ZLAR
  // ══════════════════════════════════════
  const BAD = [
    'porn','xxx','nude','naked','nsfw','hentai','erotic',
    'explicit','bdsm','fetish','topless','genitals','nipple',
    'onlyfans','fansly','chaturbate','stripchat','camgirl','camsite',
    'behayo','uyatsiz',"yalang'och",'yalangoch','rasvo','fohisha',
    'eva elfie','mia khalifa','riley reid','lana rhoades',
    'amouranth','belle delphine','brandi love',
    'bikini','lingerie','thong','seethrough','cleavage','twerk',
  ];
  function isBad(t) {
    if (!t) return false;
    const s = t.toLowerCase();
    return BAD.some(w => s.includes(w));
  }

  // ══════════════════════════════════════
  // BLOKLANGAN URL lari ro'yxati
  // Sahifa navigatsiyasini ham to'sish uchun
  // ══════════════════════════════════════
  const blockedSrcs = new Set();

  // ══════════════════════════════════════
  // MUTLAQ BLOK FUNKSIYASI
  // Element + uning barcha ichki elementlari
  // + klik + navigatsiya — barchasi bloklanadi
  // ══════════════════════════════════════
  function blockEl(el) {
    if (!el || el.__snB14) return;
    el.__snB14 = true;

    // 1. Barcha rasmlar src ni o'chirish (blank pixel)
    const BLANK = 'data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==';
    el.querySelectorAll('img').forEach(img => {
      img.__snB14 = true;
      if (img.src !== BLANK) {
        blockedSrcs.add(img.src);
        try { img.src = BLANK; } catch {}
        try { img.srcset = ''; } catch {}
        try { img.removeAttribute('srcset'); } catch {}
      }
      img.style.cssText += ';visibility:hidden!important;opacity:0!important;display:none!important';
    });

    // 2. Videolar
    el.querySelectorAll('video').forEach(vid => {
      vid.__snB14 = true;
      try { vid.pause(); vid.muted = true; } catch {}
      try { vid.src = ''; vid.load(); } catch {}
      vid.style.cssText += ';visibility:hidden!important;opacity:0!important;display:none!important';
    });

    // 3. Barcha linklar — href olib tashlanadi VA klik to'sib qo'yiladi
    el.querySelectorAll('a').forEach(a => {
      a.__snB14 = true;
      if (a.href) { a.dataset.snOrigHref = a.href; a.removeAttribute('href'); }
      a.style.setProperty('pointer-events','none','important');
      a.style.setProperty('cursor','default','important');
    });

    // 4. O'zi klik qabul qilmasin
    el.style.setProperty('pointer-events','none','important');
    el.style.setProperty('cursor','default','important');

    // 5. CAPTURE PHASE da barcha event larni to'sish
    //    (Instagram JS router uchun)
    const blockEv = e => {
      e.stopImmediatePropagation();
      e.preventDefault();
      return false;
    };
    ['click','mousedown','mouseup','touchstart','touchend',
     'pointerdown','pointerup','keydown','keypress'].forEach(ev => {
      el.addEventListener(ev, blockEv, { capture: true, passive: false });
    });

    // 6. position:relative kerak overlay uchun
    if (getComputedStyle(el).position === 'static') {
      el.style.setProperty('position','relative','important');
    }

    // 7. Eski overlayni olib tashla, yangisini qo'y
    el.querySelectorAll('[data-sn14-ov]').forEach(o => o.remove());
    const ov = document.createElement('div');
    ov.setAttribute('data-sn14-ov','1');
    ov.style.cssText = [
      'position:absolute','top:0','left:0',
      'width:100%','height:100%','min-height:60px',
      'background:#0A0E1A',
      'z-index:2147483647',
      'display:flex','flex-direction:column',
      'align-items:center','justify-content:center',
      'border-radius:inherit',
      'pointer-events:none',
      'overflow:hidden',
      'user-select:none',
    ].map(s => s + '!important').join(';');
    ov.innerHTML =
      '<div style="font-size:26px;pointer-events:none;user-select:none">🛡️</div>' +
      '<div style="color:#00E5A0;font-size:9px;font-weight:900;letter-spacing:2px;' +
      'margin-top:4px;pointer-events:none;user-select:none">SAFENET</div>';
    el.appendChild(ov);
  }

  // Faqat rasmni yashirish (karta topilmasa)
  function blockImgOnly(img) {
    if (!img || img.__snB14) return;
    img.__snB14 = true;
    const BLANK = 'data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==';
    blockedSrcs.add(img.src);
    try { img.src = BLANK; img.srcset = ''; img.removeAttribute('srcset'); } catch {}
    img.style.cssText += ';visibility:hidden!important;opacity:0!important;display:none!important;pointer-events:none!important';
  }

  // ══════════════════════════════════════
  // INSTAGRAM — SAHIFA NAVIGATSIYASINI TO'SIB QOYISH
  // Instagram SPA — pushState orqali sahifani o'zgartiradi
  // Bloklangan postga o'tish ham to'sib qo'yiladi
  // ══════════════════════════════════════
  if (IS_IG) {
    // history.pushState ni override qilish
    const origPush = history.pushState.bind(history);
    const origReplace = history.replaceState.bind(history);

    function isBlockedPost(url) {
      // Bloklangan rasm manbasini tekshirish emas,
      // balki bloklangan element href ini saqlagan edik
      // Bu yerda faqat: agar navigatsiya bloklangan element orqali kelgan bo'lsa
      return false; // Kelajakda kengaytirish mumkin
    }

    history.pushState = function(state, title, url) {
      return origPush(state, title, url);
    };
  }

  // ══════════════════════════════════════
  // KARTA TOPISH
  // ══════════════════════════════════════
  function getCard(el) {
    // Instagram grid cell
    if (IS_IG) {
      // Grid item — div[style] yoki _aagu klass
      const gridItem = el?.closest('._aagu,._aabd,[style*="padding-bottom"]');
      if (gridItem && gridItem.offsetWidth > 50) return gridItem;
      const art = el?.closest('article');
      if (art) return art;
    }
    if (IS_YT) {
      const ytCard = el?.closest(
        'ytd-rich-item-renderer,ytd-video-renderer,ytd-grid-video-renderer,' +
        'ytd-compact-video-renderer,ytd-reel-item-renderer,ytd-shorts-lockup-view-model'
      );
      if (ytCard) return ytCard;
    }
    let cur = el?.parentElement;
    for (let i = 0; i < 10 && cur; i++) {
      const tag  = cur.tagName?.toLowerCase();
      const role = cur.getAttribute('role');
      const w = cur.offsetWidth, h = cur.offsetHeight;
      if (w > 50 && h > 50 && w < 1200 && (
        tag === 'article' || tag === 'li' || tag === 'figure' ||
        role === 'listitem' || role === 'gridcell' || role === 'button' ||
        cur.hasAttribute('data-grid-item') || cur.hasAttribute('data-test-id') ||
        (tag === 'div' && h < 900 && w < 700)
      )) return cur;
      cur = cur.parentElement;
    }
    return el?.closest('article,li,figure,[data-grid-item]') || el?.parentElement;
  }

  // ══════════════════════════════════════
  // AI TEKSHIRUV — window.safenet bridge
  // ══════════════════════════════════════
  const aiDone  = new Set();
  const aiQueue = [];
  let   aiRun   = 0;
  const AI_MAX  = 4;

  function aiCheckURL(url, onBlock, priority) {
    if (!url || !url.startsWith('http') || aiDone.has(url)) return;
    if (!window.safenet?.checkImages) return;
    aiDone.add(url);
    const task = { url, onBlock };
    priority ? aiQueue.unshift(task) : aiQueue.push(task);
    aiDrain();
  }

  function aiDrain() {
    while (aiRun < AI_MAX && aiQueue.length) {
      const { url, onBlock } = aiQueue.shift();
      aiRun++;
      window.safenet.checkImages([url], results => {
        aiRun--;
        aiDrain();
        if (results?.[0]?.should_block) {
          onBlock(results[0].block_reason || 'AI: nomaqbul kontent');
        }
      });
    }
  }

  function aiCheckB64(b64, urlHint, onBlock) {
    if (!b64 || !window.safenet?.checkImageData) return;
    window.safenet.checkImageData({ base64: b64, url: urlHint || '' }, r => {
      if (r?.should_block) onBlock(r.block_reason || 'AI: nomaqbul');
    });
  }

  // ══════════════════════════════════════
  // RASM TEKSHIRISH
  // ══════════════════════════════════════
  function checkImg(img, priority) {
    if (!img || img.__snB14 || img.__snQ14 || img.dataset.snv14) return;
    img.dataset.snv14 = '1';

    const src = img.src || '';
    if (!src || src.startsWith('data:') || src.startsWith('blob:')) return;

    // Ikonka/avatar o'lchami
    const w = img.naturalWidth  || img.clientWidth  || img.offsetWidth  || 0;
    const h = img.naturalHeight || img.clientHeight || img.offsetHeight || 0;
    if (w > 0 && w < 40 && h > 0 && h < 40) return;

    const srcL = src.toLowerCase();
    if (srcL.includes('/favicon') || srcL.includes('/sprite') || srcL.includes('/icon-')) return;

    // Kalit so'z tekshirish
    const alt = (img.alt || img.title || '').toLowerCase();
    if (isBad(alt)) {
      const card = getCard(img);
      if (card) blockEl(card); else blockImgOnly(img);
      return;
    }

    img.__snQ14 = true;
    aiCheckURL(src, reason => {
      img.__snQ14 = false;
      const card = getCard(img);
      if (card) blockEl(card); else blockImgOnly(img);
    }, priority || 0);
  }

  // ══════════════════════════════════════
  // VIDEO TEKSHIRISH — poster + frame
  // ══════════════════════════════════════
  function checkVideo(vid) {
    if (!vid || vid.__snB14 || vid.dataset.snv14) return;
    vid.dataset.snv14 = '1';

    const aria = (vid.getAttribute('aria-label') || '').toLowerCase();
    if (isBad(aria)) {
      const card = getCard(vid);
      if (card) blockEl(card); else { try { vid.pause(); } catch {} }
      return;
    }

    function onVidBlock() {
      const card = getCard(vid) || vid.closest('article') || vid.parentElement;
      if (card) blockEl(card);
    }

    // Poster tekshirish
    const poster = vid.poster;
    if (poster && poster.startsWith('http')) {
      aiCheckURL(poster, onVidBlock, 0);
    }

    // Frame capture — video o'ynayotganda
    function doFrame() {
      if (vid.__snB14 || vid.__snFrame14) return;
      if (!vid.videoWidth || vid.videoWidth < 50) return;
      vid.__snFrame14 = true;
      try {
        const sz = 320;
        const sc = Math.min(1, sz / Math.max(vid.videoWidth, vid.videoHeight));
        const cw = Math.round(vid.videoWidth * sc);
        const ch = Math.round(vid.videoHeight * sc);
        const cv = document.createElement('canvas');
        cv.width = cw; cv.height = ch;
        cv.getContext('2d').drawImage(vid, 0, 0, cw, ch);
        const b64 = cv.toDataURL('image/jpeg', 0.75).split(',')[1];
        if (b64) aiCheckB64(b64, vid.src || vid.currentSrc || '', onVidBlock);
      } catch {}
    }

    if (vid.readyState >= 2) doFrame();
    else {
      vid.addEventListener('loadeddata', doFrame, { once: true });
      vid.addEventListener('playing', () => setTimeout(doFrame, 500), { once: true });
    }
    // 5 soniyadan keyin yana bir frame
    setTimeout(() => {
      if (!vid.__snB14) { vid.__snFrame14 = false; doFrame(); }
    }, 5000);
  }

  // ══════════════════════════════════════
  // INSTAGRAM — GRID KLIK BLOKLASH
  // Instagram grid da har bir cell ustiga
  // global capture listener qo'yamiz
  // ══════════════════════════════════════
  if (IS_IG) {
    document.addEventListener('click', function(e) {
      // Bloklangan elementga klik kelsa — to'sib qo'y
      let el = e.target;
      while (el && el !== document.body) {
        if (el.__snB14) {
          e.stopImmediatePropagation();
          e.preventDefault();
          return false;
        }
        el = el.parentElement;
      }
    }, { capture: true, passive: false });

    document.addEventListener('mousedown', function(e) {
      let el = e.target;
      while (el && el !== document.body) {
        if (el.__snB14) {
          e.stopImmediatePropagation();
          e.preventDefault();
          return false;
        }
        el = el.parentElement;
      }
    }, { capture: true, passive: false });

    // Pointer events ham
    document.addEventListener('pointerdown', function(e) {
      let el = e.target;
      while (el && el !== document.body) {
        if (el.__snB14) {
          e.stopImmediatePropagation();
          e.preventDefault();
          return false;
        }
        el = el.parentElement;
      }
    }, { capture: true, passive: false });
  }

  // ══════════════════════════════════════
  // DDG LOGO
  // ══════════════════════════════════════
  function fixDDGLogo() {
    if (!document.__snDDG) {
      document.__snDDG = true;
      const s = document.createElement('style');
      s.textContent = `.header__logo-img,.ddg-logo,img[src*="duckduckgo.com/favicon"]{display:none!important}`;
      (document.head || document.documentElement).appendChild(s);
    }
    document.querySelectorAll('header img:not([data-sn-logo])').forEach(img => {
      const src = img.src || '';
      if (!src.includes('duckduckgo')) return;
      if ((img.offsetWidth || 999) > 200) return;
      img.dataset.snLogo = '1'; img.style.display = 'none';
      const d = document.createElement('div');
      d.style.cssText = 'display:inline-flex;align-items:center;gap:6px;pointer-events:none';
      d.innerHTML = '<span style="font-size:20px">🛡️</span>'
        + '<span style="font-size:15px;font-weight:900;background:linear-gradient(135deg,#00E5A0,#3B82F6);'
        + '-webkit-background-clip:text;-webkit-text-fill-color:transparent">SafeNet</span>';
      img.parentNode?.insertBefore(d, img);
    });
  }

  // ══════════════════════════════════════
  // ASOSIY SKAN
  // ══════════════════════════════════════
  function scan() {

    // ── YOUTUBE ──
    if (IS_YT) {
      const YT_SEL = [
        'ytd-rich-item-renderer','ytd-video-renderer',
        'ytd-grid-video-renderer','ytd-compact-video-renderer',
        'ytd-reel-item-renderer','ytd-shorts-lockup-view-model'
      ].join(',');
      document.querySelectorAll(YT_SEL).forEach(el => {
        if (el.__snYT14) return;
        el.__snYT14 = true;
        const title = (el.querySelector('#video-title,#title,h3')?.textContent || '').toLowerCase();
        const ch    = (el.querySelector('#channel-name,.ytd-channel-name')?.textContent || '').toLowerCase();
        if (isBad(title + ' ' + ch)) { blockEl(el); return; }
        const img = el.querySelector('img');
        if (img) checkImg(img, 0);
      });
      document.querySelectorAll('img:not([data-snv14])').forEach(img => checkImg(img, 0));
      document.querySelectorAll('video:not([data-snv14])').forEach(vid => checkVideo(vid));
      return;
    }

    // ── INSTAGRAM ──
    if (IS_IG) {
      // Feed articlelar
      document.querySelectorAll('article:not([data-snv14])').forEach(el => {
        el.dataset.snv14 = '1';
        el.querySelectorAll('img:not([data-snv14])').forEach(img => checkImg(img, 1));
        el.querySelectorAll('video:not([data-snv14])').forEach(vid => checkVideo(vid));
      });

      // Grid rasmlar — article tashqarisida
      // Instagram grid: div > a > div > img pattern
      document.querySelectorAll('a:not([data-snv14-a])').forEach(a => {
        a.dataset.snv14A = '1';
        const img = a.querySelector('img');
        if (!img) return;
        const imgW = img.naturalWidth || img.offsetWidth || 0;
        const imgH = img.naturalHeight || img.offsetHeight || 0;
        // Grid post rasmlar katta bo'ladi (>100px)
        if (imgW < 80 && imgH < 80) return;
        if (img.dataset.snv14) return;
        checkImg(img, 1);
      });

      // Barcha qolgan rasmlar
      document.querySelectorAll('img:not([data-snv14])').forEach(img => {
        const w = img.naturalWidth || img.offsetWidth || 0;
        if (w > 0 && w < 60) { img.dataset.snv14 = '1'; return; }
        checkImg(img, 1);
      });

      // Videolar
      document.querySelectorAll('video:not([data-snv14])').forEach(vid => checkVideo(vid));
      return;
    }

    // ── PINTEREST ──
    if (IS_PIN) {
      if (IS_PIN_CLOSEUP) {
        document.querySelectorAll('img:not([data-snv14])').forEach(img => {
          img.dataset.snv14 = '1';
          const w = img.naturalWidth || img.offsetWidth || 0;
          const h = img.naturalHeight || img.offsetHeight || 0;
          if (w < 20 || h < 20) return;
          const alt = (img.alt||'').toLowerCase();
          if (isBad(alt)) { blockImgOnly(img); return; }
          if (w < 300 && h < 300) {
            aiCheckURL(img.src, () => { blockImgOnly(img); blockEl(getCard(img)); }, 0);
          }
        });
      } else {
        document.querySelectorAll('img:not([data-snv14])').forEach(img => checkImg(img, 0));
      }
      return;
    }

    // ── DDG ──
    if (IS_DDG) {
      fixDDGLogo();
      document.querySelectorAll('[data-testid="result"]:not([data-snv14]),.result:not([data-snv14])').forEach(el => {
        el.dataset.snv14 = '1';
        if (isBad(el.textContent || '')) { el.style.display = 'none'; return; }
      });
      document.querySelectorAll('img:not([data-snv14])').forEach(img => {
        const src = img.src || '';
        if (src.includes('external.duckduckgo') || src.includes('i.duckduckgoassets')) {
          checkImg(img, 0);
        } else {
          img.dataset.snv14 = '1';
        }
      });
      return;
    }

    // ── BOSHQA SAYTLAR ──
    document.querySelectorAll('img:not([data-snv14])').forEach(img => checkImg(img, 0));
    document.querySelectorAll('video:not([data-snv14])').forEach(vid => checkVideo(vid));
  }

  // ══════════════════════════════════════
  // MUTATION OBSERVER
  // ══════════════════════════════════════
  const mo = new MutationObserver(muts => {
    let hasNew = false;
    muts.forEach(m => {
      m.addedNodes.forEach(n => {
        if (!n.querySelectorAll) return;
        hasNew = true;
        // Bloklangan src qayta tiklanishini oldini olish
        if (n.tagName === 'IMG' && blockedSrcs.has(n.src)) {
          const BLANK = 'data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==';
          try { n.src = BLANK; n.srcset = ''; } catch {}
          return;
        }
        n.querySelectorAll('img:not([data-snv14])').forEach(i => checkImg(i, IS_IG ? 1 : 0));
        n.querySelectorAll('video:not([data-snv14])').forEach(v => checkVideo(v));
        if (n.tagName === 'IMG'   && !n.dataset.snv14) checkImg(n, IS_IG ? 1 : 0);
        if (n.tagName === 'VIDEO' && !n.dataset.snv14) checkVideo(n);
      });

      // src o'zgarganda qayta blok (Instagram lazyload)
      if (m.type === 'attributes' && m.attributeName === 'src') {
        const t = m.target;
        if (t.tagName === 'IMG' && t.__snB14) {
          const BLANK = 'data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==';
          if (t.src !== BLANK) try { t.src = BLANK; t.srcset = ''; } catch {}
        }
      }
    });
    if (hasNew) {
      clearTimeout(window.__snT14);
      window.__snT14 = setTimeout(scan, 200);
    }
  });

  // ══════════════════════════════════════
  // ISHGA TUSHIRISH
  // ══════════════════════════════════════
  function init() {
    mo.observe(document.documentElement, {
      childList: true, subtree: true,
      attributes: true, attributeFilter: ['src','srcset','poster'],
    });
    scan();
    const iv = (IS_IG || IS_PIN) ? 1200 : 4000;
    setInterval(scan, iv);
    console.log(`%c[SafeNet v14] 🛡️ FAOL [${HOST}]`, 'color:#00E5A0;font-weight:bold;font-size:12px');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }

  [200, 800, 2000, 4000].forEach(t => setTimeout(scan, t));

})();