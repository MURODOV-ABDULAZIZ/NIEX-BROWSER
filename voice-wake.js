/**
 * NIEX Voice Agent — Wake-Word Listener (hands-free).
 * ===================================================
 *
 * Maqsad: foydalanuvchi qurilmaga TEGMASDAN "NIEX" deb chaqirib buyruq bersin.
 *
 * Electron'da Web Speech API (webkitSpeechRecognition) ISHLAMAYDI (Google speech
 * backend yo'q). Shuning uchun: mikrofonni uzluksiz tinglaymiz, Web Audio (RMS)
 * bilan OVOZ AKTIVLIGINI (VAD) aniqlaymiz — faqat gapirilganda bitta to'liq
 * "utterance"ni mavjud Groq STT pipeline'iga yuboramiz. Transkriptda wake-so'z
 * ("niex" va Whisper variantlari) bo'lsa — qolgan qismi buyruq sifatida bajariladi.
 *
 * MAXFIYLIK: hands-free OPT-IN (foydalanuvchi yoqadi). Audio saqlanmaydi. Faqat
 * gapirilgan parcha yuboriladi (jimlikda emas). Buyruq bajarilayotganda pauza.
 *
 * Uzluksiz MediaRecorder: har utterance chegarasida stop→start qilamiz — bu HAR
 * blobga to'liq webm sarlavhasini beradi va boshlanishdagi tovushni KESMAYDI.
 */
