/**
 * apply-ipc-patch.js
 * ──────────────────────────────────────────────────────────────────────────
 * Bu script main.js ga qo'shimcha IPC handlerlar va HTTP endpointlarni
 * xavfsiz ravishda qo'shadi. Bir marta ishga tushiriladi.
 *
 *   node apply-ipc-patch.js
 *
 * Nima qiladi:
 *  1. main.js da `feedback-list` IPC handleridan keyin yangi handlerlarni
 *     qo'shadi: quicklinks-*, focus-keywords-*, focus-whitelist-*,
 *     focus-schedules-*, feedback-reply-*, notifications-ack
 *  2. main.js dagi `feedbackServer` ichiga yangi /api endpointlarni
 *     qo'shadi (feedback-replies POST/GET, notifications GET)
 *  3. preload.js ga yangi bridge'larni qo'shadi
 *
 * Agar o'zgarish allaqachon kiritilgan bo'lsa — qayta qo'shmaydi.
 * ────────────────────────────────────────────────────────────────────────── */

const fs = require('fs');
const path = require('path');

const MAIN_PATH = path.join(__dirname, 'main.js');
const PRELOAD_PATH = path.join(__dirname, 'preload.js');

const IPC_MARKER = '/* === NIEX Extra IPC Patch v1 === */';
const PRELOAD_MARKER = '/* === NIEX Extra Preload Patch v1 === */';

