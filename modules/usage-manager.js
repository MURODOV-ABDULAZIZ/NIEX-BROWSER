const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

// USAGE MANAGER — KUNLIK per-op counterlar (Chrome/Claude uslubida).
// MUHIM: bu external API provider (OpenAI/Gemini/Groq) quota emas.
//   Provider stats/token/xarajat — faqat Admin Dashboard'da ko'rinadi.
//
// Kunlik counterlar (per-op) — plan bo'yicha alohida cheklangan:
//   videoMinutes | image | deepScan | ocr | pdf
//
// Reset: har kuni mahalliy soat 00:00 (Node.js Date localdate hisoblaydi).
// Local AI (mahalliy AI Brain — sayt/matn/rasm) — CHEKSIZ, hech qanday
// counterga tegmaydi. Cloud AI operatsiyalari counterga qo'shiladi.
const OP_TYPES = ['videoMinutes', 'image', 'deepScan', 'ocr', 'pdf'];

// Bugungi kunning boshlanishi (mahalliy 00:00)
function todayStart(now = Date.now()) {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}
// Ertagi kunning boshlanishi (reset vaqti)
function tomorrowStart(now = Date.now()) {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + 1);
  return d.getTime();
}

class UsageManager {
  constructor(options = {}) {
    this.storagePath = options.storagePath || path.join(process.cwd(), 'usage.json');
    this.subscriptionManager = options.subscriptionManager;
    this.secret = options.secret || 'safenet-usage-v1';
    this.state = this._loadState();
    this._maybeReset(Date.now());
  }

  _loadState() {
    try {
      if (!fs.existsSync(this.storagePath)) return this._freshState(Date.now());
      const parsed = JSON.parse(fs.readFileSync(this.storagePath, 'utf8'));
      if (!parsed?.daily) return this._freshState(Date.now());
      // Yangi format tekshiruv — v4 (per-op counterlar + kunlik reset)
      const dayStart = parsed.daily.dayStart;
      if (!dayStart || typeof dayStart !== 'number') return this._freshState(Date.now());
      return {
        daily: {
          dayStart,
          counters: {
            videoMinutes: Number(parsed.daily.counters?.videoMinutes) || 0,
            image:        Number(parsed.daily.counters?.image) || 0,
            deepScan:     Number(parsed.daily.counters?.deepScan) || 0,
            ocr:          Number(parsed.daily.counters?.ocr) || 0,
            pdf:          Number(parsed.daily.counters?.pdf) || 0,
          },
          seenIds: Array.isArray(parsed.daily.seenIds) ? parsed.daily.seenIds : [],
          signature: parsed.daily.signature || '',
        },
        // Legacy field — eski kod uchun (aiSeconds/breakdown), backward compat
        current: parsed.current || this._blankLegacy(Date.now()),
        version: 4,
      };
    } catch { return this._freshState(Date.now()); }
  }

  _freshState(now) {
    return {
      daily: {
        dayStart: todayStart(now),
        counters: { videoMinutes: 0, image: 0, deepScan: 0, ocr: 0, pdf: 0 },
        seenIds: [],
        signature: '',
      },
      current: this._blankLegacy(now), // legacy
      version: 4,
    };
  }

  _blankLegacy(now) {
    return {
      startAt: now,
      aiSeconds: 0,
      breakdown: { videoLocal: 0, videoCloud: 0, imageCloud: 0, textCloud: 0 },
      seenAnalysisIds: [],
      signature: '',
    };
  }

  _saveState() {
    try { fs.mkdirSync(path.dirname(this.storagePath), { recursive: true }); fs.writeFileSync(this.storagePath, JSON.stringify(this.state, null, 2), 'utf8'); } catch {}
  }

  // Kunlik reset — mahalliy 00:00 (user timezone) da counterlar 0'ga tushadi.
  _maybeDailyReset(now = Date.now()) {
    const daily = this.state.daily;
    const currentDayStart = todayStart(now);
    if (!daily || daily.dayStart !== currentDayStart) {
      this.state.daily = {
        dayStart: currentDayStart,
        counters: { videoMinutes: 0, image: 0, deepScan: 0, ocr: 0, pdf: 0 },
        seenIds: [],
        signature: '',
      };
      this._saveState();
      return true;
    }
    return false;
  }

  // Legacy reset (backward compat — eski aiSeconds tracker uchun)
  _maybeReset(now = Date.now()) {
    this._maybeDailyReset(now);
    const cur = this.state.current;
    const WINDOW = 24 * 60 * 60 * 1000;
    if (!cur || now - cur.startAt >= WINDOW) {
      this.state.current = this._blankLegacy(now);
      this._saveState();
      return true;
    }
    return false;
  }

