/**
 * NIEX — Phishing Content Scanner (content script).
 * =================================================
 *
 * Spec "redirect blocker" PART 3 — LIST-FREE phishing aniqlash: quruq domen
 * ro'yxatiga ishonmasdan, SAHIFANING O'ZINI tahlil qiladi.
 *
 * Vazifa: sahifada credential/to'lov formasi bormi — aniqlab, minimal signallarni
 * main'ga yuboradi. Qaror (brand-impersonation, cross-origin exfil, shubhali domen)
 * main tomonda nav-guard.analyzePage() da chiqariladi.
 *
 * MUHIM (FP himoya): credential formasi BO'LMASA umuman hisobot yubormaydi —
 * 99% oddiy sahifa tegilmaydi. Haqiqiy loginlar (facebook.com...) main'da
 * allowlist bilan himoyalangan.
 *
 * Xavfsizlik: idempotent, DOM faqat o'qiladi, sekund/2 marta skan.
 */
(function () {
  'use strict';
  if (window.__niexPhishingScan) return;
  // Bridge: desktop (safenet_phishing) yoki mobil (flutter_inappwebview handler).
  var bridge = window.safenet_phishing;
  if ((!bridge || typeof bridge.report !== 'function') && window.flutter_inappwebview) {
    bridge = { report: function (sig) { try { window.flutter_inappwebview.callHandler('niexPhishing', sig); } catch (e) {} } };
  }
  if (!bridge || typeof bridge.report !== 'function') return;
  if (!/^https?:$/.test(location.protocol)) return; // faqat http(s)
  window.__niexPhishingScan = true;

  function textOf(el) {
    try {
      return [el.name, el.id, el.placeholder, el.getAttribute('autocomplete'), el.getAttribute('aria-label')]
        .filter(Boolean).join(' ').toLowerCase();
    } catch (e) { return ''; }
  }

  function detectKind(el) {
    var t = textOf(el);
    var ty = (el.type || '').toLowerCase();
    if (ty === 'password') return 'password';
    if (/\bcvv\b|\bcvc\b|\bccv\b|cvn|cc-csc|security.?code/.test(t)) return 'cvv';
    if (/card.?num|cardnumber|cc-number|\bpan\b|credit.?card/.test(t)) return 'card';
    if (/\biban\b/.test(t)) return 'iban';
    if (/\bssn\b|social.?security/.test(t)) return 'ssn';
    if (/\botp\b|one.?time|verification.?code/.test(t)) return 'otp';
    if (/\bpin\b/.test(t) && ty !== 'search') return 'pin';
    return null;
  }

  function scan() {
    try {
      var inputs = document.querySelectorAll('input');
      var kinds = {};
      var hasPassword = false;
      for (var i = 0; i < inputs.length; i++) {
        var k = detectKind(inputs[i]);
        if (k) { kinds[k] = true; if (k === 'password') hasPassword = true; }
      }
      var kindList = Object.keys(kinds);
      // GATE: credential/to'lov formasi yo'q — hisobot YUBORILMAYDI.
      if (!hasPassword && kindList.length === 0) return;

      // Credential formalarining action hostlari (cross-origin exfil aniqlash).
      var actionHosts = {};
      var forms = document.querySelectorAll('form');
      for (var f = 0; f < forms.length; f++) {
        var hasCred = forms[f].querySelector('input[type=password]') ||
          Array.prototype.some.call(forms[f].querySelectorAll('input'), function (x) { return !!detectKind(x); });
        if (!hasCred) continue;
        var action = forms[f].getAttribute('action') || '';
        if (!action) continue;
        try {
          var u = new URL(action, location.href);
          if (/^https?:$/.test(u.protocol)) actionHosts[u.hostname.replace(/^www\./, '')] = true;
        } catch (e) {}
      }

      bridge.report({
        url: location.href.slice(0, 500),
        title: (document.title || '').slice(0, 200),
        hasPassword: hasPassword,
        sensitiveKinds: kindList,
        formActionHosts: Object.keys(actionHosts),
      });
    } catch (e) {}
  }

  // Yuklanganda + kech render bo'ladigan formalar uchun 2s dan keyin qayta.
  scan();
  setTimeout(scan, 2200);
  // SPA route o'zgarishi (login modal ochilishi) — bir marta qo'shimcha skan.
  try {
    var lastHref = location.href;
    var mo = new MutationObserver(function () {
      if (location.href !== lastHref) { lastHref = location.href; setTimeout(scan, 800); }
    });
    mo.observe(document.documentElement, { childList: true, subtree: true });
  } catch (e) {}
})();
