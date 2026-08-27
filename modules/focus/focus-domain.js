'use strict';

/**
 * NIEX Focus — Domain modeli (platformadan mustaqil).
 *
 * Bu fayl ATAYLAB toza JavaScript: `fs`, `electron`, DOM yoki boshqa platforma
 * API'lariga bog'liq EMAS. Sabab (spec PART 1 §23 va PART 5 §19):
 *   - Goal / Task / Session / State / Reflection / DistractionEvent — biznes
 *     mantiqi bo'lib, u desktop (Electron), Android va iOS'da BIR XIL bo'lishi
 *     kerak. Faqat OS-integratsiyasi (monitoring, bildirishnoma) platformaga xos.
 *
 * Shu sababli bu yerda faqat: holat mashinasi (state machine), tekshiruv
 * (validation), tozalash (sanitize) va factory funksiyalar bor. Vaqtni o'lchash,
 * diskka yozish va IPC — `focus-manager.js` va platforma adapterlarining vazifasi.
 */

// ═══════════════════════════════════════════════════════════════════════════
// HOLATLAR (State machine) — spec PART 1 §8, PART 4 §3, PART 8 §19
// ═══════════════════════════════════════════════════════════════════════════

/** Focus sessiyasining yagona, authoritative holatlari. */
const SESSION_STATE = Object.freeze({
  PLANNED: 'planned',       // rejalashtirilgan, hali boshlanmagan
  ACTIVE: 'active',         // hozir davom etmoqda
  PAUSED: 'paused',         // vaqtincha to'xtatilgan (foydalanuvchi qaytishi mumkin)
  COMPLETED: 'completed',   // rejalashtirilgan vaqt/ish tugadi
  INTERRUPTED: 'interrupted', // uzilib qoldi (masalan ilova yopildi)
  CANCELLED: 'cancelled',   // foydalanuvchi bekor qildi
});

/** Terminal (yakuniy) holatlar — bulardan keyin o'tish bo'lmaydi. */
const TERMINAL_STATES = Object.freeze([
  SESSION_STATE.COMPLETED,
  SESSION_STATE.INTERRUPTED,
  SESSION_STATE.CANCELLED,
]);

/**
 * Ruxsat etilgan o'tishlar. Noto'g'ri o'tish (masalan CANCELLED → ACTIVE)
 * rad etiladi — spec PART 8 §19 "No invalid transitions".
 */
const SESSION_TRANSITIONS = Object.freeze({
  [SESSION_STATE.PLANNED]:     [SESSION_STATE.ACTIVE, SESSION_STATE.CANCELLED],
  [SESSION_STATE.ACTIVE]:      [SESSION_STATE.PAUSED, SESSION_STATE.COMPLETED, SESSION_STATE.INTERRUPTED, SESSION_STATE.CANCELLED],
  [SESSION_STATE.PAUSED]:      [SESSION_STATE.ACTIVE, SESSION_STATE.COMPLETED, SESSION_STATE.INTERRUPTED, SESSION_STATE.CANCELLED],
  [SESSION_STATE.COMPLETED]:   [],
  [SESSION_STATE.INTERRUPTED]: [],
  [SESSION_STATE.CANCELLED]:   [],
});

/** `from` holatidan `to` holatiga o'tish ruxsat etilganmi? */
function canTransition(from, to) {
  const allowed = SESSION_TRANSITIONS[from];
  return Array.isArray(allowed) && allowed.includes(to);
}

/** Holat yakuniymi (tarixga o'tganmi)? */
function isTerminal(state) {
  return TERMINAL_STATES.includes(state);
}

/** Sessiya hozir "jonli" (vaqt sanalayotgan) holatdami? */
function isLive(state) {
  return state === SESSION_STATE.ACTIVE || state === SESSION_STATE.PAUSED;
}

// Vazifa (task) holatlari — spec PART 6 §3. PART 1 uchun subtask'lar
// oddiy done/undone, lekin kelajakdagi to'liq task-tizimi uchun tayyor.
const TASK_STATE = Object.freeze({
  TODO: 'todo',
  IN_PROGRESS: 'in_progress',
  COMPLETED: 'completed',
});

// Refleksiya baholari — spec PART 1 §14 ("Great / Good / Difficult").
const REFLECTION_RATING = Object.freeze(['great', 'good', 'difficult']);

