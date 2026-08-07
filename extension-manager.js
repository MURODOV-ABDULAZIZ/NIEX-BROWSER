/**
 * SafeNet Extension Manager v1.0
 * 
 * Manifest V2/V3 support with content script injection,
 * URL pattern matching, and chrome.* API stubs.
 * 
 * Key features:
 * - Manifest parser and validator
 * - Content script injection based on URL matching
 * - chrome.* API provisioning via preload
 * - Conflict prevention with guards
 * - State persistence
 */

const fs = require('fs');
const path = require('path');

function isLikelyHtmlPayload(text) {
  if (!text || typeof text !== 'string') return false;
  const s = text.trim().slice(0, 200).toLowerCase();
  return /^(<!doctype html|<html|<head|<body|<script)/i.test(s) || s.includes('<meta') || s.includes('<!doctype');
}

class ExtensionManager {
  constructor(extensionsDir, logger = console) {
    this.extensionsDir = extensionsDir;
    this.logger = logger;
    this.extensions = new Map();
    this.enabled = new Map();
    this.loadedScripts = new Set();
    
    try { fs.mkdirSync(extensionsDir, { recursive: true }); } catch (e) {}
  }

  loadAllExtensions() {
    this.extensions.clear();
    this.enabled.clear();
    const result = [];

    try {
      if (!fs.existsSync(this.extensionsDir)) return result;
      const dirs = fs.readdirSync(this.extensionsDir);

      for (const dir of dirs) {
        const extPath = path.join(this.extensionsDir, dir);
        const stat = fs.statSync(extPath);
        if (!stat.isDirectory()) continue;

        const extId = dir;
        const manifestPath = path.join(extPath, 'manifest.json');

        if (!fs.existsSync(manifestPath)) {
          this.log('WARN', `No manifest in ${extId}`);
          continue;
        }

        try {
          const manifest = this._loadManifest(extId, extPath);
          if (!manifest) continue;

          this.extensions.set(extId, {
            id: extId,
            manifest: manifest,
            baseDir: extPath,
            scripts: this._loadScripts(extId, manifest, extPath)
          });

          const statePath = path.join(extPath, '.enabled');
          const isEnabled = fs.existsSync(statePath) ? 
            fs.readFileSync(statePath, 'utf8').trim() === '1' : true;
          this.enabled.set(extId, isEnabled);

          result.push(this._getExtensionInfo(extId));
          this.log('OK', `Loaded ${manifest.name} v${manifest.version}`);

        } catch (e) {
          this.log('ERR', `Failed loading ${extId}:`, e.message);
        }
      }
    } catch (e) {
      this.log('ERR', 'loadAllExtensions:', e.message);
    }

    return result;
  }

  _loadManifest(extId, extPath) {
    const manifestPath = path.join(extPath, 'manifest.json');
    
    try {
      const raw = fs.readFileSync(manifestPath, 'utf8');
      const manifest = JSON.parse(raw);

      if (!manifest.name || typeof manifest.name !== 'string') {
        throw new Error('Missing/invalid name');
      }
      if (!manifest.version || typeof manifest.version !== 'string') {
        throw new Error('Missing/invalid version');
      }

      const version = manifest.manifest_version || 2;
      if (![2, 3].includes(version)) {
        throw new Error(`Unsupported manifest_version: ${version}`);
      }

      if (manifest.content_scripts && Array.isArray(manifest.content_scripts)) {
        for (const cs of manifest.content_scripts) {
          if (!Array.isArray(cs.matches) || cs.matches.length === 0) {
            throw new Error('content_script: matches array required');
          }
          if (!Array.isArray(cs.js) && !Array.isArray(cs.css)) {
            throw new Error('content_script: js or css array required');
          }
        }
      }

      if (manifest.permissions && !Array.isArray(manifest.permissions)) {
        throw new Error('permissions must be an array');
      }

      return manifest;

    } catch (e) {
      this.log('ERR', `Manifest parse ${extId}:`, e.message);
      return null;
    }
  }

