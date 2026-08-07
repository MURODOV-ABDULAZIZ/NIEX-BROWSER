# SafeNet Parent Control — Setup Guide

Production-ready Ota-ona nazorati tizimi. Firebase Authentication + Firestore + real email verification bilan.

---

## Arxitektura

```
┌─────────────────────────────────────────────────────────┐
│  CHILD DEVICE (SafeNet Browser)                         │
│  ┌───────────────────────────────────────────────────┐  │
│  │ AI Brain (monitor.js)                             │  │
│  │    ↓ block hodisasi                               │  │
│  │ block-reporter.js                                 │  │
│  │    ↓ IPC: parent-control-report-block             │  │
│  │ main.js → broadcast → safenethome.html            │  │
│  │    ↓                                              │  │
│  │ parentControl.reportBlockedContent()              │  │
│  │    ↓ Firestore write                              │  │
│  │ notifications/{notifId}                           │  │
│  └───────────────────────────────────────────────────┘  │
└──────────────────────────┬──────────────────────────────┘
                           │  Firestore Real-time
                           ▼
┌─────────────────────────────────────────────────────────┐
│  PARENT DEVICE (SafeNet Browser)                        │
│  ┌───────────────────────────────────────────────────┐  │
│  │ parent-control.html                               │  │
│  │    ↓ onSnapshot listener                          │  │
│  │ Notification Center — real-time badge + list      │  │
│  └───────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────┘
```

## Fayl tuzilishi

```
BRAUZER/
├── parental-control/
│   ├── parent-control-service.js   # Firestore client (renderer)
│   ├── parent-control.html         # UI: farzand qo'shish + notifications
│   ├── parent-control.js           # UI logic
│   ├── block-reporter.js           # Child-side: AI block → notification
│   └── firestore.rules             # Security rules
├── main.js                         # IPC handlers + injection
├── preload.js                      # __parentControlBridge + firebase-config
└── safenethome.html                # Sidebar: "Farzandlarni boshqarish" button
```

## Firestore Schema

### Collections

**`users/{uid}`** — user profile (mavjud, kengaytirilgan)
```json
{
  "uid": "abc123",
  "email": "user@example.com",
  "firstName": "Ali",
  "lastName": "Valiyev",
  "role": "parent" | "child" | "student" | "user",
  "interests": [...],
  "profileCompleted": true,
  "createdAt": "2026-07-04T...",
  "updatedAt": "..."
}
```

**`usersByEmail/{emailKey}`** — email → uid index
```json
{
  "email": "user@example.com",
  "uid": "abc123",
  "updatedAt": Timestamp
}
```

**`relationships/{parentUid}_{childUid}`** — parent ↔ child link
```json
{
  "parentUid": "parent_abc",
  "parentEmail": "parent@example.com",
  "childUid": "child_xyz",
  "childEmail": "child@example.com",
  "childName": "Bola Ismi",
  "status": "pending" | "active" | "revoked",
  "createdAt": Timestamp,
  "activatedAt": Timestamp
}
```

**`verificationCodes/{codeId}`** — 6-digit codes (TTL 10 min)
```json
{
  "code": "123456",
  "parentUid": "parent_abc",
  "parentEmail": "parent@example.com",
  "childUid": "child_xyz",
  "childEmail": "child@example.com",
  "childName": "Bola Ismi",
  "expiresAt": Timestamp,
  "used": false,
  "createdAt": Timestamp
}
```

**`notifications/{notifId}`** — blocked content alerts
```json
{
  "parentUid": "parent_abc",
  "childUid": "child_xyz",
  "childName": "Bola Ismi",
  "childEmail": "child@example.com",
  "category": "pornography" | "gambling" | "drugs" | "violence" | "unknown",
  "searchQuery": "sexy",
  "url": "https://youtube.com/results?search_query=sexy",
  "reason": "Search query keyword",
  "device": "Windows",
  "browser": "SafeNet",
  "createdAt": Timestamp,
  "read": false
}
```

**`mail/{docId}`** — email queue (Firebase Extension "Trigger Email")
```json
{
  "to": ["child@example.com"],
  "message": { "subject": "...", "html": "...", "text": "..." }
}
```

## Setup — 3 qadam

### 1. Firebase Console'da

Loyihangiz **safe-brauzer-cf748** allaqachon `.env`da sozlangan.

**Kerakli servislar:**
- ✅ Authentication (Email/Password + Google) — foydalanuvchi login
- ✅ Firestore Database — collectionlar

**Firestore'ni yoqing:**
```
Firebase Console → Firestore Database → Create database (production mode)
Region: eur3 (yoki eng yaqin)
```

### 2. Security Rules'ni deploy qiling

```bash
# Firebase CLI o'rnatilmagan bo'lsa:
npm install -g firebase-tools

# Login:
firebase login

# Loyihaga ulanish:
cd D:\BRAUZER
firebase use safe-brauzer-cf748

# Rules deploy:
firebase deploy --only firestore:rules
```

`firestore.rules` `parental-control/` papkasida. `firebase.json` yo'q bo'lsa:

```json
{
  "firestore": {
    "rules": "parental-control/firestore.rules"
  }
}
```

