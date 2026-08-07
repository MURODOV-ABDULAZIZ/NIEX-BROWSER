#!/usr/bin/env node
/**
 * NIEX Browser — RELIZ QURISH KONVEYERI
 * =====================================
 *
 * Bosqichlar:
 *   1. Asl fayllarni `.build-backup/` ga zaxiralash
 *   2. JS kodni obfuskatsiya qilish (main process + renderer + HTML ichidagi
 *      inline skriptlar)
 *   3. `electron-builder` bilan setup .exe qurish
 *   4. Asl fayllarni QAYTA TIKLASH (build muvaffaqiyatli bo'lsa ham, xato
 *      bo'lsa ham — `finally` bloki kafolatlaydi)
 *
 * OBFUSKATSIYA SOZLAMALARI ehtiyotkorona tanlangan:
 *   - `controlFlowFlattening` va `deadCodeInjection` O'CHIRILGAN — ular kodni
 *     eng ko'p buzadigan transformatsiyalar va Electron IPC/async oqimlarida
 *     nozik nosozliklar keltirib chiqaradi.
 *   - `stringArray` YOQILGAN — matnlar (IPC kanal nomlari, URL'lar, selektorlar)
 *     bevosita o'qilmaydi. Ish vaqtida qiymatlar o'zgarmaydi, shuning uchun
 *     xatti-harakat bir xil qoladi.
 *
 * MUHIM: obfuskatsiya SHIFRLASH EMAS. U kodni o'qishni qiyinlashtiradi,
 * lekin qat'iy niyatli odam vaqt sarflab tushunishi mumkin. Haqiqiy himoya —
 * sirlarni serverda ushlash (AI kalitlari allaqachon Supabase secrets'da).
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const BACKUP = path.join(ROOT, '.build-backup');

// ── Obfuskatsiya qilinadigan fayllar ──
const JS_DIRS = ['modules', 'cloud', 'ai-gateway', 'parental-control', 'premium', 'onboarding'];
const JS_ROOT_FILES = [
  'main.js', 'preload.js', 'contentfilter.js', 'youtube-boost.js',
  'safenet-ai.js', 'extension-manager.js', 'chrome-extension-system.js',
  'dynamic-ai-worker.js',
];
const HTML_FILES = ['garage.html', 'safenethome.html', 'premium.html', 'home.html'];

// Tegilmaydigan fayllar: allaqachon minifikatsiya qilingan yoki vendor
const SKIP = new Set([
  'monitor.js',          // 7 MB, allaqachon bundle+minified
  'tfjs.min.js', 'nsfwjs.min.js',
  'main.js.backup', 'main.js.stub-broken', 'main.js.fixed',
]);

const OBF_OPTIONS = {
  compact: true,
  identifierNamesGenerator: 'hexadecimal',
  renameGlobals: false,              // global nomlar o'zgarsa inject kodlar buziladi
  stringArray: true,
  stringArrayThreshold: 0.8,
  stringArrayEncoding: ['base64'],
  stringArrayIndexShift: true,
  stringArrayRotate: true,
  stringArrayShuffle: true,
  splitStrings: false,               // uzun HTML template'larni buzmasin
  controlFlowFlattening: false,      // ← eng ko'p nosozlik manbai, O'CHIQ
  deadCodeInjection: false,          // ← hajmni shishiradi, O'CHIQ
  selfDefending: false,              // ← electron-builder bilan muammo beradi
  debugProtection: false,
  disableConsoleOutput: false,       // loglar diagnostika uchun kerak
  numbersToExpressions: true,
  simplify: true,
  transformObjectKeys: false,        // IPC kanal nomlari kalit sifatida ishlatiladi
  unicodeEscapeSequence: false,
  target: 'node',
};

// Renderer (brauzer) uchun — `target: browser`
const OBF_OPTIONS_BROWSER = { ...OBF_OPTIONS, target: 'browser' };

let obfuscator = null;
function obfuscate(code, browser) {
  if (!obfuscator) obfuscator = require('javascript-obfuscator');
  return obfuscator.obfuscate(code, browser ? OBF_OPTIONS_BROWSER : OBF_OPTIONS).getObfuscatedCode();
}

// ── Yordamchilar ──
function log(sym, msg) { console.log(`  ${sym} ${msg}`); }

function collectJsFiles() {
  const out = [];
  for (const f of JS_ROOT_FILES) {
    const p = path.join(ROOT, f);
    if (fs.existsSync(p) && !SKIP.has(f)) out.push(p);
  }
  for (const d of JS_DIRS) {
    const dir = path.join(ROOT, d);
    if (!fs.existsSync(dir)) continue;
    const walk = (cur) => {
      for (const e of fs.readdirSync(cur, { withFileTypes: true })) {
        const p = path.join(cur, e.name);
        if (e.isDirectory()) { walk(p); continue; }
        if (!e.name.endsWith('.js')) continue;
        if (SKIP.has(e.name) || e.name.endsWith('.min.js')) continue;
        out.push(p);
      }
    };
    walk(dir);
  }
  return out;
}

function backupFile(abs) {
  const rel = path.relative(ROOT, abs);
  const dest = path.join(BACKUP, rel);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(abs, dest);
}

function restoreAll() {
  if (!fs.existsSync(BACKUP)) return 0;
  let n = 0;
  const walk = (cur) => {
    for (const e of fs.readdirSync(cur, { withFileTypes: true })) {
      const p = path.join(cur, e.name);
      if (e.isDirectory()) { walk(p); continue; }
      const rel = path.relative(BACKUP, p);
      fs.copyFileSync(p, path.join(ROOT, rel));
      n++;
    }
  };
  walk(BACKUP);
  fs.rmSync(BACKUP, { recursive: true, force: true });
  return n;
}

/** HTML ichidagi inline <script> bloklarini obfuskatsiya qilish. */
function obfuscateHtml(abs) {
  let html = fs.readFileSync(abs, 'utf8');
  const re = /(<script(?![^>]*\bsrc=)[^>]*>)([\s\S]*?)(<\/script>)/gi;
  let count = 0;
  html = html.replace(re, (m, open, body, close) => {
    const trimmed = body.trim();
    if (!trimmed || trimmed.length < 40) return m;      // juda kichik — tegmaymiz
    if (/^\s*\/\*\s*no-obfuscate/i.test(trimmed)) return m;
    try {
      const out = obfuscate(body, true);
      count++;
      return open + '\n' + out + '\n' + close;
    } catch (e) {
      log('!', `${path.basename(abs)}: bir blok o'tkazib yuborildi (${e.message.slice(0, 60)})`);
      return m;
    }
  });
  fs.writeFileSync(abs, html, 'utf8');
  return count;
}

