'use strict';

const fs = require('fs');
const path = require('path');
const D = require('./focus-domain');

/**
 * NIEX Focus — Sessiya menejeri (desktop / Node tomoni).
 *
 * Vazifasi (spec PART 1 §21 "Keep product logic separate from UI"):
 *   Domain (focus-domain.js) — toza qoidalar.
 *   FocusManager        — vaqtni o'lchash, diskka saqlash, holat mashinasini
 *                         qo'llash, statistika. Bitta AUTHORITATIVE holat manbai.
 *
 * MUHIM tamoyillar:
 *   - Timer HAQIQIY: heartbeat orqali o'lchangan `focusedMs` diskda saqlanadi;
 *     sahifa yangilanishi yoki ilova qayta ochilishi sessiyani nolga tushirmaydi
 *     (spec PART 1 §7, PART 3 §10, PART 8 §5).
 *   - Oddiy Focus HECH NIMANI BLOKLAMAYDI. Bloklash faqat foydalanuvchi qo'lda
 *     yoqadigan `strongFocus` sessiyalarida (spec: "Focus is NOT a website blocker").
 *   - Rejalashtirilgan vaqtni "bajarilgan" deb sanamaymiz — faqat isbotlangan
 *     (heartbeat o'lchagan) vaqt hisobga olinadi.
 */

/** Sessiya hisobga olinishi uchun eng kam vaqt (aks holda "kun faol" sanalmaydi). */
const MIN_MEANINGFUL_MINUTES = 1;

/** Heartbeat oralig'i — haqiqiy focus vaqti shu qadamda diskka yoziladi. */
const HEARTBEAT_MS = 15000;

/**
 * Sessiya "yakunlangan" (COMPLETED) sanalishi uchun rejalashtirilgan vaqtning
 * kamida shu ulushi focus qilingan bo'lishi kerak. Undan kam bo'lsa — "chala"
 * (INTERRUPTED). Aks holda 1 daqiqa ishlab End bosgan ham "yakunlangan" bo'lardi.
 */
const COMPLETION_RATIO = 0.9;

class FocusManager {
  constructor(options = {}) {
    this.storagePath = options.storagePath || path.join(process.cwd(), 'focus-sessions.json');
    this.subscriptionManager = options.subscriptionManager;
    this.blockEngine = options.blockEngine;
    this.scheduler = options.scheduler;
    // main.js broadcastFocusState'ni ulaydi — heartbeat sessiyani avtomatik
    // yakunlaganda UI'ga xabar berish uchun (IPC'siz yagona holat).
    this.onChange = typeof options.onChange === 'function' ? options.onChange : null;

    this.state = this._loadState();
    this.activeSession = null;
    this._heartbeat = null;
    this._migrateAll();
    this._restoreOrNormalize();
  }

  // ═══════════════════════════════════════════════════════════════
  // YUKLASH / SAQLASH / MIGRATSIYA
  // ═══════════════════════════════════════════════════════════════

  _emptyState() {
    return {
      version: 2,
      sessions: [],
      // Legacy: eski UI o'qishi mumkin. Yangi statistika sessiyalardan hisoblanadi.
      stats: {
        daily: { focusedMinutes: 0, blockedAttempts: 0, topBlockedSite: null },
        weekly: { totalFocusHours: 0, averageSessionMinutes: 0, longestSessionMinutes: 0 },
      },
    };
  }

  _loadState() {
    try {
      if (!fs.existsSync(this.storagePath)) return this._emptyState();
      const parsed = JSON.parse(fs.readFileSync(this.storagePath, 'utf8'));
      if (!parsed || typeof parsed !== 'object') return this._emptyState();
      if (!Array.isArray(parsed.sessions)) parsed.sessions = [];
      if (!parsed.stats) parsed.stats = this._emptyState().stats;
      return parsed;
    } catch (error) {
      // Buzilgan fayl — bo'sh holatdan boshlaymiz, lekin ma'lumotni ustidan
      // yozib yubormaymiz (keyingi muvaffaqiyatli _saveState yozadi).
      return this._emptyState();
    }
  }

