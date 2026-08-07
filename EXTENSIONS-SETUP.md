# SafeNet Extension System - Updated ✅

## O'zgarishlar (Changes Made)

### 1. **Extension Injection Ishlatilgan (Fixed Extension Injection)**
   - **Muammo**: Extensions faqat UI da koʻrinib turgani, aslida ishlamayotgani
   - **Yechim**: `did-finish-load` eventida `ExtensionManager.injectContentScripts()` chaqiriladi
   - **Fayl**: `main.js` - Line 1701-1712
   - **Natija**: Har bir extension oʻz manifest.json da berilgan URL patterniga mos web saytlarda ishlaydi

### 2. **Content Script Injeksiyasi (Content Script Injection)**
   - ExtensionManager manifest.json ni o'qiyadi
   - Har bir extension uchun `content_scripts` chiqarib oladi
   - URL pattern matching qiladi (masalan: `https://google.com/*`)
   - CSS va JavaScript'ni to'g'ri sarlavhasiz inject qiladi
   - `window.__ext_context` o'rnatadi shunday qilib extension o'zini tani oladi

### 3. **IPC Handlers (Avvaldan bor, tekshirildi)**
   - `extensions-list`: Oʻrnatilgan extensionlar roʻyxatini chiqaradi
   - `extensions-install`: URLdan extension yuklab oladi va oʻrnatadi
   - `extensions-uninstall`: Extensionni oʻchiradi
   - `extensions-toggle`: Extensionni yoqish/oʻchirish

### 4. **Preload API (Avvaldan bor, tekshirildi)**
   - `window.safenet_extensions.list()` - roʻyxat
   - `window.safenet_extensions.install({url, name})` - oʻrnatish
   - `window.safenet_extensions.uninstall(id)` - oʻchirish
   - `window.safenet_extensions.toggle(id, enabled)` - yoqish/oʻchirish

---

## Extension Fayl Formati (Extension File Format)

### Extension JSON Formati

```json
{
  "manifest": {
    "manifest_version": 2,
    "name": "Extension Nomi",
    "version": "1.0.0",
    "description": "Taʼriflash",
    "permissions": ["*://*/*"],
    "content_scripts": [
      {
        "matches": ["<all_urls>"],
        "js": ["script.js"],
        "css": ["styles.css"],
        "run_at": "document_start",
        "all_frames": false
      }
    ],
    "icons": {
      "128": "base64_image_or_url"
    }
  },
  "files": {
    "script.js": "// JavaScript kodi",
    "styles.css": "/* CSS kodi */"
  }
}
```

### Parameterlar:
- **manifest_version**: 2 yoki 3
- **matches**: URL patternlar (masalan: `["https://google.com/*", "https://youtube.com/*"]`)
- **run_at**: `"document_start"`, `"document_end"`, `"document_idle"`
- **all_frames**: Barcha framelarni ham qoʻllash

---

## Namunalar (Examples)

### 1. Ad Blocking Extension
Fayl: `example-adblock-extension.json`
- Foydalanish: URLga joylang va install qiling
- Vazifa: Reklama networkalarini block qiladi
- Ishlaydi: Barcha saytlarda

### 2. Dark Mode Extension
Fayl: `example-darkmode-extension.json`
- Foydalanish: URLga joylang va install qiling
- Vazifa: Qorong'i rejimni qoʻllaydi
- Ishlaydi: Barcha saytlarda

---

## Extension Oʻrnatish (How to Install)

### Yo'l 1: File Server orqali
```bash
# Barcha extensionlarni serve qiling
python -m http.server 8000

# Keyin browser extension UI da:
# URL: http://localhost:8000/example-adblock-extension.json
# Name: Simple Ad Blocker
# Click: Install
```

### Yo'l 2: GitHub orqali
```
URL: https://raw.githubusercontent.com/user/repo/main/extension.json
Name: Extension Name
```

### Yo'l 3: File System orqali (Dev uchun)
`userData/extensions/` folderiga qoʻlda joylashtirish

---

## Extension Tekshirish (Testing)

### 1. Console da log qab
```javascript
// Extension ichida
console.log('[SafeNet Ad Blocker] Active');

// Developer tools açish: F12
// Console tabiga qarang
```

