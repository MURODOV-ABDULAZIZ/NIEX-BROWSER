/**
 * NIEX — Boshqa brauzerlarni aniqlash (Windows).
 * ==============================================
 *
 * Maqsad: foydalanuvchi/farzand qurilmasidagi CHALG'ITADIGAN boshqa brauzerlarni
 * (Chrome, Edge, Firefox, Opera, Brave, Yandex) topish — onboarding'да tavsiya
 * ko'rsatish va ular ochilса/o'rnatilса ota-onaga alert yuborish uchun.
 *
 * MUHIM (xavfsizlik): bu modul HECH NARSANI o'CHIRMAYDI/BLOKLAMAYDI (bu admin +
 * malware-xatti-harakat bo'lardi). Faqat ANIQLAYDI. O'chirishни foydalanuvchi
 * o'zi Windows "Ilovalar va imkoniyatlar" orqali tasdiqlab qiladi (main.js shell).
 *
 * Sof/testlanadigan: fs.existsSync va process.env inject qilinadi.
 */
'use strict';

// Ma'lum brauzerlar. `paths` — Windows env-o'zgaruvchili yo'llar (birinchi topilgani).
//   `proc` — jarayon nomi (running aniqlash). `data` — foydalanuvchiga ogohlantirish.
const BROWSERS = Object.freeze([
  { id: 'chrome',  name: 'Google Chrome',   proc: 'chrome.exe',  data: 'Xatchoʻplar, saqlangan parollar, tarix',
    paths: ['%ProgramFiles%\\Google\\Chrome\\Application\\chrome.exe', '%ProgramFiles(x86)%\\Google\\Chrome\\Application\\chrome.exe', '%LocalAppData%\\Google\\Chrome\\Application\\chrome.exe'] },
  { id: 'edge',    name: 'Microsoft Edge',  proc: 'msedge.exe',  system: true, data: 'Xatchoʻplar, saqlangan parollar',
    paths: ['%ProgramFiles(x86)%\\Microsoft\\Edge\\Application\\msedge.exe', '%ProgramFiles%\\Microsoft\\Edge\\Application\\msedge.exe'] },
  { id: 'firefox', name: 'Mozilla Firefox', proc: 'firefox.exe', data: 'Xatchoʻplar, saqlangan parollar',
    paths: ['%ProgramFiles%\\Mozilla Firefox\\firefox.exe', '%ProgramFiles(x86)%\\Mozilla Firefox\\firefox.exe'] },
  { id: 'opera',   name: 'Opera',           proc: 'opera.exe',  data: 'Xatchoʻplar, tarix',
    paths: ['%LocalAppData%\\Programs\\Opera\\opera.exe', '%ProgramFiles%\\Opera\\opera.exe'] },
  { id: 'operagx', name: 'Opera GX',        proc: 'opera.exe',  data: 'Xatchoʻplar, tarix',
    paths: ['%LocalAppData%\\Programs\\Opera GX\\opera.exe'] },
  { id: 'brave',   name: 'Brave',           proc: 'brave.exe',  data: 'Xatchoʻplar, parollar',
    paths: ['%ProgramFiles%\\BraveSoftware\\Brave-Browser\\Application\\brave.exe', '%LocalAppData%\\BraveSoftware\\Brave-Browser\\Application\\brave.exe'] },
  { id: 'yandex',  name: 'Yandex Browser',  proc: 'browser.exe', data: 'Xatchoʻplar, tarix',
    paths: ['%LocalAppData%\\Yandex\\YandexBrowser\\Application\\browser.exe'] },
  // Maxfiylik/chetlab o'tish brauzerlari — ota-ona nazoratini aylanib o'tishga ishlatilishi mumkin.
  { id: 'tor',     name: 'Tor Browser',     proc: 'tor.exe',    data: 'Nazoratni chetlab oʻtish (maxfiy tarmoq)',
    paths: ['%USERPROFILE%\\Desktop\\Tor Browser\\Browser\\firefox.exe', '%USERPROFILE%\\Desktop\\Tor Browser\\Browser\\TorBrowser\\Tor\\tor.exe', '%LocalAppData%\\Tor Browser\\Browser\\firefox.exe', '%ProgramFiles%\\Tor Browser\\Browser\\firefox.exe'] },
  { id: 'vivaldi', name: 'Vivaldi',         proc: 'vivaldi.exe', data: 'Xatchoʻplar, tarix',
    paths: ['%LocalAppData%\\Vivaldi\\Application\\vivaldi.exe', '%ProgramFiles%\\Vivaldi\\Application\\vivaldi.exe'] },
  { id: 'chromium', name: 'Chromium',       proc: 'chromium.exe', data: 'Xatchoʻplar, tarix',
    paths: ['%LocalAppData%\\Chromium\\Application\\chrome.exe', '%ProgramFiles%\\Chromium\\Application\\chrome.exe'] },
  { id: 'waterfox', name: 'Waterfox',       proc: 'waterfox.exe', data: 'Xatchoʻplar, parollar',
    paths: ['%ProgramFiles%\\Waterfox\\waterfox.exe'] },
  { id: 'palemoon', name: 'Pale Moon',      proc: 'palemoon.exe', data: 'Xatchoʻplar, tarix',
    paths: ['%ProgramFiles%\\Pale Moon\\palemoon.exe', '%ProgramFiles(x86)%\\Pale Moon\\palemoon.exe'] },
  { id: 'maxthon', name: 'Maxthon',         proc: 'maxthon.exe', data: 'Xatchoʻplar, tarix',
    paths: ['%ProgramFiles(x86)%\\Maxthon\\Bin\\Maxthon.exe', '%LocalAppData%\\Maxthon\\Application\\maxthon.exe'] },
  { id: 'uc',      name: 'UC Browser',      proc: 'ucbrowser.exe', data: 'Xatchoʻplar, tarix',
    paths: ['%ProgramFiles(x86)%\\UCBrowser\\Application\\UCBrowser.exe'] },
  { id: 'epic',    name: 'Epic Privacy',    proc: 'epic.exe',   data: 'Maxfiy tarmoq, tarix',
    paths: ['%LocalAppData%\\Epic Privacy Browser\\Application\\epic.exe'] },
  { id: 'comodo',  name: 'Comodo Dragon',   proc: 'dragon.exe', data: 'Xatchoʻplar, tarix',
    paths: ['%ProgramFiles(x86)%\\Comodo\\Dragon\\dragon.exe', '%ProgramFiles%\\Comodo\\Dragon\\dragon.exe'] },
  { id: 'slimjet', name: 'Slimjet',         proc: 'slimjet.exe', data: 'Xatchoʻplar, tarix',
    paths: ['%ProgramFiles(x86)%\\Slimjet\\slimjet.exe', '%ProgramFiles%\\Slimjet\\slimjet.exe'] },
]);