// ═══════════════════════════════════════════════════════════════════════════
// DISTRACTION / EXIT — spec PART 1 §12, PART 2 §15-16, PART 3 §8.
// PART 1'da faqat MA'LUMOT MODELI quriladi (aniqlash/AI keyingi qismlarda).
// OS bermaydigan ma'lumotni O'YLAB TOPMAYMIZ — noma'lum maydonlar `null`.
// ═══════════════════════════════════════════════════════════════════════════

const EXIT_REASON = Object.freeze([
  'important_task', 'communication', 'emergency', 'quick_action',
  'research', 'break', 'just_checking', 'other', 'unknown',
]);

const DISTRACTION_CATEGORY = Object.freeze([
  'productive', 'necessary', 'urgent', 'communication',
  'research', 'entertainment', 'social', 'unknown',
]);

// AI qarori — spec PART 2 §10. PART 1'da ishlatilmaydi, lekin model tayyor.
const AI_DECISION = Object.freeze(['allow', 'stay_focused', 'schedule', 'ask_clarification']);

// ═══════════════════════════════════════════════════════════════════════════
// CHEGARALAR — kiritishni tozalash uchun (xavfsizlik / DoS oldini olish)
// ═══════════════════════════════════════════════════════════════════════════

const LIMITS = Object.freeze({
  GOAL: 200,
  TASK: 200,
  REASON: 500,
  SUCCESS: 300,
  SUBTASK: 160,
  SUBTASKS_MAX: 20,
  REFLECTION_NOTE: 500,
  DURATION_MIN: 1,      // domen darajasida yumshoq; UI 5–240 taklif qiladi
  DURATION_MAX: 600,
  DURATION_DEFAULT: 45,
});

/** UI ko'rsatadigan davomiylik presetlari (daqiqa) — spec PART 1 §7. */
const DURATION_PRESETS = Object.freeze([25, 45, 60, 90]);

