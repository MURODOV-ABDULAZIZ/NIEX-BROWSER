/**
 * SafeNet Chrome Extension System
 * ================================
 *
 * Real Chrome extensions (Manifest V2 to'liq + V3 qisman) uchun Electron
 * built-in `session.loadExtension()` orqali sinov qilingan yechim.
 *
 * ImKONIYATLAR (Electron 32+ builtin):
 *   ✅ Content scripts (matches, run_at, all_frames)
 *   ✅ Background pages (MV2)
 *   ✅ Service workers (MV3 qisman)
 *   ✅ chrome.storage.local / chrome.storage.sync
 *   ✅ chrome.runtime.sendMessage / onMessage
 *   ✅ chrome.tabs.query, chrome.tabs.sendMessage
 *   ✅ chrome.action / browser_action + popup
 *   ✅ web_accessible_resources
 *   ✅ CSP va host_permissions
 *   ⚠️  chrome.webRequest (blocking qisman)
 *   ⚠️  chrome.declarativeNetRequest (uBlock uchun)
 *   ❌ chrome.notifications (Electron alternative bor)
 *   ❌ chrome.identity (custom implementation kerak)
 *
 * ARXITEKTURA:
 *   - CHROME_EXT_DIR: userData/chrome_extensions/ — o'rnatilgan extensionlar
 *   - REGISTRY: userData/chrome_extensions.json — id, path, enabled, meta
 *   - session.defaultSession.loadExtension() — Electron native
 */

const fs = require('fs');
const path = require('path');
const { session, dialog, shell, BrowserWindow, ipcMain, app } = require('electron');

class ChromeExtensionSystem {
  constructor(userDataDir, opts = {}) {
    // opts may be: { log: console.log, icon: '/abs/path/to/icon' }
    this.userDataDir = userDataDir;
    this.logger = opts.log || console;
    this.icon = opts.icon || null;
    this.extDir = path.join(userDataDir, 'chrome_extensions');
    this.registryPath = path.join(userDataDir, 'chrome_extensions.json');
    this.loaded = new Map();   // extId → Electron Extension object
    this.registry = {};        // extId → { path, enabled, name, version, icon, permissions, installedAt }

    try { fs.mkdirSync(this.extDir, { recursive: true }); } catch {}
    this._loadRegistry();
  }

  log(prefix, msg, detail = '') {
    const t = new Date().toLocaleTimeString();
    this.logger.log(`[${t}] [CHROME-EXT ${prefix}] ${detail ? msg + ' ' + detail : msg}`);
  }

  // ============================================================
  // REGISTRY (persistence)
  // ============================================================
  _loadRegistry() {
    try {
      if (fs.existsSync(this.registryPath)) {
        this.registry = JSON.parse(fs.readFileSync(this.registryPath, 'utf8')) || {};
      }
    } catch (e) {
      this.log('WARN', 'registry load:', e.message);
      this.registry = {};
    }
  }

  _saveRegistry() {
    try {
      fs.writeFileSync(this.registryPath, JSON.stringify(this.registry, null, 2), 'utf8');
    } catch (e) {
      this.log('ERR', 'registry save:', e.message);
    }
  }

  // ============================================================
  // MANIFEST PARSE (validation)
  // ============================================================
  _parseManifest(extPath) {
    const manifestPath = path.join(extPath, 'manifest.json');
    if (!fs.existsSync(manifestPath)) throw new Error('manifest.json topilmadi');
    let raw = fs.readFileSync(manifestPath, 'utf8');
    // Chrome extension manifest'lari ba'zan JSON with comments — tozalash
    raw = raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    const m = JSON.parse(raw);

    if (!m.name || !m.version) throw new Error('name yoki version yo\'q');
    const mv = m.manifest_version || 2;
    if (![2, 3].includes(mv)) throw new Error(`manifest_version ${mv} qo'llab-quvvatlanmaydi`);

    return m;
  }

  _extractIconPath(manifest, extPath) {
    if (!manifest.icons) return null;
    const sizes = ['128', '64', '48', '32', '16'];
    for (const s of sizes) {
      if (manifest.icons[s]) {
        const p = path.join(extPath, manifest.icons[s]);
        if (fs.existsSync(p)) return p;
      }
    }
    return null;
  }

  // ============================================================
  // STARTUP — mavjud extensionlarni yuklash
  // ============================================================
  async loadAllOnStartup() {
    let count = 0;
    for (const [extId, entry] of Object.entries(this.registry)) {
      if (!entry.enabled) continue;
      try {
        await this._loadIntoElectron(extId, entry.path);
        count++;
      } catch (e) {
        this.log('ERR', `startup load ${extId}:`, e.message);
      }
    }
    this.log('OK', `startup: ${count} extension yuklandi`);
    return count;
  }

