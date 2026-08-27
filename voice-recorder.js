/**
 * NIEX Voice Agent — Microphone Recorder (renderer, Prompt 2).
 * ============================================================
 *
 * Spec Prompt 2: MICROPHONE → (STT) → TEXT.
 *
 * Renderer'da mikrofonni yozadi (getUserMedia + MediaRecorder), audio baytini
 * `window.safenet_voice_stt.transcribe()` orqali MAIN'ga yuboradi va matn oladi.
 * API kaliti bu yerda YO'Q — transkripsiya main'da. Audio bufer transkripsiyadan
 * keyin tashlanadi (maxfiylik).
 *
 * Bu skript NIEX ichki UI'sida (toolbar/home) ishlatiladi — web sahifalarga
 * inject QILINMAYDI. Voice tugmasi/UX keyingi bosqichda (Prompt 5).
 *
 * Ishlatish:
 *   const rec = new NIEXVoiceRecorder({ onState: s => ..., maxMs: 12000 });
 *   await rec.start();                 // yozishni boshlaydi
 *   const res = await rec.stop();      // { ok, text, ... }
 *   rec.cancel();                      // bekor qilish
 */
(function (root) {
  'use strict';

  class NIEXVoiceRecorder {
    constructor(opts = {}) {
      this.stream = null;
      this.rec = null;
      this.chunks = [];
      this.state = 'idle';               // idle|recording|processing|done|error
      this.onState = typeof opts.onState === 'function' ? opts.onState : () => {};
      this.maxMs = opts.maxMs || 12000;  // avto-to'xtash (uzoq yozuvni oldini olish)
      this._timer = null;
    }

    _set(s) { this.state = s; try { this.onState(s); } catch (_) {} }

    supported() {
      return !!(root.navigator && root.navigator.mediaDevices &&
        root.navigator.mediaDevices.getUserMedia && typeof root.MediaRecorder !== 'undefined');
    }

    _pickMime() {
      const cands = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/mp4'];
      for (const c of cands) { try { if (root.MediaRecorder.isTypeSupported(c)) return c; } catch (_) {} }
      return '';
    }

    async start() {
      if (this.state === 'recording' || this.state === 'processing') return { ok: false, error: 'busy' };
      if (!this.supported()) { this._set('error'); return { ok: false, error: 'unsupported' }; }
      try {
        this.stream = await root.navigator.mediaDevices.getUserMedia({ audio: true });
      } catch (e) {
        this._set('error');
        return { ok: false, error: (e && e.name === 'NotAllowedError') ? 'mic-denied' : 'mic-unavailable' };
      }
      const mime = this._pickMime();
      this.chunks = [];
      try {
        this.rec = new root.MediaRecorder(this.stream, mime ? { mimeType: mime } : undefined);
      } catch (e) {
        this._stopStream(); this._set('error'); return { ok: false, error: 'recorder-init' };
      }
      this.rec.ondataavailable = (e) => { if (e.data && e.data.size) this.chunks.push(e.data); };
      this.rec.start();
      this._set('recording');
      this._timer = setTimeout(() => { this.stop().catch(() => {}); }, this.maxMs);
      return { ok: true };
    }

    async stop(opts = {}) {
      if (this.state !== 'recording') return { ok: false, error: 'not-recording' };
      clearTimeout(this._timer);
      const stopped = new Promise((resolve) => { this.rec.onstop = resolve; });
      try { this.rec.stop(); } catch (_) {}
      await stopped;
      this._stopStream();
      this._set('processing');
      const blob = new root.Blob(this.chunks, { type: (this.rec && this.rec.mimeType) || 'audio/webm' });
      this.chunks = [];
      if (!blob.size) { this._set('idle'); return { ok: false, error: 'empty' }; }
      let res;
      try {
        const buf = await blob.arrayBuffer();
        if (!root.safenet_voice_stt || typeof root.safenet_voice_stt.transcribe !== 'function') {
          this._set('error'); return { ok: false, error: 'stt-bridge-missing' };
        }
        res = await root.safenet_voice_stt.transcribe(buf, { mimeType: blob.type, language: opts.language || null });
      } catch (e) {
        this._set('error'); return { ok: false, error: 'ipc-fail', detail: e && e.message };
      }
      this._set(res && res.ok ? 'done' : 'error');
      return res; // { ok, text, language, provider, ... }
    }

    cancel() {
      clearTimeout(this._timer);
      try { if (this.rec && this.state === 'recording') this.rec.stop(); } catch (_) {}
      this.chunks = [];
      this._stopStream();
      this._set('idle');
    }

    _stopStream() {
      try { if (this.stream) { this.stream.getTracks().forEach((t) => t.stop()); this.stream = null; } } catch (_) {}
    }
  }

  root.NIEXVoiceRecorder = NIEXVoiceRecorder;
})(typeof window !== 'undefined' ? window : globalThis);
