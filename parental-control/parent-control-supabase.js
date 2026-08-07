/**
 * PARENT CONTROL SERVICE — Supabase (Firebase o'rniga)
 * ====================================================
 * `window.parentControl` interfeysi ESKI service bilan bir xil:
 *   requestAddChild, verifyAddChild, subscribeChildren,
 *   subscribeNotifications, removeChild, markNotificationRead
 * Shuning uchun parent-control.js (UI) o'zgarmaydi.
 *
 * Ma'lumot main process → browser-cloud.js → Supabase browser-api orqali keladi.
 * Real-time o'rniga 10 soniyalik polling (Firestore onSnapshot o'rniga).
 */
(function () {
  'use strict';

  // MUHIM: bu sahifa safenethome ichida IFRAME sifatida ochiladi.
  //   Electron preload bridge faqat asosiy frame'ga qo'yiladi — iframe'да yo'q.
  //   Ikkalasi ham file:// (same-origin) → window.parent orqali olamiz.
  const bridge = () => {
    if (window.safenet_parent) return window.safenet_parent;
    try { if (window.parent && window.parent.safenet_parent) return window.parent.safenet_parent; } catch {}
    try { if (window.top && window.top.safenet_parent) return window.top.safenet_parent; } catch {}
    return null;
  };

  // Supabase (snake_case) → UI kutayotgan (camelCase) shakl
  function mapChild(r) {
    return {
      childUid: r.child_email,           // UI removeChild(childUid) uchun identifikator
      childEmail: r.child_email || '',
      childName: r.child_name || r.child_email || '',
      status: r.status || 'pending',
      createdAt: r.created_at,
      activatedAt: r.activated_at,
    };
  }

  function mapAlert(r) {
    return {
      id: r.id,
      childUid: r.child_email,
      childEmail: r.child_email || '',
      childName: r.child_name || r.child_email || '',
      category: r.category || 'unknown',
      searchQuery: r.search_query || '',
      url: r.url || '',
      reason: r.reason || '',
      device: r.device || '',
      browser: 'Niex',
      createdAt: r.created_at,
      read: !!r.read,
    };
  }

  let childrenTimer = null;
  let notifTimer = null;
  const POLL_MS = 10000;

  window.parentControl = {
    // Farzand qo'shish — kod yaratiladi va emailga (+ farzand brauzeriga) yuboriladi
    async requestAddChild(childEmail) {
      const b = bridge();
      if (!b) return { ok: false, error: 'Ulanish yo\'q. Brauzerni qayta ishga tushiring.' };
      const email = String(childEmail || '').trim().toLowerCase();
      if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
        return { ok: false, error: 'To\'g\'ri email kiriting.' };
      }
      const r = await b.addChild(email);
      if (!r || !r.ok) return { ok: false, error: (r && r.error) || 'Yuborilmadi' };
      // Backendning BARCHA yetkazish bayroqlarini uzatamiz. Avval
      // `deliveredToBrowser` tushib qolardi — UI kod farzand brauzeriga
      // borganini bilmasdan "yetkazilmadi" deb ko'rsatardi.
      return {
        ok: true,
        emailSent: r.emailSent,
        emailError: r.emailError,
        deliveredToBrowser: r.deliveredToBrowser,
        expiresAt: r.expiresAt,
      };
    },

    // 6 xonali kodni tasdiqlash
    async verifyAddChild(childEmail, code) {
      const b = bridge();
      if (!b) return { ok: false, error: 'Ulanish yo\'q.' };
      const r = await b.verifyChildCode(String(childEmail || '').trim().toLowerCase(), String(code || '').trim());
      if (!r || !r.ok) return { ok: false, error: (r && r.error) || 'Kod tasdiqlanmadi' };
      return { ok: true };
    },

    // Farzandni olib tashlash (UI childUid yuboradi = child_email)
    async removeChild(childUid) {
      const b = bridge();
      if (!b) return { ok: false, error: 'Ulanish yo\'q.' };
      const r = await b.revokeChild(String(childUid || '').toLowerCase());
      if (!r || !r.ok) return { ok: false, error: (r && r.error) || 'O\'chirilmadi' };
      return { ok: true };
    },

    // ESKI Firebase yo'li — endi kerak emas. Farzand bloki main.js orqali ketadi:
    //   block-reporter → __parentControlBridge → IPC 'parent-control-report-block'
    //   → browserCloud.sendParentAlert() → Supabase. Bu yerda no-op (xato bermasin).
    async reportBlockedContent() { return { ok: true, skipped: 'main-process handles alerts' }; },

    async markNotificationRead(id) {
      const b = bridge();
      if (!b) return { ok: false };
      await b.markAlertsRead([id]);
      return { ok: true };
    },

    // Farzandlar ro'yxati — polling (Firestore onSnapshot o'rniga)
    subscribeChildren(cb) {
      const load = async () => {
        const b = bridge();
        if (!b) return;
        try {
          const r = await b.getChildren();
          cb((r && r.data ? r.data : []).map(mapChild));
        } catch (e) { console.warn('[parent-control] children:', e); }
      };
      load();
      clearInterval(childrenTimer);
      childrenTimer = setInterval(load, POLL_MS);
      return () => clearInterval(childrenTimer);
    },

    // Bloklangan kontent signallari — polling
    subscribeNotifications(cb) {
      const load = async () => {
        const b = bridge();
        if (!b) return;
        try {
          const r = await b.getAlerts();
          const list = (r && r.data ? r.data : []).map(mapAlert);
          cb({ list, unread: list.filter(x => !x.read).length });
        } catch (e) { console.warn('[parent-control] alerts:', e); }
      };
      load();
      clearInterval(notifTimer);
      notifTimer = setInterval(load, POLL_MS);
      return () => clearInterval(notifTimer);
    },
  };

  console.log('[parent-control] Supabase service tayyor');
})();
