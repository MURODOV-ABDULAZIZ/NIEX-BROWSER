'use strict';

const D = require('./focus-domain');

/**
 * NIEX Focus — Qaror Orkestratori (AI Distraction Decision, spec PART 2 / PART 7).
 *
 * FALSAFA:
 *   Bu tizim foydalanuvchini BOSHQARMAYDI. U faqat yordam beradi:
 *   "Focus paytida chiqish men tanlagan maqsaddan muhimmi?" — degan savolni
 *   ravshanroq qiladi. Yakuniy qaror — foydalanuvchida.
 *
 * ARXITEKTURA (spec PART 7 §37, PART 2 §19):
 *   1. Deterministik qoidalar — holatlarning ko'pini shu hal qiladi (arzon,
 *      offlayn, ishonchli). Bu "soxta AI" EMAS — bu haqiqiy mantiq.
 *   2. remoteReason() — server LLM hook'i (masalan 'focus-decision' edge fn).
 *      Hozircha ulanmagan → `null` qaytaradi va deterministik yo'l ishlaydi.
 *      Ulanganda: faqat NOANIQ holatlarda chaqiriladi (xarajat tejash),
 *      chiqishi QAT'IY sxema bilan tekshiriladi, timeout bor, xato → fallback.
 *
 * XAVFSIZLIK (spec PART 2 §24): AI/qoidalar faqat TAVSIYA qaytaradi. Ular
 *   ilova sozlamalari yoki ruxsatlarni o'zgartira olmaydi. Chiqish sxemasi
 *   qat'iy; noto'g'ri format rad etiladi.
 */

// suggested_action — UI qaysi tugmani birlamchi ko'rsatishini biladi.
const SUGGESTED_ACTION = Object.freeze(['continue_focus', 'leave', 'schedule']);

const STOPWORDS = new Set([
  'va', 'bilan', 'uchun', 'ham', 'bir', 'shu', 'bu', 'uni', 'ular', 'men', 'man', 'sen', 'siz',
  'the', 'and', 'for', 'with', 'a', 'an', 'to', 'of', 'in', 'on', 'my', 'me', 'is', 'it',
  'kerak', 'qilish', 'uchun', 'yoki',
]);