const PROC_TO_ID = (() => { const m = {}; for (const b of BROWSERS) m[b.proc.toLowerCase()] = b.id; return m; })();

function expandEnv(p, env) {
  env = env || process.env;
  return String(p).replace(/%([^%]+)%/g, (_, v) => env[v] || '');
}

/**
 * O'rnatilган brauzerlarни aniqlaydi.
 * @param {{ existsFn?, env? }} deps  test uchun inject
 * @returns {Array<{id,name,path,system,data}>}
 */
function detectInstalled(deps = {}) {
  const existsFn = deps.existsFn || require('fs').existsSync;
  const env = deps.env || process.env;
  const out = [];
  for (const b of BROWSERS) {
    for (const raw of b.paths) {
      const p = expandEnv(raw, env);
      let ok = false;
      try { ok = !!p && existsFn(p); } catch (_) { ok = false; }
      if (ok) { out.push({ id: b.id, name: b.name, path: p, system: !!b.system, data: b.data }); break; }
    }
  }
  return out;
}

/**
 * tasklist matnidan HOZIR ishlayotgan brauzerlarни ajratadi (sof — test uchun).
 * @param {string} tasklistOut  `tasklist` chiqishi
 * @returns {Array<string>} ishlayotgan brauzer id'lari
 */
function parseRunning(tasklistOut) {
  const s = String(tasklistOut || '').toLowerCase();
  const ids = [];
  for (const proc of Object.keys(PROC_TO_ID)) {
    // qator boshida yoki bo'sh joydan keyin aniq jarayon nomi (msedgewebview kabi noto'g'ri mos kelmasin)
    const rx = new RegExp('(^|\\s|")' + proc.replace('.', '\\.') + '(\\s|",|$)', 'm');
    if (rx.test(s)) { const id = PROC_TO_ID[proc]; if (ids.indexOf(id) === -1) ids.push(id); }
  }
  return ids;
}

/** HOZIR ishlayotgan brauzerlar (Windows tasklist). @returns Promise<string[]> */
function detectRunning(deps = {}) {
  const execFile = deps.execFile || require('child_process').execFile;
  if (process.platform !== 'win32') return Promise.resolve([]);
  return new Promise((resolve) => {
    try {
      execFile('tasklist', ['/fo', 'csv', '/nh'], { windowsHide: true, timeout: 8000, maxBuffer: 4 * 1024 * 1024 }, (err, stdout) => {
        if (err) return resolve([]);
        resolve(parseRunning(stdout));
      });
    } catch (_) { resolve([]); }
  });
}

module.exports = { BROWSERS, PROC_TO_ID, expandEnv, detectInstalled, parseRunning, detectRunning };
