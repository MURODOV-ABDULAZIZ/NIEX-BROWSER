import { db } from '../database';
import { NotificationItem } from '../types';
import { v4 as uuidv4 } from 'uuid';

export function createNotification(item: Omit<NotificationItem, 'id'>) {
  const id = uuidv4();
  const n: NotificationItem = { ...item, id };
  db.pullAndWrite((cur) => {
    cur.notifications.unshift(n);
    return cur;
  });
  return n;
}

export function getNotificationsForParent(parentId: string) {
  const cur = db.read();
  return cur.notifications.filter((n) => n.parentId === parentId);
}

export function logBlockedEvent(event: { childId: string; category: string; domain: string; blocked: boolean }) {
  const cur = db.read();
  const id = uuidv4();
  const timestamp = new Date().toISOString();
  const ev = { id, childId: event.childId, timestamp, category: event.category, domain: event.domain, blocked: event.blocked };
  db.pullAndWrite((c) => {
    c.events.unshift(ev as any);
    // create notifications for each parent linked and verified
    const rels = c.relationships.filter((r) => r.childId === event.childId && r.status === 'VERIFIED');
    rels.forEach((r) => {
      const notif: NotificationItem = {
        id: uuidv4(),
        parentId: r.parentId,
        childId: event.childId,
        timestamp,
        message: `${event.childId} attempted to access blocked content: ${event.category}`,
        category: event.category,
        domain: event.domain,
        blocked: event.blocked,
        read: false
      } as NotificationItem;
      c.notifications.unshift(notif);
    });
    return c;
  });
  return ev;
}
