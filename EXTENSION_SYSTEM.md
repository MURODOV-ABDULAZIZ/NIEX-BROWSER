# SafeNet Chrome Extension System

## Nima ishlaydi (Electron built-in session.loadExtension)

Ushbu tizim **haqiqiy Chrome extensions'ni** yuklaydi. Custom simulation emas — Chromium'ning o'z extension engine'i ishlatiladi.

### Test qilingan imkoniyatlar

| Feature | Holat | Izoh |
|---------|-------|------|
| Content scripts (`content_scripts`) | ✅ To'liq | matches, run_at, all_frames, js, css |
| Background pages (MV2) | ✅ To'liq | `background.scripts`, `background.page` |
| Service workers (MV3) | ✅ Qisman | `background.service_worker` — asosiy hodisalar |
| `chrome.storage.local` | ✅ To'liq | Persistent |
| `chrome.storage.sync` | ✅ To'liq | Local'ga fallback |
| `chrome.runtime.sendMessage` | ✅ To'liq | Extension ichida va tabs bilan |
| `chrome.runtime.onMessage` | ✅ To'liq | |
| `chrome.tabs.query` / `sendMessage` | ✅ To'liq | |
| `chrome.action` popup (MV3) | ✅ To'liq | Puzzle icon → popup ochish |
| `browser_action` popup (MV2) | ✅ To'liq | |
| `chrome.cookies` | ✅ To'liq | Session cookies |
| `chrome.contextMenus` | ✅ To'liq | |
| `chrome.notifications` | ⚠️ Qisman | Electron system notifications'ga xarita |
| `chrome.webRequest` (blocking) | ⚠️ Qisman | Chromium 88+ dan cheklangan |
| `chrome.declarativeNetRequest` | ✅ To'liq | uBlock Origin uchun |
| `chrome.identity` (Google OAuth) | ❌ Yo'q | Custom implementation kerak |
| `chrome.commands` (keyboard) | ✅ To'liq | |

### Test qilingan haqiqiy extensionlar

| Extension | Holat | Sinov |
|-----------|-------|-------|
| **Dark Reader** | ✅ Ishlaydi | Content script + storage + popup |
| **uBlock Origin** | ✅ Ishlaydi | declarativeNetRequest orqali reklama bloklash |
| **Google Translate** | ⚠️ Qisman | Popup ochiladi, ammo Google auth cheklangan |
| **Grammarly** | ⚠️ Qisman | Content script ishlaydi, cloud auth alohida oyna |
| **ChatGPT for Google** | ⚠️ Qisman | OpenAI OAuth kerak |
| **JSON Formatter** | ✅ Ishlaydi | Sof content script |

## Foydalanish

### Load Unpacked (mahalliy papka)
1. Toolbar'da 🧩 puzzle iconini bosing
2. "+ O'rnatish" tugmasini bosing
3. Extension papkasini tanlang (manifest.json ichida bo'lgan papka)
4. Avtomatik yuklanadi, faol bo'ladi

### Chrome Web Store dan CRX yuklash
1. Extension'ni [Chrome Web Store](https://chromewebstore.google.com/) dan yuklab oling
2. `.crx` faylni saqlang
3. IPC'da `chromeExt.installCRX(crxPath)` chaqiring
4. Papkaga avtomatik ekstrakt qilinadi va yuklanadi

### Enable/Disable
- Puzzle icon → extension yonidagi ⏻ tugmani bosing
- Real ishlaydi: `session.removeExtension()` / `loadExtension()` chaqiriladi
- Content script/background hammasi to'xtaydi/qayta ishga tushadi

### Uninstall
- Puzzle icon → ✕ tugma
- Disk'dan (userData/chrome_extensions/) o'chiriladi
- Registry (chrome_extensions.json) dan o'chiriladi
- Restart keyin qaytmaydi

## Arxitektura

```
main.js
  ↓
ChromeExtensionSystem
  ↓
session.defaultSession.loadExtension(path, {allowFileAccess: true})
  ↓
Native Chromium extension engine
  ↓
Har sahifada content scripts avtomatik inject
Har tab uchun background context
```

### Fayllar
- `chrome-extension-system.js` — asosiy modul (ChromeExtensionSystem klassi)
- `preload.js` — `window.chromeExt` bridge (renderer uchun)
- `main.js` — IPC handlers va toolbar UI

### Persistence
- **Registry**: `userData/chrome_extensions.json` — id, path, enabled, meta
- **Extensions folder**: `userData/chrome_extensions/<extId>/` — extension fayllari
- **Auto-load**: brauzer ishga tushganda `loadAllOnStartup()` chaqiriladi

### Xavfsizlik
- Extension papkasi userData ichida (foydalanuvchi profili)
- `allowFileAccess: true` — extension file:// URL'larga kirishi mumkin (Chrome uslubi)
- Chromium'ning o'z sandbox va permission tekshiruvlari ishlaydi
- CSP header strip AI Brain uchun qo'llaniladi, extension'lar Chromium tomonidan boshqariladi

## IPC API

Renderer'dan `window.chromeExt` orqali:

```javascript
window.chromeExt.list()                    // Extension ro'yxati
window.chromeExt.installUnpacked()         // Papka tanlash dialog
window.chromeExt.installCRX(path)          // CRX fayl
window.chromeExt.toggle(id, enabled)       // Enable/disable
window.chromeExt.uninstall(id)             // O'chirish
window.chromeExt.openPopup(id, anchor)     // Extension popup
window.chromeExt.openStore()               // Chrome Web Store
```

## Cheklovlar (halol gap)

- **Chrome Web Store to'g'ridan-to'g'ri install** — Chrome Web Store CRX yuklashni yopib qo'ygan. Foydalanuvchi CRX'ni qo'l bilan yuklab kelishi kerak, yoki `crx-downloader` kabi xizmatlardan.
- **Manifest V3 service worker'lar** — asosiy hodisalar ishlaydi, ammo ba'zi alarm/scheduler API'lar cheklangan.
- **Google/OpenAI OAuth** — extension'lar Google/OpenAI'ga login qilishga urinsa, cookie/redirect handling qo'shimcha sozlash talab qiladi.

## Kelajakdagi ishlar (v2.0)

- [ ] Chrome Web Store integratsiyasi (CRX download orqali)
- [ ] Extension permissions dialog (o'rnatish oldidan)
- [ ] `chrome.identity` OAuth polyfill
- [ ] Extension update check (versiya solishtirish)
- [ ] `chrome.notifications` to'liq Electron Notification bridge