(function (root) {
  'use strict';

  function now() { return (root.performance && root.performance.now) ? root.performance.now() : Date.now(); }

  class NIEXWakeListener {
    constructor(opts = {}) {
      opts = opts || {};
      this.onUtterance = typeof opts.onUtterance === 'function' ? opts.onUtterance : function () {};
      this.onStatus = typeof opts.onStatus === 'function' ? opts.onStatus : function () {};
      this.onError = typeof opts.onError === 'function' ? opts.onError : function () {};
      this.onLevel = typeof opts.onLevel === 'function' ? opts.onLevel : function () {};
      this.language = opts.language != null ? opts.language : null;   // main.js default 'en'
      // ADAPTIV VAD — shovqin polidan (noiseFloor) NISBATAN nutqni ajratadi. Bu bir vaqtda
      //   (a) uzoq masofani (past signal, lekin poldan baland) VA (b) shovqinni (pol ko'tariladi,
      //   faqat nisbatan baland nutq o'tadi) hal qiladi. Absolute bo'sag'aga tayanmaydi.
      this.gainValue = opts.gainValue || 3.5;        // signalni kuchaytirish (VAD + Whisper yozuvi) — >1m masofa
      this.speechFactor = opts.speechFactor || 2.6;  // nutq = noiseFloor × shu (SNR ostonasi)
      this.minThreshold = opts.minThreshold || 0.005; // absolute quyi pol (o'ta jim xonada yolg'on trigger bo'lmasin)
      this.onsetFrames = opts.onsetFrames || 2;      // ketma-ket faol freym (qisqa shovqin cho'qqisini filtrlaydi)
      this.silenceMs = opts.silenceMs || 850;     // shuncha jimlikdan keyin utterance tugadi
      this.minSpeechMs = opts.minSpeechMs || 200;  // undan qisqa "gap" — shovqin, tashlanadi
      this.maxUtterMs = opts.maxUtterMs || 10000;  // bitta utterance uchun yuqori chegara
      this.maxIdleMs = opts.maxIdleMs || 4000;    // jimlik segmentini shuncha vaqtdan keyin qayta boshlash (blob kichik qolsin)

      this.stream = null; this.ac = null; this.analyser = null; this._buf = null;
      this.gain = null; this.dest = null;
      this._noiseFloor = 0.01; this._onCount = 0;
      this.mr = null; this._chunks = []; this._mime = '';
      this._running = false; this._paused = false; this._pollTimer = null;
      this._speaking = false; this._hadSpeech = false;
      this._segStart = 0; this._lastSpeechAt = 0; this._speechStart = 0;
      this._pendingTranscribe = false; this._transcribing = false;
      this.transcribeTimeoutMs = opts.transcribeTimeoutMs || 8000; // STT osilsa lock'ni bo'shatish
      this._pendingBlob = null;   // STT band paytida kelgan ENG OXIRGI utterance (latest-wins)
    }

    supported() {
      return !!(root.navigator && root.navigator.mediaDevices &&
        root.navigator.mediaDevices.getUserMedia && typeof root.MediaRecorder !== 'undefined' &&
        (root.AudioContext || root.webkitAudioContext));
    }

    _pickMime() {
      const cands = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/mp4'];
      for (const c of cands) { try { if (root.MediaRecorder.isTypeSupported(c)) return c; } catch (_) {} }
      return '';
    }

    async start() {
      if (this._running) return { ok: true };
      if (!this.supported()) { this.onError('unsupported'); return { ok: false, error: 'unsupported' }; }
      try {
        this.stream = await root.navigator.mediaDevices.getUserMedia({
          audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
        });
      } catch (e) {
        this.onError((e && e.name === 'NotAllowedError') ? 'mic-denied' : 'mic-unavailable');
        return { ok: false, error: 'mic' };
      }
      var recStream = this.stream;
      try {
        const AC = root.AudioContext || root.webkitAudioContext;
        this.ac = new AC();
        if (this.ac.state === 'suspended') { try { await this.ac.resume(); } catch (_) {} }
        const src = this.ac.createMediaStreamSource(this.stream);
        // Kuchaytiruvchi: uzoq/past ovozni ko'taradi — HAM VAD, HAM yozuv (Whisper) uchun.
        this.gain = this.ac.createGain();
        this.gain.gain.value = this.gainValue;
        this.analyser = this.ac.createAnalyser();
        this.analyser.fftSize = 1024;
        this.analyser.smoothingTimeConstant = 0.4;
        src.connect(this.gain);
        this.gain.connect(this.analyser);
        // Kuchaytirilgan signalni alohida stream'ga chiqaramiz va SHUNI yozamiz.
        this.dest = this.ac.createMediaStreamDestination();
        this.gain.connect(this.dest);
        recStream = this.dest.stream;
        this._buf = new Float32Array(this.analyser.fftSize);
      } catch (e) { this._teardown(); this.onError('audio-init'); return { ok: false, error: 'audio-init' }; }
      this._mime = this._pickMime();
      try {
        this.mr = new root.MediaRecorder(recStream, this._mime ? { mimeType: this._mime } : undefined);
      } catch (e) { this._teardown(); this.onError('recorder-init'); return { ok: false, error: 'recorder-init' }; }
      this.mr.ondataavailable = (e) => { if (e.data && e.data.size) this._chunks.push(e.data); };
      this.mr.onstop = () => this._onSegmentStop();

      this._running = true; this._paused = false;
      this._noiseFloor = 0.01; this._onCount = 0;   // shovqin poli boshlang'ich (tez moslashadi)
      this._startSegment();
      this._pollTimer = setInterval(() => this._poll(), 80);
      this.onStatus('listening');
      return { ok: true };
    }

    stop() {
      this._running = false;
      if (this._pollTimer) { clearInterval(this._pollTimer); this._pollTimer = null; }
      try { if (this.mr && this.mr.state !== 'inactive') { this._pendingTranscribe = false; this.mr.stop(); } } catch (_) {}
      this._teardown();
      this.onStatus('stopped');
    }

    // Buyruq bajarilayotganda tinglashni vaqtincha to'xtatamiz (o'z audio chiqishimizni qayta
    //   o'qimaslik). Joriy segmentni TASHLAB to'xtatamiz — pauza audiosi to'planib qolmasin.
    pause() {
      this._paused = true; this._resetSpeech();
      try { if (this.mr && this.mr.state !== 'inactive') { this._pendingTranscribe = false; this.mr.stop(); } } catch (_) {}
      this.onStatus('paused');
    }
    resume() {
      if (!this._running) return;
      this._paused = false;
      if (this.mr && this.mr.state === 'inactive') this._startSegment();
      this.onStatus('listening');
    }
    isRunning() { return this._running; }
    isPaused() { return this._paused; }

    _resetSpeech() { this._speaking = false; this._hadSpeech = false; this._speechStart = 0; this._lastSpeechAt = 0; this._onCount = 0; }

    _startSegment() {
      this._chunks = [];
      this._segStart = now();
      this._resetSpeech();
      try { if (this.mr && this.mr.state === 'inactive') this.mr.start(); } catch (_) {}
    }

    _onSegmentStop() {
      const doT = this._pendingTranscribe; this._pendingTranscribe = false;
      let blob = null;
      try { blob = new root.Blob(this._chunks, { type: (this.mr && this.mr.mimeType) || this._mime || 'audio/webm' }); } catch (_) {}
      this._chunks = [];
      // Keyingi segmentni darhol boshlaymiz (agar hali ishlayotgan va pauzada bo'lmasa).
      if (this._running && !this._paused) this._startSegment();
      if (doT && blob && blob.size > 900) this._transcribe(blob);
    }

    _poll() {
      if (!this._running || this._paused || !this.analyser) return;
      // O'Z-WATCHDOG (ROOT-FIX): faol (running & pauzada emas) bo'la turib recorder
      //   'inactive' qolib ketgan bo'lsa — bu pause/resume yoki mr.start() race natijasi
      //   (_startSegment ичидаги mr.start() xatosi jimgina yutilib, segment boshlanmay
      //   qolган). Bunда listener "tirik" ko'rinadi (isRunning=true) lekin HECH NIMA
      //   yozmaydi → "1-2 buyruqdan keyin eshitmay qolish". Segmentni darhol tiklaymiz.
      if (this.mr && this.mr.state === 'inactive') { this._startSegment(); return; }
      let rms = 0;
      try {
        this.analyser.getFloatTimeDomainData(this._buf);
        let sum = 0; for (let i = 0; i < this._buf.length; i++) { const v = this._buf[i]; sum += v * v; }
        rms = Math.sqrt(sum / this._buf.length);
      } catch (_) { return; }
      try { this.onLevel(rms); } catch (_) {}
      const t = now();

      // Adaptiv bo'sag'a: shovqin polidan NISBATAN (masofa + shovqinга chidamli).
      //   onThresh — nutq boshlanishi; offThresh — davomi (gisterezis, past ovoz uzilmasin).
      const onThresh = Math.max(this.minThreshold, this._noiseFloor * this.speechFactor);
      const offThresh = Math.max(this.minThreshold * 0.6, this._noiseFloor * this.speechFactor * 0.5);
      const active = this._speaking ? (rms > offThresh) : (rms > onThresh);

      if (active) {
        this._onCount++;
        // Onset: bir necha ketma-ket faol freym (qisqa shovqin cho'qqisi trigger qilmasin).
        if (!this._speaking && this._onCount >= this.onsetFrames) {
          this._speaking = true; this._speechStart = t - this.onsetFrames * 80;
        }
        if (this._speaking) { this._hadSpeech = true; this._lastSpeechAt = t; }
      } else {
        this._onCount = 0;
        // Faqat NUTQ bo'lmaganda shovqin polini sekin yangilaymiz (nutq polni ko'tarmasin).
        if (!this._speaking) {
          this._noiseFloor = this._noiseFloor * 0.96 + rms * 0.04;
          if (this._noiseFloor < 0.0004) this._noiseFloor = 0.0004;
          if (this._noiseFloor > 0.06) this._noiseFloor = 0.06;
        }
      }

      // Utterance tugadimi? (gapirdi, keyin silenceMs jimlik)
      if (this._speaking && (t - this._lastSpeechAt) > this.silenceMs) {
        const spoke = this._hadSpeech && (this._lastSpeechAt - this._speechStart) >= this.minSpeechMs;
        this._speaking = false; this._onCount = 0;
        this._finalize(spoke);
        return;
      }
      // Utterance juda uzoq — majburan yakunlaymiz.
      if (this._speaking && (t - this._speechStart) > this.maxUtterMs) { this._speaking = false; this._finalize(true); return; }
      // Uzoq jimlik — blob shishmasin, segmentni qayta boshlaymiz (transkriptsiz).
      if (!this._hadSpeech && (t - this._segStart) > this.maxIdleMs) { this._finalize(false); return; }
    }

    _finalize(doTranscribe) {
      if (!this.mr || this.mr.state === 'inactive') return;
      this._pendingTranscribe = !!doTranscribe;
      try { this.mr.stop(); } catch (_) { this._pendingTranscribe = false; }
    }

    async _transcribe(blob) {
      // Band bo'lsa TASHLAMAYMIZ — eng oxirgi utterance'ni saqlaymiz. Video ovozi STT'ni
      //   2-3s band qilib turganda foydalanuvchi "niex ..." desa, ilgari uning buyrug'i
      //   yo'qolardi ("eshitmay qolish"). Endi u navbatda saqlanib, STT bo'shashi bilan
      //   darhol ishlaydi (latest-wins — faqat eng so'nggi, real-time buzilmasin).
      if (this._transcribing) { this._pendingBlob = blob; return; }
      this._transcribing = true;
      // WATCHDOG: STT (Groq — tarmoq) osilib/rate-limit'da qotsa, lock ABADIY band bo'lib
      //   listener'ni muzlatmasin. Timeout'dan keyin lock bo'shaydi — keyingi utterance o'tadi.
      let guard = setTimeout(() => { this._transcribing = false; guard = null; }, this.transcribeTimeoutMs);
      try {
        if (!root.safenet_voice_stt || typeof root.safenet_voice_stt.transcribe !== 'function') return;
        const buf = await blob.arrayBuffer();
        const res = await root.safenet_voice_stt.transcribe(buf, { mimeType: blob.type, language: this.language });
        const text = res && res.ok ? String(res.text || '').trim() : '';
        if (text) { try { this.onUtterance(text); } catch (_) {} }
      } catch (_) { /* jim — wake rejimida xato UX'ni buzmasin */ }
      finally {
        if (guard) clearTimeout(guard);
        this._transcribing = false;
        // Band paytida kelgan eng oxirgi utterance bo'lsa — darhol qayta ishlaymiz.
        const pend = this._pendingBlob; this._pendingBlob = null;
        if (pend && this._running && !this._paused) { try { this._transcribe(pend); } catch (_) {} }
      }
    }

    _teardown() {
      try { if (this.mr && this.mr.state !== 'inactive') this.mr.stop(); } catch (_) {}
      this.mr = null; this._chunks = [];
      try { if (this.gain) this.gain.disconnect(); } catch (_) {}
      try { if (this.ac && this.ac.state !== 'closed') this.ac.close(); } catch (_) {}
      this.ac = null; this.analyser = null; this._buf = null; this.gain = null; this.dest = null;
      try { if (this.stream) { this.stream.getTracks().forEach((tr) => tr.stop()); } } catch (_) {}
      this.stream = null;
    }
  }

  // Wake-so'z (NIEX) va Whisper-mishearlarini transkript BOSHIDAN aniqlaydi.
  //   hit=true bo'lsa rest — qolgan buyruq (bo'sh bo'lishi mumkin → "armed" rejim).
  // MUHIM: "next" (va boshqa haqiqiy so'zlar: nikes/niece/knicks...) wake-variant EMAS —
  //   ular buyruq so'zlari bilan to'qnashadi ("next video" → "video" bo'lib qolardi).
  //   Faqat "NIEX"ga yaqin, buyruq bo'lmagan variantlar.
  // Wake yadrosi — cho'zilgan harflar QISQARTIRILGANDAN keyin (nieeex→niex) solishtiriladi.
  //   Oxirida ixtiyoriy 's'/'z' — "niexss"/"niexs"/"niez" kabi Whisper dumlari uchun.
  //   MUHIM: haqiqiy buyruq so'zlari (next/nikes/niece...) BU YERGA tushmasligi kerak.
  const WAKE_RX = /^(niex|nieks|nieqs|niyeks|niyes|niyes|niks|nix|nex|neks|neeks|neex|nyx|nyex|niax|niox|neaks|niaks)[sz]?$/i;
  // Cho'zilgan takror harfni bittaga tushiradi: "nieeex"→"niex", "niexxx"→"niex", "niexss"→"niexs".
  function _squash(w) { return String(w || '').replace(/(.)\1+/g, '$1'); }
  function parseWake(raw) {
    let t = String(raw || '').toLowerCase().replace(/[.,!?;:]+/g, ' ').replace(/\s+/g, ' ').trim();
    if (!t) return { hit: false, rest: '', wake: null };
    let toks = t.split(' ');
    // Ixtiyoriy chaqiruv prefiksi: "hey/ok/hi niex ...".
    if (toks.length > 1 && /^(hey|ok|okay|hay|hi)$/.test(toks[0])) toks = toks.slice(1);
    if (!toks.length) return { hit: false, rest: t, wake: null };
    // 1) Birinchi token wake nomzodi (cho'zilgan harflar normallashtirilib).
    if (WAKE_RX.test(_squash(toks[0]))) {
      return { hit: true, rest: toks.slice(1).join(' ').trim(), wake: toks[0] };
    }
    // 2) Whisper ba'zan ajratadi: "ni eks" / "ne eks" — birinchi 2 tokenni birlashtirib sinaymiz.
    if (toks.length > 1 && WAKE_RX.test(_squash(toks[0] + toks[1]))) {
      return { hit: true, rest: toks.slice(2).join(' ').trim(), wake: toks[0] + ' ' + toks[1] };
    }
    return { hit: false, rest: t, wake: null };
  }

  root.NIEXWakeListener = NIEXWakeListener;
  root.NIEXParseWake = parseWake;
})(typeof window !== 'undefined' ? window : globalThis);
