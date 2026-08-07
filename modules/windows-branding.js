const fs = require('node:fs');
const path = require('node:path');

function resolveNiEXIcon(appRoot, resourcesPath) {
  const candidates = [
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
