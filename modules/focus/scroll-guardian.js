'use strict';

/**
 * NIEX Focus — Scroll Guardian (spec "scrolling blok" PART 2).
 *
 * HAQIQIY scrolling_time (PART 1 detektsiyasidan) asosida 15/30 daqiqa
 * chegaralarini kuzatadi va intervention (ogohlantirish) hodisalarini chiqaradi.
 *
 * MUHIM (foydalanuvchi talabi): bu Pro userlar uchun DOIM ishlaydi — Focus
 * sessiyasi yoqilganmi yoki yo'qmi, farqi yo'q. Focus sessiya faol bo'lsa,
 * uning maqsadi xabarda ishlatiladi (main tomonida).
 *
 * SOF mantiq: DOM/electron'ga bog'liq emas; timer/now inject qilinadi (test uchun).
 */
function createScrollGuardian(opts = {}) {
  const now = opts.now || Date.now;
  const setTimer = opts.setTimeout || setTimeout;
  const clearTimer = opts.clearTimeout || clearTimeout;

  const WARN1 = opts.warn1Ms != null ? opts.warn1Ms : 15 * 60000;      // 15 daqiqa scrolling
  const WARN2 = opts.warn2Ms != null ? opts.warn2Ms : 30 * 60000;      // 30 daqiqa scrolling
  const RESTRICTION = opts.restrictionMs != null ? opts.restrictionMs : 12 * 60000; // 12 daqiqa cheklov
  const RESET_GAP = opts.resetGapMs != null ? opts.resetGapMs : 15 * 60000; // shu muddat scroll bo'lmasa — yangidan

  const onWarn = opts.onWarn || (() => {});
  const onRestrictStart = opts.onRestrictStart || (() => {});
  const onRestrictEnd = opts.onRestrictEnd || (() => {});

  let scrollMs = 0;
  let phase = 'none';            // none | warned1 | warned2 | restricted
  let lastActivityAt = 0;
  let restrictionUntil = 0;
  let restrictionTimer = null;

  function info() { return { scrollMs, scrollMinutes: Math.round(scrollMs / 60000), phase }; }
  function isRestricted() { return restrictionUntil > now(); }
  function restrictionRemainingMs() { return Math.max(0, restrictionUntil - now()); }

  function reset() {
    scrollMs = 0;
    phase = 'none';
    if (restrictionTimer) { clearTimer(restrictionTimer); restrictionTimer = null; }
    restrictionUntil = 0;
  }

  function endRestriction() {
    if (restrictionTimer) { clearTimer(restrictionTimer); restrictionTimer = null; }
    restrictionUntil = 0;
    try { onRestrictEnd(); } catch (_) {}
    reset();
  }

  function startRestriction() {
    restrictionUntil = now() + RESTRICTION;
    phase = 'restricted';
    if (restrictionTimer) clearTimer(restrictionTimer);
    restrictionTimer = setTimer(endRestriction, RESTRICTION);
    if (restrictionTimer && restrictionTimer.unref) restrictionTimer.unref();
    try { onRestrictStart({ ...info(), restrictionMs: RESTRICTION }); } catch (_) {}
  }

  /** PART 1 detektsiyasidan kelgan HAQIQIY scrolling deltasi. */
  function addScroll(deltaMs, meta = {}) {
    const t = now();
    // Uzoq tanaffus (scroll bo'lmagan) — yangi "binge" boshlanadi.
    if (lastActivityAt && (t - lastActivityAt) > RESET_GAP) reset();
    lastActivityAt = t;
    if (isRestricted()) return; // cheklov paytida yangi chegara sanalmaydi
    scrollMs += Math.max(0, Number(deltaMs) || 0);

    if (phase === 'none' && scrollMs >= WARN1) {
      phase = 'warned1';
      try { onWarn(1, { ...info(), platform: meta.platform || null }); } catch (_) {}
    } else if (phase === 'warned1' && scrollMs >= WARN2) {
      phase = 'warned2';
      try { onWarn(2, { ...info(), platform: meta.platform || null }); } catch (_) {}
      startRestriction();
    }
  }

  /** Foydalanuvchi ogohlantirishga javobi. 'yes' = Focusga qaytdi (yangidan). */
  function onUserChoice(choice) {
    if (choice === 'yes') reset();
    // 'later' → hech narsa: yig'ilish davom etadi, 30 daqiqada 2-ogohlantirish (spec §3).
  }

  return {
    addScroll,
    onUserChoice,
    reset,
    isRestricted,
    restrictionRemainingMs,
    info,
    getState: () => ({ ...info(), restrictionUntil }),
  };
}

module.exports = { createScrollGuardian };