  _getSignature(payload) {
    return crypto.createHmac('sha256', this.secret).update(JSON.stringify(payload)).digest('hex');
  }

  // ═══════════════════════════════════════════════════════════════════
  // YANGI PER-OP LIMIT API — LimitManager rolini bajaradi
  // ═══════════════════════════════════════════════════════════════════
  //
  // Har cloud AI operatsiya bu yerdan o'tishi kerak:
  //   1. canUse(op) — limit tugaganmi tekshirish
  //   2. Agar allowed:true → API chaqirish
  //   3. success bo'lsa → consume(op, amount)

  getDailyLimits() {
    // Plan bo'yicha kunlik cheklovlar (subscription-manager'dan)
    if (this.subscriptionManager?.getDailyLimits) return this.subscriptionManager.getDailyLimits();
    return { videoMinutes: Infinity, image: Infinity, deepScan: Infinity, ocr: Infinity, pdf: Infinity };
  }

  getDailyUsage(now = Date.now()) {
    this._maybeDailyReset(now);
    const daily = this.state.daily;
    const limits = this.getDailyLimits();
    const result = {
      dayStart: daily.dayStart,
      resetAt: tomorrowStart(now),
      msUntilReset: Math.max(0, tomorrowStart(now) - now),
      counters: { ...daily.counters },
      limits: {},
      remaining: {},
      percent: {},
      exhausted: {},
    };
    for (const op of OP_TYPES) {
      const limit = limits[op] == null ? Infinity : limits[op];
      const used = daily.counters[op] || 0;
      result.limits[op] = limit;
      result.remaining[op] = limit === Infinity ? Infinity : Math.max(0, limit - used);
      result.percent[op] = limit === Infinity ? 0 : Math.min(100, Math.round((used / limit) * 100));
      result.exhausted[op] = limit !== Infinity && used >= limit;
    }
    return result;
  }

  // canUse(op, amount) — operatsiyani bajarishga ruxsat bormi?
  canUse(op, amount = 1, now = Date.now()) {
    if (!OP_TYPES.includes(op)) return { allowed: true, unknown: true };
    this._maybeDailyReset(now);
    const daily = this.state.daily;
    const limit = this.getDailyLimits()[op];
    if (limit == null || limit === Infinity) return { allowed: true, limit: Infinity, used: daily.counters[op] || 0 };
    const used = daily.counters[op] || 0;
    const nextUsed = used + Math.max(0, Number(amount) || 0);
    return {
      allowed: nextUsed <= limit,
      limit,
      used,
      remaining: Math.max(0, limit - used),
      reason: nextUsed > limit ? 'daily-limit-exhausted' : null,
    };
  }

  // consume(op, amount, dedupeKey?) — operatsiya muvaffaqiyatli bajarilganda chaqiring
  consume(op, amount = 1, dedupeKey = null, now = Date.now()) {
    if (!OP_TYPES.includes(op)) return { ok: false, reason: 'unknown-op' };
    this._maybeDailyReset(now);
    const daily = this.state.daily;
    if (dedupeKey && daily.seenIds.includes(dedupeKey)) return { ok: true, duplicate: true };
    const check = this.canUse(op, amount, now);
    if (!check.allowed) return { ok: false, reason: check.reason, limit: check.limit, used: check.used };
    daily.counters[op] = (daily.counters[op] || 0) + Math.max(0, Number(amount) || 0);
    if (dedupeKey) {
      daily.seenIds.push(dedupeKey);
      if (daily.seenIds.length > 1000) daily.seenIds = daily.seenIds.slice(-1000);
    }
    daily.signature = this._getSignature({ dayStart: daily.dayStart, counters: daily.counters });
    this._saveState();
    return { ok: true, used: daily.counters[op], limit: check.limit, remaining: Math.max(0, (check.limit === Infinity ? Infinity : check.limit - daily.counters[op])) };
  }

  // Shortcut helperlari — har turi uchun alohida
  consumeVideo(minutes, dedupeKey)     { return this.consume('videoMinutes', minutes, dedupeKey); }
  consumeImage(dedupeKey)              { return this.consume('image', 1, dedupeKey); }
  consumeOcr(dedupeKey)                { return this.consume('ocr', 1, dedupeKey); }
  consumePdf(dedupeKey)                { return this.consume('pdf', 1, dedupeKey); }
  consumeDeepScan(dedupeKey)           { return this.consume('deepScan', 1, dedupeKey); }
  canUseVideo(minutes = 0)             { return this.canUse('videoMinutes', minutes); }
  canUseImage()                        { return this.canUse('image', 1); }
  canUseOcr()                          { return this.canUse('ocr', 1); }
  canUsePdf()                          { return this.canUse('pdf', 1); }
  canUseDeepScan()                     { return this.canUse('deepScan', 1); }

