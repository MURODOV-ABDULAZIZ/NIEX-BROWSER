const fs = require('fs');
const path = require('path');

const DEFAULT_CATEGORIES = [
  {
    id: 'social-media',
    name: 'Social Media',
    enabled: true,
    domains: ['instagram.com', 'facebook.com', 'tiktok.com', 'twitter.com', 'x.com', 'threads.net', 'snapchat.com', 'pinterest.com', 'reddit.com'],
  },
  {
    id: 'entertainment',
    name: 'Entertainment',
    enabled: true,
    domains: ['youtube.com', 'netflix.com', 'twitch.tv', 'disneyplus.com', 'primevideo.com'],
  },
  {
    id: 'news',
    name: 'News',
    enabled: true,
    domains: ['cnn.com', 'bbc.com', 'nytimes.com', 'reuters.com', 'washingtonpost.com'],
  },
  {
    id: 'gaming',
    name: 'Gaming',
    enabled: true,
    domains: ['steamcommunity.com', 'store.steampowered.com', 'epicgames.com', 'twitch.tv'],
  },
  {
    id: 'shopping',
    name: 'Shopping',
    enabled: false,
    domains: ['amazon.com', 'ebay.com', 'aliexpress.com'],
  },
  {
    id: 'ai-chat',
    name: 'AI Chat',
    enabled: false,
    domains: ['chatgpt.com', 'claude.ai', 'gemini.google.com', 'perplexity.ai'],
  },
];

class BlockEngine {
  constructor(options = {}) {
    this.storagePath = options.storagePath || path.join(process.cwd(), 'focus-blocks.json');
    this.state = this._loadState();
  }

  _loadState() {
    try {
      if (!fs.existsSync(this.storagePath)) return { categories: DEFAULT_CATEGORIES.map((category) => ({ ...category })), customDomains: [] };
      const parsed = JSON.parse(fs.readFileSync(this.storagePath, 'utf8'));
      return {
        categories: (parsed.categories || DEFAULT_CATEGORIES).map((category) => ({ ...category, domains: category.domains || [] })),
        customDomains: parsed.customDomains || [],
      };
    } catch (error) {
      return { categories: DEFAULT_CATEGORIES.map((category) => ({ ...category })), customDomains: [] };
    }
  }

  _saveState() {
    try {
      fs.mkdirSync(path.dirname(this.storagePath), { recursive: true });
      fs.writeFileSync(this.storagePath, JSON.stringify(this.state, null, 2), 'utf8');
    } catch (error) {
      // fail closed and keep state in memory
    }
  }

  normalizeDomain(raw) {
    const value = String(raw || '').trim().toLowerCase();
    if (!value) return null;
    let candidate = value;
    if (candidate.startsWith('http://') || candidate.startsWith('https://')) {
      try {
        candidate = new URL(candidate).hostname;
      } catch (error) {
        candidate = candidate.replace(/^https?:\/\//, '').replace(/\/.*$/, '');
      }
    }
    candidate = candidate.replace(/^www\./, '').replace(/\/$/, '').replace(/\/.*$/, '');
    candidate = candidate.replace(/^\*\./, '');
    if (!candidate || candidate.includes(' ')) return null;
    return candidate;
  }

  validateDomain(raw) {
    const normalized = this.normalizeDomain(raw);
    if (!normalized) return null;
    return normalized;
  }

  addCustomDomain(raw) {
    const normalized = this.validateDomain(raw);
    if (!normalized) return { ok: false, error: 'Invalid domain' };
    const exists = this.state.customDomains.some((domain) => domain === normalized || domain === `*.${normalized}`);
    if (exists) return { ok: true, duplicate: true, domain: normalized };
    this.state.customDomains.push(normalized);
    this._saveState();
    return { ok: true, domain: normalized };
  }

  removeCustomDomain(raw) {
    const normalized = this.validateDomain(raw);
    if (!normalized) return { ok: false, error: 'Invalid domain' };
    this.state.customDomains = this.state.customDomains.filter((domain) => domain !== normalized);
    this._saveState();
    return { ok: true };
  }

  setCategoryEnabled(categoryId, enabled) {
    const category = this.state.categories.find((item) => item.id === categoryId);
    if (!category) return { ok: false, error: 'Unknown category' };
    category.enabled = enabled;
    this._saveState();
    return { ok: true, category };
  }

  getCategories() {
    return this.state.categories.map((category) => ({ ...category }));
  }

  getCustomDomains() {
    return [...this.state.customDomains];
  }

  getDomainMatches(host) {
    const matches = [];
    for (const category of this.state.categories.filter((item) => item.enabled)) {
      for (const domain of category.domains || []) {
        if (this.matchesPattern(host, domain)) {
          matches.push({ categoryId: category.id, categoryName: category.name, value: domain });
          break;
        }
      }
    }
    for (const domain of this.state.customDomains) {
      if (this.matchesPattern(host, domain)) {
        matches.push({ categoryId: 'custom', categoryName: 'Custom', value: domain });
      }
    }
    return matches;
  }

  matchesPattern(host, pattern) {
    const normalizedHost = String(host || '').trim().toLowerCase();
    const normalizedPattern = String(pattern || '').trim().toLowerCase();
    if (!normalizedHost || !normalizedPattern) return false;
    if (normalizedPattern.startsWith('*.')) {
      const suffix = normalizedPattern.slice(2);
      return normalizedHost === suffix || normalizedHost.endsWith(`.${suffix}`);
    }
    return normalizedHost === normalizedPattern || normalizedHost.endsWith(`.${normalizedPattern}`);
  }

  isBlocked(url, options = {}) {
    if (!url) return false;
    let hostname = null;
    try {
      hostname = new URL(url).hostname;
    } catch (error) {
      return false;
    }
    const matches = this.getDomainMatches(hostname);
    if (matches.length > 0) {
      return { blocked: true, matches };
    }
    return { blocked: false, matches: [] };
  }
}

module.exports = BlockEngine;
module.exports.DEFAULT_CATEGORIES = DEFAULT_CATEGORIES;
