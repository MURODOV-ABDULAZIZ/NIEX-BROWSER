import fs from 'fs';
import path from 'path';
import { Parent, Child, Relationship, BlockedEvent, NotificationItem } from './types';

const DB_PATH = path.join(__dirname, '..', 'database.json');

type DB = {
  parents: Parent[];
  children: Child[];
  relationships: Relationship[];
  events: BlockedEvent[];
  notifications: NotificationItem[];
  codes: { [email: string]: { code: string; expiresAt: string } };
};

function ensureDB(): DB {
  if (!fs.existsSync(DB_PATH)) {
    const initial: DB = { parents: [], children: [], relationships: [], events: [], notifications: [], codes: {} };
    fs.writeFileSync(DB_PATH, JSON.stringify(initial, null, 2));
    return initial;
  }
  const raw = fs.readFileSync(DB_PATH, 'utf8');
  return JSON.parse(raw) as DB;
}

function writeDB(db: DB) {
  fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2));
}

export const db = {
  read(): DB {
    return ensureDB();
  },
  write(patch: Partial<DB>) {
    const cur = ensureDB();
    const next = { ...cur, ...patch } as DB;
    writeDB(next);
    return next;
  },
  pullAndWrite(cb: (cur: DB) => DB) {
    const cur = ensureDB();
    const next = cb(cur);
    writeDB(next);
    return next;
  }
};
