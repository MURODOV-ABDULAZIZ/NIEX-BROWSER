const fs = require('fs');
const path = require('path');

/**
 * Focus sessiyasi hisobga olinishi uchun kerak bo'lgan eng kam vaqt.
 * Undan qisqasi "kun faol" deb sanalmaydi va seriyaga kirmaydi — aks holda
 * tugmani bosib darhol yopish ham natija bo'lib ko'rinardi.
 */
const MIN_MEANINGFUL_MINUTES = 1;

/** Heartbeat oralig'i — haqiqiy focus vaqti shu qadamda diskka yoziladi. */
const HEARTBEAT_MS = 15000;

class FocusManager {
  constructor(options = {}) {
    this.storagePath = options.storagePath || path.join(process.cwd(), 'focus-sessions.json');
    this.subscriptionManager = options.subscriptionManager;
    this.blockEngine = options.blockEngine;
    this.scheduler = options.scheduler;
    this.state = this._loadState();
    this.activeSession = null;
    this._heartbeat = null;
    this._normalizeStaleSessions();
  }

  /**
   * Ilova qayta ochilganda 'active'/'paused' holatda qolgan sessiyalarni
   * 'interrupted' deb belgilaydi.
   *
   * Sabab: ilova yopilganda sessiya holati diskda 'active' bo'lib qoladi.
   * Uni to'liq bajarilgan deb sanash — foydalanuvchi qilmagan ishni yozish
   * demak. Haqiqiy o'tirilgan vaqt `focusedMs` da (heartbeat orqali) saqlangan,
   * shuni saqlab qolamiz, qolganini tashlaymiz.
   */
  _normalizeStaleSessions() {
    let changed = false;
    for (const s of this.state.sessions || []) {
      if (s.status === 'active' || s.status === 'paused') {
        s.status = 'interrupted';
        if (typeof s.focusedMs !== 'number') s.focusedMs = 0;
        delete s.lastTickAt;
        changed = true;
      }
    }
    if (changed) this._saveState();
  }

  /** Faol sessiyaga oxirgi tick'dan beri o'tgan vaqtni qo'shadi. */
  _accrue(now = Date.now()) {
    const s = this.activeSession;
    if (!s || s.status !== 'active') return;
    const last = Number(s.lastTickAt) || Number(s.startedAt) || now;
    s.focusedMs = (Number(s.focusedMs) || 0) + Math.max(0, now - last);
    s.lastTickAt = now;
    // Rejalashtirilgan vaqtdan oshib ketmasin
    const capMs = (Number(s.durationMinutes) || 0) * 60000;
    if (capMs > 0 && s.focusedMs > capMs) s.focusedMs = capMs;
  }

  _startHeartbeat() {
    this._stopHeartbeat();
    this._heartbeat = setInterval(() => {
      const now = Date.now();
      const s = this.activeSession;
      if (!s) { this._stopHeartbeat(); return; }
      this._accrue(now);
      // Rejalashtirilgan vaqt tugagan bo'lsa — tabiiy yakunlaymiz
      if (s.status === 'active' && Number(s.endsAt) && now >= Number(s.endsAt)) {
        s.status = 'completed';
        s.endedAt = Number(s.endsAt);
        delete s.lastTickAt;
        this.activeSession = null;
        this._stopHeartbeat();
      }
      this._saveState();
    }, HEARTBEAT_MS);
    if (this._heartbeat.unref) this._heartbeat.unref();
  }

  _stopHeartbeat() {
    if (this._heartbeat) { clearInterval(this._heartbeat); this._heartbeat = null; }
  }

  _loadState() {
    try {
      if (!fs.existsSync(this.storagePath)) {
        return {
          sessions: [],
          stats: {
            daily: { focusedMinutes: 0, blockedAttempts: 0, topBlockedSite: null },
            weekly: { totalFocusHours: 0, averageSessionMinutes: 0, longestSessionMinutes: 0 },
          },
        };
      }
      return JSON.parse(fs.readFileSync(this.storagePath, 'utf8'));
    } catch (error) {
      return { sessions: [], stats: { daily: { focusedMinutes: 0, blockedAttempts: 0, topBlockedSite: null }, weekly: { totalFocusHours: 0, averageSessionMinutes: 0, longestSessionMinutes: 0 } } };
    }
  }

  _saveState() {
    try {
      fs.mkdirSync(path.dirname(this.storagePath), { recursive: true });
      fs.writeFileSync(this.storagePath, JSON.stringify(this.state, null, 2), 'utf8');
    } catch (error) {
      // allow in-memory state to persist
    }
  }

  canUseFocus() {
    return !!this.subscriptionManager?.isFeatureEnabled?.('focusMode');
  }