  // ═══════════════════════════════════════════════════════════════════
  // LEGACY API (backward compat — eski aiSeconds tracker)
  // ═══════════════════════════════════════════════════════════════════
  _limits() {
    const lim = this.subscriptionManager?.getUsageLimits?.() || { videoMinutes: Infinity };
    return { aiSeconds: lim.videoMinutes === Infinity ? Infinity : lim.videoMinutes * 60 };
  }

  getUsage(now = Date.now()) {
    this._maybeReset(now);
    const cur = this.state.current;
    const limits = this._limits();
    return {
      startAt: cur.startAt,
      resetAt: cur.startAt + (24 * 60 * 60 * 1000),
      msRemaining: Math.max(0, (cur.startAt + (24 * 60 * 60 * 1000)) - now),
      aiSeconds: cur.aiSeconds,
      aiLimitSeconds: limits.aiSeconds,
      breakdown: { ...cur.breakdown },
      signature: cur.signature,
    };
  }

  canPerformAnalysis(type, amount = 1, now = Date.now()) {
    this._maybeReset(now);
    const cur = this.state.current;
    const limit = this._limits().aiSeconds;
    if (limit === Infinity) return { allowed: true, reason: null, limit, currentUsage: cur.aiSeconds };
    const OP_COST = { 'video-local': null, 'video': null, 'image': 3, 'text': 2, 'url': 2 };
    let cost = OP_COST[type];
    if (cost == null) cost = Math.max(0, Number(amount) || 0);
    const next = cur.aiSeconds + cost;
    const allowed = next <= limit;
    return { allowed, reason: allowed ? null : 'ai-limit-reached', limit, currentUsage: cur.aiSeconds, cost };
  }

  getNotificationState(now = Date.now()) {
    // Yangi per-op counterlar bilan — birortasi tugagan bo'lsa notifikatsiya
    this._maybeDailyReset(now);
    const daily = this.getDailyUsage(now);
    for (const op of OP_TYPES) {
      if (daily.exhausted[op]) return { level: 'limit-reached', message: `Bugungi ${op} limitingiz tugadi. Ertaga yangilanadi.` };
      if (daily.percent[op] >= 95) return { level: 'warning-95', message: `${op} limitingizning 95% ishlatildi.` };
      if (daily.percent[op] >= 80) return { level: 'warning-80', message: `${op} limitingizning 80% ishlatildi.` };
    }
    return null;
  }

  recordUsage(options = {}) {
    const now = Date.now();
    const { analysisId, type, success = true, amount = 1, metadata = {} } = options;
    if (!success) return { ok: true, recorded: false, reason: 'analysis-not-successful' };

    this._maybeReset(now);
    const cur = this.state.current;
    const dedupeKey = analysisId || `${type}:${metadata.source || 'unknown'}:${now}:${cur.seenAnalysisIds.length}`;
    if (cur.seenAnalysisIds.includes(dedupeKey)) return { ok: true, recorded: false, duplicate: true };

    const OP_COST = { 'video-local': null, 'video': null, 'image': 3, 'text': 2, 'url': 2 };
    let cost = OP_COST[type];
    if (cost == null) cost = Math.max(0, Number(amount) || 0);
    const canPerform = this.canPerformAnalysis(type, amount, now);
    if (!canPerform.allowed) return { ok: false, recorded: false, reason: canPerform.reason, limit: canPerform.limit };

    cur.aiSeconds += cost;
    if (type === 'video-local') cur.breakdown.videoLocal += cost;
    else if (type === 'video') cur.breakdown.videoCloud += cost;
    else if (type === 'image') cur.breakdown.imageCloud += cost;
    else if (type === 'text' || type === 'url') cur.breakdown.textCloud += cost;

    cur.seenAnalysisIds.push(dedupeKey);
    if (cur.seenAnalysisIds.length > 500) cur.seenAnalysisIds = cur.seenAnalysisIds.slice(-500);
    cur.signature = this._getSignature({ startAt: cur.startAt, aiSeconds: cur.aiSeconds, breakdown: cur.breakdown });
    this._saveState();

    // Yangi per-op tracker'ga ham qo'shamiz (mapping)
    if (type === 'video' || type === 'video-local') {
      // Cloud video minute'ga aylantiramiz (cost sekundlarda)
      if (type === 'video') this.consume('videoMinutes', Math.ceil(cost / 60), analysisId);
    } else if (type === 'image') this.consume('image', 1, analysisId);

    return { ok: true, recorded: true, cost, usage: this.getUsage(now) };
  }

  serialize() {
    return {
      state: this.state,
      usage: this.getUsage(Date.now()),
      daily: this.getDailyUsage(Date.now()), // yangi per-op counterlar
    };
  }
}

module.exports = UsageManager;
