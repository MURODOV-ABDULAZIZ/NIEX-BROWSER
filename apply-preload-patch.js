/**
 * apply-preload-patch.js
 * ──────────────────────────────────────────────────────────────────────────
 * Faqat preload.js ga yangi bridge'larni qo'shadi.
 * Agar main.js ga allaqachon patch qilingan bo'lsa, alohida preload patch
 * kerak, chunki har ikkala faylga markerlar bilan ishlaydi.
 * ────────────────────────────────────────────────────────────────────────── */

const fs = require('fs');
const path = require('path');

const PRELOAD_PATH = path.join(__dirname, 'preload.js');
const MARKER = '/* === NIEX Extra Preload Patch v1 === */';

const EXTRA_PRELOAD_CODE = `
${MARKER}
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
${MARKER.replace('/*', '/* end ').replace(' */', ' */')}
`;

const src = fs.readFileSync(PRELOAD_PATH, 'utf8');
if (src.includes(MARKER)) {
  console.log('preload.js allaqachon patched — o\'tkazib yuborildi.');
  process.exit(0);
}

// Oxirgi bridge'dan keyin qo'shamiz
const lastBridgeIdx = src.lastIndexOf("contextBridge.exposeInMainWorld('safenet_navigate'");
if (lastBridgeIdx === -1) {
  console.error('❌ preload.js anchor topilmadi.');
  process.exit(1);
}
let nl = src.indexOf('\n', lastBridgeIdx);
if (nl === -1) nl = src.length;
const insertPos = nl + 1;
const newSrc = src.slice(0, insertPos) + '\n' + EXTRA_PRELOAD_CODE + src.slice(insertPos);
fs.writeFileSync(PRELOAD_PATH, newSrc, 'utf8');
console.log('✅ preload.js ga yangi bridge\'lar qo\'shildi.');
