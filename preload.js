const { contextBridge, ipcRenderer } = require('electron');

// ══════════════════════════════════════════════════════════════
// CHROME.* EXTENSION API STUBS
// ══════════════════════════════════════════════════════════════

const createChromeAPI = () => {
  const messageListeners = [];
  const storageData = {};

  return {
    runtime: {
      id: window.__ext_context?.id || 'unknown',
      
      sendMessage: (message, responseCallback) => {
        const id = 'ext_msg_' + Date.now() + '_' + Math.random().toString(36).slice(2);
        if (responseCallback) {
          ipcRenderer.once('ext-msg-response-' + id, (_, response) => {
            responseCallback(response);
          });
        }
        ipcRenderer.send('ext-message', {
          id,
          message,
          extId: window.__ext_context?.id
        });
      },

      onMessage: {
        listeners: messageListeners,
        addListener: (listener) => {
          messageListeners.push(listener);
        },
        removeListener: (listener) => {
          const idx = messageListeners.indexOf(listener);
          if (idx !== -1) messageListeners.splice(idx, 1);
        }
      }
    },

    storage: {
      local: {
        get: (keys, callback) => {
          const id = 'ext_storage_get_' + Date.now() + '_' + Math.random().toString(36).slice(2);
          ipcRenderer.once('ext-storage-get-' + id, (_, data) => {
            callback(data);
          });
          ipcRenderer.send('ext-storage-get', {
            id,
            keys,
            extId: window.__ext_context?.id
          });
        },

        set: (obj, callback) => {
          ipcRenderer.send('ext-storage-set', {
            data: obj,
            extId: window.__ext_context?.id
          });
          if (callback) callback();
        },

        remove: (keys, callback) => {
          ipcRenderer.send('ext-storage-remove', {
            keys,
            extId: window.__ext_context?.id
          });
          if (callback) callback();
        },

        clear: (callback) => {
          ipcRenderer.send('ext-storage-clear', {
            extId: window.__ext_context?.id
          });
          if (callback) callback();
        }
      }
    },

    tabs: {
      query: (queryInfo, callback) => {
        const id = 'ext_tabs_query_' + Date.now() + '_' + Math.random().toString(36).slice(2);
        ipcRenderer.once('ext-tabs-query-' + id, (_, tabs) => {
          callback(tabs);
        });
        ipcRenderer.send('ext-tabs-query', {
          id,
          query: queryInfo,
          extId: window.__ext_context?.id
        });
      },

      getCurrent: (callback) => {
        const id = 'ext_tabs_current_' + Date.now() + '_' + Math.random().toString(36).slice(2);
        ipcRenderer.once('ext-tabs-current-' + id, (_, tab) => {
          callback(tab);
        });
        ipcRenderer.send('ext-tabs-get-current', {
          id,
          extId: window.__ext_context?.id
        });
      },

      executeScript: (tabId, details, callback) => {
        ipcRenderer.send('ext-tabs-execute-script', {
          tabId,
          details,
          extId: window.__ext_context?.id
        });
        if (callback) callback([]);
      }
    },

    extension: {
      getURL: (path) => {
        return 'chrome-extension://' + window.__ext_context?.id + '/' + path;
      }
    }
  };
};

if (!window.chrome) {
  window.chrome = createChromeAPI();
}

ipcRenderer.on('ext-message-broadcast', (_, { message, extId }) => {
  if (window.chrome && window.chrome.runtime && window.chrome.runtime.onMessage) {
    for (const listener of window.chrome.runtime.onMessage.listeners) {
      listener(message, { id: extId }, () => {});
    }
  }
});

