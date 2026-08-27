// ============================================================
// PAROL OMBORI — Chrome/Google darajasidagi saqlash
//
// XAVFSIZLIK:
//   Parollar OS darajasida shifrlanadi (Electron `safeStorage`):
//     Windows -> DPAPI (joriy Windows hisobiga bog'langan)
//     macOS   -> Keychain
//     Linux   -> libsecret / kwallet
//   Ya'ni fayl nusxalab olinsa ham, BOSHQA kompyuterda yoki boshqa Windows
//   hisobida ochilmaydi. Parollar hech qachon ochiq matnda diskka yozilmaydi.
//
//   Agar OS shifrlashi mavjud bo'lmasa (kamdan-kam Linux holati) — parol
//   SAQLANMAYDI. Ochiq matnda yozishdan ko'ra saqlamaslik xavfsizroq.
//
// TUZILISH (passwords.json):
//   { version: 1, entries: [{ id, origin, username, enc, createdAt, updatedAt, lastUsedAt }] }
//   `enc` — safeStorage bilan shifrlangan parolning base64 ko'rinishi.
// ============================================================
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

let _file = null;
let _safeStorage = null;
let _log = () => {};
let _state = { version: 1, entries: [] };

/** URL'dan barqaror kalit: protokol + host (port bilan). Yo'l/query hisobga olinmaydi. */
function normalizeOrigin(input) {
  const s = String(input || '').trim();
  if (!s) return '';
  try {
    const u = new URL(s.includes('://') ? s : 'https://' + s);
    if (!/^https?:$/.test(u.protocol)) return '';
    return `${u.protocol}//${u.host}`;
  } catch {
    return '';
  }
}

/** Ko'rsatish uchun qisqa nom: "github.com" */
function hostLabel(origin) {
  try { return new URL(origin).host.replace(/^www\./, ''); } catch { return origin; }
}

function load() {
  try {
    if (fs.existsSync(_file)) {
      const raw = JSON.parse(fs.readFileSync(_file, 'utf8'));
      if (raw && Array.isArray(raw.entries)) _state = { version: 1, entries: raw.entries };
    }
  } catch (e) {
    _log('WARN', 'Parol ombori o\'qilmadi:', e.message);
  }
}

function persist() {
  try {
    fs.mkdirSync(path.dirname(_file), { recursive: true });
    // Fayl faqat joriy foydalanuvchi uchun o'qiladigan bo'lsin (0600).
    fs.writeFileSync(_file, JSON.stringify(_state, null, 2), { encoding: 'utf8', mode: 0o600 });
  } catch (e) {
    _log('WARN', 'Parol ombori saqlanmadi:', e.message);
  }
}

function encryptionAvailable() {
  try { return !!(_safeStorage && _safeStorage.isEncryptionAvailable()); } catch { return false; }
}

function encrypt(plain) {
  return _safeStorage.encryptString(String(plain)).toString('base64');
}

function decrypt(encB64) {
  try { return _safeStorage.decryptString(Buffer.from(String(encB64), 'base64')); }
  catch { return null; }   // boshqa mashinada/hisobda ochilmaydi — kutilgan holat
}

function init({ userDataDir, safeStorage, logger } = {}) {
  _log = logger || (() => {});
  _safeStorage = safeStorage;
  _file = path.join(userDataDir, 'passwords.json');
  load();
  _log(encryptionAvailable() ? 'OK' : 'WARN', 'Parol ombori',
    `${_state.entries.length} yozuv, OS shifrlash: ${encryptionAvailable() ? 'mavjud' : 'YO\'Q — saqlash o\'chirilgan'}`);
}

/** Ro'yxat — parollarsiz (UI shu ro'yxatni ko'rsatadi). */
function list() {
  return _state.entries
    .map((e) => ({
      id: e.id,
      origin: e.origin,
      host: hostLabel(e.origin),
      username: e.username,
      createdAt: e.createdAt,
      updatedAt: e.updatedAt,
      lastUsedAt: e.lastUsedAt || null,
    }))
    .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
}

