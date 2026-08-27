const fs = require('fs');
const path = require('path');

class StatisticsManager {
  constructor(options = {}) {
    this.storagePath = options.storagePath || path.join(process.cwd(), 'focus-statistics.json');
    this.state = this._loadState();
  }

  _loadState() {
    try {
      if (!fs.existsSync(this.storagePath)) {
        return {
          daily: { focusedMinutes: 0, blockedAttempts: 0, topBlockedSite: null },
          weekly: { totalFocusHours: 0, averageSessionMinutes: 0, longestSessionMinutes: 0 },
          monthly: [],
        };
      }
      return JSON.parse(fs.readFileSync(this.storagePath, 'utf8'));
    } catch (error) {
      return { daily: { focusedMinutes: 0, blockedAttempts: 0, topBlockedSite: null }, weekly: { totalFocusHours: 0, averageSessionMinutes: 0, longestSessionMinutes: 0 }, monthly: [] };
    }
  }

  _saveState() {
    try {
      fs.mkdirSync(path.dirname(this.storagePath), { recursive: true });
      fs.writeFileSync(this.storagePath, JSON.stringify(this.state, null, 2), 'utf8');
    } catch (error) {
      // allow in-memory state to persist
    }
  }

  recordSession(session) {
    const durationMinutes = session.durationMinutes || 0;
    this.state.daily.focusedMinutes += durationMinutes;
    this.state.weekly.totalFocusHours += durationMinutes / 60;
    this.state.weekly.longestSessionMinutes = Math.max(this.state.weekly.longestSessionMinutes, durationMinutes);
    this.state.weekly.averageSessionMinutes = this.state.weekly.totalFocusHours > 0 ? this.state.weekly.totalFocusHours * 60 / Math.max(1, this.state.monthly.length + 1) : 0;
    this._saveState();
    return this.getStats();
  }

  recordBlockedAttempt(url) {
    this.state.daily.blockedAttempts += 1;
    this.state.daily.topBlockedSite = url;
    this._saveState();
    return this.getStats();
  }

  getStats() {
    return {
      daily: { ...this.state.daily },
      weekly: { ...this.state.weekly },
      monthly: [...this.state.monthly],
    };
  }
}

module.exports = StatisticsManager;
