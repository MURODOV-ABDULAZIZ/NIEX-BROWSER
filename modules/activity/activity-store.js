/**
 * NIEX — Activity Intelligence: Local Store + Aggregation (desktop adapter).
 * =========================================================================
 *
 * Spec §4/§10/§11/§15/§16/§19/§20 — local-first:
 *   segment → local aggregation (kunlik) → dirty-day → batch sync → backend.
 *
 * TAMOYILLAR:
 *   - Raw browsing history SAQLANMAYDI (§16). Faqat aggregate (kun × platforma ×
 *     activity × kategoriya × qiymat) saqlanadi. Domenlar aggregate, URL yo'q.
 *   - Kun chegarasi MAHALLIY (§15/§27 timezone-aware).
 *   - Debounced disk yozish (§19 performance).
 *   - Retention: eski kunlar tozalanadi (§24).
 *   - Idempotent sync: dirty-day flag + upsert (§20/§18).
 *
 * Node/Electron main process'da ishlaydi (fs). Sof aggregation mantig'i mobil
 * bilan bir xil model (activity-model.js) ustida quriladi.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const M = require('./activity-model');

const A = M.ACTIVITY_TYPE;
const V = M.VALUE_LEVEL;

const SEGMENT_MAX_MS = 5 * 60 * 1000;   // bitta segment ≤ 5 daqiqa (runaway himoya)
const RETENTION_DAYS = 120;             // kunlik yozuvlar shu muddat saqlanadi
const SAVE_DEBOUNCE_MS = 8000;          // disk yozish debounce

function emptyDay(dateKey) {
  return {
    date: dateKey,
    totalMs: 0,
    focusMs: 0,
    distractionCount: 0,
    blockedCount: 0,
    byType: {},
    byPlatform: {},
    byCategory: {},
    byValue: { [V.HIGH]: 0, [V.MEDIUM]: 0, [V.LOW]: 0, [V.UNKNOWN]: 0 },
    dirty: true,
    updatedAt: Date.now(),
  };
}

function addTo(map, key, ms) {
  if (!key) return;
  map[key] = (map[key] || 0) + ms;
}

class ActivityStore {
  constructor(options = {}) {
    this.storagePath = options.storagePath || path.join(process.cwd(), 'activity.json');
    this.now = options.now || Date.now;
    this._saveTimer = null;
    this.state = this._load();
    this._prune();
  }

  _load() {
    try {
      if (!fs.existsSync(this.storagePath)) return { version: 1, days: {}, lastSyncedAt: 0 };
      const parsed = JSON.parse(fs.readFileSync(this.storagePath, 'utf8'));
      if (!parsed || typeof parsed !== 'object' || !parsed.days) return { version: 1, days: {}, lastSyncedAt: 0 };
      return { version: 1, days: parsed.days, lastSyncedAt: parsed.lastSyncedAt || 0 };
    } catch {
      return { version: 1, days: {}, lastSyncedAt: 0 };
    }
  }

  _saveNow() {
    if (this._saveTimer) { clearTimeout(this._saveTimer); this._saveTimer = null; }
    try {
      fs.mkdirSync(path.dirname(this.storagePath), { recursive: true });
      fs.writeFileSync(this.storagePath, JSON.stringify(this.state), 'utf8');
    } catch { /* in-memory saqlanadi */ }
  }

  _save() {
    if (this._saveTimer) return;
    this._saveTimer = setTimeout(() => { this._saveTimer = null; this._saveNow(); }, SAVE_DEBOUNCE_MS);
    if (this._saveTimer && this._saveTimer.unref) this._saveTimer.unref();
  }

  /** Ilova yopilishidan oldin — kutayotgan yozuvni majburiy saqlash. */
  flush() { this._saveNow(); }

  _prune() {
    const cutoff = M.localDateKey(this.now() - RETENTION_DAYS * 86400000);
    let changed = false;
    for (const k of Object.keys(this.state.days)) {
      if (k < cutoff) { delete this.state.days[k]; changed = true; }
    }
    if (changed) this._save();
  }

  _day(ts) {
    const key = M.localDateKey(ts);
    if (!this.state.days[key]) this.state.days[key] = emptyDay(key);
    return this.state.days[key];
  }

  _markDirty(day) { day.dirty = true; day.updatedAt = this.now(); }

  /**
   * Bitta aggregatlangan activity segmenti (§4/§5).
   * @param {object} seg { ts?, activityType, platform, domain, category, value, durationMs, isFocus? }
   */
  addSegment(seg = {}) {
    let ms = Math.max(0, Number(seg.durationMs) || 0);
    if (ms <= 0) return { ok: false, reason: 'zero-duration' };
    if (ms > SEGMENT_MAX_MS) ms = SEGMENT_MAX_MS;

    const type = seg.activityType || A.UNKNOWN;
    // IDLE — brauzerda bo'sh turish: umumiy vaqtga QO'SHILMAYDI (§3: page time emas).
    if (type === A.IDLE) return { ok: false, reason: 'idle-skip' };

    const day = this._day(seg.ts || this.now());
    day.totalMs += ms;
    addTo(day.byType, type, ms);
    addTo(day.byPlatform, seg.platform || (seg.domain ? M.platformFromDomain(seg.domain) : 'other'), ms);
    addTo(day.byCategory, seg.category || M.CONTENT_CATEGORY.OTHER, ms);
    addTo(day.byValue, seg.value || V.UNKNOWN, ms);
    if (seg.isFocus) day.focusMs += ms;
    this._markDirty(day);
    this._save();
    return { ok: true, addedMs: ms };
  }

  /** Focus intervention/distraction hodisasi (§10/§13). */
  recordDistraction(ts = this.now()) {
    const day = this._day(ts);
    day.distractionCount += 1;
    this._markDirty(day);
    this._save();
  }

  /** Bloklangan kontent urinishi (§20). */
  recordBlocked(ts = this.now()) {
    const day = this._day(ts);
    day.blockedCount += 1;
    this._markDirty(day);
    this._save();
  }

  // ── O'QISH / AGGREGATION ──────────────────────────────────────────

  _computeValueSplit(byValue, totalMs) {
    const high = byValue[V.HIGH] || 0;
    const medium = byValue[V.MEDIUM] || 0;
    const low = byValue[V.LOW] || 0;
    const unknown = byValue[V.UNKNOWN] || 0;
    const denom = totalMs || 1;
    return {
      highMs: high, mediumMs: medium, lowMs: low, unknownMs: unknown,
      // "Useful" = high + medium (§8/§9). Low = distraction. Unknown neytral.
      usefulMs: high + medium,
      lowValueMs: low,
      pct: {
        useful: Math.round(((high + medium) / denom) * 100),
        low: Math.round((low / denom) * 100),
        unknown: Math.round((unknown / denom) * 100),
      },
    };
  }

  getDay(dateKey) {
    const d = this.state.days[dateKey] || emptyDay(dateKey);
    return {
      date: dateKey,
      totalMs: d.totalMs,
      focusMs: d.focusMs,
      distractionCount: d.distractionCount,
      blockedCount: d.blockedCount,
      byType: { ...d.byType },
      byPlatform: { ...d.byPlatform },
      byCategory: { ...d.byCategory },
      byValue: { ...d.byValue },
      value: this._computeValueSplit(d.byValue, d.totalMs),
      hasData: d.totalMs > 0,
    };
  }

  getToday() { return this.getDay(M.localDateKey(this.now())); }

  /** Top-N (platform yoki kategoriya) — {key, ms} kamayish tartibida. */
  _topN(map, n = 5) {
    return Object.keys(map)
      .map(k => ({ key: k, ms: map[k] }))
      .sort((a, b) => b.ms - a.ms)
      .slice(0, n);
  }

  /** Haftalik aggregate (weekStart = Dushanba kaliti). */
  getWeek(weekStartKey) {
    const start = weekStartKey || M.localWeekStartKey(this.now());
    const startMs = new Date(start + 'T00:00:00').getTime();
    const agg = emptyDay(start);
    const perDay = [];
    let daysWithData = 0;
    for (let i = 0; i < 7; i++) {
      const key = M.localDateKey(startMs + i * 86400000);
      const d = this.state.days[key];
      const day = this.getDay(key);
      perDay.push({ date: key, totalMs: day.totalMs, focusMs: day.focusMs, usefulMs: day.value.usefulMs });
      if (!d) continue;
      if (d.totalMs > 0) daysWithData++;
      agg.totalMs += d.totalMs; agg.focusMs += d.focusMs;
      agg.distractionCount += d.distractionCount; agg.blockedCount += d.blockedCount;
      for (const m of ['byType', 'byPlatform', 'byCategory', 'byValue']) {
        for (const k of Object.keys(d[m] || {})) addTo(agg[m], k, d[m][k]);
      }
    }
    return {
      weekStart: start,
      totalMs: agg.totalMs,
      focusMs: agg.focusMs,
      distractionCount: agg.distractionCount,
      blockedCount: agg.blockedCount,
      dailyAverageMs: Math.round(agg.totalMs / 7),
      daysWithData,
      byType: agg.byType,
      byPlatform: agg.byPlatform,
      byCategory: agg.byCategory,
      byValue: agg.byValue,
      value: this._computeValueSplit(agg.byValue, agg.totalMs),
      topPlatforms: this._topN(agg.byPlatform),
      topCategories: this._topN(agg.byCategory),
      perDay,
      hasData: agg.totalMs > 0,
    };
  }

  /** Joriy hafta vs oldingi hafta trend (§17/§25). Oldingi yo'q → hasPrevious:false. */
  getWeekTrend() {
    const thisStart = M.localWeekStartKey(this.now());
    const prevStartMs = new Date(thisStart + 'T00:00:00').getTime() - 7 * 86400000;
    const prevStart = M.localDateKey(prevStartMs);
    const cur = this.getWeek(thisStart);
    const prev = this.getWeek(prevStart);
    if (!prev.hasData) {
      return { current: cur, previous: null, hasPrevious: false };
    }
    const pctChange = (a, b) => (b > 0 ? Math.round(((a - b) / b) * 100) : null);
    return {
      current: cur,
      previous: prev,
      hasPrevious: true,
      trend: {
        totalMs: pctChange(cur.totalMs, prev.totalMs),
        focusMs: pctChange(cur.focusMs, prev.focusMs),
        usefulMs: pctChange(cur.value.usefulMs, prev.value.usefulMs),
        lowValueMs: pctChange(cur.value.lowValueMs, prev.value.lowValueMs),
        scrollingMs: pctChange(cur.byType[A.SCROLLING] || 0, prev.byType[A.SCROLLING] || 0),
      },
    };
  }

  // ── SYNC (§18/§20) ────────────────────────────────────────────────

  /** Backendga yuborilishi kerak bo'lgan (o'zgargan) kunlar. */
  getDirtyDays() {
    return Object.keys(this.state.days)
      .filter(k => this.state.days[k].dirty)
      .map(k => this.getDay(k));
  }

  /** Sync muvaffaqiyatli — dirty flag tozalanadi (idempotent). */
  markSynced(dateKeys = []) {
    let changed = false;
    for (const k of dateKeys) {
      if (this.state.days[k]) { this.state.days[k].dirty = false; changed = true; }
    }
    if (changed) { this.state.lastSyncedAt = this.now(); this._saveNow(); }
  }

  serialize() {
    return { today: this.getToday(), week: this.getWeekTrend(), lastSyncedAt: this.state.lastSyncedAt };
  }
}

module.exports = ActivityStore;
