/**
 * NIEX Voice Agent — Action Validator (Prompt 3/4).
 * =================================================
 *
 * LLM (Qwen) HECH QACHON ko'r-ko'rona ishonilmaydi. Har action shu validatordan
 * o'tadi: allowlist turlari, to'g'ri parametrlar, URL protokoli, limitlar.
 *
 * RAD etadi: execute_javascript, eval, shell, command, filesystem, process,
 * ixtiyoriy kod, noma'lum action turlari, buzuq parametrlar, xavfli protokollar.
 *
 * Sof modul (Node + brauzer). Bu — voice va navigatsiya o'rtasidagi darvoza;
 * ACTUAL navigatsiya keyin NIEX Security (nav-guard) dan ham o'tadi (ikki qatlam).
 */
(function (root, factory) {
  const schema = (typeof require === 'function') ? require('./action-schema') : root.NIEXVoiceSchema;
  const api = factory(schema);
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.NIEXVoiceValidator = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function (S) {
  'use strict';

  // Aniq XAVFLI action nomlari — hech qachon bajarilmaydi (LLM kiritsa ham).
  const FORBIDDEN = new Set([
    'execute_javascript', 'javascript', 'eval', 'exec', 'shell', 'command', 'cmd',
    'run', 'spawn', 'process', 'filesystem', 'fs', 'read_file', 'write_file',
    'download', 'require', 'import', 'ipc', 'electron', 'webcontents', 'fetch',
  ]);

  const DANGEROUS_URL_RX = /^\s*(javascript|data|vbscript|file|blob|about|chrome|devtools):/i;

  function normDir(d) {
    d = String(d || '').toLowerCase().trim();
    const map = { down: 'down', up: 'up', left: 'left', right: 'right', pastga: 'down', tepaga: 'up', past: 'down', tepa: 'up' };
    return map[d] || (S.SCROLL_DIRECTIONS.includes(d) ? d : null);
  }

  function validUrl(raw) {
    let u = String(raw || '').trim();
    if (!u) return null;
    if (u.length > S.LIMITS.MAX_URL) return null;
    if (DANGEROUS_URL_RX.test(u)) return null;                 // xavfli protokol — RAD
    if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(u)) {
      // protokolsiz — faqat http(s) qo'shamiz (boshqa sxema emas)
      if (!/^[\w.-]+\.[a-z]{2,}(\/|$|:)/i.test(u)) return null; // domenga o'xshamasa RAD
      u = 'https://' + u;
    }
    try {
      const p = new URL(u);
      if (p.protocol !== 'http:' && p.protocol !== 'https:') return null;
      return p.href;
    } catch { return null; }
  }

  /** Bitta action'ni tekshiradi va tozalaydi. @returns {ok, action?, reason?} */
  function validateOne(a) {
    if (!a || typeof a !== 'object' || Array.isArray(a)) return { ok: false, reason: 'not-object' };
    const type = String(a.type || '').toLowerCase().trim();
    if (!type) return { ok: false, reason: 'no-type' };
    if (FORBIDDEN.has(type)) return { ok: false, reason: 'forbidden:' + type };
    const def = S.ACTIONS[type];
    if (!def) return { ok: false, reason: 'unknown-type:' + type };

    // Har action ichida 'code'/'script'/'js' bo'lsa — RAD (arbitrary code inyeksiya).
    for (const k of ['code', 'script', 'js', 'command', 'eval', 'exec']) {
      if (k in a) return { ok: false, reason: 'contains-code-field:' + k };
    }

    const out = { type };
    switch (type) {
      case 'open_site': {
        const url = validUrl(a.url);
        if (!url) return { ok: false, reason: 'bad-url' };
        out.url = url;
        break;
      }
      case 'new_tab': {
        if (a.url != null && String(a.url).trim() !== '') {
          const url = validUrl(a.url);
          if (!url) return { ok: false, reason: 'bad-url' };
          out.url = url;
        }
        break;
      }
      case 'search': {
        const q = String(a.query || '').trim().slice(0, S.LIMITS.MAX_QUERY);
        if (!q) return { ok: false, reason: 'empty-query' };
        out.query = q;
        if (a.engine) out.engine = String(a.engine).toLowerCase().slice(0, 20);
        break;
      }
      case 'scroll': {
        const dir = normDir(a.direction);
        if (!dir) return { ok: false, reason: 'bad-direction' };
        out.direction = dir;
        let amt = Math.floor(Number(a.amount));
        if (!Number.isFinite(amt) || amt <= 0) amt = S.LIMITS.SCROLL_DEFAULT;
        out.amount = Math.min(amt, S.LIMITS.MAX_SCROLL);
        break;
      }
      case 'type_text': {
        const q = String(a.query || '').trim().slice(0, S.LIMITS.MAX_QUERY);
        if (!q) return { ok: false, reason: 'empty-query' };
        out.query = q;
        if (a.target != null && String(a.target).trim()) {
          // target — DOM belgisi (search|textarea|input) yoki oddiy label. Alfa+bo'sh joy+"-_".
          const t = String(a.target).trim().slice(0, 60).toLowerCase().replace(/[^a-z0-9 _\-]/g, '');
          if (t) out.target = t;
        }
        if (a.submit === true) out.submit = true;
        break;
      }
      case 'open_result': {
        let idx = Math.floor(Number(a.index));
        if (!Number.isFinite(idx) || idx < 1) idx = 1;
        out.index = Math.min(idx, 30); // 1..30 oralig'i (himoya)
        break;
      }
      case 'set_volume': {
        let has = false;
        if (a.level != null) { const lv = Math.floor(Number(a.level)); if (Number.isFinite(lv)) { out.level = Math.max(0, Math.min(100, lv)); has = true; } }
        if (a.delta != null) { const dv = Math.floor(Number(a.delta)); if (Number.isFinite(dv)) { out.delta = Math.max(-100, Math.min(100, dv)); has = true; } }
        if (!has) return { ok: false, reason: 'no-volume-arg' };
        break;
      }
      case 'click': {
        const t = String(a.target || '').trim().slice(0, 80);
        // Faqat inson-o'qiy label/aria/text. HTML/JS/qavs/tirnoq — RAD.
        if (!t) return { ok: false, reason: 'empty-target' };
        if (/[<>{}();`\\]/.test(t)) return { ok: false, reason: 'unsafe-target' };
        out.target = t;
        break;
      }
      // Parametrsiz actionlar
      case 'play': case 'pause': case 'next_video': case 'previous_video':
      case 'close_tab': case 'go_back': case 'go_forward': case 'reload':
        break;
    }
    return { ok: true, action: out };
  }

  /**
   * LLM/local natijasini tekshiradi.
   * @param {object} result  { actions:[...], status?, message? } yoki [...] yoki {type}
   * @returns {{ ok, actions:[], rejected:[], status, message? }}
   */
  function validate(result) {
    let raw = result;
    let status = null, message = null;
    if (raw && !Array.isArray(raw) && typeof raw === 'object' && !raw.type) {
      status = raw.status || null;
      message = raw.message || null;
      raw = raw.actions;
    }
    if (raw && !Array.isArray(raw) && typeof raw === 'object' && raw.type) raw = [raw];
    if (!Array.isArray(raw)) {
      // Action yo'q — status bo'lsa uni qaytaramiz (needs_clarification/unsupported)
      if (status && status !== S.STATUS.OK) return { ok: true, actions: [], rejected: [], status, message };
      return { ok: false, actions: [], rejected: [], status: S.STATUS.ERROR, message: 'no-actions' };
    }
    if (raw.length === 0) {
      return { ok: true, actions: [], rejected: [], status: status || S.STATUS.NEEDS_CLARIFICATION, message };
    }
    if (raw.length > S.LIMITS.MAX_ACTIONS) raw = raw.slice(0, S.LIMITS.MAX_ACTIONS);

    const actions = [], rejected = [];
    for (const a of raw) {
      const v = validateOne(a);
      if (v.ok) actions.push(v.action);
      else rejected.push({ input: a && a.type, reason: v.reason });
    }
    // Bironta ham xavfli/noma'lum action bo'lsa — butun natija RAD (xavfsizlik: yarim bajarmaymiz).
    if (rejected.length) return { ok: false, actions: [], rejected, status: S.STATUS.ERROR, message: 'invalid-action' };
    if (!actions.length) return { ok: false, actions: [], rejected: [], status: S.STATUS.ERROR, message: 'no-valid-actions' };
    return { ok: true, actions, rejected: [], status: S.STATUS.OK, message };
  }

  return { validate, validateOne, validUrl, normDir, FORBIDDEN };
}));