// ═══════════════════════════════════════════════════════════════════════════
// YORDAMCHILAR
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Matnni tozalash: satr emasligini, ortiqcha bo'shliq va uzunlikni boshqarish.
 * `null`/`undefined` → '' (bo'sh satr). Bu bilan UI hech qachon "undefined"
 * ko'rsatmaydi va backend'ga axlat bormaydi.
 */
function cleanText(value, maxLen) {
  if (value === null || value === undefined) return '';
  let str = String(value);
  // Boshqaruv belgilarini (control chars) olib tashlaymiz, tab/newline'dan tashqari.
  str = str.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');
  str = str.trim();
  if (typeof maxLen === 'number' && str.length > maxLen) str = str.slice(0, maxLen).trim();
  return str;
}

/** Sonni xavfsiz clamp qilish. NaN bo'lsa `fallback`. */
function clampNumber(value, min, max, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

/**
 * Barqaror, o'qilishi mumkin ID. `crypto` mavjud bo'lsa (Node/desktop) undan
 * foydalanamiz; bo'lmasa (ehtiyot uchun) Date+random. Mobil platforma o'z
 * generatoridan foydalanishi mumkin — muhimi format `prefix_...` bo'lishi.
 */
function newId(prefix) {
  const p = prefix ? `${prefix}_` : '';
  try {
    // eslint-disable-next-line global-require
    const nodeCrypto = require('crypto');
    if (nodeCrypto && typeof nodeCrypto.randomBytes === 'function') {
      return p + nodeCrypto.randomBytes(9).toString('hex');
    }
  } catch (_) { /* crypto yo'q — fallback'ga o'tamiz */ }
  return p + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

// ═══════════════════════════════════════════════════════════════════════════
// FACTORY'LAR
// ═══════════════════════════════════════════════════════════════════════════

/** Subtask yaratish. Bo'sh sarlavha → `null` (chaqiruvchi tashlab yuboradi). */
function createSubtask(title, done = false) {
  const t = cleanText(title, LIMITS.SUBTASK);
  if (!t) return null;
  return { id: newId('st'), title: t, done: !!done };
}

/** Subtask ro'yxatini tozalash: bo'shlarni tashlash, maksimumga cheklash. */
function normalizeSubtasks(list) {
  if (!Array.isArray(list)) return [];
  const out = [];
  for (const item of list) {
    if (out.length >= LIMITS.SUBTASKS_MAX) break;
    const title = typeof item === 'string' ? item : (item && item.title);
    const done = typeof item === 'object' && item ? !!item.done : false;
    const st = createSubtask(title, done);
    if (st) out.push(st);
  }
  return out;
}

/**
 * Foydalanuvchi kiritgan sessiya ma'lumotini tekshirish va tozalash.
 *
 * Qaytadi: `{ ok: true, value }` yoki `{ ok: false, error }`.
 *
 * Majburiy: goal (maqsad), task (vazifa), duration.
 * Ixtiyoriy: reason (nega muhim), successCriteria, subtasks, mode, strongFocus.
 *
 * MUHIM (spec): goal va task foydalanuvchining O'Z so'zlari. Biz ularni
 * o'ylab topmaymiz, generatsiya qilmaymiz — faqat qabul qilamiz va saqlaymiz.
 */
function validateSessionInput(input = {}) {
  const goal = cleanText(input.goal, LIMITS.GOAL);
  if (!goal) return { ok: false, error: 'Maqsad (goal) kiritilishi shart' };

  const task = cleanText(input.task, LIMITS.TASK);
  if (!task) return { ok: false, error: 'Vazifa (task) kiritilishi shart' };

  const durationMinutes = clampNumber(
    input.durationMinutes, LIMITS.DURATION_MIN, LIMITS.DURATION_MAX, LIMITS.DURATION_DEFAULT,
  );

  const value = {
    goal,
    task,
    reason: cleanText(input.reason, LIMITS.REASON),                 // ixtiyoriy
    successCriteria: cleanText(input.successCriteria, LIMITS.SUCCESS), // ixtiyoriy
    durationMinutes: Math.round(durationMinutes),
    subtasks: normalizeSubtasks(input.subtasks),
    mode: input.mode === 'scheduled' ? 'scheduled' : 'start-now',
    // Strong Focus — ixtiyoriy, foydalanuvchi qo'lda yoqadi (spec PART 5 §10).
    // Default: o'chiq → oddiy Focus hech nimani bloklamaydi.
    strongFocus: !!input.strongFocus,
  };
  return { ok: true, value };
}

/**
 * Refleksiyani tekshirish/tozalash — spec PART 1 §14.
 * Barchasi ixtiyoriy: rating, note, completionStatus.
 */
function normalizeReflection(input = {}) {
  const rating = REFLECTION_RATING.includes(input.rating) ? input.rating : null;
  const completionStatus = ['completed', 'partial', 'interrupted', 'need_more_time']
    .includes(input.completionStatus) ? input.completionStatus : null;
  return {
    rating,
    note: cleanText(input.note, LIMITS.REFLECTION_NOTE),
    completionStatus,
    recordedAt: Date.now(),
  };
}

/**
 * DistractionEvent (chalg'ish/chiqish hodisasi) ma'lumot modeli.
 * Spec PART 2 §15, PART 3 §8. OS bermaydigan narsa `null` bo'lib qoladi —
 * hech narsa O'YLAB TOPILMAYDI.
 */
function createDistractionEvent(input = {}) {
  const category = DISTRACTION_CATEGORY.includes(input.category) ? input.category : 'unknown';
  const userReason = EXIT_REASON.includes(input.userReason) ? input.userReason : 'unknown';
  const aiDecision = AI_DECISION.includes(input.aiDecision) ? input.aiDecision : null;
  return {
    id: newId('dx'),
    sessionId: input.sessionId || null,
    timestamp: Number(input.timestamp) || Date.now(),
    platform: cleanText(input.platform, 32) || null,
    source: cleanText(input.source, 64) || 'niex',
    destination: cleanText(input.destination, 128) || null, // masalan boshqa ilova — OS bersa
    userReason,
    userReasonText: cleanText(input.userReasonText, LIMITS.REASON), // erkin matn
    category,
    urgency: clampNumber(input.urgency, 0, 1, null),
    aiDecision,
    userDecision: cleanText(input.userDecision, 32) || null,
    durationOutsideMs: Number.isFinite(Number(input.durationOutsideMs)) ? Number(input.durationOutsideMs) : null,
    scheduledFor: Number(input.scheduledFor) || null,
    resolved: !!input.resolved,
  };
}

module.exports = {
  SESSION_STATE,
  TERMINAL_STATES,
  SESSION_TRANSITIONS,
  TASK_STATE,
  REFLECTION_RATING,
  EXIT_REASON,
  DISTRACTION_CATEGORY,
  AI_DECISION,
  LIMITS,
  DURATION_PRESETS,
  // funksiyalar
  canTransition,
  isTerminal,
  isLive,
  cleanText,
  clampNumber,
  newId,
  createSubtask,
  normalizeSubtasks,
  validateSessionInput,
  normalizeReflection,
  createDistractionEvent,
};
