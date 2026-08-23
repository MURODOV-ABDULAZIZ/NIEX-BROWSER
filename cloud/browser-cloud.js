// ============================================================
// BROWSER CLOUD CLIENT — Narimon brauzerni Lovable bulut (Supabase) bilan bog'laydi.
//
// Nima qiladi:
//   1. Brauzerni qurilma sifatida ro'yxatdan o'tkazadi (browserId + tokenlar saqlanadi)
//   2. Har ~60s heartbeat → admin panelda "Connected Browsers" da ko'rinadi
//   3. Feedback yuboradi → admin panel "Feedback" bo'limiga tushadi
//   4. Notificationlarni so'raydi (admin javobi + e'lonlar) → brauzer qo'ng'irog'iga
//
// XAVFSIZLIK: publishable (anon) kalit — bu ochiq kalit, xavfsiz.
//   Access token qurilmaga tegishli, USER_DATA'da saqlanadi.
// ============================================================
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const fetch = require('node-fetch');

// ============================================================
// SUPABASE ULANISHI — bu yerni yangi Lovable loyihangizga moslang.
//   .env orqali ham berish mumkin: NARIMON_CLOUD_URL, NARIMON_CLOUD_KEY
//   Qiymatlarni Lovable loyihangizdagi .env dan oling:
//     VITE_SUPABASE_URL  → NARIMON_CLOUD_URL
//     VITE_SUPABASE_PUBLISHABLE_KEY → NARIMON_CLOUD_KEY  (bu ochiq kalit, xavfsiz)
// ============================================================
// DIQQAT: bu qiymatlar JONLI saytdan (niex.lovable.app bundle) tasdiqlangan.
//
// `BROWSER_API.md` da bir muddat boshqa loyiha (rppafvrjezpatfjjhaaa) yozilgan
// edi — u ESKIRGAN hujjat. O'sha loyihada browser-api ning eski nusxasi
// ishlaydi va /parent, /my-subscription, /payments yo'llariga 403 qaytaradi.
// Haqiqiy backend quyidagi loyihada; tekshirilgan: parent/children,
// my-subscription, payments → 200.
const SUPABASE_URL = process.env.NARIMON_CLOUD_URL || 'https://khtaytissfivcoyxxvpq.supabase.co';
const APIKEY = process.env.NARIMON_CLOUD_KEY || 'sb_publishable_XdZ7P-q-GvONWaqNlIWkIw_MbY_aoYr';
const BASE = `${SUPABASE_URL.replace(/\/$/, '')}/functions/v1/browser-api`;

let state = { browserId: null, accessToken: null, refreshToken: null, seen: [] };
let stateFile = null;
let log = () => {};
let onNotifications = null;
let ready = false;

function save() {
  try { fs.writeFileSync(stateFile, JSON.stringify(state, null, 2)); } catch (e) { log('WARN', 'cloud state save:', e.message); }
}

async function api(pathname, { method = 'GET', body, auth = true } = {}) {
  const headers = { apikey: APIKEY, 'Content-Type': 'application/json' };
  if (auth && state.accessToken) headers['Authorization'] = `Bearer ${state.accessToken}`;
  const res = await fetch(`${BASE}${pathname}`, {
    method, headers, body: body ? JSON.stringify(body) : undefined, timeout: 20000,
  });
  const txt = await res.text();
  let json; try { json = JSON.parse(txt); } catch { json = { _raw: txt }; }
  if (!res.ok) { const e = new Error(json.error || `HTTP ${res.status}`); e.status = res.status; throw e; }
  return json;
}

/**
 * Brauzerni bulutda ro'yxatdan o'tkazish.
 *
 * Shartnoma: just-type-it/BROWSER_API.md §1
 *   POST /api/v1/browser-devices/register
 *   { browserId, name, platform, version }  → { accessToken, refreshToken }
 *
 * `platform` — `process.platform` qiymati (win32/darwin/linux), hujjatda
 * aynan shunday ko'rsatilgan.
 */
async function register() {
  const os = require('os');
  const r = await api('/api/v1/browser-devices/register', {
    method: 'POST', auth: false,
    body: {
      browserId: state.browserId,
      name: os.hostname() || 'NIEX Desktop',
      platform: process.platform,
      version: '1.0.0',
    },
  });
  const d = r.data || r;
  state.accessToken = d.accessToken;
  state.refreshToken = d.refreshToken;
  save();
  if (!state.accessToken) {
    log('WARN', 'Bulut', 'ro\'yxatdan o\'tildi, lekin accessToken kelmadi');
  } else {
    log('OK', 'Bulut', 'brauzer ro\'yxatdan o\'tdi (Connected Browsers)');
  }
}

