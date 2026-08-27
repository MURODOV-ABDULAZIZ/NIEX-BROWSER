const crypto = require('crypto');

class NotificationManager {
  constructor(options = {}) {
    this.emit = options.emit || (() => {});
    this.notifications = [];
  }

  add(message, options = {}) {
    const notification = {
      id: crypto.randomBytes(8).toString('hex'),
      message,
      level: options.level || 'info',
      createdAt: Date.now(),
      meta: options.meta || {},
    };
    this.notifications.unshift(notification);
    if (this.notifications.length > 50) this.notifications = this.notifications.slice(0, 50);
    this.emit(notification);
    return notification;
  }

  list() {
    return [...this.notifications];
  }
}

module.exports = NotificationManager;
