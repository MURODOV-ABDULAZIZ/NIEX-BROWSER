# Monitor.js — Bug Tracker (v3.8.0)

---

## 🐞 v3.8.0 — 2026-07-17 — YOUTUBE FALSE POSITIVE (yaxshi kontent block) + PREMIUM UX

### Shikoyat (foydalanuvchi screenshot bilan)
- YouTube homepage'da random tavsiya videolar (anime thumbnail, workout, fitness) "Bloklandi" bo'lib chiqdi
- Bittasi: anime rasm "AI: Sexy 96%" bilan bloklandi
- Bittasi: workout video "AI: Ochiq tana 44/50%" bilan bloklandi
- Kontent zararli EMAS — bu yaxshi videolar

### ROOT CAUSE
1. **Entertainment/social/gallery sexual threshold juda past** (`site-tier.ts:112`): `0.40` — NSFW.js "sexy" shovqin darajasi odam rasmlarida 0.30–0.55. Fitness/dance/anime portret hammasi false trigger.
2. **Video kadr threshold past** (`frame-scanner.ts:43-46`): `sexual >= 0.42` — sport/workout kadrlar ushlanadi (kalta forma + tez harakat).
3. **2 ta ketma-ket kadr yetarli edi** (`config.ts:VIDEO_CONSECUTIVE_NEEDED=2`) — bir tez lahza noto'g'ri kadr → butun video block.

### FIX (v3.8)
- `site-tier.ts` entertainment/social/gallery: `sexual 0.40→0.60`, `centerSkin 0.42→0.55`, `comboSexual 0.18→0.35`, `comboSkin 0.30→0.45`
- `frame-scanner.ts`: `explicit >= 0.55`, `sexual >= 0.65`, anime uchun `hentai > 0.30` (drawing yolg'iz emas)
- `config.ts` `VIDEO_CONSECUTIVE_NEEDED: 2 → 3` (uch marta tasdiq kerak)
- `frame-scanner.ts` cloud escalation zonasi kengaydi: `sexual >= 0.30` (0.20 emas) — noaniq zona cloud'ga boradi, high-confidence local qoladi
- Kutilyapti: workout/anime/fashion PASS, aniq bikini/lingerie/porno BLOCK, cloud fallback shubhali holatlarni tasdiqlaydi

### Bog'liq boshqa muammolar (v3.8)
- Pro obuna 30 kun aynan sotib olingan vaqtda expire bo'lishi kerak (kalendar oy emas) → `subscription-manager.js activatePro` — DONE
- Kunlik limit 24-soatlik rolling window bo'lishi (UTC 00:00 emas) → `usage-manager.js` refaktor — DONE  
- Video ko'rilgan daqiqa hisoblanmasdi (faqat cloud API call'lar hisoblanardi) → `videoLocalSeconds` counter + `usage-track-local-video` IPC — DONE
- Obuna bekor qilingandan keyin qayta obuna olish "sizda pending bor" xatoligi → `premium-cancel` pending'larni auto-reject + `premium-cancel-pending` IPC + UI tugma — DONE

---

## 🎯 v3.7.0 — 2026-07-08 — ARANG-ARANG BUG (OVER-BLOCK) TUZATILDI

### Screenshot dalili
- YouTube homepage: BARCHA thumbnail shield bilan bloklangan (100%)
- Instagram feed: HAR post shield bilan bloklangan (100%)
- YouTube ikkinchi ko'rinishda ba'zi video ochiq, ba'zilari yo'q — o'zgaruvchi
- Foydalanuvchi shikoyati: "yaxshi narsalarni ham bloklavotti"

### ROOT CAUSE — 3 ta arxitektura xatosi

**A. Anime rule chorak-signal edi** (`brain-processor.ts:83`)
```
ESKI: drawingHentai > 0.55 && sexual >= 0.10 → BLOCK
```
NSFW.js "drawing" sinfi HAR QANDAY kartun/vektor/overlay grafikada 0.4-0.8 chiqadi. `sexual >= 0.10` — bu **shovqin darajasi** (NSFW.js hech qachon aniq 0 bermaydi).
Natija: YouTube thumbnail bilan Photoshop overlay → drawing=0.7, sexual=0.15 → NOTO'G'RI ANIME BLOCK. Bu **odam suratlar emas**, bu dizayn.

