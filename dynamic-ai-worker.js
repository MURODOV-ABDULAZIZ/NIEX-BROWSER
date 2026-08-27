/**
 * AI Radar — dynamic-ai-worker.js v2.0 (STAGE 1: Performance Optimization)
 *
 * Web Worker: Transformers.js NSFW detection pipeline
 * - Chrome Extension MV3 compatible (no unsafe-eval)
 * - WebGPU → WebGL → WASM (CPU) fallback, ALWAYS quantized (q8) for speed
 * - PRIMARY model: Falconsai/nsfw_image_detection (lightweight, ViT-Tiny based,
 *   ~15MB vs 100MB — loads & infers 5-8x faster, critical for non-blocking UX)
 * - IndexedDB model cache (bir marta yuklash)
 * - Main thread bilan postMessage bridge + throttle-aware queue
 *
 * Model strategiyasi (tezlik > marginal aniqlik):
 *   PRIMARY:   "Falconsai/nsfw_image_detection" (ViT-Tiny, ~15-20MB, tez)
 *   FALLBACK:  "Xenova/nsfw_image_detection"    (ResNet-50, ~100MB, sekinroq)
 *
 * Xabar protokoli (monitor.js ↔ worker):
 *   monitor → worker: { type:"classify", id:N, imageData:ImageData|{width,height,data:Uint8ClampedArray}|string }
 *   monitor → worker: { type:"throttle", mode:"normal"|"pause"|"suspend" }
 *   worker → monitor: { type:"result",   id:N, preds:{Porn,Sexy,Hentai,Neutral}, error? }
 *   worker → monitor: { type:"status",   state:"loading"|"ready"|"error", progress? }
 */

// ─── MV3 Safe Import ───────────────────────────────────────────────────────
const TRANSFORMERS_CDN = "https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.3.3/dist/transformers.min.js";

// ─── CONFIG ────────────────────────────────────────────────────────────────
const MODEL_CONFIG = {
  // PRIMARY: tezkor, kichik model — birinchi navbatda shu yuklanadi
  primary: {
    id: "Falconsai/nsfw_image_detection",
    task: "image-classification",
    labelMap: {
      "nsfw":    "Porn",
      "normal":  "Neutral",
      "neutral": "Neutral",
      "safe":    "Neutral",
    },
  },
  // FALLBACK: aniqroq lekin sekinroq — faqat primary yuklanmasa
  fallback: {
    id: "Xenova/nsfw_image_detection",
    task: "image-classification",
    labelMap: {
      "nsfw":    "Porn",
      "porn":    "Porn",
      "hentai":  "Hentai",
      "sexy":    "Sexy",
      "neutral": "Neutral",
      "drawings":"Neutral",
    },
  },
};

const INFERENCE_SIZE = 224; // Standard input size for ViT/ResNet models

// ─── STATE ─────────────────────────────────────────────────────────────────
let pipeline    = null;       // Transformers.js pipeline instance
let isReady     = false;      // Model tayyor holati
let isLoading   = false;      // Yuklanmoqda
let loadError   = null;       // Yuklanish xatosi
let deviceType  = "cpu";      // Ishlatilayotgan qurilma
let activeModelId = "";       // Qaysi model yuklangani (label mapping uchun)
const pendingQueue = [];      // Model tayyor bo'lguncha kutayotgan so'rovlar

// THROTTLE STATE — main thread'dan keladigan device-protection signali
// "normal" → barcha so'rovlar darhol qayta ishlanadi
// "pause"  → navbat to'planadi, lekin bajarilmaydi (Yellow zone)
// "suspend"→ barcha kelayotgan so'rovlarga darhol "throttled" javob (Red zone)
let throttleMode = "normal";
const throttledQueue = []; // pause holatida saqlanadigan so'rovlar

