/**
 * NIEX — Activity Intelligence: Content Classifier.
 * =================================================
 *
 * Spec §5, §6, §7, §23, §24 — CONTENT → CATEGORY → VALUE pipeline.
 *
 * QAT'IY QOIDALAR (spec):
 *   - PLATFORM → VALUE EMAS. YouTube har doim foydali emas, Instagram har doim
 *     zararli emas, Podcast har doim foydali emas.
 *   - CONTENT + CONTEXT + ACTIVITY TYPE (+ FOCUS GOAL) → VALUE.
 *   - Noaniq bo'lsa → UNKNOWN (avtomatik LOW/RED QILMA).
 *   - Extensible: bitta ulkan if/else emas, leksikon + qoidalar (§19).
 *
 * Kirish (§23): platform, domain, activityType, context, title, url, goal, aiVerdict?
 * Chiqish: { category, value, confidence, reasons[] }
 *
 * AI (§11/PART4): agar `aiVerdict` berilsa (mavjud NIEX classification'dan) —
 * u ustuvor. Bu yerda yangi AI pipeline YARATILMAYDI; faqat mavjudini qabul qiladi.
 */
(function (root, factory) {
  const model = (typeof require === 'function')
    ? require('./activity-model')
    : root.NIEXActivityModel;
  const api = factory(model);
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.NIEXContentClassifier = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function (M) {
  'use strict';

  const A = M.ACTIVITY_TYPE;
  const C = M.CONTENT_CATEGORY;
  const V = M.VALUE_LEVEL;

  // ── LEKSIKONLAR (extensible; en + uz + ru so'zlar) ────────────────
  // Har biri kategoriya uchun kalit so'zlar. Title + URL matniga qo'llanadi.
  const LEX = {
    [C.PROGRAMMING]: [
      'programming', 'coding', 'code', 'developer', 'javascript', 'typescript', 'python',
      'java ', 'c++', 'rust', 'golang', 'react', 'node.js', 'nodejs', 'api', 'algorithm',
      'leetcode', 'frontend', 'backend', 'devops', 'sql', 'database', 'html', 'css',
      'dasturlash', 'dasturchi', 'kod yoz', 'программирование', 'разработчик',
    ],
    [C.EDUCATION]: [
      'tutorial', 'lesson', 'course', 'lecture', 'how to', 'learn', 'study', 'exam',
      'ielts', 'toefl', 'sat ', 'university', 'homework', 'explained', 'crash course',
      'khan academy', 'mathematics', 'math ', 'physics', 'chemistry', 'biology', 'history',
      'grammar', 'vocabulary', 'dars', "ta'lim", 'oʻrgan', 'organ', 'kurs', 'imtihon',
      'universitet', 'matematika', 'урок', 'обучение', 'курс', 'учеба',
    ],
    [C.SCIENCE]: [
      'science', 'research', 'scientific', 'quantum', 'astronomy', 'neuroscience',
      'experiment', 'theorem', 'nasa', 'fan ', 'ilmiy', 'tadqiqot', 'наука', 'исследование',
    ],
    [C.RESEARCH]: [
      'documentation', 'docs', 'reference', 'whitepaper', 'arxiv', 'paper', 'thesis',
      'scholar', 'wikipedia', 'wiki', 'manual', 'spec ', 'hujjat', 'maqola',
    ],
    [C.TECHNOLOGY]: [
      'technology', 'gadget', 'review', 'unboxing', 'smartphone', 'laptop', 'ai ',
      'artificial intelligence', 'machine learning', 'startup', 'texnologiya', 'sunʼiy intellekt',
      'технологии',
    ],
    [C.NEWS]: [
      'news', 'breaking', 'politics', 'election', 'headline', 'report', 'yangilik',
      'xabar', 'siyosat', 'saylov', 'новости', 'политика',
    ],
    [C.SPORTS]: [
      'football', 'soccer', 'basketball', 'nba', 'fifa', 'match', 'highlights', 'goal ',
      'workout', 'fitness', 'gym', 'sport', 'futbol', 'mashq', 'спорт', 'матч',
    ],
    [C.GAMING]: [
      'gameplay', 'gaming', 'minecraft', 'fortnite', 'gta', 'valorant', 'pubg', 'roblox',
      'walkthrough', 'speedrun', 'letʼs play', 'lets play', 'game trailer', 'esports',
      'oʻyin', 'oyin', 'игра', 'игровой', 'прохождение',
    ],
    [C.ENTERTAINMENT]: [
      'funny', 'meme', 'prank', 'comedy', 'vlog', 'reaction', 'gossip', 'celebrity',
      'movie', 'trailer', 'music video', 'song', 'clip', 'entertainment', 'tv show',
      'kulgili', 'prikol', 'qiziqarli', 'koʻngilochar', 'смешно', 'прикол', 'мем',
    ],
    [C.PODCAST]: [
      'podcast', 'ep.', 'episode', 'interview', 'talk show', 'nma gap', 'nima gap',
      'suhbat', 'подкаст',
    ],
    [C.SHOPPING]: [
      'buy', 'shop', 'price', 'discount', 'sale', 'order', 'cart', 'sotib ol', 'narx',
      'chegirma', 'buyurtma', 'купить', 'цена', 'скидка',
    ],
  };

  // Kategoriya → bazaviy qiymat (goal/context bilan tuzatiladi).
  const BASE_VALUE = {
    [C.PROGRAMMING]: V.HIGH,
    [C.EDUCATION]: V.HIGH,
    [C.SCIENCE]: V.HIGH,
    [C.RESEARCH]: V.HIGH,
    [C.TECHNOLOGY]: V.MEDIUM,
    [C.NEWS]: V.MEDIUM,
    [C.PRODUCTIVITY]: V.MEDIUM,
    [C.PODCAST]: V.MEDIUM,       // §7: podcast AVTOMATIK foydali EMAS — mavzuga qarab
    [C.SPORTS]: V.LOW,
    [C.ENTERTAINMENT]: V.LOW,
    [C.GAMING]: V.LOW,
    [C.SHORTFORM_VIDEO]: V.LOW,  // §6: Shorts/Reels feed scroll = distraction
    [C.SOCIAL_MEDIA]: V.LOW,
    [C.SHOPPING]: V.UNKNOWN,
    [C.COMMUNICATION]: V.UNKNOWN, // §6: chat context-dependent
    [C.OTHER]: V.UNKNOWN,
  };

  function norm(s) { return String(s || '').toLowerCase(); }

  // ── SO'Z-CHEGARASI matcher (substring false-positive'larni oldini oladi) ──
  // MUAMMO: oddiy indexOf "reaction"→react, "barcode"→code, "dasturxon"→dastur
  // kabi noto'g'ri mosliklar beradi. YECHIM: Unicode-aware so'z chegarasi.
  // c++ / node.js / .net / ep. kabi maxsus belgili kalitlar ham to'g'ri ishlaydi.
  function buildMatcher(kwRaw) {
    let kw = String(kwRaw).trim().toLowerCase();
    const startWord = /[\p{L}\p{N}]/u.test(kw[0]);
    const endWord = /[\p{L}\p{N}]/u.test(kw[kw.length - 1]);
    let esc = kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    esc = esc.replace(/ +/g, '[\\s\\-]+'); // "how to" → "how-to" ham mos
    const pre = startWord ? '(?<![\\p{L}\\p{N}])' : '';
    const post = endWord ? '(?![\\p{L}\\p{N}])' : '';
    try { return new RegExp(pre + esc + post, 'iu'); }
    catch { return new RegExp(esc.replace(/\\b/g, ''), 'i'); } // fallback (eski muhit)
  }
  // Har kategoriya kalitlarini bir marta regexga kompilyatsiya qilamiz.
  const MATCHERS = {};
  for (const cat of Object.keys(LEX)) MATCHERS[cat] = LEX[cat].map(buildMatcher);

  /** Matnda leksikon kalitlaridan nechtasi bor — eng mos kategoriyani topadi. */
  function scoreCategories(text) {
    const t = norm(text);
    if (!t) return [];
    const scores = [];
    for (const cat of Object.keys(MATCHERS)) {
      let hits = 0;
      for (const re of MATCHERS[cat]) if (re.test(t)) hits++;
      if (hits > 0) scores.push({ cat, hits });
    }
    scores.sort((a, b) => b.hits - a.hits);
    return scores;
  }

  /** Goal tokenlarini ajratadi (2+ harfli, stop-so'zlarsiz). */
  const STOP = new Set(['uchun', 'the', 'and', 'for', 'with', 'bilan', 'men', 'imtihon', 'tayyorlanish']);
  function goalTokens(goal) {
    return norm(goal).split(/[^a-z0-9Ѐ-ӿ]+/).filter(w => w.length >= 3 && !STOP.has(w));
  }

  function goalMatches(text, goal) {
    const toks = goalTokens(goal);
    if (!toks.length) return false;
    const t = norm(text);
    return toks.some(tok => t.indexOf(tok) !== -1);
  }

  /**
   * Asosiy klassifikator.
   * @returns {{category, value, confidence, reasons: string[]}}
   */
  function classify(input = {}) {
    const activityType = input.activityType || A.UNKNOWN;
    const context = norm(input.context);
    const platform = norm(input.platform);
    const feedMode = norm(input.feedMode);
    const title = input.title || '';
    const url = input.url || '';
    const goal = input.goal || '';
    const text = `${title} ${url}`;
    const reasons = [];

    // 0) Mavjud NIEX AI verdikti bo'lsa — ustuvor (§11). Yangi AI yaratmaymiz.
    if (input.aiVerdict && input.aiVerdict.category) {
      return {
        category: input.aiVerdict.category,
        value: input.aiVerdict.value || BASE_VALUE[input.aiVerdict.category] || V.UNKNOWN,
        confidence: input.aiVerdict.confidence != null ? input.aiVerdict.confidence : 0.9,
        reasons: ['ai-verdict'],
      };
    }

    // 1) BLOCKED — safety engine qaroridan (§3).
    if (activityType === A.BLOCKED_CONTENT) {
      return { category: C.OTHER, value: V.LOW, confidence: 1, reasons: ['blocked'] };
    }

    // 2) CHAT (§3/§6) — scrolling EMAS. Communication, qiymat context-dependent.
    if (activityType === A.CHAT) {
      return { category: C.COMMUNICATION, value: V.UNKNOWN, confidence: 0.8, reasons: ['activity=chat'] };
    }

    // 3) SHORTFORM feed scroll (Shorts/Reels/TikTok) → distraction (§6/§7).
    const isShortform = feedMode === 'shortform' || context === 'shorts' || context === 'reels' || platform === 'tiktok';
    if (activityType === A.SCROLLING && isShortform) {
      // Goal'ga mos bo'lsa ham shortform feed = LOW (cheksiz oqim), lekin title
      // aniq foydali mavzuni ko'rsatsa MEDIUM'ga ko'taramiz.
      const s = scoreCategories(text);
      const top = s[0];
      let value = V.LOW;
      if (top && (top.cat === C.EDUCATION || top.cat === C.PROGRAMMING || top.cat === C.SCIENCE)) {
        value = V.MEDIUM; reasons.push('shortform+edu-hint');
      }
      reasons.push('shortform-feed');
      return { category: C.SHORTFORM_VIDEO, value, confidence: 0.75, reasons };
    }

    // 4) Oddiy feed scroll (Instagram home, YouTube home) → social/distraction (§6).
    if (activityType === A.SCROLLING) {
      reasons.push('feed-scroll');
      return { category: C.SOCIAL_MEDIA, value: V.LOW, confidence: 0.7, reasons };
    }

    // 5) Kontent asosida kategoriya (VIDEO_WATCHING / SEARCHING / READING).
    const scored = scoreCategories(text);
    let category = null;
    let confidence = 0.5;

    if (scored.length) {
      category = scored[0].cat;
      confidence = Math.min(0.9, 0.5 + scored[0].hits * 0.15);
      reasons.push(`kw:${category}(${scored[0].hits})`);
    }

    // Domen/platforma yordamchi ishoralari (faqat kontent signali bo'lmasa).
    if (!category) {
      if (platform === 'wikipedia') { category = C.RESEARCH; confidence = 0.7; reasons.push('domain:wikipedia'); }
      else if (platform === 'github' || platform === 'stackoverflow') { category = C.PROGRAMMING; confidence = 0.75; reasons.push('domain:dev'); }
      else if (platform === 'coursera' || platform === 'udemy' || platform === 'khanacademy') { category = C.EDUCATION; confidence = 0.8; reasons.push('domain:edu'); }
      else if (platform === 'twitch' || platform === 'netflix') { category = C.ENTERTAINMENT; confidence = 0.7; reasons.push('domain:ent'); }
    }

    // Aniqlanmadi → UNKNOWN (§23: avtomatik LOW/RED QILMA).
    if (!category) {
      // Qidiruv bo'lsa — SEARCHING category yo'q, lekin qiymat neytral.
      if (activityType === A.SEARCHING) {
        return { category: C.OTHER, value: V.UNKNOWN, confidence: 0.4, reasons: ['search-generic'] };
      }
      return { category: C.OTHER, value: V.UNKNOWN, confidence: 0.3, reasons: ['no-signal'] };
    }

    // 6) Qiymat: bazaviy + goal + podcast maxsus.
    let value = BASE_VALUE[category] != null ? BASE_VALUE[category] : V.UNKNOWN;

    // §7 — podcast mavzuga qarab: educational/tech topic → MEDIUM/HIGH; ent → LOW.
    if (category === C.PODCAST) {
      const hasEdu = scored.some(x => [C.PROGRAMMING, C.EDUCATION, C.SCIENCE, C.TECHNOLOGY, C.RESEARCH].includes(x.cat));
      const hasEnt = scored.some(x => [C.ENTERTAINMENT, C.GAMING].includes(x.cat));
      if (hasEdu) { value = V.HIGH; reasons.push('podcast+edu'); }
      else if (hasEnt) { value = V.LOW; reasons.push('podcast+ent'); }
      else { value = V.MEDIUM; reasons.push('podcast-neutral'); }
    }

    // §24 — FOCUS GOAL bilan bog'lash: title goal'ga mos bo'lsa → HIGH.
    if (goal && goalMatches(text, goal)) {
      // Entertainment/gaming ham goal'ga mos bo'lsa (kamdan-kam) MEDIUM'gacha.
      if (value === V.LOW) { value = V.MEDIUM; reasons.push('goal-match(low→med)'); }
      else { value = V.HIGH; reasons.push('goal-match'); }
      confidence = Math.min(0.95, confidence + 0.15);
    }

    return { category, value, confidence, reasons };
  }

  return { classify, scoreCategories, LEX, BASE_VALUE };
}));
