// ═══════════════════════════════════════════════════════════════════
// NIEX PROFILE MANAGER — Chrome-style multi-account support
// ═══════════════════════════════════════════════════════════════════
// Har profil o'z alohida userData papkasiga ega (cookies, cache, extensions,
// localStorage, Firebase auth state — hech biri boshqa profil bilan aralashmaydi).
//
// Profillar ro'yxati (profiles.json) hamma profillarga umumiy joyda saqlanadi:
//   %APPDATA%/niex-shared/profiles.json (Windows)
//   ~/.niex/profiles.json (Linux/Mac)
//
// Boshqa profilga o'tish uchun yangi NIEX oynasi spawn qilinadi
// (NIEX_PROFILE=<id> muhit o'zgaruvchisi bilan) — asosiy oyna buzilmaydi.

const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn } = require('child_process');

function getSharedDir() {
  // NIEX_PROFILE ta'siriga tushmaydigan doimiy yo'l
  const home = os.homedir();
  return path.join(home, '.niex-shared');
}

class ProfileManager {
  constructor() {
    this.sharedDir = getSharedDir();
    this.storePath = path.join(this.sharedDir, 'profiles.json');
    this.load();
  }

  load() {
    try {
      if (fs.existsSync(this.storePath)) {
        const raw = fs.readFileSync(this.storePath, 'utf8');
        const parsed = JSON.parse(raw);
        this.profiles = Array.isArray(parsed.profiles) ? parsed.profiles : [];
        if (this.profiles.length === 0) this._ensureDefault();
      } else {
        this._ensureDefault();
        this.save();
      }
    } catch (e) {
      console.warn('[profile-manager] load failed, resetting:', e.message);
      this._ensureDefault();
    }
  }

  _ensureDefault() {
    this.profiles = [{
      id: 'default',
      name: 'Default',
      email: null,
      avatar: null,
      color: '#00E5A0',
      createdAt: new Date().toISOString(),
      isDefault: true,
    }];
  }

  save() {
    try {
      fs.mkdirSync(this.sharedDir, { recursive: true });
      fs.writeFileSync(this.storePath, JSON.stringify({ profiles: this.profiles, version: 1 }, null, 2), 'utf8');
      return true;
    } catch (e) {
      console.warn('[profile-manager] save failed:', e.message);
      return false;
    }
  }

  list() {
    return this.profiles.slice();
  }

  getCurrent() {
    const currentId = process.env.NIEX_PROFILE || 'default';
    return this.profiles.find(p => p.id === currentId) || this.profiles[0];
  }

  getCurrentId() {
    return process.env.NIEX_PROFILE || 'default';
  }

  add({ name, color }) {
    const cleanName = String(name || '').trim();
    if (!cleanName) return { ok: false, error: 'Profil nomi bo\'sh bo\'lmasin' };
    if (cleanName.length > 40) return { ok: false, error: 'Nom juda uzun (max 40 belgi)' };
    const id = 'p_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 6);
    const palette = ['#00E5A0', '#F5A623', '#5B8FF9', '#F66E6E', '#B57BFF', '#FFD98A', '#00C885', '#FF5A6E'];
    const chosenColor = color || palette[this.profiles.length % palette.length];
    const profile = {
      id,
      name: cleanName,
      email: null,
      avatar: null,
      color: chosenColor,
      createdAt: new Date().toISOString(),
      isDefault: false,
    };
    this.profiles.push(profile);
    this.save();
    return { ok: true, profile };
  }

  remove(id) {
    if (id === 'default') return { ok: false, error: 'Standart profil o\'chirilmaydi' };
    if (id === this.getCurrentId()) return { ok: false, error: 'Faol profilni o\'chirib bo\'lmaydi. Avval boshqa profilga o\'ting.' };
    const before = this.profiles.length;
    this.profiles = this.profiles.filter(p => p.id !== id);
    if (this.profiles.length === before) return { ok: false, error: 'Profil topilmadi' };
    this.save();
    return { ok: true };
  }

  update(id, fields) {
    const p = this.profiles.find(x => x.id === id);
    if (!p) return { ok: false, error: 'Profil topilmadi' };
    const allowed = ['name', 'email', 'avatar', 'color'];
    for (const k of allowed) if (fields && fields[k] !== undefined) p[k] = fields[k];
    p.updatedAt = new Date().toISOString();
    this.save();
    return { ok: true, profile: p };
  }

  /**
   * Boshqa profilga o'tish — yangi NIEX oynasini spawn qiladi.
   * Joriy oyna buzilmaydi. Har profil o'z alohida jarayonda ishlaydi.
   */
  launch(id) {
    const profile = this.profiles.find(p => p.id === id);
    if (!profile) return { ok: false, error: 'Profil topilmadi' };

    // Bir xil profilni qayta ochish shart emas — hozirgi oynani fokus qilamiz
    if (id === this.getCurrentId()) {
      return { ok: true, alreadyActive: true };
    }

    try {
      // Dev rejim uchun: process.execPath = electron.exe, argv[1] = /path/to/main.js
      // Packaged rejim uchun: process.execPath = niex.exe, argv[1] yo'q
      const args = process.argv.slice(1);
      const env = { ...process.env };
      if (id === 'default') delete env.NIEX_PROFILE;
      else env.NIEX_PROFILE = id;

      const child = spawn(process.execPath, args, {
        env,
        detached: true,
        stdio: 'ignore',
      });
      child.unref();
      return { ok: true };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  }
}

module.exports = ProfileManager;