// ─── DEVICE DETECTION ──────────────────────────────────────────────────────
async function detectBestDevice() {
  // WebGPU (eng tez — GPU'da to'liq inference) — PRIMARY EXECUTION PROVIDER
  if (typeof navigator !== "undefined" && navigator.gpu) {
    try {
      const adapter = await navigator.gpu.requestAdapter({ powerPreference: "high-performance" });
      if (adapter) {
        const device = await adapter.requestDevice();
        if (device) { device.destroy(); return "webgpu"; }
      }
    } catch {}
  }
  // WebGL (GPU-accelerated lekin WebGPU'dan sekinroq)
  try {
    const canvas = new OffscreenCanvas(1, 1);
    const gl = canvas.getContext("webgl2") || canvas.getContext("webgl");
    if (gl) return "webgl";
  } catch {}
  // CPU (WASM backend — har doim ishlaydi, lekin q8 quantized bilan tez)
  return "cpu";
}

// ─── TRANSFORMERS.JS LOADER ────────────────────────────────────────────────
let env = null;
let pipelineFn = null;

async function loadTransformers() {
  // Strategiya 1: Chrome Extension lokal fayl
  if (typeof chrome !== "undefined" && chrome.runtime?.getURL) {
    try {
      const localUrl = chrome.runtime.getURL("lib/transformers.min.js");
      // ESM import orqali yuklab, global ga bind qilamiz
      // MV3 da importScripts ESM module'larini import qila olmaydi
      // Shuning uchun classic script sifatida import qilamiz
      await new Promise((resolve, reject) => {
        // self.importScripts faqat non-module workers da ishlaydi
        if (typeof importScripts === "function") {
          try { importScripts(localUrl); resolve(); }
          catch { reject(new Error("importScripts failed")); }
        } else { reject(new Error("not classic worker")); }
      });
      if (self.transformers || self.pipeline) {
        env = self.transformers?.env || {};
        pipelineFn = self.pipeline || self.transformers?.pipeline;
        return true;
      }
    } catch {}
  }

  // Strategiya 2: CDN dan yuklab olish
  // MV3 CSP: external scripts faqat service worker'da, content script Worker'da
  // ruxsat etilgan domenlar manifest.json da ko'rsatilishi kerak
  try {
    if (typeof importScripts === "function") {
      importScripts(TRANSFORMERS_CDN);
      if (self.pipeline || (self.transformers && self.transformers.pipeline)) {
        env = (self.transformers && self.transformers.env) || {};
        pipelineFn = self.pipeline || (self.transformers && self.transformers.pipeline);
        return true;
      }
    }
  } catch {}

  // Strategiya 3: ESM dynamic import (module worker kontekstida)
  try {
    const mod = await import(TRANSFORMERS_CDN);
    env = mod.env;
    pipelineFn = mod.pipeline;
    if (pipelineFn) return true;
  } catch {}

  throw new Error("Transformers.js yuklanmadi — CDN'ga murojaat amalga oshmadi");
}

// ─── INDEXEDDB CACHE SETUP ─────────────────────────────────────────────────
// Transformers.js env.cache_dir ni IndexedDB ga yo'naltirish
function setupModelCache() {
  if (!env) return;
  // Transformers.js v3 da cache backend sozlamalari
  try {
    // Modelni IndexedDB'da saqlash uchun env konfiguratsiyasi
    env.useBrowserCache = true;       // Browser cache (Cache API) ishlatish
    env.useIndexedDB    = true;       // IndexedDB'da weights saqlash
    env.cacheDir        = "ai-radar"; // Maxsus namespace

    // Faqat bir marta yuklab, keyingi ishga tushirishda cache'dan olinadi
    env.allowLocalModels = false;     // lokal fayl yo'l kerak emas
    env.allowRemoteModels = true;     // HuggingFace Hub'dan yuklab olish

    // Chunk yo'l kesib olish optimizatsiyasi
    env.remoteHost = "https://huggingface.co";
    env.remotePathTemplate = "{model}/resolve/{revision}/";
  } catch {}
}