  // ============================================================
  // ELECTRON YUKLASH
  // ============================================================
  async _loadIntoElectron(extId, extPath) {
    if (!fs.existsSync(extPath)) throw new Error('Extension papkasi topilmadi: ' + extPath);
    const ext = await session.defaultSession.loadExtension(extPath, {
      allowFileAccess: true,
    });
    this.loaded.set(extId, ext);
    this.log('OK', `loaded: ${ext.name} v${ext.version} (${ext.id})`);
    return ext;
  }

  async _unloadFromElectron(extId) {
    const ext = this.loaded.get(extId);
    if (!ext) return;
    try {
      session.defaultSession.removeExtension(ext.id);
      this.loaded.delete(extId);
      this.log('OK', `unloaded: ${extId}`);
    } catch (e) {
      this.log('WARN', `unload ${extId}:`, e.message);
    }
  }

  // ============================================================
  // LOAD UNPACKED — foydalanuvchi papka tanlaydi
  // ============================================================
  async installUnpacked(parentWindow) {
    const result = await dialog.showOpenDialog(parentWindow, {
      title: 'Extension papkasini tanlang',
      properties: ['openDirectory'],
      buttonLabel: 'O\'rnatish',
    });
    if (result.canceled || !result.filePaths.length) return { ok: false, canceled: true };

    const sourceDir = result.filePaths[0];
    return await this._installFromDirectory(sourceDir);
  }

  async _installFromDirectory(sourceDir) {
    let manifest;
    try {
      manifest = this._parseManifest(sourceDir);
    } catch (e) {
      return { ok: false, error: 'Manifest xato: ' + e.message };
    }

    // Extension ID — manifest key yoki hash dan
    const extId = this._computeExtId(manifest, sourceDir);
    const destPath = path.join(this.extDir, extId);

    // Papkani nusxa olish (chunki foydalanuvchi tanlagan papkani o'chirsa muammo bo'lmasin)
    try {
      if (fs.existsSync(destPath)) this._rmrf(destPath);
      this._copyDir(sourceDir, destPath);
    } catch (e) {
      return { ok: false, error: 'Nusxa olish xatosi: ' + e.message };
    }

    // Electron'ga yuklash
    try {
      const ext = await this._loadIntoElectron(extId, destPath);
      const iconPath = this._extractIconPath(manifest, destPath);

      this.registry[extId] = {
        path: destPath,
        enabled: true,
        name: manifest.name,
        version: manifest.version,
        description: manifest.description || '',
        icon: iconPath,
        permissions: manifest.permissions || [],
        host_permissions: manifest.host_permissions || [],
        manifest_version: manifest.manifest_version || 2,
        electronId: ext.id,
        installedAt: new Date().toISOString(),
      };
      this._saveRegistry();

      return { ok: true, extension: this._info(extId) };
    } catch (e) {
      // Rollback
      try { this._rmrf(destPath); } catch {}
      return { ok: false, error: 'Yuklash xatosi: ' + e.message };
    }
  }

  // Manifest'dan yoki papka nomidan barqaror ID hisoblash
  _computeExtId(manifest, sourceDir) {
    if (manifest.key) {
      // key mavjud bo'lsa Chrome uslubidagi hash — SHA256'ning birinchi 16 hex
      const crypto = require('crypto');
      const hash = crypto.createHash('sha256').update(manifest.key).digest('hex');
      return hash.slice(0, 32);
    }
    // Aks holda name + version + sourceDir dan hash
    const crypto = require('crypto');
    const hash = crypto.createHash('sha256')
      .update(manifest.name + '|' + manifest.version + '|' + sourceDir)
      .digest('hex');
    return hash.slice(0, 32);
  }

  // ============================================================
  // CRX (Chrome Web Store zip fayllarni) o'rnatish
  // ============================================================
  async installFromCRX(crxPath) {
    if (!fs.existsSync(crxPath)) return { ok: false, error: 'CRX fayl topilmadi' };

    try {
      // CRX — ZIP fayl (magic bayt 'Cr24' bilan). Signature qismini olib tashlaymiz.
      const buffer = fs.readFileSync(crxPath);
      const zipStart = this._findZipStart(buffer);
      if (zipStart < 0) return { ok: false, error: 'CRX format tanib bo\'lmadi' };

      const zipBuf = buffer.slice(zipStart);
      const tempDir = path.join(this.extDir, '__temp_' + Date.now());
      fs.mkdirSync(tempDir, { recursive: true });

      // ZIP ochish — Electron ichida yolg'iz kutubxona bilan
      const AdmZip = this._loadAdmZip();
      if (!AdmZip) {
        this._rmrf(tempDir);
        return { ok: false, error: 'adm-zip kutubxonasi kerak. npm install adm-zip' };
      }
      const zip = new AdmZip(zipBuf);
      zip.extractAllTo(tempDir, true);

      const result = await this._installFromDirectory(tempDir);
      this._rmrf(tempDir);
      return result;
    } catch (e) {
      return { ok: false, error: 'CRX o\'rnatish xatosi: ' + e.message };
    }
  }