contextBridge.exposeInMainWorld('safenet', {
  navigate:     (url) => ipcRenderer.send('navigate', url),
  goHome:       ()    => ipcRenderer.send('go-home'),
  goBack:       ()    => ipcRenderer.send('go-back'),
  goForward:    ()    => ipcRenderer.send('go-forward'),
  reload:       ()    => ipcRenderer.send('reload'),
  newTab:       (url) => ipcRenderer.send('new-tab', url || ''),
  saveSettings: (s)   => ipcRenderer.send('settings-changed', s),
  getSettings: ()     => ipcRenderer.invoke('settings-get'),
  onSettingsChanged: (fn) => ipcRenderer.on('settings-changed', (_, s) => fn(s)),
  getHistory: ()      => ipcRenderer.invoke('history-get'),
  deleteHistory: (id) => ipcRenderer.invoke('history-delete', id),
  clearHistory: ()    => ipcRenderer.invoke('history-clear'),
  onHistoryUpdated: (fn) => ipcRenderer.on('history-updated', (_, history) => fn(history)),
  onStats:      (fn)  => ipcRenderer.on('stats-update', (_, s) => fn(s)),

  firebaseConfig: {
    apiKey: process.env.FIREBASE_API_KEY || '',
    authDomain: process.env.FIREBASE_AUTH_DOMAIN || '',
    projectId: process.env.FIREBASE_PROJECT_ID || '',
    storageBucket: process.env.FIREBASE_STORAGE_BUCKET || '',
    messagingSenderId: process.env.FIREBASE_MESSAGING_SENDER_ID || '',
    appId: process.env.FIREBASE_APP_ID || '',
    measurementId: process.env.FIREBASE_MEASUREMENT_ID || ''
  },

  // URL bilan (eski)
  checkImages: (urls, cb) => {
    if (!urls?.length) { cb([]); return; }
    const id = 'img_' + Date.now() + '_' + Math.random().toString(36).slice(2);
    ipcRenderer.once('img-result-' + id, (_, r) => cb(r));
    ipcRenderer.send('check-images', { urls: urls.slice(0, 3), id });
  },

  // Rasm: base64 yoki URL — main process → Groq/OpenRouter/Gemini
  checkImageData: (data, cb) => {
    const id = 'imgd_' + Date.now() + '_' + Math.random().toString(36).slice(2);
    ipcRenderer.once('imgd-result-' + id, (_, r) => cb(r));
    ipcRenderer.send('check-image-data', { ...data, id });
  },

  // Video: base64 — main process → Gemini (safenet-ai.js)
  checkVideoData: (base64, mimeType, cb) => {
    const id = 'vid_' + Date.now() + '_' + Math.random().toString(36).slice(2);
    ipcRenderer.once('vid-result-' + id, (_, r) => cb(r));
    ipcRenderer.send('check-video-data', { base64, mimeType: mimeType || 'video/mp4', id });
  },

  checkText: (text, cb) => {
    const id = 'txt_' + Date.now() + '_' + Math.random().toString(36).slice(2);
    ipcRenderer.once('txt-result-' + id, (_, r) => cb(r));
    ipcRenderer.send('check-text', { text, id });
  },

  // Local AI video kadr tahlil qildi — birlashgan AI kvotaga qo'shadi.
  //   Response.quotaExhausted true bo'lsa frame-scanner o'z-o'zidan to'xtaydi.
  trackLocalVideo: async (seconds) => {
    try { return await ipcRenderer.invoke('usage-track-local-video-async', { seconds: Math.max(0, Number(seconds) || 0) }); }
    catch { return { ok: false, quotaExhausted: false }; }
  },
  isAiQuotaAvailable: async () => {
    try { return await ipcRenderer.invoke('ai-quota-available'); }
    catch { return { ok: true, available: true }; }
  },

  // Firebase Authentication bridge (replaces old native Google OAuth PKCE)
  signInGoogle: () => ipcRenderer.invoke('auth-signin-google'),
  signOut: () => ipcRenderer.invoke('auth-signout'),
  getProfile: () => ipcRenderer.invoke('auth-get-profile'),
  getCredentials: () => ipcRenderer.invoke('auth-get-credentials'),
  openAccount: () => ipcRenderer.send('open-google-account'),
  onGoogleAuth: (fn) => ipcRenderer.on('google-auth', (_, user) => fn(user)),
});