// ─── MODEL INITIALIZATION ──────────────────────────────────────────────────
async function initModel() {
  if (isLoading || isReady) return;
  isLoading = true;

  postMessage({ type: "status", state: "loading", progress: 0 });

  try {
    // 1. Transformers.js yuklab olish
    postMessage({ type: "status", state: "loading", progress: 5, msg: "Transformers.js yuklanmoqda..." });
    await loadTransformers();

    if (!pipelineFn) throw new Error("pipeline funksiyasi topilmadi");

    // 2. Cache sozlash
    setupModelCache();

    // 3. Eng yaxshi qurilmani aniqlash (WebGPU PRIMARY execution provider)
    deviceType = await detectBestDevice();
    postMessage({ type: "status", state: "loading", progress: 15, msg: "Qurilma: " + deviceType.toUpperCase() });

    // 4. PRIMARY: tezkor kichik model (Falconsai) — har doim quantized (q8)
    // STAGE 1 FIX: quantized:true MAJBURIY — CPU'da ham, GPU'da ham
    // chunki q8 4x kichik vazn = 4x tezroq yuklash + kam RAM
    const modelCfg = MODEL_CONFIG.primary;
    postMessage({ type: "status", state: "loading", progress: 20, msg: "Tezkor model yuklanmoqda (~15-20MB)..." });

    const basePipelineOptions = {
      device: deviceType,
      dtype: "q8",        // MAJBURIY quantized — barcha qurilmalarda (tezlik ustuvor)
      quantized: true,    // legacy flag, ba'zi versiyalar buni talab qiladi
      progress_callback: (progress) => {
        if (progress.status === "downloading" || progress.status === "fetching" || progress.status === "progress") {
          const pct = progress.loaded && progress.total
            ? Math.round((progress.loaded / progress.total) * 70) + 20
            : 50;
          postMessage({
            type: "status",
            state: "loading",
            progress: Math.min(pct, 90),
            msg: "Model: " + (progress.file || "") + " (" + (pct - 20) + "%)",
          });
        }
      },
    };

    try {
      pipeline = await pipelineFn(modelCfg.task, modelCfg.id, basePipelineOptions);
      activeModelId = modelCfg.id;
      postMessage({ type: "status", state: "loading", progress: 95, msg: "Model tasdiqlash..." });
    } catch (primaryErr) {
      // Primary (tezkor) model yuklanmasa — fallback (aniqroq, sekinroq) bilan urinish
      postMessage({ type: "status", state: "loading", progress: 70, msg: "Fallback model urinish..." });
      try {
        const fallbackCfg = MODEL_CONFIG.fallback;
        pipeline = await pipelineFn(fallbackCfg.task, fallbackCfg.id, {
          device: "cpu", // fallback har doim CPU (xavfsizroq)
          dtype: "q8",
          quantized: true,
          progress_callback: basePipelineOptions.progress_callback,
        });
        activeModelId = fallbackCfg.id;
      } catch (fallbackErr) {
        throw new Error("Barcha modellar yuklanmadi: " + primaryErr.message);
      }
    }

    // 5. Warm-up inference (1x1 test rasm bilan — JIT optimallashtirish)
    try {
      const warmup = new OffscreenCanvas(INFERENCE_SIZE, INFERENCE_SIZE);
      const wCtx = warmup.getContext("2d");
      wCtx.fillStyle = "#888"; wCtx.fillRect(0, 0, INFERENCE_SIZE, INFERENCE_SIZE);
      const blob = await warmup.convertToBlob({ type: "image/jpeg", quality: 0.5 });
      const url  = URL.createObjectURL(blob);
      await pipeline(url);
      URL.revokeObjectURL(url);
    } catch {}

    isReady  = true;
    isLoading = false;
    postMessage({ type: "status", state: "ready", device: deviceType, model: activeModelId, progress: 100 });

    // Kutayotgan so'rovlarni qayta ishlash
    while (pendingQueue.length) {
      const msg = pendingQueue.shift();
      await processMessage(msg);
    }

  } catch (err) {
    isLoading = false;
    loadError = err.message;
    postMessage({ type: "status", state: "error", error: err.message });
    // Xato holatida ham kutayotgan so'rovlarga null javob
    while (pendingQueue.length) {
      const msg = pendingQueue.shift();
      postMessage({ type: "result", id: msg.id, error: "Model yuklanmadi: " + err.message, preds: null });
    }
  }
}

