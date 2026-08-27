/**
 * NIEX Focus — Scroll Activity Core (spec "scrolling blok" PART 1).
 *
 * SOF state-machine: DOM'ga, brauzerga, Flutter'ga bog'liq EMAS. Faqat
 * signallarni (scroll hodisasi, kontekst o'zgarishi, vaqt) qabul qiladi va
 * HAQIQIY "scrolling_time" ni hisoblaydi.
 *
 * ASOSIY QOIDA (spec §1): page_time ≠ scrolling_time. Video ko'rish, qidiruv,
 * chat, o'qish — SCROLLING EMAS. Faqat cheksiz feed/tavsiya oqimini FAOL
 * scroll qilish hisoblanadi.
 *
 * Ishlatilishi: Node'da `require` bilan (test) yoki sahifaga inject qilinganda
 * global `NIEXScrollCore` sifatida.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.NIEXScrollCore = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const STATE = Object.freeze({
    IDLE: 'idle',
    SCROLLING_ACTIVE: 'scrolling_active',
    SCROLLING_PAUSED: 'scrolling_paused',
    NON_SCROLLING: 'non_scrolling',
  });

  // Kontekst turi — adapter beradi. Faqat `scroll_surface` (feed) da scroll hisoblanadi.
  const CONTEXT_TYPE = Object.freeze({
    FEED: 'scroll_surface',   // YouTube Home/Shorts, Instagram feed/Reels
    VIDEO: 'video',           // YouTube watch / podcast / lecture
    SEARCH: 'search',
    CHAT: 'chat',
    READING: 'reading',       // maqola, post, profil — feed emas
    IDLE: 'idle',
  });

  const DEFAULTS = Object.freeze({
    minEvents: 3,          // scroll sessiyasi boshlanishi uchun eng kam hodisa (bitta swipe emas)
    eventWindowMs: 4000,   // shu oynada minEvents kelsa — faol scroll
    pauseMs: 3000,         // scroll-feed (Home/tavsiya): shu muddat scroll bo'lmasa — pauza
    // Shortform feed (YouTube Shorts, Instagram Reels): har qisqa video AVTO o'ynaydi,
    // foydalanuvchi orada swipe qiladi. Bu — cheksiz distraction oqimi, shuning uchun
    // qisqa videoni ko'rish vaqti ham hisoblanadi (uzun pauza).
    shortformPauseMs: 120000,
    shortformMinEvents: 1, // shortform feedga tushib bitta swipe = distraction boshlandi
  });

  class ScrollActivityCore {
    constructor(opts = {}) {
      this.now = opts.now || Date.now;
      this.MIN_EVENTS = opts.minEvents || DEFAULTS.minEvents;
      this.EVENT_WINDOW = opts.eventWindowMs || DEFAULTS.eventWindowMs;
      this.PAUSE = opts.pauseMs || DEFAULTS.pauseMs;
      this.SHORTFORM_PAUSE = opts.shortformPauseMs || DEFAULTS.shortformPauseMs;

      this.scrollingMs = 0;      // yopilgan segmentlar yig'indisi
      this.segStart = null;      // joriy faol segment boshi (ms) yoki null
      this.lastScrollAt = 0;
      this.events = [];          // so'nggi scroll hodisalari vaqtlari
      this.context = { type: CONTEXT_TYPE.IDLE, platform: null, name: null, feedMode: null };
    }

    get isFeed() { return this.context.type === CONTEXT_TYPE.FEED; }
    get isActive() { return this.segStart != null; }
    // Feed turiga qarab pauza/boshlash chegarasi.
    _pause() { return this.context.feedMode === 'shortform' ? this.SHORTFORM_PAUSE : this.PAUSE; }
    _minEvents() { return this.context.feedMode === 'shortform' ? DEFAULTS.shortformMinEvents : this.MIN_EVENTS; }
    // Faol segmentning haqiqiy tugash nuqtasi: agar oxirgi scroll'dan beri pauza
    // oshmagan bo'lsa — hozirgi vaqt (hali davom etmoqda), aks holda oxirgi scroll.
    _effectiveEnd() {
      const t = this.now();
      return (t - this.lastScrollAt <= this._pause()) ? t : this.lastScrollAt;
    }

    /** Adapter kontekstni yangilaydi (SPA route o'zgarganda ham). */
    setContext(ctx) {
      const next = ctx || {};
      const type = Object.values(CONTEXT_TYPE).includes(next.type) ? next.type : CONTEXT_TYPE.READING;
      // Feed'dan chiqib ketilsa — faol segmentni yopamiz (chiqish paytigacha hisoblanadi).
      if (this.segStart != null && type !== CONTEXT_TYPE.FEED) {
        this._closeSegment(this._effectiveEnd());
      }
      this.context = { type, platform: next.platform || null, name: next.name || null, feedMode: next.feedMode || null };
      if (type !== CONTEXT_TYPE.FEED) this.events = [];
    }

    /** Bitta scroll/swipe hodisasi. Faqat feed kontekstida hisoblanadi. */
    onScroll() {
      if (!this.isFeed) return;
      const t = this.now();
      this.events.push(t);
      // Eski hodisalarni tozalaymiz
      const cutoff = t - this.EVENT_WINDOW;
      while (this.events.length && this.events[0] < cutoff) this.events.shift();
      this.lastScrollAt = t;
      // Yetarli hodisa yig'ilsa — faol segment boshlaymiz (burstning birinchisidan).
      if (this.segStart == null && this.events.length >= this._minEvents()) {
        this.segStart = this.events[0];
      }
    }

    /** Vaqtni oldinga suradi — pauzani aniqlaydi (scroll to'xtaganini). */
    tick() {
      const t = this.now();
      if (this.segStart != null && (t - this.lastScrollAt) > this._pause()) {
        this._closeSegment(this.lastScrollAt);
      }
    }

    _closeSegment(endAt) {
      if (this.segStart != null) {
        this.scrollingMs += Math.max(0, endAt - this.segStart);
        this.segStart = null;
        this.events = [];
      }
    }

    /** Ko'rinadigan (jonli) umumiy scrolling vaqti — hisobot uchun. */
    liveScrollingMs() {
      let total = this.scrollingMs;
      if (this.segStart != null) {
        total += Math.max(0, this._effectiveEnd() - this.segStart);
      }
      return Math.round(total);
    }

    /** Joriy holat. */
    state() {
      if (this.segStart != null) return STATE.SCROLLING_ACTIVE;
      switch (this.context.type) {
        case CONTEXT_TYPE.VIDEO:
        case CONTEXT_TYPE.SEARCH:
        case CONTEXT_TYPE.CHAT:
        case CONTEXT_TYPE.READING:
          return STATE.NON_SCROLLING;
        case CONTEXT_TYPE.FEED:
          return this.events.length ? STATE.SCROLLING_PAUSED : STATE.IDLE;
        default:
          return STATE.IDLE;
      }
    }

    /** Activity turi — analitika/AI uchun (spec §3). */
    activityType() {
      if (this.segStart != null) return 'scrolling';
      switch (this.context.type) {
        case CONTEXT_TYPE.VIDEO: return 'video_watching';
        case CONTEXT_TYPE.SEARCH: return 'searching';
        case CONTEXT_TYPE.CHAT: return 'chat';
        case CONTEXT_TYPE.READING: return 'reading';
        case CONTEXT_TYPE.FEED: return 'reading'; // feedda, lekin hozir faol scroll emas
        default: return 'idle';
      }
    }

    /** PART 2 (intervention) iste'mol qiladigan tuzilgan ma'lumot (spec §11). */
    snapshot() {
      return {
        activityType: this.activityType(),
        state: this.state(),
        scrollingMs: this.liveScrollingMs(),
        platform: this.context.platform || null,
        context: this.context.name || null,
        isFeed: this.context.type === CONTEXT_TYPE.FEED,
        feedMode: this.context.feedMode || null,
        lastActivityAt: this.lastScrollAt || null,
      };
    }
  }

  return { ScrollActivityCore, STATE, CONTEXT_TYPE, DEFAULTS };
}));
