/**
 * NIEX — Navigation Security Guard (Redirect Protection).
 * =======================================================
 *
 * Spec "redirect blocker" PART 2/3 — markaziy navigatsiya qarori.
 *
 * MAQSAD: foydalanuvchi O'ZI kirgan saytni bloklamaslik. Faqat AVTOMATIK
 * (redirect / JS / popup) shubhali manzilni to'xtatish:
 *   sayt → reklama/skript → avto-redirect → qimor/phishing/zararli.
 *
 * SOF modul: DOM/Electron/Flutter'ga bog'liq EMAS. Node'da require, brauzerda
 * global. Har navigatsiyada API chaqirmaydi — tez, lokal, deterministik.
 *
 * Kategoriyalar (PART 3): SAFE / GAMBLING / PHISHING / MALICIOUS / SUSPICIOUS / UNKNOWN.
 * Manba turlari: user (omnibox), link (klik+gesture), js (skript, gesturesiz),
 *                redirect (HTTP 3xx), popup (avto oyna), newtab (klik bilan).
 */
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.NIEXNavGuard = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const CATEGORY = Object.freeze({
    SAFE: 'safe', GAMBLING: 'gambling', PHISHING: 'phishing',
    MALICIOUS: 'malicious', SUSPICIOUS: 'suspicious', UNKNOWN: 'unknown',
  });
  const SEVERITY = Object.freeze({ INFO: 'info', WARNING: 'warning', HIGH: 'high' });

  // Katta, ishonchli saytlar — hech qachon bloklanmaydi (false-positive himoya, Req A).
  const SAFE_ALLOWLIST = new Set([
    'google.com', 'youtube.com', 'youtu.be', 'gmail.com', 'wikipedia.org',
    'github.com', 'gitlab.com', 'stackoverflow.com', 'microsoft.com', 'apple.com',
    'facebook.com', 'instagram.com', 'twitter.com', 'x.com', 'linkedin.com',
    'telegram.org', 't.me', 'web.telegram.org', 'reddit.com', 'pinterest.com',
    'amazon.com', 'cloudflare.com', 'mozilla.org', 'openai.com', 'chatgpt.com',
    'yandex.ru', 'mail.ru', 'vk.com', 'bing.com', 'duckduckgo.com',
    'coursera.org', 'udemy.com', 'khanacademy.org', 'medium.com', 'notion.so',
    'gov.uz', 'edu.uz', 'click.uz', 'payme.uz', 'uzum.uz', 'olx.uz', 'kun.uz', 'daryo.uz',
  ]);

  // Ma'lum qimor domenlari (seed — evristika bilan kengayadi).
  const GAMBLING_DOMAINS = new Set([
    '1xbet.com', '1xbet.uz', 'mostbet.com', 'mostbet.uz', 'melbet.com',
    'parimatch.com', 'bet365.com', 'betway.com', '22bet.com', 'pin-up.casino',
    '1win.com', '1win.uz', 'betwinner.com', 'marathonbet.com', 'leonbets.com',
    'bwin.com', 'unibet.com', 'betsson.com', 'ggbet.com', 'pinup.uz',
  ]);
  // Qimor kalit so'zlari (host/path token'ida — chegara bilan).
  const GAMBLING_KW = [
    'casino', 'gambling', 'betting', 'sportsbook', 'roulette', 'blackjack',
    'baccarat', 'poker', 'slots', 'jackpot', 'wager', 'aviator', 'luckyjet',
    '1xbet', 'mostbet', 'melbet', 'parimatch', 'betwinner', 'pinup', 'pin-up',
    'qimor', 'kazino', 'stavka', 'ставк', 'казино',
  ];

  // Ma'lum zararli/scam patternlar (seed).
  const MALICIOUS_DOMAINS = new Set([]);
  // Xavfli-reputatsiyali TLD'lar (phishing/scam ko'p uchraydigan).
  const RISKY_TLDS = ['zip', 'mov', 'tk', 'ml', 'ga', 'cf', 'gq', 'top', 'xyz', 'work', 'click', 'country', 'kim', 'loan', 'download'];
  // Phishing uchun brend nomlari (host'da bo'lsa, lekin haqiqiy domen emas).
  const BRANDS = {
    paypal: ['paypal.com'], apple: ['apple.com', 'icloud.com'], google: ['google.com', 'youtube.com', 'gmail.com'],
    microsoft: ['microsoft.com', 'live.com', 'office.com', 'outlook.com'], amazon: ['amazon.com'],
    facebook: ['facebook.com', 'fb.com'], instagram: ['instagram.com'], telegram: ['telegram.org', 't.me'],
    binance: ['binance.com'], sberbank: ['sberbank.ru'], mastercard: ['mastercard.com'],
    payme: ['payme.uz'], uzcard: ['uzcard.uz'], humocard: ['humocard.uz'],
    netflix: ['netflix.com'], whatsapp: ['whatsapp.com'], tbcbank: ['tbcbank.uz'],
    kapitalbank: ['kapitalbank.uz'], hamkorbank: ['hamkorbank.uz'],
  };
  const CREDENTIAL_PATHS = ['login', 'signin', 'sign-in', 'verify', 'secure', 'account', 'update', 'wallet', 'confirm', 'password', 'billing', 'unlock', 'recover'];
  // Redirect/reklama vositasi hostlari (zanjirda uchrasa xavf ishorasi).
  const REDIRECT_SERVICE_HINTS = ['redirect', 'redir', 'track', 'click', 'ads', 'adserv', 'promo', 'offer', 'bit.ly', 'tinyurl', 'cutt.ly', 'goo.gl', 'ow.ly', 't.co', 'shorturl', 'linktr'];

  // Mashhur reklama/analitika tarmoqlari — bular sub-resource BEACON (reklama piksel/
  //   konversiya), TOP-LEVEL tahdid EMAS. Redirect-protection bularni BUTUN sahifa
  //   sifatida bloklamasligi kerak: masalan BMW sahifasidagi doubleclick konversiya
  //   beacon'i "double-CLICK" tarkibidagi 'click' hint tufayli SUSPICIOUS bo'lib butun
  //   BMW sahifasini bloklardi (false-positive). Reklamaning o'zini ad-blocker alohida
  //   (sub-resource) hal qiladi — bu yerda faqat butun-sahifa blokini oldini olamiz.
  const AD_ANALYTICS_DOMAINS = new Set([
    'doubleclick.net', 'googlesyndication.com', 'google-analytics.com', 'googletagmanager.com',
    'googleadservices.com', 'adservice.google.com', 'scorecardresearch.com', 'adnxs.com',
    'criteo.com', 'taboola.com', 'outbrain.com', 'amazon-adsystem.com', 'rubiconproject.com',
    'facebook.net', 'connect.facebook.net', 'clarity.ms', 'hotjar.com', 'pubmatic.com', 'casalemedia.com',
  ]);

  function hostFromUrl(url) {
    if (!url) return '';
    let h = String(url).trim();
    try {
      if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(h)) h = 'http://' + h;
      h = new URL(h).hostname;
    } catch {
      h = String(url).replace(/^[a-z]+:\/\//i, '').split('/')[0].split('?')[0];
    }
    return h.toLowerCase().replace(/^www\./, '');
  }
  function pathFromUrl(url) {
    try {
      let h = String(url).trim();
      if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(h)) h = 'http://' + h;
      const u = new URL(h);
      return (u.pathname + ' ' + u.search).toLowerCase();
    } catch { return ''; }
  }
  function registrable(host) {
    const parts = String(host).split('.');
    if (parts.length <= 2) return host;
    // Ikki bo'lakli ikkilamchi TLD (co.uk, com.uz) — sodda MVP: oxirgi 2 yoki 3.
    const secondLevel = ['co', 'com', 'net', 'org', 'gov', 'edu', 'ac'];
    if (secondLevel.includes(parts[parts.length - 2])) return parts.slice(-3).join('.');
    return parts.slice(-2).join('.');
  }
  function tldOf(host) { const p = String(host).split('.'); return p[p.length - 1] || ''; }
  function isIpHost(host) { return /^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.indexOf(':') !== -1 && /^[0-9a-f:]+$/i.test(host); }
  // So'z-chegarali kalit qidiruv (substring FP oldini oladi: "reset"≠"bet").
  function hasKw(text, kw) {
    try {
      const esc = kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const startW = /[\p{L}\p{N}]/u.test(kw[0]);
      const endW = /[\p{L}\p{N}]/u.test(kw[kw.length - 1]);
      return new RegExp((startW ? '(?<![\\p{L}\\p{N}])' : '') + esc + (endW ? '(?![\\p{L}\\p{N}])' : ''), 'iu').test(text);
    } catch { return text.indexOf(kw) !== -1; }
  }

  /**
   * URL manzilini klassifikatsiya qiladi.
   * @returns {{category, score, signals: string[], host, domain}}
   */
  function classifyUrl(url, opts = {}) {
    const host = hostFromUrl(url);
    const signals = [];
    if (!host) return { category: CATEGORY.UNKNOWN, score: 0, signals: ['no-host'], host: '', domain: '' };
    const domain = registrable(host);
    const path = pathFromUrl(url);
    const hostPath = host + ' ' + path;

    // 0) SAFE allowlist — qisqa yopilish (faqat aniq domen; TLD emas — .uz ni ochiq qoldirmaslik).
    if (SAFE_ALLOWLIST.has(domain) || SAFE_ALLOWLIST.has(host)) {
      return { category: CATEGORY.SAFE, score: 0, signals: ['allowlist'], host, domain };
    }
    // 0b) Reklama/analitika tarmog'i — butun-sahifa redirect blokidan ozod (ad-blocker
    //     ularni sub-resource sifatida alohida hal qiladi). BMW-doubleclick FP oldini oladi.
    if (AD_ANALYTICS_DOMAINS.has(domain) || AD_ANALYTICS_DOMAINS.has(host)) {
      return { category: CATEGORY.SAFE, score: 0, signals: ['ad-analytics-network'], host, domain };
    }

    let score = 0;
    const add = (pts, sig) => { score += pts; signals.push(sig); };

    // 1) MALICIOUS — ma'lum ro'yxat.
    if (MALICIOUS_DOMAINS.has(domain)) { add(100, 'malware-list'); return { category: CATEGORY.MALICIOUS, score, signals, host, domain }; }

    // 2) GAMBLING — ro'yxat yoki kalit.
    let gambling = false;
    if (GAMBLING_DOMAINS.has(domain) || GAMBLING_DOMAINS.has(host)) { add(90, 'gambling-list'); gambling = true; }
    else { for (const kw of GAMBLING_KW) { if (hasKw(hostPath, kw)) { add(40, 'gambling-kw:' + kw); gambling = true; break; } } }
    // "bet" — juda umumiy; faqat host'da mustaqil token bo'lsa (bet365 emas, "bet." / "-bet")
    if (!gambling && /(^|[.\-])bet([.\-]|s?\d|$)/i.test(host)) { add(35, 'gambling-bet-host'); gambling = true; }

    // 3) PHISHING — brend nomi host'da, lekin haqiqiy domen emas.
    let phishing = false;
    for (const brand of Object.keys(BRANDS)) {
      if (hasKw(host, brand) && !BRANDS[brand].includes(domain)) {
        add(45, 'brand-lookalike:' + brand);
        phishing = true;
        // Credential path bo'lsa — kuchli signal.
        if (CREDENTIAL_PATHS.some(p => hasKw(path, p))) add(35, 'brand+credential-path');
        break;
      }
    }
    // Punycode (xn--) — homoglif hujum ishorasi.
    if (host.indexOf('xn--') !== -1) { add(40, 'punycode'); phishing = true; }
    // IP-literal host — deyarli hech qachon qonuniy top-level nav emas.
    if (isIpHost(host)) { add(45, 'ip-host'); phishing = true; }

    // 4) SUSPICIOUS — kuchsizroq ishoralar.
    const hyphens = (host.match(/-/g) || []).length;
    if (hyphens >= 4) add(25, 'many-hyphens');
    if (RISKY_TLDS.includes(tldOf(host))) add(20, 'risky-tld');
    const subdepth = host.split('.').length;
    if (subdepth >= 5) add(20, 'deep-subdomains');
    if (host.length >= 40) add(15, 'long-host');
    // Redirect zanjirida vositachi hostlar.
    const chain = Array.isArray(opts.redirectChain) ? opts.redirectChain : [];
    if (chain.length >= 3) add(20, 'long-redirect-chain');
    if (REDIRECT_SERVICE_HINTS.some(h => host.indexOf(h) !== -1)) add(15, 'redirect-service-host');

    // Kategoriya tanlash — eng kuchli guruh.
    let category = CATEGORY.UNKNOWN;
    if (score >= 90 && gambling) category = CATEGORY.GAMBLING;
    else if (phishing && score >= 60) category = CATEGORY.PHISHING;
    else if (gambling && score >= 35) category = CATEGORY.GAMBLING;
    else if (score >= 55) category = CATEGORY.SUSPICIOUS;
    else if (score >= 30) category = CATEGORY.SUSPICIOUS;
    else category = CATEGORY.UNKNOWN;

    return { category, score, signals, host, domain };
  }

  const AUTOMATIC = new Set(['js', 'redirect', 'popup']);

  /**
   * Navigatsiya qarori.
   * @param {{url, source, redirectChain?}} input
   * @returns {{allow, block, category, score, reason, severity, source, host}}
   */
  function decide(input = {}) {
    const url = input.url || '';
    const source = input.source || 'user';
    if (!url || /^(about:|data:|blob:|chrome:|devtools:|file:|javascript:)/i.test(url)) {
      return { allow: true, block: false, category: CATEGORY.SAFE, score: 0, reason: 'non-web', severity: SEVERITY.INFO, source, host: '' };
    }
    const c = classifyUrl(url, { redirectChain: input.redirectChain });
    const automatic = AUTOMATIC.has(source);
    let block = false;

    switch (c.category) {
      case CATEGORY.SAFE:
        block = false; break;
      case CATEGORY.MALICIOUS:
        block = true; break; // har doim
      case CATEGORY.PHISHING:
        // Ishonchli phishing — har doim; kuchsiz + foydalanuvchi qo'lida — o'tkazamiz (FP oldini olish).
        block = automatic || c.score >= 75; break;
      case CATEGORY.GAMBLING:
        // Foydalanuvchi O'ZI kirsa — bloklamaymiz (spec). Avto-redirect — bloklaymiz.
        block = automatic; break;
      case CATEGORY.SUSPICIOUS:
        block = automatic; break; // faqat avtomatik nav'da
      default: // UNKNOWN
        block = false; break;
    }

    const severity = c.category === CATEGORY.MALICIOUS || c.category === CATEGORY.PHISHING
      ? SEVERITY.HIGH
      : (c.category === CATEGORY.GAMBLING ? SEVERITY.WARNING : SEVERITY.INFO);

    return {
      allow: !block, block,
      category: c.category, score: c.score, signals: c.signals,
      reason: block ? reasonText(c.category, source) : 'allowed',
      severity, source, host: c.host,
    };
  }

  // Credential POST uchun ISHONCHLI cross-origin hostlar (qonuniy SSO/to'lov).
  const TRUSTED_CRED_HOSTS = new Set([
    'google.com', 'accounts.google.com', 'apple.com', 'appleid.apple.com',
    'microsoft.com', 'live.com', 'login.microsoftonline.com', 'okta.com',
    'auth0.com', 'onelogin.com', 'pingidentity.com', 'stripe.com', 'paypal.com',
    'checkout.stripe.com', 'facebook.com', 'github.com', 'gitlab.com',
  ]);

  /**
   * SAHIFA KONTENTINI tahlil qiladi (list-free phishing aniqlash).
   * Faqat credential/to'lov formasi bo'lgan sahifalar tahlil qilinadi — 99% oddiy
   * sahifa umuman tegilmaydi. Haqiqiy brend O'Z domenida → hech qachon bloklanmaydi.
   *
   * @param {{url, title?, hasPassword?, sensitiveKinds?:string[], formActionHosts?:string[]}} sig
   * @returns {{phishing, score, category, reason, signals: string[]}}
   */
  function analyzePage(sig = {}) {
    const url = sig.url || '';
    const host = hostFromUrl(url);
    if (!host) return { phishing: false, score: 0, category: CATEGORY.UNKNOWN, reason: '', signals: ['no-host'] };
    const pageDomain = registrable(host);

    // Haqiqiy katta/brend domenlar — HAQIQIY login sahifalar HECH QACHON bloklanmaydi (FP himoya, Req A).
    if (SAFE_ALLOWLIST.has(pageDomain) || SAFE_ALLOWLIST.has(host)) {
      return { phishing: false, score: 0, category: CATEGORY.SAFE, reason: '', signals: ['allowlist'] };
    }
    // Brend domenlarining o'zi (login.microsoftonline.com kabi) — xavfsiz.
    for (const reals of Object.values(BRANDS)) if (reals.includes(pageDomain)) {
      return { phishing: false, score: 0, category: CATEGORY.SAFE, reason: '', signals: ['brand-own-domain'] };
    }

    const hasPassword = !!sig.hasPassword;
    const sensitive = Array.isArray(sig.sensitiveKinds) ? sig.sensitiveKinds : [];
    const hasCredential = hasPassword || sensitive.length > 0;
    // GATE: credential/to'lov formasi bo'lmasa — tahlil qilinmaydi (oddiy sahifa xavfsiz).
    if (!hasCredential) return { phishing: false, score: 0, category: CATEGORY.UNKNOWN, reason: '', signals: ['no-credential-form'] };

    const title = String(sig.title || '').toLowerCase();
    const signals = [];
    let score = 0;

    // 1) BRAND IMPERSONATION — brend nomi host/title'da, lekin domen brendniki EMAS.
    //    Host'da (ajratuvchi bilan, masalan "facebook-login") — kuchli, kam-FP.
    //    Title'da — kuchsizroq (yakka o'zi bloklamaydi — "Apple Orchard" kabi FP oldini olish).
    let impersonated = null;
    for (const brand of Object.keys(BRANDS)) {
      const inHost = hasKw(host, brand);
      const inTitle = hasKw(title, brand);
      if ((inHost || inTitle) && !BRANDS[brand].includes(pageDomain)) {
        impersonated = brand;
        if (inHost) { score += 55; signals.push('brand-in-host:' + brand); }
        if (inTitle) { score += 30; signals.push('brand-in-title:' + brand); }
        break;
      }
    }

    // 2) Shubhali domen + credential (punycode/IP/lookalike/risky-tld/ko'p-defis...).
    const cls = classifyUrl(url);
    const domainSuspicious = [CATEGORY.PHISHING, CATEGORY.SUSPICIOUS, CATEGORY.MALICIOUS, CATEGORY.GAMBLING].includes(cls.category)
      || cls.signals.some(s => /^(punycode|ip-host|brand-lookalike|risky-tld|many-hyphens|deep-subdomains)/.test(s));
    if (domainSuspicious) { score += 40; signals.push('credential-on-suspicious-domain'); }

    // 3) Cross-origin credential POST — parol/karta BOSHQA (ishonchsiz) domenga yuboriladi.
    const actions = Array.isArray(sig.formActionHosts) ? sig.formActionHosts : [];
    for (const a of actions) {
      const ad = registrable(a);
      if (ad && ad !== pageDomain && !SAFE_ALLOWLIST.has(ad) && !TRUSTED_CRED_HOSTS.has(ad) && !TRUSTED_CRED_HOSTS.has(a)) {
        score += 40; signals.push('cross-origin-cred-post:' + ad); break;
      }
    }

    // 4) Karta/CVV/OTP kabi yuqori-xavf inputlar shubhali domenda (legit checkout buzilmaydi:
    //    faqat domen shubhali YOKI brend soxtalashtirilgan bo'lsa).
    const highRisk = sensitive.some(k => ['card', 'cvv', 'cvc', 'iban', 'otp', 'ssn', 'pin'].includes(k));
    if (highRisk && (domainSuspicious || impersonated)) {
      score += 20; signals.push('payment-input-risky');
      // To'liq karta olish (raqam + CVV birga) — klassik data harvesting.
      if (sensitive.includes('card') && (sensitive.includes('cvv') || sensitive.includes('cvc'))) {
        score += 15; signals.push('full-card-capture');
      }
    }

    const phishing = score >= 65;
    return {
      phishing, score,
      category: phishing ? CATEGORY.PHISHING : CATEGORY.UNKNOWN,
      reason: phishing ? 'Firibgar (phishing) sahifa aniqlandi — maʼlumotlaringizni oʻgʻirlashga urinish. NIEX bloklandi.' : '',
      signals,
    };
  }

  function reasonText(category, source) {
    const src = source === 'redirect' ? 'Avtomatik yo\'naltirish' : (source === 'popup' ? 'Avtomatik oyna' : (source === 'js' ? 'Skript yo\'naltirishi' : 'Navigatsiya'));
    const cat = {
      [CATEGORY.GAMBLING]: 'qimor sayti',
      [CATEGORY.PHISHING]: 'firibgar (phishing) sayt',
      [CATEGORY.MALICIOUS]: 'zararli sayt',
      [CATEGORY.SUSPICIOUS]: 'shubhali manzil',
    }[category] || 'shubhali manzil';
    return `${src} ${cat}ga urindi — NIEX bloklandi.`;
  }

  return { classifyUrl, decide, analyzePage, CATEGORY, SEVERITY, hostFromUrl, registrable,
    _lists: { SAFE_ALLOWLIST, GAMBLING_DOMAINS, GAMBLING_KW } };
}));