// ─── IMAGE PROCESSING ──────────────────────────────────────────────────────
/**
 * ImageData yoki ImageBitmap dan Blob yaratib pipeline ga uzatish
 * Transformers.js pipeline URL, Blob, yoki ImageBitmap qabul qiladi
 */
async function imageDataToBlob(imageInput) {
  // ImageBitmap holati (createImageBitmap() bilan yaratilgan)
  if (imageInput instanceof ImageBitmap) {
    const canvas = new OffscreenCanvas(imageInput.width, imageInput.height);
    const ctx = canvas.getContext("2d");
    ctx.drawImage(imageInput, 0, 0);
    return canvas.convertToBlob({ type: "image/jpeg", quality: 0.85 });
  }

  // ImageData holati ({data: Uint8ClampedArray, width, height})
  if (imageInput && imageInput.data && imageInput.width && imageInput.height) {
    const canvas = new OffscreenCanvas(imageInput.width, imageInput.height);
    const ctx = canvas.getContext("2d");
    const imgData = new ImageData(
      new Uint8ClampedArray(imageInput.data), // transferable arrayBuffer'dan
      imageInput.width,
      imageInput.height
    );
    ctx.putImageData(imgData, 0, 0);
    return canvas.convertToBlob({ type: "image/jpeg", quality: 0.85 });
  }

  // Base64 data URL holati
  if (typeof imageInput === "string" && imageInput.startsWith("data:image/")) {
    const res  = await fetch(imageInput);
    return res.blob();
  }

  // URL string holati
  if (typeof imageInput === "string") {
    return imageInput; // Pipeline URL ni to'g'ridan-to'g'ri qabul qiladi
  }

  throw new Error("Noma'lum rasm formati");
}

/**
 * Model chiqishini standart { Porn, Sexy, Hentai, Neutral } formatiga o'tkazish
 */
function normalizePredictions(rawOutput, modelId) {
  const preds = { Porn: 0, Sexy: 0, Hentai: 0, Neutral: 1 };
  if (!Array.isArray(rawOutput)) return preds;

  // ModelConfig dan labelMap olish
  const cfg = Object.values(MODEL_CONFIG).find(c => c.id === modelId) || MODEL_CONFIG.primary;
  const labelMap = cfg.labelMap || {};

  let mapped = false;
  for (const item of rawOutput) {
    const rawLabel = (item.label || "").toLowerCase().replace(/\s+/g, "_");
    const score    = item.score || 0;
    // Label mapping orqali standart formatga o'tkazish
    for (const [pattern, target] of Object.entries(labelMap)) {
      if (rawLabel.includes(pattern)) {
        preds[target] = Math.max(preds[target] || 0, score);
        if (target !== "Neutral") { preds.Neutral = Math.max(0, preds.Neutral - score); }
        mapped = true;
      }
    }
    // Direct label mapping (ehtimoliy to'g'ridan-to'g'ri mos kelish)
    if (!mapped) {
      if (rawLabel === "nsfw" || rawLabel === "porn") preds.Porn = Math.max(preds.Porn, score);
      else if (rawLabel === "sexy" || rawLabel === "suggestive") preds.Sexy = Math.max(preds.Sexy, score);
      else if (rawLabel === "hentai" || rawLabel === "anime") preds.Hentai = Math.max(preds.Hentai, score);
      else if (rawLabel === "neutral" || rawLabel === "normal" || rawLabel === "safe") preds.Neutral = Math.max(preds.Neutral, score);
    }
  }

  // Normalizatsiya (yig'indi 1 bo'lishi kerak)
  const total = Object.values(preds).reduce((a, b) => a + b, 0);
  if (total > 0) Object.keys(preds).forEach(k => { preds[k] = preds[k] / total; });

  return preds;
}

// ─── MAIN INFERENCE FUNCTION ───────────────────────────────────────────────
async function runInference(imageInput) {
  if (!pipeline) throw new Error("Pipeline tayyor emas");

  // Rasmni pipeline formatiga o'tkazish
  const imgSource = await imageDataToBlob(imageInput);

  // Blob → object URL (pipeline URL ni talab qilishi mumkin)
  let url = null;
  try {
    if (imgSource instanceof Blob) {
      url = URL.createObjectURL(imgSource);
    }
    // Inference — topk:2 yetarli (Porn/Hentai/Sexy/Neutral 2 tasi eng baland bo'lsa kifoya)
    const rawOutput = await pipeline(url || imgSource, { topk: 4 });
    return normalizePredictions(rawOutput, activeModelId || MODEL_CONFIG.primary.id);
  } finally {
    if (url) { try { URL.revokeObjectURL(url); } catch {} }
  }
}