  _findZipStart(buf) {
    // ZIP magic: PK\x03\x04 (50 4B 03 04)
    for (let i = 0; i < buf.length - 4; i++) {
      if (buf[i] === 0x50 && buf[i+1] === 0x4B && buf[i+2] === 0x03 && buf[i+3] === 0x04) return i;
    }
    return -1;
  }

  _loadAdmZip() {
    try { return require('adm-zip'); } catch { return null; }
  }

  // ============================================================
  // ENABLE / DISABLE
  // ============================================================
  async setEnabled(extId, enabled) {
    const entry = this.registry[extId];
    if (!entry) return { ok: false, error: 'Extension topilmadi' };

    try {
      if (enabled && !this.loaded.has(extId)) {
        await this._loadIntoElectron(extId, entry.path);
      } else if (!enabled && this.loaded.has(extId)) {
        await this._unloadFromElectron(extId);
      }
      entry.enabled = enabled;
      this._saveRegistry();
      return { ok: true };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  }

  // ============================================================
  // UNINSTALL
  // ============================================================
  async uninstall(extId) {
    const entry = this.registry[extId];
    if (!entry) return { ok: false, error: 'Extension topilmadi' };

    try {
      await this._unloadFromElectron(extId);
      if (fs.existsSync(entry.path)) this._rmrf(entry.path);
      delete this.registry[extId];
      this._saveRegistry();
      return { ok: true };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  }

  // ============================================================
  // LIST / GET
  // ============================================================
  list() {
    return Object.keys(this.registry).map(id => this._info(id)).filter(Boolean);
  }

  _info(extId) {
    const entry = this.registry[extId];
    if (!entry) return null;
    const loaded = this.loaded.get(extId);
    return {
      id: extId,
      electronId: loaded?.id || entry.electronId,
      name: entry.name,
      version: entry.version,
      description: entry.description,
      icon: entry.icon,
      enabled: entry.enabled,
      permissions: entry.permissions,
      host_permissions: entry.host_permissions,
      manifest_version: entry.manifest_version,
      installedAt: entry.installedAt,
      hasPopup: !!(loaded?.manifest?.action?.default_popup || loaded?.manifest?.browser_action?.default_popup),
    };
  }

  // ============================================================
  // POPUP OCHISH — action.default_popup URL'ni yangi oynada
  // ============================================================
  openPopup(extId, parentWindow, anchor) {
    const ext = this.loaded.get(extId);
    if (!ext) return { ok: false, error: 'Extension yuklanmagan' };

    const popup = ext.manifest?.action?.default_popup
      || ext.manifest?.browser_action?.default_popup;
    if (!popup) return { ok: false, error: 'Popup mavjud emas' };

    const popupUrl = `chrome-extension://${ext.id}/${popup}`;

    const win = new BrowserWindow({
      width: 380,
      height: 500,
      x: anchor?.x,
      y: anchor?.y,
      parent: parentWindow,
      frame: false,
      resizable: false,
      alwaysOnTop: true,
      skipTaskbar: true,
      icon: this.icon,
      webPreferences: {
        session: session.defaultSession,
        nodeIntegration: false,
        contextIsolation: true,
      },
    });

    win.loadURL(popupUrl);
    // Focus yo'qolganda yopish (Chrome-like)
    win.on('blur', () => { try { win.close(); } catch {} });
    return { ok: true };
  }

  // ============================================================
  // UTILS
  // ============================================================
  _copyDir(src, dst) {
    if (!fs.existsSync(dst)) fs.mkdirSync(dst, { recursive: true });
    for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
      const s = path.join(src, entry.name);
      const d = path.join(dst, entry.name);
      if (entry.isDirectory()) this._copyDir(s, d);
      else fs.copyFileSync(s, d);
    }
  }

  _rmrf(p) {
    if (!fs.existsSync(p)) return;
    // Node 14+ da fs.rmSync bor
    if (fs.rmSync) fs.rmSync(p, { recursive: true, force: true });
    else {
      for (const f of fs.readdirSync(p)) {
        const fp = path.join(p, f);
        if (fs.statSync(fp).isDirectory()) this._rmrf(fp);
        else fs.unlinkSync(fp);
      }
      fs.rmdirSync(p);
    }
  }
}

module.exports = ChromeExtensionSystem;
