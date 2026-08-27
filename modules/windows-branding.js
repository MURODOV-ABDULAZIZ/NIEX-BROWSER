const fs = require('node:fs');
const path = require('node:path');

function resolveNiEXIcon(appRoot, resourcesPath) {
  const candidates = [
    // ENG USTUVOR: asar'dan TASHQARIDAGI real fayl (extraResources → resources/icon.ico).
    //   Windows taskbar/oyna ikonasi asar ICHIDAGI virtual faylni o'qiy OLMAYDI → agar
    //   asar ichidagi path tanlansa, Electron o'z standart logosini ko'rsatadi (taskbar
    //   branding bug). Shu sabab real fayl birinchi sinaladi.
    path.join(resourcesPath, 'icon.ico'),
    path.join(resourcesPath, 'icon.png'),
    path.join(appRoot, 'assets', 'brand', 'niex-logo.ico'),
    path.join(appRoot, 'assets', 'brand', 'niex.ico'),
    path.join(appRoot, 'assets', 'brand', 'niex-logo.png'),
    path.join(appRoot, 'assets', 'icon.ico'),
    path.join(appRoot, 'assets', 'icon.png'),
    path.join(resourcesPath, 'app', 'assets', 'brand', 'niex-logo.ico'),
    path.join(resourcesPath, 'app', 'assets', 'brand', 'niex.ico'),
    path.join(resourcesPath, 'app', 'assets', 'brand', 'niex-logo.png'),
    path.join(resourcesPath, 'app', 'assets', 'icon.ico'),
    path.join(resourcesPath, 'app', 'assets', 'icon.png'),
    path.join(resourcesPath, 'app.asar', 'assets', 'brand', 'niex-logo.ico'),
    path.join(resourcesPath, 'app.asar', 'assets', 'brand', 'niex.ico'),
    path.join(resourcesPath, 'app.asar', 'assets', 'brand', 'niex-logo.png'),
    path.join(resourcesPath, 'app.asar', 'assets', 'icon.ico'),
    path.join(resourcesPath, 'app.asar', 'assets', 'icon.png'),
  ];

  for (const candidate of candidates) {
    try {
      if (fs.existsSync(candidate)) {
        return candidate;
      }
    } catch (error) {
      // ignore and continue
    }
  }

  return undefined;
}

module.exports = {
  resolveNiEXIcon,
};
