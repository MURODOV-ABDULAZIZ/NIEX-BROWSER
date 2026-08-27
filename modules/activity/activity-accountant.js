/**
 * NIEX — Activity Intelligence: Wall-clock Accountant (desktop glue, testable).
 * ===========================================================================
 *
 * Detector hisobotlari (har ~1-12s) oralig'idagi HAQIQIY vaqtni tegishli
 * activity bucket'iga yozadi. Spec §4: local aggregation. Sof mantiq — store,
 * classify, now inject qilinadi (test uchun). main.js buni webContents hodisasiga
 * ulaydi (faqat active + ko'rinadigan tab).
 *
 * MANTIQ: har hisobotda oldingi segmentning davomiyligini yozamiz (o'sha oraliqda
 * aynan o'sha activity davom etgan), so'ng joriy segmentni yangilaymiz. Hisobot
 * kelmasa (tab yashirin/uxlash) — maxGap bilan cheklaymiz (ortiqcha sanamaslik).
 */
'use strict';

const M = require('./activity-model');
const ContentClassifier = require('./content-classifier');

function createAccountant(opts = {}) {
  const store = opts.store;
  const now = opts.now || Date.now;
  const maxGap = opts.maxGapMs || 30000;
  const classify = opts.classify || ContentClassifier.classify;
  let seg = null;
  const cache = new Map();

  function classifyReport(wcId, data, goal) {
    const url = data.url || '';
    const type = M.canonicalActivity(data.activityType);
    const key = wcId + '|' + url + '|' + type + '|' + (data.context || '');
    let c = cache.get(key);
    if (!c) {
      const res = classify({
        activityType: type, platform: data.platform, context: data.context,
        feedMode: data.feedMode, title: data.title || '', url, goal: goal || '',
      });
      c = { type, category: res.category, value: res.value };
      cache.set(key, c);
      if (cache.size > 500) cache.delete(cache.keys().next().value);
    }
    return c;
  }

  function write(s, endTs) {
    if (!store || !s) return;
    const elapsed = Math.min(endTs - s.lastReportAt, maxGap);
    if (elapsed > 0) store.addSegment({
      ts: s.lastReportAt, activityType: s.activityType, platform: s.platform,
      domain: s.domain, category: s.category, value: s.value,
      durationMs: elapsed, isFocus: s.isFocus,
    });
  }

  /** Kutayotgan segmentni yozib yopadi (tab yopilishi/quit/o'qishdan oldin). */
  function flush() { if (seg) { write(seg, now()); seg = null; } }

  /**
   * Bitta detector hisoboti. `ctx = { goal, isFocus }` main tomonidan beriladi.
   */
  function report(wcId, data, ctx = {}) {
    if (!store || !data) return;
    const t = now();
    const url = data.url || '';
    const platform = data.platform || M.platformFromDomain(url) || 'other';
    const domain = M.normalizeDomain(url) || (platform + '.com');
    const cls = classifyReport(wcId, data, ctx.goal);
    if (seg && seg.wcId === wcId) write(seg, t);   // oraliqni oldingi activity'ga yozamiz
    else if (seg) flush();                          // tab almashdi — eskisini yopamiz
    seg = { wcId, platform, domain, activityType: cls.type, category: cls.category, value: cls.value, isFocus: !!ctx.isFocus, lastReportAt: t };
  }

  return { report, flush, current: () => seg };
}

module.exports = { createAccountant };