/** Shartnoma: BROWSER_API.md §2 — POST /api/v1/browser-sessions/refresh */
async function refresh() {
  if (!state.refreshToken) return false;
  try {
    const r = await api('/api/v1/browser-sessions/refresh', {
      method: 'POST', auth: false,
      body: { browserId: state.browserId, refreshToken: state.refreshToken },
    });
    const d = r.data || r;
    if (!d.accessToken) return false;
    state.accessToken = d.accessToken;
    if (d.refreshToken) state.refreshToken = d.refreshToken;
    save();
    return true;
  } catch { return false; }
}

/**
 * Token eskirsa avtomatik yangilash bilan qayta urinish.
 *
 * 401 VA 403 — ikkalasi ham qayta autentifikatsiya talab qiladi:
 *   401 = token muddati tugagan
 *   403 = token bu loyiha uchun yaroqsiz (masalan Supabase loyihasi
 *         almashtirilgan va diskda eski proyekt tokeni qolgan)
 * Avval faqat 401 ushlanardi — 403 to'g'ridan-to'g'ri "Forbidden" bo'lib
 * foydalanuvchiga chiqardi va hech qachon tuzalmasdi.
 */
async function withAuth(fn) {
  try { return await fn(); }
  catch (e) {
    if (e.status === 401 || e.status === 403) {
      if (await refresh()) {
        try { return await fn(); } catch (e2) { if (e2.status !== 401 && e2.status !== 403) throw e2; }
      }
      // Refresh ham yordam bermadi — eski tokenlarni tashlab, toza ro'yxatdan o'tamiz
      state.accessToken = null;
      state.refreshToken = null;
      save();
      await register();
      return await fn();
    }
    throw e;
  }
}

async function heartbeat() {
  try { await withAuth(() => api('/api/v1/browser-heartbeat', { method: 'POST', body: {} })); }
  catch (e) { log('WARN', 'Bulut heartbeat:', e.message); }
}

async function pollNotifications() {
  try {
    const r = await withAuth(() => api('/api/v1/notifications'));
    const items = r.data || r.items || [];
    const fresh = items.filter(n => !state.seen.includes(n.id));
    if (fresh.length && onNotifications) {
      for (const n of fresh) onNotifications({ title: n.title || 'Xabar', body: n.body || n.message || '', type: 'cloud', meta: { id: n.id, link: n.link || null } });
    }
    if (fresh.length) {
      state.seen = [...state.seen, ...fresh.map(n => n.id)].slice(-500);
      save();
    }
  } catch (e) { if (e.status !== 401) log('WARN', 'Bulut notif:', e.message); }
}

// Feedback yuborish — admin panel "Feedback" bo'limiga tushadi
async function submitFeedback({ title, description, category = 'general', priority = 'medium', metadata = {} }) {
  if (!ready) return { ok: false, error: 'Bulut tayyor emas' };
  try {
    const r = await withAuth(() => api('/api/v1/feedback', {
      method: 'POST', body: { title, description, category, priority, metadata },
    }));
    log('OK', 'Bulut feedback', 'yuborildi → admin panel');
    return { ok: true, data: r.data };
  } catch (e) { log('WARN', 'Bulut feedback:', e.message); return { ok: false, error: e.message }; }
}

// To'lov so'rovini bulutga yuborish — admin panel "To'lovlar"ga tushadi, obuna PENDING bo'ladi
async function submitPayment(data) {
  if (!ready) return { ok: false, error: 'Bulut tayyor emas' };
  try {
    if (data.planId && !data.productKey) {
      data.productKey = data.planId;
    }
    const r = await withAuth(() => api('/api/v1/payments', { method: 'POST', body: data }));
    log('OK', 'Bulut to\'lov', 'yuborildi → admin panel (pending)');
    return { ok: true, data: r.data };
  } catch (e) { log('WARN', 'Bulut to\'lov:', e.message); return { ok: false, error: e.message }; }
}

async function validatePromo(data) {
  if (!ready) return { ok: false, error: 'Bulut tayyor emas' };
  try {
    const r = await withAuth(() => api('/api/v1/promotions/validate', { 
      method: 'POST', 
      body: { code: data.code, productKey: data.planId, email: data.email } 
    }));
    log('OK', 'Bulut promo', 'tekshirildi');
    
    if (r && r.ok) {
      if (r.valid === false) {
        return { ok: false, error: r.message || 'Promo yaroqsiz' };
      }
      return {
        ok: true,
        final_amount: r.final_price,
        discount_type: r.discount_type,
        discount_value: r.discount_value,
        discount_amount: r.discount_amount,
        original_amount: r.original_price
      };
    }
    return r;
  } catch (e) { log('WARN', 'Bulut promo:', e.message); return { ok: false, error: e.message }; }
}

