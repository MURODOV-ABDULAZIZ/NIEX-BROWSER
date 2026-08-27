'use strict';

/**
 * NIEX Focus — Desktop Exit Monitor (platforma adapteri, spec PART 3 §2-3).
 *
 * VAZIFA: Focus ACTIVE bo'lganda foydalanuvchi NIEX brauzeridan CHIQIB
 * boshqa ilovaga o'tganini aniqlash. Bu — Focus Intelligence baholaydigan
 * yagona muhim hodisa. (Saytlar bloklanmaydi; ichki tab almashish hodisa emas.)
 *
 * TAMOYILLAR:
 *   - Ichki tab almashish HODISA EMAS: faqat oyna fokusi butunlay yo'qolsa
 *     (boshqa OS ilovasi) hisoblanadi.
 *   - Grace davri (spec PART 3 §12): qisqa (300–800ms) blur → darhol qaytish
 *     chalg'ish deb hisoblanmaydi.
 *   - Away threshold: juda qisqa chiqishlar (< bir necha soniya) hodisa
 *     yaratmaydi — foydalanuvchini bezovta qilmaslik uchun.
 *   - Soxta ma'lumot YO'Q: faqat OS bergan blur/focus vaqtlari.
 *
 * TESTLASH: yadro (timing) toza va inject qilinadigan timer/now/hasFocusedWindow
 * bilan ishlaydi. Electron ulanishi `attachElectron` da alohida.
 */

/**
 * @param {object} opts
 *   isSessionActive() -> bool     — Focus hozir ACTIVE (paused emas)?
 *   hasFocusedWindow() -> bool     — NIEX'ning biror oynasi hali fokusdami?
 *   onLeaveConfirmed(startTs)      — chiqish tasdiqlandi (ichki, log uchun)
 *   onNudge(elapsedMs)             — uzoq ketildi → bir marta eslatma (notif)
 *   onReturn(durationMs, startTs)  — qaytdi; durationMs >= threshold bo'lsa hodisa
 *   graceMs, awayThresholdMs, nudgeAfterMs
 *   now(), setTimeout(), clearTimeout()  — testlash uchun inject
 */
function createExitMonitor(opts = {}) {
  const graceMs = Number.isFinite(opts.graceMs) ? opts.graceMs : 800;
  const awayThresholdMs = Number.isFinite(opts.awayThresholdMs) ? opts.awayThresholdMs : 8000;
  const nudgeAfterMs = Number.isFinite(opts.nudgeAfterMs) ? opts.nudgeAfterMs : 45000;
  const now = opts.now || Date.now;
  const setTimer = opts.setTimeout || setTimeout;
  const clearTimer = opts.clearTimeout || clearTimeout;
  const isSessionActive = opts.isSessionActive || (() => false);
  const hasFocusedWindow = opts.hasFocusedWindow || (() => false);
  const onLeaveConfirmed = opts.onLeaveConfirmed || (() => {});
  const onNudge = opts.onNudge || (() => {});
  const onReturn = opts.onReturn || (() => {});

  let state = 'idle';       // idle | pendingLeave | away
  let graceT = null;
  let nudgeT = null;
  let awayStart = 0;
  let nudged = false;

  function clearGrace() { if (graceT) { clearTimer(graceT); graceT = null; } }
  function clearNudge() { if (nudgeT) { clearTimer(nudgeT); nudgeT = null; } }

  function handleBlur() {
    if (!isSessionActive()) return;
    if (state !== 'idle') return;
    state = 'pendingLeave';
    clearGrace();
    graceT = setTimer(() => {
      graceT = null;
      // Grace tugadi: NIEX'ning boshqa oynasi fokusda bo'lsa — bu ichki
      // almashish, chiqish emas.
      if (hasFocusedWindow()) { state = 'idle'; return; }
      // Sessiya orada tugagan/pauza bo'lgan bo'lsa — bekor.
      if (!isSessionActive()) { state = 'idle'; return; }
      state = 'away';
      awayStart = now();
      nudged = false;
      try { onLeaveConfirmed(awayStart); } catch (_) {}
      clearNudge();
      nudgeT = setTimer(() => {
        nudgeT = null;
        if (state === 'away' && !nudged) {
          nudged = true;
          try { onNudge(now() - awayStart); } catch (_) {}
        }
      }, nudgeAfterMs);
    }, graceMs);
  }

  function handleFocus() {
    if (state === 'pendingLeave') {
      // Grace ichida qaytdi — hech qanday hodisa yo'q (debounce).
      clearGrace();
      state = 'idle';
      return;
    }
    if (state === 'away') {
      const dur = now() - awayStart;
      const start = awayStart;
      clearNudge();
      state = 'idle';
      awayStart = 0;
      // Faqat mazmunli chiqish (>= threshold) hodisa yaratadi.
      if (dur >= awayThresholdMs) {
        try { onReturn(dur, start); } catch (_) {}
      }
    }
  }

  /** Sessiya tugadi/pauza bo'ldi — barcha holatni tozalaymiz. */
  function reset() {
    clearGrace();
    clearNudge();
    state = 'idle';
    awayStart = 0;
    nudged = false;
  }

  function getState() { return state; }

  return { handleBlur, handleFocus, reset, getState };
}

/**
 * Electron ulanishi: app darajasidagi blur/focus hodisalari (barcha oynalar uchun).
 * `browser-window-blur` — biror oyna fokusni yo'qotdi; `browser-window-focus` —
 * biror oyna fokusga keldi. "NIEX'dan chiqish" = hech bir NIEX oynasi fokusda
 * qolmagani (grace ichida tekshiriladi: hasFocusedWindow).
 */
function attachElectron(app, monitor) {
  if (!app || !monitor) return () => {};
  const onBlur = () => monitor.handleBlur();
  const onFocus = () => monitor.handleFocus();
  app.on('browser-window-blur', onBlur);
  app.on('browser-window-focus', onFocus);
  return () => {
    try { app.removeListener('browser-window-blur', onBlur); } catch (_) {}
    try { app.removeListener('browser-window-focus', onFocus); } catch (_) {}
  };
}

module.exports = { createExitMonitor, attachElectron };
