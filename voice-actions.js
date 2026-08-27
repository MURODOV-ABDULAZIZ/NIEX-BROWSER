/**
 * NIEX Voice Agent — In-page Action Performer (Prompt 4).
 * =======================================================
 *
 * scroll/play/pause/next_video/previous_video amallarini SAHIFA ichida bajaradi.
 * main.js buni active tab'ga `executeJavaScript` orqali chaqiradi (engine
 * nazoratida). MUHIM: bu JS'ni QWEN BERMAYDI — u NIEX kodida qat'iy belgilangan.
 * Faqat schema action'lari; ixtiyoriy kod yo'q.
 *
 * Qo'llab-quvvatlamasa — {ok:false, status:'unsupported'} (soxta muvaffaqiyat YO'Q).
 *
 * main.js ishlatishi:
 *   const js = '(' + VOICE_ACTION_FN + ')(' + JSON.stringify(action) + ')';
 *   await webContents.executeJavaScript(js);
 */
'use strict';

// Sahifada ishga tushadigan sof funksiya (string sifatida inject qilinadi).
const VOICE_ACTION_FN = function (action) {
  try {
    var t = action && action.type;
    var host = location.hostname || '';
    var isYT = /(^|\.)youtube\.com$/.test(host) || host === 'youtu.be';
    var video = document.querySelector('video');

    if (t === 'scroll') {
      var amt = Math.max(0, Math.min(5000, Number(action.amount) || 600));
      var dx = action.direction === 'right' ? amt : (action.direction === 'left' ? -amt : 0);
      var dy = action.direction === 'down' ? amt : (action.direction === 'up' ? -amt : 0);
      try { window.scrollBy({ top: dy, left: dx, behavior: 'smooth' }); } catch (e) { window.scrollBy(dx, dy); }
      return { ok: true };
    }

    if (t === 'play') {
      if (video) { try { var p = video.play(); if (p && p.catch) p.catch(function () {}); } catch (e) {} return { ok: true }; }
      if (isYT) { var pb = document.querySelector('.ytp-play-button'); if (pb) { pb.click(); return { ok: true }; } }
      return { ok: false, status: 'unsupported' };
    }

    if (t === 'pause') {
      if (video) { try { video.pause(); } catch (e) {} return { ok: true }; }
      if (isYT) { var pb2 = document.querySelector('.ytp-play-button'); if (pb2) { pb2.click(); return { ok: true }; } }
      return { ok: false, status: 'unsupported' };
    }

    if (t === 'next_video') {
      if (isYT) {
        // aria-disabled: null/"false" → YOQILGAN; faqat "true" → o'chiq. Ilgari `!getAttribute`
        //   ishlatilardi: "false" bo'sh-bo'lmagan string → !"false"===false → tugma HAR DOIM
        //   bosilmasди ("Next video → unsupported"). Endi to'g'ri taqqoslaymiz.
        var nb = document.querySelector('.ytp-next-button');
        if (nb && nb.getAttribute('aria-disabled') !== 'true') { nb.click(); return { ok: true }; }
        // Fallback: YouTube klaviatura yorlig'i Shift+N (keyingi video/mix).
        try { (document.querySelector('video') || document.body).dispatchEvent(new KeyboardEvent('keydown', { key: 'N', code: 'KeyN', keyCode: 78, shiftKey: true, bubbles: true })); return { ok: true }; } catch (e) {}
      }
      return { ok: false, status: 'unsupported' };
    }

    if (t === 'previous_video') {
      if (isYT) {
        var pv = document.querySelector('.ytp-prev-button');
        if (pv && pv.getAttribute('aria-disabled') !== 'true') { pv.click(); return { ok: true }; }
        // Fallback: Shift+P (oldingi video).
        try { (document.querySelector('video') || document.body).dispatchEvent(new KeyboardEvent('keydown', { key: 'P', code: 'KeyP', keyCode: 80, shiftKey: true, bubbles: true })); return { ok: true }; } catch (e) {}
      }
      return { ok: false, status: 'unsupported' };
    }

    if (t === 'type_text') {
      // Xavfsizlik: FAQAT input/textarea/contenteditable, target'ga qarab modular.
      //   target='search'   → search input (site-aware: YT, Google, generic).
      //   target='textarea' → aktiv textarea yoki eng ko'rinuvchi textarea.
      //   target='input'    → aktiv text input yoki eng ko'rinuvchi.
      //   target yo'q       → aktiv fokusdagi element (agar mos bo'lsa).
      var q = String(action.query || '');
      if (!q) return { ok: false, status: 'error', message: 'empty' };
      function visible(el) {
        try {
          if (!el || el.disabled || el.readOnly) return false;
          var r = el.getBoundingClientRect();
          if (r.width < 8 || r.height < 8) return false;
          var st = getComputedStyle(el);
          return st && st.visibility !== 'hidden' && st.display !== 'none';
        } catch (e) { return false; }
      }
      function isTypable(el) {
        if (!el) return false;
        var tag = (el.tagName || '').toLowerCase();
        if (tag === 'textarea') return true;
        if (tag === 'input') {
          var type = (el.getAttribute('type') || 'text').toLowerCase();
          return type === 'text' || type === 'search' || type === '';
        }
        if (el.isContentEditable) return true;
        return false;
      }
      function pickBySelectors(sels) {
        for (var i = 0; i < sels.length; i++) {
          var list = document.querySelectorAll(sels[i]);
          for (var j = 0; j < list.length; j++) if (visible(list[j]) && isTypable(list[j])) return list[j];
        }
        return null;
      }
      var el = null;
      var target = String(action.target || '').toLowerCase();
      // 1) Aniq fokusdagi element mos bo'lsa — ustuvor (aktiv element).
      var af = document.activeElement;
      if (af && isTypable(af) && visible(af)) el = af;

      if (!el) {
        if (target === 'search' || (!target && (isYT || /(^|\.)google\.com$/.test(host)))) {
          el = pickBySelectors([
            'input#search', 'input[name=search_query]',                  // YouTube
            'textarea[name=q]', 'input[name=q]',                          // Google
            'input[type=search]', '[role=combobox][contenteditable=true]',
            'input[aria-label*="qidiruv" i]', 'input[aria-label*="search" i]',
            'input[placeholder*="qidiruv" i]', 'input[placeholder*="search" i]',
          ]);
        } else if (target === 'textarea') {
          el = pickBySelectors(['textarea']);
        } else if (target === 'input') {
          el = pickBySelectors(['input[type=text]', 'input:not([type])']);
        } else {
          // Umumiy fallback: search → textarea → text input.
          el = pickBySelectors([
            'input[type=search]', 'textarea', 'input[type=text]', 'input:not([type])',
            '[contenteditable=true]',
          ]);
        }
      }
      if (!el) return { ok: false, status: 'needs_clarification', message: 'Qaysi maydonga yozay?' };
      try {
        el.focus();
        if (el.isContentEditable) {
          el.textContent = q;
          el.dispatchEvent(new Event('input', { bubbles: true }));
        } else {
          // React/framework-safe: native setter orqali.
          var proto = el.tagName.toLowerCase() === 'textarea' ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype;
          var setter = Object.getOwnPropertyDescriptor(proto, 'value') && Object.getOwnPropertyDescriptor(proto, 'value').set;
          if (setter) setter.call(el, q); else el.value = q;
          el.dispatchEvent(new Event('input', { bubbles: true }));
          el.dispatchEvent(new Event('change', { bubbles: true }));
        }
        // submit:true → qidiruvni ISHGA TUSHIRISH (Enter). Sayt-maxsus tugma → klaviatura → form.
        if (action.submit === true) {
          var done = false;
          if (isYT) {
            var yb = document.querySelector('#search-icon-legacy, button#search-icon-legacy, ytd-searchbox #search-icon-legacy');
            if (yb) { try { yb.click(); done = true; } catch (e) {} }
          }
          if (!done) {
            var kopts = { bubbles: true, cancelable: true, key: 'Enter', code: 'Enter', keyCode: 13, which: 13 };
            var kd = new KeyboardEvent('keydown', kopts);
            el.dispatchEvent(kd);
            el.dispatchEvent(new KeyboardEvent('keypress', kopts));
            el.dispatchEvent(new KeyboardEvent('keyup', kopts));
            // Klaviatura hodisasini sayt to'smasa — form.requestSubmit bilan yakuniy urinish.
            if (!kd.defaultPrevented) {
              try {
                var form = el.form || (el.closest && el.closest('form'));
                if (form) { if (typeof form.requestSubmit === 'function') form.requestSubmit(); else form.submit(); }
              } catch (e) {}
            }
          }
        }
        return { ok: true };
      } catch (e) { return { ok: false, status: 'error', message: String(e && e.message || e) }; }
    }

    if (t === 'click') {
      // Juda ehtiyotkor: aniq target (aria-label/text). Ko'p mos → needs_clarification.
      var tgt = String(action.target || '').trim().toLowerCase();
      if (!tgt) return { ok: false, status: 'error', message: 'empty-target' };
      // Xavfsizlik: HTML/JS belgilari yo'q (validator ham RAD qiladi, lekin ikkinchi qatlam).
      if (/[<>{}();`\\]/.test(tgt)) return { ok: false, status: 'error', message: 'unsafe' };

      function textOf(el) {
        try {
          var s = (el.getAttribute && (el.getAttribute('aria-label') || el.getAttribute('title'))) || '';
          if (!s) s = (el.innerText || el.textContent || '').trim();
          return String(s).toLowerCase().replace(/\s+/g, ' ').trim().slice(0, 120);
        } catch (e) { return ''; }
      }
      function clickable(el) {
        try {
          if (!el || !visibleC(el)) return false;
          var tag = (el.tagName || '').toLowerCase();
          if (['button', 'a'].indexOf(tag) !== -1) return true;
          if (tag === 'input') { var ty = (el.getAttribute('type') || '').toLowerCase(); return ['button', 'submit', 'reset'].indexOf(ty) !== -1; }
          var role = (el.getAttribute && el.getAttribute('role') || '').toLowerCase();
          if (['button', 'link', 'menuitem', 'option', 'tab'].indexOf(role) !== -1) return true;
          if (el.getAttribute && el.getAttribute('onclick')) return true;
          return false;
        } catch (e) { return false; }
      }
      function visibleC(el) {
        try {
          if (!el || el.disabled) return false;
          var r = el.getBoundingClientRect();
          if (r.width < 4 || r.height < 4) return false;
          var st = getComputedStyle(el);
          return st && st.visibility !== 'hidden' && st.display !== 'none' && st.pointerEvents !== 'none';
        } catch (e) { return false; }
      }
      var candidates = [];
      var all = document.querySelectorAll('button, a, [role=button], [role=link], [role=menuitem], [role=option], [role=tab], input[type=button], input[type=submit]');
      for (var i = 0; i < all.length; i++) {
        var el2 = all[i];
        if (!clickable(el2)) continue;
        var txt = textOf(el2);
        if (!txt) continue;
        // Aniq matching: to'liq teng > so'z chegarasi bilan mos > substring.
        var score = 0;
        if (txt === tgt) score = 3;
        else if (new RegExp('(^|\\s)' + tgt.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '($|\\s)').test(txt)) score = 2;
        else if (txt.indexOf(tgt) !== -1) score = 1;
        if (score > 0) candidates.push({ el: el2, score: score, txt: txt });
      }
      if (!candidates.length) return { ok: false, status: 'needs_clarification', message: 'Bunday tugma topilmadi.' };
      // Eng yuqori score'ni tanlaymiz; agar birinchi 2 nomzod bir xil score bo'lsa — ambigu.
      candidates.sort(function (a, b) { return b.score - a.score; });
      if (candidates.length >= 2 && candidates[0].score === candidates[1].score) {
        return { ok: false, status: 'needs_clarification', message: 'Bir nechta mos element bor. Aniqroq ayting.' };
      }
      try { candidates[0].el.click(); return { ok: true }; }
      catch (e) { return { ok: false, status: 'error', message: String(e && e.message || e) }; }
    }

    if (t === 'open_result') {
      // "birinchi videoni qoy" — N-natijani ochadi. YouTube video linklari > Google natija
      //   sarlavhalari > asosiy kontent havolalari. Reklama/navigatsiya havolalari o'tkaziladi.
      var idx = parseInt(action.index, 10); if (!(idx >= 1)) idx = 1; if (idx > 30) idx = 30;
      function visO(el) {
        try { var r = el.getBoundingClientRect(); if (r.width < 8 || r.height < 8) return false;
          var st = getComputedStyle(el); return st && st.visibility !== 'hidden' && st.display !== 'none'; }
        catch (e) { return false; }
      }
      var picks = [], seenO = {};
      function pushO(a) {
        if (!a) return; var href = a.href || ''; if (!href || seenO[href]) return; if (!visO(a)) return;
        seenO[href] = 1; picks.push(a);
      }
      if (isYT) {
        var ysel = ['ytd-rich-item-renderer a#video-title-link', 'a#video-title-link',
          'ytd-video-renderer a#video-title', 'a#video-title',
          'ytd-compact-video-renderer a#video-title', 'ytd-rich-grid-media a#video-title-link',
          'ytd-grid-video-renderer a#video-title'];
        for (var s = 0; s < ysel.length; s++) { var ls = document.querySelectorAll(ysel[s]); for (var i = 0; i < ls.length; i++) pushO(ls[i]); }
      }
      if (!picks.length && /(^|\.)google\./.test(host)) {
        var hs = document.querySelectorAll('#rso h3, #search h3');
        for (var h = 0; h < hs.length; h++) { var ah = hs[h].closest ? hs[h].closest('a') : null; if (ah) pushO(ah); }
      }
      if (!picks.length) {
        // Generik: asosiy kontent (main/article/[role=main]) ichidagi mazmunli havolalar.
        var rootO = document.querySelector('main, [role=main], article') || document.body;
        var asO = rootO.querySelectorAll('a[href]');
        for (var k = 0; k < asO.length && picks.length < idx + 6; k++) {
          var ax = asO[k]; var hx = ax.getAttribute('href') || '';
          if (!/^https?:/.test(hx) && hx.indexOf('/') !== 0) continue;   // ichki anchor/js: — o'tkazamiz
          var tx = (ax.innerText || ax.textContent || '').trim();
          if (tx.length < 8) continue;                                    // ikonka/nav — o'tkazamiz
          pushO(ax);
        }
      }
      if (!picks.length) return { ok: false, status: 'needs_clarification', message: 'Ochish uchun natija topilmadi.' };
      if (idx > picks.length) idx = picks.length;
      var targetO = picks[idx - 1];
      try { targetO.scrollIntoView({ block: 'center' }); targetO.click(); return { ok: true, data: { index: idx, href: targetO.href } }; }
      catch (e) { return { ok: false, status: 'error', message: String(e && e.message || e) }; }
    }

    if (t === 'set_volume') {
      // "louder 5" (delta +50) / "lower 3" (delta -30) / absolute level. Video/audio ovozini o'zgartiradi.
      var media = video;
      if (!media) { var mm = document.querySelectorAll('video, audio'); for (var i = 0; i < mm.length; i++) { if (mm[i]) { media = mm[i]; break; } } }
      if (!media) return { ok: false, status: 'unsupported' };
      var cur = Math.round((typeof media.volume === 'number' ? media.volume : 1) * 100);
      var tv;
      if (action.level != null) tv = Number(action.level);
      else tv = cur + Number(action.delta || 0);
      if (!isFinite(tv)) tv = cur;
      tv = Math.max(0, Math.min(100, Math.round(tv)));
      try {
        media.muted = tv === 0;                  // 0 → mute; aks holda unmute
        media.volume = tv / 100;
        media.dispatchEvent(new Event('volumechange', { bubbles: true }));
        return { ok: true, data: { volume: tv, was: cur } };
      } catch (e) { return { ok: false, status: 'error', message: String(e && e.message || e) }; }
    }

    return { ok: false, status: 'unsupported' };
  } catch (e) {
    return { ok: false, status: 'error', message: String((e && e.message) || e) };
  }
}.toString();

module.exports = { VOICE_ACTION_FN };
