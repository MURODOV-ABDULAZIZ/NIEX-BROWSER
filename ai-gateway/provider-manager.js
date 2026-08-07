// ============================================================
// AI GATEWAY — PROVIDER MANAGER
// Kalitlarni BITTALAB ishlatadi. Limit tugasa (429) keyingi kalitga o'tadi.
// Bir provayderning barcha kalitlari tugasa — keyingi provayderga o'tadi.
//
// Mas'uliyat (TASK talabi):
//   - Provider priority       - Rate/daily limits (429 kuzatuvi)
//   - Health check            - Fallback / failover
//   - Retry                   - Timeout (providers.js'da)
//   - Provider selection      - API kalitlarini backend'da saqlash
//
// Kunlik reset: free limitlar har kuni yangilanadi → har kuni exhausted flaglar tozalanadi.
// Holat state.json'ga saqlanadi (restart'dan keyin ham eslab qoladi).
// ============================================================
'use strict';

const fs = require('fs');
const path = require('path');
const { loadKeys } = require('./keys');
const { PROVIDERS } = require('./providers');

// Holat fayli FOYDALANUVCHI ma'lumotlar papkasiga yoziladi, ilova papkasiga
// EMAS. Sabablar:
//   1. O'rnatilgandan keyin ilova papkasi (Program Files) yozish uchun yopiq —
//      `__dirname` ga yozish muvaffaqiyatsiz bo'lardi.
//   2. Bu faylda kalit rotatsiyasi holati (ya'ni KALITLARNING O'ZI) saqlanadi —
//      u hech qachon ilova paketiga tushmasligi kerak.
const STATE_FILE = (() => {
  try {
    const { app } = require('electron');
    if (app && app.getPath) return path.join(app.getPath('userData'), 'ai-gateway-state.json');
  } catch (e) { /* Electron tashqarisida (test) — pastdagi zaxira yo'l */ }
  return path.join(__dirname, 'state.json');
})();

function today() {
  return new Date().toISOString().slice(0, 10); // YYYY-MM-DD
}

class ProviderManager {
  constructor(logger) {
    this.log = logger || (() => {});
    this.keys = { gemini: [], openrouter: [], groq: [] };
    // slots[provider] = [{ key, exhausted, errorCount, ok, lastMs, lastUsed, requests }]
    this.slots = {};
    this.cursor = {}; // provider → joriy kalit indeksi (bittalab aylanish uchun)
    this.day = today();
    this.load();
  }

  load() {
    const loaded = loadKeys();
    this.keys = loaded;
    this.keyFile = loaded.file;

    // Har provayder uchun slot ro'yxatini quramiz
    for (const p of PROVIDERS) {
      const list = loaded[p.name] || [];
      this.slots[p.name] = list.map(key => ({
        key,
        exhausted: false,
        errorCount: 0,
        ok: 0,
        requests: 0,
        lastMs: 0,
        lastUsed: 0,
      }));
      this.cursor[p.name] = 0;
    }

    // Saqlangan holatni tiklaymiz (exhausted flaglar)
    try {
      if (fs.existsSync(STATE_FILE)) {
        const saved = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
        if (saved.day === this.day && saved.slots) {
          for (const pname of Object.keys(this.slots)) {
            const savedSlots = saved.slots[pname] || [];
            for (const s of this.slots[pname]) {
              const match = savedSlots.find(x => x.key === s.key);
              if (match) { s.exhausted = !!match.exhausted; s.ok = match.ok || 0; s.requests = match.requests || 0; }
            }
            if (typeof saved.cursor?.[pname] === 'number') this.cursor[pname] = saved.cursor[pname];
          }
        }
      }
    } catch (e) { this.log('WARN', 'gateway state load:', e.message); }

    const total = Object.values(this.slots).reduce((a, s) => a + s.length, 0);
    this.log('OK', 'AI Gateway kalitlar', `${total} ta (groq=${this.slots.groq?.length||0} gemini=${this.slots.gemini?.length||0} openrouter=${this.slots.openrouter?.length||0})`);
  }

  save() {
    try {
      const slim = {};
      for (const pname of Object.keys(this.slots)) {
        slim[pname] = this.slots[pname].map(s => ({ key: s.key, exhausted: s.exhausted, ok: s.ok, requests: s.requests }));
      }
      fs.writeFileSync(STATE_FILE, JSON.stringify({ day: this.day, slots: slim, cursor: this.cursor }, null, 2));
    } catch (e) { this.log('WARN', 'gateway state save:', e.message); }
  }

  // Yangi kun bo'lsa — free limitlar yangilanadi, exhausted flaglar tozalanadi
  checkDayRollover() {
    const d = today();
    if (d !== this.day) {
      this.day = d;
      for (const pname of Object.keys(this.slots)) {
        for (const s of this.slots[pname]) { s.exhausted = false; s.errorCount = 0; s.requests = 0; s.ok = 0; }
        this.cursor[pname] = 0;
      }
      this.log('OK', 'AI Gateway', 'yangi kun — barcha limitlar tiklandi');
      this.save();
    }
  }