  _saveState() {
    try {
      fs.mkdirSync(path.dirname(this.storagePath), { recursive: true });
      // Atomik yozuv: avval .tmp ga, keyin rename — yozish paytida crash bo'lsa
      // asosiy fayl buzilmaydi (spec PART 8 §21 storage test / crash recovery).
      const tmp = this.storagePath + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify(this.state, null, 2), 'utf8');
      fs.renameSync(tmp, this.storagePath);
    } catch (error) {
      // Diskka yozib bo'lmadi — xotiradagi holat saqlanadi, ilova ishlashda davom etadi.
    }
  }

  /** Eski (v1) sessiya yozuvlarini yangi modelga keltiradi. Ma'lumot yo'qolmaydi. */
  _migrateAll() {
    let changed = false;
    for (const s of this.state.sessions || []) {
      if (this._migrateSession(s)) changed = true;
    }
    if (changed) this._saveState();
  }

  _migrateSession(s) {
    let changed = false;
    // status (v1) → state (v2)
    if (!s.state) {
      const legacy = s.status;
      const map = {
        active: D.SESSION_STATE.ACTIVE,
        paused: D.SESSION_STATE.PAUSED,
        completed: D.SESSION_STATE.COMPLETED,
        interrupted: D.SESSION_STATE.INTERRUPTED,
        stopped: D.SESSION_STATE.COMPLETED,   // qo'lda to'xtatilgan, haqiqiy vaqt bor edi
        cancelled: D.SESSION_STATE.CANCELLED,
      };
      s.state = map[legacy] || D.SESSION_STATE.INTERRUPTED;
      changed = true;
    }
    if ('status' in s) { delete s.status; changed = true; }
    // Yangi majburiy maydonlar (legacy sessiyalarda yo'q edi)
    if (typeof s.goal !== 'string') { s.goal = ''; changed = true; }
    if (typeof s.task !== 'string') { s.task = ''; changed = true; }
    if (typeof s.reason !== 'string') { s.reason = ''; changed = true; }
    if (typeof s.successCriteria !== 'string') { s.successCriteria = ''; changed = true; }
    if (!Array.isArray(s.subtasks)) { s.subtasks = []; changed = true; }
    if (!Array.isArray(s.distractionEvents)) { s.distractionEvents = []; changed = true; }
    if (!Array.isArray(s.blockedSites)) { s.blockedSites = []; changed = true; }
    if (!s.activity || typeof s.activity !== 'object') { s.activity = { scrollingMs: 0, byPlatform: {}, currentType: 'idle', currentPlatform: null, currentContext: null }; changed = true; }
    if (s.reflection === undefined) { s.reflection = null; changed = true; }
    if (typeof s.strongFocus !== 'boolean') { s.strongFocus = false; changed = true; }
    if (typeof s.focusedMs !== 'number') { s.focusedMs = 0; changed = true; }
    if (!s.createdAt) { s.createdAt = Number(s.startedAt) || Date.now(); changed = true; }
    if (!s.platform) { s.platform = 'desktop'; changed = true; }
    // Tuzatish (eski data): xato COMPLETED belgilangan (rejalashtirilgan vaqtning
    // 90% i bajarilmagan va refleksiyada 'completed' demagan) sessiyalarni
    // CHALA (INTERRUPTED) qilamiz. Idempotent — bir marta o'zgaradi.
    if (s.state === D.SESSION_STATE.COMPLETED && !this._isFulfilled(s)
        && !(s.reflection && s.reflection.completionStatus === 'completed')) {
      s.state = D.SESSION_STATE.INTERRUPTED;
      changed = true;
    }
    return changed;
  }

  /**
   * Ilova ochilganda oxirgi jonli (active/paused) sessiyani tiklaydi.
   *
   * Spec PART 3 §10: "Never silently reset a 60-minute session to zero."
   * Shu sababli:
   *   - endsAt hali kelajakda bo'lsa → sessiyani PAUSED holida tiklaymiz, foydalanuvchi
   *     davom ettirishi mumkin. Ilova yopiq turgan vaqt focus vaqtiga QO'SHILMAYDI
   *     (focusedMs faqat heartbeat orqali, ilova ochiq bo'lganda o'sadi).
   *   - endsAt allaqachon o'tgan bo'lsa → COMPLETED (rejalashtirilgan vaqt tugagan).
   * Boshqa g'alati jonli yozuvlar (bo'lmasligi kerak) → INTERRUPTED.
   */
  _restoreOrNormalize() {
    const live = (this.state.sessions || []).filter((s) => D.isLive(s.state));
    // Eng so'nggi jonli sessiya — tiklash nomzodi.
    live.sort((a, b) => (Number(b.startedAt) || 0) - (Number(a.startedAt) || 0));
    const candidate = live[0] || null;
    let changed = false;

    for (const s of live) {
      if (s === candidate) continue;
      s.state = D.SESSION_STATE.INTERRUPTED;
      delete s.lastTickAt;
      changed = true;
    }

    if (candidate) {
      const lastKnown = Number(candidate.lastTickAt) || Number(candidate.startedAt) || Date.now();
      const remaining = (Number(candidate.endsAt) || lastKnown) - lastKnown;
      delete candidate.lastTickAt;
      if (remaining > 0) {
        // Davom ettirish uchun PAUSED holida tiklaymiz.
        candidate.state = D.SESSION_STATE.PAUSED;
        candidate.remainingMs = remaining;
        this.activeSession = candidate;
      } else {
        // Rejalashtirilgan vaqt o'tgan — haqiqatda bajarilgan bo'lsa COMPLETED,
        // kam focus qilingan bo'lsa CHALA (INTERRUPTED).
        candidate.state = this._isFulfilled(candidate) ? D.SESSION_STATE.COMPLETED : D.SESSION_STATE.INTERRUPTED;
        candidate.endedAt = Number(candidate.endsAt) || lastKnown;
        delete candidate.remainingMs;
      }
      changed = true;
    }

    if (changed) this._saveState();
  }

  // ═══════════════════════════════════════════════════════════════
  // VAQT (heartbeat) — spec PART 1 §7, PART 4 §20
  // ═══════════════════════════════════════════════════════════════

  /** Faol sessiyaga oxirgi tick'dan beri o'tgan vaqtni qo'shadi. */
  _accrue(now = Date.now()) {
    const s = this.activeSession;
    if (!s || s.state !== D.SESSION_STATE.ACTIVE) return;
    const last = Number(s.lastTickAt) || Number(s.startedAt) || now;
    s.focusedMs = (Number(s.focusedMs) || 0) + Math.max(0, now - last);
    s.lastTickAt = now;
    const capMs = (Number(s.durationMinutes) || 0) * 60000;
    if (capMs > 0 && s.focusedMs > capMs) s.focusedMs = capMs;
  }

  _startHeartbeat() {
    this._stopHeartbeat();
    this._heartbeat = setInterval(() => {
      const s = this.activeSession;
      if (!s) { this._stopHeartbeat(); return; }
      const now = Date.now();
      this._accrue(now);
      // Rejalashtirilgan vaqt tugagan bo'lsa — tabiiy yakunlaymiz.
      if (s.state === D.SESSION_STATE.ACTIVE && Number(s.endsAt) && now >= Number(s.endsAt)) {
        s.state = D.SESSION_STATE.COMPLETED;
        s.endedAt = Number(s.endsAt);
        delete s.lastTickAt;
        this.activeSession = null;
        this._stopHeartbeat();
        this._saveState();
        // UI'ga xabar beramiz (bu yo'l IPC orqali chaqirilmagan).
        if (this.onChange) { try { this.onChange(); } catch (_) {} }
        return;
      }
      this._saveState();
    }, HEARTBEAT_MS);
    if (this._heartbeat.unref) this._heartbeat.unref();
  }

  _stopHeartbeat() {
    if (this._heartbeat) { clearInterval(this._heartbeat); this._heartbeat = null; }
  }

  // ═══════════════════════════════════════════════════════════════
  // KIRISH HUQUQI (Pro gate) — mavjud xatti-harakat saqlanadi
  // ═══════════════════════════════════════════════════════════════

  canUseFocus() {
    // subscriptionManager bo'lmasa (ehtiyot uchun) — ruxsat bermaymiz, mavjud
    // xatti-harakatga mos (Focus Pro funksiyasi). Bitta joyda — kelajakda launch
    // uchun oson o'zgartiriladi.
    return !!this.subscriptionManager?.isFeatureEnabled?.('focusMode');
  }

  // ═══════════════════════════════════════════════════════════════
  // SESSIYA HAYOTIY SIKLI — spec PART 1 §8, PART 8 §19 (state machine)
  // ═══════════════════════════════════════════════════════════════

  /**
   * Yangi Focus sessiyasini boshlaydi (start-now).
   * `payload`: { goal, task, reason?, successCriteria?, durationMinutes, subtasks?, strongFocus? }
   */
  startSession(payload = {}) {
    if (!this.canUseFocus()) {
      return { ok: false, error: 'Focus Mode Pro tarifida mavjud', code: 'pro_required' };
    }
    // Bir vaqtda faqat bitta jonli sessiya (spec PART 4 §19 data integrity).
    if (this.activeSession && D.isLive(this.activeSession.state)) {
      return { ok: false, error: 'Allaqachon faol Focus sessiyasi bor', code: 'already_active' };
    }

    const validated = D.validateSessionInput(payload);
    if (!validated.ok) return { ok: false, error: validated.error, code: 'invalid_input' };
    const v = validated.value;

    const now = Date.now();
    const durationMs = v.durationMinutes * 60 * 1000;
    const session = {
      id: D.newId('focus'),
      createdAt: now,
      startedAt: now,
      endsAt: now + durationMs,
      endedAt: null,
      durationMinutes: v.durationMinutes,
      state: D.SESSION_STATE.ACTIVE,
      goal: v.goal,
      task: v.task,
      reason: v.reason,
      successCriteria: v.successCriteria,
      subtasks: v.subtasks,
      strongFocus: v.strongFocus,
      mode: v.mode,
      platform: 'desktop',
      focusedMs: 0,       // haqiqiy focus vaqti (heartbeat to'ldiradi)
      lastTickAt: now,
      reflection: null,
      distractionEvents: [],
      blockedSites: [],   // faqat strongFocus'da to'ladi
      activity: { scrollingMs: 0, byPlatform: {}, currentType: 'idle', currentPlatform: null, currentContext: null },
    };

    this.activeSession = session;
    this.state.sessions.push(session);
    this._saveState();
    this._startHeartbeat();
    return { ok: true, session };
  }

  pauseSession() {
    const s = this.activeSession;
    if (!s) return { ok: false, error: 'Faol sessiya yo\'q' };
    if (!D.canTransition(s.state, D.SESSION_STATE.PAUSED)) {
      return { ok: false, error: 'Bu holatda pauza qilib bo\'lmaydi' };
    }
    const now = Date.now();
    this._accrue(now);
    s.state = D.SESSION_STATE.PAUSED;
    s.remainingMs = Math.max(0, Number(s.endsAt) - now); // davom ettirganda tiklanadi
    delete s.lastTickAt;
    this._stopHeartbeat();
    this._saveState();
    return { ok: true, session: s };
  }

  resumeSession() {
    const s = this.activeSession;
    if (!s) return { ok: false, error: 'Pauza qilingan sessiya yo\'q' };
    if (!D.canTransition(s.state, D.SESSION_STATE.ACTIVE)) {
      return { ok: false, error: 'Bu holatni davom ettirib bo\'lmaydi' };
    }
    const now = Date.now();
    const remaining = Number(s.remainingMs);
    // Pauzada saqlangan QOLGAN vaqtdan davom etamiz (to'liq davomiylikni qayta boshlamaymiz).
    s.endsAt = now + (Number.isFinite(remaining) && remaining >= 0
      ? remaining
      : Math.max(0, Number(s.endsAt) - now));
    delete s.remainingMs;
    s.state = D.SESSION_STATE.ACTIVE;
    s.lastTickAt = now;
    this._startHeartbeat();
    this._saveState();
    return { ok: true, session: s };
  }

  /**
   * Foydalanuvchi sessiyani YAKUNLAYDI (End). Haqiqiy focus vaqti saqlanadi,
   * holat COMPLETED bo'ladi. Keyin UI refleksiya ekranini ko'rsatadi
   * (`saveReflection` bilan yoziladi).
   */
  endSession() {
    const s = this.activeSession;
    if (!s) return { ok: false, error: 'Faol sessiya yo\'q' };
    const now = Date.now();
    if (s.state === D.SESSION_STATE.ACTIVE) this._accrue(now);
    // Rejalashtirilgan vaqtning >=90% i bajarilgan bo'lsa YAKUNLANGAN, aks holda CHALA (uzilgan).
    s.state = this._isFulfilled(s, now) ? D.SESSION_STATE.COMPLETED : D.SESSION_STATE.INTERRUPTED;
    s.endedAt = now;
    delete s.lastTickAt;
    delete s.remainingMs;
    this._stopHeartbeat();
    this.activeSession = null;
    this._saveState();
    return { ok: true, session: s };
  }

  /** Foydalanuvchi sessiyani BEKOR qiladi (Cancel). Haqiqiy vaqt baribir saqlanadi. */
  cancelSession() {
    const s = this.activeSession;
    if (!s) return { ok: false, error: 'Faol sessiya yo\'q' };
    const now = Date.now();
    if (s.state === D.SESSION_STATE.ACTIVE) this._accrue(now);
    s.state = D.SESSION_STATE.CANCELLED;
    s.endedAt = now;
    delete s.lastTickAt;
    delete s.remainingMs;
    this._stopHeartbeat();
    this.activeSession = null;
    this._saveState();
    return { ok: true, session: s };
  }

  /** Refleksiyani sessiyaga biriktiradi (spec PART 1 §14). Sessiya yakunlangan bo'lishi kerak. */
  saveReflection(sessionId, reflectionInput = {}) {
    const s = this._findSession(sessionId);
    if (!s) return { ok: false, error: 'Sessiya topilmadi' };
    s.reflection = D.normalizeReflection(reflectionInput);
    // Foydalanuvchining o'z bahosi holatni aniqlashtiradi (bekor qilinmagan sessiyalar).
    // "Bajarildi" → YAKUNLANGAN; "Qisman/Uzildi/Vaqt kerak" → CHALA (INTERRUPTED).
    const cs = s.reflection.completionStatus;
    if (cs && s.state !== D.SESSION_STATE.CANCELLED) {
      if (cs === 'completed') s.state = D.SESSION_STATE.COMPLETED;
      else if (cs === 'partial' || cs === 'interrupted' || cs === 'need_more_time') s.state = D.SESSION_STATE.INTERRUPTED;
    }
    this._saveState();
    return { ok: true, session: s };
  }

  /**
   * Subtask holatini o'zgartiradi. Faol sessiyada (belgilash) yoki yakunlangan
   * sessiyada (refleksiya paytida to'g'rilash) ishlaydi.
   */
  setSubtaskDone(subtaskId, done, sessionId = null) {
    let s = null;
    if (sessionId) s = this._findSession(sessionId);
    if (!s && this.activeSession) s = this.activeSession;
    if (!s) return { ok: false, error: 'Sessiya topilmadi' };
    const st = (s.subtasks || []).find((x) => x.id === subtaskId);
    if (!st) return { ok: false, error: 'Subtask topilmadi' };
    st.done = !!done;
    this._saveState();
    return { ok: true, session: s };
  }

  /**
   * DistractionEvent yozadi — spec PART 1 §12 (PART 2/3 uchun poydevor).
   * Aniqlash (window blur, OS monitoring) va AI qarori keyingi qismlarda ulanadi.
   */
  recordDistractionEvent(partial = {}) {
    const s = this.activeSession;
    if (!s) return { ok: false, error: 'Faol sessiya yo\'q' };
    const ev = D.createDistractionEvent({ ...partial, sessionId: s.id, platform: 'desktop' });
    s.distractionEvents.push(ev);
    this._saveState();
    return { ok: true, event: ev };
  }

  _findSession(id) {
    if (!id) return null;
    return (this.state.sessions || []).find((s) => s.id === id) || null;
  }

  /**
   * DistractionEvent'ni yangilaydi (AI qarori / foydalanuvchi qarori / hal qilindi).
   * Faqat ruxsat etilgan, tekshirilgan maydonlar o'zgaradi (xavfsizlik).
   */
  updateDistractionEvent(id, patch = {}) {
    for (const s of this.state.sessions || []) {
      const ev = (s.distractionEvents || []).find((e) => e.id === id);
      if (!ev) continue;
      if (patch.userReason !== undefined && D.EXIT_REASON.includes(patch.userReason)) ev.userReason = patch.userReason;
      if (patch.userReasonText !== undefined) ev.userReasonText = D.cleanText(patch.userReasonText, D.LIMITS.REASON);
      if (patch.category !== undefined && D.DISTRACTION_CATEGORY.includes(patch.category)) ev.category = patch.category;
      if (patch.aiDecision !== undefined && D.AI_DECISION.includes(patch.aiDecision)) ev.aiDecision = patch.aiDecision;
      if (patch.userDecision !== undefined) ev.userDecision = D.cleanText(patch.userDecision, 32) || ev.userDecision;
      if (patch.urgency !== undefined) ev.urgency = D.clampNumber(patch.urgency, 0, 1, ev.urgency);
      if (patch.scheduledFor !== undefined) ev.scheduledFor = Number(patch.scheduledFor) || ev.scheduledFor;
      if (patch.resolved !== undefined) ev.resolved = !!patch.resolved;
      this._saveState();
      return { ok: true, event: ev };
    }
    return { ok: false, error: 'Event topilmadi' };
  }

  /**
   * Bugungi chalg'ish naqshi (spec PART 2 §17) — takroriy sabablarni aniqlash
   * uchun. Faqat sababi belgilangan (unknown emas) hodisalar hisobga olinadi.
   */
  getDistractionSummary(now = Date.now()) {
    const todayKey = this._dayKey(now);
    const counts = {};
    let total = 0;
    for (const s of this.state.sessions || []) {
      for (const ev of s.distractionEvents || []) {
        if (this._dayKey(Number(ev.timestamp) || 0) !== todayKey) continue;
        total += 1;
        if (!ev.userReason || ev.userReason === 'unknown') continue;
        counts[ev.userReason] = (counts[ev.userReason] || 0) + 1;
      }
    }
    let commonCategory = null;
    let commonCount = 0;
    for (const k of Object.keys(counts)) {
      if (counts[k] > commonCount) { commonCount = counts[k]; commonCategory = k; }
    }
    return { total, commonCategory, commonCount };
  }

  /** Faol sessiya konteksti — AI qaroriga MINIMAL ma'lumot (spec PART 4 §15). */
  getActiveContext(now = Date.now()) {
    const s = this.activeSession;
    if (!s) return null;
    const remainingMs = s.state === D.SESSION_STATE.ACTIVE
      ? Math.max(0, Number(s.endsAt) - now)
      : (Number(s.remainingMs) || 0);
    const act = s.activity || {};
    return {
      sessionId: s.id,
      goal: s.goal,
      task: s.task,
      reason: s.reason,
      successCriteria: s.successCriteria,
      remainingMinutes: Math.round(remainingMs / 60000),
      state: s.state,
      scrollingMinutes: Math.round((Number(act.scrollingMs) || 0) / 60000),
      scrollingMs: Number(act.scrollingMs) || 0,
      currentActivity: act.currentType || 'idle',
      currentPlatform: act.currentPlatform || null,
    };
  }

  // ── PART 1 (scrolling engine): activity metrikalari ──
  /** Content script'dan kelgan haqiqiy scrolling deltasini sessiyaga qo'shadi. */
  addScrollingMs(deltaMs, meta = {}) {
    const s = this.activeSession;
    if (!s || s.state !== D.SESSION_STATE.ACTIVE) return;
    if (!s.activity) s.activity = { scrollingMs: 0, byPlatform: {}, currentType: 'idle', currentPlatform: null, currentContext: null };
    const d = Math.max(0, Number(deltaMs) || 0);
    if (!d) return;
    s.activity.scrollingMs += d;
    const pf = meta.platform;
    if (pf) s.activity.byPlatform[pf] = (s.activity.byPlatform[pf] || 0) + d;
    // Diskka yozish heartbeat orqali (har xabarda emas — perf, spec §17).
  }

  /** Joriy activity turini yangilaydi (scrolling/video/search/chat/reading). */
  setCurrentActivity(type, platform, context) {
    const s = this.activeSession;
    if (!s || !s.activity) return;
    s.activity.currentType = type || 'idle';
    s.activity.currentPlatform = platform || null;
    s.activity.currentContext = context || null;
  }

  /** Joriy sessiyaning yig'ilgan haqiqiy scrolling vaqti (ms) — PART 2 threshold uchun. */
  getScrollingMs() {
    return this.activeSession && this.activeSession.activity
      ? (Number(this.activeSession.activity.scrollingMs) || 0)
      : 0;
  }

  // ═══════════════════════════════════════════════════════════════
  // STATISTIKA — sessiyalar ro'yxatidan qayta hisoblanadi (drift yo'q).
  // ═══════════════════════════════════════════════════════════════

  _dayKey(ts) {
    const d = new Date(ts);
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${d.getFullYear()}-${m}-${day}`;
  }

  _monthKey(ts) {
    const d = new Date(ts);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  }

  /**
   * Sessiyada HAQIQATDA o'tkazilgan daqiqalar.
   *  1. `focusedMs` — heartbeat o'lchagan haqiqiy vaqt (faol bo'lsa oxirgi tick qo'shiladi).
   *  2. Eski, qo'lda to'xtatilgan (`endedAt` bor) → haqiqiy oraliq.
   *  3. Tasdiqlanmagan (ilova yopilgan, endedAt yo'q) → 0 (taxmin qilmaymiz).
   */
  _sessionMinutes(s, now = Date.now()) {
    const started = Number(s.startedAt) || 0;
    if (!started) return 0;
    const planned = Number(s.durationMinutes) || 0;
    const cap = (v) => (planned > 0 ? Math.min(v, planned) : v);

    if (typeof s.focusedMs === 'number') {
      let ms = Math.max(0, s.focusedMs);
      if (s.state === D.SESSION_STATE.ACTIVE && s.lastTickAt) {
        ms += Math.max(0, now - Number(s.lastTickAt));
      }
      return Math.max(0, cap(ms / 60000));
    }
    if (s.endedAt) return Math.max(0, cap((Number(s.endedAt) - started) / 60000));
    return 0;
  }

  _isMeaningful(s, now = Date.now()) {
    return this._sessionMinutes(s, now) >= MIN_MEANINGFUL_MINUTES;
  }

  /** Sessiya haqiqatda bajarilganmi — rejalashtirilgan vaqtning >=90% i focus qilingan. */
  _isFulfilled(s, now = Date.now()) {
    const planned = Number(s.durationMinutes) || 0;
    if (planned <= 0) return true;
    return this._sessionMinutes(s, now) >= planned * COMPLETION_RATIO;
  }

  _groupByDay(now = Date.now()) {
    const days = {};
    for (const s of this.state.sessions || []) {
      const started = Number(s.startedAt) || 0;
      if (!started) continue;
      const key = this._dayKey(started);
      if (!days[key]) days[key] = { minutes: 0, rawMinutes: 0, sessions: 0, startedCount: 0, blocked: 0 };
      days[key].rawMinutes += this._sessionMinutes(s, now);
      days[key].startedCount += 1;
      if (this._isMeaningful(s, now)) days[key].sessions += 1;
      days[key].blocked += Array.isArray(s.blockedSites) ? s.blockedSites.length : 0;
    }
    for (const k of Object.keys(days)) days[k].minutes = Math.round(days[k].rawMinutes);
    return days;
  }

  _dayCounts(days, key) {
    const d = days[key];
    if (!d) return false;
    return d.sessions > 0 && d.rawMinutes >= MIN_MEANINGFUL_MINUTES;
  }

  _computeStreak(days, now = Date.now()) {
    const has = (d) => this._dayCounts(days, this._dayKey(d.getTime()));
    const DAY = 86400000;
    const today = new Date(now);
    today.setHours(0, 0, 0, 0);
    let cursor = new Date(today);
    if (!has(cursor)) {
      cursor = new Date(today.getTime() - DAY);
      if (!has(cursor)) {
        return { current: 0, longest: this._longestStreak(days), lastActiveDay: this._lastActiveDay(days) };
      }
    }
    let current = 0;
    while (has(cursor)) {
      current += 1;
      cursor = new Date(cursor.getTime() - DAY);
    }
    return { current, longest: this._longestStreak(days), lastActiveDay: this._lastActiveDay(days) };
  }

  _longestStreak(days) {
    const keys = Object.keys(days).filter((k) => this._dayCounts(days, k)).sort();
    if (!keys.length) return 0;
    let longest = 1, run = 1;
    for (let i = 1; i < keys.length; i++) {
      const prev = new Date(keys[i - 1] + 'T00:00:00');
      const cur = new Date(keys[i] + 'T00:00:00');
      const diffDays = Math.round((cur - prev) / 86400000);
      run = diffDays === 1 ? run + 1 : 1;
      if (run > longest) longest = run;
    }
    return longest;
  }

  _lastActiveDay(days) {
    const keys = Object.keys(days).filter((k) => this._dayCounts(days, k)).sort();
    return keys.length ? keys[keys.length - 1] : null;
  }

  _lastNDays(days, n, now = Date.now()) {
    const out = [];
    const today = new Date(now);
    today.setHours(0, 0, 0, 0);
    for (let i = n - 1; i >= 0; i--) {
      const d = new Date(today.getTime() - i * 86400000);
      const key = this._dayKey(d.getTime());
      const rec = days[key] || { minutes: 0, sessions: 0, blocked: 0 };
      out.push({
        day: key,
        weekday: d.getDay(),
        dayOfMonth: d.getDate(),
        minutes: rec.minutes,
        sessions: rec.sessions,
        blocked: rec.blocked,
      });
    }
    return out;
  }

  _groupByMonth(now = Date.now()) {
    const months = {};
    for (const s of this.state.sessions || []) {
      const started = Number(s.startedAt) || 0;
      if (!started) continue;
      const key = this._monthKey(started);
      if (!months[key]) months[key] = { month: key, minutes: 0, sessions: 0, blocked: 0, dayKeys: new Set() };
      months[key].minutes += this._sessionMinutes(s, now);
      months[key].blocked += Array.isArray(s.blockedSites) ? s.blockedSites.length : 0;
      if (this._isMeaningful(s, now)) {
        months[key].sessions += 1;
        months[key].dayKeys.add(this._dayKey(started));
      }
    }
    return Object.values(months)
      .map((m) => ({
        month: m.month,
        minutes: Math.round(m.minutes),
        sessions: m.sessions,
        blocked: m.blocked,
        activeDays: m.dayKeys.size,
        avgMinutesPerActiveDay: m.dayKeys.size ? Math.round(m.minutes / m.dayKeys.size) : 0,
      }))
      .sort((a, b) => (a.month < b.month ? 1 : -1));
  }

  getStatistics(now = Date.now()) {
    const days = this._groupByDay(now);
    const streak = this._computeStreak(days, now);
    const monthsAll = this._groupByMonth(now);

    const todayKey = this._dayKey(now);
    const today = days[todayKey] || { minutes: 0, sessions: 0, blocked: 0 };

    const curMonthKey = this._monthKey(now);
    const prevDate = new Date(now);
    prevDate.setDate(1);
    prevDate.setMonth(prevDate.getMonth() - 1);
    const prevMonthKey = this._monthKey(prevDate.getTime());

    const empty = (k) => ({ month: k, minutes: 0, sessions: 0, blocked: 0, activeDays: 0, avgMinutesPerActiveDay: 0 });
    const currentMonth = monthsAll.find((m) => m.month === curMonthKey) || empty(curMonthKey);
    const previousMonth = monthsAll.find((m) => m.month === prevMonthKey) || empty(prevMonthKey);

    let totalMinutes = 0, totalBlocked = 0, activeDays = 0;
    for (const k of Object.keys(days)) {
      totalMinutes += days[k].minutes;
      totalBlocked += days[k].blocked;
      if (this._dayCounts(days, k)) activeDays += 1;
    }

    const sessions = this.state.sessions || [];
    const meaningful = sessions.filter((s) => this._isMeaningful(s, now));
    const longestSession = sessions.reduce((mx, s) => Math.max(mx, this._sessionMinutes(s, now)), 0);

    return {
      streak,
      today: { day: todayKey, ...today },
      last7Days: this._lastNDays(days, 7, now),
      last30Days: this._lastNDays(days, 30, now),
      currentMonth,
      previousMonth,
      monthlyHistory: monthsAll.slice(0, 12),
      totals: {
        minutes: Math.round(totalMinutes),
        sessions: meaningful.length,
        startedCount: sessions.length,
        blocked: totalBlocked,
        activeDays,
        longestSessionMinutes: Math.round(longestSession),
        avgSessionMinutes: meaningful.length ? Math.round(totalMinutes / meaningful.length) : 0,
      },
    };
  }

  // ═══════════════════════════════════════════════════════════════
  // PART 4 — ANALITIKA (kunlik / haftalik / trend / goal / distraction)
  //
  // Barcha metrikalar sessiyalardan SHAFFOF hisoblanadi (spec PART 4 §24:
  // sirli "Focus Score" YO'Q — har bir raqamning aniq ta'rifi bor).
  // ═══════════════════════════════════════════════════════════════

  /** Joriy haftaning boshi (Dushanba, 00:00) — mahalliy vaqt bo'yicha. */
  _weekStart(now = Date.now()) {
    const d = new Date(now);
    d.setHours(0, 0, 0, 0);
    const wd = (d.getDay() + 6) % 7; // Dushanba = 0, ..., Yakshanba = 6
    d.setDate(d.getDate() - wd);
    return d.getTime();
  }

  /** Maqsadni guruhlash kaliti (registrsiz, ortiqcha bo'shliqsiz). */
  _goalKey(goal) {
    return D.cleanText(goal, D.LIMITS.GOAL).toLowerCase().replace(/\s+/g, ' ').trim();
  }

  _sessionsBetween(startTs, endTs) {
    return (this.state.sessions || []).filter((s) => {
      const t = Number(s.startedAt) || 0;
      return t >= startTs && t < endTs;
    });
  }

  /** Sessiyalar to'plamining umumlashtirilgan ko'rsatkichlari. */
  _summarizeSessions(sessions, now = Date.now()) {
    let focusMinutes = 0, completed = 0, interrupted = 0, cancelled = 0, tasksCompleted = 0, meaningful = 0;
    const dayKeys = new Set();
    for (const s of sessions) {
      focusMinutes += this._sessionMinutes(s, now);
      if (this._isMeaningful(s, now)) {
        meaningful += 1;
        dayKeys.add(this._dayKey(Number(s.startedAt) || now));
      }
      if (s.state === D.SESSION_STATE.COMPLETED) completed += 1;
      else if (s.state === D.SESSION_STATE.INTERRUPTED) interrupted += 1;
      else if (s.state === D.SESSION_STATE.CANCELLED) cancelled += 1;
      tasksCompleted += (s.subtasks || []).filter((x) => x.done).length;
    }
    const denom = completed + interrupted + cancelled;
    return {
      focusMinutes: Math.round(focusMinutes),
      sessions: meaningful,          // hisobga olingan (>=1 daq)
      started: sessions.length,      // umuman boshlangan
      completed, interrupted, cancelled,
      tasksCompleted,
      activeDays: dayKeys.size,
      avgSessionMinutes: meaningful ? Math.round(focusMinutes / meaningful) : 0,
      // Yakunlanish darajasi: yakunlangan / (yakunlangan+uzilgan+bekor) — aniq ta'rif.
      completionRate: denom ? Math.round((completed / denom) * 100) : 0,
    };
  }

  /** Chalg'ish (chiqish) hodisalarining umumlashtirilgan ko'rsatkichlari. */
  _summarizeDistractions(sessions) {
    let total = 0, minutesOutside = 0, returnedToFocus = 0;
    const byCategory = {};
    for (const s of sessions) {
      for (const ev of s.distractionEvents || []) {
        total += 1;
        minutesOutside += (Number(ev.durationOutsideMs) || 0) / 60000;
        if (ev.userDecision === 'stayed') returnedToFocus += 1;
        const c = ev.category || 'unknown';
        byCategory[c] = (byCategory[c] || 0) + 1;
      }
    }
    return { total, minutesOutside: Math.round(minutesOutside), returnedToFocus, byCategory };
  }

  /** Maqsad bo'yicha taqsimot (spec PART 4 §13-14: goal→session bog'lanishi). */
  getGoalBreakdown(now = Date.now(), limit = 6) {
    const map = new Map();
    for (const s of this.state.sessions || []) {
      if (!this._isMeaningful(s, now)) continue;
      const key = this._goalKey(s.goal);
      if (!key) continue;
      const rec = map.get(key) || { goal: s.goal || '', minutes: 0, sessions: 0, lastActive: 0 };
      rec.minutes += this._sessionMinutes(s, now);
      rec.sessions += 1;
      const t = Number(s.startedAt) || 0;
      if (t > rec.lastActive) { rec.lastActive = t; rec.goal = s.goal || rec.goal; }
      map.set(key, rec);
    }
    return [...map.values()]
      .map((r) => ({ goal: r.goal, minutes: Math.round(r.minutes), sessions: r.sessions, lastActive: r.lastActive }))
      .sort((a, b) => b.minutes - a.minutes)
      .slice(0, limit);
  }

  /** To'liq analitika hisoboti — Statistika ekrani shu obyektni chizadi. */
  getAnalytics(now = Date.now()) {
    const dayStart = new Date(now); dayStart.setHours(0, 0, 0, 0);
    const dayStartTs = dayStart.getTime();
    const weekStartTs = this._weekStart(now);
    const weekEndTs = weekStartTs + 7 * 86400000;
    const lastWeekStartTs = weekStartTs - 7 * 86400000;

    const todaySessions = this._sessionsBetween(dayStartTs, dayStartTs + 86400000);
    const weekSessions = this._sessionsBetween(weekStartTs, weekEndTs);
    const lastWeekSessions = this._sessionsBetween(lastWeekStartTs, weekStartTs);

    const day = this._summarizeSessions(todaySessions, now);
    const week = this._summarizeSessions(weekSessions, now);
    const lastWeek = this._summarizeSessions(lastWeekSessions, now);
    const dayDx = this._summarizeDistractions(todaySessions);
    const weekDx = this._summarizeDistractions(weekSessions);

    const focusDeltaMinutes = week.focusMinutes - lastWeek.focusMinutes;
    const focusDeltaPct = lastWeek.focusMinutes > 0
      ? Math.round((focusDeltaMinutes / lastWeek.focusMinutes) * 100)
      : (week.focusMinutes > 0 ? 100 : 0);

    const stats = this.getStatistics(now);
    return {
      generatedAt: now,
      streak: stats.streak,
      totals: stats.totals,
      last7Days: stats.last7Days,
      daily: { ...day, exits: dayDx.total, returnedToFocus: dayDx.returnedToFocus, minutesOutside: dayDx.minutesOutside },
      week: { ...week, exits: weekDx.total, returnedToFocus: weekDx.returnedToFocus, minutesOutside: weekDx.minutesOutside },
      lastWeek: { focusMinutes: lastWeek.focusMinutes, sessions: lastWeek.sessions },
      trend: { focusDeltaMinutes, focusDeltaPct },
      goals: this.getGoalBreakdown(now),
      distractions: weekDx,
    };
  }

  // ═══════════════════════════════════════════════════════════════
  // O'QISH / SERIALIZE
  // ═══════════════════════════════════════════════════════════════

  getActiveSession() {
    return this.activeSession;
  }

  getStats() {
    return this.state.stats;
  }

  getRemainingTime() {
    if (!this.activeSession || this.activeSession.state !== D.SESSION_STATE.ACTIVE) return 0;
    return Math.max(0, Number(this.activeSession.endsAt) - Date.now());
  }

  /** Sessiyani UI uchun qulay ko'rinishga keltiradi. */
  _publicSession(s, now = Date.now()) {
    if (!s) return null;
    const subtasks = Array.isArray(s.subtasks) ? s.subtasks : [];
    const doneCount = subtasks.filter((x) => x.done).length;
    return {
      id: s.id,
      state: s.state,
      goal: s.goal || '',
      task: s.task || '',
      reason: s.reason || '',
      successCriteria: s.successCriteria || '',
      subtasks,
      subtaskProgress: { done: doneCount, total: subtasks.length },
      durationMinutes: s.durationMinutes || 0,
      startedAt: s.startedAt || null,
      endsAt: s.endsAt || null,
      endedAt: s.endedAt || null,
      remainingMs: s.state === D.SESSION_STATE.PAUSED
        ? (Number(s.remainingMs) || 0)
        : (s.state === D.SESSION_STATE.ACTIVE ? Math.max(0, Number(s.endsAt) - now) : 0),
      focusedMinutes: Math.round(this._sessionMinutes(s, now)),
      scrollingMinutes: Math.round(((s.activity && s.activity.scrollingMs) || 0) / 60000),
      strongFocus: !!s.strongFocus,
      reflection: s.reflection || null,
      distractionCount: Array.isArray(s.distractionEvents) ? s.distractionEvents.length : 0,
      platform: s.platform || 'desktop',
    };
  }

  /** Tarix (yakunlangan sessiyalar), yangi birinchi. */
  getHistory(limit = 50, now = Date.now()) {
    const terminal = (this.state.sessions || [])
      .filter((s) => D.isTerminal(s.state))
      .sort((a, b) => (Number(b.startedAt) || 0) - (Number(a.startedAt) || 0))
      .slice(0, Math.max(0, limit));
    return terminal.map((s) => this._publicSession(s, now));
  }

  serialize(now = Date.now()) {
    const active = this.activeSession && D.isLive(this.activeSession.state)
      ? this._publicSession(this.activeSession, now)
      : null;
    return {
      canUseFocus: this.canUseFocus(),
      activeSession: active,
      history: this.getHistory(50, now),
      statistics: this.getStatistics(now),
      stats: this.getStats(),
      durationPresets: D.DURATION_PRESETS,
      distractionSummary: this.getDistractionSummary(now),
    };
  }

  // ═══════════════════════════════════════════════════════════════
  // STRONG FOCUS bloklash — faqat foydalanuvchi yoqqan sessiyalarda
  // ═══════════════════════════════════════════════════════════════

  /** Faol sessiya strongFocus bo'lsa va URL bloklangan bo'lsa — yozib qo'yadi. */
  recordBlockedAttempt(url) {
    const s = this.activeSession;
    if (!s) return null;
    s.blockedSites.push(url);
    if (this.state.stats?.daily) {
      this.state.stats.daily.blockedAttempts = (this.state.stats.daily.blockedAttempts || 0) + 1;
      this.state.stats.daily.topBlockedSite = url;
    }
    this._saveState();
    return { blocked: true, session: s };
  }

  /** Oddiy Focus bloklamaydi; faqat ACTIVE + strongFocus sessiyada bloklash yoqiladi. */
  isBlockingActive() {
    const s = this.activeSession;
    return !!(s && s.state === D.SESSION_STATE.ACTIVE && s.strongFocus);
  }
}

module.exports = FocusManager;
