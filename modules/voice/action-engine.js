/**
 * NIEX Voice Agent — Browser Action Engine (Prompt 4).
 * ====================================================
 *
 * Validatsiyalangan BrowserAction[] ni bajaradi. HAR navigatsiya NIEX xavfsizlik
 * qatlamidan (nav-guard) o'tadi — voice HECH QACHON xavfsizlikni chetlab o'tmaydi.
 *
 * SOF/testlanadigan: bajaruvchilar (executors), checkNav va afterNav inject
 * qilinadi. main.js real bajaruvchilarni (mavjud IPC/webContents) beradi. Qwen
 * bermaydi hech qanday JS — media/scroll ham engine ichidagi nazoratli JS orqali.
 *
 * Xatoda TO'XTAYDI (spec PART 12): open_site bloklansa keyingi search/play
 * ko'r-ko'rona davom etmaydi.
 */
(function (root, factory) {
  const isNode = (typeof require === 'function' && typeof module !== 'undefined');
  const S = isNode ? require('./action-schema') : root.NIEXVoiceSchema;
  const api = factory(S);
  if (isNode) module.exports = api;
  else root.NIEXVoiceActionEngine = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function (S) {
  'use strict';

  const NAV_TYPES = new Set(['open_site', 'search', 'new_tab']);

  /**
   * @param {{ executors, checkNav?, afterNav?, now? }} config
   *   executors: { open_site(url), search(query,engine), scroll(dir,amount), new_tab(url?),
   *                play(), pause(), next_video(), previous_video(), close_tab(),
   *                go_back(), go_forward(), reload() }  — har biri async, {ok} qaytaradi yoki throw.
   *   checkNav(url, source) → { allow, reason?, category? }  (nav-guard wrapper)
   *   afterNav(type) → Promise  (navigatsiyadan keyin sahifa tayyor bo'lishini kutish)
   */
  function createActionEngine(config = {}) {
    const executors = config.executors || {};
    const checkNav = typeof config.checkNav === 'function' ? config.checkNav : () => ({ allow: true });
    const afterNav = typeof config.afterNav === 'function' ? config.afterNav : async () => {};

    // Navigatsiya manzilini action'dan chiqaradi (xavfsizlik tekshiruvi uchun).
    function navUrl(a) {
      if (a.type === 'open_site') return a.url;
      if (a.type === 'new_tab') return a.url || null;
      if (a.type === 'search') return S.searchUrl(a.query, a.engine);
      return null;
    }

    async function runOne(a, source) {
      // 1) Navigatsiya → NIEX xavfsizlik (nav-guard). Bloklansa — bajarmaymiz.
      if (NAV_TYPES.has(a.type)) {
        const url = navUrl(a);
        if (url) {
          const d = checkNav(url, source);
          if (d && d.allow === false) {
            return { type: a.type, success: false, status: S.STATUS.BLOCKED, reason: d.reason || 'security_policy', category: d.category };
          }
        }
      }
      // 2) Bajaruvchi bormi?
      const fn = executors[a.type];
      if (typeof fn !== 'function') {
        return { type: a.type, success: false, status: S.STATUS.UNSUPPORTED, message: 'Bu amal hozircha qo\'llab-quvvatlanmaydi.' };
      }
      // 3) Bajaramiz.
      try {
        let res;
        if (a.type === 'open_site' || a.type === 'new_tab') res = await fn(navUrl(a));
        else if (a.type === 'search') res = await fn(a.query, a.engine);
        else if (a.type === 'scroll') res = await fn(a.direction, a.amount);
        else if (a.type === 'type_text') res = await fn(a.query, a.target, a.submit === true);
        else if (a.type === 'click') res = await fn(a.target);
        else if (a.type === 'open_result') res = await fn(a.index);
        else if (a.type === 'set_volume') res = await fn(a.delta, a.level);
        else res = await fn();
        if (res && res.ok === false) {
          return { type: a.type, success: false, status: res.status || S.STATUS.ERROR, message: res.message || 'bajarilmadi' };
        }
        // Navigatsiyadan keyin sahifa tayyor bo'lishini kutamiz (keyingi action uchun).
        if (NAV_TYPES.has(a.type)) { try { await afterNav(a.type); } catch (_) {} }
        return { type: a.type, success: true, status: S.STATUS.OK, data: res && res.data };
      } catch (e) {
        return { type: a.type, success: false, status: S.STATUS.ERROR, message: (e && e.message) || 'exception' };
      }
    }

    return {
      /**
       * @param {Array} actions  validatsiyalangan action'lar
       * @param {{source?, signal?}} opts  source: 'user'(voice) — nav-guard yumshoq; signal: bekor qilish
       */
      async run(actions, opts = {}) {
        const source = opts.source || 'user';
        const signal = opts.signal; // { cancelled:boolean }
        const list = Array.isArray(actions) ? actions : [];
        const results = [];
        if (!list.length) return { success: false, status: S.STATUS.ERROR, completedActions: 0, results, message: 'no-actions' };

        for (let i = 0; i < list.length; i++) {
          if (signal && signal.cancelled) {
            return { success: false, status: 'cancelled', completedActions: results.filter(r => r.success).length, results };
          }
          const r = await runOne(list[i], source);
          results.push(r);
          if (!r.success) {
            // Xatoda TO'XTAYMIZ — keyingi bog'liq action'lar bajarilmaydi.
            return {
              success: false,
              status: r.status || S.STATUS.ERROR,
              completedActions: results.filter(x => x.success).length,
              failedAction: { type: r.type },
              reason: r.reason,
              message: r.message,
              results,
            };
          }
        }
        return { success: true, status: S.STATUS.OK, completedActions: results.length, results };
      },
    };
  }

  return { createActionEngine, NAV_TYPES };
}));
