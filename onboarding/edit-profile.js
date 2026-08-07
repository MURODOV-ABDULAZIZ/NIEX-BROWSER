/**
 * Edit Profile Handler — iframe/popup ikkalasida ishlaydi.
 *
 * MUHIM: iframe file:// alohida origin bo'lgani uchun localStorage yoki
 * profileService iframe ichida bo'sh bo'lishi mumkin. Shuning uchun:
 *   1. Parent'dan boshlang'ich profile ma'lumotlarini so'raymiz (PROFILE_REQUEST)
 *   2. Save keyin ma'lumotlarni parent'ga postMessage orqali uzatamiz (SAVE_PROFILE)
 *   3. Parent o'z profileService orqali saqlaydi va modal yopadi
 */

(function () {
  'use strict';

  let currentProfile = {};
  let currentInterests = [];
  const profileServiceLocal = (typeof profileService !== 'undefined' && profileService) ? profileService : null;

  function postToParent(payload) {
    let sent = false;
    try {
      if (window.parent && window.parent !== window) {
        window.parent.postMessage(payload, '*');
        sent = true;
      }
    } catch (e) { console.warn('postToParent (parent):', e); }
    try {
      if (window.opener && typeof window.opener.postMessage === 'function') {
        window.opener.postMessage(payload, '*');
        sent = true;
      }
    } catch (e) { console.warn('postToParent (opener):', e); }
    return sent;
  }

  function boot() {
    const closeBtn = document.getElementById('closeBtn');
    const cancelBtn = document.getElementById('cancelBtn');
    const saveBtn = document.getElementById('saveBtn');
    const editInterestsBtn = document.getElementById('editInterestsBtn');
    const interestsPreview = document.getElementById('interestsPreview');
    const roleEl = document.getElementById('role');
    const firstNameEl = document.getElementById('firstName');
    const lastNameEl = document.getElementById('lastName');
    const ageEl = document.getElementById('age');
    const phoneEl = document.getElementById('phone');
    const emailEl = document.getElementById('email');
    const uidEl = document.getElementById('uid');

    if (!saveBtn) {
      console.error('Edit Profile: saveBtn topilmadi (HTML noto\'g\'ri yuklangan)');
      alert('Sahifa noto\'g\'ri yuklandi. Yopib qayta oching.');
      return;
    }

    // ============================================================
    // 1. Parent'dan profile ma'lumotlarini so'ray (PROFILE_REQUEST)
    // ============================================================
    function fillForm(profile, interests) {
      currentProfile = profile || {};
      currentInterests = Array.isArray(interests) ? interests : [];

      const validRoles = ['parent', 'child', 'student', 'user'];
      const cur = String(currentProfile.role || '').toLowerCase();
      if (roleEl) roleEl.value = validRoles.includes(cur) ? cur : 'user';
      if (firstNameEl) firstNameEl.value = currentProfile.firstName || '';
      if (lastNameEl) lastNameEl.value = currentProfile.lastName || '';
      if (ageEl) ageEl.value = currentProfile.age ?? '';
      if (phoneEl) phoneEl.value = currentProfile.phone || '';
      if (emailEl) emailEl.value = currentProfile.email || '';
      if (uidEl) uidEl.value = currentProfile.uid || '';
      updateInterestsDisplay();
    }

    // Iframe'ning o'z profileService bor bo'lsa — undan olamiz
    if (profileServiceLocal) {
      try {
        const p = profileServiceLocal.getProfile() || {};
        const i = profileServiceLocal.getInterests() || [];
        if (p.uid || p.firstName) fillForm(p, i);
      } catch {}
    }

    // Parent'dan yangilanish so'raymiz (agar iframe'da bo'sh bo'lsa)
    postToParent({ type: 'REQUEST_PROFILE' });

    // Parent javob berganda formni to'ldiramiz
    window.addEventListener('message', function (e) {
      const d = e.data;
      if (!d || typeof d !== 'object') return;
      if (d.type === 'PROFILE_RESPONSE' && d.profile) {
        fillForm(d.profile, d.interests || []);
      } else if (d.type === 'INTERESTS_UPDATED' && Array.isArray(d.interests)) {
        currentInterests = d.interests;
        updateInterestsDisplay();
      }
    });

    // ============================================================
    // 2. Yopish
    // ============================================================
    function closeSelf() {
      postToParent({ type: 'CLOSE_MODAL' });
      try { window.close(); } catch {}
    }
    closeBtn && closeBtn.addEventListener('click', closeSelf);
    cancelBtn && cancelBtn.addEventListener('click', closeSelf);

    // ============================================================
    // 3. Interests edit — parent'ga signal
    // ============================================================
    editInterestsBtn && editInterestsBtn.addEventListener('click', function () {
      postToParent({ type: 'OPEN_INTERESTS_EDITOR', currentInterests: currentInterests });
    });

    // ============================================================
    // 4. Save Changes — parent'ga ma'lumotlarni uzatamiz
    // ============================================================
    saveBtn.addEventListener('click', function () {
      const role = roleEl ? roleEl.value : 'user';
      const firstName = firstNameEl ? firstNameEl.value.trim() : '';
      const lastName = lastNameEl ? lastNameEl.value.trim() : '';
      const phone = phoneEl ? phoneEl.value.trim() : '';
      const ageValue = ageEl ? String(ageEl.value).trim() : '';

      if (!firstName || !lastName) {
        alert('Ism va familiya kiritilishi shart.');
        return;
      }
      const age = Number(ageValue);
      if (!Number.isInteger(age) || age <= 0 || age > 120) {
        alert('Yosh 1-120 oralig\'ida son bo\'lishi kerak.');
        return;
      }

      const payload = {
        firstName: firstName,
        lastName: lastName,
        age: age,
        phone: phone,
        role: role,
        interests: currentInterests,
        email: emailEl ? emailEl.value : (currentProfile.email || ''),
        uid: uidEl ? uidEl.value : (currentProfile.uid || ''),
      };

      // 1) Iframe o'z profileService orqali ham saqlashga urinamiz (agar mavjud bo'lsa)
      if (profileServiceLocal) {
        try {
          profileServiceLocal.saveProfile({
            ...currentProfile,
            ...payload,
            profileCompleted: true,
            updatedAt: new Date().toISOString(),
          });
          profileServiceLocal.savePersonalInfo(payload);
          profileServiceLocal.saveInterests(currentInterests);
        } catch (e) {
          console.warn('Iframe save (uid yo\'q bo\'lishi mumkin):', e.message);
        }
      }

      // 2) Parent'ga ma'lumotni uzatamiz — u o'z localStorage/Firestore'ga saqlaydi
      postToParent({ type: 'SAVE_PROFILE', data: payload });

      // Parent modal yopadi (PROFILE_UPDATED signaliga javoban)
    });

    function updateInterestsDisplay() {
      if (!interestsPreview) return;
      interestsPreview.innerHTML = '';
      if (!currentInterests || currentInterests.length === 0) {
        interestsPreview.innerHTML = '<p style="color:#6B7A99;font-size:12px">Qiziqishlar tanlanmagan</p>';
        return;
      }
      const categories = (typeof INTERESTS_CATEGORIES !== 'undefined' && INTERESTS_CATEGORIES) || {};
      currentInterests.forEach(function (id) {
        let label = id;
        for (const cat of Object.values(categories)) {
          const found = cat.find(function (i) { return i.id === id; });
          if (found) { label = found.label; break; }
        }
        if (id.indexOf('custom_') === 0) {
          label = id.slice(7).replace(/_/g, ' ').replace(/\b\w/g, function (c) { return c.toUpperCase(); });
        }
        const chip = document.createElement('div');
        chip.className = 'interest-chip';
        chip.textContent = label;
        interestsPreview.appendChild(chip);
      });
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