// ── 1. Main.js ga qo'shimcha IPC handlerlar va HTTP endpointlar ──
const EXTRA_MAIN_CODE = `
${IPC_MARKER}
// ── QUICKLINKS IPC ──
function getQuicklinksFile() {
  const f = path.join(USER_DATA, 'quicklinks.json');
  try {
    if (!fs.existsSync(f)) return { links: [] };
    return JSON.parse(fs.readFileSync(f, 'utf8'));
  } catch (e) { return { links: [] }; }
}
function saveQuicklinksFile(data) {
  try {
    fs.mkdirSync(USER_DATA, { recursive: true });
    fs.writeFileSync(path.join(USER_DATA, 'quicklinks.json'), JSON.stringify(data, null, 2), 'utf8');
  } catch (e) {}
}
ipcMain.handle('quicklinks-list', async () => {
  return getQuicklinksFile().links || [];
});
ipcMain.handle('quicklinks-set', async (_, links) => {
  if (!Array.isArray(links)) return { ok: false, error: 'Invalid' };
  saveQuicklinksFile({ links, updatedAt: new Date().toISOString() });
  // Barcha oynalarga xabar beramiz
  for (const w of BrowserWindow.getAllWindows()) {
    w.webContents.send('quicklinks-updated', links);
  }
  return { ok: true };
});
ipcMain.handle('quicklinks-add', async (_, link) => {
  const data = getQuicklinksFile();
  const item = {
    id: link.id || ('ql_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2,5)),
    name: String(link.name || '').slice(0, 60),
    url: String(link.url || '').slice(0, 500),
    emoji: String(link.emoji || '🔗').slice(0, 8),
    color: link.color || '#00E5A0',
  };
  data.links.push(item);
  saveQuicklinksFile(data);
  return { ok: true, item };
});
ipcMain.handle('quicklinks-remove', async (_, id) => {
  const data = getQuicklinksFile();
  data.links = data.links.filter(l => l.id !== id);
  saveQuicklinksFile(data);
  return { ok: true };
});

// ── FOCUS EXTRAS (keywords, whitelist, schedules) ──
function getFocusFile(name) {
  const f = path.join(USER_DATA, 'focus-' + name + '.json');
  try {
    if (!fs.existsSync(f)) return { items: [] };
    return JSON.parse(fs.readFileSync(f, 'utf8'));
  } catch (e) { return { items: [] }; }
}
function saveFocusFile(name, data) {
  try {
    fs.mkdirSync(USER_DATA, { recursive: true });
    fs.writeFileSync(path.join(USER_DATA, 'focus-' + name + '.json'), JSON.stringify(data, null, 2), 'utf8');
  } catch (e) {}
}
ipcMain.handle('focus-keywords-get', async () => getFocusFile('keywords').items);
ipcMain.handle('focus-keywords-set', async (_, list) => {
  if (!Array.isArray(list)) return { ok: false };
  saveFocusFile('keywords', { items: list, updatedAt: new Date().toISOString() });
  return { ok: true };
});
ipcMain.handle('focus-whitelist-get', async () => getFocusFile('whitelist').items);
ipcMain.handle('focus-whitelist-set', async (_, list) => {
  if (!Array.isArray(list)) return { ok: false };
  saveFocusFile('whitelist', { items: list, updatedAt: new Date().toISOString() });
  return { ok: true };
});
ipcMain.handle('focus-schedules-get', async () => getFocusFile('schedules').items);
ipcMain.handle('focus-schedules-set', async (_, list) => {
  if (!Array.isArray(list)) return { ok: false };
  saveFocusFile('schedules', { items: list, updatedAt: new Date().toISOString() });
  return { ok: true };
});
ipcMain.handle('focus-blocks-get-full', async () => ({
  categories: blockEngine.getCategories(),
  customDomains: blockEngine.getCustomDomains(),
  keywords: getFocusFile('keywords').items,
  whitelist: getFocusFile('whitelist').items,
  schedules: getFocusFile('schedules').items,
}));

// ── FEEDBACK REPLIES IPC ──
function getRepliesFile() {
  const f = path.join(USER_DATA, 'feedback-replies.json');
  try {
    if (!fs.existsSync(f)) return { replies: [] };
    return JSON.parse(fs.readFileSync(f, 'utf8'));
  } catch (e) { return { replies: [] }; }
}
function saveRepliesFile(data) {
  try {
    fs.mkdirSync(USER_DATA, { recursive: true });
    fs.writeFileSync(path.join(USER_DATA, 'feedback-replies.json'), JSON.stringify(data, null, 2), 'utf8');
  } catch (e) {}
}
ipcMain.handle('feedback-reply-add', async (_, payload) => {
  const data = getRepliesFile();
  const reply = {
    id: 'r_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2,5),
    feedbackId: payload.feedbackId,
    from: payload.from || 'admin',
    message: String(payload.message || ''),
    createdAt: new Date().toISOString(),
  };
  data.replies.push(reply);
  saveRepliesFile(data);
  // Barcha oynalarga xabar beramiz
  for (const w of BrowserWindow.getAllWindows()) {
    w.webContents.send('feedback-reply-received', reply);
  }
  // Foydalanuvchiga notification
  appendNotification({
    title: '📬 Admin javob berdi',
    body: reply.message.slice(0, 120),
    type: 'feedback-reply',
    meta: { feedbackId: reply.feedbackId, replyId: reply.id },
  });
  return { ok: true, reply };
});
ipcMain.handle('feedback-reply-list', async () => getRepliesFile().replies);

// ── NOTIFICATIONS-ACK IPC ──
ipcMain.handle('notifications-mark-read', async (_, ids) => {
  const idList = Array.isArray(ids) ? ids : [ids].filter(Boolean);
  const items = markNotificationsRead(idList);
  return { ok: true, items };
});
${IPC_MARKER.replace('/*', '/* end ').replace(' */', ' */')}
`;