  startSession(options = {}) {
    if (!this.canUseFocus()) {
      return { ok: false, error: 'Focus Mode requires a Pro plan' };
    }

    const normalized = this.scheduler.normalize(options);
    const now = Date.now();
    const durationMs = (Number(normalized.durationMinutes) || 45) * 60 * 1000;
    const session = {
      id: `focus_${Date.now().toString(36)}`,
      startedAt: now,
      endsAt: now + durationMs,
      durationMinutes: Number(normalized.durationMinutes) || 45,
      status: 'active',
      mode: normalized.startMode,
      repeat: normalized.repeat,
      blockedSites: [],
      focusedMs: 0,     // haqiqatda focus'da o'tkazilgan vaqt (heartbeat to'ldiradi)
      lastTickAt: now,
    };

    this.activeSession = session;
    this.state.sessions.push(session);
    this._saveState();
    this._startHeartbeat();
    return { ok: true, session };
  }

  pauseSession() {
    if (!this.activeSession) return { ok: false, error: 'No active focus session' };
    const now = Date.now();
    this._accrue(now);                       // pauzagacha o'tgan vaqtni yozamiz
    this.activeSession.status = 'paused';
    // Qolgan vaqtni saqlaymiz — davom ettirganda shu tiklanadi
    this.activeSession.remainingMs = Math.max(0, Number(this.activeSession.endsAt) - now);
    delete this.activeSession.lastTickAt;
    this._stopHeartbeat();
    this._saveState();
    return { ok: true, session: this.activeSession };
  }

  resumeSession() {
    if (!this.activeSession) return { ok: false, error: 'No paused focus session' };
    const now = Date.now();
    // ESKI XATO: endsAt = now + (endsAt - startedAt) — bu to'liq davomiylikni
    // qaytadan boshlab yuborardi. Endi pauzada saqlangan QOLGAN vaqt tiklanadi.
    const remaining = Number(this.activeSession.remainingMs);
    this.activeSession.endsAt = now + (Number.isFinite(remaining) && remaining >= 0
      ? remaining
      : Math.max(0, Number(this.activeSession.endsAt) - now));
    delete this.activeSession.remainingMs;
    this.activeSession.status = 'active';
    this.activeSession.lastTickAt = now;
    this._startHeartbeat();
    this._saveState();
    return { ok: true, session: this.activeSession };
  }

  stopSession() {
    if (!this.activeSession) return { ok: false, error: 'No active focus session' };
    const now = Date.now();
    this._accrue(now);                       // to'xtatishgacha o'tgan vaqt
    this.activeSession.status = 'stopped';
    this.activeSession.endedAt = now;
    delete this.activeSession.lastTickAt;
    delete this.activeSession.remainingMs;
    this._stopHeartbeat();
    this._saveState();
    const session = this.activeSession;
    this.activeSession = null;
    return { ok: true, session };
  }

  // ═══════════════════════════════════════════════════════════════
  // STATISTIKA — sessiyalar ro'yxatidan hisoblanadi.
  //
  // Alohida hisoblagich saqlanmaydi (u drift qiladi va sessiya tugashi
  // qayd qilinmasa yo'qoladi). Har chaqiruvda `state.sessions` dan qayta
  // hisoblanadi — shu sabab har doim haqiqatga mos.
  // ═══════════════════════════════════════════════════════════════