contextBridge.exposeInMainWorld('safenet_auth', {
  signInGoogle: () => ipcRenderer.invoke('auth-signin-google'),
  signOut: () => ipcRenderer.invoke('auth-signout'),
  getProfile: () => ipcRenderer.invoke('auth-get-profile'),
  getCredentials: () => ipcRenderer.invoke('auth-get-credentials'),
  openAccount: () => ipcRenderer.send('open-google-account'),
  onGoogleAuth: (fn) => ipcRenderer.on('google-auth', (_, user) => fn(user)),
});

// Extensions API
contextBridge.exposeInMainWorld('safenet_extensions', {
  list: () => ipcRenderer.invoke('extensions-list'),
  install: (opts) => ipcRenderer.invoke('extensions-install', opts), // { url, name }
  uninstall: (id) => ipcRenderer.invoke('extensions-uninstall', id),
  toggle: (id, enabled) => ipcRenderer.invoke('extensions-toggle', { id, enabled }),
  onChanged: (fn) => ipcRenderer.on('extensions-updated', (_, list) => fn(list)),
});

// Chrome Extension System bridge (real Chrome extensions — Manifest V2/V3)
contextBridge.exposeInMainWorld('chromeExt', {
  list: () => ipcRenderer.invoke('chrome-ext-list'),
  installUnpacked: () => ipcRenderer.invoke('chrome-ext-install-unpacked'),
  installCRX: (crxPath) => ipcRenderer.invoke('chrome-ext-install-crx', crxPath),
  toggle: (id, enabled) => ipcRenderer.invoke('chrome-ext-toggle', { id, enabled }),
  uninstall: (id) => ipcRenderer.invoke('chrome-ext-uninstall', id),
  openPopup: (id, anchor) => ipcRenderer.invoke('chrome-ext-open-popup', { id, anchor }),
  openStore: () => ipcRenderer.invoke('chrome-ext-open-store'),
});

// Parent Control bridge — child sahifadagi block hodisalarini main'ga uzatadi.
contextBridge.exposeInMainWorld('__parentControlBridge', {
  reportBlock: (payload) => ipcRenderer.send('parent-control-report-block', payload),
});

// PAROL MENEJERI bridge — Chrome'dagi kabi saqlash va avtomatik to'ldirish.
// Parollar main process'da OS shifrlash bilan saqlanadi; bu yerdan faqat
// sahifaning O'Z origini uchun so'ralishi mumkin (main tomonda tekshiriladi).
contextBridge.exposeInMainWorld('niexPasswords', {
  list:        ()        => ipcRenderer.invoke('password-list'),
  status:      ()        => ipcRenderer.invoke('password-status'),
  reveal:      (id)      => ipcRenderer.invoke('password-reveal', id),
  remove:      (id)      => ipcRenderer.invoke('password-remove', id),
  removeAll:   ()        => ipcRenderer.invoke('password-remove-all'),
  forOrigin:   ()        => ipcRenderer.invoke('password-get-for-origin'),
  save:        (payload) => ipcRenderer.invoke('password-save', payload),
  markUsed:    (id)      => ipcRenderer.invoke('password-mark-used', id),
  neverAsk:    ()        => ipcRenderer.send('password-never-ask'),
  isNeverAsk:  ()        => ipcRenderer.invoke('password-is-never-ask'),
});

