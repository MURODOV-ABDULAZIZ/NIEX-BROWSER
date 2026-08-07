# Extensions - Tez Boshlash (Quick Start)

## 🚀 Tez Sinov (Quick Test)

### Step 1: Local Server Qoʻyish
```bash
# Terminal ochib, SafeNet papkasida:
cd d:\SAFE_NETWORK\BRAUZER
python -m http.server 8000
```

### Step 2: Browser Ochish
- SafeNet Browserni run qiling
- `Settings` → `Extensions` bosin

### Step 3: Ad Blocker Oʻrnatish
```
URL: http://localhost:8000/example-adblock-extension.json
Nomi: Simple Ad Blocker
Click: Install
```

✅ **Natija**: Extension roʻyxatda koʻrinadi va yoqilgan holatda boʻladi

### Step 4: Test Qilish
- Ixtiyoriy website ochish (masalan: google.com)
- Reklama qoʻllamay qoʻyilishiga qarang
- DevTools (F12) → Console → logs qarang

---

## 📋 Barcha Misola Extensionlar

### 1. **Simple Ad Blocker** (Ad Blocking)
```
Fayl: example-adblock-extension.json
Nima qiladi: Google Ads, DoubleClick, va boshqa ad networkalarni block qiladi
Test: YouTube yoki Google News saytiga kirib reklama qoʻyilganda
```

### 2. **Dark Mode** (CSS Injection)
```
Fayl: example-darkmode-extension.json
Nima qiladi: Barcha website larni qorong'i rejimga oʻtkazadi
Test: Ixtiyoriy saytga kirib, CSS qoʻllanishiga qarang
```

### 3. **YouTube Comment Filter** (Content Filter)
```
Fayl: example-youtube-filter-extension.json
Nima qiladi: YouTube dagi nozor bo'lgan commentlarni yashiradi
Test: YouTube.com da commentlarga qarang
```

---

## ✨ Kendi Extension Yaratish

### Shabloni Copy Qiling:
```json
{
  "manifest": {
    "manifest_version": 2,
    "name": "Mening Extension",
    "version": "1.0.0",
    "description": "Nima qiladi",
    "permissions": ["*://*/*"],
    "content_scripts": [{
      "matches": ["<all_urls>"],
      "js": ["script.js"],
      "run_at": "document_idle"
    }]
  },
  "files": {
    "script.js": "(function() { console.log('Hello'); })();"
  }
}
```

### Qadamlar:
1. JSON copy qiling → `my-extension.json` saqlang
2. `script.js` kodni tahrir qiling
3. Local server da serve qiling
4. Browser da URLni kiriting va install qiling

---

## 🔍 Debug - Muammolarni Yechish

### Console Logs Qarang
```javascript
F12 → Console tab
[SafeNet] messages qab - extension ishlaydi
Qizil xatolar - muammo bor
```

### Failed Injections
```bash
d:\SAFE_NETWORK\BRAUZER\failed_injections\
Bu papkada injection xatolari saqlanaladi
```

### Logs Main Process
```
Terminal da [EXT] prefix bilan log ko'rinadi
Masalan: [10:30:45] [EXT] Injected: ext_xyz_123/script.js
```

---

## 🎯 Ishchi Shartlar

✅ **Qanday Ishlaydi:**
1. Extension `<all_urls>` uchun - barcha saytlarda ishlaydi
2. Extension specific domain uchun - faqat o'sha domainlar da ishlaydi
3. Toggle qilganda - barcha tab reload qiladi va extension qayta inject qiladi

❌ **Ishlamaydi:**
1. Manifest noto'g'ri JSON
2. URL patterngi nomatch qiladi
3. JavaScript syntax xatosi

---

## 💡 Advanced

### Request Blocker Extension
```json
{
  "manifest": {
    "manifest_version": 2,
    "name": "Tracker Blocker",
    "permissions": ["*://*/*"]
  },
  "files": {}
}
```

### Tab Manager Extension
```json
{
  "manifest": {
    "manifest_version": 2,
    "name": "Tab Organizer",
    "permissions": ["tabs"]
  }
}
```

---

## 📚 Aloqalari (Links)

- Manifest V2 Docs: https://developer.chrome.com/docs/extensions/mv2/
- Content Scripts: https://developer.chrome.com/docs/extensions/mv2/content_scripts/
- API Reference: https://developer.chrome.com/docs/extensions/reference/

---

## ⚡ Tezkor Qo'llanma

| Amali | Qanday |
|-------|--------|
| Oʻrnatish | URL + Install button |
| Yoqish | "Enable" button |
| Oʻchirish | "Disable" button |
| Oʻchib tashlash | "✕" button |
| Log qarang | DevTools F12 → Console |
| Reload | Toggle qiling |

---

Barcha extension lar `window.__ext_context` orqali oʻzlarini tana oladi va `chrome.* API stubs` dan foydalana oladi!

**Sukses bo'lishingni tilaymiz! 🚀**

