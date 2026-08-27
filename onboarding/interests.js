/**
 * Interests Form Handler — iframe/popup ikkalasida ishlaydi.
 *
 * MUHIM: iframe file:// alohida origin bo'lgani uchun profileService iframe'da
 * bo'sh bo'lishi mumkin. Parent'ga postMessage orqali ma'lumot uzatiladi.
 */

(function () {
  'use strict';

  const profileServiceLocal = (typeof profileService !== 'undefined' && profileService) ? profileService : null;
  let selectedInterests = [];
  let customInterests = [];

  const FALLBACK_CATEGORIES = {
    technology: [
      { id: 'programming', label: 'Programming' },
      { id: 'cybersecurity', label: 'Cybersecurity' },
      { id: 'technology', label: 'Technology' },
      { id: 'startup', label: 'Startup' },
    ],
    education: [
      { id: 'ielts', label: 'IELTS' },
      { id: 'sat', label: 'SAT' },
      { id: 'mathematics', label: 'Mathematics' },
      { id: 'english', label: 'English' },
      { id: 'science', label: 'Science' },
    ],
    business: [
      { id: 'business', label: 'Business' },
      { id: 'finance', label: 'Finance' },
      { id: 'entrepreneurship', label: 'Entrepreneurship' },
    ],
    wellness: [
      { id: 'sport', label: 'Sport' },
      { id: 'fitness', label: 'Fitness' },
    ],
  };

  const CATEGORIES = (typeof INTERESTS_CATEGORIES !== 'undefined' && INTERESTS_CATEGORIES)
    ? INTERESTS_CATEGORIES
    : FALLBACK_CATEGORIES;

  function postToParent(payload) {
    try {
      if (window.parent && window.parent !== window) {
        window.parent.postMessage(payload, '*');
      }
    } catch {}
    try {
      if (window.opener && typeof window.opener.postMessage === 'function') {
        window.opener.postMessage(payload, '*');
      }
    } catch {}
  }

  function boot() {
    const container = document.getElementById('categoriesContainer');
    const closeBtn = document.getElementById('closeBtn');
    const backBtn = document.getElementById('backBtn');
    const finishBtn = document.getElementById('finishBtn');
    const selectedCountEl = document.getElementById('selectedCount');
    const pluralS = document.getElementById('pluralS');

    if (!container || !finishBtn) {
      console.error('Interests: kerakli HTML elementlari topilmadi');
      return;
    }

    // 1. Iframe'ning o'zining profileService'idan olishga urinamiz
    if (profileServiceLocal) {
      try {
        selectedInterests = [...(profileServiceLocal.getInterests() || [])];
      } catch {}
    }
    splitCustom();
    renderCategories();
    updateCounter();

    // 2. Parent'dan interests so'raymiz (agar bo'sh bo'lsa yoki yangilangan bo'lsa)
    postToParent({ type: 'REQUEST_INTERESTS' });

    // Parent javob berganda
    window.addEventListener('message', function (e) {
      const d = e.data;
      if (!d || typeof d !== 'object') return;
      if (d.type === 'INTERESTS_RESPONSE' && Array.isArray(d.interests)) {
        selectedInterests = d.interests.slice();
        splitCustom();
        renderCategories();
        updateCounter();
      }
    });

    function splitCustom() {
      const allPredefinedIds = new Set();
      for (const list of Object.values(CATEGORIES)) {
        for (const it of list) allPredefinedIds.add(it.id);
      }
      customInterests = selectedInterests
        .filter(id => !allPredefinedIds.has(id))
        .map(id => ({
          id,
          label: id.startsWith('custom_')
            ? id.slice(7).replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
            : id.charAt(0).toUpperCase() + id.slice(1).replace(/_/g, ' '),
        }));
    }

    function renderCategories() {
      container.innerHTML = '';
      for (const [categoryName, interests] of Object.entries(CATEGORIES)) {
        const categoryTitle = categoryName.charAt(0).toUpperCase() + categoryName.slice(1);
        const categoryDiv = document.createElement('div');
        categoryDiv.className = 'category';

        const titleDiv = document.createElement('div');
        titleDiv.className = 'category-title';
        titleDiv.textContent = '🎯 ' + categoryTitle;

        const gridDiv = document.createElement('div');
        gridDiv.className = 'interests-grid';
        interests.forEach(function (interest) {
          gridDiv.appendChild(makeInterestItem(interest, false));
        });

        categoryDiv.appendChild(titleDiv);
        categoryDiv.appendChild(gridDiv);
        container.appendChild(categoryDiv);
      }

      // Custom category
      const customDiv = document.createElement('div');
      customDiv.className = 'category';

      const customTitle = document.createElement('div');
      customTitle.className = 'category-title';
      customTitle.textContent = '✨ Sizning qiziqishlaringiz';
      customDiv.appendChild(customTitle);

      const customGrid = document.createElement('div');
      customGrid.className = 'interests-grid';
      customInterests.forEach(function (it) { customGrid.appendChild(makeInterestItem(it, true)); });
      customDiv.appendChild(customGrid);

      const inputWrap = document.createElement('div');
      inputWrap.style.cssText = 'display:flex;gap:8px;margin-top:10px';

      const input = document.createElement('input');
      input.type = 'text';
      input.placeholder = 'Yangi qiziqish yozing (masalan: Design)';
      input.style.cssText = 'flex:1;background:#1A2235;border:1px solid #1E2D45;border-radius:8px;padding:10px 12px;color:#E8F0FE;font-size:13px;font-family:inherit;outline:none';
      input.onfocus = function () { input.style.borderColor = '#00E5A0'; };
      input.onblur = function () { input.style.borderColor = '#1E2D45'; };

      const addBtn = document.createElement('button');
      addBtn.textContent = "+ Qo'shish";
      addBtn.type = 'button';
      addBtn.style.cssText = 'padding:10px 14px;background:linear-gradient(135deg,#00E5A0,#00C885);color:#0A0E1A;border:none;border-radius:8px;cursor:pointer;font-size:12px;font-weight:700;font-family:inherit;flex:0 0 auto';

      function addCustom() {
        const raw = input.value.trim();
        if (!raw) return;
        if (raw.length > 40) { alert('Juda uzun (max 40 belgi)'); return; }
        const id = 'custom_' + raw.toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '');
        if (customInterests.some(function (x) { return x.id === id; }) || selectedInterests.indexOf(id) >= 0) {
          input.value = '';
          return;
        }
        customInterests.push({ id: id, label: raw });
        selectedInterests.push(id);
        input.value = '';
        renderCategories();
        updateCounter();
      }
      addBtn.onclick = addCustom;
      input.onkeydown = function (e) { if (e.key === 'Enter') { e.preventDefault(); addCustom(); } };

      inputWrap.appendChild(input);
      inputWrap.appendChild(addBtn);
      customDiv.appendChild(inputWrap);
      container.appendChild(customDiv);
    }

    function makeInterestItem(interest, isCustom) {
      const itemDiv = document.createElement('div');
      itemDiv.className = 'interest-item';

      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.value = interest.id;
      checkbox.id = 'interest-' + interest.id;
      checkbox.checked = selectedInterests.indexOf(interest.id) >= 0;

      const label = document.createElement('label');
      label.htmlFor = 'interest-' + interest.id;
      label.textContent = interest.label;

      checkbox.addEventListener('change', function (e) {
        if (e.target.checked) {
          if (selectedInterests.indexOf(e.target.value) < 0) selectedInterests.push(e.target.value);
        } else {
          selectedInterests = selectedInterests.filter(function (i) { return i !== e.target.value; });
        }
        updateCounter();
      });

      itemDiv.appendChild(checkbox);
      itemDiv.appendChild(label);

      if (isCustom) {
        const rm = document.createElement('button');
        rm.textContent = '×';
        rm.type = 'button';
        rm.style.cssText = 'background:transparent;border:none;color:#FF4757;cursor:pointer;font-size:16px;padding:0 4px;font-family:inherit';
        rm.onclick = function (e) {
          e.stopPropagation();
          customInterests = customInterests.filter(function (x) { return x.id !== interest.id; });
          selectedInterests = selectedInterests.filter(function (id) { return id !== interest.id; });
          renderCategories();
          updateCounter();
        };
        itemDiv.appendChild(rm);
      }
      return itemDiv;
    }

    function updateCounter() {
      selectedCountEl.textContent = selectedInterests.length;
      pluralS.textContent = selectedInterests.length === 1 ? '' : 's';
    }

    closeBtn && closeBtn.addEventListener('click', function () {
      postToParent({ type: 'CLOSE_MODAL' });
      try { window.close(); } catch {}
    });

    backBtn && backBtn.addEventListener('click', function () {
      postToParent({ type: 'ONBOARDING_BACK' });
      try { window.close(); } catch {}
    });

    finishBtn.addEventListener('click', function () {
      // 1) Iframe o'zining profileService orqali ham saqlashga urinadi
      if (profileServiceLocal) {
        try {
          profileServiceLocal.saveInterests(selectedInterests);
        } catch {}
      }
      // 2) Parent'ga uzatamiz — u localStorage + Firestore'ga saqlaydi
      postToParent({ type: 'SAVE_INTERESTS', interests: selectedInterests });
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
