class FocusScheduler {
  constructor() {
    this.defaultRepeat = 'none';
  }

  normalize(options = {}) {
    const now = new Date();
    const startMode = options.mode === 'scheduled' ? 'scheduled' : 'start-now';
    const repeat = options.repeat || 'none';
    const durationMinutes = Number(options.durationMinutes) || 45;
    const startTime = options.startTime || null;
    const scheduledFor = options.scheduledFor ? new Date(options.scheduledFor) : null;
    return { startMode, repeat, durationMinutes, startTime, scheduledFor, now };
  }

  getNextStartTime(options = {}, referenceDate = new Date()) {
    const normalized = this.normalize(options);
    if (normalized.startMode === 'start-now') return referenceDate;

    const base = new Date(referenceDate);
    if (normalized.scheduledFor) return new Date(normalized.scheduledFor);

    if (!normalized.startTime) {
      base.setMinutes(base.getMinutes() + 60);
      return base;
    }

    const [hour, minute] = normalized.startTime.split(':').map((value) => Number(value));
    const candidate = new Date(referenceDate);
    candidate.setHours(hour, minute, 0, 0);

    if (candidate.getTime() <= referenceDate.getTime()) {
      candidate.setDate(candidate.getDate() + 1);
    }

    if (normalized.repeat === 'weekdays') {
      const day = candidate.getDay();
      if (day === 0 || day === 6) {
        candidate.setDate(candidate.getDate() + ((day === 6) ? 2 : 1));
      }
    }

    return candidate;
  }
}

module.exports = FocusScheduler;