  // Priority tartibida ishlaydigan provayderlar (vision kerak bo'lsa faqat vision:true)
  orderedProviders(needVision) {
    return PROVIDERS
      .filter(p => (needVision ? p.vision : true))
      .filter(p => (this.slots[p.name] || []).length > 0)
      .sort((a, b) => a.priority - b.priority);
  }

  // Provayder ichida keyingi TIRIK kalitni oladi (bittalab aylanadi)
  nextLiveSlot(pname) {
    const slots = this.slots[pname] || [];
    const n = slots.length;
    if (!n) return null;
    for (let i = 0; i < n; i++) {
      const idx = (this.cursor[pname] + i) % n;
      if (!slots[idx].exhausted) {
        this.cursor[pname] = idx; // shu kalitda qolamiz, tugaguncha
        return slots[idx];
      }
    }
    return null; // barchasi tugagan
  }

  /**
   * Asosiy kirish nuqtasi. Zararli kontentni aniqlaydi.
   * @param {{ image_base64?: string, text?: string }} payload
   * @returns {Promise<{ should_block, block_reason, provider, exhaustedAll }>}
   */
  async analyze(payload) {
    this.checkDayRollover();
    const needVision = !!payload.image_base64;
    const providers = this.orderedProviders(needVision);

    for (const p of providers) {
      // Bu provayderning tirik kalitlari tugaguncha sinaymiz
      let guard = (this.slots[p.name] || []).length;
      while (guard-- > 0) {
        const slot = this.nextLiveSlot(p.name);
        if (!slot) break; // provayder tugadi → keyingi provayder

        const t0 = Date.now();
        slot.requests++;
        try {
          const r = await p.call(slot.key, payload);
          slot.lastMs = Date.now() - t0;
          slot.lastUsed = Date.now();
          slot.ok++;
          slot.errorCount = 0;
          this.save();
          return { ...r, provider: p.name, exhaustedAll: false };
        } catch (e) {
          slot.lastMs = Date.now() - t0;
          slot.lastUsed = Date.now();
          const status = e.status || 0;

          if (status === 429 || status === 403 || status === 402 || status === 401) {
            // Limit/kvota tugadi yoki kalit yaroqsiz — bu kalitni belgilaymiz, keyingi kalitga
            slot.exhausted = true;
            this.cursor[p.name] = (this.cursor[p.name] + 1) % (this.slots[p.name].length || 1);
            this.log('WARN', `AI Gateway ${p.name}`, `kalit tugadi (${status}) → keyingisi`);
            this.save();
            continue;
          }

          // 400/404/422 — SO'ROV/MODEL xatosi. Hech qaysi kalit tuzatmaydi.
          //   Kalitlarni behuda sarflamaymiz — shu provayderdan chiqib keyingisiga o'tamiz.
          if (status === 400 || status === 404 || status === 422) {
            this.log('WARN', `AI Gateway ${p.name}`, `so'rov xatosi (${status}) → keyingi provayder`);
            break;
          }

          // Vaqtinchalik xato (timeout/5xx/network) — keyingi kalitni sinaymiz, ammo cheklangan
          slot.errorCount++;
          this.log('WARN', `AI Gateway ${p.name}`, `xato: ${e.message?.slice(0, 80)}`);
          this.cursor[p.name] = (this.cursor[p.name] + 1) % (this.slots[p.name].length || 1);
          if (slot.errorCount >= 2) break; // bu provayder ishonchsiz — keyingisiga
          continue;
        }
      }
    }

    // Barcha provayder + kalit tugadi → local AI yolg'iz himoya qiladi (fail-open, bloklamaymiz)
    this.log('WARN', 'AI Gateway', 'barcha provayderlar tugadi — local AI rejimi');
    return { should_block: false, block_reason: '', provider: 'none', exhaustedAll: true };
  }

  // Dashboard uchun holat (admin panel shu ma'lumotni o'qiydi)
  getStats() {
    this.checkDayRollover();
    const providers = PROVIDERS.map(p => {
      const slots = this.slots[p.name] || [];
      const total = slots.length;
      const exhausted = slots.filter(s => s.exhausted).length;
      const requests = slots.reduce((a, s) => a + s.requests, 0);
      const ok = slots.reduce((a, s) => a + s.ok, 0);
      const avgMs = slots.filter(s => s.lastMs).reduce((a, s, _, arr) => a + s.lastMs / arr.length, 0);
      const remaining = total - exhausted;
      return {
        name: p.name,
        priority: p.priority,
        vision: p.vision,
        status: remaining > 0 ? 'online' : 'exhausted',
        health: remaining > 0 ? 'healthy' : 'depleted',
        keys_total: total,
        keys_remaining: remaining,
        keys_exhausted: exhausted,
        percentage: total ? Math.round((remaining / total) * 100) : 0,
        requests_today: requests,
        success_today: ok,
        errors_today: requests - ok,
        avg_response_ms: Math.round(avgMs) || 0,
      };
    });
    return {
      day: this.day,
      key_file: this.keyFile || null,
      providers,
      totals: {
        keys: providers.reduce((a, p) => a + p.keys_total, 0),
        remaining: providers.reduce((a, p) => a + p.keys_remaining, 0),
        requests_today: providers.reduce((a, p) => a + p.requests_today, 0),
      },
    };
  }
}

module.exports = { ProviderManager };