let _lastSubStatus = null;
let onSubscription = null;
async function pollSubscription(force) {
  try {
    const r = await withAuth(() => api('/api/v1/my-subscription'));
    const sub = r.data;
    log('☁️', 'SUB fetch:', sub ? `status=${sub.status} plan=${sub.plan || '?'} email=${sub.account_email || '?'}` : 'null');
    if (sub && (force || sub.status !== _lastSubStatus)) {
      _lastSubStatus = sub.status;
      if (onSubscription) onSubscription(sub); // active → local Pro faollashtirish
    }
    return sub;
  } catch (e) { if (e.status !== 401) log('WARN', 'Bulut obuna:', e.message); return null; }
}
async function getSubscription() {
  try { const r = await withAuth(() => api('/api/v1/my-subscription')); return r.data; }
  catch { return null; }
}

async function init({ userDataDir, logger, notify, onSub }) {
  log = logger || (() => {});
  onNotifications = notify || null;
  onSubscription = onSub || null;
  stateFile = path.join(userDataDir, 'browser-cloud.json');
  try { fs.mkdirSync(userDataDir, { recursive: true }); } catch {}

  try { if (fs.existsSync(stateFile)) state = { ...state, ...JSON.parse(fs.readFileSync(stateFile, 'utf8')) }; } catch {}
  if (!state.browserId) { state.browserId = crypto.randomUUID(); save(); }

  // Supabase loyihasi almashtirilgan bo'lsa — eski loyiha tokenlari yaroqsiz.
  // Ularni saqlab qolish 403 "Forbidden" ga olib keladi (yangi backend begona
  // proyekt JWT'sini rad etadi). Loyiha ref'ini yozib boramiz va farq bo'lsa
  // tokenlarni tozalab, qaytadan ro'yxatdan o'tamiz.
  const projectRef = (SUPABASE_URL.match(/https:\/\/([a-z0-9]+)\.supabase\.co/) || [])[1] || SUPABASE_URL;
  if (state.projectRef && state.projectRef !== projectRef) {
    log('INFO', 'Bulut', `loyiha almashdi (${state.projectRef} → ${projectRef}) — eski tokenlar tozalandi`);
    state.accessToken = null;
    state.refreshToken = null;
  }
  if (state.projectRef !== projectRef) { state.projectRef = projectRef; save(); }

  try {
    if (!state.accessToken) await register();
    else await heartbeat(); // tokenni sinash; 401 bo'lsa withAuth qayta ro'yxatdan o'tkazadi
    ready = true;
    log('OK', 'Bulut', `ulandi (browserId=${state.browserId.slice(0, 8)})`);
  } catch (e) {
    log('WARN', 'Bulut ulanish:', e.message);
    // Keyinroq qayta urinamiz — interval baribir ishlaydi
    ready = true;
  }

  // Heartbeat + notification + obuna status polling
  setInterval(heartbeat, 60 * 1000);
  setInterval(pollNotifications, 30 * 1000);
  setInterval(pollSubscription, 30 * 1000);
  setTimeout(pollNotifications, 4000);
  // Obuna statusини TEZ tortamiz (Pro ilova ochilishi bilan faollashsin — tugma kutmasin).
  //   register/token tayyor bo'lgach darhol, keyin zaxira uchun yana bir-ikki marta.
  setTimeout(() => pollSubscription(true), 800);
  setTimeout(() => pollSubscription(true), 2500);
}

function getBrowserId() { return state.browserId; }

// ============================================================
// PARENTAL CONTROL (Supabase) — Firebase o'rniga
// ============================================================

// Kirgan hisob emailini bulutga bildiradi — ota-ona farzandni EMAIL orqali
// shu indeks bo'yicha topadi. Login/logout'da chaqiriladi.
// Ikki xil chaqiruvni qabul qiladi:
//   reportAccount('a@b.com', 'Ism')            — oddiy (login/logout)
//   reportAccount({ email, name, age, role, interests, ... }) — to'liq profil
async function reportAccount(emailOrProfile, name) {
  if (!ready) return { ok: false };
  const body = (emailOrProfile && typeof emailOrProfile === 'object')
    ? { ...emailOrProfile, email: String(emailOrProfile.email || '').toLowerCase() }
    : { email: String(emailOrProfile || '').toLowerCase(), name: name || '' };
  try {
    await withAuth(() => api('/api/v1/account', { method: 'POST', body }));
    if (body.email) log('OK', 'Bulut hisob', body.email + (body.role ? ` (${body.role})` : ''));
    return { ok: true };
  } catch (e) { log('WARN', 'Bulut hisob:', e.message); return { ok: false, error: e.message }; }
}

async function addChild(childEmail) {
  try {
    const r = await withAuth(() => api('/api/v1/parent/add-child', { method: 'POST', body: { childEmail } }));
    return { ok: true, ...r };
  } catch (e) { return { ok: false, error: e.message }; }
}

