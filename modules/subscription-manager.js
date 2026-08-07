const fs = require('fs');
const path = require('path');

// PLAN DEFINITIONS — NIEX product limits (mahsulot cheklovlari).
// MUHIM: bu external AI provider (OpenAI/Gemini/Groq) quota emas.
//   Provider usage/token/xarajat — faqat Admin Dashboard'da ko'rinadi.
//   Bu yerda foydalanuvchi tarifining kunlik NIEX operatsiya limitlari.
//
// Local AI (mahalliy AI Brain) — barcha planlarda CHEKSIZ:
//   sayt/matn tahlili, browser himoyasi, real-time protection.
// Cloud AI operatsiyalari (uncertain kontent uchun) — plan bo'yicha cheklangan.
const PLAN_DEFINITIONS = {
  free: {
    id: 'free',
    name: 'Free',
    monthlyPrice: 0,
    currency: 'UZS',
    description: 'Kundalik brauzing — kunlik AI limitlari bilan',
    dailyLimits: {
      // FAQAT video AI kunlik limitli — bu resurstalab (kadr-kadr AI tahlil).
      // Boshqa hammasi CHEKSIZ (rasm, matn, sayt, deep scan, OCR, PDF).
      // Limit tugasa video AI to'xtaydi, qolgan himoya ishlashda davom etadi.
      videoMinutes: 5,     // Cloud video AI: 5 daqiqa/kun
      image:        Infinity,
      deepScan:     Infinity,
      ocr:          Infinity,
      pdf:          Infinity,
    },
    localUnlimited: true,
    limits: { imageAnalyses: Infinity, videoMinutes: 5, textAnalysis: Infinity, urlAnalysis: Infinity },
    features: {
      imageAnalysis: true, videoAnalysis: true, textAnalysis: true, urlAnalysis: true,
      focusMode: false, fasterProcessing: false, futurePremiumFeatures: false,
    },
  },
  pro: {
    id: 'pro',
    name: 'Pro',
    monthlyPrice: 7999,
    currency: 'UZS',
    description: 'Cheksiz AI tahlil va Focus Mode',
    dailyLimits: {
      // Pro'da faqat video AI kunlik cheklangan (resurstalab bo'lgani uchun).
      // Boshqa hammasi (rasm, matn, deep scan, OCR, PDF) — CHEKSIZ.
      videoMinutes: 120,
      image:        Infinity,
      deepScan:     Infinity,
      ocr:          Infinity,
      pdf:          Infinity,
    },
    localUnlimited: true,
    limits: { imageAnalyses: Infinity, videoMinutes: 120, textAnalysis: Infinity, urlAnalysis: Infinity },
    features: {
      imageAnalysis: true, videoAnalysis: true, textAnalysis: true, urlAnalysis: true,
      focusMode: true, fasterProcessing: true, futurePremiumFeatures: true,
    },
  },
};

// ACCOUNT-KEYED obuna. Har bir hisob (email) alohida obunaga ega.
//   Anonim (kirmagan) → doim Free. Pro faqat to'lov tasdiqlangach, o'sha hisobga bog'lanadi.
class SubscriptionManager {
  constructor(options = {}) {
    this.storagePath = options.storagePath || path.join(process.cwd(), 'subscription.json');
    this.currentAccount = null; // joriy kirgan foydalanuvchi email (runtime)
    this.state = this._loadState();
  }

  _loadState() {
    try {
      if (!fs.existsSync(this.storagePath)) return { accounts: {} };
      const parsed = JSON.parse(fs.readFileSync(this.storagePath, 'utf8') || '{}');
      if (parsed.accounts && typeof parsed.accounts === 'object') return { accounts: parsed.accounts };
      // ESKI format (qurilma-keng planId) — TASHLAB YUBORAMIZ.
      //   Pro endi faqat hisobga bog'lanadi; eski bepul/bypass Pro bekor qilinadi.
      return { accounts: {} };
    } catch { return { accounts: {} }; }
  }

  _saveState() {
    try { fs.mkdirSync(path.dirname(this.storagePath), { recursive: true }); fs.writeFileSync(this.storagePath, JSON.stringify(this.state, null, 2), 'utf8'); } catch {}
  }

  // Auth o'zgarganda chaqiriladi — obunani joriy hisobga moslaydi.
  setCurrentAccount(email) {
    this.currentAccount = email ? String(email).toLowerCase() : null;
    return this.getActivePlan();
  }