### 3. Email service (Firebase Extension "Trigger Email")

**Kerakli extension:** [firebase-trigger-email](https://extensions.dev/extensions/firebase/firestore-send-email)

```bash
firebase ext:install firebase/firestore-send-email
```

**Sozlash paytida:**
- `SMTP connection URI`: SendGrid, Mailgun yoki Gmail SMTP (masalan: `smtps://user:pass@smtp.sendgrid.net:465`)
- `Email documents collection`: `mail`
- `Default FROM address`: `noreply@narimon.uz`

`parent-control-service.js` avtomatik `mail` collection'iga hujjat qo'shadi → Extension email jo'natadi.

**Alternativ (Firebase Extension'siz):**
Cloud Function yozing (`functions/index.js`):

```js
const functions = require('firebase-functions');
const nodemailer = require('nodemailer');
const transporter = nodemailer.createTransport({ /* smtp config */ });

exports.sendVerificationEmail = functions.firestore
  .document('verificationCodes/{codeId}')
  .onCreate(async (snap) => {
    const data = snap.data();
    await transporter.sendMail({
      to: data.childEmail,
      subject: 'SafeNet: Ota-ona nazorati',
      html: `<p>Kod: <strong>${data.code}</strong></p>`,
    });
  });
```

## Foydalanish

### Parent (Ota-ona) tomon

1. **Ro'yxatdan o'tish**: Personal Info → Role → "Parent"
2. **safenethome.html** ochilganda sidebar'da **"👨‍👧 Farzandlarni boshqarish"** ko'rinadi
3. Bosing → yangi oyna: parent-control.html
4. **"+ Farzand qo'shish"** → farzand emailini kiriting
5. Farzand emailiga 6 xonali kod boradi
6. Kodni parent kiriting → ✅ ulandi
7. **Notification Center** real-time: farzand bloklangan qidiruv qilsa → parent'ga signal

### Child (Farzand) tomon

1. **Ro'yxatdan o'tish**: Role → "Child"
2. Emailiga verification code kelganda parent'ga aytadi (yoki avtomatik)
3. Ulangandan keyin: AI Brain har bloklangan kontent uchun avtomatik notification yuboradi

## Xavfsizlik

### Firestore Security Rules
- Parent faqat o'z relationship'idagi child ma'lumotini o'qiy oladi
- Notification'lar `parentUid` egasi bo'lgan parent uchun ko'rinadi
- Boshqa parent hech qachon boshqa bolani ko'ra olmaydi
- Verification code faqat u yaratilgan parent/child uchun

### Client-side
- Verification code 10 daqiqada expire bo'ladi
- Kod bir marta ishlatiladi (`used: true`)
- Rate limit: block-reporter 2 soniyada bir xil kontentni takrorlamaydi

### Email
- Firebase Extension SMTP orqali — kod tekshirilmagan sender'lardan yubormaydi
- Verification code Firestore'da 10 daqiqa keyin ishlamay qoladi

## Testing checklist

- [ ] Parent ro'yxatdan o'tadi → sidebar'da "Farzandlarni boshqarish" ko'rinadi
- [ ] Child boshqa qurilmadan ro'yxatdan o'tadi → `usersByEmail` index yoziladi
- [ ] Parent farzand emailini kiritadi → "topilmadi" xatosi (agar child hali yo'q bo'lsa)
- [ ] Parent mavjud child emailini kiritadi → kod yuboriladi
- [ ] Child emailiga kod keladi (real email!)
- [ ] Parent kodni kiritadi → relationship active bo'ladi
- [ ] Farzandlar ro'yxatida child ko'rinadi (FAOL badge)
- [ ] Child device'da "sexy" qidiradi → AI blokla → parent'ga notification
- [ ] Notification real-time ko'rinadi (parent oyna ochiq bo'lsa)
- [ ] Notification "O'qildi" tugma ishlaydi
- [ ] Parent farzandni o'chiradi → child ma'lumotlari ko'rinmaydi

## Cheklovlar (halol gap)

**Firebase Extension "Trigger Email"** — bepul emas ($0.03 per 10K reads). Loyiha kichik bo'lsa Cloud Function + SendGrid bepul tier (100 email/day) ishlaydi.

**Client-side security** — Firestore Rules asosiy himoya. Ammo agar foydalanuvchi Chrome DevTools bilan o'z profilini `role: "parent"` deb o'zgartirsa, sidebar tugmasi ko'rinadi. Rules bu holda ham Firestore access'ni bloklaydi, lekin UI ko'rinadi. Kelajakda Custom Claims (Cloud Function) qo'shilishi kerak.

**Email verification** — child o'zi emailga kirmasin desa? Real Firebase Auth email link ishlatish v2.0.

## Kelajak (v2.0)

- [ ] Custom Claims (Cloud Function) — role UI tomonda ham kuchli tekshiruv
- [ ] Push Notifications (FCM) — parent oyna yopiq bo'lsa
- [ ] Screen Time reports — kunlik/haftalik statistika
- [ ] Whitelist/Blacklist per child
- [ ] Time-based blocking (masalan 22:00 dan keyin sotsial tarmoqlar)
- [ ] Location tracking (Family Link kabi)