// HTTP endpointlarni feedbackServer ichiga qo'shish — alohida marker
const EXTRA_HTTP_HANDLER = `
${IPC_MARKER}
// ── QUICKLINKS HTTP API ──
if (req.method === 'GET' && purl.pathname === '/api/quicklinks') {
  try {
    const f = path.join(USER_DATA, 'quicklinks.json');
    if (!fs.existsSync(f)) { res.writeHead(200); res.end(JSON.stringify({ ok: true, items: [] })); return; }
    const data = JSON.parse(fs.readFileSync(f, 'utf8'));
    res.writeHead(200); res.end(JSON.stringify({ ok: true, items: data.links || [] }));
  } catch (e) { res.writeHead(200); res.end(JSON.stringify({ ok: true, items: [] })); }
  return;
}
if (req.method === 'POST' && purl.pathname === '/api/quicklinks') {
  let body = '';
  req.on('data', c => { body += c.toString(); });
  req.on('end', () => {
    try {
      const { items } = JSON.parse(body || '{}');
      saveQuicklinksFile({ links: items || [], updatedAt: new Date().toISOString() });
      res.writeHead(200); res.end(JSON.stringify({ ok: true }));
    } catch (e) { res.writeHead(400); res.end(JSON.stringify({ ok: false, error: e.message })); }
  });
  return;
}

// ── FEEDBACK REPLIES HTTP ──
if (req.method === 'GET' && purl.pathname === '/api/feedback-replies') {
  try {
    const f = path.join(USER_DATA, 'feedback-replies.json');
    if (!fs.existsSync(f)) { res.writeHead(200); res.end(JSON.stringify({ ok: true, replies: [] })); return; }
    const data = JSON.parse(fs.readFileSync(f, 'utf8'));
    res.writeHead(200); res.end(JSON.stringify({ ok: true, replies: data.replies || [] }));
  } catch (e) { res.writeHead(200); res.end(JSON.stringify({ ok: true, replies: [] })); }
  return;
}
if (req.method === 'POST' && purl.pathname === '/api/feedback-replies') {
  let body = '';
  req.on('data', c => { body += c.toString(); });
  req.on('end', () => {
    try {
      const payload = JSON.parse(body || '{}');
      const data = getRepliesFile();
      const reply = {
        id: 'r_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2,5),
        feedbackId: payload.feedbackId,
        from: payload.from || 'admin',
        message: String(payload.message || ''),
        createdAt: new Date().toISOString(),
      };
      data.replies.push(reply);
      saveRepliesFile(data);
      // Barcha oynalarga xabar
      for (const w of BrowserWindow.getAllWindows()) {
        w.webContents.send('feedback-reply-received', reply);
      }
      appendNotification({
        title: '📬 Admin javob berdi',
        body: reply.message.slice(0, 120),
        type: 'feedback-reply',
        meta: { feedbackId: reply.feedbackId, replyId: reply.id },
      });
      res.writeHead(200); res.end(JSON.stringify({ ok: true, reply }));
    } catch (e) { res.writeHead(400); res.end(JSON.stringify({ ok: false, error: e.message })); }
  });
  return;
}

// ── FOCUS EXTRAS HTTP ──
if (req.method === 'GET' && (purl.pathname === '/api/focus/keywords' || purl.pathname === '/api/focus/whitelist' || purl.pathname === '/api/focus/schedules')) {
  const section = purl.pathname.split('/').pop();
  const f = path.join(USER_DATA, 'focus-' + section + '.json');
  if (!fs.existsSync(f)) { res.writeHead(200); res.end(JSON.stringify({ ok: true, items: [] })); return; }
  try {
    const data = JSON.parse(fs.readFileSync(f, 'utf8'));
    res.writeHead(200); res.end(JSON.stringify({ ok: true, items: data.items || [] }));
  } catch { res.writeHead(200); res.end(JSON.stringify({ ok: true, items: [] })); }
  return;
}
if (req.method === 'POST' && (purl.pathname === '/api/focus/keywords' || purl.pathname === '/api/focus/whitelist' || purl.pathname === '/api/focus/schedules')) {
  const section = purl.pathname.split('/').pop();
  let body = '';
  req.on('data', c => { body += c.toString(); });
  req.on('end', () => {
    try {
      const { items } = JSON.parse(body || '{}');
      saveFocusFile(section, { items: items || [], updatedAt: new Date().toISOString() });
      res.writeHead(200); res.end(JSON.stringify({ ok: true }));
    } catch (e) { res.writeHead(400); res.end(JSON.stringify({ ok: false, error: e.message })); }
  });
  return;
}
${IPC_MARKER.replace('/*', '/* end ').replace(' */', ' */')}
`;