// ─── STAGE 1: Throttle-aware Message Handler ───────────────────────────────
// Main thread'dan kelgan { type:"throttle", mode } signaliga binoan
// Worker o'z navbatini boshqaradi — bu Device Protection Engine bilan integratsiya
let _processingActive = false;

async function processMessage(msg) {
  if (msg.type !== "classify") return;
  const { id, imageData } = msg;

  // RED ZONE: Worker butunlay to'xtatilgan — darhol "throttled" javob
  if (throttleMode === "suspend") {
    postMessage({ type: "result", id, error: "throttled-suspend", preds: null });
    return;
  }

  // YELLOW ZONE: yangi so'rovlar navbatga qo'yiladi, lekin ishlov berilmaydi
  // (main thread allaqachon Stage3 ni chaqirmasligi kerak, lekin xavfsizlik uchun
  //  bu yerda ham tekshiramiz)
  if (throttleMode === "pause") {
    throttledQueue.push(msg);
    // throttledQueue cheksiz o'smasligi uchun cheklov
    if (throttledQueue.length > 50) {
      const dropped = throttledQueue.shift();
      postMessage({ type: "result", id: dropped.id, error: "throttled-dropped", preds: null });
    }
    return;
  }

  if (!isReady || !pipeline) {
    postMessage({ type: "result", id, error: "Model tayyor emas", preds: null });
    return;
  }

  try {
    const preds = await runInference(imageData);
    postMessage({ type: "result", id, preds });
  } catch (err) {
    postMessage({ type: "result", id, error: err.message, preds: null });
  }
}

// Navbatdagi (throttled) so'rovlarni qayta ishga tushirish (normal rejimga qaytganda)
async function drainThrottledQueue() {
  while (throttledQueue.length && throttleMode === "normal") {
    const msg = throttledQueue.shift();
    await processMessage(msg);
  }
}

// ─── onmessage ENTRY POINT ─────────────────────────────────────────────────
self.onmessage = async (event) => {
  const msg = event.data;
  if (!msg || !msg.type) return;

  // Init buyrug'i
  if (msg.type === "init") {
    initModel();
    return;
  }

  // STAGE 1: Throttle signal — Device Protection Engine'dan keladi
  if (msg.type === "throttle") {
    const prevMode = throttleMode;
    throttleMode = msg.mode || "normal";
    if (prevMode !== "normal" && throttleMode === "normal") {
      // Yellow/Red dan Normal ga qaytganda navbatni bo'shatish
      drainThrottledQueue();
    }
    if (throttleMode === "suspend") {
      // Red zone: navbatdagi barchasiga darhol javob (memory bo'shatish)
      while (throttledQueue.length) {
        const dropped = throttledQueue.shift();
        postMessage({ type: "result", id: dropped.id, error: "throttled-suspend", preds: null });
      }
    }
    return;
  }

  // Classify so'rovi
  if (msg.type === "classify") {
    if (!isReady) {
      // Model hali yuklanmagan — navbatga qo'shish
      if (!isLoading) initModel();
      pendingQueue.push(msg);
    } else {
      await processMessage(msg);
    }
    return;
  }

  // Holat so'rovi
  if (msg.type === "status_query") {
    postMessage({
      type: "status",
      state: isReady ? "ready" : isLoading ? "loading" : (loadError ? "error" : "idle"),
      device: deviceType,
      model: activeModelId,
      error: loadError,
    });
    return;
  }

  // Worker yopish
  if (msg.type === "terminate") {
    self.close();
  }
};

// ─── AUTO-INIT ─────────────────────────────────────────────────────────────
// Worker yaratilishi bilan model yuklanishni boshlash
initModel();
