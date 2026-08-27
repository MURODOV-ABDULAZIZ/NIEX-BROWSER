const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { resolveNiEXIcon } = require('../modules/windows-branding');

test('resolves the app icon from the application root', () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'niex-icon-'));
  const appRoot = path.join(tempRoot, 'app-root');
  fs.mkdirSync(path.join(appRoot, 'assets', 'brand'), { recursive: true });
  fs.mkdirSync(path.join(appRoot, 'assets'), { recursive: true });
  const iconPath = path.join(appRoot, 'assets', 'icon.ico');
  fs.writeFileSync(iconPath, 'icon');

  const resolved = resolveNiEXIcon(appRoot, path.join(tempRoot, 'resources'));
  assert.equal(resolved, iconPath);
});

test('falls back to the unpacked packaged resources path when the app root has no icon', () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'niex-icon-'));
  const appRoot = path.join(tempRoot, 'app-root');
  const resourcesPath = path.join(tempRoot, 'resources');
  const packagedIcon = path.join(resourcesPath, 'app', 'assets', 'icon.ico');
  fs.mkdirSync(path.dirname(packagedIcon), { recursive: true });
  fs.writeFileSync(packagedIcon, 'packaged-icon');

  const resolved = resolveNiEXIcon(appRoot, resourcesPath);
  assert.equal(resolved, packagedIcon);
});

test('falls back to the asar packaged resources path when the app root has no icon', () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'niex-icon-'));
  const appRoot = path.join(tempRoot, 'app-root');
  const resourcesPath = path.join(tempRoot, 'resources');
  const packagedIcon = path.join(resourcesPath, 'app.asar', 'assets', 'icon.ico');
  fs.mkdirSync(path.dirname(packagedIcon), { recursive: true });
  fs.writeFileSync(packagedIcon, 'asar-packaged-icon');

  const resolved = resolveNiEXIcon(appRoot, resourcesPath);
  assert.equal(resolved, packagedIcon);
});