async function verifyChildCode(childEmail, code) {
  try {
    const r = await withAuth(() => api('/api/v1/parent/verify', { method: 'POST', body: { childEmail, code } }));
    return { ok: true, data: r.data };
  } catch (e) { return { ok: false, error: e.message }; }
}

async function getChildren() {
  try { const r = await withAuth(() => api('/api/v1/parent/children')); return { ok: true, data: r.data || [] }; }
  catch (e) { return { ok: false, error: e.message, data: [] }; }
}

async function revokeChild(childEmail) {
  try { await withAuth(() => api('/api/v1/parent/revoke', { method: 'POST', body: { childEmail } })); return { ok: true }; }
  catch (e) { return { ok: false, error: e.message }; }
}

// FARZAND tomoni: bloklangan kontent → ota-onaga signal
async function sendParentAlert(payload) {
  if (!ready) return { ok: false };
  try { const r = await withAuth(() => api('/api/v1/parent/alert', { method: 'POST', body: payload })); return { ok: true, ...r }; }
  catch (e) { return { ok: false, error: e.message }; }
}

async function getParentAlerts() {
  try { const r = await withAuth(() => api('/api/v1/parent/alerts')); return { ok: true, data: r.data || [] }; }
  catch (e) { return { ok: false, error: e.message, data: [] }; }
}

async function markParentAlertsRead(ids) {
  try { await withAuth(() => api('/api/v1/parent/alerts/read', { method: 'PATCH', body: { ids } })); return { ok: true }; }
  catch (e) { return { ok: false, error: e.message }; }
}

// ============================================================
// ACTIVITY INTELLIGENCE (Parental Control PART 1-4)
// ============================================================

// FARZAND/USER: kunlik aggregate faoliyatni bulutga sync qiladi (batch, idempotent).
// payload: { days: [ {date, totalSeconds, ...} ], deviceType }
async function syncActivity(payload) {
  if (!ready) return { ok: false, error: 'Bulut tayyor emas' };
  try { const r = await withAuth(() => api('/api/v1/activity/sync', { method: 'POST', body: payload })); return { ok: true, ...r }; }
  catch (e) { return { ok: false, error: e.message }; }
}

// USER: o'z faoliyati yig'indisi (barcha qurilmalar).
async function getMyActivity(days = 1) {
  try { const r = await withAuth(() => api(`/api/v1/activity/summary?days=${days}`)); return { ok: true, data: r.data }; }
  catch (e) { return { ok: false, error: e.message }; }
}

// OTA-ONA: farzand faoliyati (backend authorization: active parent_child_link SHART).
async function getChildActivity(childEmail, days = 14) {
  try { const r = await withAuth(() => api(`/api/v1/parent/child-activity?childEmail=${encodeURIComponent(childEmail)}&days=${days}`)); return { ok: true, data: r.data }; }
  catch (e) { return { ok: false, error: e.message, status: e.status }; }
}

// OTA-ONA: farzand haftalik hisobotini yaratib, o'ziga yuboradi (email + notification).
async function sendWeeklyReport(childEmail) {
  try { const r = await withAuth(() => api('/api/v1/parent/weekly-report', { method: 'POST', body: { childEmail } })); return { ok: true, data: r.data }; }
  catch (e) { return { ok: false, error: e.message, status: e.status }; }
}

/**
 * AI proxy uchun autentifikatsiya konteksti.
 *
 * Kalitlar serverda (Supabase secrets) turadi, brauzer faqat o'z
 * `browser_access` tokeni bilan murojaat qiladi. Shu sabab ai-gateway'ga
 * BASE, apikey va tokenni berish kerak — lekin hech qanday AI kaliti emas.
 */
function getAuthContext() {
  return {
    ready,
    // DIQQAT: AI so'rovlari `browser-api` emas, ALOHIDA `ai-proxy` funksiyasiga
    // ketadi. `browser-api` ularni whitelist'dan o'tkazmaydi (403).
    base: `${SUPABASE_URL.replace(/\/$/, '')}/functions/v1/ai-proxy`,
    apikey: APIKEY,
    browserId: state.browserId,
    accessToken: state.accessToken,
    /** Token eskirsa yangilash — 401/403 da ai-gateway shuni chaqiradi. */
    refresh: async () => {
      try {
        if (await refresh()) return state.accessToken;
        await register();
        return state.accessToken;
      } catch { return null; }
    },
  };
}

// Foydalanuvchi qo'lда majbur qila oladigan sync (Premium sahifada "Yangilash" tugmasi).
async function refreshSubscription() { return await pollSubscription(true); }
module.exports = {
  init, submitFeedback, submitPayment, validatePromo, getSubscription, refreshSubscription, getBrowserId,
  reportAccount, addChild, verifyChildCode, getChildren, revokeChild,
  sendParentAlert, getParentAlerts, markParentAlertsRead,
  syncActivity, getMyActivity, getChildActivity, sendWeeklyReport,
  getAuthContext,
};