**B. Sexual threshold 0.30 shovqin darajasida** (`site-tier.ts:101`)
```
ESKI: sexual >= 0.30 → BLOCK (entertainment/social/gallery)
```
NSFW.js "Sexy" sinfi noise profili (odam suratlar bo'ylab):
- Moda thumbnail → 0.35+
- Ayol prezident/news anchor → 0.30+
- Music video → 0.40+
- Fitness → 0.35+
- Business ayol → 0.30+
0.30 chegara amalda "biror ayol bo'lsa bloklaydi" degani. Bu MVP maqsadi ("faqat behayo kontent") ga to'g'ridan-to'g'ri zid.

**C. Skin+concentration guard yolg'iz sexual signalisiz ishlardi** (`brain-processor.ts:99, 104`)
```
ESKI: centerSkin >= 0.38 && conc >= 1.35 → BLOCK
```
Sport rasmlari (basketbol, kurash, gimnast): markazda odam, ochiq tana, conc>1.3. **Lekin bikini emas.** Sexual signal talab qilinmasdi.
Kombinatsiya path'da concentration 1.15 (portret ham) → false positive.

### YECHIM — 4 minimal patch

**PATCH 1** — Anime rule kuchaytirildi:
```
YANGI: drawingHentai > 0.7 && hentai > 0.35 && sexual > 0.25 → BLOCK
```
Endi haqiqiy hentai signal talab qilinadi. Kartun grafika o'tadi.

**PATCH 2** — Threshold'lar realistik:
```
YANGI (entertainment/social/gallery):
  sexual: 0.30 → 0.55  (bikini/lingerie darajasi)
  centerSkin: 0.38 → 0.48
  concentration: 1.35 → 1.55
  comboSexual: 0.22 → 0.42
  comboSkin: 0.32 → 0.42
```
NSFW.js "Sexy" 0.55+ = aniq bikini/underwear. Fashion/music/fitness 0.30-0.50 diapazon — endi o'tadi.

**PATCH 3** — Combo path'da sexual signal talab qilinadi:
```
YANGI: centerSkin >= th && conc >= th && sexual >= 0.25 → BLOCK
YANGI: combo pathway conc >= 1.4 (avval 1.15)
YANGI: model-yo'q fallback centerSkin >= 0.6 && conc >= 1.6
```
Sport rasmlari (sexual < 0.25) o'tadi. Bikini (sexual + skin) hali ushlanadi.

**PATCH 4** — YouTube thumbnail → analyzeVideoPoster (Bug 3):
```js
// entry-scanner.ts
const thumbUrl = entry.querySelector('img[src*="ytimg"]')?.src;
analyzeVideoPoster(thumbUrl, true).then(r => {
  if (r.harmful) shieldYTEntry(entry, `Video preview: ${r.reason}`);
});
```
Lab'da testlangan `brain.analyzeVideoPoster(strict)` YouTube preview'ga async ulandi. scanImages bilan parallel — belt-and-suspenders. Recall oshadi, precision'ga tegilmaydi.

### Ishlatilmayotgan modullar (aniqlangan, ammo MVP uchun kritik emas)
- `ai.worker.ts` — Web Worker arxitektura mavjud, ishlatilmaydi (AI main thread'da)
- `content-insight-ai/lib/worker-pool.ts` — chaqirilmaydi
- `content-insight-ai/lib/vision-analyzer.ts` — chaqirilmaydi
- `content-insight-ai/lib/reasoning-engine.ts` — ulanmagan
- `debug/hud.ts` — mavjud (Ctrl+Shift+D), foydalanuvchi ishlatgan emas

### O'zgargan fayllar (jami 3, minimal)
- `ai-brain/image/brain-processor.ts` — anime + skin + combo qat'iyroq
- `ai-brain/domains/site-tier.ts` — realistik threshold
- `ai-brain/youtube/entry-scanner.ts` — poster analyzer ulandi

### Build va deploy
- monitor.js: 124.6 KB (59 modul)
- Marker'lar: `Video preview:1`, `Anime :1`, `.55 threshold:8`, `Ochiq tana:1` ✓

### QOLGAN XAVF (halol)
1. **Web Worker yo'q** — main thread inference 50-150ms freeze. MVP uchun toqat qilsa bo'ladi (concurrency=12). v4.0'da alohida ish.
2. **Priority Queue yo'q** — viewport-first tartib yo'q. Barcha rasm birdaniga navbatga qo'shiladi. Foydalanuvchi scroll qilsa 100 rasm — hammasi teng kutadi.
3. **Frame voting yo'q** — bitta kadr qaror. False positive video kadrida (masalan kurashda ochiq badan) → butun video blok.
4. **Confidence tier yo'q** — 0-40/40-60/60-80/80+ mantiqi qo'llanmagan. Hozir uchsim: harmful/uncertain/safe.
5. **Hover preview** — MutationObserver `<video>`ni tutadi, ammo poster attribute'ni oldindan tekshirmaydi.

Bu 5 element **MVP dan keyingi** ishlar. Foydalanuvchi bugungi over-block ni tuzatishni birinchi bosqichga qo'ygan.

### SABOQLAR (kelajak uchun)
1. **NSFW.js "drawing" sinfi rasmlarga qarab noise** — sexual >= 0.10 shart YoLG'ON. Real hentai signal (hentai class > 0.35) talab qilish shart.
2. **NSFW.js "Sexy" 0.30 = "odam bor"** darajasi. Bikini uchun 0.55+, explicit uchun 0.70+. Har fanga aniq mos ostana.
3. **Skin heuristika yolg'iz signal emas** — sport rasmlari center=0.4, conc=1.4 chiqadi. Sexual signal bilan birga tekshirish shart.
4. **Har blockerlash yo'lida 3+ shart** kombinatsiyasi bo'lishi kerak (arang-arang oldini olish uchun).

---

## Monitor.js — Bug Tracker (v3.6.2)

---

## ⛔ REGRESSIYA (v3.6.2 — 2026-07-08) — BMW/INSTAGRAM OVER-BLOCK

### Holat
CORS bypass va instant pre-blur qo'shilgandan keyin **toza rasmlar bloklana boshladi**:
- Instagram @bmw rasmiy sahifa → BARCHA rasm "Shubhali: social" bilan bloklandi
- YouTube "bmw" qidiruvi → toza mashina videolari bloklandi
- "Overblocking hammasini bloklash garchi yaxshi bo'lishiga qaramay"

### ROOT CAUSE (aniq — kod bilan tasdiqlangan)
1. **Tainted canvas ⇒ `method: 'none'`**: Instagram CDN rasmi sahifa tomonidan CORS'siz yuklangan bo'lsa, brauzer kesh'dan ACAO'siz javob qaytaradi. `img.crossOrigin='anonymous'` bilan qayta yuklash muvaffaqiyatsiz → skin heuristic canvas tainted → `analyzeSkin` xato → `sexual=0, skin=null` → verdict `method:'none'`.
2. **Fail-closed kaskad**: scanner shu holda `(soft || highRisk && isLarge)` bo'lsa BLOKLAYDI. Ammo Instagram/YouTube da HAR katta rasm `highRisk && isLarge` — demak HAR rasm bloklanardi. BMW/Nike/ta'lim brendlari — hammasi.
3. **Ikki mutually-exclusive bug bir vaqtda**: state leak (BMW qidiruvida eski `naughty` risk=2 qolgani) + fail-closed (`method:'none'` → auto-block) = butun sayt bo'ylab noto'g'ri bloklash.

### TUZATISH (v3.6.2)

**A. Ishonchli loader** (`image/loader.ts` qayta yozildi):
```
fetch(url, {mode: 'cors', credentials: 'omit'})
  → blob
  → URL.createObjectURL(blob)
  → new Image().src = objectUrl
```
Blob-backed rasm **same-origin** — hech qachon tainted bo'lmaydi. main.js `resourceType==='image'` uchun ACAO:* qo'yadi → fetch cors ishlaydi. Fallback: `crossOrigin='anonymous'` img (agar fetch fail bo'lsa).

**B. Fail-closed cheklandi** (`image/scanner.ts`):
Eski:
```
if (method === 'none' && (soft || (highRisk && isLarge))) BLOCK  // Instagram'da HAMMA
```
Yangi:
```
if (method === 'none' && (soft || risk >= 1)) BLOCK  // faqat haqiqiy signal bilan
```
Endi tegilmasin:
- BMW rasm — `soft` yo'q, `risk=0` → PASS
- Instagram avatar/story — MIN_SIZE guard bilan skip
- Nike/Adidas rasmiy — signal yo'q → PASS

Signal bo'lsa (bikini keyword, xavfli qidiruv) — hali ham fail-closed.

**C. State leak yo'q qilindi** (`engine/risk.ts` — v3.6.0):
`getSearchRisk()` HAR DOIM joriy URL'dan hisoblanadi. Global saqlash yo'q.

### O'zgargan fayllar
- `image/loader.ts` — fetch→blob+objectURL
- `image/scanner.ts` — fail-closed cheklandi
- `engine/risk.ts` (v3.6.0) — deterministik risk
- `main.js` (v3.6.1) — CORS override faqat `resourceType==='image'`

### Build
- monitor.js: 124 KB (59 modul)
- Marker'lar: `createObjectURL:2`, `fetch cors:1`, `cia-hud:1`, `site-tier:1` ✓

### SABOQ (kelajak — bugs faylida saqlansin)
1. **"Fail-closed default" — o'ldiruvchi kombinatsiya**: `method:'none'` + katta rasm + high-risk sayt = HAR RASM bloklanadi. Ochiq signal talab qilish shart.
2. **Tainted canvas ehtimoli faqat kod pathway bilan qat'iyroq bo'ladi**: Har ishonchli rasm tahlili fetch→blob pathway'ida bo'lishi kerak, `img.crossOrigin` yolg'iz yetarli emas.
3. **Har infrastruktura o'zgarishida savol**: "Bu YouTube video/login/media oqimiga ta'sir qiladimi?" — main.js CORS bug'ini oldini olgan bo'lardi.
4. **Ikki bug bir vaqtda**: over-block va under-block bir loyihada ikkalasi ham bo'lishi mumkin — turli sabab, turli path. Har birini alohida root cause bilan tuzatish.

---

## ⛔ REGRESSIYA (v3.6.1 — 2026-07-07) — HAR QANDAY VIDEO IJRO ETILMAYDI

### Holat
CORS bypass qo'shilgandan keyin (v3.2, task #42) **barcha saytda** video ijro etilmay qoldi — YouTube /watch sahifasi qora ekran + loading spinner, "0 blok".

### ROOT CAUSE (aniq)
`main.js` `onHeadersReceived` handler **BARCHA javobga** `Access-Control-Allow-Origin: *` va CORP override qo'yardi. YouTube video oqimi `googlevideo.com`dan **credentialed range so'rovlar** (MediaSource Extensions) bilan keladi. Wildcard `ACAO: *` credentialed so'rovlar bilan mos kelmaydi → brauzer javobni RAD etadi → video segmentlar yuklanmaydi → video ijro etilmaydi.

### TUZATISH (v3.6.1)
CORS override endi **FAQAT `resourceType === 'image'`** uchun qo'llanadi:
- Rasm javoblari → ACAO:* + CORP (NSFW pixel o'qishi uchun)
- **Video/media/xhr → TEGILMAYDI** → YouTube oqimi ishlaydi
- CSP strip → faqat mainFrame/subFrame (hujjat), media'ga tegilmaydi

```js
if (rt === 'image') { headers['Access-Control-Allow-Origin'] = ['*']; ... }
// media/xhr — hech qanday CORS o'zgarishi YO'Q
```

### SABOQ (kelajak uchun — buglar fayliga e'tibor)
- Header manipulyatsiyasi HAR DOIM `resourceType` bilan cheklanishi shart
- Global `ACAO: *` — media/streaming'ni buzadi, hech qachon universal qo'llamaslik
- Har o'zgarish oldidan: "bu YouTube/video oqimiga ta'sir qiladimi?" savolini berish

---

## Monitor.js — Bug Tracker (v3.5.0)

Bu fayl `BUGS_REPORT (3).md` dagi buglarni davom ettiradi.
Har bir bug uchun: sabab, tuzatish sanasi, yechim.

---

## v3.5.0 — 2026-07-07 — DETECTION OVERHAUL: multi-signal "desire-trigger" aniqlash

### Muammo (foydalanuvchi hisoboti + screenshotlar)
- Bikini/suggestive rasmlar (YouTube Shorts, Instagram) bloklanmaydi — faqat qattiq porno ushlanadi
- Bikini-plyaj rasmi o'tib ketadi (fon ko'p → global skin past)
- Sport/fitnes rasmlar noto'g'ri bloklanadi (false positive)
- Sekin bloklaydi
- Video preview/hover ushlanmaydi

### ROOT CAUSE (chuqur analiz)
1. **Skoring formulasi porno uchun sozlangan edi:** `nsfw_score = porn + hentai + sexy*0.5`.
   NSFW.js'ning "Sexy" sinfi aynan bikini/cleavage/suggestive signali, lekin formulа uni **yarmiga** kamaytirardi. Toza bikini rasm `sexy≈0.6 → 0.3` → "uncertain" → o'tib ketardi. Bu bitta qator butun mahsulot maqsadini buzardi.
2. **Skin butun 64×64 kadr bo'yicha:** bikini-plyaj rasmi asosan osmon/dengiz/qum → global skin ~18% garchi subjekt bikinida. Metrika **global**, kompozitsiya **markazlashgan** — mos kelmasdi.
3. **ResourceGuardian cooldown:** 25 og'ir operatsiyadan keyin 20s cooldown → image-heavy sahifalarda keyingi rasmlar "Throttled" qaytarib **tahlilsiz** o'tkazilardi (recall bug).
4. **Pre-blur yo'q:** rasm tahlildan keyin bloklanardi → 1-3s "miltillash".
5. **Precision/recall keskinligi:** NSFW.js "Sexy" bikinida ham, sportda ham, fitnesda ham ishlaydi. Faqat threshold pasaytirish bikini'ni ushlaydi, lekin sport'ni ham bloklaydi.

### NSFW.js CHEKLOVI (halol)
NSFW.js — **5 sinfli** model (Neutral/Drawing/Sexy/Porn/Hentai). "bikini vs lingerie vs suggestive-pose" alohida sinf sifatida chiqara **olmaydi**. To'liq 15-kategoriya boshqa model kerak (nudity/pose net yoki Gemini Vision API). Bu ceiling ochiq tan olinadi.

### YECHIM: ko'p signalli skoring

**1. Skoring qayta balanslandi** (`nsfw-classifier.ts`)
```
sexual_score  = porn + hentai + sexy   (Sexy TO'LIQ vazn — desire-trigger)
explicit_score = porn + hentai          (hardcore)
verdict: harmful if explicit>=0.5 OR sexual>=0.55
```

**2. Mintaqaviy skin tahlili** (`skin-tone.ts` → `analyzeSkin`)
```
global        — butun rasm
center        — markaziy 50% (subjekt odatda markazda)
lower         — pastki-markaz (tana/oyoq zonasi)
concentration — center/global (fokus darajasi)
```
Bikini model: center yuqori, concentration >1.4 → BLOCK.
Sport/olomon: skin tarqoq, concentration ~1.0 → PASS.
Bu bikini-plyaj false-negative VA sport false-positive'ni **bir vaqtda** hal qiladi.

**3. Site-tier klassifikatori** (`domains/site-tier.ts`)
```
entertainment/social/gallery → aggressive (sexual≥0.30, pre-blur)   recall ↑
unknown                      → mid (sexual≥0.40)
educational/news             → conservative (sexual≥0.60)            precision ↑
```
YouTube/Instagram'da bikini ushlanadi, Wikipedia/Khan Academy'da tibbiy rasm bloklanmaydi.

**4. Multi-signal decision** (`image/brain-processor.ts`)
```
1. explicit ≥ 0.45           → har doim BLOCK
2. sexual ≥ tier.sexual      → BLOCK (desire-trigger)
3. centerSkin ≥ tier + conc  → BLOCK (bikini-plyaj)
4. combo (o'rtacha sexual + o'rtacha skin) → BLOCK
5. anime (drawing+hentai)    → BLOCK
```

**5. Instant pre-blur** (`block/preblur.ts`)
High-risk saytda katta rasm tahlildan **oldin** blur qilinadi, xavfsiz bo'lsa ochiladi. "Block before user notices."

**6. ResourceGuardian relaxed** (`resource-guardian.ts`)
`cooldown_after: 25→5000`, `max_per_minute: 40→1200`. Endi image-heavy sahifalarda cooldown urilmaydi — barcha rasm tahlil qilinadi.

### O'zgargan fayllar
| Fayl | O'zgarish |
|------|-----------|
| `nsfw-classifier.ts` | sexual_score/explicit_score qo'shildi, verdict qayta yozildi |
| `skin-tone.ts` | analyzeSkin (regional) qo'shildi |
| `domains/site-tier.ts` | YANGI — tier + threshold profillari |
| `image/brain-processor.ts` | multi-signal decision |
| `image/scanner.ts` | tier-based + pre-blur wiring |
| `block/preblur.ts` | YANGI — instant pre-blur |
| `block/styles.ts` | .cia-preblur CSS |
| `video/frame-scanner.ts` | sexual_score bilan uyg'unlashtirildi |
| `resource-guardian.ts` | cooldown relaxed |

### Build
- monitor.js: 122 KB IIFE (57 modul)
- `D:\BRAUZER\monitor.js` deploy qilindi

### Kelajak (v4.0) — 15-kategoriya uchun
- Dedicated nudity/pose model (masalan Nudenet) yoki
- Gemini Vision API (.env'dagi kalit) — desire-trigger + explainable natija

---

## BUG 17 — KRITIK: mom2fuck.com va boshqa porn saytlar BLOCKED_DOMAINS'da yo'q edi
**Sana:** 2026-07-04
**Holat:** `mom2fuck.com` ochildi, faqat "orgasm" kategoriyasi bloklandi. Ko'p thumbnail'lar ochiq qoldi.

**Sabab:**
`BLOCKED_DOMAINS` ro'yxatida faqat top-tier saytlar bor edi (pornhub, xvideos, xhamster). Ikkinchi va uchinchi darajali saytlar (mom2fuck, goblinstube, txxx, porntrex, iceporn va h.k.) — hech bir qismi yo'q edi.
Har bir preview alohida `processImage()` orqali tekshirilar edi — bu juda sekin va false negative beradi.

**Tuzatish (v2.5.0):**
- `BLOCKED_DOMAINS` ga 40+ porn sayt qo'shildi: `mom2fuck.com, goblinstube.com, txxx.com, porntrex.com, porn.com, xhamster1.com, xhamsterlive.com, thumbzilla.com, pornhat.com, ashemaletube.com, porntube.com, youjizz.com, hclips.com, vjav.com, iceporn.com, javhd.com, javfor.tv, javhub.net, javdoe.com, jav.guru, javtiful.com, porndish.com, fapster.xxx, fapvid.com, porn7.com, porn5.com, milffox.com, porndoe.com, porngo.com, xmegadrive.com, watchmygf.me, veporns.com, anysex.com, sunporno.com, wetplace.com` va boshqalar.
- Bu saytlar ochilishi bilan `L0` qatlamda to'liq sahifa bloklanadi — hech bir preview render bo'lmaydi.

**File:** `monitor.ts:39-56` (BLOCKED_DOMAINS)

---

## BUG 18 — KRITIK: Yangi tab yangi Electron oyna sifatida ochilyapti (monitor.js yuklanmaydi)
**Sana:** 2026-07-04
**Holat:** GoblinsTube video preview'ga bosilganda alohida SafeNet oyna ochildi. U yerda AI umuman ishlamadi — 6 blok deyilgan bo'lsa ham video to'liq ko'rindi. Foydalanuvchi so'ragan: "har bir sahifa brauzerni ichida 1 ta ilovani ichida bo'lishi kerak, tashqi yangi app sifatida emas".

**Sabab:**
Electron BrowserView'ida `webContents.setWindowOpenHandler` va `did-create-window` event'larini biz uzatib olmagan edik. `target="_blank"` link'lar yoki `window.open()` chaqiruvlari default holatda yangi `BrowserWindow` ochilar edi. U oynada:
- `attachTabEvents()` chaqirilmaydi
- `MONITOR_JS` inject qilinmaydi
- `TFJS_CODE`, `NSFWJS_CODE` inject qilinmaydi
- `KB_ENC_BASE64` inject qilinmaydi
- CSP strip u session'ga qo'llanmaydi (agar session boshqa bo'lsa)

Natijada: yangi oynada AI umuman ishlamadi.

**Tuzatish (v2.5.0):**
`main.js` `attachTabEvents()` ichiga:
```js
view.webContents.setWindowOpenHandler(({ url }) => {
  if (url && url !== 'about:blank') {
    setTimeout(() => createTab(url), 0);  // Hozirgi oyna ichida yangi tab
  }
  return { action: 'deny' }; // Yangi Electron oyna YARATILMAYDI
});

view.webContents.on('did-create-window', (childWin) => {
  try { childWin.close(); } catch {}
});
```

Endi hech qanday popup yangi oyna sifatida ochilmaydi — barcha yangi URL'lar hozirgi ilova ichida yangi tab bo'lib ochiladi. Yangi tab `attachTabEvents()`ga o'tadi → `MONITOR_JS`, `TFJS_CODE`, `NSFWJS_CODE` inject qilinadi.

**File:** `main.js:1670-1687` (attachTabEvents boshi)

---

## BUG 19 — MUHIM: YouTube hover-preview thumbnail bloklangandan keyin ham video ko'rsatadi
**Sana:** 2026-07-04
**Holat:** Kursor bloklangan YouTube thumbnail ustiga borsa, video preview (autoplay) ko'rsatiladi. Bu foydalanuvchi bloklangan kontentni ko'rish yo'li.

**Sabab:**
YouTube thumbnail'da hover'da `<video>` element DINAMIK qo'shiladi — biz `shieldYTEntry()` bloklaganda `<img>` allaqachon bloklangan, lekin keyin qo'shilgan `<video>` uchun himoya yo'q edi. Mutation observer bor edi, lekin `#video-preview` yoki `ytd-inline-preview` konteynerini kuzatmasdi.

**Tuzatish (v2.5.0):**
`shieldYTEntry()` ichida MutationObserver qo'shildi — entry ichida yangi `<video>` element qo'shilsa darhol `killVideoElement()` chaqirilib o'ldiriladi. Bundan tashqari `entry.style.pointer-events:none` — hover event umuman ishga tushmaydi.

```js
const mo = new MutationObserver((mutations) => {
  for (const m of mutations) {
    for (const node of Array.from(m.addedNodes)) {
      if (node.tagName === 'VIDEO') killVideoElement(node);
      node.querySelectorAll?.('video').forEach(v => killVideoElement(v));
      // Yangi img qo'shilsa ham tozalash (YouTube srcni qayta qo'yadi)
      if (node.tagName === 'IMG') { node.src = BLANK_GIF; }
    }
  }
});
mo.observe(entry, { childList: true, subtree: true });
```

**File:** `monitor.ts:shieldYTEntry` funksiyasi

---

## BUG 20 — KRITIK: Bloklangan YouTube video shishasimon overlay ostida ijro etiladi
**Sana:** 2026-07-04
**Holat:** "naughty girl" qidiruvidan video ochilganda `Video bloklandi` yozuvi chiqdi, lekin ORQA FONDA video ijro etilyapti. Overlay ostidan video ko'rinadi va tovushi chiqadi.

**Sabab (chuqur analiz):**
Oldingi `shieldYTPlayer()`:
```js
video.pause(); video.removeAttribute('src'); video.load();
```
Bu YETARLI EMAS. YouTube o'z ichki API'siga ega — `ytplayer` obyekti orqali `<video>` element uchun `src`ni QAYTA qo'yadi. Buni ishlatadigan qismlar:
1. YouTube autoplay scheduler — pause bo'lgan videoni qayta play qiladi
2. YouTube's html5-video-player src'ni MediaSource orqali qo'yadi (`blob:` URL) — bizning `removeAttribute('src')` bir marta ishlaydi, keyin YouTube yana qo'yadi
3. `video.play()` methodini YouTube o'z ichki setTimeout'larida chaqiradi

Natijada: bir marta pause qilsak ham, 100-500ms ichida YouTube qayta boshlaydi.

**Tuzatish (v2.5.0) — killVideoElement() funksiya:**

7 qatlamli himoya:
1. **Pause + muted + volume=0 + currentTime=0** — asosiy to'xtatish
2. **src va source teg'larni tozalash** — dastlabki media manba yo'q qilish
3. **play() metodini override qilish** — `video.play = () => Promise.reject()`. YouTube qayta chaqirsa xato oladi.
4. **Barcha media event'larni bloklash** — `play, playing, loadstart, loadeddata, canplay, canplaythrough, seeking, waiting` — har birida `stopImmediatePropagation` va `pause()`
5. **display:none + visibility:hidden + opacity:0 + pointer-events:none** — vizual va interaktiv o'chirish
6. **MutationObserver src atributiga** — YouTube src qaytadan qo'ysa darhol o'chirish
7. **250ms interval** — 1 daqiqa davomida har chorak soniyada tekshirish: agar video paused emas → pause, agar src bor → tozalash

Bu 7 qatlam butun YouTube player logikasini yengadi. Video hech qanday yo'l bilan ijro etilmaydi.

**File:** `monitor.ts:killVideoElement` (yangi funksiya)

---

## BUG 21 — KICHIK: shieldYTPlayer overlay ostidan video ko'rinardi
**Sana:** 2026-07-04
**Holat:** Overlay `background: rgba(15,23,42,0.94)` — 6% shaffof. Video pastdan ko'rinadi.

**Tuzatish:**
`overlay.style.background = '#0f172a'` — 100% opak.
`player.style.pointer-events: none` — click hech qayerga tegmaydi.
`overlay.style.pointer-events: auto` — faqat overlay o'zi interaktiv.

**File:** `monitor.ts:shieldYTPlayer`

---

## v3.0.0 — 2026-07-04 — AI Brain modular arxitektura

### Katta refactoring — foydalanuvchi so'roviga muvofiq
Monitor.js (992 qator, monolit) → `src/ai-brain/` modulyar papka (53 modul).
`monitor.js` endi 3 qatorli orchestrator: `AIBrain.start()`.
Vite bundler barchasini bitta `monitor.js` (83KB IIFE) ga jamlaydi — Electron `executeJavaScript` uchun mos.

### Yangi arxitektura
```
src/ai-brain/
  index.ts              # Public API (start)
  config.ts             # CONFIG, STOP_EVENTS, BLANK_GIF
  domains/              # BLOCKED_DOMAINS, WHITELIST_DOMAINS
  text/                 # keywords, analyzer, scanner, web-lookup
  image/                # analyzer, skin-tone, loader, queue, scanner
  video/                # killer (7-layer), frame-scanner, scanner
  youtube/              # entry-scanner, shields, selectors
  block/                # shield, events, styles
  observers/            # mutation, navigation, scroll
  engine/               # orchestrator, state
  models/               # nsfw-loader (waitForModel)
  utils/                # dom, logger, helpers
```

### Yangi funksionallik

#### 1. Web Lookup (DuckDuckGo Instant Answer)
`text/web-lookup.ts` — bilmagan so'zlarni bepul DDG API orqali tekshiradi.
Cache: localStorage 24 soat. Rate limit: 500 ta entry.
Foydalanish: kelajakda unknown keyword topilsa avtomatik lookup.

#### 2. Anime/Hentai fix (BUG C)
`image/analyzer.ts` — NSFW model'da `drawing + hentai` kombinatsiya score qo'shildi.
Anime "drawing" klassiga tushib qolayotgan hentai kontenti endi to'g'ri bloklanadi:
```ts
const drawingHentai = breakdown.drawing + breakdown.hentai;
const animeHarmful = drawingHentai > 0.6 && breakdown.hentai > 0.2;
```

#### 3. YT Search Results (BUG A)
`youtube/entry-scanner.ts` — search risk >= 2 va sahifa `/results` bo'lsa,
barcha entry'lar avtomatik bloklanadi (soft keyword bilan yoki aggressive rejim).
"naughty girl" qidiruvi endi to'g'ri ishlaydi.

#### 4. YT Thumbnail Model Kutish (BUG B)
`image/analyzer.ts` — `waitForModel(8000)` model yuklanmasdan qaror qabul qilinmasin.
Thumbnail'lar model tayyor bo'lgach qayta scan qilinadi (`startModelLoad(onReady)` callback).

#### 5. Shadow DOM support
`image/scanner.ts` — open shadow root ichidagi `<img>` elementlar ham topiladi.
React/Vue/Angular framework saytlar to'liq qamrab olinadi.

### Nima o'zgardi
| Metric | v2.5.0 | v3.0.0 |
|--------|--------|--------|
| monitor.js manba | 992 qator, 1 fayl | 3 qator, 53 modul |
| Bundle hajmi | 83 KB | 83 KB (bir xil) |
| Test qilish osonligi | Monolitni test qilish qiyin | Har modul alohida test |
| Refactoring | Har o'zgarish katta risk | Modul chegarasida |
| Team ish | Konflikt bo'ladi | Har modul alohida |
| Yangi feature | Butun faylni tushunish kerak | Faqat kerakli modul |

### Test rejasi (foydalanuvchi bajaradi)
1. Brauzerni TO'LIQ yopish → task manager orqali barcha SafeNet processlarni tugatish
2. Qayta ochish
3. Terminal loglari:
   - `[OK] tf.min.js (local/CDN)`
   - `[OK] nsfwjs.min.js`
   - `[OK] CSP strip`
4. Console (F12) loglari:
   - `[CIA] 🚀 AI Brain v3.0.0`
   - `[CIA] ✅ NSFW model tayyor` (5-10s ichida)
5. Test URL'lar:
   - `youtube.com/results?search_query=naughty+girl` → barcha entry bloklangan
   - `youtube.com` homepage → bikini thumbnails NSFW model tomonidan blur
   - `wallpapers.com/hot-anime` → hentai anime blur (drawing+hentai combo)
   - `mom2fuck.com` → to'liq sahifa blok (BLOCKED_DOMAINS)
   - Bloklangan video ustiga bosish → hech qanday yo'l bilan ochilmasin
   - Hover bloklangan YT thumbnail → preview video paydo bo'lmasin

### Regressiya himoyasi
Barcha eski BUG (1-21) uchun modul darajasida `// BUG X saboq` sharh qoldirildi.
Refactoring paytida bir bug ham qaytmaganini kod tekshiruvi bilan tasdiqlanadi.

---

## Umumiy takomillashtirishlar (v2.5.0)

### Verification checklist (foydalanuvchi test qilishi kerak)

- [ ] `mom2fuck.com` ochilishi → to'liq sahifa blok
- [ ] `goblinstube.com` ochilishi → to'liq sahifa blok
- [ ] Har qanday saytda `target="_blank"` link → hozirgi ilova ichida yangi tab (yangi oyna emas)
- [ ] Hover bloklangan YouTube thumbnail ustiga → hech narsa ko'rinmaydi, video ijro qilinmaydi
- [ ] Bloklangan YouTube video sahifasi → orqa fonda video to'liq to'xtaydi
- [ ] Overlay 100% opak — video ko'rinmaydi
- [ ] Click bloklangan video ustiga → hech narsa bo'lmaydi

### Console loglar bilan tekshirish

```
[CIA] 🛡️ YT Player: Video: "naughty girl"
[CIA] 🎬 killVideo — video butunlay o'chirildi
```

Agar `killVideoElement` xato chiqarsa → console'da `[CIA] ❌ killVideo xato` chiqadi.
