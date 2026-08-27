# SafeNet Browser — AI Brain Integratsiyasi

**Sana:** 2026-07-04
**Brauzer:** `D:\BRAUZER`
**AI Manba:** `D:\BRAUZER\mvp_uchun_miya\src\ai-brain\`

## Arxitektura

```
Browser DOM
    ↓
main.js (Electron main process)
    ├─ CSP header strip (nsfwjs model weights fetch uchun)
    ├─ Popup intercept (target=_blank → yangi tab, yangi oyna emas)
    ├─ TF.js code inject (executeJavaScript orqali, CSP chetlab)
    ├─ nsfwjs code inject (executeJavaScript orqali)
    ├─ KB inject (window.__CIA_KB_ENC_B64 orqali)
    └─ monitor.js inject
                ↓
        AIBrain.start()  (bitta entry point)
                ↓
    ┌───────────────┴───────────────┐
    │                               │
Text Pipeline           Image Pipeline           Video Pipeline
brain.analyzeContent   brain.analyzeImageFull    brain.analyzeVideoPoster
+ semantic-analyzer    (VisionAnalyzer +         + frame-scanner (2 consec)
+ 9 til qo'llab-       NSFW.js MobileNetV2)      + killVideoElement (7 qatlam)
quvvatlash              + skin heuristic fallback
    │                       │                          │
    └───────────────┬───────┴──────────────────────────┘
                    ↓
            Decision Engine
                    ↓
        ┌───────────┴───────────┐
        ↓                       ↓
    Shield UI              Web Search fallback
    (Overlay + block)      (DuckDuckGo + Wikipedia
                            → bilmagan so'zlar uchun)
```

## Fayl ma'lumotlari

| Fayl | Hajmi | Vazifasi |
|------|-------|----------|
| `main.js` | 103 KB | Electron main process (AI integratsiya bilan) |
| `monitor.js` | 116 KB | AI Brain bundle (54 modul, brain.ts integratsiyasi) |
| `kb.enc` | 5.1 MB | Encrypted Knowledge Base |
| `preload.js` | 8 KB | IPC bridge |
| `ai/tf.min.js` | ~1.4 MB | Birinchi run'dan keyin yaratiladi (CDN cache) |
| `ai/nsfwjs.min.js` | ~15 KB | Birinchi run'dan keyin yaratiladi |

## AI Brain modul haritasi

**36 ta modul, `D:\BRAUZER\mvp_uchun_miya\src\ai-brain\`:**

### Adapters (content-insight-ai/lib ga ko'prik)
- `adapters/brain-adapter.ts` — brain.ts to'liq API (analyzeContent, analyzeImageFull, analyzeVideoFull, searchWeb, learning)
- `adapters/semantic-adapter.ts` — 9 tilli semantic tahlil

### Image Pipeline
- `image/scanner.ts` — DOM `<img>`, Shadow DOM, lazy load
- `image/brain-processor.ts` — brain.analyzeImageFull (VisionAnalyzer + NSFW.js)
- `image/skin-tone.ts` — fallback heuristic
- `image/queue.ts` — parallel MAX_CONCURRENT_AI=2

### Video Pipeline
- `video/scanner.ts` — `<video>` va Instagram/TikTok reels
- `video/brain-processor.ts` — brain.analyzeVideoPoster + analyzeVideoFull
- `video/frame-scanner.ts` — 8s intervalda kadr olib brain'ga uzatadi (2 ketma-ket harmful → block)
- `video/killer.ts` — 7 qatlamli video o'chirish (YouTube ichki API'sini yengish)

### Text Pipeline
- `text/scanner.ts` — leaf elementlar (katta container blur qilinmaydi)
- `text/brain-processor.ts` — brain.analyzeContentSmart
- `text/analyzer.ts` — HARD/SOFT keyword tekshirish (tez path)
- `text/web-lookup.ts` — DuckDuckGo Instant Answer (bilmagan so'zlar)
- `text/keywords.ts` — kalit so'zlar katalogi (kengaytirilgan)

### YouTube
- `youtube/entry-scanner.ts` — ytd-video-renderer, ytd-rich-item-renderer va boshqa 8 renderer
- `youtube/shields.ts` — YT entry + player shield (hover preview himoyasi)
- `youtube/selectors.ts` — DOM selektor'lar

### Observers
- `observers/mutation.ts` — SPA / Ajax / infinite scroll
- `observers/navigation.ts` — history.pushState + yt-navigate-finish
- `observers/scroll.ts` — scroll debounce

### Engine
- `engine/orchestrator.ts` — dirigent (start() → barcha pipelinelar)
- `engine/state.ts` — global state (STATE, VIDEO_TIMERS, FRAME_HISTORY)

### Block
- `block/shield.ts` — umumiy shield UI
- `block/styles.ts` — CSS
- `block/events.ts` — click/hover/context menu interceptor (14 event)

### Domains, Models, Utils
- `domains/blocked.ts` — 50+ zararli sayt
- `domains/whitelist.ts` — ishonchli saytlar
- `models/nsfw-loader.ts` — model lazy load + waitForModel(8s)
- `utils/dom.ts`, `utils/logger.ts`, `utils/helpers.ts` — pure helpers

## AI Brain funksionallik (content-insight-ai/lib dan)

97% laboratoriya sifatidagi to'liq ulangan modullar:

| brain.ts funksiya | Ishlatiladigan joy | Vazifasi |
|-------------------|---------------------|----------|
| `analyzeContent` | text/brain-processor | Sinxron matn tahlili |
| `analyzeContentSmart` | text/brain-processor | Auto-research + web'dan qidiruv |
| `analyzeImageFull` | image/brain-processor | Vision + NSFW.js kombinatsiyasi |
| `analyzeVideoPoster` | video/brain-processor | Video preview tekshiruvi |
| `analyzeVideoFull` | video/brain-processor | 8 kadr to'liq tahlil |
| `searchWeb` | text/web-lookup | DuckDuckGo + Wikipedia |
| `initializeSharedLearning` | engine/orchestrator | Cross-user learning boshlash |
| `learnFromUserFeedback` | (kelajakda UI) | Foydalanuvchi tuzatishlaridan o'rganish |
| `getBrainStatus` | engine/orchestrator | Startup log |

## Muhim: brain.ts Supabase'ga bog'liq EMAS

Barcha ishlatiladigan funksiyalar to'liq LOKAL:
- Vision analyzer — canvas + skin distribution + face detection (mahalliy)
- NSFW.js — MobileNetV2 model, weights CDN'dan (yoki cache)
- Semantic analyzer — 9 tilli tokenizatsiya, stem, entity recognition
- Web search — DuckDuckGo Instant Answer API (bepul) + Wikipedia REST API (bepul)
- Learning — localStorage'da saqlanadi

## main.js integratsiya nuqtalari

1. **Startup (`loadAIScripts()`):** TF.js va nsfwjs kodini disk'dan (`ai/`) yoki CDN'dan yuklaydi
2. **Har navigatsiyada (monitor inject):**
   - `window.__CIA_KB_ENC_B64` set
   - `executeJavaScript(TFJS_CODE)`
   - `executeJavaScript(NSFWJS_CODE)`
   - `executeJavaScript(MONITOR_JS)` — AI Brain start()
3. **`setWindowOpenHandler`:** target=_blank → yangi tab (yangi Electron oyna emas)
4. **`did-create-window`:** har qanday yangi child window darhol yopiladi
5. **`session.webRequest.onHeadersReceived`:** CSP header'lar strip (nsfwjs model weights fetch uchun)

## Verifikatsiya

Brauzerni yopib, qayta oching. Terminal quyidagilarni ko'rsatishi kerak:
```
OK contentfilter.js ... bayt
OK monitor.js 116596 bayt
OK kb.enc 5100 KB
OK tf.min.js (CDN) 1400 KB       ← birinchi run
OK nsfwjs.min.js (CDN) 15 KB
OK CSP strip faol
```

Keyingi run'larda `(local)` chiqadi — cache'dan yuklanadi, internet talab qilinmaydi.

DevTools Console (F12):
```
[CIA] 🚀 AI Brain v3.0.0
[CIA] 🧠 Shared learning initialized
[CIA] 🧠 Brain status: {version: '...', knowledge_nodes: X, ...}
[CIA] ✅ NSFW model tayyor
```

Har rasm/video uchun:
```
[CIA] 🧠 brain harmful score=87% → HARM (Explicit content detected)
[CIA] 🛡️ YT Entry: AI: harmful 87%
```

## Cheklovlar va kelajak ishlar

- **Feedback UI** — hozir `learnFromUserFeedback()` API tayyor, lekin foydalanuvchi UI (o'ng tugma → "Noto'g'ri bloklandi") kelajakda qo'shiladi
- **Vision analyzer** — dinamik import bilan yuklanadi (bundle hajmi kamayadi)
- **Shared learning** — hozircha faqat lokal `localStorage`. Cross-device sync uchun keyingi versiyada
- **Web search** — DDG rate limit ~100 req/soniya. Cache 24 soat
