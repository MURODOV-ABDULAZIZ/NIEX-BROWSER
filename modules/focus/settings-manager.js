const fs = require('fs');
const path = require('path');

class SettingsManager {
  constructor(options = {}) {
    this.storagePath = options.storagePath || path.join(process.cwd(), 'focus-settings.json');
    this.state = this._loadState();
  }

  _loadState() {
    try {
      if (!fs.existsSync(this.storagePath)) {
        return {
          theme: 'dark',
          enabled: false,
          blockCategories: [],
          customDomains: [],
          notifications: true,
          autoResume: true,
        };
      }
      return JSON.parse(fs.readFileSync(this.storagePath, 'utf8'));
    } catch (error) {
      return { theme: 'dark', enabled: false, blockCategories: [], customDomains: [], notifications: true, autoResume: true };
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

  getState() {
    return { ...this.state };
  }

  update(updates) {
    this.state = { ...this.state, ...updates };
    this._saveState();
    return this.getState();
  }
}

module.exports = SettingsManager;
