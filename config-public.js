// NIEX — PUBLIC konfiguratsiya fallback (production bundle uchun).
// ================================================================
// `.env` fayli build'ga KIRMAYDI (package.json build.files uni chiqarib tashlaydi) — bu
// to'g'ri, chunki unda MAXFIY AI kalitlar (Groq/Gemini/OpenRouter) bor. Lekin ba'zi
// qiymatlar CLIENT-SIDE ochiq bo'lishga mo'ljallangan va production'da kerak:
//
//   • Google DESKTOP OAuth client (CLIENT_ID + SECRET) — RFC 8252 "OAuth for Native
//     Apps" bo'yicha desktop client secret "public" hisoblanadi: uni native ilova
//     ichida yashirib BO'LMAYDI va Google ham shuni kutadi. Xavf past (redirect_uri
//     localhost bilan cheklangan, foydalanuvchi baribir Google'da login qiladi).
//   • Firebase config (apiKey va h.k.) — Firebase Security Rules bilan himoyalanadi,
//     har doim client'da ochiq bo'ladi (rasmiy Firebase amaliyoti).
//
// MUHIM: bu yerga HECH QACHON maxfiy server kaliti yozilmasin (Groq/Gemini/OpenRouter/
//   Supabase service_role). Ular backend proxy'da (Supabase Edge Function) qoladi.
//
// USTUVORLIK: `.env` (dev) mavjud bo'lsa — u ustun turadi (main.js: process.env
//   birinchi to'ldiriladi, bu fayl faqat bo'sh qiymatlarni to'ldiradi).
module.exports = {
  // Google Desktop OAuth (RFC 8252 "public")
  GOOGLE_CLIENT_ID: '14623727512-3gep9ut8hfc0bejovrrd9q9vq0tqkl6p.apps.googleusercontent.com',
  GOOGLE_CLIENT_SECRET: 'YOUR_GOOGLE_CLIENT_SECRET_HERE',

  // Firebase (client-side public config)
  FIREBASE_API_KEY: 'AIzaSyC_9PqsXO10JLNejXgUgOhu8oYpX3G_ros',
  FIREBASE_AUTH_DOMAIN: 'safe-brauzer-cf748.firebaseapp.com',
  FIREBASE_PROJECT_ID: 'safe-brauzer-cf748',
  FIREBASE_STORAGE_BUCKET: 'safe-brauzer-cf748.firebasestorage.app',
  FIREBASE_MESSAGING_SENDER_ID: '781225555534',
  FIREBASE_APP_ID: '1:781225555534:web:2cf9a864e1d7238efb351f',
  FIREBASE_MEASUREMENT_ID: 'G-MKJZDEJFPN',
};
