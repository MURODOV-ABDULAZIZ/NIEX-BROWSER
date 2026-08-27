/**
 * NIEX Voice Agent — Command LLM Provider (Qwen), Prompt 3.
 * ========================================================
 *
 * Tabiiy tildan STRUKTURALANGAN action'ga o'giradi. LLM qatlami ALMASHTIRILADIGAN:
 *   - 'mock'     — Qwen server hali yo'q: deterministik mini-interpreter (test + dev).
 *   - 'endpoint' — NIEX AI endpoint/Qwen server (kelajakda o'z serverimizda).
 *
 * MUHIM: LLM faqat schema action'ini so'raydi — ixtiyoriy kod/JS EMAS. Natija
 * ActionValidator'dan o'tadi. Bu modul action BAJARMAYDI (faqat interpretatsiya).
 *
 * Sof modul (Node + brauzer). `request` (endpoint chaqiruvi) inject qilinadi.
 */
(function (root, factory) {
  const schema = (typeof require === 'function') ? require('./action-schema') : root.NIEXVoiceSchema;
  const api = factory(schema);
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.NIEXVoiceQwen = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function (S) {
  'use strict';

  // Qwen system prompt (spec Prompt 3 PART 14). Sir/kalit YO'Q.
  const SYSTEM_PROMPT = [
    'You are NIEX Browser\'s voice command interpreter.',
    'Convert the user\'s natural-language command into structured browser actions.',
    'Understand Uzbek, English, and mixed Uzbek/English commands.',
    'ONLY use these action types: open_site{url}, search{query,engine?}, play, pause,',
    'next_video, previous_video, scroll{direction,amount?}, new_tab{url?}, close_tab,',
    'go_back, go_forward, reload.',
    'NEVER generate code, JavaScript, shell, or any action type not listed above.',
    'NEVER invent unsupported capabilities. Keep the action sequence minimal.',
    'Return ONLY valid JSON: {"actions":[...]}. No prose.',
    'If the command is unclear: {"actions":[],"status":"needs_clarification","message":"..."}.',
    'If unsupported: {"actions":[],"status":"unsupported","message":"..."}.',
    'Use provided browser context (currentUrl, site) to resolve references like "it".',
    'Do not claim an action was executed — only return the requested actions.',
    'Never bypass NIEX security; open_site is only a request that NIEX will still validate.',
  ].join(' ');

  // ── MOCK interpreter (Qwen server yo'q bo'lganda) ─────────────────
  const CMD_WORDS = /\b(och|ochib|oching|ochib ber|open|qidir|qidr|izla|search|find|top|topib|toping|qo['’]y|qoy|ber|ni|ga|da|dan|please|iltimos|eng|oxirgi|so['’]nggi|latest|videosini|videosi|video|va|and|then|keyin)\b/gi;

  function findSite(t) {
    let best = null;
    for (const name of Object.keys(S.KNOWN_SITES)) {
      const rx = new RegExp('\\b' + name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b', 'i');
      if (rx.test(t) && (!best || name.length > best.length)) best = name;
    }
    return best;
  }

  function extractQuery(t, site) {
    let q = ' ' + t + ' ';
    if (site) q = q.replace(new RegExp('\\b' + site.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + "['’]?(dan|da|ni|ga)?\\b", 'gi'), ' ');
    q = q.replace(CMD_WORDS, ' ').replace(/['’]/g, ' ').replace(/\s+/g, ' ').trim();
    return q;
  }

  function mockInterpret(text) {
    const t = String(text || '').toLowerCase().replace(/[.!?,]+/g, ' ').replace(/\s+/g, ' ').trim();
    if (!t) return { actions: [], status: S.STATUS.NEEDS_CLARIFICATION, message: 'Nima qilay?' };

    const wantsOpen = /\b(och|ochib|open)\b/.test(t);
    const wantsSearch = /\b(qidir|qidr|izla|search|find|top|topib)\b/.test(t);
    const site = findSite(t);
    const actions = [];

    if (wantsOpen && site) actions.push({ type: 'open_site', url: S.KNOWN_SITES[site] });
    if (wantsSearch) {
      const q = extractQuery(t, site);
      if (q) actions.push({ type: 'search', query: q, engine: site || undefined });
      else if (!actions.length) return { actions: [], status: S.STATUS.NEEDS_CLARIFICATION, message: 'Nimani qidiray?' };
    }
    if (!actions.length && wantsOpen && !site) {
      return { actions: [], status: S.STATUS.NEEDS_CLARIFICATION, message: 'Qaysi saytni ochay?' };
    }
    if (!actions.length && site) actions.push({ type: 'open_site', url: S.KNOWN_SITES[site] });
    if (!actions.length) return { actions: [], status: S.STATUS.UNSUPPORTED, message: 'Bu buyruq hozircha qo\'llab-quvvatlanmaydi.' };
    return { actions, status: S.STATUS.OK, source: 'mock' };
  }

  // ── ENDPOINT interpreter (NIEX AI / Qwen server) ──────────────────
  async function endpointInterpret(text, context, request, opts) {
    try {
      const payload = {
        system: SYSTEM_PROMPT,
        text: String(text || '').slice(0, 1000),
        context: sanitizeContext(context),
        schema: Object.keys(S.ACTIONS),
      };
      const raw = await request(payload); // { text } yoki JSON string yoki obyekt
      const parsed = parseLlmJson(raw);
      if (!parsed) return { actions: [], status: S.STATUS.ERROR, message: 'Qwen javobi buzuq' };
      return parsed;
    } catch (e) {
      return { actions: [], status: S.STATUS.ERROR, message: 'Ovozli buyruq xizmati vaqtincha ishlamayapti.' };
    }
  }

  // Faqat zarur, XAVFSIZ kontekst (parol/cookie/token YUBORILMAYDI).
  function sanitizeContext(ctx) {
    if (!ctx || typeof ctx !== 'object') return {};
    return {
      currentUrl: String(ctx.currentUrl || '').slice(0, 300),
      pageTitle: String(ctx.pageTitle || '').slice(0, 200),
      site: String(ctx.site || '').slice(0, 40),
      mediaPlaying: !!ctx.mediaPlaying,
    };
  }

  function parseLlmJson(raw) {
    let s = raw;
    if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
      if (Array.isArray(raw.actions) || raw.status) return raw;    // to'g'ridan-to'g'ri obyekt
      if (typeof raw.text === 'string') s = raw.text;
      else if (typeof raw.content === 'string') s = raw.content;
    }
    if (typeof s !== 'string') return null;
    // JSON blokni ajratamiz (LLM ba'zan ```json ... ``` qaytaradi).
    const m = s.match(/\{[\s\S]*\}/);
    if (!m) return null;
    try { return JSON.parse(m[0]); } catch { return null; }
  }

  /**
   * @param {{mode?, request?, opts?}} config  mode 'mock'|'endpoint' (default mock — server yo'q)
   */
  function createCommandLLM(config = {}) {
    const mode = config.mode || (config.request ? 'endpoint' : 'mock');
    return {
      mode,
      systemPrompt: SYSTEM_PROMPT,
      async interpret(text, context) {
        if (mode === 'endpoint' && typeof config.request === 'function') {
          return endpointInterpret(text, context, config.request, config.opts || {});
        }
        return mockInterpret(text);
      },
    };
  }

  return { createCommandLLM, SYSTEM_PROMPT, mockInterpret, parseLlmJson, sanitizeContext };
}));