  _loadScripts(extId, manifest, extPath) {
    const result = { js: [], css: [] };

    try {
      if (manifest.content_scripts && Array.isArray(manifest.content_scripts)) {
        for (const cs of manifest.content_scripts) {
          
          if (Array.isArray(cs.js)) {
            for (const jsFile of cs.js) {
              const filePath = path.join(extPath, jsFile);
              if (!fs.existsSync(filePath)) {
                this.log('WARN', `JS file not found: ${jsFile}`);
                continue;
              }
              try {
                const code = fs.readFileSync(filePath, 'utf8');
                if (isLikelyHtmlPayload(code)) {
                  this.log('WARN', `JS file looks like HTML and will be skipped: ${jsFile}`);
                  try {
                    const diagDir = path.join(__dirname, 'failed_injections');
                    fs.mkdirSync(diagDir, { recursive: true });
                    const safeName = `${extId}_${jsFile.replace(/[^a-z0-9.\-]/gi, '_')}.failed.js`;
                    const outPath = path.join(diagDir, safeName);
                    fs.writeFileSync(outPath, code, 'utf8');
                    this.log('ERR', `Saved HTML payload for ${extId} to: ${outPath}`);
                    // disable the extension to avoid repeated injections
                    try { fs.writeFileSync(path.join(extPath, '.enabled'), '0', 'utf8'); } catch {}
                  } catch (ex) { this.log('ERR', 'writing diag failed:', ex.message); }
                  continue;
                }
                result.js.push({
                  file: jsFile,
                  code: code,
                  matches: cs.matches || [],
                  runAt: cs.run_at || 'document_idle',
                  allFrames: cs.all_frames || false
                });
              } catch (e) {
                this.log('WARN', `Failed loading JS ${jsFile}:`, e.message);
              }
            }
          }

          if (Array.isArray(cs.css)) {
            for (const cssFile of cs.css) {
              const filePath = path.join(extPath, cssFile);
              if (!fs.existsSync(filePath)) {
                this.log('WARN', `CSS file not found: ${cssFile}`);
                continue;
              }
              try {
                const code = fs.readFileSync(filePath, 'utf8');
                result.css.push({
                  file: cssFile,
                  code: code,
                  matches: cs.matches || []
                });
              } catch (e) {
                this.log('WARN', `Failed loading CSS ${cssFile}:`, e.message);
              }
            }
          }
        }
      }

      if (manifest.background && manifest.manifest_version === 2) {
        if (manifest.background.scripts) {
          for (const bgFile of manifest.background.scripts) {
            const filePath = path.join(extPath, bgFile);
            if (fs.existsSync(filePath)) {
              const code = fs.readFileSync(filePath, 'utf8');
              result.js.push({
                file: bgFile,
                code: code,
                matches: ['*://*/*'],
                runAt: 'document_start',
                isBackground: true
              });
            }
          }
        }
      }

    } catch (e) {
      this.log('ERR', '_loadScripts:', e.message);
    }

    return result;
  }

  getContentScriptsForUrl(url) {
    const result = { js: [], css: [] };

    try {
      for (const [extId, ext] of this.extensions) {
        if (!this.enabled.get(extId)) continue;
        if (!ext || !ext.scripts) continue;

        for (const script of ext.scripts.js) {
          if (script.isBackground) continue;
          if (this._urlMatches(url, script.matches)) {
            result.js.push({
              extId: extId,
              file: script.file,
              code: script.code,
              runAt: script.runAt
            });
          }
        }

        for (const style of ext.scripts.css) {
          if (this._urlMatches(url, style.matches)) {
            result.css.push({
              extId: extId,
              file: style.file,
              code: style.code
            });
          }
        }
      }
    } catch (e) {
      this.log('ERR', 'getContentScriptsForUrl:', e.message);
    }

    return result;
  }

  _urlMatches(url, patterns) {
    if (!Array.isArray(patterns) || patterns.length === 0) return false;

    for (const pattern of patterns) {
      if (pattern === '<all_urls>') return true;
      if (pattern === '*') return true;

      if (this._globToRegex(pattern).test(url)) {
        return true;
      }
    }
    return false;
  }

