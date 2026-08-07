/**
 * PAROL AVTOTO'LDIRISH — har sahifaga inject qilinadi
 * ===================================================
 *
 * Chrome'dagi kabi ishlaydi:
 *   1. Sahifada parol maydoni bo'lsa — saqlangan parolni avtomatik qo'yadi.
 *   2. Foydalanuvchi login qilsa — "Parolni saqlaysizmi?" so'rovi chiqadi.
 *   3. Rad etilsa — o'sha sayt uchun boshqa so'ralmaydi (sessiya davomida).
 *
 * MUHIM: parol faqat SHU sahifaning o'z origini uchun so'raladi. Origin
 * main process tomonida sahifaning haqiqiy URL'idan olinadi — sahifa uni
 * o'zgartirib boshqa saytning parolini so'ray olmaydi.
 *
 * Parollar bu skriptda HECH QACHON saqlanmaydi — faqat maydonga qo'yiladi.
 */
(function () {
  'use strict';

  if (window.__niexAutofillInstalled) return;
  window.__niexAutofillInstalled = true;

  var API = window.niexPasswords;
  if (!API) return;                       // bridge yo'q — jim chiqamiz
  if (location.protocol !== 'http:' && location.protocol !== 'https:') return;

  var _pending = null;                    // saqlash uchun kutayotgan {username, password}
  var _bannerEl = null;

  // ── Yordamchi: forma ichidan foydalanuvchi nomi maydonini topish ──
  function findUserField(pwField) {
    var form = pwField.form;
    var scope = form || document;
    var candidates = Array.prototype.slice.call(
      scope.querySelectorAll('input[type="text"], input[type="email"], input[name*="user" i], input[name*="login" i], input[id*="user" i], input[id*="email" i]')
    );
    // Parol maydonidan OLDIN turgan eng yaqin maydon
    var best = null;
    for (var i = 0; i < candidates.length; i++) {
      var c = candidates[i];
      if (c.type === 'hidden' || c.disabled) continue;
      if (c.compareDocumentPosition(pwField) & Node.DOCUMENT_POSITION_FOLLOWING) best = c;
    }
    return best || candidates[0] || null;
  }

  function visiblePasswordFields() {
    return Array.prototype.slice.call(document.querySelectorAll('input[type="password"]'))
      .filter(function (el) {
        if (el.disabled || el.readOnly) return false;
        var r = el.getBoundingClientRect();
        return r.width > 0 && r.height > 0;
      });
  }

  function setNativeValue(el, value) {
    // React/Vue kabi freymvorklar `value` setterini kuzatadi — nativ setter
    // orqali qo'yib, keyin event yuboramiz, aks holda holat yangilanmaydi.
    try {
      var proto = Object.getPrototypeOf(el);
      var desc = Object.getOwnPropertyDescriptor(proto, 'value');
      if (desc && desc.set) desc.set.call(el, value);
      else el.value = value;
    } catch (e) { el.value = value; }
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }

  // ── 1. AVTOMATIK TO'LDIRISH ──
  var _filled = false;
  function tryAutofill() {
    if (_filled) return;
    var pwFields = visiblePasswordFields();
    if (!pwFields.length) return;

    API.forOrigin().then(function (creds) {
      if (!creds || !creds.length) return;
      var pw = pwFields[0];
      if (pw.value) return;                       // foydalanuvchi allaqachon yozgan
      var userField = findUserField(pw);

      // Bir nechta hisob bo'lsa — oxirgi ishlatilgani (server tartiblab beradi)
      var cred = creds[0];
      if (userField && userField.value) {
        var match = creds.filter(function (c) { return c.username === userField.value; })[0];
        if (match) cred = match;
      }

      if (userField && !userField.value && cred.username) setNativeValue(userField, cred.username);
      setNativeValue(pw, cred.password);
      _filled = true;
      API.markUsed(cred.id);
    }).catch(function () { /* jim */ });
  }

  // ── 2. SAQLASHNI TAKLIF QILISH ──
  function showSaveBanner(username, password) {
    if (_bannerEl) return;

    var wrap = document.createElement('div');
    wrap.setAttribute('data-niex-pw', '1');
    wrap.style.cssText = [
      'position:fixed', 'top:16px', 'right:16px', 'z-index:2147483647',
      'width:330px', 'padding:16px', 'border-radius:14px',
      'background:#0f1623', 'border:1px solid rgba(0,229,160,.3)',
      'box-shadow:0 18px 50px rgba(0,0,0,.55)',
      'font-family:system-ui,-apple-system,"Segoe UI",sans-serif', 'color:#e8f0fe',
    ].join(';');

    var host = location.host.replace(/^www\./, '');
    wrap.innerHTML =
      '<div style="display:flex;align-items:center;gap:8px;margin-bottom:8px">' +
      '  <span style="font-size:16px">🔐</span>' +
      '  <b style="font-size:13px">Parolni saqlaysizmi?</b>' +
      '</div>' +
      '<div style="font-size:12px;color:#a5b1c8;margin-bottom:4px">' + host + '</div>' +
      '<div style="font-size:12px;color:#7fffcf;margin-bottom:14px;word-break:break-all">' +
        (username ? String(username).replace(/[<>&]/g, '') : '(foydalanuvchi nomisiz)') +
      '</div>' +
      '<div style="display:flex;gap:8px">' +
      '  <button data-act="save" style="flex:1;padding:9px;border:none;border-radius:9px;cursor:pointer;font-weight:700;font-size:12px;background:linear-gradient(135deg,#00e5a0,#00c885);color:#08121c">Saqlash</button>' +
      '  <button data-act="no" style="flex:1;padding:9px;border:1px solid #2d3f5e;border-radius:9px;cursor:pointer;font-size:12px;background:#1a2235;color:#e8f0fe">Yo\'q</button>' +
      '</div>' +
      '<button data-act="never" style="width:100%;margin-top:8px;padding:6px;border:none;background:transparent;color:#6b8a80;font-size:11px;cursor:pointer">Bu sayt uchun boshqa so\'ralmasin</button>';

    document.documentElement.appendChild(wrap);
    _bannerEl = wrap;

    var close = function () {
      if (_bannerEl && _bannerEl.parentNode) _bannerEl.parentNode.removeChild(_bannerEl);
      _bannerEl = null;
      _pending = null;
    };

    wrap.addEventListener('click', function (e) {
      var act = e.target && e.target.getAttribute && e.target.getAttribute('data-act');
      if (!act) return;
      if (act === 'save') {
        API.save({ username: username, password: password }).then(function (r) {
          if (r && !r.ok) console.warn('[niex-pw]', r.error);
        }).catch(function () {});
      } else if (act === 'never') {
        API.neverAsk();
      }
      close();
    });

    setTimeout(function () { if (_bannerEl === wrap) close(); }, 25000);
  }

  function capture() {
    var pwFields = visiblePasswordFields();
    if (!pwFields.length) return;
    var pw = pwFields[0];
    var pass = pw.value;
    if (!pass || pass.length < 3) return;

    var userField = findUserField(pw);
    var user = userField ? userField.value : '';
    _pending = { username: user, password: pass };
  }

  // Login yuborilishini turli yo'llar bilan ushlaymiz (SPA'lar formani
  // submit qilmasligi mumkin — shuning uchun tugma bosilishi ham kuzatiladi).
  document.addEventListener('submit', function () {
    capture();
    setTimeout(offerIfPending, 400);
  }, true);

  document.addEventListener('click', function (e) {
    var t = e.target;
    if (!t || !t.closest) return;
    var btn = t.closest('button, input[type="submit"], [role="button"]');
    if (!btn) return;
    capture();
    setTimeout(offerIfPending, 900);
  }, true);

  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Enter') return;
    if (e.target && e.target.type === 'password') {
      capture();
      setTimeout(offerIfPending, 900);
    }
  }, true);

  function offerIfPending() {
    if (!_pending) return;
    var p = _pending;
    API.isNeverAsk().then(function (skip) {
      if (skip) { _pending = null; return; }
      return API.forOrigin().then(function (creds) {
        var same = (creds || []).some(function (c) {
          return c.username === p.username && c.password === p.password;
        });
        if (same) { _pending = null; return; }     // allaqachon saqlangan
        showSaveBanner(p.username, p.password);
      });
    }).catch(function () { _pending = null; });
  }

  // ── Ishga tushirish ──
  function boot() {
    tryAutofill();
    // SPA'larda forma keyinroq paydo bo'ladi — DOM o'zgarishini kuzatamiz
    var mo = new MutationObserver(function () { tryAutofill(); });
    try { mo.observe(document.documentElement, { childList: true, subtree: true }); } catch (e) {}
    setTimeout(function () { try { mo.disconnect(); } catch (e) {} }, 20000);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot, { once: true });
  } else {
    boot();
  }
})();