// ── 2. Preload.js ga yangi bridge ──
const EXTRA_PRELOAD_CODE = `
${PRELOAD_MARKER}
contextBridge.exposeInMainWorld('safenet_quicklinks', {
  list: () => ipcRenderer.invoke('quicklinks-list'),
  set: (links) => ipcRenderer.invoke('quicklinks-set', links),
  add: (link) => ipcRenderer.invoke('quicklinks-add', link),
  remove: (id) => ipcRenderer.invoke('quicklinks-remove', id),
  onUpdated: (fn) => ipcRenderer.on('quicklinks-updated', (_, links) => fn(links)),
});

contextBridge.exposeInMainWorld('safenet_focus_extras', {
  getKeywords: () => ipcRenderer.invoke('focus-keywords-get'),
  setKeywords: (list) => ipcRenderer.invoke('focus-keywords-set', list),
  getWhitelist: () => ipcRenderer.invoke('focus-whitelist-get'),
  setWhitelist: (list) => ipcRenderer.invoke('focus-whitelist-set', list),
  getSchedules: () => ipcRenderer.invoke('focus-schedules-get'),
  setSchedules: (list) => ipcRenderer.invoke('focus-schedules-set', list),
  getAll: () => ipcRenderer.invoke('focus-blocks-get-full'),
});

contextBridge.exposeInMainWorld('safenet_feedback_replies', {
  list: () => ipcRenderer.invoke('feedback-reply-list'),
  add: (payload) => ipcRenderer.invoke('feedback-reply-add', payload),
  onReply: (fn) => ipcRenderer.on('feedback-reply-received', (_, reply) => fn(reply)),
});

contextBridge.exposeInMainWorld('safenet_notifications', {
  markRead: (ids) => ipcRenderer.invoke('notifications-mark-read', ids),
});
${PRELOAD_MARKER.replace('/*', '/* end ').replace(' */', ' */')}
`;

// ─────────────────────────────────────────────────────────────────
// Patch logikasi
// ─────────────────────────────────────────────────────────────────

function patchMain() {
  if (!fs.existsSync(MAIN_PATH)) {
    console.error('main.js topilmadi:', MAIN_PATH);
    return false;
  }
  let src = fs.readFileSync(MAIN_PATH, 'utf8');
  if (src.includes(IPC_MARKER)) {
    console.log('✓ Main.js allaqachon patched — o\'tkazib yuborildi.');
    return true;
  }

  // 1) IPC handlerlarni ipcMain.handle('feedback-list', ...) dan keyin qo'shamiz.
  // Izlash: ipcMain.handle('feedback-list', ...
  const ipcAnchor = src.indexOf("ipcMain.handle('feedback-list'");
  if (ipcAnchor === -1) {
    // Zaxira: feedback-list handleridan oldingi oxirgi nuqta oldidan qo'shamiz.
    console.warn('⚠️  feedback-list handleri topilmadi — AUTH IPC dan oldin qo\'shyapmiz.');
    const authIdx = src.indexOf('// ── AUTH IPC (Firebase) ──');
    if (authIdx === -1) {
      console.error('❌ Anchor nuqta topilmadi.');
      return false;
    }
    src = src.slice(0, authIdx) + EXTRA_MAIN_CODE + '\n' + src.slice(authIdx);
  } else {
    // feedback-list handler tugaganidan keyin qo'shamiz — keyingi "// ──" yoki "ipcMain.handle" oldidan.
    // Oddiy yondashuv: feedback-list dan keyingi 8 qatorni ko'rib, eng yaqin "ipcMain.handle" yoki "ipcMain.on" yoki "// ──" oldiga qo'yamiz.
    const blockEnd = findBlockEnd(src, ipcAnchor);
    src = src.slice(0, blockEnd) + '\n' + EXTRA_MAIN_CODE + '\n' + src.slice(blockEnd);
  }

  // 2) HTTP handlerlarni feedbackServer ichiga qo'shamiz — eng yaqin "// CORS headers" dan keyin
  // Yoki: `if (req.method === 'GET' && (req.url === '/api/feedback' || req.url === '/feedback'))` dan oldin.
  const httpAnchor = src.indexOf('if (req.method === \'POST\' && req.url === \'/api/notifications/ack\')');
  if (httpAnchor === -1) {
    console.warn('⚠️  HTTP anchor topilmadi (ack).');
  } else {
    const ackEnd = findBlockEnd(src, httpAnchor);
    src = src.slice(0, ackEnd) + '\n' + EXTRA_HTTP_HANDLER + '\n' + src.slice(ackEnd);
  }

  fs.writeFileSync(MAIN_PATH, src, 'utf8');
  console.log('✅ main.js ga IPC handlerlar va HTTP endpointlar qo\'shildi.');
  return true;
}

