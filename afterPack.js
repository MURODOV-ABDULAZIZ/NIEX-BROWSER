// electron-builder afterPack hook — Windows app .exe branding (icon + version info).
// ============================================================================
// Nega kerak: package.json win.signAndEditExecutable=false (winCodeSign paketi
//   Windows'da symbolic-link privilege xatosi bilan yuklanmaydi → build fail).
//   false bo'lganda electron-builder app .exe'ga icon/version JOYLAMAYDI → Electron
//   default logo qoladi. Shuning uchun bu yerda rcedit bilan QO'LDA joylaymiz.
//   rcedit — signing EMAS (winCodeSign kerak emas), faqat PE resource tahriri.
const { execFileSync } = require('child_process');
const path = require('path');
const fs = require('fs');

exports.default = async function afterPack(context) {
  if (context.electronPlatformName !== 'win32') return; // faqat Windows

  const productName = context.packager.appInfo.productFilename; // "NIEX Browser"
  const version = context.packager.appInfo.version;
  const exePath = path.join(context.appOutDir, productName + '.exe');
  const icoPath = path.join(__dirname, 'assets', 'icon.ico');
  const rcedit = path.join(__dirname, 'node_modules', 'electron-winstaller', 'vendor', 'rcedit.exe');

  if (!fs.existsSync(exePath)) { console.warn('[afterPack] .exe topilmadi:', exePath); return; }
  if (!fs.existsSync(rcedit)) { console.warn('[afterPack] rcedit topilmadi:', rcedit); return; }
  if (!fs.existsSync(icoPath)) { console.warn('[afterPack] icon.ico topilmadi:', icoPath); return; }

  try {
    execFileSync(rcedit, [exePath, '--set-icon', icoPath], { stdio: 'inherit' });
    execFileSync(rcedit, [
      exePath,
      '--set-version-string', 'ProductName', 'NIEX Browser',
      '--set-version-string', 'FileDescription', 'NIEX Browser',
      '--set-version-string', 'CompanyName', 'NIEX Ecosystem',
      '--set-version-string', 'LegalCopyright', 'Copyright (C) NIEX Ecosystem',
      '--set-version-string', 'OriginalFilename', 'NIEX Browser.exe',
      '--set-file-version', version,
      '--set-product-version', version,
    ], { stdio: 'inherit' });
    console.log('[afterPack] ✅ NIEX icon + version info joylandi:', exePath);
  } catch (e) {
    console.error('[afterPack] ❌ rcedit xato:', e.message);
    throw e; // branding muhim — jim o'tkazmaymiz
  }
};
