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
          ${isActive ? `<button class="btn-soft" onclick="viewChildActivity('${escapeHtml(c.childEmail || c.childUid)}', '${escapeHtml(name)}')">📊 Faoliyat</button>` : ''}
          ${isActive ? `<button class="btn-soft" onclick="sendWeeklyReport('${escapeHtml(c.childEmail || c.childUid)}', '${escapeHtml(name)}', this)">📄 Hisobot</button>` : ''}
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

  // Haftalik hisobotni yaratib, ota-onaga yuborish (email + bildirishnoma). One-time test ham shu.
  window.sendWeeklyReport = async function (childEmail, name, btn) {
    const orig = btn ? btn.textContent : '';
    if (btn) { btn.disabled = true; btn.textContent = '⏳...'; }
    let r;
    try { r = await svc.sendWeeklyReport(childEmail); } catch (e) { r = { ok: false, error: e.message }; }
    if (btn) { btn.disabled = false; btn.textContent = orig; }
    if (!r || !r.ok) {
      alert('Hisobot yuborilmadi: ' + ((r && (r.status === 403 ? 'ulanish faol emas' : r.error)) || 'xato'));
      return;
    }
    const d = r.data || {};
    // Natijani CHIROYLI modalда ko'rsatamiz (Activity view kabi) — alert emas.
    const sentBanner = `<div class="msg" style="background:rgba(0,229,160,.1);border:1px solid rgba(0,229,160,.3);color:#00E5A0;padding:10px 14px;border-radius:10px;margin-bottom:14px;font-size:13px">✅ Ota-onaga yuborildi — email + bildirishnoma</div>`;
    $('act-child-name').textContent = '📄 Haftalik hisobot — ' + (name || '');
    if (!d.hasData) {
      $('activity-body').innerHTML = sentBanner + `<div class="empty" style="padding:40px 20px"><div class="empty-icon">📄</div><div style="font-size:14px;margin-bottom:6px">Bu hafta faoliyat maʼlumoti yoʻq</div><div style="font-size:12px">Farzand NIEX brauzeridan foydalansa, keyingi hisobotда koʻrinadi.</div></div>`;
      $('activity-modal').classList.add('show');
      return;
    }
    const platMap = {}; (d.topPlatforms || []).forEach(p => { platMap[p.key] = p.seconds; });
    const catMap = {}; (d.topCategories || []).forEach(p => { catMap[p.key] = p.seconds; });
    const legend = `<div class="act-legend">
      <div class="act-leg"><span class="sw" style="background:#00E5A0"></span><span class="ln">Foydali</span><span class="lv">${fmtSec(d.usefulSeconds)}</span></div>
      <div class="act-leg"><span class="sw" style="background:#FF6B7A"></span><span class="ln">Kam foydali</span><span class="lv">${fmtSec(d.lowValueSeconds)}</span></div>
      <div class="act-leg"><span class="sw" style="background:#7C8AA5"></span><span class="ln">Aniqlanmagan</span><span class="lv">${fmtSec(d.unknownSeconds)}</span></div>
    </div>`;
    let trendChip = '';
    if (d.trend && d.trend.usefulPct != null) {
      const p = d.trend.usefulPct; const cls = p > 0 ? 'up' : (p < 0 ? 'down' : 'flat'); const ar = p > 0 ? '▲' : (p < 0 ? '▼' : '•');
      trendChip = ` <span class="act-trend ${cls}">${ar} foydali ${p >= 0 ? '+' : ''}${p}%</span>`;
    }
    $('activity-body').innerHTML = sentBanner + `
      <div class="act-sec-title">Bu hafta — ${fmtSec(d.totalSeconds)} onlayn</div>
      <div class="act-hero">${donutSvg(d.usefulSeconds, d.lowValueSeconds, d.unknownSeconds)}${legend}</div>
      <div class="act-metrics">
        <div class="act-metric"><div class="mv" style="color:#00E5A0">${fmtSec(d.focusSeconds)}</div><div class="ml">Focus vaqt</div></div>
        <div class="act-metric"><div class="mv">${d.distractionCount || 0}</div><div class="ml">Chalgʻish</div></div>
        <div class="act-metric"><div class="mv">${d.blockedCount || 0}</div><div class="ml">Bloklangan</div></div>
      </div>
      <div class="act-sec-title">Platformalar</div>
      ${brkRows(platMap, platLabel, null, 6)}
      <div class="act-sec-title">Kontent turlari</div>
      ${brkRows(catMap, k => CAT_LABEL2[k] || k, null, 8)}
      <div class="act-sec-title">Haftalik xulosa</div>
      <div style="font-size:12px;color:#4a5568;margin-top:4px">Kunlik oʻrtacha: ${fmtSec(d.dailyAverageSeconds || Math.round((d.totalSeconds || 0) / 7))} · Foydali: ${fmtSec(d.usefulSeconds)} · Focus: ${fmtSec(d.focusSeconds)}${trendChip}</div>
    `;
    $('activity-modal').classList.add('show');
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
  // CHILD ACTIVITY (Activity Intelligence — Parental Control PART 1-4)
  // Backend faqat AGGREGATE qaytaradi (raw history yo'q). Authorization serverda.
  // ============================================================
  const ACT_LABEL = { scrolling: 'Scroll (feed)', video_watching: 'Video ko\'rish', searching: 'Qidiruv', reading: 'O\'qish', chat: 'Suhbat', navigation: 'Navigatsiya', focus_work: 'Focus ish', idle: 'Bo\'sh', blocked_content: 'Bloklangan', unknown: 'Boshqa' };
  const ACT_ICON = { scrolling: '📱', video_watching: '▶️', searching: '🔍', reading: '📖', chat: '💬', navigation: '🧭', focus_work: '🎯', idle: '⏸️', blocked_content: '🛡️', unknown: '•' };
  const CAT_LABEL2 = { education: 'Ta\'lim', programming: 'Dasturlash', technology: 'Texnologiya', science: 'Fan', research: 'Izlanish', news: 'Yangiliklar', productivity: 'Samaradorlik', entertainment: 'Ko\'ngilochar', gaming: 'O\'yin', shortform_video: 'Qisqa video', podcast: 'Podkast', social_media: 'Ijtimoiy tarmoq', communication: 'Aloqa', sports: 'Sport', shopping: 'Xarid', other: 'Boshqa' };
  function fmtSec(sec) { const m = Math.round((Number(sec) || 0) / 60); if (m < 60) return m + ' daq'; const h = Math.floor(m / 60), mm = m % 60; return mm ? `${h} soat ${mm} daq` : `${h} soat`; }
  function platLabel(k) { return k ? String(k).charAt(0).toUpperCase() + String(k).slice(1) : 'Boshqa'; }
  function dateKey(ts) { const d = new Date(ts); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; }
  function weekStartKey(ts) { const d = new Date(ts); d.setHours(0, 0, 0, 0); const dow = (d.getDay() + 6) % 7; d.setDate(d.getDate() - dow); return dateKey(d.getTime()); }

  function mergeMap(a, b) { const o = { ...(a || {}) }; for (const k in (b || {})) o[k] = (o[k] || 0) + (b[k] || 0); return o; }
  function sumDays(days) {
    const a = { totalSeconds: 0, focusSeconds: 0, usefulSeconds: 0, lowValueSeconds: 0, unknownSeconds: 0, distractionCount: 0, blockedCount: 0, byType: {}, byPlatform: {}, byCategory: {} };
    for (const d of days || []) {
      a.totalSeconds += d.totalSeconds || 0; a.focusSeconds += d.focusSeconds || 0;
      a.usefulSeconds += d.usefulSeconds || 0; a.lowValueSeconds += d.lowValueSeconds || 0; a.unknownSeconds += d.unknownSeconds || 0;
      a.distractionCount += d.distractionCount || 0; a.blockedCount += d.blockedCount || 0;
      a.byType = mergeMap(a.byType, d.byType); a.byPlatform = mergeMap(a.byPlatform, d.byPlatform); a.byCategory = mergeMap(a.byCategory, d.byCategory);
    }
    return a;
  }
  function donutSvg(useful, low, unknown) {
    const total = (useful + low + unknown) || 0;
    const R = 54, C = 2 * Math.PI * R;
    let off = 0, arcs = '';
    if (total > 0) [[useful, '#00E5A0'], [low, '#FF6B7A'], [unknown, '#7C8AA5']].forEach(([v, col]) => {
      const len = (v / total) * C;
      if (len > 0.5) arcs += `<circle cx="66" cy="66" r="${R}" fill="none" stroke="${col}" stroke-width="16" stroke-dasharray="${len.toFixed(2)} ${(C - len).toFixed(2)}" stroke-dashoffset="${(-off).toFixed(2)}"/>`;
      off += len;
    });
    const pct = total > 0 ? Math.round((useful / total) * 100) : 0;
    return `<div class="act-donut"><svg width="130" height="130" viewBox="0 0 132 132"><circle cx="66" cy="66" r="${R}" fill="none" stroke="rgba(255,255,255,0.06)" stroke-width="16"/>${arcs}</svg><div class="dc"><div class="act-dv">${pct}%</div><div class="act-dl">FOYDALI</div></div></div>`;
  }
  function brkRows(map, labelFn, iconFn, limit) {
    let entries = Object.keys(map || {}).map(k => ({ key: k, sec: map[k] })).filter(e => e.sec > 0).sort((a, b) => b.sec - a.sec);
    if (limit) entries = entries.slice(0, limit);
    if (!entries.length) return '<div class="empty" style="padding:12px">Ma\'lumot yo\'q</div>';
    const max = Math.max(1, ...entries.map(e => e.sec));
    return entries.map(e => `<div class="act-brk">${iconFn ? `<div class="act-brk-ic">${iconFn(e.key)}</div>` : ''}<div class="act-brk-main"><div class="act-brk-top"><span class="act-brk-name">${escapeHtml(labelFn(e.key))}</span><span class="act-brk-val">${fmtSec(e.sec)}</span></div><div class="act-brk-track"><div class="act-brk-fill" style="width:${Math.max(3, Math.round(e.sec / max * 100))}%"></div></div></div></div>`).join('');
  }

  window.closeActivityModal = function () { $('activity-modal').classList.remove('show'); };

  window.viewChildActivity = async function (childEmail, name) {
    $('act-child-name').textContent = '📊 ' + (name || childEmail);
    $('activity-body').innerHTML = '<div class="empty" style="padding:40px 0">Yuklanmoqda…</div>';
    $('activity-modal').classList.add('show');
    let r;
    try { r = await svc.getChildActivity(childEmail, 14); } catch (e) { r = { ok: false, error: e.message }; }
    if (!r || !r.ok) {
      const msg = (r && r.status === 403) ? 'Ruxsat yo\'q — bu farzand bilan ulanish faol emas.' : ('Yuklab bo\'lmadi: ' + ((r && r.error) || 'xato'));
      $('activity-body').innerHTML = `<div class="msg msg-error">${escapeHtml(msg)}</div>`;
      return;
    }
    const days = (r.data && r.data.days) || [];
    renderChildActivity(days);
  };

  function renderChildActivity(days) {
    const now = Date.now();
    const todayK = dateKey(now), wkStart = weekStartKey(now);
    const prevStart = weekStartKey(now - 7 * 86400000);
    const today = sumDays(days.filter(d => d.date === todayK));
    const week = sumDays(days.filter(d => d.date >= wkStart && d.date <= todayK));
    const prev = sumDays(days.filter(d => d.date >= prevStart && d.date < wkStart));

    if (!week.totalSeconds && !today.totalSeconds) {
      $('activity-body').innerHTML = `<div class="empty" style="padding:50px 20px"><div class="empty-icon">📊</div><div style="font-size:14px;margin-bottom:6px">Hali faoliyat ma'lumoti yo'q</div><div style="font-size:12px">Farzand NIEX brauzeridan foydalansa, bu yerda ko'rinadi.</div></div>`;
      return;
    }

    const t = today.totalSeconds ? today : week; // bugun bo'sh bo'lsa — haftani ko'rsatamiz
    const tLabel = today.totalSeconds ? 'Bugun' : 'Bu hafta';
    const legend = `<div class="act-legend">
      <div class="act-leg"><span class="sw" style="background:#00E5A0"></span><span class="ln">Foydali</span><span class="lv">${fmtSec(t.usefulSeconds)}</span></div>
      <div class="act-leg"><span class="sw" style="background:#FF6B7A"></span><span class="ln">Kam foydali</span><span class="lv">${fmtSec(t.lowValueSeconds)}</span></div>
      <div class="act-leg"><span class="sw" style="background:#7C8AA5"></span><span class="ln">Aniqlanmagan</span><span class="lv">${fmtSec(t.unknownSeconds)}</span></div>
    </div>`;

    // Haftalik trend (foydali vaqt) — oldingi hafta bilan
    let trendChip = '';
    if (prev.totalSeconds > 0) {
      const p = prev.usefulSeconds > 0 ? Math.round((week.usefulSeconds - prev.usefulSeconds) / prev.usefulSeconds * 100) : null;
      if (p != null) { const cls = p > 0 ? 'up' : (p < 0 ? 'down' : 'flat'); const ar = p > 0 ? '▲' : (p < 0 ? '▼' : '•'); trendChip = `<span class="act-trend ${cls}">${ar} foydali ${p >= 0 ? '+' : ''}${p}%</span>`; }
    } else {
      trendChip = `<span class="act-trend flat">Oldingi hafta ma'lumoti yo'q</span>`;
    }

    $('activity-body').innerHTML = `
      <div class="act-sec-title">${tLabel} — ${fmtSec(t.totalSeconds)} onlayn</div>
      <div class="act-hero">${donutSvg(t.usefulSeconds, t.lowValueSeconds, t.unknownSeconds)}${legend}</div>
      <div class="act-metrics">
        <div class="act-metric"><div class="mv" style="color:#00E5A0">${fmtSec(t.focusSeconds)}</div><div class="ml">Focus vaqt</div></div>
        <div class="act-metric"><div class="mv">${t.distractionCount}</div><div class="ml">Chalg'ish</div></div>
        <div class="act-metric"><div class="mv">${t.blockedCount}</div><div class="ml">Bloklangan</div></div>
      </div>
      <div class="act-sec-title">Faoliyat turlari</div>
      ${brkRows(t.byType, k => ACT_LABEL[k] || k, k => ACT_ICON[k] || '•')}
      <div class="act-sec-title">Platformalar</div>
      ${brkRows(t.byPlatform, platLabel, null, 6)}
      <div class="act-sec-title">Kontent turlari</div>
      ${brkRows(t.byCategory, k => CAT_LABEL2[k] || k, null, 8)}
      <div class="act-sec-title">Bu hafta</div>
      <div class="act-hero" style="margin-bottom:0">
        <div style="font-size:26px;font-weight:800">${fmtSec(week.totalSeconds)}</div>${trendChip}
      </div>
      <div style="font-size:12px;color:#4a5568;margin-top:8px">Kunlik o'rtacha: ${fmtSec(Math.round(week.totalSeconds / 7))} · Foydali: ${fmtSec(week.usefulSeconds)} · Focus: ${fmtSec(week.focusSeconds)}</div>
    `;
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