function findBlockEnd(src, startIdx) {
  // Keyingi ikki bo'sh qator (yoki "// ──") oldiga
  let i = startIdx;
  while (i < src.length) {
    const next = src.indexOf('});', i);
    if (next === -1) return src.length;
    const closeNext = src.indexOf('\n', next);
    // Davomida "if (" yoki "// ──" yoki "ipcMain.handle" bilan boshlanuvchi yangi blok oldiga
    let p = closeNext + 1;
    while (p < src.length && (src[p] === ' ' || src[p] === '\t' || src[p] === '\n' || src[p] === '\r')) p++;
    const snippet = src.slice(p, p + 50);
    if (/^(if |ipcMain\.handle|ipcMain\.on|function |\/\/ ──)/.test(snippet) || snippet.startsWith('}')) {
      return closeNext + 2;
    }
    i = closeNext + 1;
  }
  return src.length;
}

function patchPreload() {
  if (!fs.existsSync(PRELOAD_PATH)) {
    console.error('preload.js topilmadi');
    return false;
  }
  let src = fs.readFileSync(PRELOAD_PATH, 'utf8');
  if (src.includes(PRELOAD_MARKER)) {
    console.log('✓ preload.js allaqachon patched — o\'tkazib yuborildi.');
    return true;
  }
  // Eng oxirgi bridge'dan keyin qo'shamiz
  const lastBridgeIdx = src.lastIndexOf('contextBridge.exposeInMainWorld');
  if (lastBridgeIdx === -1) {
    console.error('❌ preload.js anchor topilmadi.');
    return false;
  }
  const endIdx = src.indexOf('});', lastBridgeIdx);
  if (endIdx === -1) {
    console.error('❌ preload.js end topilmadi.');
    return false;
  }
  const insertPos = endIdx + 3;
  src = src.slice(0, insertPos) + '\n' + EXTRA_PRELOAD_CODE + src.slice(insertPos);
  fs.writeFileSync(PRELOAD_PATH, src, 'utf8');
  console.log('✅ preload.js ga yangi bridge\'lar qo\'shildi.');
  return true;
}

console.log('▶ NIEX Extra IPC Patch qo\'llanilmoqda...');
const ok1 = patchMain();
const ok2 = patchPreload();
if (ok1 && ok2) {
  console.log('');
  console.log('🎉 Tayyor! Endi quyidagilar ishlaydi:');
  console.log('   • quicklinks-list/set/add/remove IPC + HTTP');
  console.log('   • focus-keywords/whitelist/schedules IPC + HTTP');
  console.log('   • feedback-reply-list/add IPC + HTTP');
  console.log('   • notifications-mark-read IPC');
  console.log('   • Renderer bridge\'lar: safenet_quicklinks, safenet_focus_extras, safenet_feedback_replies');
  console.log('');
  console.log('Keyingi qadam: brauzerni qayta ishga tushiring.');
} else {
  console.error('❌ Patch muvaffaqiyatsiz tugadi');
  process.exit(1);
}