// ── Asosiy oqim ──
function main() {
  const args = process.argv.slice(2);
  const skipBuild = args.includes('--no-build');

  console.log('\n═══ NIEX Browser — reliz qurish ═══\n');

  // Pre-flight: ensure Windows ICO is present so electron-builder embeds NIEX icon
  const icoPath = path.join(ROOT, 'assets', 'icon.ico');
  if (!fs.existsSync(icoPath)) {
    console.error('\nERROR: assets/icon.ico not found.\nPlease generate a multi-resolution .ico from assets/brand/niex-logo.png (sizes 16,32,48,256) and save it as assets/icon.ico before building.');
    process.exit(1);
  }

  if (fs.existsSync(BACKUP)) {
    console.log('  ⚠ Oldingi zaxira topildi — avval tiklaymiz');
    log('↺', restoreAll() + ' fayl tiklandi');
  }

  const jsFiles = collectJsFiles();
  const htmlFiles = HTML_FILES.map((f) => path.join(ROOT, f)).filter((p) => fs.existsSync(p));

  console.log(`  Obfuskatsiya: ${jsFiles.length} JS fayl, ${htmlFiles.length} HTML fayl\n`);

  let ok = false;
  try {
    // 1. Zaxira
    for (const f of [...jsFiles, ...htmlFiles]) backupFile(f);
    log('✓', 'Asl fayllar zaxiralandi');

    // 2. JS obfuskatsiya
    let jsBytes = 0;
    for (const f of jsFiles) {
      const src = fs.readFileSync(f, 'utf8');
      const isRenderer = /parental-control|onboarding|passwords[\\/]autofill/.test(f);
      const out = obfuscate(src, isRenderer);
      fs.writeFileSync(f, out, 'utf8');
      jsBytes += out.length;
    }
    log('✓', `JS obfuskatsiya qilindi (${(jsBytes / 1024).toFixed(0)} KB)`);

    // 3. HTML inline skriptlar
    let blocks = 0;
    for (const f of htmlFiles) blocks += obfuscateHtml(f);
    log('✓', `HTML ichidagi ${blocks} ta skript bloki obfuskatsiya qilindi`);

    // 4. Sintaksis tekshiruvi — buzilmaganiga ishonch
    for (const f of jsFiles) {
      try { new (require('vm').Script)(fs.readFileSync(f, 'utf8'), { filename: f }); }
      catch (e) { throw new Error(`Obfuskatsiyadan keyin sintaksis buzildi: ${path.relative(ROOT, f)} — ${e.message}`); }
    }
    log('✓', 'Sintaksis tekshiruvi o\'tdi');

    // 5. Qurish
    if (skipBuild) {
      log('→', '--no-build berilgan, electron-builder ishga tushirilmadi');
    } else {
      console.log('\n  electron-builder ishlamoqda (bir necha daqiqa)...\n');
      // Windows'da `npx.cmd` ni execFileSync bilan chaqirish EINVAL beradi
      // (Node 20+ da .cmd fayllar shell talab qiladi). Shuning uchun
      // electron-builder'ning JS kirish nuqtasini to'g'ridan-to'g'ri
      // node bilan ishga tushiramiz — shell'ga bog'liq emas.
      const builderCli = path.join(ROOT, 'node_modules', 'electron-builder', 'out', 'cli', 'cli.js');
      if (!fs.existsSync(builderCli)) {
        throw new Error('electron-builder topilmadi: ' + builderCli);
      }
      execFileSync(process.execPath, [builderCli, '--win', '--x64'],
        { cwd: ROOT, stdio: 'inherit' });
    }
    ok = true;
  } catch (e) {
    console.error('\n  ✗ XATO:', e.message, '\n');
  } finally {
    // 6. HAR DOIM tiklash — manba kodi obfuskatsiya holida qolib ketmasin
    const n = restoreAll();
    log('↺', `${n} ta asl fayl tiklandi`);
  }

  console.log(ok ? '\n═══ TAYYOR ═══\n' : '\n═══ MUVAFFAQIYATSIZ ═══\n');
  process.exit(ok ? 0 : 1);
}

main();