  _acc() {
    if (!this.currentAccount) return null;
    return this.state.accounts[this.currentAccount] || null;
  }

  getPlanById(planId) { return PLAN_DEFINITIONS[planId] || PLAN_DEFINITIONS.free; }

  getActivePlan() {
    this.checkExpiry();
    const acc = this._acc();
    return this.getPlanById(acc?.planId || 'free');
  }

  isFeatureEnabled(feature) { return !!this.getActivePlan().features[feature]; }
  getUsageLimits() { return this.getActivePlan().limits; }
  getDailyLimits() { return this.getActivePlan().dailyLimits || {}; }
  getPlans() { return Object.values(PLAN_DEFINITIONS); }

  getUpgradeOffer() {
    return {
      title: 'Focus Mode is available with Pro',
      body: 'Unlock unlimited AI analysis, unlimited video analysis, Focus Mode, and faster AI processing.',
      price: 7999, currency: 'UZS', planId: 'pro',
    };
  }

  // setPlan — endi FAQAT joriy hisob uchun (to'g'ridan-to'g'ri bepul Pro bypass OLIB TASHLANDI).
  setPlan(planId) {
    if (!this.currentAccount) return { ok: false, error: 'Avval hisobga kiring' };
    if (planId === 'pro') return this.activatePro({});
    return this.downgradeToFree('manual');
  }

  // Pro'ni JORIY hisob uchun faollashtirish (to'lov tasdiqlangach).
  // Muddat: sotib olingan vaqtdan AYNAN 30 kun (30 * months). Oy taqvimi emas —
  //   28/29/30/31 kunlik oylar bo'yicha adolatsizlik bo'lmasin.
  activatePro({ months = 1, paymentId = null } = {}) {
    if (!this.currentAccount) return { ok: false, error: 'Avval hisobga kiring' };
    const now = new Date();
    const daysToAdd = 30 * Math.max(1, months);
    const expires = new Date(now.getTime() + daysToAdd * 24 * 60 * 60 * 1000);
    const acc = this.state.accounts[this.currentAccount] || { history: [] };
    acc.planId = 'pro'; acc.activatedAt = now.toISOString(); acc.expiresAt = expires.toISOString();
    acc.history = acc.history || []; acc.history.push({ action: 'activate', paymentId, at: now.toISOString(), expiresAt: expires.toISOString() });
    this.state.accounts[this.currentAccount] = acc; this._saveState();
    return { ok: true, plan: this.getActivePlan(), activatedAt: acc.activatedAt, expiresAt: acc.expiresAt };
  }

  downgradeToFree(reason = '') {
    if (!this.currentAccount) return { ok: false, error: 'Avval hisobga kiring' };
    const acc = this.state.accounts[this.currentAccount];
    if (!acc) return { ok: true, plan: this.getActivePlan() };
    acc.planId = 'free'; acc.expiresAt = null;
    acc.history = acc.history || []; acc.history.push({ action: 'downgrade', reason, at: new Date().toISOString() });
    this._saveState();
    return { ok: true, plan: this.getActivePlan() };
  }

  checkExpiry() {
    const acc = this.currentAccount ? this.state.accounts[this.currentAccount] : null;
    if (acc && acc.planId === 'pro' && acc.expiresAt && new Date(acc.expiresAt).getTime() < Date.now()) {
      acc.planId = 'free'; acc.expiresAt = null;
      acc.history = acc.history || []; acc.history.push({ action: 'expired', at: new Date().toISOString() });
      this._saveState();
      return true;
    }
    return false;
  }

  daysRemaining() {
    const acc = this._acc();
    if (!acc || acc.planId !== 'pro' || !acc.expiresAt) return null;
    return Math.max(0, Math.ceil((new Date(acc.expiresAt).getTime() - Date.now()) / (24 * 60 * 60 * 1000)));
  }

  serialize() {
    this.checkExpiry();
    const acc = this._acc();
    const planId = acc?.planId || 'free';
    return {
      planId,
      plan: this.getPlanById(planId),
      isPro: planId === 'pro',
      account: this.currentAccount,
      loggedIn: !!this.currentAccount,
      activatedAt: acc?.activatedAt || null,
      expiresAt: acc?.expiresAt || null,
      daysRemaining: this.daysRemaining(),
    };
  }
}

module.exports = SubscriptionManager;
module.exports.PLAN_DEFINITIONS = PLAN_DEFINITIONS;