/** Matnni tokenlarga ajratadi (kichik harf, stopword'siz, uzunligi >= 3). */
function tokenize(text) {
  return String(text || '')
    .toLowerCase()
    .split(/[^a-zа-яёʼ'0-9]+/i)
    .map((t) => t.replace(/^['ʼ]+|['ʼ]+$/g, ''))
    .filter((t) => t.length >= 3 && !STOPWORDS.has(t));
}

/** Ikki token bir-biriga mosmi (aynan yoki o'zak bo'yicha). */
function tokenMatch(a, b) {
  if (a === b) return true;
  if (a.length >= 4 && b.length >= 4 && (a.startsWith(b) || b.startsWith(a))) return true;
  return false;
}

/**
 * Chiqish sababi maqsadga qanchalik bog'liqligi (0..1).
 * Foydalanuvchining ERKIN MATNI + sabab kategoriyasini sessiya maqsadi/vazifasi
 * bilan solishtiradi. Hech narsa o'ylab topilmaydi — faqat matn mosligi.
 */
function goalRelevance(context) {
  const goalTokens = tokenize(
    [context.goal, context.task, context.reason, context.successCriteria].join(' '),
  );
  const exitTokens = tokenize(context.freeText);
  if (!goalTokens.length || !exitTokens.length) return { score: 0, strong: false, matches: 0 };
  let matches = 0;
  let maxMatchedLen = 0;
  for (const et of exitTokens) {
    if (goalTokens.some((gt) => tokenMatch(et, gt))) {
      matches += 1;
      if (et.length > maxMatchedLen) maxMatchedLen = et.length;
    }
  }
  const score = Math.min(1, matches / Math.min(goalTokens.length, exitTokens.length));
  // "strong": yakka bo'lsa ham mazmunli kalit so'z (masalan "universitet", "python")
  // mos kelsa — bu odatda maqsadga bog'liqlikni bildiradi.
  return { score, strong: maxMatchedLen >= 5, matches };
}

/** Chiqishi kutilgan tuzilmaga mosmi? Noto'g'ri bo'lsa `null`. */
function validateDecision(obj) {
  if (!obj || typeof obj !== 'object') return null;
  if (!D.AI_DECISION.includes(obj.decision)) return null;
  const confidence = Number(obj.confidence);
  if (!Number.isFinite(confidence) || confidence < 0 || confidence > 1) return null;
  const suggested = SUGGESTED_ACTION.includes(obj.suggested_action) ? obj.suggested_action : 'continue_focus';
  const category = D.DISTRACTION_CATEGORY.includes(obj.category) ? obj.category : 'unknown';
  const reason = D.cleanText(obj.reason, 400);
  if (!reason) return null;
  return {
    decision: obj.decision,
    confidence: Math.round(confidence * 100) / 100,
    reason,
    suggested_action: suggested,
    category,
    source: obj.source === 'remote' ? 'remote' : 'deterministic',
  };
}

// ── Xabar matnlari (neytral, foydalanuvchining O'Z maqsadidan foydalanadi) ──
// Spec PART 2 §13: hech qachon ayblamaslik, sharmanda qilmaslik, bosim o'tkazmaslik.
function msgAllowRelevant(ctx) {
  return `Bu «${ctx.goal}» maqsadingizga bog'liq ko'rinadi. Kerak bo'lsa davom eting — Focus sizni ushlab turmaydi.`;
}
function msgUrgent() {
  return `Bu shoshilinch ko'rinadi. Focus sizni ushlab turmaydi — keyin qaytishingiz mumkin.`;
}
function msgStay(ctx) {
  const left = ctx.remainingMinutes > 0 ? ` Sessiyada ~${ctx.remainingMinutes} daqiqa qoldi.` : '';
  return `Bu hozirgi maqsadingiz «${ctx.goal}» bilan bevosita bog'liq emasdek.${left} Davom etasizmi yoki keyinga qoldiramizmi?`;
}
function msgSchedule(ctx) {
  return `Muhim, lekin shoshilinch emasga o'xshaydi. Sessiyadan keyin qilishni rejalashtiraylikmi?`;
}
function msgRepeated(ctx, count) {
  return `Bugun bir necha marta shu sabab bilan chiqdingiz (${count}). Qisqa tanaffusni rejalashtirsak, keyin xotirjam davom etarmidingiz?`;
}

/**
 * Deterministik qaror — asosiy mantiq. Har doim tushuntirishli, ayblovsiz.
 * @param {object} ctx
 * @returns validated decision
 */
function decideDeterministic(ctx) {
  const cat = ctx.exitReasonCategory || 'unknown';
  const rel = goalRelevance(ctx);
  const remaining = Number(ctx.remainingMinutes) || 0;
  const prior = ctx.priorSummary || {};
  const repeatedSame = prior.commonCategory === cat && (prior.commonCount || 0) >= 3;

  // 1) Shoshilinch — hech qachon ushlab turilmaydi (spec PART 2 §11).
  if (cat === 'emergency') {
    return validateDecision({
      decision: 'allow', confidence: 0.99, reason: msgUrgent(),
      suggested_action: 'leave', category: 'urgent', source: 'deterministic',
    });
  }

  // 2) Aniq maqsadga bog'liq (matn mosligi yuqori yoki kuchli kalit so'z) — davom etsa bo'ladi.
  if (rel.score >= 0.34 || rel.strong) {
    return validateDecision({
      decision: 'allow', confidence: 0.82, reason: msgAllowRelevant(ctx),
      suggested_action: 'leave', category: cat === 'research' ? 'research' : 'productive', source: 'deterministic',
    });
  }

  // 3) Sabab kategoriyasi bo'yicha.
  switch (cat) {
    case 'important_task':
    case 'communication':
    case 'quick_action': {
      // Muhim bo'lishi mumkin, lekin maqsadga bog'liqligi past. Foydalanuvchi
      // hal qiladi; agar shoshilinch bo'lmasa — rejalashtirishni taklif qilamiz.
      return validateDecision({
        decision: 'schedule', confidence: 0.6,
        reason: msgSchedule(ctx), suggested_action: 'schedule',
        category: cat === 'communication' ? 'communication' : 'necessary', source: 'deterministic',
      });
    }
    case 'research': {
      return validateDecision({
        decision: 'allow', confidence: 0.62, reason: msgAllowRelevant(ctx),
        suggested_action: 'leave', category: 'research', source: 'deterministic',
      });
    }
    case 'break':
    case 'just_checking': {
      const reason = repeatedSame ? msgRepeated(ctx, prior.commonCount) : msgStay(ctx);
      return validateDecision({
        decision: 'stay_focused', confidence: 0.7, reason,
        suggested_action: repeatedSame ? 'schedule' : 'continue_focus',
        category: cat === 'break' ? 'necessary' : 'entertainment', source: 'deterministic',
      });
    }
    default: {
      // Noaniq — bittagina yumshoq savol/eslatma. Cheksiz so'roq YO'Q.
      return validateDecision({
        decision: 'stay_focused', confidence: 0.5, reason: msgStay(ctx),
        suggested_action: 'continue_focus', category: 'unknown', source: 'deterministic',
      });
    }
  }
}

/**
 * Server LLM hook'i. Hozircha ulanmagan → `null`.
 * Ulanganda: bu yerda 'focus-decision' server endpoint'iga MINIMAL kontekst
 * yuboriladi (goal, task, reason, remaining, exit reason) — butun tarix EMAS
 * (spec PART 4 §15, PART 7 §28 data minimization). Chiqishi validateDecision
 * bilan tekshiriladi; timeout va xato → `null`.
 */
async function remoteReason(ctx, options = {}) {
  void ctx; void options;
  return null; // hali ulanmagan — deterministik yo'l ishlaydi (soxta javob YO'Q).
}

/** Vaqt bilan chegaralangan promise. */
function withTimeout(promise, ms) {
  return new Promise((resolve) => {
    let done = false;
    const t = setTimeout(() => { if (!done) { done = true; resolve(null); } }, ms);
    Promise.resolve(promise).then((v) => { if (!done) { done = true; clearTimeout(t); resolve(v); } })
      .catch(() => { if (!done) { done = true; clearTimeout(t); resolve(null); } });
  });
}

/**
 * Asosiy kirish nuqtasi. Kontekst asosida tuzilgan qaror qaytaradi.
 * AI ishlamasa/tarmoq yo'q bo'lsa — deterministik natija (spec PART 2 §21).
 *
 * @param {object} context { goal, task, reason, successCriteria, exitReasonCategory,
 *                           freeText, remainingMinutes, awayMinutes, priorSummary }
 * @param {object} options { useRemote?:bool, timeoutMs?:number }
 */
async function decide(context = {}, options = {}) {
  const ctx = {
    goal: D.cleanText(context.goal, D.LIMITS.GOAL) || 'maqsadingiz',
    task: D.cleanText(context.task, D.LIMITS.TASK),
    reason: D.cleanText(context.reason, D.LIMITS.REASON),
    successCriteria: D.cleanText(context.successCriteria, D.LIMITS.SUCCESS),
    exitReasonCategory: D.EXIT_REASON.includes(context.exitReasonCategory) ? context.exitReasonCategory : 'unknown',
    freeText: D.cleanText(context.freeText, D.LIMITS.REASON),
    remainingMinutes: Math.max(0, Math.round(Number(context.remainingMinutes) || 0)),
    awayMinutes: Math.max(0, Math.round(Number(context.awayMinutes) || 0)),
    priorSummary: context.priorSummary || {},
  };

  const deterministic = decideDeterministic(ctx);

  // Deterministik javob ishonchli bo'lsa — AI'ni bezovta qilmaymiz (xarajat tejash).
  // Faqat NOANIQ (confidence past) va remote yoqilgan bo'lsa — LLM'dan so'raymiz.
  const ambiguous = deterministic.confidence < 0.65;
  if (options.useRemote && ambiguous) {
    const timeoutMs = Number(options.timeoutMs) || 3500;
    const remote = await withTimeout(remoteReason(ctx, { timeoutMs }), timeoutMs);
    const validated = remote ? validateDecision({ ...remote, source: 'remote' }) : null;
    if (validated) return validated;
    // Xato/timeout/noto'g'ri format → deterministik (spec PART 7 §6-7 fallback).
  }
  return deterministic;
}

module.exports = {
  decide,
  decideDeterministic,
  validateDecision,
  goalRelevance,
  tokenize,
  remoteReason,
  SUGGESTED_ACTION,
};
