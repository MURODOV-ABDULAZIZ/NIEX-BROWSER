/**
 * SafeNet Parent Control Service (renderer-side)
 * ================================================
 *
 * Renderer kontekstida ishlaydi. Firebase Web SDK v9+ compat rejimida
 * (safenethome.html allaqachon `firebase` global ishlatadi).
 *
 * Responsibility'lar:
 *   - Parent → Child linking (email orqali qidirish, verification code)
 *   - Notification create/list/mark-read
 *   - Real-time listener'lar (Firestore onSnapshot)
 *   - Child tomonda bloklangan kontent notification'i yaratish
 *
 * BOG'LIQLIK: window.firebase (compat mode)
 *             window.profileService (mavjud auth)
 */

(function () {
  'use strict';

  // ============================================================
  // UTILS
  // ============================================================
  function generateCode() {
    return String(Math.floor(100000 + Math.random() * 900000));
  }

  function emailToKey(email) {
    return String(email).toLowerCase().trim().replace(/[^a-z0-9]/g, '_');
  }

  function now() {
    return new Date();
  }

  function nowISO() {
    return new Date().toISOString();
  }

  // ============================================================
  // SERVICE
  // ============================================================
  class ParentControlService {
    constructor() {
      this._notificationListener = null;
      this._childrenListener = null;
      this._onNotificationCb = null;
      this._onChildrenCb = null;
    }

    _db() {
      if (typeof firebase === 'undefined' || !firebase || typeof firebase.firestore !== 'function') {
        throw new Error('Firebase Firestore mavjud emas. safenethome.html Firebase compat SDK yuklaganini tekshiring.');
      }
      return firebase.firestore();
    }

    _currentUser() {
      // 1. Firebase Auth current user (agar Google login ishlatilgan bo'lsa)
      try {
        const u = firebase.auth().currentUser;
        if (u && u.uid) return { uid: u.uid, email: u.email };
      } catch {}
      // 2. Fallback — localStorage sn_user (mavjud tizim)
      try {
        const raw = localStorage.getItem('sn_user');
        if (raw) {
          const u = JSON.parse(raw);
          if (u && (u.uid || u.email)) return { uid: u.uid || u.email, email: u.email };
        }
      } catch {}
      return null;
    }

    // ============================================================
    // USERS BY EMAIL INDEX
    // Har foydalanuvchi ro'yxatdan o'tganda emailByUid yozadi
    // (parent child'ni email orqali qidira olishi uchun)
    // ============================================================
    async registerEmailIndex() {
      const u = this._currentUser();
      if (!u || !u.email) return false;
      const key = emailToKey(u.email);
      try {
        await this._db().collection('usersByEmail').doc(key).set({
          email: u.email.toLowerCase(),
          uid: u.uid,
          updatedAt: now(),
        }, { merge: true });
        return true;
      } catch (e) {
        console.warn('[parent-control] registerEmailIndex:', e);
        return false;
      }
    }

    async findUserByEmail(email) {
      if (!email) return null;
      const key = emailToKey(email);
      try {
        const doc = await this._db().collection('usersByEmail').doc(key).get();
        if (!doc.exists) return null;
        const d = doc.data();
        // Full user'ni ham olamiz (ism/rol uchun)
        const userDoc = await this._db().collection('users').doc(d.uid).get();
        return {
          uid: d.uid,
          email: d.email,
          firstName: userDoc.exists ? userDoc.data().firstName : '',
          lastName: userDoc.exists ? userDoc.data().lastName : '',
          role: userDoc.exists ? userDoc.data().role : '',
        };
      } catch (e) {
        console.warn('[parent-control] findUserByEmail:', e);
        return null;
      }
    }

    // ============================================================
    // ADD CHILD (parent operatsiyasi)
    // ============================================================
    /**
     * @param {string} childEmail
     * @returns {Promise<{ok, error?, verificationCodeId?, message?}>}
     */
    async requestAddChild(childEmail) {
      const parent = this._currentUser();
      if (!parent) return { ok: false, error: 'Avval tizimga kiring.' };
      if (!childEmail || !/@/.test(childEmail)) return { ok: false, error: 'To\'g\'ri email kiriting.' };
      if (childEmail.toLowerCase() === (parent.email || '').toLowerCase()) {
        return { ok: false, error: 'O\'zingizni farzand sifatida qo\'sha olmaysiz.' };
      }

      // 1. Child mavjudmi tekshirish
      const child = await this.findUserByEmail(childEmail);
      if (!child) {
        return {
          ok: false,
          error: 'Bu email bilan foydalanuvchi topilmadi.',
          hint: 'Farzand avval NIEX Browser\'ga ro\'yxatdan o\'tishi kerak.',
        };
      }

      // 2. Mavjud relationship bormi
      const relId = `${parent.uid}_${child.uid}`;
      const existing = await this._db().collection('relationships').doc(relId).get();
      if (existing.exists) {
        const status = existing.data().status;
        if (status === 'active') return { ok: false, error: 'Ushbu farzand allaqachon ulangan.' };
        if (status === 'pending') return { ok: true, message: 'Kod allaqachon yuborilgan, farzand emailini tekshirsin.', existing: true };
      }

      // 3. Verification code yaratish
      const code = generateCode();
      const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 daqiqa
      let codeDocRef;
      try {
        codeDocRef = await this._db().collection('verificationCodes').add({
          code,
          parentUid: parent.uid,
          parentEmail: parent.email,
          childUid: child.uid,
          childEmail: child.email,
          childName: [child.firstName, child.lastName].filter(Boolean).join(' ') || child.email,
          expiresAt,
          used: false,
          createdAt: now(),
        });
      } catch (e) {
        return { ok: false, error: 'Kod yaratilmadi: ' + e.message };
      }

      // 4. Pending relationship
      try {
        await this._db().collection('relationships').doc(relId).set({
          parentUid: parent.uid,
          parentEmail: parent.email,
          childUid: child.uid,
          childEmail: child.email,
          childName: [child.firstName, child.lastName].filter(Boolean).join(' ') || child.email,
          status: 'pending',
          createdAt: now(),
        });
      } catch (e) {
        return { ok: false, error: 'Relationship yaratilmadi: ' + e.message };
      }

      // 5. Email yuborish signali
      // Firebase Extension "Trigger Email" collection'i yoki Cloud Function ishlaydi.
      // Bu erda `mail` collection'iga hujjat qo'shamiz — Extension avtomatik email yuboradi.
      try {
        await this._db().collection('mail').add({
          to: [child.email],
          message: {
            subject: 'NIEX: Ota-ona nazorati so\'rovi',
            html: this._verificationEmailHtml(parent, child, code),
            text: `Sizning ota-onangiz (${parent.email}) NIEX Browser'da ota-ona nazoratini ulashga urinmoqda. Tasdiqlash kodi: ${code}\n\nKod 10 daqiqa amal qiladi.`,
          },
        });
      } catch (e) {
        console.warn('[parent-control] mail queue failed:', e);
        // Email queue muvaffaqiyatsiz — lekin kod yaratildi. Foydalanuvchiga ko'rsatamiz.
      }

      return {
        ok: true,
        verificationCodeId: codeDocRef.id,
        code,
        message: `Tasdiqlash kodi ${child.email} manziliga yuborildi. Kod 10 daqiqa amal qiladi.`,
        child,
      };
    }

    _verificationEmailHtml(parent, child, code) {
      const parentName = parent.email || 'Ota-ona';
      return `<!DOCTYPE html><html><body style="font-family:system-ui;background:#f4f6f8;padding:24px">
<div style="max-width:520px;margin:auto;background:#fff;border-radius:12px;padding:32px">
  <div style="font-size:22px;font-weight:800;color:#0F1623;margin-bottom:8px">🛡️ NIEX Browser</div>
  <div style="font-size:14px;color:#4a5568;margin-bottom:20px">Ota-ona nazorati so'rovi</div>
  <p style="font-size:14px;line-height:1.6;color:#0F1623">Salom,</p>
  <p style="font-size:14px;line-height:1.6;color:#0F1623">
    <strong>${parentName}</strong> sizning NIEX Browser hisobingizni ota-ona nazorati ostiga olishga urinmoqda.
    Agar bu haqiqatan sizning ota-onangiz bo'lsa, quyidagi kodni unga bering:
  </p>
  <div style="text-align:center;margin:24px 0;padding:20px;background:#f4f6f8;border-radius:10px">
    <div style="font-size:36px;font-weight:900;letter-spacing:8px;color:#00C885;font-family:monospace">${code}</div>
    <div style="font-size:11px;color:#4a5568;margin-top:8px">Kod 10 daqiqa amal qiladi</div>
  </div>
  <p style="font-size:13px;color:#4a5568;line-height:1.6">
    Agar bu so'rov sizga notanish bo'lsa, uni e'tiborsiz qoldiring. Sizning hisobingiz xavfsiz.
  </p>
  <div style="border-top:1px solid #e2e8f0;margin-top:24px;padding-top:16px;font-size:11px;color:#94a3b8;text-align:center">
    NIEX Ecosystem
  </div>
</div></body></html>`;
    }

    /**
     * Parent tomonidan child qo'shishni tasdiqlash — kod kiritish
     */
    async verifyAddChild(childEmail, code) {
      const parent = this._currentUser();
      if (!parent) return { ok: false, error: 'Avval tizimga kiring.' };
      if (!code || !/^\d{6}$/.test(code)) return { ok: false, error: '6 xonali kod kiriting.' };

      // Kodni topamiz
      try {
        const snap = await this._db().collection('verificationCodes')
          .where('parentUid', '==', parent.uid)
          .where('childEmail', '==', String(childEmail).toLowerCase())
          .where('code', '==', code)
          .where('used', '==', false)
          .limit(1).get();

        if (snap.empty) return { ok: false, error: 'Kod noto\'g\'ri yoki muddati o\'tgan.' };

        const doc = snap.docs[0];
        const d = doc.data();
        const expiresAt = d.expiresAt?.toDate ? d.expiresAt.toDate() : new Date(d.expiresAt);
        if (expiresAt < new Date()) return { ok: false, error: 'Kod muddati tugagan. Qayta so\'rov yuboring.' };

        // Relationship'ni faollashtiramiz
        const relId = `${d.parentUid}_${d.childUid}`;
        await this._db().collection('relationships').doc(relId).update({
          status: 'active',
          activatedAt: now(),
        });

        // Kodni ishlatilgan deb belgilash
        await doc.ref.update({ used: true, usedAt: now() });

        return { ok: true, message: `${d.childName} muvaffaqiyatli ulandi.`, child: { uid: d.childUid, email: d.childEmail, name: d.childName } };
      } catch (e) {
        return { ok: false, error: 'Tasdiqlash xatosi: ' + e.message };
      }
    }

    // ============================================================
    // LIST CHILDREN
    // ============================================================
    async listChildren() {
      const parent = this._currentUser();
      if (!parent) return [];
      try {
        const snap = await this._db().collection('relationships')
          .where('parentUid', '==', parent.uid)
          .get();
        return snap.docs.map(d => ({ id: d.id, ...d.data() }));
      } catch (e) {
        console.warn('[parent-control] listChildren:', e);
        return [];
      }
    }

    async removeChild(childUid) {
      const parent = this._currentUser();
      if (!parent) return { ok: false, error: 'Avval tizimga kiring.' };
      const relId = `${parent.uid}_${childUid}`;
      try {
        await this._db().collection('relationships').doc(relId).delete();
        return { ok: true };
      } catch (e) {
        return { ok: false, error: e.message };
      }
    }

    // ============================================================
    // NOTIFICATIONS
    // ============================================================
    async listNotifications({ unreadOnly = false, limit = 50 } = {}) {
      const user = this._currentUser();
      if (!user) return [];
      try {
        let q = this._db().collection('notifications')
          .where('parentUid', '==', user.uid)
          .orderBy('createdAt', 'desc')
          .limit(limit);
        if (unreadOnly) q = q.where('read', '==', false);
        const snap = await q.get();
        return snap.docs.map(d => ({ id: d.id, ...d.data() }));
      } catch (e) {
        console.warn('[parent-control] listNotifications:', e);
        return [];
      }
    }

    async markNotificationRead(notifId) {
      try {
        await this._db().collection('notifications').doc(notifId).update({ read: true, readAt: now() });
        return { ok: true };
      } catch (e) {
        return { ok: false, error: e.message };
      }
    }

    /**
     * Child tomonda chaqiriladi. Bloklangan qidiruv/URL uchun har active parent'ga notification yuboradi.
     */
    async reportBlockedContent({ category, searchQuery, url, device, browser, reason }) {
      const child = this._currentUser();
      if (!child) return { ok: false, error: 'Not signed in' };

      // Child o'z parent(lar)ini topadi
      let parents = [];
      try {
        const snap = await this._db().collection('relationships')
          .where('childUid', '==', child.uid)
          .where('status', '==', 'active')
          .get();
        parents = snap.docs.map(d => d.data());
      } catch (e) {
        console.warn('[parent-control] reportBlockedContent parents:', e);
        return { ok: false, error: e.message };
      }

      if (!parents.length) return { ok: true, sent: 0 };

      // Child ismini olamiz
      let childName = child.email;
      try {
        const uDoc = await this._db().collection('users').doc(child.uid).get();
        if (uDoc.exists) {
          const u = uDoc.data();
          childName = [u.firstName, u.lastName].filter(Boolean).join(' ') || u.email || child.email;
        }
      } catch {}

      // Har parent uchun notification yaratamiz
      let sent = 0;
      for (const p of parents) {
        try {
          await this._db().collection('notifications').add({
            parentUid: p.parentUid,
            childUid: child.uid,
            childName,
            childEmail: child.email,
            category: category || 'unknown',
            searchQuery: searchQuery || '',
            url: (url || '').slice(0, 500),
            reason: (reason || '').slice(0, 200),
            device: device || navigator.platform || 'unknown',
            browser: browser || 'SafeNet',
            createdAt: now(),
            read: false,
          });
          sent++;
        } catch (e) {
          console.warn('[parent-control] notification create failed:', e);
        }
      }
      return { ok: true, sent };
    }

    // ============================================================
    // REAL-TIME LISTENERS
    // ============================================================
    subscribeNotifications(cb) {
      const parent = this._currentUser();
      if (!parent) return;
      if (this._notificationListener) this._notificationListener();
      this._onNotificationCb = cb;
      try {
        this._notificationListener = this._db().collection('notifications')
          .where('parentUid', '==', parent.uid)
          .orderBy('createdAt', 'desc')
          .limit(50)
          .onSnapshot(snap => {
            const list = snap.docs.map(d => ({ id: d.id, ...d.data() }));
            const unread = list.filter(x => !x.read).length;
            cb({ list, unread });
          }, err => console.warn('[parent-control] notif listener:', err));
      } catch (e) {
        console.warn('[parent-control] subscribeNotifications:', e);
      }
    }

    subscribeChildren(cb) {
      const parent = this._currentUser();
      if (!parent) return;
      if (this._childrenListener) this._childrenListener();
      this._onChildrenCb = cb;
      try {
        this._childrenListener = this._db().collection('relationships')
          .where('parentUid', '==', parent.uid)
          .onSnapshot(snap => {
            cb(snap.docs.map(d => ({ id: d.id, ...d.data() })));
          }, err => console.warn('[parent-control] children listener:', err));
      } catch (e) {
        console.warn('[parent-control] subscribeChildren:', e);
      }
    }

    unsubscribeAll() {
      if (this._notificationListener) { try { this._notificationListener(); } catch {} this._notificationListener = null; }
      if (this._childrenListener) { try { this._childrenListener(); } catch {} this._childrenListener = null; }
    }
  }

  const service = new ParentControlService();
  window.ParentControlService = ParentControlService;
  window.parentControl = service;

  // Auto-register email index for signed-in users
  if (typeof firebase !== 'undefined' && firebase && firebase.auth) {
    try {
      firebase.auth().onAuthStateChanged(u => {
        if (u) service.registerEmailIndex().catch(() => {});
      });
    } catch {}
  }
})();
