import { v4 as uuidv4 } from 'uuid';
import { db } from '../database';

function generateCode(): string {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

export function sendVerificationCode(email: string) {
  const code = generateCode();
  const expiresAt = new Date(Date.now() + 1000 * 60 * 15).toISOString(); // 15 minutes
  db.pullAndWrite((cur) => {
    cur.codes[email] = { code, expiresAt };
    return cur;
  });
  // In a real system: send email via SMTP with encrypted transport.
  // For demo, we store codes in DB and return the code in response for testing.
  return { id: uuidv4(), email, code, expiresAt };
}

export function verifyCode(email: string, code: string) {
  const cur = db.read();
  const entry = cur.codes[email];
  if (!entry) return { success: false, reason: 'No code sent' };
  if (new Date(entry.expiresAt) < new Date()) return { success: false, reason: 'Code expired' };
  if (entry.code !== code) return { success: false, reason: 'Invalid code' };
  // remove code after success
  db.pullAndWrite((c) => {
    delete c.codes[email];
    return c;
  });
  return { success: true };
}
