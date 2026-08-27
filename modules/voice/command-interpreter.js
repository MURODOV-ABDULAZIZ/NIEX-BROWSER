/**
 * NIEX Voice Agent — Command Interpreter (Prompt 3).
 * ==================================================
 *
 * STT matni → BrowserAction[]. Oqim:
 *   text → [Pro gate] → LOCAL simple-command? → ha: local action
 *                                             → yo'q: Qwen (mock/endpoint)
 *        → ActionValidator (xavfsizlik) → { ok, actions, status, message }
 *
 * Bu modul action BAJARMAYDI (Prompt 4 bajaradi). Faqat interpretatsiya + validatsiya.
 * Sof modul (Node + brauzer). `llm` va `gate` inject qilinadi.
 */
(function (root, factory) {
  const isNode = (typeof require === 'function' && typeof module !== 'undefined');
  const Local = isNode ? require('./local-commands') : root.NIEXVoiceLocal;
  const Validator = isNode ? require('./action-validator') : root.NIEXVoiceValidator;
  const Qwen = isNode ? require('./qwen-provider') : root.NIEXVoiceQwen;
  const S = isNode ? require('./action-schema') : root.NIEXVoiceSchema;
  const api = factory(Local, Validator, Qwen, S);
  if (isNode) module.exports = api;
  else root.NIEXVoiceInterpreter = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function (Local, Validator, Qwen, S) {
  'use strict';

  /**
   * @param {{ mvpMode?, llm?, gate?, useLocal? }} config
   *   mvpMode: TRUE (default) → local tushunmasa 'unknown' (Qwen CHAQIRILMAYDI).
   *            FALSE → local null bo'lsa Qwen'ga o'tadi (kelajakda AI Router).
   *   llm: createCommandLLM(...) natijasi (default: mock; mvpMode:false bo'lsa ishlatiladi).
   *   gate: () => boolean  (Pro tekshiruvi — ixtiyoriy; false → unsupported).
   */
  function createCommandInterpreter(config = {}) {
    const mvpMode = config.mvpMode !== false; // default TRUE — MVP: Qwen'siz
    const llm = config.llm || Qwen.createCommandLLM({ mode: 'mock' });
    const gate = typeof config.gate === 'function' ? config.gate : null;
    const useLocal = config.useLocal !== false;

    return {
      mvpMode,
      llmMode: llm.mode,
      async interpret(text, options = {}) {
        const raw = String(text || '').trim();
        if (!raw) return { ok: false, actions: [], status: S.STATUS.NEEDS_CLARIFICATION, message: 'Hech narsa eshitilmadi.', source: 'none', raw_text: '' };

        // Pro gate (ixtiyoriy) — voice Pro'ga cheklangan bo'lsa.
        if (gate && !gate()) {
          return { ok: false, actions: [], status: S.STATUS.UNSUPPORTED, message: 'Ovozli agent Pro obunada mavjud.', source: 'gate', raw_text: raw };
        }

        // 1) LOCAL — aniq buyruq bo'lsa AI'siz.
        if (useLocal) {
          const local = Local.detect(raw);
          if (local) {
            const v = Validator.validate(local);
            return { ...v, source: 'local', raw_text: raw };
          }
        }

        // 2) MVP: local tushunmasa AI'ga o'tmaymiz — 'unknown' qaytaramiz.
        if (mvpMode) {
          return { ok: false, actions: [], status: 'unknown', message: 'Buyruqni tushunmadim', source: 'local', raw_text: raw };
        }

        // 3) Kelajakda (mvpMode:false): AI Router / Qwen.
        let llmResult;
        try { llmResult = await llm.interpret(raw, options.context || {}); }
        catch (e) { return { ok: false, actions: [], status: S.STATUS.ERROR, message: 'Buyruqni tushunishda xatolik.', source: llm.mode, raw_text: raw }; }
        const v = Validator.validate(llmResult);
        if (!v.actions.length && llmResult && llmResult.status && llmResult.status !== S.STATUS.OK && v.status === S.STATUS.ERROR) {
          return { ok: true, actions: [], status: llmResult.status, message: llmResult.message || v.message, source: llm.mode, raw_text: raw };
        }
        return { ...v, source: llm.mode, raw_text: raw };
      },
    };
  }

  return { createCommandInterpreter };
}));