### 2. URL ma'nosini tekshiring
```javascript
// Manifestda berilgan URL patternga mos keladimi?
matches: ["<all_urls>"]  // ✅ Barcha URL ga
matches: ["https://youtube.com/*"]  // YouTube ga faqat
```

### 3. Extension toggled qilinganda reload qilish
- Toggle qilinganda barcha tab reload qiladi
- Extension o'chmoq/yoqmoq shunga soxta test

---

## Xatolar va Yechim (Troubleshooting)

### ❌ Extension installed lekin ishlamaydi
- **Sabablar**:
  1. URL pattern nomatch qiladi
  2. manifest.json noto'g'ri
  3. JavaScript syntax xatosi
  
- **Yechim**:
  - DevTools (F12) → Console tabni oching
  - Xatolarni qarang
  - `[SafeNet]` logs qab

### ❌ Install qilganda xato
- **Tekshiring**:
  - JSON format to'g'rimi?
  - URL accessible mi?
  - manifest va files fieldslar bor mi?

### ❌ CSS/JS inject qilinmadi
- **Sabab**: `failed_injections/` papkasiga qarang
- **Yechim**: `FILTER_JS` yoki `MONITOR_JS` bilan nokonflikt qiling

---

## Yangi Extension Yaratish (Create New)

### Shabloni (Template)

```json
{
  "manifest": {
    "manifest_version": 2,
    "name": "Mening Extensionim",
    "version": "1.0.0",
    "description": "Bu nima qiladi",
    "permissions": ["*://*/*", "<all_urls>"],
    "content_scripts": [
      {
        "matches": ["https://example.com/*"],
        "js": ["my-script.js"],
        "run_at": "document_idle"
      }
    ]
  },
  "files": {
    "my-script.js": "(function() {\n  console.log('[My Extension] Hello');\n  // Sizning koding\n})();"
  }
}
```

### Qadamlar:
1. JSON fayl yarating
2. manifest va files shunga qoʻying
3. URL ga joylashtiring (CORS enabled)
4. Extension UI dan install qiling
5. DevTools da tekshiring

---

## Arxitektura (Architecture)

```
Browser Loading Web Page
    ↓
did-finish-load event fires
    ↓
extensionManager.injectContentScripts(webContents, url)
    ↓
URL patterniga mos extensionlar toping
    ↓
CSS/JS kodni web page ga inject qil
    ↓
window.__ext_context o'rnat
    ↓
chrome.* API stubs available
    ↓
Extension kod ishlaydi!
```

---

## API (Available to Extensions)

### chrome.* Stubs (Available)
```javascript
// Runtime
chrome.runtime.id  // Extension ID
chrome.runtime.sendMessage()  // IPC

// Storage
chrome.storage.local.get()
chrome.storage.local.set()

// Tabs
chrome.tabs.query()
chrome.tabs.getCurrent()
chrome.tabs.executeScript()

// Extension
chrome.extension.getURL()
```

---

## Foydalanishni Monitoring (Monitoring Usage)

### Log qilingan joylar:
1. Console (main process): `[EXT]` prefix
2. `failed_injections/` folder: Injection xatolari
3. DevTools (renderer process): Extension console.logs

### Misol Logs:
```
[09:30:45] [EXT] Injected: ext_a1b2c3d4_xyz/adblock.js (document_idle)
[09:30:46] [EXT] inject OK https://youtube.com/watch?v=...
```

---

## Faydali Linklar

- Chrome Extension Manifest V2: https://developer.chrome.com/docs/extensions/mv2/
- Safari Web Extension Docs: https://developer.apple.com/documentation/safariservices/safari_web_extensions

---

## Xulosa

✅ **Yangilangan:**
- Extension injection aslida ishlaydi
- Manifest.json support (Chrome-like API)
- Content scripts URL pattern matching
- CSS + JS support
- Proper context isolation

✅ **Ishlaydi:**
- UI dan install/uninstall/toggle
- Auto-reload on toggle
- Logging va debugging
- Multiple extensions
- CSS va JavaScript injection

🚀 **Tayyor**: Yangi extensionlarni oʻrnatishni boshlash!

