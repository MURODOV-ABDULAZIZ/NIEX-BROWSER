/**
 * NIEX Voice Agent — Orchestrator + State Machine (Prompt 5).
 * ===========================================================
 *
 * Butun oqimni bir joyda boshqaradi:
 *   IDLE → LISTENING → TRANSCRIBING → UNDERSTANDING → EXECUTING → SUCCESS
 *   tarmoqlar: ERROR / BLOCKED / NEEDS_CLARIFICATION / CANCELLED
 *
 * SOF: raw Electron/JS/Qwen YO'Q. Bog'liqliklar inject qilinadi:
 *   record   — { start(), stop()→{ok,text,error}, cancel() }  (voice-recorder + STT)
 *   runCommand(text, ctx) → { success, status, message, results }  (main: interpret+validate+execute)
 *   onState(state, data)  — UI yangilanishi
 *
 * UMD (renderer'da global, Node'da require — test). Duplicate sessiya himoyasi bor.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.NIEXVoiceAgent = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const STATE = Object.freeze({
    IDLE: 'idle', LISTENING: 'listening', TRANSCRIBING: 'transcribing',
    UNDERSTANDING: 'understanding', EXECUTING: 'executing', SUCCESS: 'success',
    ERROR: 'error', BLOCKED: 'blocked', CANCELLED: 'cancelled', NEEDS_CLARIFICATION: 'needs_clarification',
  });

  // Buyruq bajarilishi uchun yuqori chegara. Main-process IPC (interpret + action +
  //   navigatsiya kutish) biror sababdan javob bermay qolsa, `busy` ABADIY true bo'lib
  //   agent muzlab qolardi (faqat yangi tab qutqarardi). Timeout busy'ni bo'shatadi.
  const CMD_TIMEOUT_MS = 20000;
  function withTimeout(promise, ms) {
    let to;
    const timer = new Promise((resolve) => { to = setTimeout(() => resolve({ __timeout: true }), ms); });
    return Promise.race([
      Promise.resolve(promise).then((v) => { clearTimeout(to); return v; }, (e) => { clearTimeout(to); throw e; }),
      timer,
    ]);
  }

  // Interpreter/engine status → yakuniy UI holati.
  function finalState(status) {
    switch (status) {
      case 'ok': case 'completed': return STATE.SUCCESS;
      case 'blocked': return STATE.BLOCKED;
      case 'needs_clarification': return STATE.NEEDS_CLARIFICATION;
      case 'unsupported': return STATE.ERROR;
      case 'unknown': return STATE.ERROR;
      case 'cancelled': return STATE.CANCELLED;
      default: return STATE.ERROR;
    }
  }

  function createVoiceAgent(deps = {}) {
    const record = deps.record;
    const runCommand = deps.runCommand;
    const onState = typeof deps.onState === 'function' ? deps.onState : () => {};
    const getContext = typeof deps.getContext === 'function' ? deps.getContext : () => ({});
    const gate = typeof deps.gate === 'function' ? deps.gate : null;

    let state = STATE.IDLE;
    let busy = false;
    let session = 0;
    let cancelledSession = -1;

    function set(s, data) { state = s; try { onState(s, data || {}); } catch (_) {} }
    function isCancelled(mySession) { return cancelledSession === mySession; }

    async function start() {
      if (busy) return { ok: false, error: 'busy' };
      if (gate && !gate()) { set(STATE.ERROR, { message: 'Ovozli agent Pro obunada mavjud.' }); return { ok: false, error: 'gate' }; }
      busy = true;
      const my = ++session;
      set(STATE.LISTENING, { session: my });
      const r = await record.start();
      if (isCancelled(my)) { busy = false; return { ok: false, error: 'cancelled' }; }
      if (!r || r.ok === false) {
        busy = false;
        set(STATE.ERROR, { message: micError(r && r.error) });
        return { ok: false, error: (r && r.error) || 'mic' };
      }
      return { ok: true, session: my };
    }

    async function stop() {
      if (!busy || state !== STATE.LISTENING) return { ok: false, error: 'not-listening' };
      const my = session;
      set(STATE.TRANSCRIBING);
      const rec = await record.stop();               // { ok, text, error }
      if (isCancelled(my)) { busy = false; return { ok: false, error: 'cancelled' }; }
      if (!rec || rec.ok === false || !String(rec.text || '').trim()) {
        busy = false;
        set(rec && rec.error === 'empty' ? STATE.IDLE : STATE.ERROR, { message: sttError(rec && rec.error) });
        return { ok: false, error: (rec && rec.error) || 'stt' };
      }
      const text = String(rec.text).trim();
      set(STATE.UNDERSTANDING, { transcript: text });

      let res;
      try { res = await withTimeout(runCommand(text, getContext()), CMD_TIMEOUT_MS); }
      catch (e) { busy = false; set(STATE.ERROR, { message: 'Buyruqni bajarishda xatolik.' }); return { ok: false, error: 'command-fail' }; }
      if (isCancelled(my)) { busy = false; return { ok: false, error: 'cancelled' }; }
      if (res && res.__timeout) { busy = false; set(STATE.ERROR, { message: 'Buyruq javob bermadi — qayta urinib ko\'ring.' }); return { ok: false, error: 'timeout' }; }

      // Amal bajarilyapti holati (agar action bo'lsa) — keyin yakuniy holat.
      if (res && (res.status === 'ok' || res.status === 'completed') && res.results && res.results.length) {
        set(STATE.EXECUTING, { transcript: text });
      }
      const fs = finalState(res && res.status);
      set(fs, { transcript: text, message: res && res.message, result: res });
      busy = false;
      return { ok: fs === STATE.SUCCESS, status: res && res.status, result: res };
    }

    // Bir bosqichda: yozishni to'xtatib to'liq oqimni yakunlaydi (UI "stop" tugmasi).
    async function finish() { return stop(); }

    /**
     * Oldindan transkript qilingan matnni bajaradi (wake-word yo'li: VAD → STT → shu).
     * record bosqichini o'tkazib yuboradi; qolgan oqim (UNDERSTANDING→EXECUTING→yakun) bir xil.
     */
    async function runText(text) {
      if (busy) return { ok: false, error: 'busy' };
      if (gate && !gate()) { set(STATE.ERROR, { message: 'Ovozli agent Pro obunada mavjud.' }); return { ok: false, error: 'gate' }; }
      text = String(text || '').trim();
      if (!text) return { ok: false, error: 'empty' };
      busy = true;
      const my = ++session;
      set(STATE.UNDERSTANDING, { transcript: text });
      let res;
      try { res = await withTimeout(runCommand(text, getContext()), CMD_TIMEOUT_MS); }
      catch (e) { busy = false; set(STATE.ERROR, { message: 'Buyruqni bajarishda xatolik.' }); return { ok: false, error: 'command-fail' }; }
      if (isCancelled(my)) { busy = false; return { ok: false, error: 'cancelled' }; }
      if (res && res.__timeout) { busy = false; set(STATE.ERROR, { message: 'Buyruq javob bermadi — qayta urinib ko\'ring.' }); return { ok: false, error: 'timeout' }; }
      if (res && (res.status === 'ok' || res.status === 'completed') && res.results && res.results.length) {
        set(STATE.EXECUTING, { transcript: text });
      }
      const fs = finalState(res && res.status);
      set(fs, { transcript: text, message: res && res.message, result: res });
      busy = false;
      return { ok: fs === STATE.SUCCESS, status: res && res.status, result: res };
    }

    function cancel() {
      cancelledSession = session;
      try { if (record && record.cancel) record.cancel(); } catch (_) {}
      busy = false;
      set(STATE.CANCELLED);
      setTimeout(() => { if (state === STATE.CANCELLED) set(STATE.IDLE); }, 400);
    }

    function reset() { if (!busy) set(STATE.IDLE); }

    function micError(e) {
      if (e === 'mic-denied') return 'Mikrofonga ruxsat berilmadi.';
      if (e === 'unsupported') return 'Mikrofon qo\'llab-quvvatlanmaydi.';
      return 'Mikrofon mavjud emas.';
    }
    function sttError(e) {
      if (e === 'stt-not-configured') return 'Ovoz xizmati sozlanmagan.';
      if (e === 'stt-timeout') return 'Ovoz tanish vaqti tugadi.';
      return 'Ovozni tanib bo\'lmadi. Qayta urinib ko\'ring.';
    }

    return {
      STATE,
      start, stop, finish, runText, cancel, reset,
      getState: () => state,
      isBusy: () => busy,
    };
  }

  return { createVoiceAgent, STATE, finalState };
}));