  _globToRegex(pattern) {
    let regex = pattern
      .replace(/\./g, '\\.')
      .replace(/\?/g, '.')
      .replace(/\*/g, '.*');
    
    if (pattern.includes('file://')) {
      regex = pattern
        .replace(/\./g, '\\.')
        .replace(/\//g, '\\/')
        .replace(/\*/g, '.*');
    }

    try {
      return new RegExp('^' + regex + '$', 'i');
    } catch (e) {
      this.log('WARN', `Invalid pattern ${pattern}:`, e.message);
      return /^$/;
    }
  }

  async injectContentScripts(webContents, url, options = {}) {
    if (!webContents || webContents.isDestroyed()) return;

    const timing = options.timing || 'idle';
    const scripts = this.getContentScriptsForUrl(url);

    for (const css of scripts.css) {
      try {
        const guard = `window.__ext_css_${css.extId}_${css.file.replace(/[^a-z0-9]/gi, '_')}`;
        const wrapped = `
if (!${guard}) {
  ${guard} = true;
  const s = document.createElement('style');
  s.textContent = ${JSON.stringify(css.code)};
  s.dataset.extId = '${css.extId}';
  s.dataset.extFile = '${css.file}';
  document.head.appendChild(s);
}
`;
        await webContents.executeJavaScript(wrapped, true);
        this.log('EXT', `CSS injected: ${css.extId}/${css.file}`);
      } catch (e) {
        this.log('ERR', `CSS injection failed ${css.extId}:`, e.message);
      }
    }

    for (const script of scripts.js) {
      if (timing === 'start' && script.runAt !== 'document_start') continue;
      if (timing === 'idle' && script.runAt === 'document_start') continue;

      // build wrapped script (keep available for diagnostics)
      const guard = `window.__ext_js_${script.extId}_${script.file.replace(/[^a-z0-9]/gi, '_')}`;
      const wrapped = `
(function() {
  if (${guard}) return;
  ${guard} = true;

  window.__ext_context = {
    id: '${script.extId}',
    file: '${script.file}',
    manifest: ${JSON.stringify(this.extensions.get(script.extId).manifest)}
  };

  ${script.code}
})();
`;
      try {
        await webContents.executeJavaScript(wrapped, true);
        this.log('EXT', `Injected: ${script.extId}/${script.file} (${script.runAt})`);
        this.loadedScripts.add(`${script.extId}/${script.file}`);
      } catch (e) {
        this.log('ERR', `Script injection failed ${script.extId}:`, e.message);
        try {
          const diagDir = path.join(__dirname, 'failed_injections');
          try { fs.mkdirSync(diagDir, { recursive: true }); } catch {}
          const safeName = `${script.extId}_${script.file.replace(/[^a-z0-9.\-]/gi, '_')}.failed.js`;
          const outPath = path.join(diagDir, safeName);
          fs.writeFileSync(outPath, wrapped, 'utf8');
          this.log('ERR', `Saved failing injection to: ${outPath}`);
        } catch (ex) {
          this.log('ERR', `Failed to write diagnostics for ${script.extId}:`, ex.message);
        }
      }
    }
  }

  toggleExtension(extId, enabled) {
    const ext = this.extensions.get(extId);
    if (!ext) {
      this.log('ERR', `Extension not found: ${extId}`);
      return false;
    }

    try {
      const flagFile = path.join(ext.baseDir, '.enabled');
      fs.writeFileSync(flagFile, enabled ? '1' : '0', 'utf8');
      this.enabled.set(extId, !!enabled);
      this.log('OK', `Toggled ${ext.manifest.name}: ${enabled}`);
      return true;
    } catch (e) {
      this.log('ERR', `Toggle failed ${extId}:`, e.message);
      return false;
    }
  }

  uninstallExtension(extId) {
    const ext = this.extensions.get(extId);
    if (!ext) {
      this.log('ERR', `Extension not found: ${extId}`);
      return false;
    }

    try {
      this._rmdir(ext.baseDir);
      this.extensions.delete(extId);
      this.enabled.delete(extId);
      this.log('OK', `Uninstalled: ${extId}`);
      return true;
    } catch (e) {
      this.log('ERR', `Uninstall failed ${extId}:`, e.message);
      return false;
    }
  }

  installExtension(extId, manifestObj, filesMap) {
    try {
      const extPath = path.join(this.extensionsDir, extId);
      fs.mkdirSync(extPath, { recursive: true });

      const manifestPath = path.join(extPath, 'manifest.json');
      fs.writeFileSync(manifestPath, JSON.stringify(manifestObj, null, 2), 'utf8');

      for (const [filePath, content] of Object.entries(filesMap)) {
        const fullPath = path.join(extPath, filePath);
        const dir = path.dirname(fullPath);
        fs.mkdirSync(dir, { recursive: true });
        if (isLikelyHtmlPayload(content)) {
          this.log('ERR', `Refusing to write HTML payload as JS: ${filePath}`);
          return false;
        }
        fs.writeFileSync(fullPath, content, 'utf8');
      }

      fs.writeFileSync(path.join(extPath, '.enabled'), '1', 'utf8');

      this.log('OK', `Installed: ${extId}`);
      return true;
    } catch (e) {
      this.log('ERR', `Install failed ${extId}:`, e.message);
      return false;
    }
  }

  _getExtensionInfo(extId) {
    const ext = this.extensions.get(extId);
    if (!ext) return null;

    return {
      id: extId,
      name: ext.manifest.name,
      version: ext.manifest.version,
      description: ext.manifest.description || '',
      enabled: this.enabled.get(extId),
      icon: ext.manifest.icons ? ext.manifest.icons[128] || ext.manifest.icons[64] : null,
      permissions: ext.manifest.permissions || [],
      manifest_version: ext.manifest.manifest_version || 2
    };
  }

  listExtensions() {
    const result = [];
    for (const extId of this.extensions.keys()) {
      const info = this._getExtensionInfo(extId);
      if (info) result.push(info);
    }
    return result;
  }

  getExtension(extId) {
    return this._getExtensionInfo(extId);
  }

  _rmdir(dirPath) {
    if (!fs.existsSync(dirPath)) return;
    
    const files = fs.readdirSync(dirPath);
    for (const file of files) {
      const filePath = path.join(dirPath, file);
      const stat = fs.statSync(filePath);
      if (stat.isDirectory()) {
        this._rmdir(filePath);
      } else {
        fs.unlinkSync(filePath);
      }
    }
    fs.rmdirSync(dirPath);
  }

  log(prefix, msg, detail = '') {
    const timestamp = new Date().toLocaleTimeString();
    const message = detail ? `${msg} ${detail}` : msg;
    this.logger.log(`[${timestamp}] [${prefix}] ${message}`);
  }
}

module.exports = ExtensionManager;
