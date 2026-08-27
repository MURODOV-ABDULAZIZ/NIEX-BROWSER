/**
 * NIEX Voice Agent — Speech-to-Text Provider (Prompt 2).
 * ======================================================
 *
 * Spec "Voice Agent MVP" Prompt 2 — MICROPHONE → STT → TEXT.
 *
 * ABSTRAKSIYA: SpeechToTextProvider. Almashtiriladigan — bugun Groq Whisper
 * (o'zbek tilini qo'llaydi, tez, arzon), keyin self-hosted whisper.cpp yoki
 * boshqa provayder — Voice Agentni qayta yozmasdan.
 *
 * XAVFSIZLIK: transkripsiya MAIN process'da bajariladi; API kaliti brauzerга
 * (renderer) HECH QACHON berilmaydi. Kalit `resolveKey()` orqali ai-gateway
 * ProviderManager'dan olinadi (mavjud infratuzilma reuse).
 *
 * SOF/testlanadigan: fetch va resolveKey inject qilinadi. Node (main) da ishlaydi.
 */
'use strict';

const DEFAULTS = Object.freeze({
  // whisper-large-v3-turbo o'zbekni juda yomon transkript qildi (misol: "yangi sahifa
  // och" → "Yany Sakhifa Qush"). Non-turbo large-v3 sezilarli aniq — MVP uchun majbur.
  //   NIEX_STT_MODEL orqali override qilinishi mumkin.
  model: 'whisper-large-v3',
  endpoint: 'https://api.groq.com/openai/v1/audio/transcriptions',
  maxBytes: 25 * 1024 * 1024,        // Groq audio limiti ~25MB
  minBytes: 512,                      // juda kichik = bo'sh yozuv
  timeoutMs: 30000,
});

// SpeechToTextResult shakli (barcha provayderlar shu ko'rinishda qaytaradi):
//   { ok, text, language, provider, model, durationMs, error? }

function toBuffer(audio) {
  if (!audio) return null;
  if (Buffer.isBuffer(audio)) return audio;
  if (audio instanceof Uint8Array) return Buffer.from(audio);
  if (audio instanceof ArrayBuffer) return Buffer.from(new Uint8Array(audio));
  if (typeof audio === 'string') { try { return Buffer.from(audio, 'base64'); } catch { return null; } }
  if (audio && audio.buffer instanceof ArrayBuffer) return Buffer.from(new Uint8Array(audio.buffer));
  return null;
}

function extFor(mime) {
  const m = String(mime || '').toLowerCase();
  if (m.includes('webm')) return 'webm';
  if (m.includes('ogg')) return 'ogg';
  if (m.includes('wav')) return 'wav';
  if (m.includes('mp4') || m.includes('m4a')) return 'm4a';
  if (m.includes('mpeg') || m.includes('mp3')) return 'mp3';
  return 'webm';
}

/** Groq Whisper provider (asosiy MVP). */
function groqProvider(opts) {
  const fetchImpl = opts.fetch || (typeof fetch === 'function' ? fetch : null);
  const FormDataImpl = opts.FormData || (typeof FormData === 'function' ? FormData : null);
  const BlobImpl = opts.Blob || (typeof Blob === 'function' ? Blob : null);
  const resolveKey = opts.resolveKey || (() => opts.groqKey || process.env.GROQ_API_KEY || null);
  const endpoint = opts.endpoint || DEFAULTS.endpoint;
  const model = opts.model || DEFAULTS.model;
  const maxBytes = opts.maxBytes || DEFAULTS.maxBytes;
  const minBytes = opts.minBytes || DEFAULTS.minBytes;
  const timeoutMs = opts.timeoutMs || DEFAULTS.timeoutMs;

  return {
    name: 'groq-whisper',
    isConfigured() { try { return !!resolveKey(); } catch { return false; } },
    async transcribe(audio, o = {}) {
      const t0 = Date.now();
      const buf = toBuffer(audio);
      if (!buf || buf.length < minBytes) return { ok: false, error: 'empty-audio', provider: this.name };
      if (buf.length > maxBytes) return { ok: false, error: 'audio-too-large', provider: this.name };
      if (!fetchImpl || !FormDataImpl || !BlobImpl) return { ok: false, error: 'stt-runtime-unsupported', provider: this.name };
      const key = resolveKey();
      if (!key) return { ok: false, error: 'stt-not-configured', provider: this.name };

      const mime = o.mimeType || 'audio/webm';
      const form = new FormDataImpl();
      form.append('file', new BlobImpl([buf], { type: mime }), `audio.${extFor(mime)}`);
      form.append('model', model);
      form.append('response_format', 'json');
      // Til: berilsa aniq (masalan 'uz'/'en'), aks holda avtomatik aniqlash.
      if (o.language) form.append('language', String(o.language));
      // Aralash o'zbek/ingliz uchun translate EMAS — transkripsiya (asl til).

      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), timeoutMs);
      try {
        const res = await fetchImpl(endpoint, {
          method: 'POST',
          headers: { Authorization: 'Bearer ' + key },
          body: form,
          signal: ctrl.signal,
        });
        if (!res.ok) {
          let detail = '';
          try { detail = (await res.text()).slice(0, 200); } catch {}
          // 429/401 → kalit muammosi; rotatsiyani ai-gateway boshqaradi (keyingi urinishda boshqa kalit)
          return { ok: false, error: 'groq-http-' + res.status, detail, provider: this.name };
        }
        const j = await res.json().catch(() => ({}));
        const text = String(j.text || '').trim();
        return {
          ok: true, text,
          language: o.language || j.language || null,
          provider: this.name, model,
          durationMs: Date.now() - t0,
        };
      } catch (e) {
        return { ok: false, error: e.name === 'AbortError' ? 'stt-timeout' : 'stt-network', detail: e.message, provider: this.name };
      } finally {
        clearTimeout(timer);
      }
    },
  };
}

/** Dev/mock provider — pipeline testi uchun (server/kalit yo'q bo'lganda). */
function mockProvider(opts) {
  return {
    name: 'mock-stt',
    isConfigured() { return true },
    async transcribe(audio, o = {}) {
      const buf = toBuffer(audio);
      if (!buf || !buf.length) return { ok: false, error: 'empty-audio', provider: this.name };
      const text = opts.mockText != null ? opts.mockText : (o.mockText != null ? o.mockText : '');
      return { ok: true, text: String(text), language: o.language || null, provider: this.name, model: 'mock', durationMs: 1, mock: true };
    },
  };
}

/**
 * Factory — config bo'yicha provayder tanlaydi. LLM/STT qatlami almashtiriladigan.
 * @param {{provider?, resolveKey?, groqKey?, model?, endpoint?, fetch?, mockText?}} opts
 */
function createSttProvider(opts = {}) {
  const provider = (opts.provider || 'groq').toLowerCase();
  if (provider === 'mock') return mockProvider(opts);
  // kelajakda: 'whispercpp' | 'openai' | 'gemini' — shu yerga qo'shiladi.
  return groqProvider(opts);
}

module.exports = { createSttProvider, toBuffer, extFor, DEFAULTS };
