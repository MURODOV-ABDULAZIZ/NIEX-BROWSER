/**
 * Parent Control UI logic
 */
(function () {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const svc = window.parentControl;
  const profileSvc = window.profileService;

  let currentFilter = 'all';
  let allNotifications = [];
  let pendingChildEmail = null;

  // ============================================================
  // ROLE CHECK — olib tashlandi.
  // Har qanday foydalanuvchi farzand qo'sha oladi (parent/child/student/user).
  // ============================================================
  function checkRole() {
    $('not-parent').style.display = 'none';
    $('parent-content').style.display = 'block';
    return true;
  }

  // ============================================================
  // CHILDREN LIST
  // ============================================================
  function renderChildren(list) {
    const container = $('children-list');
    const empty = $('children-empty');
    if (!list || list.length === 0) {
      container.innerHTML = '';
      empty.style.display = 'block';
      return;
    }
    empty.style.display = 'none';
    container.innerHTML = list.map(c => {
      const name = c.childName || c.childEmail || '?';
      const initial = String(name).charAt(0).toUpperCase();
      const isActive = c.status === 'active';
      return `
        <div class="child-row">
          <div class="child-avatar">${initial}</div>
          <div class="child-info">
            <div class="child-name">${escapeHtml(name)}</div>
            <div class="child-email">${escapeHtml(c.childEmail || '')}</div>
          </div>
          <div class="status-badge ${isActive ? 'status-active' : 'status-pending'}">${isActive ? 'FAOL' : 'KUTILMOQDA'}</div>
          <button class="btn-danger" onclick="removeChild('${c.childUid}', '${escapeHtml(name)}')">O'chirish</button>
        </div>
      `;
    }).join('');
  }

  window.removeChild = async function (childUid, name) {
    if (!confirm(`${name} olib tashlansinmi?`)) return;
    const r = await svc.removeChild(childUid);
    if (!r.ok) alert('Xato: ' + r.error);
    // Real-time listener avtomatik yangilaydi
  };

  // ============================================================
  // NOTIFICATIONS
  // ============================================================
  function renderNotifications() {
    const list = currentFilter === 'unread'
      ? allNotifications.filter(x => !x.read)
      : allNotifications;
    const container = $('notif-list');
    const empty = $('notif-empty');

    if (!list.length) {
      container.innerHTML = '';
      empty.style.display = 'block';
      return;
    }
    empty.style.display = 'none';

    container.innerHTML = list.map(n => {
      const icon = categoryIcon(n.category);
      const time = formatDate(n.createdAt);
      return `
        <div class="notif-item ${n.read ? '' : 'unread'}" data-id="${n.id}">
          <div class="notif-icon">${icon}</div>
          <div class="notif-body">
            <div class="notif-title">${escapeHtml(n.childName || 'Farzand')} bloklangan kontent qidirishga urindi</div>
            ${n.searchQuery ? `<div class="notif-query">🔍 "${escapeHtml(n.searchQuery)}"</div>` : ''}
            ${n.url ? `<div class="notif-query">🔗 ${escapeHtml(String(n.url).slice(0, 80))}</div>` : ''}
            <div class="notif-meta">${categoryLabel(n.category)} • ${escapeHtml(n.browser || 'SafeNet')} • ${time}</div>
          </div>
          ${n.read ? '' : '<button class="btn-ghost" style="padding:4px 10px;font-size:11px" onclick="markRead(\'' + n.id + '\')">O\'qildi</button>'}
        </div>
      `;
    }).join('');
  }

  window.markRead = async function (id) {
    await svc.markNotificationRead(id);
    // Real-time listener yangilaydi
  };

  function categoryIcon(cat) {
    const map = {
      pornography: '🔞',
      gambling: '🎰',
      drugs: '💊',
      violence: '⚠️',
      unknown: '🛡️',
    };
    return map[cat] || '🛡️';
  }
  function categoryLabel(cat) {
    const map = {
      pornography: 'Pornografiya',
      gambling: 'Qimor',
      drugs: 'Giyohvandlik',
      violence: 'Zo\'ravonlik',
      unknown: 'Aniqlanmagan',
    };
    return map[cat] || cat || 'Aniqlanmagan';
  }
  function formatDate(ts) {
    try {
      const d = ts?.toDate ? ts.toDate() : new Date(ts);
      const diff = Date.now() - d.getTime();
      if (diff < 60_000) return 'hozir';
      if (diff < 3600_000) return Math.floor(diff / 60_000) + ' daq oldin';
      if (diff < 86400_000) return Math.floor(diff / 3600_000) + ' soat oldin';
      return d.toLocaleString('uz-UZ');
    } catch { return ''; }
  }
  function escapeHtml(s) {
    return String(s || '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  }

  // ============================================================
  // ADD CHILD MODAL
  // ============================================================
  window.closeAddModal = function () {
    $('add-modal').classList.remove('show');
    $('step-email').style.display = 'block';
    $('step-code').style.display = 'none';
    $('child-email').value = '';
    $('verify-code').value = '';
    $('email-msg').innerHTML = '';
    $('code-msg').innerHTML = '';
    pendingChildEmail = null;
  };

  window.backToEmail = function () {
    $('step-email').style.display = 'block';
    $('step-code').style.display = 'none';
    $('code-msg').innerHTML = '';
  };

  function showMsg(container, text, type = 'error') {
    container.innerHTML = `<div class="msg msg-${type}">${escapeHtml(text)}</div>`;
  }

  $('add-child-btn').addEventListener('click', () => {
    $('add-modal').classList.add('show');
    setTimeout(() => $('child-email').focus(), 100);
  });

  $('send-code-btn').addEventListener('click', async () => {
    const email = $('child-email').value.trim();
    $('email-msg').innerHTML = '';
    if (!email || !/@/.test(email)) {
      showMsg($('email-msg'), 'To\'g\'ri email kiriting');
      return;
    }
    $('send-code-btn').disabled = true;
    $('send-code-btn').textContent = 'Yuborilmoqda...';
    const r = await svc.requestAddChild(email);
    $('send-code-btn').disabled = false;
    $('send-code-btn').textContent = 'Kod yuborish';

    if (!r.ok) {
      showMsg($('email-msg'), r.error + (r.hint ? '\n' + r.hint : ''));
      return;
    }
    pendingChildEmail = email;
    $('code-sent-to').textContent = email;
    $('step-email').style.display = 'none';
    $('step-code').style.display = 'block';
    if (r.code) {
      $('verify-code').value = r.code;
      showMsg($('code-msg'), 'Kod: ' + r.code + ' — farzandingizga ulashing yoki darhol tasdiqlang.', 'info');
    } else {
      showMsg($('code-msg'), r.message, 'info');
    }
    setTimeout(() => $('verify-code').focus(), 100);
  });

  $('verify-code-btn').addEventListener('click', async () => {
    const code = $('verify-code').value.trim();
    $('code-msg').innerHTML = '';
    if (!/^\d{6}$/.test(code)) {
      showMsg($('code-msg'), '6 xonali kod kiriting');
      return;
    }
    $('verify-code-btn').disabled = true;
    $('verify-code-btn').textContent = 'Tekshirilmoqda...';
    const r = await svc.verifyAddChild(pendingChildEmail, code);
    $('verify-code-btn').disabled = false;
    $('verify-code-btn').textContent = 'Tasdiqlash';

    if (!r.ok) {
      showMsg($('code-msg'), r.error);
      return;
    }
    showMsg($('code-msg'), r.message, 'success');
    setTimeout(() => window.closeAddModal(), 1400);
  });

  $('verify-code').addEventListener('input', (e) => {
    e.target.value = e.target.value.replace(/\D/g, '');
  });

  document.querySelectorAll('.notif-tab').forEach(t => {
    t.addEventListener('click', () => {
      document.querySelectorAll('.notif-tab').forEach(x => x.classList.remove('active'));
      t.classList.add('active');
      currentFilter = t.dataset.filter;
      renderNotifications();
    });
  });

  // ============================================================
  // AUTH SYNC — main process'dan auth olish (alohida BrowserWindow)
  // ============================================================
  async function syncAuthFromMainProcess() {
    try { if (firebase.auth().currentUser) return; } catch {}
    try {
      const raw = localStorage.getItem('sn_user');
      if (raw && JSON.parse(raw).uid) return;
    } catch {}

    if (!window.safenet_auth || typeof window.safenet_auth.getCredentials !== 'function') return;

    try {
      const creds = await window.safenet_auth.getCredentials();
      if (creds && creds.profile) {
        const p = creds.profile;
        const user = {
          uid: p.sub || p.uid || p.email,
          email: p.email || '',
          name: p.name || p.displayName || '',
        };
        localStorage.setItem('sn_user', JSON.stringify(user));

        if (creds.idToken && typeof firebase !== 'undefined') {
          try {
            const credential = firebase.auth.GoogleAuthProvider.credential(creds.idToken);
            await firebase.auth().signInWithCredential(credential);
          } catch (e) { console.warn('[parent-control] Firebase sign-in:', e.message); }
        }
      }
    } catch (e) { console.warn('[parent-control] auth sync:', e); }
  }

  // ============================================================
  // BOOT
  // ============================================================
  function boot() {
    if (!checkRole()) return;

    svc.subscribeChildren(renderChildren);

    svc.subscribeNotifications(({ list, unread }) => {
      allNotifications = list;
      const badge = $('notif-badge');
      if (unread > 0) {
        badge.textContent = unread + ' yangi';
        badge.style.display = 'inline-block';
      } else {
        badge.style.display = 'none';
      }
      renderNotifications();
    });
  }

  const waitBoot = setInterval(async () => {
    if (window.parentControl && window.profileService && window.firebase) {
      clearInterval(waitBoot);
      await syncAuthFromMainProcess();
      boot();
    }
  }, 100);
  setTimeout(() => clearInterval(waitBoot), 8000);
})();
