// ============================================================
// PREMIUM — PAYMENT REQUEST STORE (backend, main process)
// To'lov so'rovlarini saqlaydi: pending → approved/rejected.
// Skrinshotlar diskda, metadata JSON'da. Admin panel (Lovable) shu ma'lumotni o'qiydi.
//
// XAVFSIZLIK (TASK talabi):
//   - Frontend'ga ishonmaymiz — status faqat backend'da o'zgaradi.
//   - Bir vaqtda bitta PENDING so'rov (spam/duplikat oldini olish).
//   - Har approve/reject audit log'ga yoziladi.
// ============================================================
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

class PaymentStore {
  constructor({ dir, logger } = {}) {
    this.dir = dir;
    this.shotsDir = path.join(dir, 'payment-screenshots');
    this.dataFile = path.join(dir, 'payment-requests.json');
    this.auditFile = path.join(dir, 'payment-audit.json');
    this.log = logger || (() => {});
    this.requests = [];
    this.audit = [];
    this._ensure();
    this._load();
  }

  _ensure() {
    try { fs.mkdirSync(this.shotsDir, { recursive: true }); } catch {}
  }

  _load() {
    try { if (fs.existsSync(this.dataFile)) this.requests = JSON.parse(fs.readFileSync(this.dataFile, 'utf8')) || []; } catch { this.requests = []; }
    try { if (fs.existsSync(this.auditFile)) this.audit = JSON.parse(fs.readFileSync(this.auditFile, 'utf8')) || []; } catch { this.audit = []; }
  }

  _save() {
    try { fs.writeFileSync(this.dataFile, JSON.stringify(this.requests, null, 2)); } catch (e) { this.log('WARN', 'payment save:', e.message); }
  }

  _saveAudit() {
    try { fs.writeFileSync(this.auditFile, JSON.stringify(this.audit.slice(-1000), null, 2)); } catch {}
  }

  _audit(action, meta) {
    this.audit.push({ action, ...meta, at: new Date().toISOString() });
    this._saveAudit();
  }

  hasPending(email) {
    return this.requests.some(r => r.status === 'pending' && r.email === email);
  }

  // Yangi to'lov so'rovi. base64Screenshot — data:image/... yoki toza base64.
  create({ name, email, phone, amount, txnDate, txnTime, message, base64Screenshot, ip }) {
    if (!name || !email) return { ok: false, error: 'Ism va email majburiy' };
    if (this.hasPending(email)) return { ok: false, error: 'Sizda allaqachon tekshiruvda turgan to\'lov bor' };

    const id = 'pay_' + Date.now().toString(36) + '_' + crypto.randomBytes(3).toString('hex');

    // Skrinshotni diskka saqlash (validatsiya: rasm bo'lishi va hajmi)
    let shotFile = '';
    if (base64Screenshot) {
      const m = String(base64Screenshot).match(/^data:image\/(\w+);base64,(.+)$/s);
      const ext = m ? m[1].replace('jpeg', 'jpg') : 'jpg';
      const raw = m ? m[2] : String(base64Screenshot);
      const buf = Buffer.from(raw, 'base64');
      if (buf.length > 8 * 1024 * 1024) return { ok: false, error: 'Skrinshot juda katta (max 8MB)' };
      if (buf.length < 200) return { ok: false, error: 'Skrinshot yaroqsiz' };
      shotFile = `${id}.${ext}`;
      try { fs.writeFileSync(path.join(this.shotsDir, shotFile), buf); }
      catch (e) { return { ok: false, error: 'Skrinshot saqlanmadi' }; }
    }

    const req = {
      id,
      name: String(name).slice(0, 120),
      email: String(email).slice(0, 160),
      phone: String(phone || '').slice(0, 40),
      amount: Number(amount) || 0,
      txnDate: String(txnDate || '').slice(0, 40),
      txnTime: String(txnTime || '').slice(0, 40),
      message: String(message || '').slice(0, 500),
      screenshot: shotFile,
      ip: ip || '',
      status: 'pending',
      createdAt: new Date().toISOString(),
      decidedAt: null,
      decidedBy: null,
      rejectReason: '',
    };
    this.requests.push(req);
    this._save();
    this._audit('create', { id, email });
    this.log('OK', 'Premium to\'lov so\'rovi', `${email} — ${req.amount} UZS`);
    return { ok: true, request: this._public(req) };
  }

  _public(r) {
    const { ...rest } = r;
    return rest;
  }

  list({ status, q, page = 1, pageSize = 20 } = {}) {
    let items = [...this.requests].reverse();
    if (status && status !== 'all') items = items.filter(r => r.status === status);
    if (q) {
      const s = q.toLowerCase();
      items = items.filter(r => r.name.toLowerCase().includes(s) || r.email.toLowerCase().includes(s));
    }
    const total = items.length;
    const start = (page - 1) * pageSize;
    return {
      total,
      page,
      pageSize,
      pages: Math.max(1, Math.ceil(total / pageSize)),
      items: items.slice(start, start + pageSize).map(r => this._public(r)),
    };
  }

  get(id) {
    return this.requests.find(r => r.id === id) || null;
  }

  screenshotPath(id) {
    const r = this.get(id);
    if (!r || !r.screenshot) return null;
    const p = path.join(this.shotsDir, r.screenshot);
    return fs.existsSync(p) ? p : null;
  }

  decide(id, decision, { by = 'admin', reason = '' } = {}) {
    const r = this.get(id);
    if (!r) return { ok: false, error: 'So\'rov topilmadi' };
    if (r.status !== 'pending') return { ok: false, error: `So\'rov allaqachon ${r.status}` };
    r.status = decision === 'approve' ? 'approved' : 'rejected';
    r.decidedAt = new Date().toISOString();
    r.decidedBy = by;
    if (decision === 'reject') r.rejectReason = String(reason || '').slice(0, 300);
    this._save();
    this._audit(decision, { id, email: r.email, by, reason });
    return { ok: true, request: this._public(r) };
  }

  stats() {
    const by = { pending: 0, approved: 0, rejected: 0 };
    for (const r of this.requests) by[r.status] = (by[r.status] || 0) + 1;
    return { total: this.requests.length, ...by };
  }
}

module.exports = PaymentStore;