// PARENT CONTROL bridge — parent-control.html shu orqali Supabase bilan ishlaydi
// (Firebase o'rniga). parent-control-supabase.js shu bridge'ni chaqiradi.
contextBridge.exposeInMainWorld('safenet_parent', {
  addChild: (childEmail) => ipcRenderer.invoke('parent-add-child', childEmail),
  verifyChildCode: (childEmail, code) => ipcRenderer.invoke('parent-verify-code', { childEmail, code }),
  getChildren: () => ipcRenderer.invoke('parent-get-children'),
  revokeChild: (childEmail) => ipcRenderer.invoke('parent-revoke-child', childEmail),
  getAlerts: () => ipcRenderer.invoke('parent-get-alerts'),
  markAlertsRead: (ids) => ipcRenderer.invoke('parent-mark-alerts-read', ids),
});

// PROFILE bridge — Chrome-style multi-account. Har profil o'z alohida
// userData papkasi bilan yonma-yon ishlaydi. Profil almashtirilsa yangi
// NIEX oynasi ochiladi (joriy oyna buzilmaydi).
contextBridge.exposeInMainWorld('safenet_profiles', {
  list:       ()          => ipcRenderer.invoke('profile-list'),
  current:    ()          => ipcRenderer.invoke('profile-current'),
  add:        (payload)   => ipcRenderer.invoke('profile-add', payload),
  remove:     (id)        => ipcRenderer.invoke('profile-remove', id),
  update:     (id, fields)=> ipcRenderer.invoke('profile-update', { id, fields }),
  launch:     (id)        => ipcRenderer.invoke('profile-launch', id),
});

// PREMIUM bridge — premium.html shu orqali holat oladi va to'lov yuboradi.
contextBridge.exposeInMainWorld('safenet_premium', {
  getStatus: () => ipcRenderer.invoke('premium-get-status'),
  submitPayment: (data) => ipcRenderer.invoke('premium-submit-payment', data),
  cancel: () => ipcRenderer.invoke('premium-cancel'),
  cancelPending: () => ipcRenderer.invoke('premium-cancel-pending'),
  getAiLimits: () => ipcRenderer.invoke('ai-limits-get'),
  onStatusChanged: (fn) => ipcRenderer.on('premium-status-changed', (_, st) => fn(st)),
  goHome: () => ipcRenderer.send('go-home'),
});

// AI Brain → toolbar counter bridge.
// monitor.js bu orqali bloklash sonini main process'ga yuboradi.
contextBridge.exposeInMainWorld('__ciaBridge', {
  reportBlock: () => ipcRenderer.send('cia-block-increment'),
});

// Firebase config'ni renderer'ga uzatish (agar main.js .env dan yuklagan bo'lsa)
contextBridge.exposeInMainWorld('safenet_firebase_config', {
  get: () => ipcRenderer.invoke('firebase-config-get'),
});
// Backwards-compatible lightweight _ipc surface expected by some renderer code
contextBridge.exposeInMainWorld('_ipc', {
  send: (channel, ...args) => ipcRenderer.send(channel, ...args),
  on: (channel, cb) => ipcRenderer.on(channel, (event, ...args) => cb(event, ...args)),
  once: (channel, cb) => ipcRenderer.once(channel, (event, ...args) => cb(event, ...args)),
  invoke: (channel, ...args) => ipcRenderer.invoke(channel, ...args),
});

// Provide a minimal `ipcRenderer` facade in the main world for older renderer scripts
contextBridge.exposeInMainWorld('ipcRenderer', {
  send: (channel, ...args) => ipcRenderer.send(channel, ...args),
  on: (channel, cb) => ipcRenderer.on(channel, (event, ...args) => cb(event, ...args)),
  once: (channel, cb) => ipcRenderer.once(channel, (event, ...args) => cb(event, ...args)),
  invoke: (channel, ...args) => ipcRenderer.invoke(channel, ...args),
});

// Small helper to match older renderer code that called window.safenet_navigate
contextBridge.exposeInMainWorld('safenet_navigate', (url) => ipcRenderer.send('navigate', url));

/* === NIEX Extra Preload Patch v1 === */
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
/* end  === NIEX Extra Preload Patch v1 === */