  /** Mahalliy vaqt bo'yicha kun kaliti: "2026-07-28". */
  _dayKey(ts) {
    const d = new Date(ts);
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${d.getFullYear()}-${m}-${day}`;
  }

  /** Oy kaliti: "2026-07". */
  _monthKey(ts) {
    const d = new Date(ts);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  }

  /**
   * Sessiyada HAQIQATDA o'tkazilgan daqiqalar.
   *
   * Ustuvorlik tartibi:
   *  1. `focusedMs` — heartbeat o'lchagan haqiqiy vaqt (eng ishonchli).
   *     Sessiya hozir faol bo'lsa, oxirgi tick'dan beri o'tgani qo'shiladi.
   *  2. Eski yozuv, qo'lda to'xtatilgan (`endedAt` bor) → haqiqiy oraliq.
   *  3. Eski yozuv, tasdiqlanmagan (ilova yopilgan, `endedAt` yo'q) → 0.
   *
   * 3-holat ataylab 0: rejalashtirilgan davomiylikni "bajarilgan" deb sanash
   * foydalanuvchi qilmagan ishni yozish bo'lardi. Hisobot faqat isbotlangan
   * vaqtni ko'rsatadi.
   */
  _sessionMinutes(s, now = Date.now()) {
    const started = Number(s.startedAt) || 0;
    if (!started) return 0;
    const planned = Number(s.durationMinutes) || 0;
    const cap = (v) => (planned > 0 ? Math.min(v, planned) : v);

    // 1. Heartbeat bilan o'lchangan haqiqiy vaqt
    if (typeof s.focusedMs === 'number') {
      let ms = Math.max(0, s.focusedMs);
      if (s.status === 'active' && s.lastTickAt) {
        ms += Math.max(0, now - Number(s.lastTickAt));
      }
      return Math.max(0, cap(ms / 60000));
    }

    // 2. Eski yozuv — qo'lda to'xtatilgan, haqiqiy oraliq ma'lum
    if (s.endedAt) {
      return Math.max(0, cap((Number(s.endedAt) - started) / 60000));
    }

    // 3. Eski yozuv — tasdiqlanmagan. Taxmin qilmaymiz.
    return 0;
  }

  /** Sessiya hisobga olinadigan darajada uzunmi? */
  _isMeaningful(s, now = Date.now()) {
    return this._sessionMinutes(s, now) >= MIN_MEANINGFUL_MINUTES;
  }

  /**
   * Kun bo'yicha guruhlash.
   *
   * `sessions` — faqat hisobga olinadigan (≥1 daq) sessiyalar. Tugmani bosib
   * darhol yopilgan urinishlar `startedCount` da qoladi, lekin natija sifatida
   * ko'rsatilmaydi.
   */
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
    // `minutes` — ko'rsatish uchun yaxlitlangan; `rawMinutes` — mantiq uchun aniq
    for (const k of Object.keys(days)) days[k].minutes = Math.round(days[k].rawMinutes);
    return days;
  }

  /**
   * Kun seriyaga kiradimi.
   *
   * Tekshiruv yaxlitlanmagan qiymatda bajariladi — aks holda bir necha
   * 10-soniyalik urinish yig'ilib 1 daqiqaga yaxlitlanardi va kun "faol"
   * bo'lib ko'rinardi. Bundan tashqari kamida bitta mazmunli sessiya shart.
   */
  _dayCounts(days, key) {
    const d = days[key];
    if (!d) return false;
    return d.sessions > 0 && d.rawMinutes >= MIN_MEANINGFUL_MINUTES;
  }

  /**
   * Ketma-ket kunlar seriyasi (streak).
   *
   * Qoida: bir kun butunlay o'tkazib yuborilsa seriya uziladi va 0 dan
   * qayta boshlanadi. Bugun hali sessiya bo'lmasa seriya kechagidan
   * sanaladi (kun tugamagani uchun jazolamaymiz) — kecha ham bo'sh bo'lsa 0.
   */
  _computeStreak(days, now = Date.now()) {
    const has = (d) => this._dayCounts(days, this._dayKey(d.getTime()));
    const DAY = 86400000;

    // Boshlanish nuqtasi: bugun, agar bugun bo'sh bo'lsa — kecha
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

  /** Tarixdagi eng uzun ketma-ket seriya (faqat mazmunli kunlar). */
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

  /** Oxirgi N kun (bugundan orqaga), grafik uchun tartiblangan. */
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
        weekday: d.getDay(),          // 0 = Yakshanba
        dayOfMonth: d.getDate(),
        minutes: rec.minutes,
        sessions: rec.sessions,
        blocked: rec.blocked,
      });
    }
    return out;
  }

  /** Oy bo'yicha to'plam. */
  _groupByMonth(now = Date.now()) {
    const months = {};
    for (const s of this.state.sessions || []) {
      const started = Number(s.startedAt) || 0;
      if (!started) continue;
      const key = this._monthKey(started);
      if (!months[key]) months[key] = { month: key, minutes: 0, sessions: 0, blocked: 0, dayKeys: new Set() };
      months[key].minutes += this._sessionMinutes(s, now);
      months[key].blocked += Array.isArray(s.blockedSites) ? s.blockedSites.length : 0;
      // Faqat mazmunli sessiya/kunlar hisobga olinadi
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
      .sort((a, b) => (a.month < b.month ? 1 : -1)); // yangi oy birinchi
  }

  /** To'liq statistika hisoboti (UI shu obyektni chizadi). */
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
        sessions: meaningful.length,            // hisobga olingan sessiyalar
        startedCount: sessions.length,          // umuman boshlanganlar
        blocked: totalBlocked,
        activeDays,
        longestSessionMinutes: Math.round(longestSession),
        avgSessionMinutes: meaningful.length ? Math.round(totalMinutes / meaningful.length) : 0,
      },
    };
  }

  getActiveSession() {
    return this.activeSession;
  }

  getStats() {
    return this.state.stats;
  }

  recordBlockedAttempt(url) {
    const session = this.activeSession;
    if (!session) return null;
    session.blockedSites.push(url);
    this.state.stats.daily.blockedAttempts += 1;
    this.state.stats.daily.topBlockedSite = url;
    this._saveState();
    return { blocked: true, session };
  }

  getRemainingTime() {
    if (!this.activeSession || this.activeSession.status !== 'active') return 0;
    return Math.max(0, this.activeSession.endsAt - Date.now());
  }

  serialize() {
    return {
      activeSession: this.activeSession,
      stats: this.getStats(),
      canUseFocus: this.canUseFocus(),
      // To'liq statistika — `focus-get` orqali UI'ga yetkaziladi. Sessiyalar
      // ro'yxati kichik (bir sessiya = bir yozuv), hisoblash O(n) va arzon.
      statistics: this.getStatistics(),
    };
  }
}

module.exports = FocusManager;