/** Bitta parolni ochish — foydalanuvchi "ko'rsatish" bosganda. */
function reveal(id) {
  const e = _state.entries.find((x) => x.id === id);
  if (!e) return { ok: false, error: 'Topilmadi' };
  if (!encryptionAvailable()) return { ok: false, error: 'OS shifrlash mavjud emas' };
  const p = decrypt(e.enc);
  if (p === null) return { ok: false, error: 'Ochib bo\'lmadi (boshqa qurilma yoki hisob)' };
  return { ok: true, password: p };
}

/** Sahifaga avtomatik to'ldirish uchun — shu origin bo'yicha barcha yozuvlar. */
function getForOrigin(originOrUrl) {
  const origin = normalizeOrigin(originOrUrl);
  if (!origin || !encryptionAvailable()) return [];
  return _state.entries
    .filter((e) => e.origin === origin)
    .map((e) => {
      const p = decrypt(e.enc);
      return p === null ? null : { id: e.id, username: e.username, password: p };
    })
    .filter(Boolean);
}

/**
 * Saqlash / yangilash. Bir (origin + username) juftligi uchun bitta yozuv.
 * @returns {{ok:boolean, id?:string, updated?:boolean, error?:string}}
 */
function save({ origin, username, password }) {
  const norm = normalizeOrigin(origin);
  const user = String(username || '').trim();
  const pass = String(password || '');

  if (!norm) return { ok: false, error: 'Sayt manzili noto\'g\'ri' };
  if (!pass) return { ok: false, error: 'Parol bo\'sh' };
  if (!encryptionAvailable()) {
    return { ok: false, error: 'OS shifrlash mavjud emas — parol saqlanmadi' };
  }

  const now = Date.now();
  const existing = _state.entries.find((e) => e.origin === norm && e.username === user);
  if (existing) {
    // Parol o'zgarmagan bo'lsa qayta yozmaymiz
    if (decrypt(existing.enc) === pass) return { ok: true, id: existing.id, updated: false };
    existing.enc = encrypt(pass);
    existing.updatedAt = now;
    persist();
    _log('OK', 'Parol yangilandi', hostLabel(norm) + ' — ' + (user || '(foydalanuvchisiz)'));
    return { ok: true, id: existing.id, updated: true };
  }

  const entry = {
    id: 'pw_' + crypto.randomBytes(9).toString('hex'),
    origin: norm,
    username: user,
    enc: encrypt(pass),
    createdAt: now,
    updatedAt: now,
    lastUsedAt: null,
  };
  _state.entries.push(entry);
  persist();
  _log('OK', 'Parol saqlandi', hostLabel(norm) + ' — ' + (user || '(foydalanuvchisiz)'));
  return { ok: true, id: entry.id, updated: false };
}

function markUsed(id) {
  const e = _state.entries.find((x) => x.id === id);
  if (!e) return;
  e.lastUsedAt = Date.now();
  persist();
}

function remove(id) {
  const before = _state.entries.length;
  _state.entries = _state.entries.filter((e) => e.id !== id);
  if (_state.entries.length !== before) persist();
  return { ok: true, removed: before - _state.entries.length };
}

function removeAll() {
  const n = _state.entries.length;
  _state.entries = [];
  persist();
  _log('OK', 'Parol ombori tozalandi', n + ' yozuv o\'chirildi');
  return { ok: true, removed: n };
}

/** Shu origin uchun "so'ramaslik" belgisi — foydalanuvchi rad etsa. */
const _neverAsk = new Set();
function setNeverAsk(originOrUrl) {
  const o = normalizeOrigin(originOrUrl);
  if (o) _neverAsk.add(o);
}
function isNeverAsk(originOrUrl) {
  return _neverAsk.has(normalizeOrigin(originOrUrl));
}

function status() {
  return {
    encryptionAvailable: encryptionAvailable(),
    count: _state.entries.length,
  };
}

module.exports = {
  init, list, reveal, getForOrigin, save, markUsed, remove, removeAll,
  setNeverAsk, isNeverAsk, status, normalizeOrigin, hostLabel,
};
