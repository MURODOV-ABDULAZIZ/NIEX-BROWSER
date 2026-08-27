/**
 * Niex Brauzer v8
 * - Content filter (YouTube + DDG + barcha saytlar)
 * - Multi-window (yangi oyna)
 * - AI: URL + matn + rasm (preload bridge orqali)
 */
const { app, BrowserWindow, BrowserView, ipcMain, Menu, dialog, Notification } = require('electron');
const path = require('path');
const fs = require('fs');

// Windows Branding: Set AppUserModelID to match package.json appId
// This ensures the taskbar icon and shortcuts are correctly associated with the NIEX icon.
if (process.platform === 'win32') {
  app.setAppUserModelId('com.niex.browser');
  try { app.setAppDetails({ appIconPath: process.execPath, relaunchIconPath: process.execPath }); } catch (_) {}
}

// Chrome UA — Google/Facebook/Microsoft/Apple OAuth Electron useragent'ini bloklaydi
// ("disallowed_useragent" xatosi). "Electron/x.y" va app nomi olib tashlansa,
// Continue with Google popup'i, hisob chooser va callback to'g'ri ishlaydi.
try {
  const chromeVer = (process.versions && process.versions.chrome) || '130.0.0.0';
  const plat = process.platform === 'darwin'
    ? 'Macintosh; Intel Mac OS X 10_15_7'
    : (process.platform === 'win32' ? 'Windows NT 10.0; Win64; x64' : 'X11; Linux x86_64');
  app.userAgentFallback = `Mozilla/5.0 (${plat}) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${chromeVer} Safari/537.36`;
} catch (e) {}

// Sec-CH-UA CLIENT HINTS — UA satri toza bo'lsa ham, Electron o'zini client-hints
//   (sec-ch-ua) orqali OSHKOR qiladi. Google embedded'ni SHUNDAN aniqlaydi va OAuth'ni
//   bloklaydi ("This browser or app may not be secure"). Hint'larни TOZA Chrome qilamiz
//   (brand'дан Electron/NIEX olib tashlanadi). onBeforeSendHeaders'да qo'llanadi.
const _CH_VER = (process.versions && process.versions.chrome) || '130.0.0.0';
const _CH_MAJOR = _CH_VER.split('.')[0];
const SEC_CH_UA = `"Chromium";v="${_CH_MAJOR}", "Not=A?Brand";v="24", "Google Chrome";v="${_CH_MAJOR}"`;
const SEC_CH_UA_FULL = `"Chromium";v="${_CH_VER}", "Not=A?Brand";v="24.0.0.0", "Google Chrome";v="${_CH_VER}"`;
const _CH_PLATFORM = process.platform === 'darwin' ? '"macOS"' : (process.platform === 'win32' ? '"Windows"' : '"Linux"');
// X-Client-Data — haqiqiy Chrome Google saytlariga yuboradigan "variations" imzosi.
//   Electron uni YUBORMAYDI → Google embedded'ni shundan ham aniqlashi mumkin. Real
//   Chrome stable qiymati. FAQAT Google domenlariga qo'shiladi (boshqa saytga leak yo'q).
//   Bu 4-qatlam urinish; Google server-tomon bloki uchun kafolat BERMAYDI.
const X_CLIENT_DATA = 'CIW2yQEIorbJAQipncoBCMKcygEIkqHLAQiUoM0BCLKKzgEI3ZbOARijl84B';
// Google first-party login (accounts.google.com) va Google servislari host'lari.
const _GOOGLE_HOST_RX = /(^|\.)(google\.com|youtube\.com|googleusercontent\.com|gstatic\.com|ytimg\.com|google\.co\.[a-z]+)$/i;

// CDP userAgentMetadata — navigator.userAgentData.brands'ga "Google Chrome" QO'SHADI.
//   Ildiz sabab (diagnostika bilan tasdiqlandi): Electron brands = [Chromium, Not/A)Brand]
//   — "Google Chrome" YO'Q. Google shundan "haqiqiy Chrome emas → embedded" deb bloklaydi.
//   CDP.Emulation.setUserAgentOverride brands'ni to'g'irlaydi VA navigator.webdriver'ni
//   false qoldiradi (automation deb belgilamaydi) — test bilan tasdiqlandi.
const CHROME_BRANDS = [
  { brand: 'Not)A;Brand', version: '99' },
  { brand: 'Google Chrome', version: _CH_MAJOR },
  { brand: 'Chromium', version: _CH_MAJOR },
];
const CHROME_FULL_BRANDS = [
  { brand: 'Not)A;Brand', version: '99.0.0.0' },
  { brand: 'Google Chrome', version: _CH_VER },
  { brand: 'Chromium', version: _CH_VER },
];
const _UAD_PLATFORM = process.platform === 'darwin' ? 'macOS' : (process.platform === 'win32' ? 'Windows' : 'Linux');
const _UAD_PLATVER = process.platform === 'win32' ? '15.0.0' : (process.platform === 'darwin' ? '14.0.0' : '6.5.0');
// Web-content webContents'ga "Google Chrome" identitetini beradi (Google OAuth blokidan qochish).
//   MUHIM: cross-origin navigatsiyada (youtube→google) renderer process ALMASHADI (site
//   isolation) → CDP override YO'QOLADI. Shuning uchun har main-frame navigatsiya boshida
//   override QAYTA yuboriladi (Google sahifasi scriptларidan oldin). DevTools ochilса → jim.
const _UA_METADATA = {
  brands: CHROME_BRANDS,
  fullVersionList: CHROME_FULL_BRANDS,
  fullVersion: _CH_VER,
  platform: _UAD_PLATFORM, platformVersion: _UAD_PLATVER,
  architecture: 'x86', model: '', mobile: false, bitness: '64', wow64: false,
};
function _sendUAOverride(dbg) {
  try { dbg.sendCommand('Emulation.setUserAgentOverride', { userAgent: app.userAgentFallback, acceptLanguage: 'en-US,en', userAgentMetadata: _UA_METADATA }).catch(() => {}); } catch (_) {}
}
// JS-tomon spoof — HAR yangi hujjatда document-start'да navigator.userAgentData'ni "Google
//   Chrome" qiladi. setUserAgentOverride joriy navigatsiyага KECH qolса ham bu kafolatlaydi
//   (Google scriptidan OLDIN ishlaydi). String-concat — template-literal escaping yo'q.
const UAD_SPOOF_JS =
  "(function(){try{" +
  "var M='" + _CH_MAJOR + "',V='" + _CH_VER + "',P='" + _UAD_PLATFORM + "',PV='" + _UAD_PLATVER + "';" +
  "var b=[{brand:'Not)A;Brand',version:'99'},{brand:'Google Chrome',version:M},{brand:'Chromium',version:M}];" +
  "var f=[{brand:'Not)A;Brand',version:'99.0.0.0'},{brand:'Google Chrome',version:V},{brand:'Chromium',version:V}];" +
  "var u={brands:b,mobile:false,platform:P,getHighEntropyValues:function(){return Promise.resolve({architecture:'x86',bitness:'64',model:'',platform:P,platformVersion:PV,uaFullVersion:V,fullVersionList:f,brands:b,mobile:false,wow64:false});},toJSON:function(){return{brands:b,mobile:false,platform:P};}};" +
  "Object.defineProperty(navigator,'userAgentData',{get:function(){return u;},configurable:true});" +
  "}catch(e){}})();";
function applyChromeIdentity(wc) {
  return; // DISABLED: Attaching a CDP debugger triggers Google's anti-bot detection and breaks Google/YouTube sign-in ("This browser or app may not be secure"). User-Agent and HTTP header spoofing in onBeforeSendHeaders is sufficient.
  if (!wc || wc.isDestroyed() || wc.__niexChromeId) return;
  // MUHIM: flag ATTACH MUVAFFAQIYATIDAN KEYIN o'rnatiladi (aks holda xato bo'lса keyingi
  //   urinishlar ham skip bo'lardi). Xatolar LOUD log qilinadi (jim yutilmaydi).
  const dbg = wc.debugger;
  try {
    if (!(dbg.isAttached && dbg.isAttached())) dbg.attach('1.3');
  } catch (e) { L('🎭', 'ATTACH-XATO:', e.message); return; }
  wc.__niexChromeId = true;
  L('🎭', 'ATTACH ok, brand override qo\'llandi');
  _sendUAOverride(dbg);
  dbg.sendCommand('Page.enable').catch((e) => L('🎭', 'Page.enable xato:', e.message));
  dbg.sendCommand('Page.addScriptToEvaluateOnNewDocument', { source: UAD_SPOOF_JS })
    .then(() => L('🎭', 'JS-spoof ulandi (document-start)'))
    .catch((e) => L('🎭', 'addScript XATO:', e.message));
  wc.on('did-start-navigation', (_e, _url, _inPlace, isMainFrame) => { if (isMainFrame) _sendUAOverride(dbg); });
  wc.on('did-start-loading', () => _sendUAOverride(dbg));
  // DIAGNOSTIKA — Google sahifada nima ko'rsatilyapti: HAR nav-eventда, redirect ham.
  // Google "signin/rejected" sahifasini aniqlab, foydalanuvchiga yordamchi modal ko'rsatamiz.
  //   Diagnostika (kerak bo'lса `NIEX_UA_DEBUG=1` env bilan yoqiladi).
  const DIAG = process.env.NIEX_UA_DEBUG === '1';
  const runCheck = (label) => {
    if (!DIAG) return;
    try {
      const u = (wc.getURL && wc.getURL()) || '';
      if (!/accounts\.google\.com|\/signin|oauth|youtube\.com|pinterest\.com/i.test(u)) return;
      wc.executeJavaScript("(function(){try{var d=navigator.userAgentData;return (d?JSON.stringify(d.brands):'NO')+'|wd='+navigator.webdriver;}catch(e){return 'ERR:'+e.message;}})()")
        .then((r) => L('🎭', 'ID [' + label + ']', String(r || '(bosh)'))).catch(() => {});
    } catch (_) {}
  };
  // Eslatma: Google "Continue with Google" embedded brauzerda ishlamaydi (Google server-tomon
  //   bloki — barcha Electron/CEF ilovalarga tegishli). BIZ FOYDALANUVCHINI TASHQI BRAUZERGA
  //   YO'NALTIRMAYMIZ (o'z productdan raqobatchiga yuborish — zarar). Saytlarga email/parol
  //   bilan kirish ishlaydi. Identity spoof (UA/brands) qoldiriladi — zararsiz.
  wc.on('did-finish-load', () => { runCheck('finish'); });
  if (DIAG) {
    wc.on('did-navigate', (_e, url) => { L('🎭', 'NAV', String(url).slice(0, 80)); runCheck('nav'); });
    wc.on('did-navigate-in-page', () => runCheck('inpage'));
  }
}

// FedCM (Federated Credential Management) — Chromium'da API mavjud, ammo Google IdP
// Electron'ni FedCM uchun ishonchli hisoblamaydi va har chaqiruvda NetworkError qaytaradi.
// Natijada Google GSI "cool down" ga tushib butun One Tap va Continue with Google
// ishlamay qoladi. Yechim: FedCM'ni Chromium darajasida O'CHIRISH — Pinterest va boshqa
// GSI ishlatgan saytlar avtomatik POPUP MODE fallback ga o'tadi va setWindowOpenHandler
// popup'ni ochib beradi. Bu switch app.whenReady() dan avval chaqirilishi shart.
try {
  app.commandLine.appendSwitch('disable-features', 'FedCm,FedCmAuthz,FedCmMultipleIdentityProviders,FedCmButtonMode,FedCmIdPRegistration,FedCmIframeOrigin,FedCmMetricsEndpoint,WebIdentityDigitalCredentials');
} catch (e) {}

(function loadEnv() {
  try {
    const { app } = require('electron');
    const path = require('path');
    const fs = require('fs');
    
    // Check multiple locations for .env (dev + production)
    const candidates = [
      path.join(__dirname, '.env'),                           // Development
    ];
    
    // Add production paths only if available
    try {
      if (process.resourcesPath) {
        candidates.push(path.join(process.resourcesPath, '.env'));
      }
    } catch (e) {}
    
    try {
      const appPath = app.getAppPath();
      if (appPath) {
        candidates.push(path.join(appPath, '.env'));
      }
    } catch (e) {}
    
    let loaded = false;
    for (const p of candidates) {
      if (fs.existsSync(p)) {
        const fileEnv = {};
        for (const line of fs.readFileSync(p, 'utf8').split('\n')) {
          const t = line.trim();
          if (!t || t.startsWith('#')) continue;
          const i = t.indexOf('=');
          if (i === -1) continue;
          const k = t.slice(0, i).trim();
          let v = t.slice(i + 1).trim();
          if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
          fileEnv[k] = v;
        }
        for (const [k, v] of Object.entries(fileEnv)) {
          process.env[k] = v;
        }
        console.log('[loadEnv] Loaded .env from:', p);
        loaded = true;
        break;
      }
    }
    if (!loaded) {
      console.log('[loadEnv] No .env file found. Checked:', candidates.join(', '));
    }
  } catch (e) {
    console.error('[loadEnv] Error:', e.message);
  }
})();

// PRODUCTION fallback: `.env` build'ga kirmaydi (build.files "!**/.env") — shuning uchun
//   o'rnatilgan .exe'da process.env bo'sh bo'lardi va Google OAuth/Firebase ISHLAMASDI.
//   PUBLIC qiymatlarni (desktop OAuth — RFC 8252 "public"; Firebase — client-side ochiq)
//   config-public.js dan to'ldiramiz. `.env` (dev) mavjud bo'lsa USTUN turadi (faqat
//   BO'SH qiymatlar to'ldiriladi). MAXFIY AI kalitlar bu yerda YO'Q — ular backend'da.
(function loadPublicConfig() {
  try {
    const pub = require('./config-public');
    for (const k in pub) { if (!process.env[k]) process.env[k] = pub[k]; }
  } catch (e) { console.warn('[config-public] yuklanmadi:', e.message); }
})();

// Debug: Log OAuth config at startup
console.log('[OAuth Config] __dirname:', __dirname);
console.log('[OAuth Config] process.resourcesPath:', process.resourcesPath);
const aiDirect = require('./safenet-ai.js');
const aiGateway = require('./ai-gateway/gateway.js'); // Provider Manager (30+ kalit rotatsiyasi)
const browserCloud = require('./cloud/browser-cloud.js'); // Lovable bulut ulanishi (feedback, notif)
const http = require('http');
const crypto = require('crypto');
const { shell } = require('electron');
const ExtensionManager = require('./extension-manager.js');
const ChromeExtensionSystem = require('./chrome-extension-system.js');
const { resolveNiEXIcon } = require('./modules/windows-branding');
const SubscriptionManager = require('./modules/subscription-manager');
const UsageManager = require('./modules/usage-manager');
const ProfileManager = require('./modules/profile-manager');
const profileManager = new ProfileManager();
const BlockEngine = require('./modules/focus/block-engine');
const FocusScheduler = require('./modules/focus/scheduler');
const FocusManager = require('./modules/focus/focus-manager');
const SettingsManager = require('./modules/focus/settings-manager');
const StatisticsManager = require('./modules/focus/statistics-manager');
const NotificationManager = require('./modules/focus/notification-manager');
const FocusAI = require('./modules/focus/focus-ai');
const { createExitMonitor, attachElectron } = require('./modules/focus/focus-exit-monitor');
const { createScrollGuardian } = require('./modules/focus/scroll-guardian');
const passwordStore = require('./modules/passwords/password-store');
// Activity Intelligence (Parental Control PART 1-4) — yagona model + klassifikator + local store.
const ActivityModel = require('./modules/activity/activity-model');
const ContentClassifier = require('./modules/activity/content-classifier');
const ActivityStore = require('./modules/activity/activity-store');
const { createAccountant } = require('./modules/activity/activity-accountant');
// Redirect Protection — markaziy navigatsiya xavfsizlik qarori (sof modul).
const NavGuard = require('./modules/security/nav-guard');
const BrowserDetect = require('./modules/browser-detect'); // boshqa brauzerlarni ANIQLASH (o'chirmaydi)
// Voice Agent — STT provider (Prompt 2). Kalit MAIN'da (ai-gateway), renderer'ga berilmaydi.
const { createSttProvider } = require('./modules/voice/stt-provider');
// Voice Agent — interpreter + engine (Prompt 3/4). Qwen serversiz mock bilan ishlaydi.
const VoiceSchema = require('./modules/voice/action-schema');
const { createCommandInterpreter } = require('./modules/voice/command-interpreter');
const { createCommandLLM } = require('./modules/voice/qwen-provider');
const { createActionEngine } = require('./modules/voice/action-engine');
const { VOICE_ACTION_FN } = require('./voice-actions');

function normFunctionsUrl(u) {
  const s = (u || '').trim();
  if (!s) return '';
  return s.endsWith('/') ? s : s + '/';
}

// Faqat skript auto-yangilanishi uchun (ixtiyoriy; odatda o‘chiq — Supabase Storage ishlatilmaydi)
const SCRIPT_UPDATE_BASE = normFunctionsUrl(process.env.SAFENET_SCRIPT_UPDATE_URL || '');
const CACHE_MS = 5 * 60 * 1000;

// ── API: faqat .env dagi Groq / OpenRouter / Gemini (Supabase yo'q) ──

let CFG = { ai: true, img: true, yt: true, ab: true };

// ── LOG ──
const L = (e,m,d='') => console.log(`[${new Date().toLocaleTimeString()}] ${e} ${m}`, String(d));
const SEP = () => console.log('─'.repeat(50));

// ── CONTENT FILTER + MONITOR + AI SCRIPTS + KB ──
let FILTER_JS  = '';
let MONITOR_JS = '';
let KB_ENC_BASE64 = '';
let TFJS_CODE = '';
let NSFWJS_CODE = '';
let NSFWJS_MODEL_CODE = '';
let NSFWJS_WEIGHTS_CODE = '';

let BLOCK_REPORTER_JS = '';
let AUTOFILL_JS = '';        // parol avtoto'ldirish skripti (har sahifaga inject)
let PARENT_CONTROL_HANDLER_JS = '';
let YT_BOOST_JS = '';
try {
  YT_BOOST_JS = fs.readFileSync(path.join(__dirname, 'youtube-boost.js'), 'utf8');
} catch (e) { console.warn('[boot] youtube-boost.js not found:', e.message); }

// Focus scroll-detection (PART 1): core (state machine) + detector (DOM glue).
// Har http(s) sahifaga inject qilinadi; feed bo'lmasa amalda no-op.
let SCROLL_INJECT_JS = '';
try {
  const _sCore = fs.readFileSync(path.join(__dirname, 'modules', 'focus', 'scroll-activity-core.js'), 'utf8');
  const _sDet = fs.readFileSync(path.join(__dirname, 'scroll-detector.js'), 'utf8');
  SCROLL_INJECT_JS = _sCore + '\n;\n' + _sDet;
} catch (e) { console.warn('[boot] scroll-detector not found:', e.message); }

// Redirect Protection PART 3 — list-free phishing content scanner (har sahifaga inject).
let PHISHING_SCAN_JS = '';
try {
  PHISHING_SCAN_JS = fs.readFileSync(path.join(__dirname, 'phishing-scan.js'), 'utf8');
} catch (e) { console.warn('[boot] phishing-scan.js not found:', e.message); }

// Voice Agent UI (Prompt 5) — recorder + orchestrator + mic tugmasi. FAQAT NIEX
// ichki file:// sahifalariga inject qilinadi (mic data:-origin toolbar'da ishlamaydi).
let VOICE_UI_JS = '';
try {
  const _vr = fs.readFileSync(path.join(__dirname, 'voice-recorder.js'), 'utf8');
  const _vw = fs.readFileSync(path.join(__dirname, 'voice-wake.js'), 'utf8');
  const _va = fs.readFileSync(path.join(__dirname, 'modules', 'voice', 'voice-agent.js'), 'utf8');
  const _vu = fs.readFileSync(path.join(__dirname, 'voice-ui.js'), 'utf8');
  VOICE_UI_JS = _vr + '\n;\n' + _vw + '\n;\n' + _va + '\n;\n' + _vu;
} catch (e) { console.warn('[boot] voice-ui not found:', e.message); }

function loadScripts() {
  try {
    FILTER_JS = fs.readFileSync(path.join(__dirname, 'contentfilter.js'), 'utf8');
    L('OK','contentfilter.js', FILTER_JS.length + ' bayt');
  } catch(e) { L('ERR','contentfilter.js:', e.message); }

  try {
    MONITOR_JS = fs.readFileSync(path.join(__dirname, 'monitor.js'), 'utf8');
    L('OK','monitor.js', MONITOR_JS.length + ' bayt');
  } catch(e) { L('WARN','monitor.js:', e.message); }

  try {
    const kbBuf = fs.readFileSync(path.join(__dirname, 'kb.enc'));
    KB_ENC_BASE64 = kbBuf.toString('base64');
    L('OK','kb.enc', (kbBuf.length / 1024).toFixed(0) + ' KB');
  } catch(e) { L('WARN','kb.enc:', e.message); }

  try {
    BLOCK_REPORTER_JS = fs.readFileSync(path.join(__dirname, 'parental-control', 'block-reporter.js'), 'utf8');
    L('OK','block-reporter.js', BLOCK_REPORTER_JS.length + ' bayt');
  } catch(e) { L('WARN','block-reporter.js:', e.message); }

  try {
    AUTOFILL_JS = fs.readFileSync(path.join(__dirname, 'modules', 'passwords', 'autofill.js'), 'utf8');
    L('OK','autofill.js', AUTOFILL_JS.length + ' bayt');
  } catch(e) { L('WARN','autofill.js:', e.message); }
}
loadScripts();

  // ═══════════════════════════════════════════════════════════════════════════════
  // GOOGLE OAUTH PKCE — Native Desktop Authentication for Electron
  // ═══════════════════════════════════════════════════════════════════════════════
  // Uses Google Cloud Desktop App Client ID (installed application type).
  // Flow: PKCE authorization code -> token exchange -> ID token -> Firebase signInWithCredential
  // ═══════════════════════════════════════════════════════════════════════════════

  function generateCodeVerifier() {
    const array = new Uint8Array(32);
    crypto.randomFillSync(array);
    return Buffer.from(array).toString('base64url');
  }

  function generateCodeChallenge(verifier) {
    return crypto.createHash('sha256').update(verifier).digest('base64url');
  }

  function generateState() {
    const array = new Uint8Array(16);
    crypto.randomFillSync(array);
    return Buffer.from(array).toString('base64url');
  }

  // .env build'ga KIRMAYDI (package.json build.files: "!**/.env") — shuning uchun
  // o'rnatilgan .exe'da process.env bo'sh bo'ladi va OAuth ishlamasdi. Client ID
  // (ochiq identifikator, sir emas) va secret kodga fallback qilinadi: dev'da
  // .env, production'da bu qiymatlar ishlatiladi.
  //
  // XAVFSIZROQ ALTERNATIVA: Google Cloud'da "Desktop app" tipidagi OAuth client
  // yaratsangiz clientSecret UMUMAN KERAK EMAS (faqat PKCE) — o'shanda
  // GOOGLE_CLIENT_SECRET_FALLBACK ni bo'sh qoldiring. Hozirgi client "Web" tipida
  // bo'lgani uchun secret talab qilinadi (u desktop ilovada baribir bo'lishi shart).
  async function performGoogleOAuthPKCE(sender) {
    const clientId = process.env.GOOGLE_CLIENT_ID || '';
    const clientSecret = process.env.GOOGLE_CLIENT_SECRET || '';

    if (!clientId) {
      return { ok: false, error: 'GOOGLE_CLIENT_ID not configured' };
    }

    const codeVerifier = generateCodeVerifier();
    const codeChallenge = generateCodeChallenge(codeVerifier);
    const state = generateState();

    // Create a local HTTP server to receive the OAuth callback
    return new Promise((resolve) => {
      let authWin = null;
      const server = http.createServer(async (req, res) => {
        const url = new URL(req.url, `http://localhost:${server.address().port}`);

        if (url.pathname === '/oauth2redirect') {
          const code = url.searchParams.get('code');
          const receivedState = url.searchParams.get('state');
          const error = url.searchParams.get('error');

          if (error) {
            res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
            res.end('<h1>Authentication failed</h1><p>Error: ' + error + '</p><script>window.close()</script>');
            server.close();
            resolve({ ok: false, error: `OAuth error: ${error}` });
            return;
          }

          if (receivedState !== state) {
            res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
            res.end('<h1>Authentication failed</h1><p>Invalid state parameter</p><script>window.close()</script>');
            server.close();
            resolve({ ok: false, error: 'Invalid state parameter' });
            return;
          }

          if (!code) {
            res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
            res.end('<h1>Authentication failed</h1><p>No authorization code received</p><script>window.close()</script>');
            server.close();
            resolve({ ok: false, error: 'No authorization code received' });
            return;
          }

          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
          res.end(`
            <html><body style="font-family:system-ui;padding:40px;text-align:center">
              <h1>✅ Authentication successful</h1>
              <p>You can close this window.</p>
              <script>window.close()</script>
            </body></html>
          `);

          try {
            // Exchange authorization code for tokens
            const tokenParams = new URLSearchParams({
              code: code,
              client_id: clientId,
              code_verifier: codeVerifier,
              redirect_uri: `http://localhost:${server.address().port}/oauth2redirect`,
              grant_type: 'authorization_code',
            });

            if (clientSecret) {
              tokenParams.set('client_secret', clientSecret);
            }

            const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
              method: 'POST',
              headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
              body: tokenParams.toString(),
            });

            if (!tokenResponse.ok) {
              const errText = await tokenResponse.text();
              throw new Error(`Token exchange failed: ${tokenResponse.status} ${errText}`);
            }

            const tokens = await tokenResponse.json();
            const idToken = tokens.id_token;
            const accessToken = tokens.access_token;
            const refreshToken = tokens.refresh_token;

            if (!idToken) {
              throw new Error('No ID token in response');
            }

            // Google userinfo API — foydalanuvchi profilini olamiz.
            // Bu Firebase'ga bog'liq bo'lmagan mustaqil manba (Chrome ham shuni ishlatadi).
            // Shu bilan Firebase'ning `auth/invalid-credential` (client_id mos kelmaslik)
            // muammosini butunlay chetlab o'tamiz.
            let profile = null;
            try {
              const uiRes = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
                headers: { Authorization: 'Bearer ' + accessToken }
              });
              if (uiRes.ok) {
                const ui = await uiRes.json();
                profile = {
                  id: ui.id || null,
                  email: ui.email || null,
                  name: ui.name || ui.email || null,
                  givenName: ui.given_name || null,
                  familyName: ui.family_name || null,
                  picture: ui.picture || null,
                  verifiedEmail: !!ui.verified_email,
                };
              }
            } catch (e) {
              console.warn('[oauth] userinfo fetch failed:', e.message);
            }

            server.close();
            try { if (authWin && !authWin.isDestroyed()) authWin.close(); } catch (e) {}
            resolve({ ok: true, idToken, accessToken, refreshToken, profile });
          } catch (e) {
            server.close();
            resolve({ ok: false, error: String(e) });
          }
          return;
        }

        // Default response for other paths
        res.writeHead(404);
        res.end('Not found');
      });

      server.listen(0, 'localhost', () => {
        const port = server.address().port;
        const authUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth');
        authUrl.searchParams.set('client_id', clientId);
        authUrl.searchParams.set('redirect_uri', `http://localhost:${port}/oauth2redirect`);
        authUrl.searchParams.set('response_type', 'code');
        authUrl.searchParams.set('scope', 'openid email profile');
        authUrl.searchParams.set('code_challenge', codeChallenge);
        authUrl.searchParams.set('code_challenge_method', 'S256');
        authUrl.searchParams.set('state', state);
        authUrl.searchParams.set('access_type', 'offline');
        // select_account → HISOB TANLASH oynasi. NIEX'ga kirilgan BARCHA Google
        // hisoblari ro'yxati chiqadi (Chrome'dagi kabi tez davom etish uchun).
        // 'consent' edi — u har safar rozilik ekranini majburlab, chooser'ni
        // ko'rsatmasdi.
        authUrl.searchParams.set('prompt', 'select_account');

        // MUHIM: auth sahifasini TIZIM (default) brauzerда ochamiz — Google FAQAT
        //   haqiqiy brauzerга ishonadi. Embedded oyna (BrowserWindow) "This browser or
        //   app may not be secure" bilan BLOKLANADI (Electron useragent toza bo'lsa ham,
        //   Google embedded-webview'ni aniqlaydi). Callback loopback server orqali qaytadi
        //   (http://localhost:PORT/oauth2redirect) — RFC 8252 "OAuth for Native Apps"
        //   standarti, Google rasman shuni tavsiya qiladi. authWin YARATILMAYDI.
        //   Eslatma: hisob tanlash tizim brauzeridagi Google sessiyalarini ko'rsatadi
        //   (odatda foydalanuvchining asosiy hisobi — shunda ham qulay, ham ISHLAYDI).
        try {
          shell.openExternal(authUrl.toString()).catch((e) => {
            server.close();
            resolve({ ok: false, error: 'Brauzerni ochib bo\'lmadi: ' + e.message });
          });
        } catch (e) {
          server.close();
          resolve({ ok: false, error: 'Failed to open browser: ' + e.message });
        }
      });

      server.on('error', (e) => {
        resolve({ ok: false, error: 'Server error: ' + e.message });
      });

      // Timeout after 3 minutes
      setTimeout(() => {
        server.close();
        resolve({ ok: false, error: 'Authentication timeout' });
      }, 180000);
    });
  }

  // TF.js va nsfwjs — sayt CSP tomonidan bloklamaslik uchun main.js orqali
// executeJavaScript orqali (script tag emas) inject qilamiz.
// Birinchi run'da CDN'dan yuklab, ai/ papkaga cache qilamiz.
async function loadAIScripts() {
  const aiDir = path.join(__dirname, 'ai');
  const tfLocal = path.join(aiDir, 'tf.min.js');
  const nsfwLocal = path.join(aiDir, 'nsfwjs.min.js');
  try { fs.mkdirSync(aiDir, { recursive: true }); } catch {}

  try {
    if (fs.existsSync(tfLocal)) {
      TFJS_CODE = fs.readFileSync(tfLocal, 'utf8');
      L('OK','tf.min.js (local)', (TFJS_CODE.length / 1024).toFixed(0) + ' KB');
    } else {
      const r = await fetch('https://cdn.jsdelivr.net/npm/@tensorflow/tfjs@4.22.0/dist/tf.min.js');
      TFJS_CODE = await r.text();
      try { fs.writeFileSync(tfLocal, TFJS_CODE, 'utf8'); } catch {}
      L('OK','tf.min.js (CDN)', (TFJS_CODE.length / 1024).toFixed(0) + ' KB');
    }
  } catch(e) { L('WARN','tf.js yuklanmadi:', e.message); }

  try {
    if (fs.existsSync(nsfwLocal)) {
      NSFWJS_CODE = fs.readFileSync(nsfwLocal, 'utf8');
      L('OK','nsfwjs.min.js (local)', (NSFWJS_CODE.length / 1024).toFixed(0) + ' KB');
    } else {
      const r = await fetch('https://cdn.jsdelivr.net/npm/nsfwjs@4.3.0/dist/browser/nsfwjs.min.js');
      NSFWJS_CODE = await r.text();
      try { fs.writeFileSync(nsfwLocal, NSFWJS_CODE, 'utf8'); } catch {}
      L('OK','nsfwjs.min.js (CDN)', (NSFWJS_CODE.length / 1024).toFixed(0) + ' KB');
    }
  } catch(e) { L('WARN','nsfwjs yuklanmadi:', e.message); }

  // Model vaznlari — nsfwjs.load() uchun window.model va window.group1_shard1of1 kerak
  const modelLocal = path.join(aiDir, 'nsfwjs-model.min.js');
  const weightsLocal = path.join(aiDir, 'nsfwjs-weights.min.js');
  try {
    if (fs.existsSync(modelLocal)) {
      NSFWJS_MODEL_CODE = fs.readFileSync(modelLocal, 'utf8');
      L('OK','nsfwjs-model (local)', (NSFWJS_MODEL_CODE.length / 1024).toFixed(0) + ' KB');
    }
  } catch(e) { L('WARN','nsfwjs model:', e.message); }
  try {
    if (fs.existsSync(weightsLocal)) {
      NSFWJS_WEIGHTS_CODE = fs.readFileSync(weightsLocal, 'utf8');
      L('OK','nsfwjs-weights (local)', (NSFWJS_WEIGHTS_CODE.length / 1024).toFixed(0) + ' KB');
    }
  } catch(e) { L('WARN','nsfwjs weights:', e.message); }
}
loadAIScripts().then(() => L('OK','AI scripts tayyor'))
  .catch(e => L('ERR','AI scripts:', e.message));

// ALOHIDA PROFIL — bitta kompyuterda bir nechta mustaqil brauzer ishga tushirish uchun.
//   Standart holatda Electron'ning barcha instance'lari BIR XIL userData papkasini
//   ishlatadi → bir xil hisob, bir xil browserId (bulut uchun BITTA qurilma).
//   Ota/farzandni bitta mashinada sinash uchun:  NIEX_PROFILE=child npm start
//   Har profil o'z hisobi, o'z browserId'si va o'z sozlamalariga ega bo'ladi.
if (process.env.NIEX_PROFILE) {
  const base = app.getPath('userData');
  const profileDir = `${base}-${String(process.env.NIEX_PROFILE).replace(/[^\w-]/g, '')}`;
  app.setPath('userData', profileDir);
  app.setPath('sessionData', profileDir);
}

if (process.defaultApp) {
  if (process.argv.length >= 2) {
    app.setAsDefaultProtocolClient('niex', process.execPath, [path.resolve(process.argv[1])]);
  }
} else {
  app.setAsDefaultProtocolClient('niex');
}

// BITTA PROFIL = BITTA INSTANCE.
//   Ikki jarayon bitta userData'ni ochsa, storage qulflanadi:
//     "LOCK: Access denied", "Could not open the quota database, resetting"
//   → cookie / localStorage / login SAQLANMAYDI (har ochganda yo'qoladi).
//   Lock userData'ga bog'liq: NIEX_PROFILE bilan boshqa profil ochilsa,
//   u boshqa papka — ikkalasi bemalol yonma-yon ishlaydi.
if (!app.requestSingleInstanceLock()) {
  console.log('Niex allaqachon ishlayapti (shu profil). Mavjud oyna fokuslanadi.');
  app.exit(0);
} else {
  app.on('second-instance', (event, commandLine, workingDirectory) => {
    try {
      let promoCode = null;
      const urlArg = commandLine.find(arg => arg.startsWith('niex://offer/'));
      if (urlArg) {
        promoCode = urlArg.split('niex://offer/')[1];
      }

      const list = BrowserWindow.getAllWindows();
      if (list.length) {
        const w = list[0];
        if (w.isMinimized()) w.restore();
        w.show();
        w.focus();
        if (promoCode && w.appWin) {
          w.appWin.createTab('file://' + path.join(__dirname, 'premium.html') + '?promo=' + promoCode);
        }
      }
    } catch {}
  });
}

let initialPromoCode = null;
const initialUrlArg = process.argv.find(arg => arg.startsWith('niex://offer/'));
if (initialUrlArg) {
  initialPromoCode = initialUrlArg.split('niex://offer/')[1];
}

// ── OYNA / VAZIFALAR PANELI IKONASI ──────────────────────────────
// Ilgari `NIEX_ICON` faqat BrowserWindow opsiyasida ishlatilgan, lekin
// HECH QAYERDA E'LON QILINMAGAN edi — bu oyna yaratilganda ReferenceError
// berardi va Electron o'zining standart logosini ko'rsatardi.
// Endi mavjud fayllar navbat bilan sinaladi; birortasi topilmasa `undefined`
// qaytariladi (ilova baribir ishlaydi, faqat standart ikona bo'ladi).
const NIEX_ICON = (function () {
  const appRoot = app.getAppPath();
  const resourcesPath = process.resourcesPath || '';
  return resolveNiEXIcon(appRoot, resourcesPath);
})();

const USER_DATA = app.getPath('userData');
const SETTINGS_FILE = path.join(USER_DATA, 'settings.json');
const HISTORY_FILE  = path.join(USER_DATA, 'history.json');
const AUTH_FILE     = path.join(USER_DATA, 'auth.json');
const EXT_DIR       = path.join(USER_DATA, 'extensions');
const EXT_METADATA  = path.join(EXT_DIR, 'extensions.json');
const SUBSCRIPTION_FILE = path.join(USER_DATA, 'subscription.json');
const USAGE_FILE = path.join(USER_DATA, 'usage.json');
const FOCUS_STATE_FILE = path.join(USER_DATA, 'focus-sessions.json');
const FOCUS_SETTINGS_FILE = path.join(USER_DATA, 'focus-settings.json');
const FOCUS_BLOCKS_FILE = path.join(USER_DATA, 'focus-blocks.json');
const FOCUS_STATS_FILE = path.join(USER_DATA, 'focus-statistics.json');
const ACTIVITY_FILE = path.join(USER_DATA, 'activity.json');

let extensionManager = null;
let subscriptionManager = null;
let usageManager = null;
let blockEngine = null;
let focusScheduler = null;
let focusManager = null;
let focusSettingsManager = null;
let focusStatisticsManager = null;
let focusNotificationManager = null;
let lastUsageNotificationLevel = null;
// PART 2 — exit intervention holati
let exitMonitor = null;
let interventionWin = null;
let interventionCtx = null;
// Scroll-detection — har webContents uchun oxirgi xabar qilingan sahifa-cumulative
// scrolling vaqti (delta hisoblash uchun).
const scrollByWc = new Map();
// PART 2 — always-on scrolling guardian (Pro userlar uchun, Focus sessiyasiz ham).
let scrollGuardian = null;
let lastScrollWc = null;   // oxirgi feed-scroll qilingan webContents (overlay/cheklov uchun)
// ACTIVITY INTELLIGENCE — local store + wall-clock accountant (alohida modul).
let activityStore = null;
let activityAccountant = null;

function ensureAppData() {
  try { fs.mkdirSync(USER_DATA, { recursive: true }); } catch (e) {}
}
function ensureExtDir() { try { fs.mkdirSync(EXT_DIR, { recursive: true }); } catch (e) {} }
function loadJson(filePath, fallback) {
  try {
    if (!fs.existsSync(filePath)) return fallback;
    const raw = fs.readFileSync(filePath, 'utf8');
    return JSON.parse(raw || 'null') || fallback;
  } catch (e) {
    console.warn('loadJson failed', filePath, e.message);
    return fallback;
  }
}
function saveJson(filePath, data) {
  try { fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8'); } catch (e) { console.warn('saveJson failed', filePath, e.message); }
}

function isLikelyHtmlPayload(text) {
  if (!text || typeof text !== 'string') return false;
  const snippet = text.trim().slice(0, 200).toLowerCase();
  return /^(<!doctype html|<html|<head|<body|<script)/i.test(snippet) || snippet.includes('<meta') || snippet.includes('<!doctype');
}

ensureAppData();
const DEFAULT_SETTINGS = { lang:'uz', ai:true, img:true, yt:true, ab:true };
let SETTINGS = Object.assign({}, DEFAULT_SETTINGS, loadJson(SETTINGS_FILE, DEFAULT_SETTINGS));
let HISTORY = loadJson(HISTORY_FILE, []);
let AUTH_STORAGE = loadJson(AUTH_FILE, { profile:null, tokens:null });
let EXTENSIONS = [];

subscriptionManager = new SubscriptionManager({ storagePath: SUBSCRIPTION_FILE });
// Obuna joriy hisobga bog'lanadi. MUHIM: login email disk'da (AUTH_FILE) bo'sh bo'lsa ham
//   (Google login faqat renderer localStorage'da saqlangan bo'lishi mumkin), currentAccount'ni
//   NULL qilib TIKLANGAN hisobni (constructor lastAccount'dan) O'CHIRMAYMIZ — aks holda voice/
//   focus/redirect Pro bo'la turib ilova ochilishida "Premium oling" derди (currentAccount null →
//   free). Faqat email HAQIQATAN bor bo'lsa o'rnatamiz; yo'q bo'lsa lastAccount saqlanib qoladi.
if (AUTH_STORAGE?.profile?.email) subscriptionManager.setCurrentAccount(AUTH_STORAGE.profile.email);
usageManager = new UsageManager({ subscriptionManager, storagePath: USAGE_FILE, secret: process.env.SAFENET_USAGE_SECRET || 'safenet-usage-v1' });
blockEngine = new BlockEngine({ storagePath: FOCUS_BLOCKS_FILE });
focusScheduler = new FocusScheduler();
focusSettingsManager = new SettingsManager({ storagePath: FOCUS_SETTINGS_FILE });
focusStatisticsManager = new StatisticsManager({ storagePath: FOCUS_STATS_FILE });
focusNotificationManager = new NotificationManager({ emit: (notification) => appendNotification({ title: 'Focus', body: notification.message, type: 'focus', meta: notification.meta || {} }) });
focusManager = new FocusManager({ subscriptionManager, blockEngine, scheduler: focusScheduler, storagePath: FOCUS_STATE_FILE, onChange: () => { try { broadcastFocusState(); } catch (_) {} } });
activityStore = new ActivityStore({ storagePath: ACTIVITY_FILE });
activityAccountant = createAccountant({ store: activityStore, classify: ContentClassifier.classify, maxGapMs: 30000 });
// Voice Agent STT — Groq Whisper (o'zbek+ingliz). Kalit tartibi (renderer'ga BERILMAYDI):
//   1) FOYDALANUVCHI o'z Groq kaliti (SETTINGS.voiceGroqKey) — taqsimlangan ilovada har user
//      o'z kalitini ulaydi (umumiy pool tugamasin/oshkor bo'lmasin).
//   2) Umumiy pool (ai-gateway → D:\ai apis.txt) — dev/zaxira.
let voiceStt = createSttProvider({
  provider: process.env.NIEX_STT_PROVIDER || 'groq',
  model: process.env.NIEX_STT_MODEL || undefined,
  resolveKey: () => {
    try {
      const uk = SETTINGS && SETTINGS.voiceGroqKey;
      if (uk && /^gsk_[A-Za-z0-9_\-]{10,}$/.test(String(uk).trim())) return String(uk).trim();
    } catch (_) {}
    // Voice — FAQAT foydalanuvchi kaliti (taqsimlanган ilova: umumiy pool ISHLATILMAYDI,
    //   apisiz ishlamaydi → UI "avval API ulang" deydi). Dev uchun: NIEX_VOICE_SHARED=1.
    if (process.env.NIEX_VOICE_SHARED === '1') { try { return aiGateway.getKey('groq'); } catch (_) {} }
    return null;
  },
});

// DIQQAT: parol ombori `app.whenReady()` ICHIDA ishga tushiriladi —
// `safeStorage.isEncryptionAvailable()` ilova tayyor bo'lgunicha `false`
// qaytaradi va ombor o'zini o'chirib qo'yardi.

// PREMIUM — to'lov so'rovlari store'i (pending → approved/rejected)
const PaymentStore = require('./premium/payment-store.js');
let paymentStore = new PaymentStore({ dir: USER_DATA, logger: L });

// TO'LOV KARTASI — bu yerga O'Z karta ma'lumotlaringizni yozing (MVP: qo'lda o'tkazma).
//   ⚠️ Haqiqiy karta raqamini shu yerga qo'ying. Hozir placeholder.
const PREMIUM_BANK_CARD = {
  cardNumber: process.env.NARIMON_CARD_NUMBER || '9860 1606 0679 3091',
  cardHolder: process.env.NARIMON_CARD_HOLDER || 'Abdulazizbek Murodov',
  bankName: process.env.NARIMON_CARD_BANK || 'Humo',
  price: 10999,            // joriy (chegirmali) narx
  originalPrice: null,    // asl narx — UI'da ustidan chiziq
  currency: 'UZS',
};

CFG = { ai: SETTINGS.ai!==false, img: SETTINGS.img!==false, yt: SETTINGS.yt!==false, ab: SETTINGS.ab!==false, lang: SETTINGS.lang || 'uz' };

// ExtensionManager will be initialized in app.whenReady()

function saveSettingsFile() { saveJson(SETTINGS_FILE, SETTINGS); }
function saveHistoryFile() { saveJson(HISTORY_FILE, HISTORY); }
function saveAuthFile() { saveJson(AUTH_FILE, AUTH_STORAGE); }
function saveExtensionsFile() { try { saveJson(EXT_METADATA, EXTENSIONS); } catch (e) { console.warn('saveExtensions failed', e.message); } }

// ── FOCUS TIMER FLOAT WINDOW ──
//   Draggable, always-on-top mini oyna — foydalanuvchi istalgan joyga surib qo'yishi
//   mumkin. Focus faol bo'lganda avtomatik ochiladi, tugasa yopiladi. Foydalanuvchi
//   qo'l bilan yopsa (X) — shu sessiya davomida qayta ochilmaydi.
let focusFloatWin = null;
let focusFloatHidden = false;
function focusFloatHTML(endsAt) {
  return `<!DOCTYPE html>
<html><head><meta charset="UTF-8"><style>
*{margin:0;padding:0;box-sizing:border-box}
body{background:transparent;font-family:system-ui,-apple-system,"Segoe UI",sans-serif;user-select:none;overflow:hidden;height:56px;padding:4px}
.chip{display:flex;align-items:center;gap:9px;background:linear-gradient(135deg,rgba(15,22,35,.95),rgba(10,18,24,.95));border:1px solid rgba(0,229,160,.55);border-radius:14px;padding:10px 14px;box-shadow:0 8px 24px rgba(0,0,0,.55),0 0 22px rgba(0,229,160,.28);color:#eaf0fb;font-weight:800;font-size:14px;-webkit-app-region:drag;cursor:move;backdrop-filter:blur(10px);height:100%}
.dot{width:7px;height:7px;background:#00E5A0;border-radius:50%;box-shadow:0 0 10px #00E5A0;animation:pulse 1.5s infinite;flex-shrink:0}
@keyframes pulse{0%,100%{opacity:1}50%{opacity:.4}}
.icon{font-size:15px}
.time{color:#7fffcf;font-variant-numeric:tabular-nums;letter-spacing:1.5px;flex:1;text-align:center}
.close{-webkit-app-region:no-drag;cursor:pointer;color:#6b8a80;font-size:13px;padding:3px 7px;border-radius:7px;transition:all .15s;margin-left:4px}
.close:hover{color:#FF4757;background:rgba(255,71,87,.15)}
</style></head><body>
<div class="chip">
  <div class="dot"></div>
  <div class="icon">🎯</div>
  <div class="time" id="t">--:--</div>
  <div class="close" id="x" title="Timer'ni yashirish">✕</div>
</div>
<script>
const ipc = window._ipc || window.ipcRenderer;
let endsAt = ${JSON.stringify(Number(endsAt) || 0)};
const el = document.getElementById('t');
function tick(){
  const remain = Math.max(0, endsAt - Date.now());
  const s = Math.floor(remain / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = s % 60;
  el.textContent = (h > 0 ? h + ':' : '') + String(m).padStart(2,'0') + ':' + String(ss).padStart(2,'0');
}
tick();
setInterval(tick, 1000);
if (ipc && ipc.on) ipc.on('focus-timer-update', (_, d) => { if (d && d.endsAt) endsAt = Number(d.endsAt); tick(); });
document.getElementById('x').addEventListener('click', () => { if (ipc && ipc.send) ipc.send('focus-timer-hide'); });
<\/script>
</body></html>`;
}
function showFocusFloatingTimer(session) {
  const active = session && session.state === 'active' && session.endsAt;
  if (!active) {
    if (focusFloatWin && !focusFloatWin.isDestroyed()) focusFloatWin.close();
    focusFloatWin = null;
    focusFloatHidden = false;
    return;
  }
  if (focusFloatHidden) return;
  if (focusFloatWin && !focusFloatWin.isDestroyed()) {
    try { focusFloatWin.webContents.send('focus-timer-update', { endsAt: session.endsAt }); } catch (e) {}
    return;
  }
  try {
    focusFloatWin = new BrowserWindow({
      width: 210, height: 60,
      frame: false, transparent: true, alwaysOnTop: true,
      skipTaskbar: true, resizable: false, movable: true, hasShadow: false, focusable: false,
      title: 'NIEX Focus Timer',
      icon: NIEX_ICON,
      webPreferences: { nodeIntegration: false, contextIsolation: true, preload: path.join(__dirname, 'preload.js') }
    });
    focusFloatWin.setAlwaysOnTop(true, 'floating');
    focusFloatWin.setSkipTaskbar(true);
    focusFloatWin.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(focusFloatHTML(session.endsAt)));
    focusFloatWin.on('closed', () => { focusFloatWin = null; });
  } catch (e) {
    console.error('[focus-float] create failed:', e);
  }
}
ipcMain.on('focus-timer-hide', () => {
  focusFloatHidden = true;
  if (focusFloatWin && !focusFloatWin.isDestroyed()) focusFloatWin.close();
  focusFloatWin = null;
});

// ═══════════════════════════════════════════════════════════════════
// PROFILE MANAGER IPC — Chrome-style multi-account
// ═══════════════════════════════════════════════════════════════════
// Har profil o'z alohida userData papkasi bilan ishlaydi (NIEX_PROFILE env).
// Boshqa profilga o'tish = yangi NIEX oynasini spawn qilish. Joriy oyna
// buzilmaydi — foydalanuvchi yon-yonma turli hisoblarda ishlashi mumkin.
ipcMain.handle('profile-list', () => profileManager.list());
ipcMain.handle('profile-current', () => ({ current: profileManager.getCurrent(), currentId: profileManager.getCurrentId() }));
ipcMain.handle('profile-add', (_, payload) => profileManager.add(payload || {}));
ipcMain.handle('profile-remove', (_, id) => profileManager.remove(id));
ipcMain.handle('profile-update', (_, { id, fields }) => profileManager.update(id, fields || {}));
ipcMain.handle('profile-launch', (_, id) => profileManager.launch(id));

function broadcastFocusState() {
  const payload = focusManager ? focusManager.serialize() : { canUseFocus: false, activeSession: null };
  showFocusFloatingTimer(payload.activeSession);
  for (const [, w] of wins) {
    try { w.tbv.webContents.send('focus-state-update', payload); } catch (e) {}
  }
  // Focus faol emas (yo'q / paused) → exit-monitorni tozalaymiz va ochiq
  // intervention oynasini yopamiz (paused/tugagan sessiyada intervention bo'lmaydi).
  const active = payload.activeSession && payload.activeSession.state === 'active';
  if (!active) {
    if (exitMonitor) exitMonitor.reset();
    if (interventionWin) closeFocusInterventionWindow();
    if (blockEngine) blockEngine.clearTempAllows();
  }
}

// ═══════════════════════════════════════════════════════════════════
// FOCUS EXIT INTERVENTION (PART 2)
//   Oddiy Focus saytlarni bloklamaydi. Bu tizim faqat foydalanuvchi NIEX'dan
//   BOSHQA ILOVAGA o'tganini kuzatadi va qaytganda ongli qaror qabul qilishga
//   yordam beradi. Yakuniy qaror har doim — foydalanuvchida (digital qamoq EMAS).
// ═══════════════════════════════════════════════════════════════════
function focusExitContext(durationMs) {
  const ac = focusManager ? focusManager.getActiveContext() : null;
  if (!ac) return null;
  return {
    goal: ac.goal, task: ac.task, reason: ac.reason, successCriteria: ac.successCriteria,
    remainingMinutes: ac.remainingMinutes,
    awayMinutes: Math.max(0, Math.round((Number(durationMs) || 0) / 60000)),
  };
}

function openFocusInterventionWindow(ctx) {
  try {
    if (interventionWin && !interventionWin.isDestroyed()) {
      interventionCtx = ctx;
      try { interventionWin.webContents.send('focus-intervention-context', ctx); } catch (_) {}
      interventionWin.show(); interventionWin.focus();
      return;
    }
    interventionCtx = ctx;
    interventionWin = new BrowserWindow({
      width: 440, height: 600, frame: false, resizable: false, maximizable: false,
      minimizable: false, skipTaskbar: true, alwaysOnTop: true, show: false, center: true,
      backgroundColor: '#0B1220', title: 'NIEX Focus', icon: NIEX_ICON,
      webPreferences: { nodeIntegration: false, contextIsolation: true, preload: path.join(__dirname, 'preload.js') },
    });
    interventionWin.setAlwaysOnTop(true, 'floating');
    interventionWin.loadFile(path.join(__dirname, 'focus-intervention.html'));
    interventionWin.webContents.on('did-finish-load', () => {
      try { interventionWin.webContents.send('focus-intervention-context', interventionCtx); } catch (_) {}
      try { interventionWin.show(); interventionWin.focus(); } catch (_) {}
    });
    interventionWin.on('closed', () => { interventionWin = null; });
  } catch (e) {
    console.error('[focus-intervention] open failed:', e && e.message);
  }
}

function closeFocusInterventionWindow() {
  if (interventionWin && !interventionWin.isDestroyed()) { try { interventionWin.close(); } catch (_) {} }
  interventionWin = null;
}

function notifyExitNudge(elapsedMs) {
  const mins = Math.max(1, Math.round((Number(elapsedMs) || 0) / 60000));
  const body = `Focus paytida ~${mins} daqiqa NIEX'dan tashqaridasiz.`;
  try { appendNotification({ title: 'NIEX Focus', body, type: 'focus', meta: {} }); } catch (_) {}
  try {
    if (Notification && Notification.isSupported && Notification.isSupported()) {
      new Notification({ title: 'NIEX Focus', body, silent: false }).show();
    }
  } catch (_) {}
}

function initFocusExitMonitor() {
  if (exitMonitor) return;
  exitMonitor = createExitMonitor({
    graceMs: 800,
    awayThresholdMs: 8000,
    nudgeAfterMs: 45000,
    isSessionActive: () => {
      const s = focusManager && focusManager.getActiveSession();
      return !!(s && s.state === 'active');
    },
    hasFocusedWindow: () => { try { return !!BrowserWindow.getFocusedWindow(); } catch (_) { return false; } },
    onNudge: (elapsed) => notifyExitNudge(elapsed),
    onReturn: (durationMs) => {
      // Faqat faol sessiya davom etayotgan bo'lsa hodisa yaratamiz.
      const s = focusManager && focusManager.getActiveSession();
      if (!s || s.state !== 'active') return;
      const rec = focusManager.recordDistractionEvent({ durationOutsideMs: durationMs });
      if (!rec || !rec.ok) return;
      // Foydalanuvchi intervention'ni o'chirgan bo'lsa — hodisa yozildi, lekin oyna ochilmaydi.
      const settings = focusSettingsManager ? focusSettingsManager.getState() : {};
      if (settings.interventionEnabled === false) {
        focusManager.updateDistractionEvent(rec.event.id, { resolved: true, userDecision: 'dismissed' });
        return;
      }
      const ctx = focusExitContext(durationMs);
      if (!ctx) return;
      openFocusInterventionWindow({ ...ctx, eventId: rec.event.id });
    },
  });
  attachElectron(app, exitMonitor);
  initScrollGuardian();
}

// ═══════════════════════════════════════════════════════════════════
// SCROLLING GUARDIAN (PART 2) — HAQIQIY scrolling_time asosida 15/30 daqiqa
// intervention + 12 daqiqa cheklov. Pro userlar uchun DOIM ishlaydi (Focus
// sessiyasi shart emas). Focus faol bo'lsa — maqsad xabarda ishlatiladi.
// ═══════════════════════════════════════════════════════════════════
function proScrollEnabled() {
  try { return !!(subscriptionManager && subscriptionManager.isFeatureEnabled && subscriptionManager.isFeatureEnabled('focusMode')); }
  catch (e) { return false; }
}

function initScrollGuardian() {
  if (scrollGuardian) return;
  scrollGuardian = createScrollGuardian({
    onWarn: (level) => { try { showScrollWarning(level); } catch (_) {} },
    onRestrictStart: () => { try { if (lastScrollWc && !lastScrollWc.isDestroyed()) loadScrollRestriction(lastScrollWc); } catch (_) {} },
    onRestrictEnd: () => {},
  });
}

/** Ogohlantirish overlay'ini (feed sahifasiga) inject qiladigan JS. */
function scrollWarnOverlayJS(level, goal) {
  const g = goal ? String(goal).replace(/[<>&"]/g, '').slice(0, 120) : '';
  const title = level === 2 ? 'Siz 30 daqiqani scrollingga sarfladingiz' : 'Siz 15 daqiqadan beri scrolling qildingiz';
  const sub = g ? ('«' + g + '» maqsadingizga qaytamizmi?') : 'Maqsadingizga qaytamizmi?';
  const showLater = level !== 2;
  const html =
    '<div style="width:min(440px,92%);background:#0F1623;border:1px solid rgba(255,255,255,.1);border-radius:20px;padding:30px;text-align:center;box-shadow:0 24px 70px rgba(0,0,0,.55)">'
    + '<div style="width:52px;height:52px;border-radius:15px;margin:0 auto 16px;display:grid;place-items:center;background:linear-gradient(135deg,#00E5A0,#06B6D4);color:#04120c;font-weight:900;font-size:26px">N</div>'
    + '<div style="font-size:20px;font-weight:800;color:#E8F0FE;margin-bottom:8px">' + title + '</div>'
    + '<div style="font-size:14px;color:#9fb2d0;margin-bottom:22px;line-height:1.5">' + sub + '</div>'
    + '<button id="nx-stay" style="width:100%;border:none;border-radius:12px;padding:13px;font-size:14px;font-weight:800;cursor:pointer;font-family:inherit;background:linear-gradient(135deg,#00E5A0,#00C885);color:#04120c">🎯 Ha, Focusga qaytaman</button>'
    + (showLater ? '<button id="nx-later" style="width:100%;margin-top:10px;border:1px solid rgba(255,255,255,.12);border-radius:12px;padding:12px;font-size:13px;font-weight:700;cursor:pointer;font-family:inherit;background:rgba(255,255,255,.04);color:#E8F0FE">Keyinroq</button>' : '')
    + '<div style="font-size:11px;color:#7E8BA6;margin-top:14px">Qaror sizniki. NIEX shunchaki eslatadi.</div>'
    + '</div>';
  return '(function(){try{var ex=document.getElementById("niex-scroll-overlay");if(ex)ex.remove();}catch(e){}'
    + 'var d=document.createElement("div");d.id="niex-scroll-overlay";'
    + 'd.setAttribute("style","position:fixed;inset:0;z-index:2147483647;background:rgba(6,10,20,.86);display:flex;align-items:center;justify-content:center;font-family:-apple-system,Segoe UI,system-ui,sans-serif");'
    + 'd.innerHTML=' + JSON.stringify(html) + ';'
    + 'document.documentElement.appendChild(d);'
    + 'var s=d.querySelector("#nx-stay"),l=d.querySelector("#nx-later");'
    + 'if(s)s.onclick=function(){try{window.safenet_focus_activity&&window.safenet_focus_activity.resolveScroll("yes");}catch(e){}try{if(window.safenet&&window.safenet.goHome)window.safenet.goHome();}catch(e){}d.remove();};'
    + 'if(l)l.onclick=function(){try{window.safenet_focus_activity&&window.safenet_focus_activity.resolveScroll("later");}catch(e){}d.remove();};'
    + '})();';
}

function showScrollWarning(level) {
  const wc = lastScrollWc;
  if (!wc || wc.isDestroyed()) return;
  const ac = focusManager ? focusManager.getActiveContext() : null;
  const goal = ac && ac.goal ? ac.goal : '';
  try { wc.executeJavaScript(scrollWarnOverlayJS(level, goal)); } catch (e) {}
}

/** 12 daqiqa cheklov sahifasi (feed o'rniga yuklanadi) — NIEX ekrani, countdown. */
function focusScrollRestrictionPage(remainingMs) {
  const endTs = Date.now() + Math.max(0, Number(remainingMs) || 0);
  const s0 = Math.max(0, Math.ceil(Math.max(0, Number(remainingMs) || 0) / 1000));
  const mm = String(Math.floor(s0 / 60)).padStart(2, '0');
  const ss = String(s0 % 60).padStart(2, '0');
  return '<!DOCTYPE html><html lang="uz"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>NIEX Focus</title><style>'
    + '*{margin:0;padding:0;box-sizing:border-box}'
    + "body{font-family:-apple-system,'Segoe UI',system-ui,sans-serif;background:radial-gradient(circle at 20% 0%,rgba(0,229,160,.12),transparent 30%),linear-gradient(180deg,#0A0E1A,#070c16);color:#E8F0FE;display:flex;align-items:center;justify-content:center;min-height:100vh;padding:24px}"
    + '.card{width:min(520px,100%);background:rgba(15,23,42,.7);border:1px solid rgba(255,255,255,.09);border-radius:22px;padding:34px;text-align:center;box-shadow:0 20px 60px rgba(0,0,0,.35)}'
    + '.mark{width:52px;height:52px;border-radius:15px;display:grid;place-items:center;background:linear-gradient(135deg,#00E5A0,#06B6D4);color:#04120c;font-weight:900;font-size:26px;margin:0 auto 18px}'
    + '.pill{display:inline-block;padding:6px 14px;border-radius:999px;background:rgba(255,184,107,.16);color:#FFB86B;font-weight:700;font-size:12px;letter-spacing:1px;text-transform:uppercase;margin-bottom:14px}'
    + 'h1{font-size:22px;margin-bottom:8px}.desc{font-size:14px;color:#9fb2d0;margin-bottom:20px;line-height:1.55}'
    + '.timer{font-size:42px;font-weight:800;font-variant-numeric:tabular-nums;margin:6px 0 2px;color:#FFD98A}'
    + '.tl{font-size:11px;color:#7E8BA6;text-transform:uppercase;letter-spacing:2px;margin-bottom:22px}'
    + '.btn{width:100%;border:none;border-radius:12px;padding:13px;font-size:14px;font-weight:800;cursor:pointer;font-family:inherit;background:linear-gradient(135deg,#00E5A0,#00C885);color:#04120c}'
    + '.note{font-size:11.5px;color:#7E8BA6;margin-top:16px;line-height:1.5}'
    + '</style></head><body><div class="card">'
    + '<div class="mark">N</div><div class="pill">Tanaffus</div>'
    + '<h1>Scrolling vaqtincha cheklangan</h1>'
    + '<div class="desc">12 daqiqalik tanaffus. Bu vaqtni maqsadingizga qaytish uchun ishlating. Qidiruv, video va boshqa saytlar ochiq qoladi.</div>'
    + '<div class="timer" id="rt">' + mm + ':' + ss + '</div><div class="tl">tanaffus qoldi</div>'
    + '<button class="btn" id="home">🏠 Bosh sahifa</button>'
    + '<div class="note">Faqat cheksiz feed (Shorts/Reels) cheklangan — qolgani ochiq.</div>'
    + '</div><script>'
    + 'var END=' + endTs + ';function pad(n){return(n<10?"0":"")+n;}'
    + 'function tk(){var r=Math.max(0,END-Date.now());var s=Math.ceil(r/1000);var e=document.getElementById("rt");if(e)e.textContent=pad(Math.floor(s/60))+":"+pad(s%60);if(r<=0){clearInterval(IV);e&&(e.textContent="00:00");}}'
    + 'var IV=setInterval(tk,1000);tk();'
    + 'document.getElementById("home").onclick=function(){try{if(window.safenet&&window.safenet.goHome)window.safenet.goHome();}catch(e){}};'
    + '</' + 'script></body></html>';
}

function loadScrollRestriction(wc) {
  if (!wc || wc.isDestroyed() || !scrollGuardian) return;
  const html = focusScrollRestrictionPage(scrollGuardian.restrictionRemainingMs());
  try { wc.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html)); } catch (e) {}
}

function maybeNotifyUsage(now = Date.now()) {
  if (!usageManager) return;
  const notification = usageManager.getNotificationState(now);
  if (!notification) {
    lastUsageNotificationLevel = null;
    return;
  }
  if (lastUsageNotificationLevel === notification.level) return;
  lastUsageNotificationLevel = notification.level;
  appendNotification({
    title: 'Usage reminder',
    body: notification.message,
    type: 'usage',
    meta: { level: notification.level }
  });
}

function ensureFocusProtection(url, tab, event) {
  // Oddiy Focus HECH NIMANI BLOKLAMAYDI (spec: "Focus is NOT a website blocker").
  // Bloklash faqat foydalanuvchi qo'lda yoqqan "Strong Focus" sessiyasida ishlaydi.
  if (!focusManager || !focusManager.isBlockingActive()) return null;
  if (!url || !url.startsWith('http')) return null;
  const result = blockEngine.isBlocked(url);
  if (!result.blocked) return null;
  const remainingMs = focusManager.getRemainingTime();
  if (event) event.preventDefault();
  focusManager.recordBlockedAttempt(url);
  focusStatisticsManager.recordBlockedAttempt(url);
  tab.blocked = true;
  const blockReason = result.matches.map((match) => match.categoryName).join(', ');
  const goal = (focusManager.getActiveSession() || {}).goal || '';
  const html = focusBlockPage(url, blockReason || '', remainingMs, goal);
  if (tab?.view?.webContents && !tab.view.webContents.isDestroyed()) {
    tab.view.webContents.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
  }
  broadcastFocusState();
  return { blocked: true, reason: blockReason };
}

function focusBlockPage(url, reason, remainingMs, goal) {
  const remMs = Math.max(0, Number(remainingMs) || 0);
  const endTs = Date.now() + remMs;
  const remainingSeconds = Math.max(0, Math.ceil(remMs / 1000));
  const mins = String(Math.floor(remainingSeconds / 60)).padStart(2, '0');
  const secs = String(remainingSeconds % 60).padStart(2, '0');
  let host = '';
  try { host = new URL(url).hostname.replace(/^www\./, ''); } catch (e) { host = ''; }
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const goalLine = goal
    ? '<div class="goal">Maqsadingiz: <b>' + esc(goal) + '</b></div>'
    : '<div class="goal">Siz Strong Focus sessiyasidasiz.</div>';
  return '<!DOCTYPE html><html lang="uz"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>NIEX Focus</title><style>'
    + '*{margin:0;padding:0;box-sizing:border-box}'
    + "body{font-family:-apple-system,'Segoe UI',system-ui,sans-serif;background:radial-gradient(circle at 20% 0%,rgba(0,229,160,.12),transparent 30%),linear-gradient(180deg,#0A0E1A,#070c16);color:#E8F0FE;display:flex;align-items:center;justify-content:center;min-height:100vh;padding:24px}"
    + '.card{width:min(520px,100%);background:rgba(15,23,42,.7);border:1px solid rgba(255,255,255,.09);border-radius:22px;padding:34px;backdrop-filter:blur(14px);box-shadow:0 20px 60px rgba(0,0,0,.35);text-align:center}'
    + '.mark{width:52px;height:52px;border-radius:15px;display:grid;place-items:center;background:linear-gradient(135deg,#00E5A0,#06B6D4);color:#04120c;font-weight:900;font-size:26px;margin:0 auto 18px}'
    + '.pill{display:inline-block;padding:6px 14px;border-radius:999px;background:rgba(0,229,160,.14);color:#00E5A0;font-weight:700;font-size:12px;letter-spacing:1px;text-transform:uppercase;margin-bottom:14px}'
    + 'h1{font-size:22px;margin-bottom:6px}'
    + '.goal{font-size:14px;color:#9fb2d0;margin-bottom:20px}.goal b{color:#00E5A0}'
    + '.timer{font-size:42px;font-weight:800;font-variant-numeric:tabular-nums;margin:6px 0 2px}'
    + '.tl{font-size:11px;color:#7E8BA6;text-transform:uppercase;letter-spacing:2px;margin-bottom:20px}'
    + '.site{font-size:13px;color:#8ea3c4;background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.08);border-radius:10px;padding:9px 12px;margin-bottom:20px;word-break:break-all}'
    + '.btn{width:100%;border:none;border-radius:12px;padding:13px;font-size:14px;font-weight:800;cursor:pointer;font-family:inherit;transition:.15s}'
    + '.primary{background:linear-gradient(135deg,#00E5A0,#00C885);color:#04120c}.primary:hover{filter:brightness(1.06)}'
    + '.ghost{background:rgba(255,255,255,.05);color:#E8F0FE;border:1px solid rgba(255,255,255,.1);margin-top:10px}.ghost:hover{border-color:#00E5A0;color:#00E5A0}'
    + '.note{font-size:11.5px;color:#7E8BA6;margin-top:16px;line-height:1.5}'
    + '</style></head><body><div class="card">'
    + '<div class="mark">N</div>'
    + '<div class="pill">Strong Focus</div>'
    + '<h1>Bu sayt hozir cheklangan</h1>'
    + goalLine
    + '<div class="timer" id="bp-timer">' + mins + ':' + secs + '</div>'
    + '<div class="tl">Focus qoldi</div>'
    + '<div class="site">' + esc(host || url) + '</div>'
    + '<button class="btn primary" id="back">🎯 Focusda qolaman</button>'
    + '<button class="btn ghost" id="allow">⏱️ 15 daqiqaga ruxsat berish</button>'
    + '<div class="note">Bu cheklovni o\'zingiz yoqdingiz. Kerak bo\'lsa vaqtincha ruxsat bering — qaror sizniki.</div>'
    + '</div><script>'
    + 'var U=' + JSON.stringify(url) + ',H=' + JSON.stringify(host) + ',END=' + endTs + ';'
    + 'function pad(n){return (n<10?"0":"")+n;}'
    + 'function tick(){var r=Math.max(0,END-Date.now());var s=Math.ceil(r/1000);var el=document.getElementById("bp-timer");if(el)el.textContent=pad(Math.floor(s/60))+":"+pad(s%60);if(r<=0){clearInterval(IV);}}'
    + 'var IV=setInterval(tick,1000);tick();'
    + "document.getElementById('back').onclick=function(){try{if(window.safenet&&window.safenet.goHome){window.safenet.goHome();return;}}catch(e){}try{if(window.safenet&&window.safenet.navigate){window.safenet.navigate('home.html');return;}}catch(e){}try{if(history.length>1)history.back();}catch(e){}};"
    + "document.getElementById('allow').onclick=async function(){var b=this;b.disabled=true;b.textContent='Ruxsat berilmoqda…';try{if(window.safenet_focus&&window.safenet_focus.tempAllow){await window.safenet_focus.tempAllow(H,15);}location.href=U;}catch(e){location.href=U;}};"
    + '</' + 'script></body></html>';
}

async function installExtensionFromUrl(url, name) {
  try {
    if (!url) throw new Error('No URL');
    const res = await fetch(url, { timeout: 15000 });
    if (!res.ok) throw new Error('Download failed: ' + res.status);

    const zipOrJson = await res.text();
    if (!zipOrJson || zipOrJson.length < 50) {
      throw new Error('Downloaded file seems empty');
    }

    if (isLikelyHtmlPayload(zipOrJson)) {
      throw new Error('Downloaded content is HTML, not a valid extension JS or manifest JSON');
    }

    let extData;
    try {
      extData = JSON.parse(zipOrJson);
    } catch (e) {
      return installLegacyExtension(zipOrJson, name);
    }

    if (!extData.manifest || !extData.manifest.name) {
      throw new Error('Invalid extension: missing manifest');
    }

    const extId = 'ext_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2);
    const success = extensionManager.installExtension(extId, extData.manifest, extData.files || {});
    if (!success) throw new Error('Failed to write extension files');

    EXTENSIONS = extensionManager.listExtensions();
    broadcastToAll('extensions-updated', EXTENSIONS);
    L('EXT', 'Installed', extData.manifest.name);
    reloadAllTabs();
    return { ok: true, ext: extensionManager.getExtension(extId) };
  } catch (e) {
    L('ERR', 'ext install:', e.message);
    return { ok: false, error: String(e.message || e) };
  }
}

function installLegacyExtension(jsCode, name) {
  try {
    if (isLikelyHtmlPayload(jsCode)) {
      throw new Error('Legacy extension payload looks like HTML, not JavaScript');
    }

    const extId = 'ext_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2);
    const manifest = {
      manifest_version: 2,
      name: name || 'Legacy Extension',
      version: '1.0.0',
      description: 'Migrated from old extension system',
      content_scripts: [{
        matches: ['<all_urls>'],
        js: ['script.js'],
        run_at: 'document_idle'
      }]
    };

    const files = { 'script.js': jsCode };
    const success = extensionManager.installExtension(extId, manifest, files);
    if (!success) throw new Error('Failed to write extension files');

    EXTENSIONS = extensionManager.listExtensions();
    broadcastToAll('extensions-updated', EXTENSIONS);
    L('EXT', 'Migrated legacy', name);
    reloadAllTabs();
    return { ok: true, ext: extensionManager.getExtension(extId) };
  } catch (e) {
    L('ERR', 'legacy install:', e.message);
    return { ok: false, error: String(e.message || e) };
  }
}

function reloadAllTabs() {
  for (const [, w] of wins) {
    for (const tab of w.tabs) {
      try {
        if (!tab.isHome && tab.view && !tab.view.webContents.isDestroyed()) {
          tab.view.webContents.reload();
        }
      } catch {}
    }
  }
}

function uninstallExtension(id) {
  try {
    const success = extensionManager.uninstallExtension(id);
    if (!success) return { ok: false, error: 'Failed to uninstall' };

    EXTENSIONS = extensionManager.listExtensions();
    broadcastToAll('extensions-updated', EXTENSIONS);
    L('EXT', 'Uninstalled', id);
    reloadAllTabs();
    return { ok: true };
  } catch (e) {
    return { ok: false, error: String(e.message || e) };
  }
}

function toggleExtension(id, enabled) {
  try {
    const success = extensionManager.toggleExtension(id, enabled);
    if (!success) return { ok: false, error: 'Failed to toggle' };

    EXTENSIONS = extensionManager.listExtensions();
    broadcastToAll('extensions-updated', EXTENSIONS);
    const ext = extensionManager.getExtension(id);
    L('EXT', 'Toggled', `${ext.name} -> ${enabled}`);
    reloadAllTabs();
    return { ok: true, ext };
  } catch (e) {
    return { ok: false, error: String(e.message || e) };
  }
}
function broadcastToAll(channel, payload) {
  for (const [, w] of wins) {
    try { w.tbv.webContents.send(channel, payload); } catch {};
    for (const tab of w.tabs) {
      try { tab.view.webContents.send(channel, payload); } catch {}
    }
  }
}
function broadcastStats() { broadcastToAll('stats-update', ST); }
function broadcastHistoryUpdate() { broadcastToAll('history-updated', HISTORY); }
function broadcastSettingsUpdate() { broadcastToAll('settings-changed', SETTINGS); }

function addHistoryEntry(url, title) {
  if (!url || !(url.startsWith('http://') || url.startsWith('https://'))) return;
  const now = new Date().toISOString();
  const entry = { id: crypto.randomBytes(8).toString('hex'), url, title: title || url, timestamp: now };
  HISTORY = [entry, ...HISTORY.filter(item => !(item.url === url && item.title === title))];
  if (HISTORY.length > 250) HISTORY = HISTORY.slice(0, 250);
  saveHistoryFile();
  broadcastHistoryUpdate();
}
function deleteHistoryEntry(id) {
  HISTORY = HISTORY.filter(item => item.id !== id);
  saveHistoryFile();
  broadcastHistoryUpdate();
  return HISTORY;
}
function clearHistory() {
  HISTORY = [];
  saveHistoryFile();
  broadcastHistoryUpdate();
  return HISTORY;
}

// ── Skriptlarni ixtiyoriy URL dan yangilash (masalan o‘z CDN) — Supabase majburiy emas ──
const UPDATE_FILES = ['contentfilter.js', 'monitor.js'];

async function autoUpdateScripts() {
  if (process.env.SAFENET_SCRIPT_UPDATE !== '1' || !SCRIPT_UPDATE_BASE) return;
  L('UPDATE','Skriptlar tekshirilmoqda...');
  let updated = false;

  for (const name of UPDATE_FILES) {
    try {
      const res = await fetch(SCRIPT_UPDATE_BASE + name + '?t=' + Date.now(), {
        headers: { 'Cache-Control': 'no-cache' },
        timeout: 10000
      });
      if (!res.ok) { L('WARN', name + ' server:', res.status); continue; }

      const code = await res.text();
      if (!code || code.length < 200) continue;

      let current = '';
      try { current = fs.readFileSync(path.join(__dirname, name), 'utf8'); } catch {}
      if (code.trim() === current.trim()) { L('OK', name + ' — yangi versiya yoq'); continue; }

      try {
        fs.writeFileSync(path.join(__dirname, name), code, 'utf8');
        L('NEW', name + ' yangilandi!', code.length + ' bayt');
      } catch(e) {
        L('ERR', name + ' saqlanmadi:', e.message);
        continue;
      }

      if (name === 'contentfilter.js') FILTER_JS = code;
      if (name === 'monitor.js') MONITOR_JS = code;
      updated = true;

    } catch(e) {
      L('WARN', name + ' update xatosi:', e.message);
    }
  }

  if (updated) L('SHIELD','Skriptlar yangilandi — keyingi sahifadan kuchga kiradi');
  else         L('SHIELD','Barcha skriptlar eng yangi versiyada');
}

// ══════════════════════════════════════════════════════════════════════════
// DOMAIN BLOCKLIST — Porn, kumor, zararli saytlar
// ══════════════════════════════════════════════════════════════════════════
const BLOCKED_DOMAINS = [
  'pornhub.com','xvideos.com','xvideos2.com','xnxx.com','redtube.com',
  'youporn.com','tube8.com','youjizz.com','beeg.com','tnaflix.com',
  'xhamster.com','xhamster2.com','xhamster3.com','xhamsterlive.com','brazzers.com','reality-kings.com',
  'bangbros.com','naughtyamerica.com','digitalplayground.com',
  'mofos.com','fakehub.com','teamskeet.com','blacked.com',
  'vixen.com','tushy.com','deeper.com','slayed.com',
  'onlyfans.com','fansly.com','manyvids.com','loyalfans.com',
  'stripchat.com','chaturbate.com','bongacams.com','cam4.com',
  'livejasmin.com','myfreecams.com','camsoda.com','streamate.com',
  'spankbang.com','eporner.com','porntrex.com','xmoviesforyou.com',
  'hclips.com','nuvid.com','drtuber.com','gotporn.com',
  'txxx.com','vjav.com','javhd.com','javmost.com','jav.guru',
  'caribbeancom.com','caribbeancompr.com','empflix.com',
  'hentaihaven.org','nhentai.net','hanime.tv','hentai.tv',
  'hentaimama.io','fakku.net','hentai-foundry.com',
  'rule34.xxx','rule34.paheal.net','gelbooru.com',
  'danbooru.donmai.us','safebooru.org','e621.net',
  'tbib.org','xbooru.com','rule34.us','rule34video.com',
  '1xbet.com','1xbet.uz','mostbet.com','mostbet.uz','melbet.com',
  'parimatch.com','bet365.com','betway.com','22bet.com',
  'pin-up.casino','1win.com','betwinner.com','marathonbet.com',
  'leonbets.com','bwin.com','unibet.com','betsson.com',
];

// URL da zararli kalit so'z bo'lsa ham bloklanadi
const BLOCKED_URL_KEYWORDS = [
  'porn','xxx','adult-','nude-','naked-','hentai-','erotic-',
  'onlyfans','fansly','chaturbate','camgirl',
];

function domainBlocked(url) {
  try {
    const parsed = new URL(url);
    const h = parsed.hostname.replace(/^www\./, '');
    if (BLOCKED_DOMAINS.some(d => h === d || h.endsWith('.' + d))) return true;
    const fullUrl = (parsed.hostname + parsed.pathname).toLowerCase();
    if (BLOCKED_URL_KEYWORDS.some(k => fullUrl.includes(k))) return true;
    return false;
  } catch { return false; }
}

// ── REDIRECT PROTECTION — markaziy navigatsiya qarori (nav-guard) ──
// Faqat AVTOMATIK (redirect/js/popup) shubhali manzilni to'xtatadi; foydalanuvchi
// o'zi kirgan saytni emas. Jiddiy kategoriyalarda ota-onaga signal (debounced).
const _navAlertSeen = new Map(); // host → oxirgi alert vaqti (spam oldini olish)
// Redirect Protection — PRO obunachilar uchun (foydalanuvchi qarori). Free'da nav-guard
//   bloklamaydi (navigatsiya o'tadi). NIEX_REDIRECT_ALL=1 — test/override.
function _redirectProtectionOn() {
  try { return subscriptionManager.isFeatureEnabled('redirectProtection') || process.env.NIEX_REDIRECT_ALL === '1'; }
  catch { return process.env.NIEX_REDIRECT_ALL === '1'; }
}
function navGuardBlock(view, tab, url, source, event) {
  try {
    if (!_redirectProtectionOn()) return false;   // Free — redirect himoyasi Pro'da
    const chain = (tab && Array.isArray(tab.redirectChain)) ? tab.redirectChain : [];
    const d = NavGuard.decide({ url, source, redirectChain: chain });
    if (!d.block) return false;
    if (event) { try { event.preventDefault(); } catch (_) {} }
    ST.block++;
    if (tab) tab.blocked = true;
    L('🛡️', 'REDIRECT BLOK', `[${d.category}/${source}] ` + String(url).slice(0, 80));
    try { if (view && view.webContents) view.webContents.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(blockPage(url, d.reason))); } catch (_) {}
    try { if (activityStore) activityStore.recordBlocked(); } catch (_) {}
    navGuardParentAlert(d, url);
    try { broadcastStats(); } catch (_) {}
    return true;
  } catch (e) { L('WARN', 'navGuardBlock:', e.message); return false; }
}
function navGuardParentAlert(d, url) {
  try {
    if (!d || !['gambling', 'phishing', 'malicious'].includes(d.category)) return;
    // FOYDALANUVCHI TALABI: ota-onaga signal FAQAT farzand ATAYLAB qilganda ketsin.
    //   Farzand o'zi qidirsa/domenga atay kirsa — block-reporter (content script) yuboradi
    //   (searchQuery/domain intent bilan). Bu yer esa AVTOMATIK navigatsiya bloklari uchun:
    //   redirect/popup/skript/phishing-skan — farzand qilmagani. Ularni ota-onaga
    //   YUBORMAYMIZ (avval random reklama/redirect bloki ham signal yuborardi — FP).
    //   Faqat source==='user' (farzand o'zi omnibox/link bilan kirgan harmful) → signal.
    if (d.source !== 'user') {
      L('INFO', 'Avto-blok (farzand ataylab emas) — parent signal YUBORILMADI:', d.category, '/', d.source || '?');
      return;
    }
    if (!browserCloud || !browserCloud.sendParentAlert) return;
    const host = d.host || '';
    const now = Date.now();
    if (_navAlertSeen.get(host) && now - _navAlertSeen.get(host) < 5 * 60000) return; // debounce 5 daq/host
    _navAlertSeen.set(host, now);
    if (_navAlertSeen.size > 300) { const k = _navAlertSeen.keys().next().value; _navAlertSeen.delete(k); }
    // Bu nuqtaga faqat source==='user' yetadi — farzand O'ZI (omnibox/link/ovozli buyruq)
    // harmful manzilga kirdi. Demak ATAYLAB → automatic:false (backend "farzandingiz
    // kirdi" deb aniq matn tuzadi, "avtomatik" neytral matn emas).
    browserCloud.sendParentAlert({ category: d.category, url: String(url).slice(0, 300), reason: d.reason, device: process.platform, automatic: false }).catch(() => {});
  } catch (_) {}
}

// ══════════════════════════════════════════════════════════════════
// BOSHQA BRAUZERLAR — ANIQLASH + onboarding tavsiya + ota-ona alert.
//   HECH NARSA MAJBURAN O'CHIRILMAYDI (admin/malware xatti-harakat emas).
//   Foydalanuvchi O'ZI Windows "Ilovalar" orqali o'chiradi; biz faqat ochib
//   beramiz, eslatamiz va (farzand qurilmasi bo'lsa) ota-onaga xabar beramiz.
// ══════════════════════════════════════════════════════════════════
const _otherBrowserAlerted = new Map(); // 'mode:id' → ts (throttle)
function otherBrowserAlert(browser, mode) {
  try {
    if (!browserCloud || !browserCloud.sendParentAlert) return;
    const key = mode + ':' + browser.id;
    const now = Date.now();
    // "running" ko'p takrorlanmasin (ota-ona spam bo'lmasin): 2 soat; "installed": 30 daq.
    const throttleMs = (mode === 'running' ? 120 : 30) * 60000;
    if (_otherBrowserAlerted.get(key) && now - _otherBrowserAlerted.get(key) < throttleMs) return;
    _otherBrowserAlerted.set(key, now);
    if (_otherBrowserAlerted.size > 100) { const k = _otherBrowserAlerted.keys().next().value; _otherBrowserAlerted.delete(k); }
    const reason = mode === 'installed'
      ? `${browser.name} brauzeri o'rnatildi — NIEX himoyasidan tashqarida, xavfsiz emas.`
      : `${browser.name} brauzeri ochildi — NIEX himoyasidan tashqarida ishlatilmoqda.`;
    // automatic:true → backend neytral matn tuzadi (farzandni ayblamaydi). Qurilma
    //   ota-onaga ulanmaган bo'lsa backend hech kimga yubormaydi (no-op).
    browserCloud.sendParentAlert({ category: 'other_browser', url: '', reason, device: process.platform, automatic: true, browser: browser.id }).catch(() => {});
    L('🌐', 'Boshqa brauzer alert:', browser.id, mode);
  } catch (_) {}
}
// HAFTALIK ESLATMA (foydalanuvchiga) — boshqa brauzer hali o'rnatilган bo'lsa, har hafta
//   bir marta yumshoq eslatma: "... brauzerlar aniqlandi, ular chalg'itadi. NIEX'да qoling."
function weeklyBrowserReminder(installed) {
  try {
    if (!installed || !installed.length) return;
    const last = SETTINGS.lastBrowserReminderAt || 0;
    if (Date.now() - last < 7 * 24 * 60 * 60 * 1000) return;
    SETTINGS = Object.assign({}, SETTINGS, { lastBrowserReminderAt: Date.now() });
    try { saveSettingsFile(); } catch (_) {}
    const names = installed.map(b => b.name).join(', ');
    const body = `${names} aniqlandi. Bu brauzerlar diqqatingizni chalg'itishi mumkin — faqat NIEX'да qolish maqsadingizga yordam beradi.`;
    try { new Notification({ title: 'NIEX — diqqatingizni saqlang', body, silent: false }).show(); } catch (_) {}
    try { appendNotification({ title: 'Boshqa brauzerlar aniqlandi', body, type: 'reminder' }); } catch (_) {}
    L('🌐', 'Haftalik brauzer eslatmasi:', names);
  } catch (_) {}
}
let _browserWatchTimer = null, _lastInstalledIds = null;
function startOtherBrowserWatch() {
  if (_browserWatchTimer) return;
  try { _lastInstalledIds = new Set(BrowserDetect.detectInstalled().map(b => b.id)); } catch (_) { _lastInstalledIds = new Set(); }
  const tick = async () => {
    try {
      const installed = BrowserDetect.detectInstalled();
      for (const b of installed) { if (_lastInstalledIds && !_lastInstalledIds.has(b.id)) otherBrowserAlert(b, 'installed'); }
      _lastInstalledIds = new Set(installed.map(b => b.id));
      const running = await BrowserDetect.detectRunning();
      for (const id of running) { const b = installed.find(x => x.id === id) || { id, name: id }; otherBrowserAlert(b, 'running'); }
      weeklyBrowserReminder(installed); // haftada bir (ichki gate)
    } catch (_) {}
  };
  _browserWatchTimer = setInterval(tick, 60000);
  setTimeout(tick, 8000);
}
// Onboarding oynasi — birinchi ishga tushirishда BIR MARTA (motivatsiya + tavsiya).
let _onboardWin = null;
function showBrowserOnboarding() {
  try {
    if (SETTINGS.browserOnboardingDone === true) return;
    if (_onboardWin && !_onboardWin.isDestroyed()) { _onboardWin.focus(); return; }
    _onboardWin = new BrowserWindow({
      width: 560, height: 700, resizable: false, minimizable: false, maximizable: false,
      title: 'NIEX', backgroundColor: '#0b1220', autoHideMenuBar: true,
      webPreferences: { nodeIntegration: false, contextIsolation: true, preload: path.join(__dirname, 'preload.js') },
    });
    _onboardWin.setMenuBarVisibility(false);
    _onboardWin.loadFile(path.join(__dirname, 'onboarding', 'browser-choice.html'));
    _onboardWin.on('closed', () => { _onboardWin = null; });
  } catch (e) { L('WARN', 'onboarding:', e.message); }
}
ipcMain.handle('browsers-detect', async () => {
  try {
    const installed = BrowserDetect.detectInstalled();
    const running = await BrowserDetect.detectRunning();
    return { ok: true, installed, running };
  } catch (e) { return { ok: false, error: e.message, installed: [], running: [] }; }
});
ipcMain.handle('browser-open-uninstall', async () => {
  // XAVFSIZ: Windows "Ilovalar va imkoniyatlar" — foydalanuvchi O'ZI o'chiradi (biz emas).
  try { if (process.platform === 'win32') await shell.openExternal('ms-settings:appsfeatures'); return { ok: true }; }
  catch (e) { return { ok: false, error: e.message }; }
});
// Google OAuth blok fallback — URL'ni TIZIM Chrome'ida ochamiz (foydalanuvchi u yerда kiradi).
//   Faqat http(s) qabul qilinadi (xavfsizlik: javascript: yoki file: RAD).
ipcMain.handle('open-in-system-browser', async (_e, url) => {
  try {
    const s = String(url || '').trim();
    if (!/^https?:\/\//i.test(s)) return { ok: false, error: 'bad-scheme' };
    await shell.openExternal(s);
    return { ok: true };
  } catch (e) { return { ok: false, error: e.message }; }
});
ipcMain.handle('onboarding-get', async () => ({ done: SETTINGS.browserOnboardingDone === true }));
ipcMain.handle('onboarding-done', async () => {
  SETTINGS = Object.assign({}, SETTINGS, { browserOnboardingDone: true });
  try { saveSettingsFile(); } catch (_) {}
  try { if (_onboardWin && !_onboardWin.isDestroyed()) _onboardWin.close(); } catch (_) {}
  return { ok: true };
});

// ══════════════════════════════════════════════════════════════════
// AUTO-UPDATE — electron-updater (niex-releases GitHub repodan). FAQAT paketlangan
//   ilovada (dev'da o'tkazib yuboriladi). Yangilanish avtomatik yuklanadi, foydalanuvchi
//   xabardor qilinadi va ilova yopilganда (yoki "hozir" tugmasi bilan) o'rnatiladi.
//   Publish: package.json build.publish + `npm run publish-win` (GH_TOKEN kerak).
// ══════════════════════════════════════════════════════════════════
let _updateDownloaded = false;
function setupAutoUpdate() {
  try {
    if (!app.isPackaged) { L('ℹ️', 'Auto-update: dev rejim — o\'tkazib yuborildi'); return; }
    const { autoUpdater } = require('electron-updater');
    autoUpdater.logger = { info: (m) => L('⬆️', 'update:', m), warn: (m) => L('WARN', 'update:', m), error: (m) => L('WARN', 'update:', m), debug: () => {} };
    autoUpdater.autoDownload = true;
    autoUpdater.autoInstallOnAppQuit = true;
    autoUpdater.on('update-available', (info) => {
      L('⬆️', 'Yangilanish bor:', info && info.version);
      try { appendNotification({ title: 'Yangilanish', body: `NIEX ${info && info.version} yuklanmoqda…`, type: 'update' }); } catch (_) {}
    });
    autoUpdater.on('update-downloaded', (info) => {
      _updateDownloaded = true;
      L('⬆️', 'Yangilanish yuklandi:', info && info.version);
      try { appendNotification({ title: 'Yangilanish tayyor', body: `NIEX ${info && info.version} tayyor — qayta ishga tushiring.`, type: 'update', meta: { action: 'restart-update' } }); } catch (_) {}
      try { BrowserWindow.getAllWindows().forEach((w) => { try { w.webContents.send('update-downloaded', { version: info && info.version }); } catch (_) {} }); } catch (_) {}
      try { new Notification({ title: 'NIEX yangilanishi tayyor', body: 'Qayta ishga tushirilganda o\'rnatiladi.', silent: false }).show(); } catch (_) {}
    });
    autoUpdater.on('error', (e) => { L('WARN', 'Auto-update xato:', e && e.message); });
    autoUpdater.checkForUpdates().catch(() => {});
    setInterval(() => { autoUpdater.checkForUpdates().catch(() => {}); }, 6 * 60 * 60 * 1000); // har 6 soat
    L('⬆️', 'Auto-update yoqildi (niex-releases)');
  } catch (e) { L('WARN', 'Auto-update init:', e.message); }
}
ipcMain.handle('update-install-now', async () => {
  try {
    if (!_updateDownloaded) return { ok: false, reason: 'not-ready' };
    const { autoUpdater } = require('electron-updater');
    setImmediate(() => { try { autoUpdater.quitAndInstall(); } catch (_) {} });
    return { ok: true };
  } catch (e) { return { ok: false, error: e.message }; }
});
ipcMain.handle('update-status', async () => ({ downloaded: _updateDownloaded, version: app.getVersion() }));

// ── OAUTH POPUP DETECTION ──
// OAuth flow'lari window.open() + window.opener.postMessage bilan ishlaydi.
// Bunday URL'lar YANGI TAB emas, REAL POPUP oyna sifatida ochilishi shart —
// aks holda parent sahifa uchun window.opener = null bo'lib, callback qotib qoladi.
const OAUTH_POPUP_HOSTS = [
  'accounts.google.com',
  'appleid.apple.com',
  'login.microsoftonline.com',
  'login.live.com',
  'login.yahoo.com',
  'www.facebook.com', 'm.facebook.com', 'web.facebook.com',
  'www.linkedin.com', 'linkedin.com',
  'github.com',
  'gitlab.com',
  'bitbucket.org',
  'discord.com',
  'twitter.com', 'x.com', 'api.twitter.com',
  'auth.openai.com',
  'oauth.telegram.org',
  'id.atlassian.com',
  'slack.com',
  'auth0.com',
  'oauth.lovable.app',
  'oauth.pinterest.com',
];
const OAUTH_PATH_HINTS = [
  '/oauth', '/oauth2', '/o/oauth', '/authorize', '/authorise',
  '/login/oauth', '/dialog/oauth', '/signin/oauth', '/sso/',
  '/openid', '/connect/authorize',
];
function isOAuthPopupUrl(url) {
  if (!url || typeof url !== 'string') return false;
  try {
    const u = new URL(url);
    const host = u.hostname.toLowerCase();
    const path = u.pathname.toLowerCase();
    if (OAUTH_POPUP_HOSTS.some(h => host === h || host.endsWith('.' + h))) return true;
    if (OAUTH_PATH_HINTS.some(p => path.includes(p))) return true;
    return false;
  } catch { return false; }
}

// ── CACHE ──
const C = new Map();
function cGet(k) {
  const i = C.get(k);
  if (!i) return null;
  if (Date.now() - i.t > CACHE_MS) { C.delete(k); return null; }
  return i.v;
}
function cSet(k, v) { C.set(k, { v, t: Date.now() }); }

// ── STATS ──
const ST = { total: 0, block: 0, blockImg: 0, allow: 0, ai: 0, err: 0, t0: Date.now() };

// ══════════════════════════════════════════════════
// SAFENET AI ENGINE — safenet-ai.js (Groq / OpenRouter / Gemini)
// ══════════════════════════════════════════════════

// snFetch — endi AI Gateway (Provider Manager) orqali ishlaydi.
// Kalitlar D:\ai apis.txt'dan bittalab ishlatiladi, limit tugasa keyingisiga o'tadi.
// Gateway barcha provayder tugasa fail-open qaytaradi (local AI himoya qiladi).
//
// LOCAL-FIRST: bu funksiya FAQAT local AI ishonchsiz bo'lganda chaqiriladi
//   (renderer local NSFW modelni birinchi ishlatadi, faqat noaniq holatni yuboradi).
async function snFetch(endpoint, body) {
  // Avval aiGateway (Groq/OpenRouter/Gemini) ni urinib ko'ramiz
  try {
    if (endpoint === 'analyze-text') {
      return await aiGateway.analyze({ type: 'text', text: body.text });
    }
    if (endpoint === 'analyze-image') {
      let b64 = body.image_base64;
      if (!b64 && body.image_url) {
        try {
          const resp = await fetch(body.image_url, { timeout: 8000 });
          const buf = await resp.buffer();
          b64 = buf.toString('base64');
        } catch { return { should_block: false }; }
      }
      if (!b64) throw new Error('analyze-image: image_base64 yoki image_url kerak');
      return await aiGateway.analyze({ type: 'image', image_base64: b64 });
    }
    if (endpoint === 'analyze-video') {
      return await aiGateway.analyze({ type: 'video', image_base64: body.video_base64 });
    }
    throw new Error('noma\'lum endpoint: ' + endpoint);
  } catch (gatewayErr) {
    // aiGateway ishlamasa (kalit yo'q, limit, xato) -> aiDirect (Supabase Edge Function) ga o'tamiz
    L('⚠️', 'AI Gateway xato, Supabase ga o\'tilmoqda:', gatewayErr.message);
    
    try {
      if (endpoint === 'analyze-text') {
        return await aiDirect.analyzeText(body.text);
      }
      if (endpoint === 'analyze-image') {
        let b64 = body.image_base64;
        if (!b64 && body.image_url) {
          try {
            const resp = await fetch(body.image_url, { timeout: 8000 });
            const buf = await resp.buffer();
            b64 = buf.toString('base64');
          } catch { return { should_block: false }; }
        }
        if (!b64) throw new Error('analyze-image: image_base64 yoki image_url kerak');
        return await aiDirect.analyzeImageBase64(b64);
      }
      if (endpoint === 'analyze-video') {
        return await aiDirect.analyzeVideoBase64(body.video_base64, body.mime_type);
      }
      throw new Error('noma\'lum endpoint: ' + endpoint);
    } catch (directErr) {
      L('❌', 'Supabase AI ham ishlamadi:', directErr.message);
      return { should_block: false }; // fail-open: xavfsiz tarzda o'tkazamiz
    }
  }
}

// BIRLASHGAN AI KVOTA modeli:
//   Free: 60 daq/24 soat — jami barcha AI ishi (local video kadr + cloud video/rasm/matn).
//   Pro: cheksiz.
//   Kvota tugagach — HAR QANDAY AI chaqiruvi to'xtaydi (fail-open — bloklamaydi).
//   Local video kadr o'zi budget'ni ishlatadi (usage-track-local-video IPC orqali).
function isOverAiBudget(type = 'image') {
  if (!usageManager) return false;
  const c = usageManager.canPerformAnalysis(type, 1);
  return !c.allowed;
}

// ── MATN TAHLILI (Pro va Free, kvota bilan) ──
async function aiText(text) {
  if (!CFG.ai || !text || text.length < 20) return { should_block: false };
  if (isOverAiBudget('text')) return { should_block: false, quota_exhausted: true };
  const k = 't:' + text.slice(0, 80);
  const c = cGet(k); if (c) return c;
  try {
    ST.ai++;
    const r = await snFetch('analyze-text', { text: text.slice(0, 5000) });
    L(r.should_block ? '⛔':'✅', 'Text', r.block_reason || text.slice(0,40));
    if (usageManager) usageManager.recordUsage({ type: 'text', success: true, metadata: { source: 'ai-text' } });
    cSet(k, r);
    return r;
  } catch(e) {
    ST.err++;
    L('❌','aiText:', e.message);
    return { should_block: false };
  }
}

// ══════════════════════════════════════════════════
// RASM TAHLILI — cloud (Groq/Gemini/OpenRouter) — Free ham foydalanadi, budget bilan
// ══════════════════════════════════════════════════

// Asosiy: base64 rasm
async function aiImgBase64(base64, urlHint) {
  if (!CFG.img || !base64) return { should_block: false };
  if (isOverAiBudget('image')) return { should_block: false, quota_exhausted: true };
  const k = 'b64:' + base64.slice(0, 40);
  const c = cGet(k); if (c) return c;
  try {
    ST.ai++;
    const r = await snFetch('analyze-image', { image_base64: base64 });
    L(r.should_block ? '⛔':'✅', 'ImgB64', (r.block_reason||'ok').slice(0,40));
    if (r.should_block) ST.blockImg++;
    if (usageManager) usageManager.recordUsage({ type: 'image', success: true, metadata: { source: 'ai-image-base64' } });
    cSet(k, r);
    return r;
  } catch(e) {
    ST.err++;
    L('❌','aiImgBase64:', e.message);
    if (urlHint) return aiImg(urlHint);
    return { should_block: false };
  }
}

// URL orqali (main process yuklab, AI ga yuboradi)
async function aiImg(url) {
  if (!CFG.img || !url) return { should_block: false };
  if (isOverAiBudget('image')) return { should_block: false, quota_exhausted: true };
  const k = 'url:' + url;
  const c = cGet(k); if (c) return c;
  try {
    ST.ai++;
    const r = await snFetch('analyze-image', { image_url: url });
    L(r.should_block ? '⛔':'✅', 'ImgURL', (r.block_reason||'ok').slice(0,40));
    if (r.should_block) ST.blockImg++;
    if (usageManager) usageManager.recordUsage({ type: 'image', success: true, metadata: { source: 'ai-image-url' } });
    cSet(k, r);
    return r;
  } catch(e) {
    ST.err++;
    L('❌','aiImgUrl:', e.message);
    return { should_block: false };
  }
}

// Video kadr tahlili — cloud (Gemini). Kvota tugasa fail-open.
async function aiVideoBase64(base64, mimeType) {
  if (!CFG.img || !base64) return { should_block: false };
  const k = 'vid:' + base64.slice(0, 40);
  const c = cGet(k); if (c) return c;
  const videoSeconds = Math.max(1, Math.floor((base64.length || 0) / 100000));
  const usageCheck = usageManager?.canPerformAnalysis?.('video', videoSeconds);
  if (usageManager && !usageCheck.allowed) {
    L('⏸','AI kvota tugadi — video cloud tahlil o\'tkazib yuborildi');
    return { should_block: false, quota_exhausted: true };
  }
  try {
    ST.ai++;
    const r = await snFetch('analyze-video', { video_base64: base64, mime_type: mimeType || 'video/mp4' });
    L(r.should_block ? '⛔':'✅', 'Video', (r.block_reason||'ok').slice(0,40));
    if (r.should_block) ST.blockImg++;
    if (usageManager) usageManager.recordUsage({ type: 'video', success: true, amount: videoSeconds, metadata: { source: 'ai-video-base64' } });
    cSet(k, r);
    return r;
  } catch(e) {
    ST.err++;
    L('❌','aiVideo:', e.message);
    return { should_block: false };
  }
}

// ── IPC: CONTENT FILTER'DAN KELGAN SO'ROVLAR ──
ipcMain.on('check-images', async (event, { urls, id }) => {
  const results = [];
  for (const url of (urls || []).slice(0, 3)) {
    const r = await aiImg(url);
    if (r.should_block) ST.blockImg++;
    results.push(r);
  }
  broadcastStats();
  try { event.sender.send('img-result-' + id, results); } catch {}
});

// ── IPC: BASE64 RASM/VIDEO TEKSHIRISH — safenet-ai.js ──
ipcMain.on('check-image-data', async (event, { base64, url, id }) => {
  try {
    let result = { should_block: false };
    if (base64)     result = await aiImgBase64(base64, url);
    else if (url)   result = await aiImg(url);
    broadcastStats();
    try { event.sender.send('imgd-result-' + id, result); } catch {}
  } catch(e) {
    L('❌','check-image-data:', e.message);
    try { event.sender.send('imgd-result-' + id, { should_block: false }); } catch {}
  }
});

// ── IPC: VIDEO TAHLILI ──
ipcMain.on('check-video-data', async (event, { base64, mimeType, id }) => {
  try {
    const result = await aiVideoBase64(base64, mimeType);
    broadcastStats();
    try { event.sender.send('vid-result-' + id, result); } catch {}
  } catch(e) {
    L('❌','check-video-data:', e.message);
    try { event.sender.send('vid-result-' + id, { should_block: false }); } catch {}
  }
});

ipcMain.on('check-text', async (event, { text, id }) => {
  const r = await aiText(text);
  if (r.should_block) ST.block++;
  broadcastStats();
  try { event.sender.send('txt-result-' + id, r); } catch {}
});

// LOCAL video tracker (eski, event-only — fire and forget).
ipcMain.on('usage-track-local-video', (_event, { seconds }) => {
  try {
    if (usageManager && Number.isFinite(seconds) && seconds > 0) {
      usageManager.recordUsage({ type: 'video-local', amount: seconds, metadata: { source: 'frame-scanner-local' } });
    }
  } catch {}
});

// Async — javob qaytaradi. Kvota tugasa quotaExhausted=true.
ipcMain.handle('usage-track-local-video-async', async (_event, { seconds }) => {
  try {
    if (!usageManager) return { ok: true, quotaExhausted: false };
    const r = usageManager.recordUsage({ type: 'video-local', amount: Math.max(0, Number(seconds) || 0), metadata: { source: 'frame-scanner-local' } });
    return { ok: true, quotaExhausted: !r.recorded && r.reason === 'ai-limit-reached', usage: r.usage };
  } catch { return { ok: true, quotaExhausted: false }; }
});

// Frame-scanner (renderer) kvota qolganini so'raydi — 60/60 bo'lsa scanner to'xtaydi.
ipcMain.handle('ai-quota-available', async () => {
  try {
    if (!usageManager) return { ok: true, available: true };
    const c = usageManager.canPerformAnalysis('video-local', 1);
    return { ok: true, available: !!c.allowed, currentUsage: c.currentUsage, limit: c.limit };
  } catch { return { ok: true, available: true }; }
});

// ── AD CLEAN + DDG LOGO HIDE ──
const AD_SCRIPT = `(function(){
  ['.result--ad','[data-testid="ad"]','.badge--ad','[class*="sponsored"]',
   '[data-ad]','iframe[src*="doubleclick"]','iframe[src*="googlesyndication"]',
   '.ddg-extension-hide','[class*="promo"]'].forEach(s=>{
    document.querySelectorAll(s).forEach(el=>el.remove());
  });
  new MutationObserver(()=>['.result--ad','[data-testid="ad"]'].forEach(s=>{
    document.querySelectorAll(s).forEach(el=>el.remove());
  })).observe(document.documentElement,{childList:true,subtree:true});
  if(window.location.hostname.includes('duckduckgo')){
    const s=document.createElement('style');
    s.textContent='.header__logo,.header__logo-img,img[alt*="DuckDuckGo"],.ddg-logo,.logo_homepage_wrapper{display:none!important}';
    document.head.appendChild(s);
  }
})();`;

// Content-platform saytlar: yaxshi va yomon kontent BIRGA yashaydi (YouTube, Instagram...).
//   Bu saytlarda SAHIFA-DARAJASIDA to'liq block QILINMAYDI — monitor.js (AI Brain)
//   har bir video/rasmni ALOHIDA bloklaydi, xavfsiz kontent ko'rinib turadi.
//   To'liq block faqat maxsus zararli saytlar (domen/URL keyword) uchun qoladi.
const CONTENT_PLATFORMS = [
  'youtube.com', 'youtu.be', 'm.youtube.com',
  'instagram.com', 'tiktok.com', 'twitter.com', 'x.com',
  'facebook.com', 'reddit.com', 'pinterest.com', 'tumblr.com',
  'twitch.tv', 'dailymotion.com', 'vimeo.com', 'threads.net',
  'vk.com', 'ok.ru', 'snapchat.com',
];
function isContentPlatform(url) {
  try {
    const h = new URL(url).hostname.toLowerCase();
    return CONTENT_PLATFORMS.some(d => h === d || h.endsWith('.' + d));
  } catch { return false; }
}

// ── BLOCK PAGE ──
function blockPage(url, reason) {
  return `<!DOCTYPE html><html lang="uz"><head><meta charset="UTF-8"><title>Bloklandi — Niex</title>
<style>*{margin:0;padding:0;box-sizing:border-box}body{font-family:system-ui;background:linear-gradient(135deg,#0A0E1A,#1a1f35);min-height:100vh;display:flex;align-items:center;justify-content:center;padding:20px;color:#E8F0FE}.c{background:#111827;border:1px solid #1E2D45;border-radius:22px;padding:44px 36px;max-width:520px;width:100%;text-align:center}.ico{font-size:56px;margin-bottom:16px}.h1{font-size:22px;font-weight:800;color:#FF4757;margin-bottom:8px}.sub{font-size:13px;color:#6B7A99;margin-bottom:20px}.rb{background:rgba(255,71,87,.08);border:1px solid rgba(255,71,87,.25);border-radius:13px;padding:13px;margin-bottom:13px;text-align:left}.rl{font-size:10px;color:#6B7A99;font-weight:700;text-transform:uppercase;letter-spacing:1px;margin-bottom:4px}.rv{font-size:13px}.ub{background:#1A2235;border-radius:9px;padding:10px;font-family:monospace;font-size:11px;color:#6B7A99;word-break:break-all;margin-bottom:16px;text-align:left}.sr{display:flex;gap:9px;margin-bottom:16px}.sc{flex:1;background:#1A2235;border-radius:10px;padding:10px;text-align:center}.sn{font-size:18px;font-weight:800;color:#00E5A0}.sl{font-size:9px;color:#6B7A99}.q{background:#1A2235;border-left:3px solid #00E5A0;border-radius:9px;padding:12px;font-style:italic;color:#6B7A99;font-size:12px;margin-bottom:16px;text-align:left}.b1{background:#1A2235;border:1px solid #1E2D45;color:#E8F0FE;padding:10px 20px;border-radius:10px;font-size:13px;font-weight:600;cursor:pointer;margin-right:7px}.b2{background:linear-gradient(135deg,#00E5A0,#00C885);border:none;color:#0A0E1A;padding:10px 20px;border-radius:10px;font-size:13px;font-weight:700;cursor:pointer}</style>
</head><body><div class="c">
<div class="ico">🛡️</div>
<div class="h1">Kontent Bloklandi</div>
<div class="sub">Niex ushbu sahifani xavfli deb topdi</div>
<div class="rb"><div class="rl">Sabab</div><div class="rv">${(reason||'Zararli kontent').slice(0,120)}</div></div>
<div class="ub">🔗 ${url.slice(0,120)}</div>
<div class="sr">
<div class="sc"><div class="sn">${ST.block}</div><div class="sl">Blok</div></div>
<div class="sc"><div class="sn">${ST.total}</div><div class="sl">Jami</div></div>
<div class="sc"><div class="sn">${ST.blockImg}</div><div class="sl">Rasm</div></div>
</div>
<div class="q">"Vaqtingiz — eng qimmat boyligingiz."</div>
<button class="b1" onclick="history.back()">← Orqaga</button>
<button class="b2" onclick="window.safenet&&window.safenet.goHome()">🏠 Bosh sahifa</button>
</div></body></html>`;
}

// ── HOME PAGE ──
function homeHTML() {
  return `<!DOCTYPE html>
<html lang="uz"><head><meta charset="UTF-8"><title>Niex</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{background:#0A0E1A;color:#E8F0FE;font-family:-apple-system,'Segoe UI',sans-serif;min-height:100vh;display:flex;flex-direction:column}
.tb{position:absolute;top:0;right:0;display:flex;align-items:center;padding:14px 20px;gap:8px}
.tbtn{display:flex;align-items:center;gap:6px;padding:7px 13px;background:#1A2235;border:1px solid #1E2D45;border-radius:10px;color:#8892B0;font-size:13px;cursor:pointer;font-family:inherit;transition:all .2s}
.tbtn:hover{background:#243044;color:#E8F0FE}
.av{width:32px;height:32px;background:linear-gradient(135deg,#00E5A0,#3B82F6);border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:14px;font-weight:700;color:#0A0E1A;cursor:pointer;border:2px solid transparent;transition:all .2s}
.av:hover{border-color:#00E5A0}
.main{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:70px 20px 40px}
.logo-wrap{text-align:center;margin-bottom:30px}
.logo-img{width:84px;height:84px;margin:0 auto 16px}
.logo-img svg{width:100%;height:100%;display:block}
.logo-text{font-size:36px;font-weight:900;background:linear-gradient(135deg,#00E5A0,#3B82F6);-webkit-background-clip:text;-webkit-text-fill-color:transparent}
.logo-sub{font-size:13px;color:#6B7A99;margin-top:5px}
.sw{width:580px;max-width:92vw;position:relative;margin-bottom:14px}
.si{width:100%;height:52px;background:#1A2235;border:1.5px solid #1E2D45;border-radius:26px;padding:0 54px 0 20px;font-size:15px;color:#E8F0FE;outline:none;font-family:inherit;transition:all .2s}
.si::placeholder{color:#4a5568}.si:focus{border-color:#00E5A0;box-shadow:0 0 0 3px rgba(0,229,160,.1);background:#1E2A3D}
.sg{position:absolute;right:7px;top:7px;width:38px;height:38px;background:linear-gradient(135deg,#00E5A0,#00C885);border:none;border-radius:19px;cursor:pointer;font-size:16px;display:flex;align-items:center;justify-content:center;font-family:inherit;transition:all .2s}
.sg:hover{transform:scale(1.07);box-shadow:0 0 14px rgba(0,229,160,.4)}
.qs{width:580px;max-width:92vw;margin-bottom:24px}
.qh{display:flex;justify-content:space-between;align-items:center;margin-bottom:8px}
.ql{font-size:10px;color:#4a5568;font-weight:700;text-transform:uppercase;letter-spacing:1px}
.qe{font-size:11px;color:#00E5A0;background:none;border:none;cursor:pointer;padding:3px 8px;border-radius:6px;font-family:inherit}
.qe:hover{background:rgba(0,229,160,.1)}
.qg{display:flex;flex-wrap:wrap;gap:8px;justify-content:center}
.qb{display:flex;align-items:center;gap:6px;padding:8px 14px;background:#1A2235;border:1px solid #1E2D45;border-radius:20px;color:#8892B0;font-size:13px;cursor:pointer;font-family:inherit;transition:all .2s}
.qb:hover{background:#243044;color:#E8F0FE;transform:translateY(-1px)}
.qadd{padding:8px 13px;background:rgba(0,229,160,.06);border:1px dashed rgba(0,229,160,.3);border-radius:20px;color:#00E5A0;font-size:13px;cursor:pointer;font-family:inherit}
.qadd:hover{background:rgba(0,229,160,.12)}
.sr{display:flex;gap:10px;flex-wrap:wrap;justify-content:center}
.sp{display:flex;align-items:center;gap:7px;background:rgba(0,229,160,.08);border:1px solid rgba(0,229,160,.15);border-radius:10px;padding:7px 13px;font-size:12px}
.sdot{width:6px;height:6px;background:#00E5A0;border-radius:50%;animation:bl 2s infinite}
@keyframes bl{0%,100%{opacity:1}50%{opacity:.3}}
.sv{font-weight:700;color:#00E5A0}.sk{color:#6B7A99}
/* MODALS */
.ov{display:none;position:fixed;inset:0;background:rgba(0,0,0,.78);backdrop-filter:blur(5px);z-index:100;align-items:center;justify-content:center}
.ov.open{display:flex}
.md{background:#111827;border:1px solid #1E2D45;border-radius:20px;padding:24px;width:400px;max-width:94vw;max-height:86vh;overflow-y:auto;box-shadow:0 24px 60px rgba(0,0,0,.6)}
.mhd{display:flex;justify-content:space-between;align-items:center;margin-bottom:18px}
.mtt{font-size:17px;font-weight:700}
.mcl{width:28px;height:28px;background:#1A2235;border:none;border-radius:7px;color:#8892B0;cursor:pointer;font-size:14px;font-family:inherit}
.mcl:hover{background:#243044;color:#E8F0FE}
.slb{font-size:10px;color:#4a5568;font-weight:700;text-transform:uppercase;letter-spacing:1px;margin:14px 0 8px}
.tr{display:flex;justify-content:space-between;align-items:center;padding:10px 12px;background:#1A2235;border-radius:10px;margin-bottom:7px;border:1px solid #1E2D45}
.tinfo{display:flex;flex-direction:column;gap:2px}
.tn{font-size:13px;font-weight:600}.td{font-size:11px;color:#6B7A99}
.tg{width:40px;height:22px;background:#1E2D45;border-radius:11px;cursor:pointer;position:relative;border:none;transition:background .25s;flex-shrink:0;font-family:inherit}
.tg.on{background:linear-gradient(135deg,#00E5A0,#00C885)}
.tg::after{content:'';position:absolute;top:3px;left:3px;width:16px;height:16px;background:white;border-radius:8px;transition:transform .25s}
.tg.on::after{transform:translateX(18px)}
.fi{width:100%;padding:9px 12px;background:#1A2235;border:1px solid #1E2D45;border-radius:9px;color:#E8F0FE;font-size:13px;font-family:inherit;outline:none;margin-bottom:9px}
.fi:focus{border-color:#00E5A0}
.flab{font-size:12px;color:#8892B0;margin-bottom:4px;display:block}
.bp{width:100%;padding:11px;background:linear-gradient(135deg,#00E5A0,#00C885);border:none;border-radius:11px;color:#0A0E1A;font-size:14px;font-weight:700;cursor:pointer;margin-top:6px;font-family:inherit}
.bp:hover{transform:translateY(-1px);box-shadow:0 5px 16px rgba(0,229,160,.3)}
.bs{width:100%;padding:10px;background:#1A2235;border:1px solid #1E2D45;border-radius:11px;color:#E8F0FE;font-size:13px;font-weight:600;cursor:pointer;margin-top:5px;font-family:inherit}
.bs:hover{background:#243044}
.gb{display:flex;align-items:center;justify-content:center;gap:9px;width:100%;padding:11px;background:white;border:none;border-radius:11px;color:#1a1a1a;font-size:13px;font-weight:600;cursor:pointer;margin-bottom:7px;font-family:inherit}
.gb:hover{transform:translateY(-1px);box-shadow:0 4px 14px rgba(0,0,0,.2)}
.dvd{display:flex;align-items:center;gap:10px;margin:13px 0;color:#4a5568;font-size:11px}
.dvd::before,.dvd::after{content:'';flex:1;height:1px;background:#1E2D45}
.pav{width:60px;height:60px;background:linear-gradient(135deg,#00E5A0,#3B82F6);border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:22px;font-weight:700;color:#0A0E1A;margin:0 auto 10px}
.pnm{font-size:17px;font-weight:700;text-align:center;margin-bottom:2px}
.pem{font-size:12px;color:#6B7A99;text-align:center;margin-bottom:16px}
.li{display:flex;align-items:center;gap:8px;padding:9px;background:#1A2235;border-radius:9px;margin-bottom:6px;border:1px solid #1E2D45}
.lie{font-size:17px;width:26px;text-align:center;flex-shrink:0}
.lin{flex:1;overflow:hidden}
.linn{font-size:13px;font-weight:600}
.linu{font-size:10px;color:#6B7A99;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.ldl{width:24px;height:24px;background:rgba(255,71,87,.1);border:none;border-radius:6px;color:#FF4757;cursor:pointer;font-size:12px;flex-shrink:0;font-family:inherit}
.ldl:hover{background:rgba(255,71,87,.2)}
.history-list{max-height:220px;overflow:auto;padding:8px;background:#0F1623;border:1px solid #1E2D45;border-radius:14px;margin-bottom:14px}
.history-item{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:10px;border-bottom:1px solid #1E2D45}
.history-item:last-child{border-bottom:none}
.history-item .hmeta{flex:1;min-width:0}
.history-item .htitle{font-size:13px;font-weight:700;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.history-item .hurl{font-size:11px;color:#6B7A99;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.history-item .hdate{font-size:10px;color:#8892B0;min-width:90px;text-align:right}
.history-item button{background:rgba(255,71,87,.08);border:1px solid rgba(255,71,87,.2);color:#FF7A8A;border-radius:9px;padding:6px 10px;cursor:pointer;font-size:11px}
.info-box{background:rgba(0,229,160,.07);border:1px solid rgba(0,229,160,.2);border-radius:10px;padding:10px 13px;font-size:12px;color:#00E5A0;margin-bottom:10px;display:flex;align-items:flex-start;gap:8px}
</style></head><body>

<div class="tb">
  <button class="tbtn" id="btn-nt">+ Yangi oyna</button>
  <button class="tbtn" id="btn-settings">⚙️ Sozlamalar</button>
  <div class="av" id="av">?</div>
</div>

<div class="main">
  <div class="logo-wrap">
    <div class="logo-img">
      <svg viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Niex logo">
        <defs>
          <linearGradient id="sn-grad" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stop-color="#00E5A0"/>
            <stop offset="100%" stop-color="#3B82F6"/>
          </linearGradient>
        </defs>
        <path d="M32 4L58 14v16c0 18-10 34-26 34S6 48 6 30V14L32 4z" fill="url(#sn-grad)"/>
        <path d="M32 10L18 18v12c0 12 7 22 14 22s14-10 14-22V18L32 10z" fill="rgba(255,255,255,0.2)"/>
        <path d="M32 28c-3.3 0-6 2.7-6 6 0 1.5 0.6 2.8 1.6 3.8l4.4 4.4 4.4-4.4c1-1 1.6-2.3 1.6-3.8 0-3.3-2.7-6-6-6z" fill="#ffffff" opacity="0.85"/>
      </svg>
    </div>
    <div class="logo-text">Niex</div>
    <div class="logo-sub">Xavfsiz va tez brauzer — AI himoyasi bilan</div>
  </div>

  <div class="sw">
    <input class="si" id="si" type="text" placeholder="Qidirish yoki URL kiriting..." autocomplete="off" autofocus/>
    <button class="sg" id="sg">🔍</button>
  </div>

  <div class="qs">
    <div class="qh">
      <span class="ql">Tezkor havolalar</span>
      <button class="qe" id="btn-ql">✏️ Tahrirlash</button>
    </div>
    <div class="qg" id="qg"></div>
  </div>

  <div class="sr">
    <div class="sp"><div class="sdot"></div><span class="sk">AI:</span><span class="sv">Faol</span></div>
    <div class="sp"><span class="sk">Blok sahifa:</span><span class="sv" id="v-bl">0</span></div>
    <div class="sp"><span class="sk">Blok rasm:</span><span class="sv" id="v-bi">0</span></div>
    <div class="sp"><span class="sk">Jami:</span><span class="sv" id="v-tot">0</span></div>
  </div>
</div>

<!-- ── SETTINGS ── -->
<div class="ov" id="ov-s"><div class="md">
  <div class="mhd"><div class="mtt" data-i18n-key="settingsTitle">⚙️ Sozlamalar</div><button class="mcl" id="cls-s">✕</button></div>

  <div class="info-box" data-i18n-key="settingsHint">🛡️ Niex Filter YouTube, DuckDuckGo va barcha saytlarda ishlaydi</div>

  <div class="slb" data-i18n-key="languageSectionTitle">🌍 Til</div>
  <div class="tr"><div class="tinfo"><div class="tn" data-i18n-key="languageLabel">Til</div><div class="td" data-i18n-key="languageDescription">Interfeys tili</div></div>
    <select class="uw" id="language-select"></select>
  </div>

  <div class="slb" data-i18n-key="historySectionTitle">📚 Tarix</div>
  <div class="tr" style="flex-wrap:wrap;gap:10px;align-items:center;">
    <div class="tinfo"><div class="tn" data-i18n-key="historyDescription">Brauzerda ko‘rilgan saytlaringiz bu yerda saqlanadi.</div></div>
    <button class="bs" id="btn-clear-history" data-i18n-key="clearHistory">Barcha tarixni o‘chirish</button>
  </div>
  <div class="history-list" id="history-list"></div>

  <div class="slb" data-i18n-key="googleSectionTitle">🔐 Google Hisob</div>
  <div class="tr" style="flex-wrap:wrap;gap:10px;align-items:center;">
    <div class="tinfo"><div class="tn" data-i18n-key="googleSectionDesc">Rasmiy Google OAuth orqali kirish</div></div>
    <button class="bp" id="btn-google-login" data-i18n-key="googleSignIn">Google hisobiga kirish</button>
  </div>
  <div id="google-profile" style="display:none;margin-top:10px;">
    <div class="li" style="gap:12px;">
      <span class="lie" id="g-avatar">👤</span>
      <div class="lin">
        <div class="linn" id="g-name"></div>
        <div class="linu" id="g-email"></div>
      </div>
      <button class="ldl" id="btn-google-signout" data-i18n-key="signOut">Chiqish</button>
    </div>
    <button class="bp" id="btn-google-manage" data-i18n-key="manageAccount">Google Account-ni boshqarish</button>
  </div>

  <div class="slb" data-i18n-key="searchEngineSectionTitle">🌐 Qidiruv tizimi</div>
  <div class="tr"><div class="tinfo"><div class="tn" data-i18n-key="ddgLabel">DuckDuckGo</div><div class="td" data-i18n-key="ddgDescription">Maxfiy qidiruv (tavsiya)</div></div><button class="tg on" id="t-ddg"></button></div>
  <div class="tr"><div class="tinfo"><div class="tn" data-i18n-key="googleLabel">Google</div><div class="td" data-i18n-key="googleDescription">Google qidiruv</div></div><button class="tg" id="t-gg"></button></div>

  <div class="slb" data-i18n-key="contentProtectionSectionTitle">🛡️ Kontent Himoyasi</div>
  <div class="tr"><div class="tinfo"><div class="tn" data-i18n-key="aiUrlLabel">AI URL Tahlili</div><div class="td" data-i18n-key="aiUrlDesc">Har bir URL ni AI bilan tekshirish</div></div><button class="tg on" id="t-ai"></button></div>
  <div class="tr"><div class="tinfo"><div class="tn" data-i18n-key="aiImageLabel">AI Rasm Tahlili</div><div class="td" data-i18n-key="aiImageDesc">Sahifadagi rasmlarni AI bilan tekshirish</div></div><button class="tg on" id="t-img"></button></div>
  <div class="tr"><div class="tinfo"><div class="tn" data-i18n-key="ytFilterLabel">YouTube Video Filter</div><div class="td" data-i18n-key="ytFilterDesc">Video sarlavha va thumbnail bloklash</div></div><button class="tg on" id="t-yt"></button></div>
  <div class="tr"><div class="tinfo"><div class="tn" data-i18n-key="adBlockLabel">Reklama Bloklash</div><div class="td" data-i18n-key="adBlockDesc">Sahifadagi reklamalarni olib tashlash</div></div><button class="tg on" id="t-ab"></button></div>

  <div class="slb" data-i18n-key="windowSectionTitle">🖥️ Oyna</div>
  <div class="tr"><div class="tinfo"><div class="tn" data-i18n-key="newWindowLabel">Yangi Oyna</div><div class="td" data-i18n-key="newWindowDesc">+ tugmasi bilan yangi brauzer oynasi</div></div><button class="tg on" id="t-tab"></button></div>

  <div class="slb">🧩 Extensions</div>
  <div class="tr" style="flex-direction:column;gap:8px">
    <div style="display:flex;gap:8px">
      <input class="fi" id="ext-name" placeholder="Extension name (optional)" />
      <input class="fi" id="ext-url" placeholder="https://example.com/extension.js" />
      <button class="bp" id="btn-install-ext">➕ Install</button>
    </div>
    <div id="extensions-list" style="width:100%"></div>
  </div>

  <button class="bp" id="save-s" data-i18n-key="saveSettings">💾 Saqlash</button>
</div></div>

<!-- ── PROFILE ── -->
<div class="ov" id="ov-p"><div class="md">
  <div class="mhd"><div class="mtt">👤 Profil</div><button class="mcl" id="cls-p">✕</button></div>
  <div id="pv-out">
    <div style="text-align:center;margin-bottom:16px">
      <div style="font-size:42px;margin-bottom:8px">👤</div>
      <div style="font-size:13px;color:#6B7A99">Hisobingizga kiring</div>
    </div>
    <button class="gb" id="btn-gg"><span style="font-size:16px">🇬</span> Google orqali kirish</button>
    <div class="dvd">yoki email bilan</div>
    <label class="flab">Email</label><input class="fi" id="l-em" type="email" placeholder="email@example.com"/>
    <label class="flab">Parol</label><input class="fi" id="l-pw" type="password" placeholder="••••••••"/>
    <button class="bp" id="btn-li">Kirish</button>
    <button class="bs" id="btn-to-su">Yangi hisob yaratish →</button>
  </div>
  <div id="pv-su" style="display:none">
    <label class="flab">Ism</label><input class="fi" id="su-nm" placeholder="Ismingiz"/>
    <label class="flab">Email</label><input class="fi" id="su-em" type="email"/>
    <label class="flab">Parol</label><input class="fi" id="su-pw" type="password" placeholder="Kamida 6 belgi"/>
    <button class="bp" id="btn-su">Ro'yxatdan o'tish</button>
    <button class="bs" id="btn-to-li">← Orqaga</button>
  </div>
  <div id="pv-in" style="display:none">
    <div class="pav" id="pav">?</div>
    <div class="pnm" id="pnm">-</div>
    <div class="pem" id="pem">-</div>
    <div style="display:flex;gap:9px;margin-bottom:14px">
      <div style="flex:1;background:#1A2235;border-radius:10px;padding:10px;text-align:center">
        <div style="font-size:18px;font-weight:800;color:#FF4757" id="p-bl">0</div>
        <div style="font-size:9px;color:#6B7A99">Blok sahifa</div>
      </div>
      <div style="flex:1;background:#1A2235;border-radius:10px;padding:10px;text-align:center">
        <div style="font-size:18px;font-weight:800;color:#FF6B35" id="p-bi">0</div>
        <div style="font-size:9px;color:#6B7A99">Blok rasm</div>
      </div>
      <div style="flex:1;background:#1A2235;border-radius:10px;padding:10px;text-align:center">
        <div style="font-size:18px;font-weight:800;color:#3B82F6" id="p-tot">0</div>
        <div style="font-size:9px;color:#6B7A99">Jami</div>
      </div>
    </div>
    <button class="bs" id="btn-so">🚪 Chiqish</button>
  </div>
</div></div>

<!-- ── LINKS EDIT ── -->
<div class="ov" id="ov-l"><div class="md">
  <div class="mhd"><div class="mtt">✏️ Tezkor havolalar</div><button class="mcl" id="cls-l">✕</button></div>
  <div id="ll"></div>
  <div class="slb">➕ Yangi havola qo'shish</div>
  <label class="flab">Nom</label><input class="fi" id="nl-n" placeholder="YouTube"/>
  <label class="flab">URL</label><input class="fi" id="nl-u" placeholder="https://youtube.com"/>
  <label class="flab">Emoji</label><input class="fi" id="nl-e" placeholder="📺" maxlength="4"/>
  <button class="bp" id="btn-al">➕ Qo'shish</button>
</div></div>

<script>
// ── STATE ──
const DEF_LINKS = [
  {n:'YouTube',     u:'https://youtube.com',         e:'📺'},
  {n:'Wikipedia',   u:'https://wikipedia.org',        e:'📖'},
  {n:'Khan Academy',u:'https://khanacademy.org',      e:'📚'},
  {n:'GitHub',      u:'https://github.com',           e:'💻'},
  {n:'Tarjimon',    u:'https://translate.google.com', e:'🌐'},
  {n:'Gmail',       u:'https://mail.google.com',      e:'📧'},
];
let links    = JSON.parse(localStorage.getItem('sn_l') || 'null') || DEF_LINKS;
let cfg      = JSON.parse(localStorage.getItem('sn_c') || '{}');
let user     = JSON.parse(localStorage.getItem('sn_u') || 'null');
let accounts = JSON.parse(localStorage.getItem('sn_a') || '{}');
if (!cfg.eng) cfg.eng = 'ddg';
['ai','img','yt','ab','tab'].forEach(k => { if (cfg[k] === undefined) cfg[k] = true; });

const ENGS = { ddg:'https://duckduckgo.com/?q=', google:'https://www.google.com/search?q=' };
const I18N = {
  uz: {
    settingsTitle:'⚙️ Sozlamalar',
    settingsHint:'🛡️ Niex Filter YouTube, DuckDuckGo va barcha saytlarda ishlaydi',
    languageSectionTitle:'🌍 Til',
    languageLabel:'Til',
    languageDescription:'Interfeys tili',
    historySectionTitle:'📚 Tarix',
    historyDescription:'Brauzerda ko‘rilgan saytlaringiz bu yerda saqlanadi.',
    clearHistory:'Barcha tarixni o‘chirish',
    googleSectionTitle:'🔐 Google Hisob',
    googleSectionDesc:'Rasmiy Google OAuth orqali kirish',
    googleSignIn:'Google hisobiga kirish',
    signOut:'Chiqish',
    manageAccount:'Google Account-ni boshqarish',
    searchEngineSectionTitle:'🌐 Qidiruv tizimi',
    ddgLabel:'DuckDuckGo',
    ddgDescription:'Maxfiy qidiruv (tavsiya)',
    googleLabel:'Google',
    googleDescription:'Google qidiruv',
    contentProtectionSectionTitle:'🛡️ Kontent Himoyasi',
    aiUrlLabel:'AI URL Tahlili',
    aiUrlDesc:'Har bir URL ni AI bilan tekshirish',
    aiImageLabel:'AI Rasm Tahlili',
    aiImageDesc:'Sahifadagi rasmlarni AI bilan tekshirish',
    ytFilterLabel:'YouTube Video Filter',
    ytFilterDesc:'Video sarlavha va thumbnail bloklash',
    adBlockLabel:'Reklama Bloklash',
    adBlockDesc:'Sahifadagi reklamalarni olib tashlash',
    windowSectionTitle:'🖥️ Oyna',
    newWindowLabel:'Yangi Oyna',
    newWindowDesc:'+ tugmasi bilan yangi brauzer oynasi',
    saveSettings:'💾 Saqlash',
    quickLinks:'Tezkor havolalar',
    editLinks:'✏️ Tahrirlash',
    search:'Qidirish yoki URL kiriting...',
    historyEmpty:'Tarix bo‘sh',
    historyDeleted:'Tarix o‘chirildi',
    historyCleared:'Barcha tarix o‘chirildi',
    googleSignedIn:'Google hisobingiz bog‘landi',
    googleSignedOut:'Google hisobidan chiqildi',
    languageChanged:'Til saqlandi',
  },
  ru: {
    settingsTitle:'⚙️ Настройки',
    settingsHint:'🛡️ Niex фильтр работает на YouTube, DuckDuckGo и всех сайтах',
    languageSectionTitle:'🌍 Язык',
    languageLabel:'Язык',
    languageDescription:'Язык интерфейса',
    historySectionTitle:'📚 История',
    historyDescription:'Ваши посещённые сайты хранятся здесь.',
    clearHistory:'Очистить всю историю',
    googleSectionTitle:'🔐 Google Аккаунт',
    googleSectionDesc:'Вход через официальный Google OAuth',
    googleSignIn:'Войти в Google',
    signOut:'Выйти',
    manageAccount:'Управлять аккаунтом',
    searchEngineSectionTitle:'🌐 Поисковая система',
    ddgLabel:'DuckDuckGo',
    ddgDescription:'Конфиденциальный поиск (рекомендуется)',
    googleLabel:'Google',
    googleDescription:'Поиск Google',
    contentProtectionSectionTitle:'🛡️ Защита контента',
    aiUrlLabel:'AI проверка URL',
    aiUrlDesc:'Проверяем каждый URL через AI',
    aiImageLabel:'AI проверка изображений',
    aiImageDesc:'Проверяем изображения на странице через AI',
    ytFilterLabel:'Фильтр YouTube',
    ytFilterDesc:'Блокируем видео и миниатюры',
    adBlockLabel:'Блокировка рекламы',
    adBlockDesc:'Удаляем рекламу на странице',
    windowSectionTitle:'🖥️ Окно',
    newWindowLabel:'Новое окно',
    newWindowDesc:'Кнопка + открывает новое окно',
    search:'Введите URL или запрос...',
    saveSettings:'💾 Сохранить',
    quickLinks:'Быстрые ссылки',
    editLinks:'✏️ Редактировать',
    historyEmpty:'История пуста',
    historyDeleted:'История удалена',
    historyCleared:'Вся история очищена',
    googleSignedIn:'Google аккаунт подключён',
    googleSignedOut:'Выход из Google завершён',
    languageChanged:'Язык сохранён',
  },
  en: {
    settingsTitle:'⚙️ Settings',
    settingsHint:'🛡️ Niex filter works on YouTube, DuckDuckGo and every site',
    languageSectionTitle:'🌍 Language',
    languageLabel:'Language',
    languageDescription:'Interface language',
    historySectionTitle:'📚 History',
    historyDescription:'Your visited sites are stored here.',
    clearHistory:'Clear all history',
    googleSectionTitle:'🔐 Google Account',
    googleSectionDesc:'Login with official Google OAuth',
    googleSignIn:'Sign in with Google',
    signOut:'Sign out',
    manageAccount:'Manage Google Account',
    searchEngineSectionTitle:'🌐 Search engine',
    ddgLabel:'DuckDuckGo',
    ddgDescription:'Private search (recommended)',
    googleLabel:'Google',
    googleDescription:'Google search',
    contentProtectionSectionTitle:'🛡️ Content protection',
    aiUrlLabel:'AI URL analysis',
    aiUrlDesc:'Check every URL with AI',
    aiImageLabel:'AI image analysis',
    aiImageDesc:'Check page images with AI',
    ytFilterLabel:'YouTube filter',
    ytFilterDesc:'Block video titles and thumbnails',
    adBlockLabel:'Ad blocking',
    adBlockDesc:'Remove page ads',
    windowSectionTitle:'🖥️ Window',
    newWindowLabel:'New Window',
    newWindowDesc:'+ button opens a new window',
    search:'Search or enter URL...',
    saveSettings:'💾 Save',
    quickLinks:'Quick links',
    editLinks:'✏️ Edit',
    historyEmpty:'History is empty',
    historyDeleted:'Entry removed',
    historyCleared:'All history cleared',
    googleSignedIn:'Google account linked',
    googleSignedOut:'Signed out of Google',
    languageChanged:'Language saved',
  }
};
let currentLang = 'uz';
let historyItems = [];

function t(key) {
  return (I18N[currentLang] || I18N.uz)[key] || key;
}
function applyTranslations() {
  document.querySelectorAll('[data-i18n-key]').forEach(el => {
    const key = el.getAttribute('data-i18n-key');
    if (key) el.textContent = t(key);
  });
  document.getElementById('si').placeholder = t('search') || 'Qidirish yoki URL kiriting...';
  document.getElementById('btn-nt').textContent = t('newWindowLabel');
  document.getElementById('btn-settings').textContent = t('settingsTitle');
  document.getElementById('btn-su')?.textContent = t('signUp') || document.getElementById('btn-su')?.textContent;
}

async function loadSettings() {
  try {
    const settings = await sn().getSettings();
    currentLang = settings?.lang || 'uz';
    applyTranslations();
    renderLanguageOptions(settings?.lang || 'uz');
  } catch (e) { currentLang = 'uz'; applyTranslations(); }
}

function renderLanguageOptions(value) {
  const select = document.getElementById('language-select');
  if (!select) return;
  select.innerHTML = '';
  [{v:'uz', l:'O‘zbekcha'}, {v:'ru', l:'Русский'}, {v:'en', l:'English'}].forEach(item => {
    const opt = document.createElement('option');
    opt.value = item.v; opt.textContent = item.l;
    if (item.v === value) opt.selected = true;
    select.appendChild(opt);
  });
}

function setLanguage(lang) {
  currentLang = lang;
  applyTranslations();
  sn().saveSettings({ lang });
  toast(t('languageChanged'));
}

async function loadHistory() {
  try {
    historyItems = await sn().getHistory();
    renderHistory();
  } catch (e) { console.warn('history load', e); }
}
function renderHistory() {
  const list = document.getElementById('history-list');
  if (!list) return;
  list.innerHTML = '';
  if (!historyItems || !historyItems.length) {
    const empty = document.createElement('div');
    empty.className = 'history-item';
    empty.style.justifyContent = 'center';
    empty.textContent = t('historyEmpty');
    list.appendChild(empty);
    return;
  }
  historyItems.forEach(item => {
    const row = document.createElement('div');
    row.className = 'history-item';
    const meta = document.createElement('div'); meta.className = 'hmeta';
    meta.innerHTML = '<div class="htitle">' + item.title + '</div><div class="hurl">' + item.url + '</div>';
    const date = document.createElement('div'); date.className = 'hdate';
    date.textContent = new Date(item.timestamp).toLocaleString(currentLang === 'en' ? 'en-US' : currentLang === 'ru' ? 'ru-RU' : 'uz-UZ');
    const btn = document.createElement('button');
    btn.textContent = '✕';
    btn.onclick = async () => { await sn().deleteHistory(item.id); toast(t('historyDeleted')); };
    row.appendChild(meta);
    row.appendChild(date);
    row.appendChild(btn);
    list.appendChild(row);
  });
}

async function refreshGoogleProfile() {
  try {
    const profile = await window.safenet_auth.getProfile();
    if (profile) {
      document.getElementById('google-profile').style.display = 'block';
      document.getElementById('btn-google-login').style.display = 'none';
      document.getElementById('g-avatar').textContent = profile.picture ? '' : '👤';
      if (profile.picture) {
        document.getElementById('g-avatar').style.backgroundImage = 'url(' + profile.picture + ')';
        document.getElementById('g-avatar').style.backgroundSize = 'cover';
      }
      document.getElementById('g-name').textContent = profile.name || profile.email || '';
      document.getElementById('g-email').textContent = profile.email || '';
      // Obunani shu Google hisobga sync qilish (account-keyed tekshiruv)
      if (profile.email) { try { ipcRenderer.send('account-set', profile.email); } catch {} }
    } else {
      document.getElementById('google-profile').style.display = 'none';
      document.getElementById('btn-google-login').style.display = 'block';
    }
  } catch (e) { console.warn('google profile', e); }
}

function initGoogleAuth() {
  window.safenet_auth.onGoogleAuth(user => {
    refreshGoogleProfile();
    toast(user ? t('googleSignedIn') : t('googleSignedOut'));
  });
}

function initHistorySubscriptions() {
  sn().onHistoryUpdated(items => { historyItems = items; renderHistory(); });
}

// window.safenet preload.js orqali keladi — tayyor bo'lishini kut
function sn() { return window.safenet; }

function nav(u) {
  if (sn()) { sn().navigate(u); }
  else { setTimeout(() => nav(u), 100); }
}

// ── SEARCH ──
function doSearch() {
  const v = document.getElementById('si').value.trim();
  if (!v) return;
  let url = v;
  if (!url.startsWith('http://') && !url.startsWith('https://')) {
    if (url.includes('.') && !url.includes(' ')) url = 'https://' + url;
    else url = ENGS[cfg.eng||'ddg'] + encodeURIComponent(v);
  }
  nav(url);
}
document.getElementById('si').addEventListener('keydown', e => { if (e.key === 'Enter') doSearch(); });
document.getElementById('sg').addEventListener('click', doSearch);
document.getElementById('btn-nt').addEventListener('click', () => sn()?.newTab(''));

// ── STATS ──
function initStats() {
  if (!sn()?.onStats) { setTimeout(initStats, 200); return; }
  sn().onStats(s => {
    document.getElementById('v-bl').textContent  = s.block    || 0;
    document.getElementById('v-bi').textContent  = s.blockImg || 0;
    document.getElementById('v-tot').textContent = s.total    || 0;
    const pb = document.getElementById('p-bl'), pi2 = document.getElementById('p-bi'), pt = document.getElementById('p-tot');
    if (pb) pb.textContent = s.block    || 0;
    if (pi2) pi2.textContent = s.blockImg || 0;
    if (pt) pt.textContent = s.total    || 0;
  });
}

// ── QUICK LINKS ──
function renderQL() {
  const g = document.getElementById('qg'); g.innerHTML = '';
  links.forEach(l => {
    const b = document.createElement('button');
    b.className = 'qb';
    b.innerHTML = '<span>' + l.e + '</span>' + l.n;
    b.addEventListener('click', () => nav(l.u));
    g.appendChild(b);
  });
  const a = document.createElement('button');
  a.className = 'qadd'; a.textContent = "+ Qo'shish";
  a.addEventListener('click', () => openOv('ov-l'));
  g.appendChild(a);
}

// ── SETTINGS TOGGLES ──
function initToggles() {
  document.getElementById('t-ddg').className = 'tg' + (cfg.eng === 'ddg' ? ' on' : '');
  document.getElementById('t-gg').className  = 'tg' + (cfg.eng === 'google' ? ' on' : '');
  ['ai','img','yt','ab','tab'].forEach(k => {
    document.getElementById('t-'+k).className = 'tg' + (cfg[k] ? ' on' : '');
  });
}
document.getElementById('t-ddg').addEventListener('click', () => { cfg.eng='ddg'; initToggles(); });
document.getElementById('t-gg').addEventListener('click',  () => { cfg.eng='google'; initToggles(); });
['ai','img','yt','ab','tab'].forEach(k => {
  document.getElementById('t-'+k).addEventListener('click', () => {
    cfg[k] = !cfg[k];
    document.getElementById('t-'+k).className = 'tg' + (cfg[k] ? ' on' : '');
  });
});

// Settings modal ochilganda togglelarni yangilash
document.getElementById('btn-settings')?.addEventListener('click', () => { initToggles(); openOv('ov-s'); });
// Header dagi sozlamalar tugmasi
document.querySelector('[onclick*="ov-s"]')?.removeAttribute('onclick');
document.querySelector('.tbtn:nth-child(2)')?.addEventListener('click', () => { initToggles(); openOv('ov-s'); });

document.getElementById('save-s').addEventListener('click', () => {
  localStorage.setItem('sn_c', JSON.stringify(cfg));
  // safenet tayyor bo'lsa yuborish
  if (sn()?.saveSettings) sn().saveSettings(cfg);
  closeOv('ov-s'); toast('✅ Sozlamalar saqlandi!');
});

// ── PROFILE ──
function renderProfile() {
  const out = document.getElementById('pv-out');
  const inp = document.getElementById('pv-in');
  const su  = document.getElementById('pv-su');
  if (user) {
    out.style.display='none'; su.style.display='none'; inp.style.display='block';
    const ini = (user.n||'?').charAt(0).toUpperCase();
    document.getElementById('pav').textContent = ini;
    document.getElementById('pnm').textContent = user.n || '';
    document.getElementById('pem').textContent = user.e || '';
    document.getElementById('av').textContent  = ini;
  } else {
    out.style.display='block'; inp.style.display='none'; su.style.display='none';
    document.getElementById('av').textContent = '?';
  }
}
document.getElementById('btn-gg').addEventListener('click', () => {
  user = { n: 'Google Foydalanuvchi', e: 'user@gmail.com', p: 'google' };
  localStorage.setItem('sn_u', JSON.stringify(user));
  
  // Initialize profile with profileCompleted = false to trigger onboarding
  const initialProfile = {
    googleUid: 'google_' + Date.now(),
    email: 'user@gmail.com',
    photoURL: 'data:image/svg+xml,<svg></svg>',
    personalInfo: null,
    interests: [],
    profileCompleted: false,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
  localStorage.setItem('sn_user_profile', JSON.stringify(initialProfile));
  
  // Open personal info window to start onboarding
  const width = 550;
  const height = 650;
  const left = (screen.width - width) / 2;
  const top = (screen.height - height) / 2;
  window.open(
    './onboarding/personal-info.html',
    'personal-info',
    'width=' + width + ',height=' + height + ',left=' + left + ',top=' + top + ',modal=yes'
  );
  
  toast('📋 Iltimos, shaxsiy ma\'lumotlaringizni kiriting...');
});
document.getElementById('btn-li').addEventListener('click', () => {
  const e = document.getElementById('l-em').value.trim();
  const p = document.getElementById('l-pw').value;
  if (!e || !p) { toast('❌ Email va parol kiriting!'); return; }
  if (accounts[e] && accounts[e].pw === p) {
    user = { n: accounts[e].nm, e, p: 'email' };
    localStorage.setItem('sn_u', JSON.stringify(user));
    ipcRenderer.send('account-set', e); // obunani shu hisobga moslash
    renderProfile(); toast('✅ Xush kelibsiz, ' + user.n + '!');
  } else toast('❌ Email yoki parol xato!');
});
document.getElementById('btn-to-su').addEventListener('click', () => {
  document.getElementById('pv-out').style.display = 'none';
  document.getElementById('pv-su').style.display  = 'block';
});
document.getElementById('btn-to-li').addEventListener('click', () => {
  document.getElementById('pv-out').style.display = 'block';
  document.getElementById('pv-su').style.display  = 'none';
});
document.getElementById('btn-su').addEventListener('click', () => {
  const nm = document.getElementById('su-nm').value.trim();
  const e  = document.getElementById('su-em').value.trim();
  const p  = document.getElementById('su-pw').value;
  if (!nm||!e||!p) { toast('❌ Barcha maydonlarni to\'ldiring!'); return; }
  if (p.length < 6) { toast('❌ Parol kamida 6 belgi!'); return; }
  if (accounts[e]) { toast('❌ Bu email allaqachon bor!'); return; }
  accounts[e] = { nm, pw: p };
  localStorage.setItem('sn_a', JSON.stringify(accounts));
  user = { n: nm, e, p: 'email' };
  localStorage.setItem('sn_u', JSON.stringify(user));
  ipcRenderer.send('account-set', e); // yangi hisob → obuna tekshiruvi
  renderProfile(); toast('✅ Hisob yaratildi, xush kelibsiz!');
});
document.getElementById('btn-so').addEventListener('click', () => {
  user = null; localStorage.removeItem('sn_u');
  ipcRenderer.send('account-set', null); // chiqildi → Free
  renderProfile(); closeOv('ov-p'); toast('👋 Chiqildi');
});

// ── LINKS EDIT ──
function renderLL() {
  const c = document.getElementById('ll'); c.innerHTML = '';
  links.forEach((l, i) => {
    const d = document.createElement('div'); d.className = 'li';
    d.innerHTML = '<span class="lie">' + l.e + '</span><div class="lin"><div class="linn">' + l.n + '</div><div class="linu">' + l.u + '</div></div>';
    const btn = document.createElement('button'); btn.className = 'ldl'; btn.textContent = '✕';
    btn.addEventListener('click', () => delLink(i));
    d.appendChild(btn); c.appendChild(d);
  });
}
document.getElementById('btn-ql').addEventListener('click', () => { renderLL(); openOv('ov-l'); });
document.getElementById('btn-al').addEventListener('click', () => {
  const nm = document.getElementById('nl-n').value.trim();
  const url = document.getElementById('nl-u').value.trim();
  const em  = document.getElementById('nl-e').value.trim() || '🔗';
  if (!nm || !url) { toast('❌ Nom va URL kiriting!'); return; }
  links.push({ n: nm, u: url.startsWith('http') ? url : 'https://' + url, e: em });
  localStorage.setItem('sn_l', JSON.stringify(links));
  document.getElementById('nl-n').value = '';
  document.getElementById('nl-u').value = '';
  document.getElementById('nl-e').value = '';
  renderQL(); renderLL(); toast('✅ Qo\'shildi!');
});
function delLink(i) {
  links.splice(i, 1);
  localStorage.setItem('sn_l', JSON.stringify(links));
  renderQL(); renderLL();
}

// ── EXTENSIONS UI ──
async function loadExtensionsUI() {
  try {
    const list = (window.safenet_extensions && window.safenet_extensions.list) ? await window.safenet_extensions.list() : [];
    renderExtensions(list || []);
  } catch (e) { console.warn('loadExtensionsUI', e); }
}

function renderExtensions(list) {
  const out = document.getElementById('extensions-list'); if (!out) return; out.innerHTML = '';
  if (!list || !list.length) { out.innerHTML = '<div class="li">No extensions installed</div>'; return; }
  list.forEach(ext => {
    const d = document.createElement('div'); d.className = 'li';
    d.innerHTML = '<div style="flex:1"><div class="linn">' + (ext.name||ext.id) + '</div><div class="linu">' + (ext.url||'') + '</div></div>';
    const btnToggle = document.createElement('button'); btnToggle.className = 'bs'; btnToggle.style.marginRight='8px'; btnToggle.textContent = ext.enabled ? 'Disable' : 'Enable';
    btnToggle.onclick = async () => { await window.safenet_extensions.toggle(ext.id, !ext.enabled); };
    const btnDel = document.createElement('button'); btnDel.className = 'ldl'; btnDel.textContent = '✕';
    btnDel.onclick = async () => { await window.safenet_extensions.uninstall(ext.id); };
    d.appendChild(btnToggle); d.appendChild(btnDel); out.appendChild(d);
  });
}

document.getElementById('btn-install-ext')?.addEventListener('click', async () => {
  const url = document.getElementById('ext-url').value.trim();
  const name = document.getElementById('ext-name').value.trim();
  if (!url) { toast('❌ Extension URL kiriting'); return; }
  try {
    const res = await window.safenet_extensions.install({ url, name });
    if (res && res.ok) {
      document.getElementById('ext-url').value = ''; document.getElementById('ext-name').value = '';
      toast('✅ Extension installed');
      loadExtensionsUI();
    } else {
      toast('❌ ' + (res && res.error) || 'Install failed');
    }
  } catch (e) { toast('❌ ' + String(e.message)); }
});

if (window.safenet_extensions && window.safenet_extensions.onChanged) {
  window.safenet_extensions.onChanged(list => { loadExtensionsUI(); });
}
// initial load
setTimeout(loadExtensionsUI, 600);

// ── MODALS ──
function openOv(id)  { document.getElementById(id).classList.add('open'); }
function closeOv(id) { document.getElementById(id).classList.remove('open'); }
document.getElementById('cls-s').addEventListener('click', () => closeOv('ov-s'));
document.getElementById('cls-p').addEventListener('click', () => closeOv('ov-p'));
document.getElementById('cls-l').addEventListener('click', () => closeOv('ov-l'));
['ov-s','ov-p','ov-l'].forEach(id => {
  document.getElementById(id).addEventListener('click', e => { if (e.target.id === id) closeOv(id); });
});

// Header tugmalarini to'g'ri bog'lash (onclick atributlari o'rniga)
document.getElementById('btn-settings').onclick = () => { initToggles(); openOv('ov-s'); };
document.getElementById('av').onclick = () => openOv('ov-p');

document.getElementById('language-select')?.addEventListener('change', e => setLanguage(e.target.value));
document.getElementById('btn-clear-history')?.addEventListener('click', async () => {
  await sn().clearHistory();
  toast(t('historyCleared'));
});
document.getElementById('btn-google-login')?.addEventListener('click', async () => {
  try {
    const result = await window.safenet_auth.signInGoogle();
    if (!result.ok) throw new Error(result.error || 'OAuth failed');
    toast(t('googleSignedIn'));
    refreshGoogleProfile();
  } catch (e) {
    toast('❌ ' + String(e.message));
  }
});
document.getElementById('btn-google-signout')?.addEventListener('click', async () => {
  await window.safenet_auth.signOut();
  refreshGoogleProfile();
});
document.getElementById('btn-google-manage')?.addEventListener('click', () => {
  window.safenet_auth.openAccount();
});

initHistorySubscriptions();
loadHistory();
loadSettings();
initGoogleAuth();

// ── TOAST ──
function toast(msg) {
  const el = document.createElement('div');
  el.style.cssText = 'position:fixed;bottom:20px;left:50%;transform:translateX(-50%);background:#1A2235;border:1px solid #1E2D45;color:#E8F0FE;padding:10px 18px;border-radius:11px;font-size:13px;font-weight:600;z-index:9999;pointer-events:none';
  el.textContent = msg; document.body.appendChild(el);
  setTimeout(() => el.remove(), 3000);
}

// ── INIT ──
renderQL();
renderProfile();
// Startup'da lokal hisob bo'lsa — obunani main'ga sync qilish (account-keyed tekshiruv)
try { if (user && user.e) ipcRenderer.send('account-set', user.e); } catch {}
initToggles();
initStats();
<\/script>
</body></html>`;
}

// ── TOOLBAR ──
function toolbarHTML() {
  return `<!DOCTYPE html><html><head><meta charset="UTF-8">
<style>
*{margin:0;padding:0;box-sizing:border-box;user-select:none}
body{background:#0F1623;border-bottom:1px solid #1E2D45;height:90px;display:flex;flex-direction:column;justify-content:space-between;padding:0 10px;font-family:system-ui;-webkit-app-region:drag}
.top-row{display:flex;align-items:center;gap:4px;-webkit-app-region:no-drag}
.nb{width:34px;height:34px;background:#1A2235;border:1px solid #1E2D45;border-radius:9px;display:flex;align-items:center;justify-content:center;cursor:pointer;font-size:15px;color:#E8F0FE;transition:all .15s;-webkit-app-region:no-drag}
.nb:hover{background:#243044}.nb:active{transform:scale(.92)}.nb.dis{opacity:.3;pointer-events:none}
.nb.home{background:linear-gradient(135deg,#00E5A0,#00C885);border-color:transparent;color:#0A0E1A;font-size:17px}
.nb.home:hover{box-shadow:0 0 14px rgba(0,229,160,.4)}
.nb.nt{background:#1A2235;border-color:#2d3f5e;color:#00E5A0;font-size:17px;font-weight:700}
.nb.nt:hover{box-shadow:0 0 10px rgba(0,229,160,.2)}
.tab-bar{display:flex;align-items:center;gap:6px;overflow-x:auto;padding:8px 0;min-height:34px}
.tab-pill{display:flex;align-items:center;gap:6px;max-width:240px;min-width:80px;padding:5px 10px;border-radius:999px;background:rgba(255,255,255,.06);color:#E8F0FE;font-size:12px;cursor:pointer;border:1px solid transparent;transition:all .15s;overflow:hidden}
.tab-pill:hover{background:rgba(255,255,255,.12)}
.tab-pill.active{background:rgba(0,229,160,.18);color:#00E5A0;border-color:rgba(0,229,160,.25)}
.tab-pill .tab-title{display:inline-block;max-width:140px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;vertical-align:middle;}
.tab-pill .tab-close{display:inline-flex;align-items:center;justify-content:center;width:18px;height:18px;border-radius:50%;background:rgba(255,255,255,.08);color:#E8F0FE;font-size:11px;cursor:pointer;flex-shrink:0;}
.tab-pill .tab-close:hover{background:rgba(255,255,255,.18)}
.uw{flex:1;display:flex;align-items:center;background:#1A2235;border:1px solid #1E2D45;border-radius:11px;padding:0 11px;height:34px;gap:7px;-webkit-app-region:no-drag;transition:border-color .2s}
.uw:focus-within{border-color:#00E5A0;box-shadow:0 0 0 2px rgba(0,229,160,.1)}
.sd{width:7px;height:7px;border-radius:50%;flex-shrink:0;background:#00E5A0}
.sd.red{background:#FF4757}
#ui{flex:1;background:transparent;border:none;outline:none;color:#E8F0FE;font-size:13px;font-family:inherit}
#ui::placeholder{color:#4a5568}
.rb{width:34px;height:34px;background:#1A2235;border:1px solid #1E2D45;border-radius:9px;display:flex;align-items:center;justify-content:center;cursor:pointer;font-size:16px;color:#E8F0FE;-webkit-app-region:no-drag}
.rb:hover{background:#243044}
.aib{display:flex;align-items:center;gap:5px;background:rgba(0,229,160,.1);border:1px solid rgba(0,229,160,.2);border-radius:7px;padding:4px 9px;font-size:11px;color:#00E5A0;font-weight:600;white-space:nowrap;-webkit-app-region:no-drag}
.dot{width:5px;height:5px;background:#00E5A0;border-radius:50%;animation:bl 2s infinite}
@keyframes bl{0%,100%{opacity:1}50%{opacity:.3}}
.blk{background:rgba(255,71,87,.12);border:1px solid rgba(255,71,87,.25);border-radius:7px;padding:4px 9px;font-size:11px;color:#FF4757;font-weight:700;white-space:nowrap;-webkit-app-region:no-drag}
.pro-btn{display:flex;align-items:center;gap:4px;background:linear-gradient(135deg,#FFD36E,#F5A623);border:none;border-radius:7px;padding:4px 11px;font-size:11px;color:#3a2600;font-weight:800;white-space:nowrap;cursor:pointer;-webkit-app-region:no-drag;transition:all .15s;box-shadow:0 2px 8px rgba(245,166,35,.3)}
.pro-btn:hover{transform:translateY(-1px);box-shadow:0 4px 14px rgba(245,166,35,.5)}
.pro-btn:active{transform:scale(.95)}
.pro-btn.is-pro{background:linear-gradient(135deg,#00E5A0,#00C885);color:#053225}
.bell{position:relative;width:34px;height:34px;background:#1A2235;border:1px solid #1E2D45;border-radius:9px;display:flex;align-items:center;justify-content:center;cursor:pointer;font-size:15px;color:#E8F0FE;-webkit-app-region:no-drag;transition:all .15s}
.bell:hover{background:#243044;border-color:#2d3f5e}
.bell.has-unread{border-color:rgba(0,229,160,.4)}
.bell-badge{position:absolute;top:-5px;right:-5px;min-width:16px;height:16px;padding:0 4px;background:linear-gradient(135deg,#FF5A6E,#e0344a);color:#fff;font-size:9px;font-weight:800;border-radius:9px;display:flex;align-items:center;justify-content:center;border:2px solid #0F1623;box-shadow:0 0 8px rgba(255,90,110,.6)}
#tb-backdrop{display:none;position:fixed;inset:0;background:rgba(6,10,18,.5);backdrop-filter:blur(2px);z-index:9998;-webkit-app-region:no-drag}
.fc-timer{display:none;align-items:center;gap:7px;background:linear-gradient(135deg,rgba(0,229,160,.18),rgba(0,200,133,.14));border:1px solid rgba(0,229,160,.5);border-radius:8px;padding:5px 12px;font-size:12px;color:#7fffcf;font-weight:800;white-space:nowrap;-webkit-app-region:no-drag;letter-spacing:.5px;box-shadow:0 0 12px rgba(0,229,160,.25)}
.fc-timer.on{display:flex}
.fc-timer .fc-dot{width:6px;height:6px;background:#00E5A0;border-radius:50%;box-shadow:0 0 8px #00E5A0;animation:bl 1.5s infinite}
.fc-timer .fc-t{font-variant-numeric:tabular-nums;color:#eaf0fb;letter-spacing:1px}
</style></head><body>
<div id="tb-backdrop"></div>
<div class="top-row">
  <div class="nb dis" id="bb">&#8592;</div>
  <div class="nb dis" id="fb">&#8594;</div>
  <div class="nb home" id="hb">&#8962;</div>
  <div class="nb nt" id="nt">+</div>
  <div class="uw">
    <div class="sd" id="sd"></div>
    <input id="ui" type="text" placeholder="Qidirish yoki URL kiriting..." autocomplete="off" spellcheck="false"/>
    <div id="sbtn" style="width:26px;height:26px;background:linear-gradient(135deg,#00E5A0,#00C885);border-radius:7px;display:flex;align-items:center;justify-content:center;cursor:pointer;flex-shrink:0;font-size:13px;-webkit-app-region:no-drag;transition:all .15s" title="Qidirish">🔍</div>
  </div>
  <div class="rb" id="rb">⟳</div>
  <div class="fc-timer" id="fc-live-timer" title="Focus Mode faol"><div class="fc-dot"></div>🎯 <span class="fc-t" id="fc-live-timer-text">--:--</span></div>
  <div class="aib"><div class="dot"></div>AI Faol</div>
  <div class="blk" id="blk">🛡️ 0 blok</div>
  <div class="pro-btn" id="pro-btn" title="Premium">👑 <span id="pro-label">Pro</span></div>
  <div class="rb" id="focus-btn" title="Focus Mode">🎯</div>
  <div class="bell" id="notif-btn" title="Notifications">🔔<span class="bell-badge" id="notif-count" style="display:none">0</span></div>
  <div class="rb" id="ext-btn" title="Extensions" style="position:relative">🧩<span id="ext-count" style="display:none;position:absolute;top:-4px;right:-4px;background:#00E5A0;color:#0A0E1A;font-size:9px;font-weight:700;border-radius:9px;min-width:16px;height:14px;padding:0 4px;display:flex;align-items:center;justify-content:center">0</span></div>
</div>
<div class="tab-bar" id="tab-bar"></div>

<!-- CHROME EXTENSION DROPDOWN -->
<div id="ext-panel" style="display:none;position:fixed;top:44px;right:10px;width:340px;max-height:480px;background:#0F1623;border:1px solid #1E2D45;border-radius:12px;box-shadow:0 10px 40px rgba(0,0,0,.6);z-index:99999;-webkit-app-region:no-drag;overflow:hidden;font-family:system-ui">
  <div style="padding:12px 14px;border-bottom:1px solid #1E2D45;display:flex;align-items:center;justify-content:space-between;background:#131B2C">
    <div style="font-size:13px;font-weight:700;color:#E8F0FE">Extensions</div>
    <div style="display:flex;gap:6px">
      <button id="ext-add" style="background:linear-gradient(135deg,#00E5A0,#00C885);color:#0A0E1A;border:none;border-radius:7px;padding:6px 10px;font-size:11px;font-weight:600;cursor:pointer">+ O'rnatish</button>
      <button id="ext-store" style="background:#1A2235;color:#E8F0FE;border:1px solid #1E2D45;border-radius:7px;padding:6px 10px;font-size:11px;cursor:pointer">Store</button>
    </div>
  </div>
  <div id="ext-list" style="max-height:400px;overflow-y:auto;padding:6px 0"></div>
  <div id="ext-empty" style="display:none;padding:30px 20px;text-align:center;color:#4a5568;font-size:12px">
    <div style="font-size:32px;margin-bottom:8px">🧩</div>
    Hech qanday extension o'rnatilmagan.<br/>
    <span style="font-size:11px">Chrome extension papkasini "Load Unpacked" orqali o'rnating.</span>
  </div>
</div>
<div id="notif-panel" style="display:none;position:fixed;top:44px;right:60px;width:360px;max-height:520px;background:#0F1623;border:1px solid #1E2D45;border-radius:12px;box-shadow:0 10px 40px rgba(0,0,0,.6);z-index:99999;-webkit-app-region:no-drag;overflow:hidden;font-family:system-ui">
  <div style="padding:12px 14px;border-bottom:1px solid #1E2D45;display:flex;align-items:center;justify-content:space-between;background:#131B2C">
    <div style="font-size:13px;font-weight:700;color:#E8F0FE">Notifications</div>
    <button id="notif-clear" style="background:#1A2235;color:#E8F0FE;border:1px solid #2d3f5e;border-radius:7px;padding:6px 10px;font-size:11px;cursor:pointer">Mark all read</button>
  </div>
  <div id="notif-list" style="max-height:420px;overflow-y:auto;padding:10px"></div>
  <div id="notif-loading" style="display:none;padding:20px;text-align:center;color:#A5B1C8;font-size:12px">
    <div style="height:12px;width:80%;background:rgba(255,255,255,.06);border-radius:999px;margin:0 auto 10px"></div>
    <div style="height:12px;width:60%;background:rgba(255,255,255,.06);border-radius:999px;margin:0 auto 10px"></div>
    <div style="height:12px;width:70%;background:rgba(255,255,255,.06);border-radius:999px;margin:0 auto"></div>
  </div>
  <div id="notif-empty" style="display:none;padding:24px 16px;text-align:center;color:#4a5568;font-size:12px">
    <div style="font-size:28px;margin-bottom:8px">🔕</div>
    Hech qanday yangi bildirishnoma yo'q.
  </div>
  <div id="notif-error" style="display:none;padding:20px;text-align:center;color:#F66E6E;font-size:12px">
    <div style="font-size:28px;margin-bottom:8px">⚠️</div>
    <div class="notif-error-message" style="margin-bottom:12px">Unable to load notifications.</div>
    <button id="notif-retry" style="background:#1A2235;color:#E8F0FE;border:1px solid #2d3f5e;border-radius:7px;padding:8px 12px;font-size:11px;cursor:pointer">Retry</button>
  </div>
</div>
<div id="focus-panel" style="display:none;position:fixed;top:44px;right:220px;width:360px;max-height:520px;background:#0F1623;border:1px solid #1E2D45;border-radius:12px;box-shadow:0 10px 40px rgba(0,0,0,.6);z-index:99999;-webkit-app-region:no-drag;overflow:hidden;font-family:system-ui">
  <div style="padding:12px 14px;border-bottom:1px solid #1E2D45;display:flex;align-items:center;justify-content:space-between;background:#131B2C">
    <div style="font-size:13px;font-weight:700;color:#E8F0FE">Focus Mode</div>
    <div style="font-size:11px;color:#00E5A0">Premium</div>
  </div>
  <div id="focus-body" style="padding:12px 14px;font-size:12px;color:#A5B1C8"></div>
</div>
<script>
if (!window.ipcRenderer) window.ipcRenderer = window._ipc;

const TRANSLATIONS = {
  uz: {
    search:'Qidirish yoki URL kiriting...',
    aiActive:'AI Faol',
    home:'Bosh sahifa',
    reload:'Yangilash',
    newTab:'Yangi',
    blocks:'🛡️ {count} blok',
    back:'Orqaga',
    forward:'Oldinga'
  },
  ru: {
    search:'Введите URL или запрос...',
    aiActive:'AI Вкл',
    home:'Домой',
    reload:'Обновить',
    newTab:'Новая',
    blocks:'🛡️ {count} блоков',
    back:'Назад',
    forward:'Вперёд'
  },
  en: {
    search:'Search or enter URL...',
    aiActive:'AI On',
    home:'Home',
    reload:'Reload',
    newTab:'New',
    blocks:'🛡️ {count} blocked',
    back:'Back',
    forward:'Forward'
  }
};
let currentLang = 'uz';

function translate(key, vars) {
  const text = (TRANSLATIONS[currentLang] || TRANSLATIONS.uz)[key] || '';
  if (!vars) return text;
  return text.replace(/\{(\w+)\}/g, (_, name) => vars[name] || '');
}

async function initToolbarLanguage() {
  try {
    const settings = await ipcRenderer.invoke('settings-get');
    currentLang = (settings && settings.lang) ? settings.lang : 'uz';
  } catch (e) { currentLang = 'uz'; }
  applyToolbarTranslations();
}

function applyToolbarTranslations() {
  const ui = document.getElementById('ui');
  if (ui) ui.placeholder = translate('search');
  const hb = document.getElementById('hb');
  if (hb) hb.title = translate('home');
  const sbtn = document.getElementById('sbtn');
  if (sbtn) sbtn.title = translate('search');
  const aiBadge = document.querySelector('.aib');
  if (aiBadge) aiBadge.textContent = translate('aiActive');
  renderTabs(window._tabCache || [], window._activeTabCache);
}

function initToolbar() {
  const bb = document.getElementById('bb');
  const fb = document.getElementById('fb');
  const hb = document.getElementById('hb');
  const nt = document.getElementById('nt');
  const rb = document.getElementById('rb');
  const sbtn = document.getElementById('sbtn');
  const ui = document.getElementById('ui');
  const tabBar = document.getElementById('tab-bar');

  if (!bb || !fb || !hb || !nt || !rb || !sbtn || !ui || !tabBar) {
    console.error('Toolbar initialization failed: missing elements');
    return;
  }

  bb.onclick = () => ipcRenderer.send('go-back');
  fb.onclick = () => ipcRenderer.send('go-forward');
  hb.onclick = () => ipcRenderer.send('go-home');
  nt.onclick = () => ipcRenderer.send('new-tab', '');
  rb.onclick = () => ipcRenderer.send('reload');

  function doNav() {
    const v = ui.value.trim();
    if (!v) return;
    let url = v;
    if (!url.startsWith('http://') && !url.startsWith('https://')) {
      if (url.includes('.') && !url.includes(' ')) url = 'https://' + url;
      else url = 'https://duckduckgo.com/?q=' + encodeURIComponent(v);
    }
    ipcRenderer.send('navigate', url);
    ui.blur();
  }

  ui.addEventListener('keydown', e => { if (e.key === 'Enter') doNav(); });
  sbtn.addEventListener('click', doNav);
  ui.addEventListener('focus', () => ui.select());

  initToolbarLanguage();

  ipcRenderer.on('url-changed', (_, d) => {
    const uiField = document.getElementById('ui');
    if (uiField) uiField.value = d.isHome ? '' : (d.url || '');
    const sd = document.getElementById('sd');
    if (sd) sd.classList.toggle('red', !!d.blocked);
    bb.classList.toggle('dis', !d.canGoBack);
    fb.classList.toggle('dis', !d.canGoForward);
  });

  ipcRenderer.on('stats-update', (_, s) => {
    const blk = document.getElementById('blk');
    if (blk) blk.textContent = '🛡️ ' + (s.block + s.blockImg) + ' blok';
  });

  ipcRenderer.on('loading', (_, v) => { rb.textContent = v ? '✕' : '⟳'; });
  ipcRenderer.on('settings-changed', (_, s) => {
    currentLang = (s && s.lang) ? s.lang : currentLang;
    applyToolbarTranslations();
  });
  ipcRenderer.on('tabs-update', (_, d) => { renderTabs(d.tabs || [], d.activeId); });
  ipcRenderer.on('focus-state-update', async (_, state) => {
    focusUiState = { canUseFocus: !!state?.canUseFocus, activeSession: state?.activeSession || null, usage: state?.usage || null, subscription: state?.subscription || null };
    renderFocusPanel();
    updateLiveFocusTimer(state?.activeSession);
  });

  // ── JONLI FOCUS TIMER (har sahifada toolbar tepasida ko'rinadi) ──
  //   Focus faol bo'lganda kichik chip ko'rsatiladi va har sekundda yangilanadi.
  //   Focus tugasa yoki to'xtatilsa avtomatik yashiriladi. Foydalanuvchiga xalaqit
  //   bermaydi — kichik, o'rtacha razmerda, doim tepada.
  let fcTimerEnds = 0;
  let fcTimerInt = null;
  function tickLiveFocusTimer() {
    const chip = document.getElementById('fc-live-timer');
    const txt = document.getElementById('fc-live-timer-text');
    if (!chip || !txt) return;
    if (!fcTimerEnds) { chip.classList.remove('on'); return; }
    const remain = Math.max(0, fcTimerEnds - Date.now());
    if (remain === 0) {
      fcTimerEnds = 0;
      chip.classList.remove('on');
      if (fcTimerInt) { clearInterval(fcTimerInt); fcTimerInt = null; }
      return;
    }
    const s = Math.floor(remain / 1000);
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const ss = s % 60;
    txt.textContent = (h > 0 ? h + ':' : '') + String(m).padStart(2, '0') + ':' + String(ss).padStart(2, '0');
    chip.classList.add('on');
  }
  function updateLiveFocusTimer(activeSession) {
    if (activeSession && activeSession.state === 'active' && activeSession.endsAt) {
      fcTimerEnds = Number(activeSession.endsAt) || 0;
      if (!fcTimerInt) fcTimerInt = setInterval(tickLiveFocusTimer, 1000);
      tickLiveFocusTimer();
    } else {
      fcTimerEnds = 0;
      const chip = document.getElementById('fc-live-timer');
      if (chip) chip.classList.remove('on');
      if (fcTimerInt) { clearInterval(fcTimerInt); fcTimerInt = null; }
    }
  }
  // Boshlang'ich holat — sahifa ochilishida focus faol bo'lsa timer'ni ko'rsatamiz
  ipcRenderer.invoke('focus-get').then((s) => updateLiveFocusTimer(s && s.activeSession)).catch(() => {});
}

initToolbar();

function renderTabs(tabs, activeId) {
  window._tabCache = tabs;
  window._activeTabCache = activeId;
  const tabBar = document.getElementById('tab-bar');
  if (!tabBar) return;
  tabBar.innerHTML = '';
  tabs.forEach(tab => {
    const btn = document.createElement('button');
    btn.className = 'tab-pill' + (tab.id === activeId ? ' active' : '');
    const title = tab.title || translate('newTab');
    btn.title = title;
    const titleSpan = document.createElement('span');
    titleSpan.className = 'tab-title';
    titleSpan.textContent = title;
    btn.appendChild(titleSpan);
    const close = document.createElement('span');
    close.className = 'tab-close';
    close.textContent = '×';
    close.title = 'Close tab';
    close.addEventListener('click', e => {
      e.stopPropagation();
      ipcRenderer.send('close-tab', tab.id);
    });
    btn.appendChild(close);
    btn.addEventListener('click', () => ipcRenderer.send('switch-tab', tab.id));
    tabBar.appendChild(btn);
  });
}

// ============================================================
// CHROME EXTENSION MANAGER UI
// ============================================================
const extBtn = document.getElementById('ext-btn');
const extPanel = document.getElementById('ext-panel');
const extList = document.getElementById('ext-list');
const extEmpty = document.getElementById('ext-empty');
const extCount = document.getElementById('ext-count');
const extAdd = document.getElementById('ext-add');
const extStore = document.getElementById('ext-store');

const notifBtn = document.getElementById('notif-btn');
const notifPanel = document.getElementById('notif-panel');
const notifList = document.getElementById('notif-list');
const notifLoading = document.getElementById('notif-loading');
const notifEmpty = document.getElementById('notif-empty');
const notifError = document.getElementById('notif-error');
const notifRetry = document.getElementById('notif-retry');
const notifClear = document.getElementById('notif-clear');
const notifCount = document.getElementById('notif-count');
const focusBtn = document.getElementById('focus-btn');
const focusPanel = document.getElementById('focus-panel');
const focusBody = document.getElementById('focus-body');
let focusUiState = { canUseFocus: false, activeSession: null, usage: null, subscription: null };

function formatMinutes(value) {
  const minutes = Math.max(0, Number(value) || 0);
  return minutes + ' min';
}

function escHTML(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}
function renderToolbarFocusBlocklist(host) {
  if (!host) return;
  ipcRenderer.invoke('focus-blocks-get').then(data => {
    data = data || {};
    const custom = Array.isArray(data.customDomains) ? data.customDomains : [];
    host.innerHTML =
      '<div style="margin-top:14px;padding-top:12px;border-top:1px solid #1E2D45">' +
      '<div style="font-size:10px;letter-spacing:2px;color:#7E8BA6;font-weight:700;margin-bottom:8px">SHAXSIY BLOCKLIST</div>' +
      '<div style="display:flex;gap:6px;margin-bottom:8px">' +
      '<input id="fb-input" placeholder="facebook.com" style="flex:1;background:#1A2235;border:1px solid #1E2D45;border-radius:7px;color:#E8F0FE;padding:6px 8px;font-size:11px;font-family:inherit" />' +
      '<button id="fb-add" style="background:linear-gradient(135deg,#00E5A0,#00C885);color:#0A0E1A;border:none;border-radius:7px;padding:6px 10px;font-weight:700;cursor:pointer;font-size:11px">+</button>' +
      '</div>' +
      (custom.length === 0
        ? '<div style="font-size:10px;color:#4a5568;text-align:center;padding:8px 0">Hech qanday shaxsiy blok yo\\'q</div>'
        : '<div style="max-height:120px;overflow-y:auto">' + custom.map(d =>
            '<div style="display:flex;align-items:center;justify-content:space-between;padding:5px 8px;background:#131B2C;border-radius:6px;margin-bottom:4px;font-size:11px">' +
            '<span style="color:#E8F0FE">🚫 ' + escHTML(d) + '</span>' +
            '<button data-fb-rm="' + escHTML(d) + '" style="background:transparent;border:none;color:#FF4757;cursor:pointer;font-size:12px;padding:0 4px">✕</button>' +
            '</div>'
          ).join('') + '</div>') +
      '<div style="font-size:10px;color:#4a5568;margin-top:6px;line-height:1.4">Domen qo\\'shsangiz uning barcha sahifalari (subpath/subdomain) ham bloklanadi</div>' +
      '</div>';
    const inp = host.querySelector('#fb-input');
    const addBtn = host.querySelector('#fb-add');
    const doAdd = () => {
      const v = (inp.value || '').trim();
      if (!v) return;
      addBtn.disabled = true;
      ipcRenderer.invoke('focus-blocks-add-domain', v).then(() => {
        addBtn.disabled = false;
        inp.value = '';
        renderToolbarFocusBlocklist(host);
      }).catch(e => { addBtn.disabled = false; console.warn('fb-add', e); });
    };
    addBtn.addEventListener('click', doAdd);
    inp.addEventListener('keydown', e => { if (e.key === 'Enter') doAdd(); });
    Array.prototype.forEach.call(host.querySelectorAll('[data-fb-rm]'), btn => {
      btn.addEventListener('click', () => {
        ipcRenderer.invoke('focus-blocks-remove-domain', btn.dataset.fbRm).then(() => renderToolbarFocusBlocklist(host));
      });
    });
  }).catch(() => {});
}

/* ── FOCUS STATISTIKA (toolbar paneli) ──────────────────────────
   Ma\\'lumot: focus-get → statistics. FocusManager uni sessiyalardan
   hisoblaydi, shu sabab raqamlar har doim haqiqiy. */
const FS_MONTHS = ['Yanvar','Fevral','Mart','Aprel','May','Iyun','Iyul','Avgust','Sentabr','Oktabr','Noyabr','Dekabr'];
const FS_WD = ['Ya','Du','Se','Cho','Pa','Ju','Sha'];

function fsDur(min) {
  min = Math.round(Number(min) || 0);
  if (min <= 0) return '0 daq';
  const h = Math.floor(min / 60), m = min % 60;
  if (h && m) return h + ' soat ' + m + ' daq';
  if (h) return h + ' soat';
  return m + ' daq';
}
function fsMonth(key) {
  if (!key) return '—';
  const p = String(key).split('-');
  return (FS_MONTHS[(Number(p[1]) || 1) - 1] || '?') + ' ' + p[0];
}
function fsTile(label, value, color, sub) {
  return '<div style="flex:1;min-width:0;background:#131B2C;border:1px solid #1E2D45;border-radius:9px;padding:10px 6px;text-align:center">' +
    '<div style="font-size:16px;font-weight:900;color:' + (color || '#E8F0FE') + ';line-height:1.1">' + value + '</div>' +
    '<div style="font-size:9px;letter-spacing:.8px;color:#7E8BA6;text-transform:uppercase;margin-top:5px">' + label + '</div>' +
    (sub ? '<div style="font-size:8px;color:#5f7286;margin-top:2px">' + sub + '</div>' : '') +
    '</div>';
}
function fsDelta(cur, prev) {
  cur = Number(cur) || 0; prev = Number(prev) || 0;
  if (!prev && !cur) return '<span style="color:#7E8BA6;font-size:10px">o\\'zgarishsiz</span>';
  if (!prev) return '<span style="color:#00E5A0;font-size:10px;font-weight:700">▲ yangi</span>';
  const pct = Math.round(((cur - prev) / prev) * 100);
  if (!pct) return '<span style="color:#7E8BA6;font-size:10px">o\\'zgarishsiz</span>';
  return '<span style="color:' + (pct > 0 ? '#00E5A0' : '#FF7A7A') + ';font-size:10px;font-weight:700">' +
    (pct > 0 ? '▲ +' : '▼ ') + pct + '%</span>';
}

function renderToolbarFocusStats() {
  if (!focusBody) return;
  focusBody.innerHTML = '<div style="padding:18px 0;text-align:center;color:#7E8BA6;font-size:12px">Statistika yuklanmoqda…</div>';

  ipcRenderer.invoke('focus-get').then(focus => {
    const st = focus && focus.statistics;
    if (!st) {
      focusBody.innerHTML =
        '<button id="fs-back" style="background:#1A2235;border:1px solid #2d3f5e;border-radius:8px;color:#E8F0FE;padding:7px 10px;cursor:pointer;font-size:12px;margin-bottom:12px">← Orqaga</button>' +
        '<div style="padding:16px;text-align:center;color:#7E8BA6;font-size:12px">Statistika mavjud emas.<br>Brauzerni qayta ishga tushiring.</div>';
      const bk = document.getElementById('fs-back');
      if (bk) bk.addEventListener('click', renderFocusPanel);
      return;
    }

    const streak = st.streak || { current: 0, longest: 0 };
    const today = st.today || { minutes: 0, sessions: 0, blocked: 0 };
    const cm = st.currentMonth || {}, pm = st.previousMonth || {};
    const tot = st.totals || {};
    const week = st.last7Days || [];

    let maxMin = 0;
    week.forEach(d => { if (d.minutes > maxMin) maxMin = d.minutes; });
    let chart = '';
    week.forEach((d, idx) => {
      const pct = maxMin > 0 ? Math.round((d.minutes / maxMin) * 100) : 0;
      const isToday = idx === week.length - 1;
      chart +=
        '<div style="flex:1;display:flex;flex-direction:column;align-items:center;gap:4px">' +
        '<div style="font-size:8px;color:' + (d.minutes ? '#7fffcf' : '#3a4558') + ';height:10px">' + (d.minutes || '') + '</div>' +
        '<div style="width:100%;height:52px;display:flex;align-items:flex-end">' +
        '<div style="width:100%;height:' + Math.max(pct, d.minutes > 0 ? 8 : 3) + '%;border-radius:3px 3px 2px 2px;background:' +
          (d.minutes > 0 ? (isToday ? 'linear-gradient(180deg,#00E5A0,#00C885)' : 'rgba(0,229,160,.45)') : '#1A2235') + '"></div>' +
        '</div>' +
        '<div style="font-size:8px;color:' + (isToday ? '#00E5A0' : '#7E8BA6') + ';font-weight:' + (isToday ? '800' : '600') + '">' +
          (FS_WD[d.weekday] || '') + '</div></div>';
    });

    const hist = (st.monthlyHistory || []).slice(0, 6);
    let rows = hist.map(m =>
      '<div style="display:flex;justify-content:space-between;align-items:center;padding:8px 10px;border-bottom:1px solid #1A2235">' +
      '<div><div style="font-size:11px;font-weight:700;color:#E8F0FE">' + fsMonth(m.month) + '</div>' +
      '<div style="font-size:9px;color:#7E8BA6;margin-top:1px">' + m.sessions + ' sessiya · ' + m.activeDays + ' kun</div></div>' +
      '<div style="font-size:11px;font-weight:800;color:#7fffcf">' + fsDur(m.minutes) + '</div></div>'
    ).join('');
    if (!rows) rows = '<div style="padding:12px;text-align:center;color:#7E8BA6;font-size:11px">Hali ma\\'lumot yo\\'q</div>';

    focusBody.innerHTML =
      '<button id="fs-back" style="background:#1A2235;border:1px solid #2d3f5e;border-radius:8px;color:#E8F0FE;padding:7px 10px;cursor:pointer;font-size:12px;margin-bottom:12px">← Orqaga</button>' +

      '<div style="text-align:center;padding:16px 12px;border-radius:12px;margin-bottom:12px;' +
      'background:radial-gradient(ellipse at 50% 0%,rgba(0,229,160,.16),rgba(0,229,160,.03));' +
      'border:1px solid rgba(0,229,160,' + (streak.current > 0 ? '.3' : '.12') + ')">' +
      '<div style="font-size:26px;line-height:1">' + (streak.current > 0 ? '🔥' : '💤') + '</div>' +
      '<div style="font-size:34px;font-weight:900;color:' + (streak.current > 0 ? '#00E5A0' : '#7E8BA6') + ';letter-spacing:-1px;margin-top:2px">' + streak.current + '</div>' +
      '<div style="font-size:10px;letter-spacing:2px;color:#7fffcf;text-transform:uppercase">kunlik seriya</div>' +
      '<div style="font-size:10px;color:#7E8BA6;margin-top:6px">Eng uzun: <b style="color:#A5B1C8">' + (streak.longest || 0) + '</b> kun</div>' +
      (streak.current === 0 ? '<div style="font-size:10px;color:#FFB86B;margin-top:6px">Seriya uzildi — bugun focus qilsangiz qaytadan boshlanadi</div>' : '') +
      '</div>' +

      '<div style="font-size:10px;letter-spacing:2px;color:#7E8BA6;font-weight:700;margin-bottom:7px">BUGUN</div>' +
      '<div style="display:flex;gap:6px;margin-bottom:12px">' +
        fsTile('Focus', fsDur(today.minutes), '#00E5A0') +
        fsTile('Sessiya', today.sessions, '#E8F0FE') +
        fsTile('Bloklandi', today.blocked, '#FFB86B') +
      '</div>' +

      '<div style="font-size:10px;letter-spacing:2px;color:#7E8BA6;font-weight:700;margin-bottom:7px">OXIRGI 7 KUN</div>' +
      '<div style="display:flex;gap:4px;align-items:flex-end;padding:10px 6px 6px;background:#131B2C;border:1px solid #1E2D45;border-radius:10px;margin-bottom:12px">' + chart + '</div>' +

      '<div style="font-size:10px;letter-spacing:2px;color:#7E8BA6;font-weight:700;margin-bottom:7px">OYLIK HISOBOT</div>' +
      '<div style="background:#131B2C;border:1px solid #1E2D45;border-radius:10px;padding:11px;margin-bottom:12px">' +
      '<div style="display:flex;justify-content:space-between;align-items:flex-start">' +
      '<div><div style="font-size:11px;color:#7fffcf;font-weight:700">' + fsMonth(cm.month) + ' (joriy)</div>' +
      '<div style="font-size:17px;font-weight:900;color:#E8F0FE;margin-top:2px">' + fsDur(cm.minutes) + '</div>' +
      '<div style="font-size:9px;color:#7E8BA6;margin-top:1px">' + (cm.sessions || 0) + ' sessiya · ' + (cm.activeDays || 0) + ' faol kun</div></div>' +
      '<div style="text-align:right">' + fsDelta(cm.minutes, pm.minutes) + '</div></div>' +
      '<div style="height:1px;background:#1E2D45;margin:9px 0"></div>' +
      '<div style="display:flex;justify-content:space-between;align-items:center">' +
      '<div><div style="font-size:11px;color:#A5B1C8;font-weight:700">' + fsMonth(pm.month) + ' (o\\'tgan)</div>' +
      '<div style="font-size:14px;font-weight:800;color:#A5B1C8;margin-top:2px">' + fsDur(pm.minutes) + '</div></div>' +
      '<div style="text-align:right;font-size:9px;color:#7E8BA6">' + (pm.sessions || 0) + ' sessiya<br>' + (pm.activeDays || 0) + ' faol kun</div>' +
      '</div></div>' +

      '<div style="font-size:10px;letter-spacing:2px;color:#7E8BA6;font-weight:700;margin-bottom:7px">UMUMIY</div>' +
      '<div style="display:flex;gap:6px;margin-bottom:6px">' +
        fsTile('Jami focus', fsDur(tot.minutes), '#00E5A0') +
        fsTile('Sessiyalar', tot.sessions || 0, '#E8F0FE',
          (tot.startedCount && tot.startedCount !== tot.sessions ? tot.startedCount + ' boshlangan' : null)) +
      '</div>' +
      '<div style="display:flex;gap:6px;margin-bottom:12px">' +
        fsTile('Faol kunlar', tot.activeDays || 0, '#E8F0FE') +
        fsTile('Eng uzun', fsDur(tot.longestSessionMinutes), '#7fffcf') +
      '</div>' +

      '<div style="font-size:10px;letter-spacing:2px;color:#7E8BA6;font-weight:700;margin-bottom:7px">OYLAR TARIXI</div>' +
      '<div style="background:#131B2C;border:1px solid #1E2D45;border-radius:10px;overflow:hidden">' + rows + '</div>' +
      '<div style="margin-top:10px;font-size:9px;color:#5f7286;line-height:1.6">' +
      'Vaqt sessiya davomida real o\\'lchanadi. Pauza hisobga olinmaydi, ilova yopilsa ' +
      'o\\'sha paytgacha o\\'tirgan vaqt saqlanadi. 1 daqiqadan qisqa urinishlar qo\\'shilmaydi.' +
      '</div>';

    const bk = document.getElementById('fs-back');
    if (bk) bk.addEventListener('click', renderFocusPanel);
  }).catch(e => {
    focusBody.innerHTML = '<div style="padding:16px;text-align:center;color:#FF7A7A;font-size:12px">Statistika yuklanmadi</div>';
    console.warn('focus-stats', e);
  });
}

function renderFocusPanel() {
  if (!focusBody) return;
  const state = focusUiState || {};
  const canUseFocus = !!state.canUseFocus;
  const activeSession = state.activeSession;
  const usage = state.usage || {};
  if (activeSession && (activeSession.state === 'active' || activeSession.state === 'paused')) {
    const escH = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
    const paused = activeSession.state === 'paused';
    const remainingMs = paused ? (Number(activeSession.remainingMs) || 0) : Math.max(0, Number(activeSession.endsAt || 0) - Date.now());
    const totalSeconds = Math.max(0, Math.ceil(remainingMs / 1000));
    const minutes = String(Math.floor(totalSeconds / 60)).padStart(2, '0');
    const seconds = String(totalSeconds % 60).padStart(2, '0');
    const sp = activeSession.subtaskProgress || { done: 0, total: 0 };
    focusBody.innerHTML = '<div style="display:flex;flex-direction:column;gap:10px">' +
      '<div style="background:rgba(0,229,160,.12);color:#00E5A0;border:1px solid rgba(0,229,160,.24);padding:9px 12px;border-radius:10px;font-weight:700;font-size:12px">🎯 ' + escH(activeSession.goal || 'Focus') + '</div>' +
      (activeSession.task ? '<div style="font-size:12px;color:#A5B1C8;line-height:1.4">' + escH(activeSession.task) + '</div>' : '') +
      '<div style="font-size:30px;font-weight:800;color:#E8F0FE;text-align:center;font-variant-numeric:tabular-nums">' + minutes + ':' + seconds + '</div>' +
      '<div style="color:#7E8BA6;text-align:center;font-size:11px">' + (paused ? 'PAUZA' : 'qoldi') + (sp.total ? ' · bosqich ' + sp.done + '/' + sp.total : '') + '</div>' +
      '<div style="display:flex;gap:8px">' +
      (paused
        ? '<button data-action="resume" style="flex:1;background:rgba(0,229,160,.16);border:1px solid rgba(0,229,160,.3);border-radius:8px;color:#00E5A0;padding:9px 10px;cursor:pointer;font-weight:700">▶ Davom</button>'
        : '<button data-action="pause" style="flex:1;background:#1A2235;border:1px solid #2d3f5e;border-radius:8px;color:#E8F0FE;padding:9px 10px;cursor:pointer;font-weight:700">⏸ Pauza</button>') +
      '<button data-action="stop" style="flex:1;background:rgba(255,71,87,.16);border:1px solid rgba(255,71,87,.3);border-radius:8px;color:#FF4757;padding:9px 10px;cursor:pointer;font-weight:700">✓ Yakunlash</button>' +
      '</div>' +
      '<button id="focus-open-page" style="background:linear-gradient(135deg,#00E5A0,#00C885);color:#04120c;border:none;border-radius:8px;padding:10px 12px;font-weight:800;cursor:pointer">Focus sahifasini ochish</button>' +
      '<button id="focus-stats-btn" style="background:#1A2235;border:1px solid #2d3f5e;border-radius:8px;color:#E8F0FE;padding:9px 10px;cursor:pointer;font-weight:700">📊 Statistika</button>' +
      '</div>';
    const openPageA = document.getElementById('focus-open-page');
    if (openPageA) openPageA.addEventListener('click', () => { ipcRenderer.send('open-focus'); if (focusPanel) focusPanel.style.display = 'none'; syncToolbarExpansion(); });
    const statsBtnA = document.getElementById('focus-stats-btn');
    if (statsBtnA) statsBtnA.addEventListener('click', renderToolbarFocusStats);
    return;
  }

  if (canUseFocus) {
    // Toolbar paneli endi qisqa kirish nuqtasi — haqiqiy sozlash (maqsad/vazifa)
    // to'liq Focus sahifasida (spec: "dedicated page", ON/OFF emas).
    focusBody.innerHTML = '<div style="display:flex;flex-direction:column;gap:12px">' +
      '<div style="background:rgba(0,229,160,.12);color:#00E5A0;border:1px solid rgba(0,229,160,.24);padding:10px 12px;border-radius:10px;font-weight:700">Maqsadli, chalg\\'imasdan ish</div>' +
      '<div style="font-size:12px;color:#A5B1C8;line-height:1.5">Maqsad va vazifangizni belgilab haqiqiy Focus sessiyasini boshlang. Focus brauzingni bloklamaydi — siz erkin izlanasiz.</div>' +
      '<button id="focus-open-page" style="background:linear-gradient(135deg,#00E5A0,#00C885);color:#04120c;border:none;border-radius:8px;padding:11px 12px;font-weight:800;cursor:pointer">🎯 Focusni ochish</button>' +
      '<button id="focus-stats-btn" style="background:#1A2235;border:1px solid #2d3f5e;border-radius:8px;color:#E8F0FE;padding:9px 12px;font-weight:700;cursor:pointer">📊 Statistika</button>' +
      '</div>';
    const openPageB = document.getElementById('focus-open-page');
    if (openPageB) openPageB.addEventListener('click', () => { ipcRenderer.send('open-focus'); if (focusPanel) focusPanel.style.display = 'none'; syncToolbarExpansion(); });
    const statsBtnB = document.getElementById('focus-stats-btn');
    if (statsBtnB) statsBtnB.addEventListener('click', renderToolbarFocusStats);
    return;
  }

  focusBody.innerHTML = '<div style="display:flex;flex-direction:column;gap:10px">' +
    '<div style="background:rgba(255,71,87,.14);color:#FF4757;border:1px solid rgba(255,71,87,.24);padding:10px 12px;border-radius:10px;font-weight:700">Focus Mode is available with Pro</div>' +
    '<div style="font-size:12px;color:#A5B1C8">Unlock unlimited AI analysis, unlimited video analysis, and Focus Mode for only 7,999 UZS/month.</div>' +
    '<button id="focus-upgrade-btn" style="background:linear-gradient(135deg,#FFD98A,#F5A623);color:#2a1a00;border:none;border-radius:8px;padding:10px 12px;font-weight:800;cursor:pointer">👑 Premium olish</button>' +
    '</div>';
  const upgradeButton = document.getElementById('focus-upgrade-btn');
  if (upgradeButton) {
    // Bepul Pro bypass OLIB TASHLANDI — Premium sahifasini ochadi (to'lov orqali).
    upgradeButton.addEventListener('click', () => {
      ipcRenderer.send('open-premium');
      if (focusPanel) focusPanel.style.display = 'none';
      syncToolbarExpansion();
    });
  }
}

async function refreshFocusState() {
  try {
    const [subscription, usage, focus] = await Promise.all([
      ipcRenderer.invoke('subscription-get'),
      ipcRenderer.invoke('usage-get'),
      ipcRenderer.invoke('focus-get')
    ]);
    focusUiState = { canUseFocus: !!focus?.canUseFocus, activeSession: focus?.activeSession || null, usage: usage?.usage || usage, subscription };
    renderFocusPanel();
  } catch (e) {
    console.error('refreshFocusState', e);
  }
}

function createNotificationItem(note) {
  const icon = note.meta?.icon || '🔔';
  const category = note.type || note.meta?.category || 'General';
  const createdAt = note.createdAt ? new Date(note.createdAt) : new Date();
  const timeLabel = isNaN(createdAt.getTime()) ? '' : createdAt.toLocaleString();
  const item = document.createElement('div');
  item.className = 'notif-item' + (note.read ? ' read' : ' unread');
  item.style.cssText = 'padding:12px 14px;border-bottom:1px solid rgba(255,255,255,.04);cursor:pointer;display:flex;gap:10px;align-items:flex-start;';
  item.innerHTML = \`
    <div style="flex-shrink:0;width:36px;height:36px;border-radius:12px;background:rgba(255,255,255,.06);display:flex;align-items:center;justify-content:center;font-size:18px;line-height:1">\${icon}</div>
    <div style="flex:1;min-width:0">
      <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap">
        <div style="font-size:13px;font-weight:700;color:#E8F0FE;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">\${note.title || 'Bildirishnoma'}</div>
        <div style="font-size:10px;color:\${note.read ? '#7E8BA6' : '#FF4757'};white-space:nowrap">\${timeLabel}</div>
      </div>
      <div style="font-size:11px;color:#A5B1C8;margin-top:6px;line-height:1.4;overflow:hidden;text-overflow:ellipsis;max-height:3.2em">\${note.body || ''}</div>
      <div style="margin-top:8px;font-size:10px;color:#6B7B94;text-transform:uppercase;letter-spacing:.5px">\${category}</div>
    </div>
  \`;
  item.style.borderLeft = note.read ? '3px solid transparent' : '3px solid #FF4757';
  item.addEventListener('click', async () => {
    if (!note.read) {
      await ipcRenderer.invoke('notifications-ack', [note.id]);
    }
    if (note.meta?.url) {
      ipcRenderer.send('navigate', note.meta.url);
      if (notifPanel) notifPanel.style.display = 'none';
    }
  });
  return item;
}

async function refreshNotifications() {
  if (!notifList || !notifEmpty || !notifLoading || !notifError) return;
  notifError.style.display = 'none';
  notifEmpty.style.display = 'none';
  notifLoading.style.display = 'block';
  notifList.innerHTML = '';

  try {
    const items = await ipcRenderer.invoke('notifications-get');
    notifLoading.style.display = 'none';

    const unread = items.filter(x => !x.read).length;
    if (notifCount) {
      if (unread > 0) {
        notifCount.textContent = unread > 9 ? '9+' : String(unread);
        notifCount.style.display = 'flex';
      } else {
        notifCount.style.display = 'none';
      }
    }
    if (notifBtn) notifBtn.classList.toggle('has-unread', unread > 0);

    if (items.length === 0) {
      notifEmpty.style.display = 'block';
      return;
    }

    notifEmpty.style.display = 'none';
    notifList.innerHTML = '';
    items.forEach(note => notifList.appendChild(createNotificationItem(note)));
  } catch (e) {
    console.error('refreshNotifications:', e);
    notifLoading.style.display = 'none';
    notifError.style.display = 'block';
    const message = notifError.querySelector('.notif-error-message');
    if (message) message.textContent = 'Unable to load notifications. Please try again.';
  }
}

async function acknowledgeAllNotifications() {
  try {
    const items = await ipcRenderer.invoke('notifications-get');
    const unreadIds = items.filter(x => !x.read).map(x => x.id);
    if (unreadIds.length === 0) return;
    await ipcRenderer.invoke('notifications-ack', unreadIds);
  } catch (e) {
    console.error('acknowledgeAllNotifications:', e);
  }
}

async function toggleNotificationPanel() {
  if (!notifPanel) {
    console.warn('notifPanel not found');
    return;
  }
  const visible = notifPanel.style.display === 'block';
  notifPanel.style.display = visible ? 'none' : 'block';
  syncToolbarExpansion();
  if (!visible) {
    notifPanel.style.display = 'block';
    syncToolbarExpansion();
    await refreshNotifications();
  }
}

async function onNotificationUpdate() {
  await refreshNotifications();
}

// Refresh notification badge on every startup and when the toolbar is ready.
(async function initNotificationBadge() {
  await refreshNotifications();
  await refreshFocusState();
})();

async function refreshExtList() {
  try {
    const list = await ipcRenderer.invoke('chrome-ext-list');
    if (extCount) {
      if (list.length > 0) {
        extCount.textContent = list.length;
        extCount.style.display = 'flex';
      } else {
        extCount.style.display = 'none';
      }
    }
    if (list.length === 0) {
      extList.innerHTML = '';
      extEmpty.style.display = 'block';
      return;
    }
    extEmpty.style.display = 'none';
    extList.innerHTML = list.map(x => {
      const iconHTML = x.icon
        ? '<img src="file://' + x.icon.replace(/\\\\/g,'/') + '" style="width:32px;height:32px;border-radius:6px;object-fit:cover"/>'
        : '<div style="width:32px;height:32px;border-radius:6px;background:#243044;display:flex;align-items:center;justify-content:center;font-size:16px">🧩</div>';
      const badge = x.enabled
        ? '<span style="background:rgba(0,229,160,.14);color:#00E5A0;font-size:9px;padding:2px 6px;border-radius:4px;font-weight:600">FAOL</span>'
        : '<span style="background:rgba(255,71,87,.14);color:#FF4757;font-size:9px;padding:2px 6px;border-radius:4px;font-weight:600">O\\'CHIQ</span>';
      return '<div style="display:flex;align-items:center;gap:10px;padding:10px 14px;border-bottom:1px solid rgba(255,255,255,.04);hover:background:rgba(255,255,255,.03)">'
        + iconHTML
        + '<div style="flex:1;min-width:0">'
        +   '<div style="font-size:12px;font-weight:600;color:#E8F0FE;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' + (x.name || 'Nomsiz') + ' ' + badge + '</div>'
        +   '<div style="font-size:10px;color:#4a5568;margin-top:2px">v' + (x.version || '?') + ' • MV' + (x.manifest_version || 2) + '</div>'
        + '</div>'
        + '<div style="display:flex;gap:4px;flex-shrink:0">'
        +   (x.hasPopup ? '<button data-act="popup" data-id="' + x.id + '" title="Popup" style="background:#1A2235;border:1px solid #2d3f5e;border-radius:6px;color:#E8F0FE;width:28px;height:28px;cursor:pointer;font-size:11px">▤</button>' : '')
        +   '<button data-act="toggle" data-id="' + x.id + '" data-enabled="' + (x.enabled ? '1' : '0') + '" title="' + (x.enabled ? 'O\\'chirish' : 'Yoqish') + '" style="background:' + (x.enabled ? 'rgba(0,229,160,.15)' : 'rgba(255,71,87,.15)') + ';border:1px solid ' + (x.enabled ? 'rgba(0,229,160,.3)' : 'rgba(255,71,87,.3)') + ';border-radius:6px;color:' + (x.enabled ? '#00E5A0' : '#FF4757') + ';width:28px;height:28px;cursor:pointer;font-size:12px">' + (x.enabled ? '⏻' : '○') + '</button>'
        +   '<button data-act="remove" data-id="' + x.id + '" title="O\\'chirish" style="background:#1A2235;border:1px solid #2d3f5e;border-radius:6px;color:#FF4757;width:28px;height:28px;cursor:pointer;font-size:12px">✕</button>'
        + '</div>'
      + '</div>';
    }).join('');
  } catch (e) { console.error('extList:', e); }
}

// TOOLBAR DROPDOWN — panel ochilganda toolbar view'ni kengaytirish + backdrop.
//   Aks holda content BrowserView dropdown'ni yopadi (notification ko'rinmasdi).
function syncToolbarExpansion() {
  const anyOpen = ['notif-panel', 'ext-panel', 'focus-panel'].some(id => {
    const el = document.getElementById(id); return el && el.style.display === 'block';
  });
  const backdrop = document.getElementById('tb-backdrop');
  if (backdrop) backdrop.style.display = anyOpen ? 'block' : 'none';
  ipcRenderer.send('toolbar-expand', anyOpen);
}
(function initBackdrop() {
  const backdrop = document.getElementById('tb-backdrop');
  if (backdrop) backdrop.addEventListener('click', () => {
    ['notif-panel', 'ext-panel', 'focus-panel'].forEach(id => { const el = document.getElementById(id); if (el) el.style.display = 'none'; });
    syncToolbarExpansion();
  });
})();

extBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  const visible = extPanel.style.display === 'block';
  extPanel.style.display = visible ? 'none' : 'block';
  if (!visible) refreshExtList();
  syncToolbarExpansion();
});

// PREMIUM — Pro tugmasi Premium sahifasini ochadi + holatni ko'rsatadi
const proBtn = document.getElementById('pro-btn');
const proLabel = document.getElementById('pro-label');
if (proBtn) {
  proBtn.addEventListener('click', (e) => { e.stopPropagation(); ipcRenderer.send('open-premium'); });
}
function applyPremiumStatus(st) {
  if (!proBtn) return;
  if (st && st.isPro) { proBtn.classList.add('is-pro'); if (proLabel) proLabel.textContent = 'Pro'; proBtn.title = 'Pro faol' + (st.daysRemaining != null ? (' - ' + st.daysRemaining + ' kun') : ''); }
  else { proBtn.classList.remove('is-pro'); if (proLabel) proLabel.textContent = 'Pro'; proBtn.title = 'Premium olish'; }
}
ipcRenderer.on('premium-status-changed', (_, st) => applyPremiumStatus(st));
ipcRenderer.invoke('premium-get-status').then(applyPremiumStatus).catch(() => {});

focusBtn.addEventListener('click', async (e) => {
  e.stopPropagation();
  const visible = focusPanel.style.display === 'block';
  focusPanel.style.display = visible ? 'none' : 'block';
  if (!visible) {
    await refreshFocusState();
  }
  syncToolbarExpansion();
});

focusBody.addEventListener('click', async (e) => {
  const action = e.target && e.target.dataset && e.target.dataset.action;
  if (!action) return;
  if (action === 'pause') {
    await ipcRenderer.invoke('focus-pause');
    await refreshFocusState();
  } else if (action === 'resume') {
    await ipcRenderer.invoke('focus-resume');
    await refreshFocusState();
  } else if (action === 'stop') {
    await ipcRenderer.invoke('focus-stop');
    await refreshFocusState();
  }
});

window.addEventListener('DOMContentLoaded', () => {
  document.addEventListener('click', (e) => {
    if (extPanel && extBtn && !extPanel.contains(e.target) && !extBtn.contains(e.target)) {
      extPanel.style.display = 'none';
    }
    if (notifPanel && notifBtn && !notifPanel.contains(e.target) && !notifBtn.contains(e.target)) {
      notifPanel.style.display = 'none';
    }
    if (focusPanel && focusBtn && !focusPanel.contains(e.target) && !focusBtn.contains(e.target)) {
      focusPanel.style.display = 'none';
    }
    syncToolbarExpansion();
  });

  if (notifClear) {
    notifClear.addEventListener('click', async () => {
      await acknowledgeAllNotifications();
      await refreshNotifications();
    });
  }

  if (notifRetry) {
    notifRetry.addEventListener('click', async () => {
      await refreshNotifications();
    });
  }
});

notifBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  toggleNotificationPanel();
});

ipcRenderer.on('notifications-updated', async () => {
  await onNotificationUpdate();
});

extAdd.addEventListener('click', async () => {
  const r = await ipcRenderer.invoke('chrome-ext-install-unpacked');
  if (r && r.ok) refreshExtList();
  else if (r && !r.canceled && r.error) alert('Xato: ' + r.error);
});

extStore.addEventListener('click', () => ipcRenderer.invoke('chrome-ext-open-store'));

extList.addEventListener('click', async (e) => {
  const btn = e.target.closest('button[data-act]');
  if (!btn) return;
  const act = btn.dataset.act;
  const id = btn.dataset.id;
  if (act === 'toggle') {
    const nowEnabled = btn.dataset.enabled !== '1';
    await ipcRenderer.invoke('chrome-ext-toggle', { id, enabled: nowEnabled });
    refreshExtList();
  } else if (act === 'remove') {
    if (!confirm('O\\'chirilsinmi?')) return;
    await ipcRenderer.invoke('chrome-ext-uninstall', id);
    refreshExtList();
  } else if (act === 'popup') {
    const rect = extBtn.getBoundingClientRect();
    await ipcRenderer.invoke('chrome-ext-open-popup', {
      id,
      anchor: { x: Math.round(rect.left - 340), y: Math.round(rect.bottom + 8) }
    });
    extPanel.style.display = 'none';
  }
});

// Startup — badge yangilash
refreshExtList();
refreshNotifications();

<\/script>
</body></html>`;
}

// ── WINDOW MANAGER ──
const wins = new Map();

function createWin(startUrl, anchorBounds) {
  const main = new BrowserWindow({
    width:1400, height:900, minWidth:800, minHeight:600,
    title:'Niex', backgroundColor:'#0F1623',
    // Oyna va vazifalar paneli ikonasi — NIEX logosi (assets/icon.ico).
    // Berilmasa Electron o'zining standart logosini ko'rsatadi.
    icon: NIEX_ICON,
    x: anchorBounds ? (anchorBounds.x + anchorBounds.width + 12) : undefined,
    y: anchorBounds ? anchorBounds.y : undefined,
    webPreferences:{ nodeIntegration:false }
  });
  // Taskbar/oyna ikonasini RUNTIME'da ham MAJBURAN o'rnatamiz — ba'zan constructor'dagi
  //   `icon` Windows taskbar'ga yetmaydi (ayniqsa asar ichidan bo'lsa). nativeImage +
  //   setIcon eng ishonchli yo'l: taskbar'da NIEX logosi (Electron default emas).
  try {
    if (NIEX_ICON) {
      const { nativeImage } = require('electron');
      const _img = nativeImage.createFromPath(NIEX_ICON);
      if (_img && !_img.isEmpty()) main.setIcon(_img);
    }
  } catch (_) {}

  const tbv = new BrowserView({
    webPreferences:{ nodeIntegration:false, contextIsolation:true, preload: path.join(__dirname, 'preload.js') }
  });
  main.addBrowserView(tbv);

  const tabs = [];
  let activeTabId = null;
  let tabCounter = 0;
  const TH = 90;

  const layout = () => {
    const { width, height } = main.getContentBounds();
    tbv.setBounds({ x:0, y:0, width, height:TH });
    const activeTab = getActiveTab();
    if (activeTab) {
      activeTab.view.setBounds({ x:0, y:TH, width, height:height-TH });
    }
  };
  layout();
  main.on('resize', layout);
  // Fullscreen o'zgarishida BrowserView bounds'lari qayta hisoblansin,
  // aks holda ekran chegarasi va view chegarasi mos kelmaydi (o'ng/pastda bo'shliq qoladi).
  main.on('enter-full-screen', () => setTimeout(layout, 50));
  main.on('leave-full-screen', () => setTimeout(layout, 50));
  main.on('maximize', () => setTimeout(layout, 50));
  main.on('unmaximize', () => setTimeout(layout, 50));

  tbv.webContents.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(toolbarHTML()));

  function makeTabId() {
    return `tab_${Date.now().toString(36)}_${++tabCounter}`;
  }

  function getActiveTab() {
    return tabs.find(t => t.id === activeTabId);
  }

  function getTabById(id) {
    return tabs.find(t => t.id === id);
  }

  function sendTabs() {
    tbv.webContents.send('tabs-update', {
      tabs: tabs.map(t => ({ id: t.id, title: t.title || 'Yangi', isHome: t.isHome })),
      activeId: activeTabId
    });
  }

  function shortenTitle(text) {
    if (!text) return 'Niex';
    const trimmed = String(text).trim();
    if (trimmed.length <= 40) return trimmed;
    return trimmed.slice(0, 40).replace(/\s+$/,'') + '…';
  }

  function sendUrlChanged(tab, blocked = false) {
    if (!tab) return;
    const cur = tab.view.webContents.getURL();
    const ih = tab.isHome && (cur.startsWith('file://') || cur.startsWith('data:'));
    tbv.webContents.send('url-changed', {
      url: ih ? '' : cur,
      isHome: ih,
      canGoBack: tab.view.webContents.navigationHistory.canGoBack(),
      canGoForward: tab.view.webContents.navigationHistory.canGoForward(),
      blocked: blocked || tab.blocked
    });
  }

  function showTab(tab) {
    if (!tab) return;

    // DESTROYED VIEW HIMOYASI — Electron crash oldini oladi
    // Sabab: tab.view yoki uning webContents avval destroy qilingan bo'lishi mumkin
    // (masalan Personal Information tabini yopib qayta ochishga urinish)
    const isViewDead = !tab.view
      || (tab.view.webContents && tab.view.webContents.isDestroyed())
      || (typeof tab.view.isDestroyed === 'function' && tab.view.isDestroyed());

    if (isViewDead) {
      L('WARN', 'showTab: destroyed view — tab tozalanmoqda', tab.id);
      // Tabs massivdan olib tashlaymiz va uy sahifasiga qaytamiz
      const idx = tabs.indexOf(tab);
      if (idx >= 0) tabs.splice(idx, 1);
      // Boshqa tab qolgan bo'lsa unga o'tamiz, aks holda yangi tab
      const next = tabs[idx] || tabs[idx - 1] || tabs[0];
      if (next) return showTab(next);
      const nt = createTab('');
      return; // createTab o'zi showTab chaqiradi
    }

    const prev = getActiveTab();
    if (prev && prev.view !== tab.view) {
      // Prev view ham destroyed bo'lishi mumkin
      try {
        if (main.getBrowserViews().includes(prev.view)) main.removeBrowserView(prev.view);
      } catch(e) { L('WARN', 'removeBrowserView prev:', e.message); }
    }
    try {
      if (!main.getBrowserViews().includes(tab.view)) {
        main.addBrowserView(tab.view);
      }
      const { width, height } = main.getContentBounds();
      tab.view.setBounds({ x:0, y:TH, width, height:height-TH });
      tab.view.setAutoResize({ width:true, height:true });
      activeTabId = tab.id;
      main.setTitle(shortenTitle(tab.title || 'Niex') + ' — Niex');
      sendTabs();
      sendUrlChanged(tab);
    } catch(e) {
      L('ERR', 'showTab xato — tab tozalanmoqda', e.message);
      // Fallback: tab'ni yopamiz va yangi ochamiz
      const idx = tabs.indexOf(tab);
      if (idx >= 0) tabs.splice(idx, 1);
      if (tabs.length) showTab(tabs[0]);
      else createTab('');
    }
  }

  function loadHome(tab) {
    tab.isHome = true;
    tab.blocked = false;
    tab.title = 'Niex';
    // Tema router: localStorage'дан tanlangan temani o'qib (classic/garage)
    // kerakli sahifaga yo'naltiradi. Default = classic (yengil).
    const router = path.join(__dirname, 'home.html');
    const staticHome = path.join(__dirname, 'safenethome.html');
    try {
      tab.view.webContents.loadFile(router);
    } catch (e) {
      try { tab.view.webContents.loadFile(staticHome); }
      catch (e2) {
        const homePath = path.join(__dirname, 'safenet_home.html');
        require('fs').writeFileSync(homePath, homeHTML(), 'utf8');
        tab.view.webContents.loadFile(homePath);
      }
    }
    sendUrlChanged(tab);
  }

  function loadUrl(tab, url) {
    tab.isHome = false;
    tab.blocked = false;
    tab.url = url;
    tab.title = url;
    tab.view.webContents.loadURL(url);
    sendUrlChanged(tab);
  }

  function attachTabEvents(tab) {
    const view = tab.view;
    const sendActiveChange = () => {
      if (getActiveTab() === tab) {
        sendUrlChanged(tab);
      }
    };

    // REDIRECT PROTECTION — foydalanuvchi harakatini (gesture) kuzatamiz.
    // "avtomatik vs foydalanuvchi" farqi: navigatsiya oldida yaqinda klik/tugma
    // bo'lgan bo'lsa — foydalanuvchi tashabbusi (yumshoq siyosat); aks holda
    // avtomatik (skript/redirect — qat'iy siyosat). Bu redirect blokning yuragi.
    tab.lastGestureAt = 0;
    tab.redirectChain = [];
    try {
      view.webContents.on('input-event', (_e, input) => {
        const t = input && input.type;
        if (t === 'mouseDown' || t === 'keyDown' || t === 'rawKeyDown') tab.lastGestureAt = Date.now();
      });
    } catch (_) {}

    // will-redirect — HTTP 3xx redirect zanjiri (A→B→C→qimor). Har doim AVTOMATIK.
    view.webContents.on('will-redirect', (event, url) => {
      try {
        if (/^(data:|about:|devtools:|file:|blob:)/i.test(url)) return;
        tab.redirectChain = (tab.redirectChain || []).concat([url]).slice(-8);
        if (navGuardBlock(view, tab, url, 'redirect', event)) return;
        if (domainBlocked(url)) {
          event.preventDefault(); ST.block++; tab.blocked = true;
          L('🚫', 'REDIRECT DNS BLOK', url.slice(0, 80));
          view.webContents.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(blockPage(url, 'Bloklangan domen')));
          broadcastStats();
        }
      } catch (e) {}
    });

    // POPUP INTERCEPT
    // Onboarding/parental-control sahifalari faqat NIEX home ichida MODAL IFRAME
    // orqali ochiladi. OAuth popup'lar REAL oyna sifatida ochiladi (window.opener
    // saqlanishi shart). Qolgan web URL'lar yangi tab bo'lib ochiladi.
    view.webContents.setWindowOpenHandler(({ url, disposition, features, frameName }) => {
      // 0. TIZIM brauzeriga eskort — window.open(url,'_niex_chrome') → shell.openExternal.
      //    Google "signin/rejected" banneri shuni ishlatadi (Chrome ochiladi, blokdan qochish).
      if (frameName === '_niex_chrome' && /^https?:\/\//i.test(url || '')) {
        L('🌐', 'Chrome escort:', String(url).slice(0, 80));
        try { shell.openExternal(url); } catch (_) {}
        return { action: 'deny' };
      }
      // 1. Local file:// — hech qanday oyna/tab ochilmasin.
      if (url && (
        url.startsWith('file://') ||
        url.includes('/onboarding/') ||
        url.includes('/parental-control/') ||
        url.includes('/settings/')
      )) {
        L('🚫','local popup denied — modal iframe kutilmoqda', url.slice(0, 80));
        return { action: 'deny' };
      }

      // 2. OAuth popup — REAL oyna, parent bilan bir xil session (cookies share),
      //    window.opener saqlanadi, postMessage callback ishlaydi.
      if (isOAuthPopupUrl(url)) {
        L('🔐','OAuth popup allow', url.slice(0, 80));
        return {
          action: 'allow',
          overrideBrowserWindowOptions: {
            parent: main,
            modal: false,
            width: 520,
            height: 680,
            minWidth: 400,
            minHeight: 500,
            autoHideMenuBar: true,
            title: 'Kirish',
            webPreferences: {
              nodeIntegration: false,
              contextIsolation: true,   // xavfsizlik: barcha kontekstда yoqilган (toza posture)
              webSecurity: true,
              allowRunningInsecureContent: false,
              session: view.webContents.session,
            }
          }
        };
      }

      // 3. Boshqa web URL'lar — yangi tab (opener bog'liqligi shart bo'lmagan URL'lar)
      try {
        if (url && url !== 'about:blank' && !url.startsWith('devtools:')) {
          // REDIRECT PROTECTION — popup/yangi-tab manzili ham xavfsizlik qaroridan o'tadi (Req C).
          // Yaqinda gesture bo'lsa foydalanuvchi yangi tab ochdi (yumshoq); aks holda
          // avtomatik popup (qat'iy) — qimor/phishing/zararli/shubhали bloklaydi (Pro).
          const gesture = (Date.now() - (tab.lastGestureAt || 0) < 1500);
          const d = _redirectProtectionOn() ? NavGuard.decide({ url, source: gesture ? 'newtab' : 'popup' }) : { block: false };
          if (d.block) {
            ST.block++;
            L('🛡️', 'POPUP BLOK', `[${d.category}] ` + url.slice(0, 80));
            try { if (activityStore) activityStore.recordBlocked(); } catch (_) {}
            navGuardParentAlert(d, url);
            broadcastStats();
            return { action: 'deny' };
          }
          L('🪟','popup → new tab', url.slice(0, 80));
          setTimeout(() => { try { createTab(url); } catch(e) { L('WARN','popup tab:', e.message); } }, 0);
        }
      } catch(e) { L('WARN','windowOpen:', e.message); }
      return { action: 'deny' };
    });

    // did-create-window: OAuth popup uchun ochiq qoldiramiz, unga
    // block/nav-monitor listenerlarni ulaymiz. Boshqa yaratilgan oynalar bo'lsa yopiladi.
    view.webContents.on('did-create-window', (childWin, details) => {
      try {
        const childUrl = (details && details.url) || (childWin.webContents && childWin.webContents.getURL()) || '';
        if (!isOAuthPopupUrl(childUrl)) {
          try { childWin.close(); } catch {}
          return;
        }

        const childWC = childWin.webContents;
        // OAuth popup'ga ham "Google Chrome" identiteti (Google blokidan qochish).
        applyChromeIdentity(childWC);

        // Focus/parent-control OAuth popup ichida ham ishlashi uchun
        childWC.on('will-navigate', (event, navUrl) => {
          try {
            const focusBlock = ensureFocusProtection(navUrl, tab, event);
            if (focusBlock && focusBlock.blocked) return;
            if (domainBlocked(navUrl)) {
              event.preventDefault();
              L('🚫','OAuth popup DNS BLOK', navUrl);
              try { childWin.close(); } catch {}
            }
          } catch(e) { L('WARN','oauth popup nav:', e.message); }
        });

        // OAuth callback → parent tab'ga qaytdi degani, popup avtomatik yopilishi mumkin
        childWC.on('did-navigate', (_e, navUrl) => {
          L('🔐','OAuth popup nav', navUrl.slice(0, 80));
        });
      } catch(e) { L('WARN','did-create-window:', e.message); }
    });

    view.webContents.on('will-navigate', async (event, url) => {
      if (url.startsWith('data:') || url.startsWith('about:') || url.startsWith('devtools:') || url.startsWith('file:')) return;
      L('🌐','NAV', url.slice(0,80));
      tab.isHome = false;
      ST.total++;
      sendActiveChange();
      // Yangi top-level navigatsiya — redirect zanjirini shu manzildan boshlaymiz.
      tab.redirectChain = [url];

      const focusBlock = ensureFocusProtection(url, tab, event);
      if (focusBlock && focusBlock.blocked) {
        ST.block++;
        broadcastStats();
        return;
      }

      if (domainBlocked(url)) {
        event.preventDefault();
        ST.block++;
        tab.blocked = true;
        L('🚫','DNS BLOK', url);
        view.webContents.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(blockPage(url,'Bloklangan domen')));
        broadcastStats();
        return;
      }

      const urlLower = url.toLowerCase();
      const HARMFUL_URL_WORDS = [
        'nipple','breast','orgasm','orgasmic','penis','vagina','anal','pussy',
        'porn','xxx','nude','naked','sex-','erotic','hentai','nsfw',
        'masturbat','cumshot','blowjob','handjob','threesome','gangbang',
      ];
      if (HARMFUL_URL_WORDS.some(w => urlLower.includes(w))) {
        event.preventDefault();
        ST.block++;
        tab.blocked = true;
        L('⛔','URL KEYWORD BLOK', url.slice(0,80));
        view.webContents.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(blockPage(url,'Zararli URL kontent')));
        broadcastStats();
        return;
      }

      // REDIRECT PROTECTION — nav-guard (qimor/phishing/zararli/shubhali).
      // Manba: yaqinda gesture bo'lsa foydalanuvchi (yumshoq), aks holda skript (qat'iy).
      // Foydalanuvchi O'ZI kirgan saytni bloklamaydi; avto skript-redirectni to'xtatadi.
      {
        const gesture = (Date.now() - (tab.lastGestureAt || 0) < 1500);
        if (navGuardBlock(view, tab, url, gesture ? 'link' : 'js', event)) return;
      }

      // Content-platform (YouTube/Instagram...) — sahifa-darajali URL block YO'Q.
      //   monitor.js har elementni alohida bloklaydi, xavfsiz kontent ko'rinadi.
      if (!isContentPlatform(url)) {
        aiText(url).then(r => {
          if (r.should_block) {
            ST.block++;
            tab.blocked = true;
            L('⛔','AI URL BLOK', r.block_reason);
            view.webContents.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(blockPage(url, r.block_reason)));
            if (getActiveTab() === tab) {
              tbv.webContents.send('url-changed', { url, blocked:true, isHome:false, canGoBack:false, canGoForward:false });
            }
          } else {
            ST.allow++;
          }
          broadcastStats();
        }).catch(e => { ST.err++; L('⚠️','AI URL err:', e.message); });
      }
    });

    view.webContents.on('did-start-loading', () => {
      if (getActiveTab() === tab) tbv.webContents.send('loading', true);
    });

    view.webContents.on('did-stop-loading', () => {
      if (getActiveTab() === tab) {
        tbv.webContents.send('loading', false);
        sendUrlChanged(tab);
      }
    });

    view.webContents.on('did-finish-load', async () => {
      const cur = view.webContents.getURL();
      // Voice Agent mic UI — HAR BIR tabga (aktivligидан qat'iy nazar). Aktiv-check OLIB
      //   TASHLANDI — u sabab yangi/qayta ochilган tabда voice ko'rinmasди. Mic getUserMedia
      //   faqat xavfsiz origin'da: file:// (NIEX ichki) va https:// (web); data:-origin RAD.
      if (VOICE_UI_JS && (cur.startsWith('file://') || cur.startsWith('https://'))) {
        try {
          await view.webContents.executeJavaScript(VOICE_UI_JS);
        } catch (e) { if (process.env.NIEX_VOICE_DEBUG === '1') L('🎧', 'VOICE inject XATO:', e.message); }
      }
      // Qolgan pastdagi logika FAQAT aktiv tab uchun (tab title/URL yangilash va h.k.).
      if (getActiveTab() !== tab) return;
      if (cur.startsWith('data:') || (tab.isHome && cur.startsWith('file://'))) return;

      try {
        const currentTitle = view.webContents.getTitle() || cur;
        addHistoryEntry(cur, currentTitle);
      } catch (e) { L('WARN','history add fail:', e.message); }

      if (CFG.ab) {
        try { await view.webContents.executeJavaScript(AD_SCRIPT); } catch {}
      }
      // contentfilter.js O'CHIRILGAN — monitor.js (AI Brain) yagona bloklash tizimi.
      // Sabab: ikkita alohida AI tizimi (bulut + lokal) bir-biriga zid qaror qilardi:
      //   - contentfilter.js bulut API BMW mashinalarni bloklardi (overblocking)
      //   - YouTube'da bulut API "safe" der, monitor.js bloklasa ham counter ko'rinmas edi
      // Endi faqat monitor.js ishlaydi — bitta AI, bitta threshold, bitta qaror.
      if (MONITOR_JS) {
        try {
          // KB — encrypted knowledge base (5 MB)
          if (KB_ENC_BASE64) {
            await view.webContents.executeJavaScript(`window.__CIA_KB_ENC_B64="${KB_ENC_BASE64}";`);
          }
          // NSFW model vaznlari — AVVAL inject (window.model, window.group1_shard1of1)
          // nsfwjs.load() shu globallarni tekshiradi va ulardan model yuklaydi.
          if (NSFWJS_MODEL_CODE) {
            try { await view.webContents.executeJavaScript(NSFWJS_MODEL_CODE); } catch(e) { L('WARN','model inject:', e.message); }
          }
          if (NSFWJS_WEIGHTS_CODE) {
            try { await view.webContents.executeJavaScript(NSFWJS_WEIGHTS_CODE); } catch(e) { L('WARN','weights inject:', e.message); }
          }
          // nsfwjs.min.js — ICHIDA o'z tf.js si bor, alohida tf.min.js kerak EMAS.
          if (NSFWJS_CODE) {
            try { await view.webContents.executeJavaScript(NSFWJS_CODE); } catch(e) { L('WARN','nsfwjs inject:', e.message); }
          }
          await view.webContents.executeJavaScript(MONITOR_JS);
          // Parent Control block reporter (child role uchun)
          if (BLOCK_REPORTER_JS) {
            try { await view.webContents.executeJavaScript(BLOCK_REPORTER_JS); }
            catch(e) { L('WARN','block-reporter inject:', e.message); }
          }
          // PAROL AVTOTO'LDIRISH — saqlangan parolni qo'yadi va login
          // qilinganda saqlashni taklif qiladi (Chrome'dagi kabi).
          if (AUTOFILL_JS) {
            try { await view.webContents.executeJavaScript(AUTOFILL_JS); }
            catch(e) { L('WARN','autofill inject:', e.message); }
          }
          // YOUTUBE BOOSTER — monitor.js dan qo'shimcha qatlam:
          //   playlist/related videolar + Shorts frame scan + cloud AI fallback.
          //   Faqat YouTube sahifalariga inject qilinadi.
          if (YT_BOOST_JS && /(^|\.)youtube\.com/i.test(new URL(cur).hostname || '')) {
            try { await view.webContents.executeJavaScript(YT_BOOST_JS); L('BOOST','YouTube scanner faol'); }
            catch(e) { L('WARN','yt-boost inject:', e.message); }
          }
          // Focus scroll-detection — har sahifaga (feed bo'lmasa no-op, hisobot yubormaydi).
          if (SCROLL_INJECT_JS) {
            try { await view.webContents.executeJavaScript(SCROLL_INJECT_JS); } catch (e) {}
          }
          // Redirect Protection — list-free phishing skaner (credential/karta formasi bo'lsa hisobot).
          if (PHISHING_SCAN_JS) {
            try { await view.webContents.executeJavaScript(PHISHING_SCAN_JS); } catch (e) {}
          }
          // AI pipeline diagnostikasi — renderer console → main process
          view.webContents.on('console-message', (_ev, _lv, msg) => {
            if (msg.startsWith('[NSFW]') || msg.startsWith('[CIA]')) L('AI-DIAG', msg);
          });
          // 5 soniyadan keyin model holatini tekshirish
          setTimeout(async () => {
            try {
              const diag = await view.webContents.executeJavaScript(`JSON.stringify({
                nsfwjs: typeof window.nsfwjs,
                model: window.__CIA__?.modelReady?.() ?? 'no-CIA',
                blocked: window.__CIA__?.blocked?.() ?? 0,
                version: window.__CIA__?.version ?? '?',
              })`);
              L('AI-STATUS', diag, cur.slice(0,60));
            } catch {}
          }, 5000);
          L('MONITOR','inject OK', cur.slice(0,60));
        } catch(e) { L('WARN','Monitor inject:', e.message); }
      }
      // Inject enabled extensions using ExtensionManager
      if (extensionManager) {
        try {
          await extensionManager.injectContentScripts(view.webContents, cur, { timing: 'idle' });
          L('EXT','inject OK', cur.slice(0,60));
        } catch(e) { L('WARN','ext inject:', e.message); }
      }
      try {
        const pageInfo = await view.webContents.executeJavaScript(`({
          title: document.title || '',
          h1: document.querySelector('h1')?.textContent || '',
          url: window.location.href
        })`);
        const HARMFUL_TITLE = [
          'nipple','breast','orgasm','orgasmic','penis','vagina','anal ','pussy',
          'porn','xxx','nude','naked','erotic','hentai','nsfw','masturbat',
          'cumshot','blowjob','sex tutorial','sex video','strip','undress',
          'behayo','yalang',
        ];
        const titleCheck = (pageInfo.title + ' ' + pageInfo.h1).toLowerCase();
        if (HARMFUL_TITLE.some(w => titleCheck.includes(w))) {
          ST.block++;
          L('⛔','TITLE BLOK', pageInfo.title.slice(0,60));
          view.webContents.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(blockPage(cur,'Zararli kontent: ' + pageInfo.title.slice(0,60))));
          broadcastStats();
          return;
        }
      } catch(e) { L('⚠️','Title check:', e.message); }
      // Sahifa MATNI (body innerText) tahlili — FAQAT oddiy saytlarda.
      //   Content-platform'da o'chirilgan: aralash sarlavhalar (ba'zi behayo video nomi)
      //   butun sahifani noto'g'ri bloklardi. U yerda monitor.js har elementni alohida bloklaydi.
      if (CFG.ai && !isContentPlatform(cur)) {
        try {
          const pg = await view.webContents.executeJavaScript(`({ text: (document.body?.innerText||'').slice(0,5000) })`);
          if (pg.text.length > 50) {
            const tr = await aiText(pg.text);
            if (tr.should_block) {
              ST.block++;
              L('⛔','MATN BLOK', tr.block_reason);
              view.webContents.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(blockPage(cur, tr.block_reason)));
              broadcastStats();
              return;
            }
            L('✅','Matn OK');
          }
        } catch(e) { L('⚠️','Matn skan:', e.message); }
      }

      const focusBlockAfterLoad = ensureFocusProtection(cur, tab);
      if (focusBlockAfterLoad && focusBlockAfterLoad.blocked) {
        ST.block++;
        broadcastStats();
        return;
      }
      try {
        if (extensionManager) {
          await extensionManager.injectContentScripts(view.webContents, cur);
        }
      } catch(e) { L('WARN','extension injection:', e.message); }

      broadcastStats();
    });

    view.webContents.on('page-title-updated', (_, t) => {
      tab.title = t || tab.title;
      if (getActiveTab() === tab) {
        main.setTitle(shortenTitle(t || tab.title) + ' — Niex');
        sendTabs();
      }
    });
  }

  function createTab(startUrl) {
    const view = new BrowserView({
      webPreferences: {
        nodeIntegration:false,
        contextIsolation:true,
        webSecurity:true,
        allowRunningInsecureContent:false,
        preload: path.join(__dirname, 'preload.js'),
      }
    });
    // "Google Chrome" identiteti (navigator.userAgentData.brands) — sahifa yuklanишдан OLDIN.
    //   Google OAuth "not secure" blokidan qochish (embedded aniqlamasin).
    applyChromeIdentity(view.webContents);
    const tab = {
      id: makeTabId(),
      view,
      url: startUrl || '',
      title: startUrl ? startUrl : 'Yangi',
      isHome: !startUrl,
      blocked: false,
    };
    attachTabEvents(tab);
    tabs.push(tab);
    showTab(tab);
    if (startUrl) {
      loadUrl(tab, startUrl);
    } else {
      loadHome(tab);
    }
    return tab;
  }

  function goHome() {
    const tab = getActiveTab();
    if (!tab) return;
    loadHome(tab);
    main.setTitle('Niex — Bosh sahifa');
    setTimeout(broadcastStats, 600);
  }

  function closeTab(id) {
    const tab = getTabById(id);
    if (!tab) return;
    const index = tabs.indexOf(tab);
    tabs.splice(index, 1);

    // View'ni ehtiyotkorlik bilan olib tashlash va destroy qilish (memory leak oldini olish)
    try {
      if (tab.view && main.getBrowserViews().includes(tab.view)) {
        main.removeBrowserView(tab.view);
      }
    } catch(e) { L('WARN', 'closeTab removeBrowserView:', e.message); }

    try {
      if (tab.view && tab.view.webContents && !tab.view.webContents.isDestroyed()) {
        tab.view.webContents.close();
      }
    } catch(e) { L('WARN', 'closeTab webContents.close:', e.message); }

    if (tab.id === activeTabId) {
      const next = tabs[index] || tabs[index-1] || tabs[0];
      if (next) {
        showTab(next);
      } else {
        // No tabs left — createTab o'zi showTab chaqiradi
        createTab('');
      }
    }
    if (!getActiveTab() && tabs.length) showTab(tabs[0]);
    sendTabs();
  }

  const win = { main, tbv, tabs, activeTabId, createTab, showTab, getActiveTab, getTabById, closeTab, goHome };
  main.appWin = win;

  main.on('closed', () => wins.delete(main.id));
  wins.set(main.id, win);

  if (startUrl) {
    win.createTab(startUrl);
  } else {
    win.createTab('');
  }

  return win;
}

// ── FIND WIN BY SENDER ──
function findWin(event) {
  const sender = event.sender && event.sender.hostWebContents ? event.sender.hostWebContents : event.sender;
  const bw = sender && BrowserWindow.fromWebContents(sender);
  if (bw) {
    const win = wins.get(bw.id);
    if (win) return win;
  }
  for (const [, w] of wins) {
    if (w.tbv.webContents === sender || w.tabs.some(t => t.view.webContents === sender)) return w;
  }
  return wins.values().next().value;
}

// ── IPC ──
ipcMain.on('navigate', (event, input) => {
  if (!input) return;
  let url = input.trim();
  if (!url.startsWith('http://') && !url.startsWith('https://')) {
    if (url.includes('.') && !url.includes(' ')) url = 'https://' + url;
    else url = 'https://duckduckgo.com/?q=' + encodeURIComponent(url);
  }
  const w = findWin(event);
  const tab = w?.getActiveTab();
  if (tab) {
    tab.isHome = false;
    tab.view.webContents.loadURL(url);
  }
});

ipcMain.on('go-back',    e => { const w = findWin(e); const t = w?.getActiveTab(); if (t?.view.webContents.navigationHistory.canGoBack()) t.view.webContents.navigationHistory.goBack(); });
ipcMain.on('go-forward', e => { const w = findWin(e); const t = w?.getActiveTab(); if (t?.view.webContents.navigationHistory.canGoForward()) t.view.webContents.navigationHistory.goForward(); });
ipcMain.on('go-home',    e => findWin(e)?.goHome());
ipcMain.on('reload',     e => { const w = findWin(e); const t = w?.getActiveTab(); if (t?.isHome) w.goHome(); else t?.view.webContents.reload(); });
ipcMain.on('new-tab',    (event, url) => {
  const w = findWin(event);
  if (w) { w.createTab(url || ''); }
  else { createWin(url || ''); }
});
ipcMain.on('switch-tab', (event, tabId) => {
  const w = findWin(event);
  const tab = w?.getTabById(tabId);
  if (!w || !tab) return;
  try {
    w.showTab(tab);
  } catch(e) {
    console.error('[switch-tab]', e.message);
    // showTab o'zi destroyed view'ni tozalaydi, lekin qo'shimcha xato bo'lsa —
    // yangi tab yaratamiz
    try { w.createTab(''); } catch {}
  }
});

ipcMain.on('close-tab', (event, tabId) => {
  const w = findWin(event);
  if (w) w.closeTab(tabId);
});

ipcMain.on('settings-changed', (_, s) => {
  SETTINGS = Object.assign({}, SETTINGS, s);
  CFG = { ai: SETTINGS.ai!==false, img: SETTINGS.img!==false, yt: SETTINGS.yt!==false, ab: SETTINGS.ab!==false, lang: SETTINGS.lang || 'uz' };
  saveSettingsFile();
  broadcastSettingsUpdate();
  // Maxfiy maydonlarni (API kaliti) log'ga chiqarmaymiz.
  const _s = Object.assign({}, SETTINGS); if (_s.voiceGroqKey) _s.voiceGroqKey = '***';
  L('⚙️','Settings saved:', JSON.stringify(_s));
});

ipcMain.handle('settings-get', async () => SETTINGS);
// Voice Agent — PRO obunachilar uchun (UI tugmani shu bilan ko'rsatadi/yashiradi).
ipcMain.handle('voice-available', async () => { try { return _voiceAllowed(); } catch { return false; } });
// Voice hands-free ("NIEX" wake-word) — GLOBAL sozlama (barcha saytlar uchun bir xil).
ipcMain.handle('voice-handsfree-get', async () => SETTINGS.voiceHandsFree === true);
ipcMain.handle('voice-handsfree-set', async (_e, on) => {
  SETTINGS = Object.assign({}, SETTINGS, { voiceHandsFree: !!on });
  try { saveSettingsFile(); } catch (_) {}
  L('🎧', 'Voice hands-free:', on ? 'ON' : 'OFF');
  return SETTINGS.voiceHandsFree === true;
});
// ── Voice — FOYDALANUVCHI o'z Groq kaliti (BYO) ──
//   Taqsimlangan ilovada har user o'z (bepul) Groq kalitini ulaydi — umumiy pool tugamasin.
//   Kalit main'da saqlanadi (renderer'ga TO'LIQ berilmaydi — faqat maskalangan ko'rinish).
function _maskKey(k) { k = String(k || ''); return k.length < 12 ? (k ? '••••' : '') : (k.slice(0, 6) + '••••••' + k.slice(-4)); }
ipcMain.handle('voice-apikey-get', async () => {
  const k = (SETTINGS && SETTINGS.voiceGroqKey) || '';
  // effective — voice HOZIR ishlay oladimi (user kaliti bor, yoki dev-shared yoqilган).
  const effective = !!k || process.env.NIEX_VOICE_SHARED === '1';
  return { hasKey: !!k, masked: _maskKey(k), effective };
});
ipcMain.handle('voice-apikey-set', async (_e, rawKey) => {
  const key = String(rawKey || '').trim();
  if (!/^gsk_[A-Za-z0-9_\-]{20,}$/.test(key)) return { ok: false, error: 'format', message: 'Kalit "gsk_" bilan boshlanishi kerak.' };
  // Jonli tekshiruv — Groq'ga kalit haqiqiyligini so'raymiz (audio yubormay, models ro'yxati).
  try {
    const r = await fetch('https://api.groq.com/openai/v1/models', {
      headers: { Authorization: 'Bearer ' + key }, signal: AbortSignal.timeout(10000),
    });
    if (r.status === 401 || r.status === 403) return { ok: false, error: 'invalid', message: 'Kalit noto\'g\'ri yoki bekor qilingan.' };
    if (!r.ok) return { ok: false, error: 'http', message: 'Groq javob bermadi (' + r.status + '). Keyinroq urinib ko\'ring.' };
  } catch (e) {
    return { ok: false, error: 'network', message: 'Internet/Groq bilan bog\'lanib bo\'lmadi.' };
  }
  SETTINGS = Object.assign({}, SETTINGS, { voiceGroqKey: key });
  try { saveSettingsFile(); } catch (_) {}
  L('🔑', 'Voice: foydalanuvchi Groq kaliti saqlandi', _maskKey(key));
  return { ok: true, hasKey: true, masked: _maskKey(key) };
});
ipcMain.handle('voice-apikey-clear', async () => {
  if (SETTINGS) delete SETTINGS.voiceGroqKey;
  try { saveSettingsFile(); } catch (_) {}
  L('🔑', 'Voice: foydalanuvchi kaliti o\'chirildi (umumiy pool)');
  return { ok: true, hasKey: false };
});
ipcMain.handle('history-get', async () => HISTORY);
ipcMain.handle('history-delete', async (_, id) => deleteHistoryEntry(id));
ipcMain.handle('history-clear', async () => clearHistory());
ipcMain.handle('subscription-get', async () => subscriptionManager.serialize());
// Foydalanuvchi Premium sahifada "Yangilash" bosса — bulutdан darhol tortadi (poll interval kutmaydi).
ipcMain.handle('subscription-refresh', async () => {
  try {
    L('👑', 'PREMIUM refresh — foydalanuvchi so\'radi');
    const sub = browserCloud && browserCloud.refreshSubscription ? await browserCloud.refreshSubscription() : null;
    return { ok: true, sub, plan: subscriptionManager.serialize() };
  } catch (e) { return { ok: false, error: e.message }; }
});
// subscription-set-plan — 'pro' to'g'ridan-to'g'ri BERILMAYDI (faqat to'lov orqali).
//   'free' → obunani bekor qilish. Bu bepul Pro bypass'ini yopadi.
ipcMain.handle('subscription-set-plan', async (_, planId) => {
  if (planId === 'pro') return { ok: false, error: 'Pro faqat to\'lov orqali faollashadi' };
  const r = subscriptionManager.downgradeToFree('manual');
  broadcastPremiumStatus();
  return r;
});

// ── PREMIUM IPC ──
// Live premium holatini barcha oyna + tab'larga yuborish (restart YO'Q).
function broadcastPremiumStatus() {
  broadcastToAll('premium-status-changed', buildPremiumStatus());
}
function buildPremiumStatus() {
  const myEmail = AUTH_STORAGE?.profile?.email || '';
  // SELF-HEAL: profil bor lekin obuna hisobi sync bo'lmagan bo'lsa — moslaymiz.
  //   Bu login qilinganini ishonchli aniqlaydi (sync uzilib qolsa ham).
  if (myEmail && subscriptionManager.currentAccount !== myEmail.toLowerCase()) {
    subscriptionManager.setCurrentAccount(myEmail);
  } else if (!myEmail && subscriptionManager.currentAccount && !localAccountActive()) {
    // profil ham, lokal hisob ham yo'q → chiqilgan
    subscriptionManager.setCurrentAccount(null);
  }
  const sub = subscriptionManager.serialize();
  const usage = usageManager ? usageManager.serialize() : null;
  const acctEmail = sub.account || myEmail;
  // BULUT ustun: admin rad etsa (status='inactive'), lokal "pending" ko'rsatilmaydi.
  // Bulut ma'lumoti hali yo'q bo'lsa — lokal holatga tayanamiz.
  const cloudSaysPending = _cloudSub ? _cloudSub.status === 'pending' : true;
  const pending = (cloudSaysPending && acctEmail)
    ? paymentStore.requests.find(r => r.email === acctEmail && r.status === 'pending')
    : null;
  return {
    isPro: sub.isPro,
    plan: sub.plan,
    loggedIn: sub.loggedIn,
    account: sub.account,
    activatedAt: sub.activatedAt || null,
    expiresAt: sub.expiresAt || null,
    daysRemaining: sub.daysRemaining,
    usage,
    card: PREMIUM_BANK_CARD,
    profile: AUTH_STORAGE?.profile || null,
    pendingRequest: pending ? { id: pending.id, createdAt: pending.createdAt, amount: pending.amount } : null,
  };
}
// Lokal hisob (email/parol) faol ekanini bilish uchun helper — account-set orqali o'rnatiladi.
let _localAccountEmail = null;
function localAccountActive() { return !!_localAccountEmail; }

// Bulutdagi obuna holati (onSub orqali yangilanadi). Lokal paymentStore'dan
// ustun turadi: admin bulutda RAD etsa, brauzer "kutilmoqda" deb qolmasligi kerak.
let _cloudSub = null;

// TOOLBAR DROPDOWN FIX — panel ochilganda toolbar view'ni to'liq balandlikka
//   kengaytiramiz va OLDINGA chiqaramiz, aks holda content BrowserView dropdown'ni yopadi.
ipcMain.on('toolbar-expand', (event, open) => {
  const w = findWin(event);
  if (!w) return;
  try {
    const { width, height } = w.main.getContentBounds();
    if (open) {
      w.tbv.setBounds({ x: 0, y: 0, width, height });
      w.main.setTopBrowserView(w.tbv);
    } else {
      w.tbv.setBounds({ x: 0, y: 0, width, height: 90 });
      const t = w.getActiveTab();
      if (t && t.view) w.main.setTopBrowserView(t.view);
    }
  } catch (e) { L('WARN', 'toolbar-expand:', e.message); }
});

// Premium sahifasini ochish (Pro tugmasi bosilganda)
ipcMain.on('open-premium', (event) => {
  const w = findWin(event);
  const tab = w?.getActiveTab();
  const file = path.join(__dirname, 'premium.html');
  if (tab) { tab.isHome = false; tab.view.webContents.loadFile(file); }
  else if (w) { w.createTab('file://' + file); }
});

// Focus mahsulot sahifasini ochish (sidebar/toolbar 🎯 bosilganda) — to'liq
// bag'ishlangan sahifa (spec: "Focus must have a dedicated page", ON/OFF emas).
ipcMain.on('open-focus', (event) => {
  const w = findWin(event);
  const tab = w?.getActiveTab();
  const file = path.join(__dirname, 'focus.html');
  if (tab) { tab.isHome = false; tab.view.webContents.loadFile(file); }
  else if (w) { w.createTab('file://' + file); }
});

ipcMain.handle('premium-get-status', async () => buildPremiumStatus());

// AI limitlar — birlashgan 24-soatlik AI kvota. Free 60 daq; Pro cheksiz.
// NIEX MAHSULOT LIMITLARI — foydalanuvchi tarifining kunlik cheklovlari.
//   MUHIM: bu external API provider (OpenAI/Gemini/Groq) quota EMAS.
//   Provider stats/token/xarajat — faqat Admin Dashboard'da.
//   Bu yerda faqat NIEX operatsiyalarining kunlik counterlari:
//     videoMinutes | image | deepScan | ocr | pdf   (5 turi)
//   Local AI (sayt/matn tahlili, browser himoyasi) — CHEKSIZ, counterga tegilmaydi.
ipcMain.handle('ai-limits-get', async () => {
  try {
    const sub = subscriptionManager.serialize();
    const daily = usageManager ? usageManager.getDailyUsage(Date.now()) : null;
    // Legacy ai bloki (backward compat — eski premium UI ishlashi uchun)
    const usage = usageManager ? usageManager.getUsage(Date.now()) : null;
    const aiUsedSec = usage?.aiSeconds || 0;
    const aiLimitSec = usage?.aiLimitSeconds ?? Infinity;
    const unlimited = !Number.isFinite(aiLimitSec);

    // Yangi struktura — har 5 turi uchun alohida progress ma'lumoti.
    //   videoMinutes kasr bo'lishi mumkin (local kadr-skaner sekundlari) → 1 kasr bilan ko'rsatamiz.
    const round1 = (n) => Math.round((Number(n) || 0) * 10) / 10;
    const operations = daily ? ['videoMinutes','image','deepScan','ocr','pdf'].map(op => {
      const isMin = op === 'videoMinutes';
      const rawRem = daily.remaining[op];
      return {
        op,
        used: isMin ? round1(daily.counters[op] || 0) : (daily.counters[op] || 0),
        limit: daily.limits[op] === Infinity ? null : daily.limits[op],
        remaining: rawRem === Infinity ? null : (isMin ? round1(rawRem) : rawRem),
        percent: daily.percent[op],
        unlimited: daily.limits[op] === Infinity,
        exhausted: !!daily.exhausted[op],
      };
    }) : [];

    return {
      ok: true,
      planId: sub.planId,
      planName: sub.plan?.name || 'Free',
      isPro: sub.isPro,
      loggedIn: sub.loggedIn,
      // Local AI — barcha planlarda cheksiz (UI'da "Unlimited" ko'rsatiladi)
      localUnlimited: true,
      // Cloud operatsiyalar (5 turi) — plan bo'yicha kunlik cheklangan
      operations,
      // Kunlik reset — mahalliy 00:00
      dayStart: daily?.dayStart || null,
      resetAt: daily?.resetAt || null,
      msUntilReset: daily?.msUntilReset || 0,

      // Legacy bloki — eski UI ishlashi uchun (deprecated, keyingi refactor'da olinadi)
      ai: {
        usedMinutes: Math.round((aiUsedSec / 60) * 10) / 10,
        limitMinutes: unlimited ? null : Math.round(aiLimitSec / 60),
        remainingMinutes: unlimited ? null : Math.max(0, Math.round(aiLimitSec / 60) - Math.floor(aiUsedSec / 60)),
        percent: unlimited ? 0 : Math.min(100, Math.round((aiUsedSec / aiLimitSec) * 100)),
        unlimited,
      },
      msRemaining: usage?.msRemaining || 0,
    };
  } catch (e) { return { ok: false, error: e.message }; }
});

// Cloud AI test — foydalanuvchi kalitlar/gateway ishlashini o'zi ko'rishi mumkin.
//   Kichik test rasmi yuboradi (1x1 pixel JPEG base64) va gateway javobini qaytaradi.
ipcMain.handle('ai-cloud-test', async () => {
  try {
    // 1x1 oq pixel JPEG (kichik test yuki)
    const testJpeg = '/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAABAAEDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwD/AD/6KKKAP//Z';
    const r = await aiGateway.analyze({ type: 'image', image_base64: testJpeg });
    const stats = aiGateway.getStats();
    return {
      ok: true,
      test: r,
      provider: r.provider,
      cached: !!r.cached,
      keysRemaining: stats?.totals?.remaining ?? null,
      keysTotal: stats?.totals?.keys ?? null,
      requestsToday: stats?.totals?.requests_today ?? null,
      providers: (stats?.providers || []).map(p => ({
        name: p.name, status: p.status, keysLeft: p.keys_remaining, keysTotal: p.keys_total,
        requestsToday: p.requests_today, errorsToday: p.errors_today,
      })),
    };
  } catch (e) { return { ok: false, error: e.message }; }
});

// Obunani bekor qilish (joriy hisob) → Free. Bulutga ham xabar (agar kerak bo'lsa).
//   Foydalanuvchi keyinchalik qayta obuna bo'lishga urinsa "sizda pending bor" xatoligiga tushmasin
//   — pending payment(lar)ni ham 'rejected' qilamiz.
ipcMain.handle('premium-cancel', async () => {
  const r = subscriptionManager.downgradeToFree('user-cancel');
  try {
    const em = (subscriptionManager.currentAccount || '').toLowerCase();
    if (em) {
      for (const req of paymentStore.requests) {
        if (req.email && req.email.toLowerCase() === em && req.status === 'pending') {
          paymentStore.decide(req.id, 'reject', { by: 'user', reason: 'user-canceled-subscription' });
        }
      }
    }
  } catch (e) { L('WARN', 'pending cleanup on cancel:', e.message); }
  appendNotification({ title: 'Obuna bekor qilindi', body: 'Pro obunangiz bekor qilindi. Free rejaga qaytdingiz.', type: 'premium' });
  broadcastPremiumStatus();
  return r;
});

// Foydalanuvchining o'zi to'lov so'rovini bekor qilish (pending → rejected).
//   premium.html "Pending" view'ida "Bekor qilish" tugmasi shuni chaqiradi — qayta topshirishga imkon.
ipcMain.handle('premium-cancel-pending', async () => {
  try {
    const em = (subscriptionManager.currentAccount || '').toLowerCase();
    if (!em) return { ok: false, error: 'Avval hisobga kiring' };
    let count = 0;
    for (const req of paymentStore.requests) {
      if (req.email && req.email.toLowerCase() === em && req.status === 'pending') {
        paymentStore.decide(req.id, 'reject', { by: 'user', reason: 'user-canceled-request' });
        count++;
      }
    }
    broadcastPremiumStatus();
    return { ok: true, canceled: count };
  } catch (e) { return { ok: false, error: e.message }; }
});

// To'lov so'rovini yuborish — validatsiya backend'da, bir vaqtda bitta pending.
ipcMain.handle('premium-submit-payment', async (event, data) => {
  try {
    const ip = event.sender?.getURL ? '' : '';
    const res = paymentStore.create({
      name: data.name,
      email: data.email || AUTH_STORAGE?.profile?.email || '',
      phone: data.phone,
      amount: data.amount,
      txnDate: data.txnDate,
      txnTime: data.txnTime,
      message: data.message,
      base64Screenshot: data.screenshot,
      ip,
    });
    if (res.ok) {
      appendNotification({ title: 'To\'lov yuborildi', body: 'To\'lovingiz tekshiruvga qabul qilindi. Tez orada javob beramiz.', type: 'premium', meta: { paymentId: res.request.id } });
      // BULUTGA ham yuborish — Lovable admin "To'lovlar"ga tushadi, obuna PENDING bo'ladi
      try {
        const cloudRes = await browserCloud.submitPayment({
          name: data.name, email: data.email || AUTH_STORAGE?.profile?.email || '',
          phone: data.phone, amount: data.amount, txnDate: data.txnDate, txnTime: data.txnTime,
          message: data.message, screenshot: data.screenshot, planId: data.planId, promoCode: data.promoCode
        });
        
        // 100% discount auto-approval check
        if (cloudRes && cloudRes.data && cloudRes.data.status === 'approved') {
          // It was instantly approved due to a 100% discount!
          const act = subscriptionManager.activatePro({ months: data.planId === 'quarterly' ? 3 : (data.planId === 'yearly' ? 12 : 1), paymentId: cloudRes.data.id });
          appendNotification({ title: '🎉 Premium faollashtirildi!', body: 'Tabriklaymiz! Pro obuna promo kod orqali faollashdi.', type: 'premium', meta: { paymentId: cloudRes.data.id } });
        }
      } catch {}
      broadcastPremiumStatus();
    }
    return res;
  } catch (e) {
    L('WARN', 'premium-submit:', e.message);
    return { ok: false, error: e.message };
  }
});

ipcMain.handle('premium-validate-promo', async (event, data) => {
  try {
    if (!browserCloud || !browserCloud.validatePromo) return { ok: false, error: 'Bulut ulanishi yo\'q' };
    const email = data.email || AUTH_STORAGE?.profile?.email || '';
    if (!email) return { ok: false, error: 'Promo kod ishlatish uchun hisobingizga kiring' };
    return await browserCloud.validatePromo({ code: data.code, planId: data.planId, email });
  } catch (e) {
    return { ok: false, error: e.message };
  }
});
ipcMain.handle('usage-get', async () => usageManager.serialize());
ipcMain.handle('usage-record', async (_, payload) => usageManager.recordUsage(payload));
ipcMain.handle('focus-get', async () => focusManager.serialize());
ipcMain.handle('focus-start', async (_, payload) => {
  const result = focusManager.startSession(payload);
  if (result.ok) {
    broadcastFocusState();
    focusNotificationManager.add('Focus Mode started', { level: 'info', meta: { sessionId: result.session.id } });
  }
  return result;
});
ipcMain.handle('focus-pause', async () => {
  const result = focusManager.pauseSession();
  broadcastFocusState();
  return result;
});
ipcMain.handle('focus-resume', async () => {
  const result = focusManager.resumeSession();
  broadcastFocusState();
  return result;
});
// Backward-compat: eski toolbar 'focus-stop' — endi sessiyani YAKUNLAYDI (End).
ipcMain.handle('focus-stop', async () => {
  const result = focusManager.endSession();
  broadcastFocusState();
  return result;
});
// Yangi UI: foydalanuvchi sessiyani yakunlaydi (End) — refleksiya ekraniga o'tadi.
ipcMain.handle('focus-end', async () => {
  const result = focusManager.endSession();
  if (result.ok) {
    broadcastFocusState();
    focusNotificationManager.add('Focus sessiyasi yakunlandi', { level: 'info', meta: { sessionId: result.session.id } });
  }
  return result;
});
// Foydalanuvchi sessiyani bekor qiladi (Cancel).
ipcMain.handle('focus-cancel', async () => {
  const result = focusManager.cancelSession();
  broadcastFocusState();
  return result;
});
// Refleksiyani saqlash (rating / izoh / completionStatus).
ipcMain.handle('focus-reflection', async (_, payload = {}) => {
  const result = focusManager.saveReflection(payload.sessionId, payload.reflection || {});
  broadcastFocusState();
  return result;
});
// Subtask holatini o'zgartirish (belgilash / to'g'rilash).
ipcMain.handle('focus-subtask', async (_, payload = {}) => {
  const result = focusManager.setSubtaskDone(payload.subtaskId, payload.done, payload.sessionId || null);
  broadcastFocusState();
  return result;
});
// DistractionEvent yozish — PART 2/3 (exit detection / AI) uchun poydevor.
ipcMain.handle('focus-record-exit', async (_, partial = {}) => {
  try { if (activityStore) activityStore.recordDistraction(); } catch (_) {}
  return focusManager.recordDistractionEvent(partial);
});
// Tarix (yakunlangan sessiyalar).
ipcMain.handle('focus-history', async () => focusManager.getHistory());
// Analitika (Statistika ekrani so'raganda) — har broadcast'da emas, alohida.
ipcMain.handle('focus-analytics', async () => focusManager.getAnalytics());
// Scroll-detection hisoboti (content script → main). Faqat ACTIVE tab + ACTIVE
// focus sessiyada hisobga olinadi (spec §14: fon tab scroll vaqtini oshirmasin).
// ── ACTIVITY INTELLIGENCE — wall-clock accounting (§3/§4) ──────────
// Hisobot oralig'idagi haqiqiy vaqt AYNAN o'sha activity turiga yoziladi.
// Mantiq alohida testlanadigan modulda (activity-accountant.js). Bu yerda faqat
// Focus goal/isFocus kontekstini beramiz va kutayotgan segmentni yopamiz.
function flushActivitySeg() { try { if (activityAccountant) activityAccountant.flush(); } catch (_) {} }
function accountActivity(wcId, data) {
  if (!activityAccountant) return;
  let goal = '', isFocus = false;
  try {
    const s = focusManager && focusManager.getActiveSession();
    if (s && s.state === 'active') { isFocus = true; goal = s.goal || ''; }
  } catch (_) {}
  activityAccountant.report(wcId, data, { goal, isFocus });
}

ipcMain.on('focus-activity-report', (event, data) => {
  try {
    if (!data) return;
    const w = findWin(event);
    const at = w && w.getActiveTab && w.getActiveTab();
    if (!at || !at.view || at.view.webContents !== event.sender) return; // faqat active tab
    const wcId = event.sender.id;
    // Activity Intelligence — har hisobotda wall-clock vaqtni tegishli bucketga yozamiz.
    try { accountActivity(wcId, data); } catch (_) {}
    const cur = Math.max(0, Number(data.scrollingMs) || 0);
    const prev = scrollByWc.get(wcId) || 0;
    let delta = cur - prev;
    if (delta < 0) delta = cur; // sahifa almashdi — cumulative nolga tushdi
    scrollByWc.set(wcId, cur);
    const onFeed = !!data.isFeed;
    if (onFeed) lastScrollWc = event.sender;

    // 1) Focus sessiya faol → sessiya analitikasiga qo'shamiz.
    if (focusManager) {
      const s = focusManager.getActiveSession();
      if (s && s.state === 'active') {
        if (delta > 0) focusManager.addScrollingMs(delta, { platform: data.platform });
        focusManager.setCurrentActivity(data.activityType, data.platform, data.context);
      }
    }
    // 2) Guardian (Pro userlar uchun DOIM ishlaydi — Focus sessiyasi shart emas).
    if (scrollGuardian && proScrollEnabled()) {
      if (scrollGuardian.isRestricted()) {
        // Cheklov paytida feedga qaytsa (SPA/reload/nav) — cheklov sahifasini yuklaymiz.
        if (onFeed) loadScrollRestriction(event.sender);
      } else if (delta > 0) {
        scrollGuardian.addScroll(delta, { platform: data.platform });
      }
    }
  } catch (e) {}
});
// Scrolling ogohlantirishiga foydalanuvchi javobi (Ha / Keyinroq).
ipcMain.on('focus-scroll-resolve', (_e, choice) => {
  try { if (scrollGuardian) scrollGuardian.onUserChoice(choice); } catch (e) {}
});

// ── REDIRECT PROTECTION — phishing content scanner hisoboti (PART 3) ──
// phishing-scan.js sahifadagi credential/karta formasini aniqlab yuboradi.
// Qaror nav-guard.analyzePage() da (brand-impersonation / cross-origin exfil /
// shubhali domen). Haqiqiy loginlar (allowlist/brend domeni) hech qachon bloklanmaydi.
ipcMain.on('phishing-scan-report', (event, sig) => {
  try {
    if (!sig || !sig.url) return;
    if (!_redirectProtectionOn()) return;         // list-free phishing himoyasi — Pro
    const d = NavGuard.analyzePage(sig);
    if (!d || !d.phishing) return;
    ST.block++;
    L('🛡️', 'PHISHING SAHIFA', `[${d.score}] ` + String(sig.url).slice(0, 80) + ' — ' + (d.signals || []).join(','));
    try { event.sender.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(blockPage(sig.url, d.reason))); } catch (_) {}
    try { if (activityStore) activityStore.recordBlocked(); } catch (_) {}
    navGuardParentAlert({ category: 'phishing', host: NavGuard.hostFromUrl(sig.url), reason: d.reason }, sig.url);
    try { broadcastStats(); } catch (_) {}
  } catch (e) { L('WARN', 'phishing-scan:', e.message); }
});

// ── VOICE AGENT — Speech-to-Text (Prompt 2) ──
// Renderer (voice-recorder.js) mikrofondan audio bayt yuboradi → MAIN transkripsiya
// qiladi (Groq Whisper, kalit ai-gateway'dan). Audio SAQLANMAYDI; transkript to'liq
// log qilinmaydi (maxfiylik). Natija keyingi qatlam (interpreter) uchun tayyor matn.
ipcMain.handle('voice-stt-transcribe', async (_e, payload = {}) => {
  try {
    if (!voiceStt) return { ok: false, error: 'stt-unavailable' };
    // Buyruq tili INGLIZCHA (foydalanuvchi qarori): Whisper qisqa inglizcha buyruqlarni
    //   ('search'/'open'/'play'/'louder'...) o'zbekchaga qaraganda ancha aniq transkript
    //   qiladi. Qidiriladigan matn (masalan "505 music") istalgan tilda bo'lishi mumkin.
    //   NIEX_STT_LANG env bilan bekor qilish mumkin (masalan 'uz').
    const lang = payload.language || process.env.NIEX_STT_LANG || 'en';
    const audioSize = payload.audio && (payload.audio.byteLength || payload.audio.length) || 0;
    L('🎙️', 'STT →', `${audioSize}B ${payload.mimeType || '?'} lang=${lang}`);
    const res = await voiceStt.transcribe(payload.audio, { mimeType: payload.mimeType, language: lang });
    if (res && res.ok) L('🎙️', 'STT ←', `${res.provider} ${res.durationMs || 0}ms lang=${res.language || '?'} "${String(res.text || '').slice(0, 120)}"`);
    else L('WARN', 'STT ←', (res && (res.error + (res.detail ? ' ' + res.detail : ''))) || 'fail');
    return res;
  } catch (e) { return { ok: false, error: 'stt-exception', detail: e.message }; }
});

// ── VOICE AGENT — Command Interpreter + Action Engine (Prompt 3/4/5) ──
// text → interpret (local/Qwen-mock) → validate → NIEX Security (nav-guard) → bajar.
// Qwen serveri: NIEX_QWEN_ENDPOINT sozlansa — endpoint; aks holda mock (hozir).
function _makeVoiceLlm() {
  const endpoint = process.env.NIEX_QWEN_ENDPOINT;
  if (endpoint) {
    return createCommandLLM({ mode: 'endpoint', request: async (payload) => {
      const r = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload), signal: AbortSignal.timeout(15000) });
      return await r.json().catch(() => ({}));
    } });
  }
  return createCommandLLM({ mode: 'mock' });
}
function _voiceAllowed() {
  try {
    // SELF-HEAL: login bor, lekin obuna hisobi hali sync bo'lmagan bo'lsa — moslaymiz.
    //   (Aks holda bosh sahifada voice-available FALSE qaytardi, chunki currentAccount null
    //    edi va broadcastPremiumStatus hali chaqirilmagandi → voice Pro bo'la turib ko'rinmasди.)
    const myEmail = (AUTH_STORAGE && AUTH_STORAGE.profile && AUTH_STORAGE.profile.email || '').toLowerCase();
    if (myEmail && subscriptionManager.currentAccount !== myEmail) {
      subscriptionManager.setCurrentAccount(myEmail);
    }
    const ok = subscriptionManager.isFeatureEnabled('voiceAgent') || process.env.NIEX_VOICE_ALL === '1';
    if (process.env.NIEX_VOICE_DEBUG === '1') {
      L('🎧', `_voiceAllowed=${ok} | myEmail=${myEmail || '(bo\'sh)'} | curAcc=${subscriptionManager.currentAccount || '(null)'} | plan=${subscriptionManager.serialize().planId}`);
    }
    return ok;
  } catch (e) { if (process.env.NIEX_VOICE_DEBUG === '1') L('🎧', '_voiceAllowed XATO:', e.message); return process.env.NIEX_VOICE_ALL === '1'; }
}
// MVP rejim: NIEX_QWEN_ENDPOINT sozlanmasa Qwen umuman chaqirilmaydi (local tushunmasa
// 'unknown' qaytadi). Endpoint sozlansa avtomatik AI Router yo'liga o'tadi.
const _voiceMvp = !process.env.NIEX_QWEN_ENDPOINT;
const _voiceInterpreter = createCommandInterpreter({ mvpMode: _voiceMvp, llm: _makeVoiceLlm(), gate: _voiceAllowed });

function _voiceExecutors(win) {
  const tab = () => (win && win.getActiveTab && win.getActiveTab()) || null;
  const wc = () => { const t = tab(); return t && t.view && !t.view.webContents.isDestroyed() ? t.view.webContents : null; };
  const perform = async (action) => {
    const c = wc(); if (!c) return { ok: false, status: 'error', message: 'no-tab' };
    try { return await c.executeJavaScript('(' + VOICE_ACTION_FN + ')(' + JSON.stringify(action) + ')', true); }
    catch (e) { return { ok: false, status: 'error', message: e.message }; }
  };
  const openIn = (url) => { const t = tab(); if (!t) { win.createTab(url); return { ok: true }; } t.isHome = false; t.view.webContents.loadURL(url); return { ok: true }; };
  return {
    open_site: async (url) => openIn(url),
    search: async (query, engine) => openIn(VoiceSchema.searchUrl(query, engine)),
    new_tab: async (url) => { win.createTab(url || ''); return { ok: true }; },
    close_tab: async () => { const t = tab(); if (t) win.closeTab(t.id); return { ok: true }; },
    go_back: async () => { const c = wc(); if (c && c.navigationHistory.canGoBack()) c.navigationHistory.goBack(); return { ok: true }; },
    go_forward: async () => { const c = wc(); if (c && c.navigationHistory.canGoForward()) c.navigationHistory.goForward(); return { ok: true }; },
    reload: async () => { const t = tab(); if (t && t.isHome) win.goHome(); else { const c = wc(); if (c) c.reload(); } return { ok: true }; },
    scroll: async (dir, amount) => perform({ type: 'scroll', direction: dir, amount }),
    play: async () => perform({ type: 'play' }),
    pause: async () => perform({ type: 'pause' }),
    next_video: async () => perform({ type: 'next_video' }),
    previous_video: async () => perform({ type: 'previous_video' }),
    // MVP kengaytmasi (Qwen'siz local parser) — type_text & click (aniq matching, JS'siz).
    type_text: async (query, target, submit) => perform({ type: 'type_text', query, target, submit: submit === true }),
    click: async (target) => perform({ type: 'click', target }),
    // "birinchi videoni qoy" — sahifadagi N-natijani ochadi (YouTube/qidiruv/generik).
    open_result: async (index) => perform({ type: 'open_result', index }),
    // "louder 5" / "lower 3" — video/audio ovozini o'zgartiradi (delta yoki absolute level).
    set_volume: async (delta, level) => perform({ type: 'set_volume', delta, level }),
  };
}
function _voiceAfterNav(win) {
  return () => new Promise((resolve) => {
    const t = win && win.getActiveTab && win.getActiveTab();
    const c = t && t.view && !t.view.webContents.isDestroyed() ? t.view.webContents : null;
    if (!c) return resolve();
    let done = false; const fin = () => { if (done) return; done = true; try { c.removeListener('did-stop-loading', fin); } catch (_) {} resolve(); };
    try { c.once('did-stop-loading', fin); } catch (_) { return resolve(); }
    setTimeout(fin, 3000);
  });
}
// checkNav — voice navigatsiyasi NIEX xavfsizligidan (nav-guard) o'tadi (source:'user').
function _voiceCheckNav(url, source) {
  try { const d = NavGuard.decide({ url, source: source || 'user' }); return { allow: d.allow, reason: d.reason, category: d.category, host: d.host }; }
  catch { return { allow: true }; }
}

ipcMain.handle('voice-command', async (event, payload = {}) => {
  try {
    if (!_voiceAllowed()) { L('🎙️', 'VOICE', 'blocked: gate=Pro-only'); return { success: false, status: 'unsupported', message: 'Ovozli agent Pro obunada mavjud.' }; }
    const text = String((payload && payload.text) || '').trim();
    L('🎙️', 'VOICE ▶', `"${text}"`);
    if (!text) return { success: false, status: 'needs_clarification', message: 'Hech narsa eshitilmadi.' };
    const interp = await _voiceInterpreter.interpret(text, { context: (payload && payload.context) || {} });
    L('🎙️', 'VOICE parse', `[${interp.source}] status=${interp.status} actions=[${(interp.actions || []).map(a => a.type + (a.url ? ':' + a.url.slice(0, 40) : (a.query ? ':' + a.query : ''))).join(',')}]${interp.message ? ' — ' + interp.message : ''}`);
    if (!interp.actions || !interp.actions.length) {
      return { success: false, status: interp.status, message: interp.message, transcript: text, source: interp.source };
    }
    const win = findWin(event);
    if (!win) return { success: false, status: 'error', message: 'Oyna topilmadi', transcript: text };
    const engine = createActionEngine({ executors: _voiceExecutors(win), checkNav: _voiceCheckNav, afterNav: _voiceAfterNav(win) });
    const res = await engine.run(interp.actions, { source: 'user' });
    L('🎙️', 'VOICE exec', `${res.status} completed=${res.completedActions || 0}${res.failedAction ? ' failed=' + res.failedAction.type : ''}${res.message ? ' — ' + res.message : ''}`);
    // Xavfli manzil bloklansa — ota-onaga signal. Ovozli buyruq = farzand ATAYLAB
    //   so'radi → source:'user' (navGuardParentAlert faqat shu holatda yuboradi).
    if (res.status === 'blocked' && res.reason) {
      try { navGuardParentAlert({ category: res.reason, host: '', reason: 'Ovozli buyruq — ' + res.reason, source: 'user' }, ''); } catch (_) {}
    }
    return { ...res, transcript: text, source: interp.source, actions: (interp.actions || []).map(a => a.type) };
  } catch (e) { L('WARN', 'VOICE exception:', e.message); return { success: false, status: 'error', message: e.message }; }
});
// ── EXIT INTERVENTION (PART 2) ──
// Intervention oynasi sabab bilan qaror so'raydi → AIOrchestrator (deterministik
// + kelajakda LLM) tuzilgan tavsiya qaytaradi. AI faqat TAVSIYA — qaror foydalanuvchida.
ipcMain.handle('focus-intervention-decide', async (_, payload = {}) => {
  const ac = focusManager ? focusManager.getActiveContext() : null;
  const prior = focusManager ? focusManager.getDistractionSummary() : {};
  const decision = await FocusAI.decide({
    goal: ac && ac.goal, task: ac && ac.task, reason: ac && ac.reason, successCriteria: ac && ac.successCriteria,
    remainingMinutes: ac && ac.remainingMinutes,
    exitReasonCategory: payload.reasonCategory,
    freeText: payload.freeText,
    priorSummary: prior,
  }, { useRemote: false });
  if (payload.eventId && focusManager) {
    focusManager.updateDistractionEvent(payload.eventId, {
      userReason: payload.reasonCategory,
      userReasonText: payload.freeText,
      category: decision.category,
      aiDecision: decision.decision,
    });
  }
  return decision;
});
// Foydalanuvchi yakuniy qarorini yozamiz va oynani yopamiz.
ipcMain.on('focus-intervention-resolve', (_event, payload = {}) => {
  if (payload.eventId && focusManager) {
    const allowed = ['stayed', 'left', 'scheduled', 'dismissed'];
    focusManager.updateDistractionEvent(payload.eventId, {
      userReason: payload.reasonCategory,
      userReasonText: payload.freeText,
      category: payload.category,
      aiDecision: payload.aiDecision,
      userDecision: allowed.includes(payload.userDecision) ? payload.userDecision : 'dismissed',
      resolved: true,
    });
  }
  closeFocusInterventionWindow();
  try { broadcastFocusState(); } catch (_) {}
});
ipcMain.handle('focus-settings-get', async () => focusSettingsManager.getState());
ipcMain.handle('focus-settings-set', async (_, updates) => focusSettingsManager.update(updates));
ipcMain.handle('focus-blocks-get', async () => ({ categories: blockEngine.getCategories(), customDomains: blockEngine.getCustomDomains() }));
ipcMain.handle('focus-blocks-add-domain', async (_, domain) => blockEngine.addCustomDomain(domain));
ipcMain.handle('focus-blocks-remove-domain', async (_, domain) => blockEngine.removeCustomDomain(domain));
ipcMain.handle('focus-blocks-set-category', async (_, { categoryId, enabled }) => blockEngine.setCategoryEnabled(categoryId, enabled));
// Strong Focus — saytni vaqtincha ruxsat berish (blok-sahifadan).
ipcMain.handle('focus-temp-allow', async (_, payload = {}) => (blockEngine ? blockEngine.addTempAllow(payload.domain, payload.minutes || 15) : { ok: false }));
ipcMain.handle('focus-stats-get', async () => focusStatisticsManager.getStats());
ipcMain.handle('focus-notifications-get', async () => focusNotificationManager.list());

// ── ACTIVITY INTELLIGENCE IPC (Parental Control PART 1-4) ──
// Farzand/user o'z statistikasini ko'radi. Jonli segment yozib bo'lingach o'qiladi.
ipcMain.handle('activity-get-today', async () => { try { flushActivitySeg(); } catch (_) {} return activityStore ? activityStore.getToday() : null; });
ipcMain.handle('activity-get-week', async () => { try { flushActivitySeg(); } catch (_) {} return activityStore ? activityStore.getWeekTrend() : null; });
ipcMain.handle('activity-serialize', async () => { try { flushActivitySeg(); } catch (_) {} return activityStore ? activityStore.serialize() : null; });
// OTA-ONA: farzand faoliyati (backend authorization: active link SHART).
ipcMain.handle('parent-child-activity', async (_, payload = {}) => {
  try { return browserCloud.getChildActivity(payload.childEmail, payload.days || 14); }
  catch (e) { return { ok: false, error: e.message }; }
});
// OTA-ONA: farzand haftalik hisobotini yaratib yuborish (email + notification).
ipcMain.handle('parent-weekly-report', async (_, payload = {}) => {
  try { return browserCloud.sendWeeklyReport(payload.childEmail); }
  catch (e) { return { ok: false, error: e.message }; }
});

// Activity Intelligence — dirty kunlarni bulutga yuborish (ms → sekund).
function _msToSec(ms) { return Math.round((Number(ms) || 0) / 1000); }
function _mapMsToSec(m) { const o = {}; for (const k in (m || {})) o[k] = _msToSec(m[k]); return o; }
async function syncActivityToCloud() {
  try {
    if (!activityStore || !browserCloud || !browserCloud.syncActivity) return;
    try { flushActivitySeg(); } catch (_) {}
    const dirty = activityStore.getDirtyDays();
    if (!dirty.length) return;
    const days = dirty.map(d => ({
      date: d.date,
      totalSeconds: _msToSec(d.totalMs),
      focusSeconds: _msToSec(d.focusMs),
      usefulSeconds: _msToSec(d.value.usefulMs),
      lowValueSeconds: _msToSec(d.value.lowValueMs),
      unknownSeconds: _msToSec(d.value.unknownMs),
      distractionCount: d.distractionCount,
      blockedCount: d.blockedCount,
      byType: _mapMsToSec(d.byType),
      byPlatform: _mapMsToSec(d.byPlatform),
      byCategory: _mapMsToSec(d.byCategory),
      byValue: _mapMsToSec(d.byValue),
    }));
    const r = await browserCloud.syncActivity({ days, deviceType: 'desktop' });
    if (r && r.ok && Array.isArray(r.synced) && r.synced.length) {
      activityStore.markSynced(r.synced);
    }
  } catch (_) { /* offline — dirty saqlanadi, keyingi urinishda yuboriladi */ }
}

// ── AUTH IPC (Firebase) ──
ipcMain.handle('auth-signin-google', async (event) => {
  const sender = event.sender;
  if (!sender) return { ok: false, error: 'No sender' };
  try {
    const result = await performGoogleOAuthPKCE(sender);
    return result;
  } catch (e) {
    return { ok: false, error: String(e) };
  }
});

ipcMain.handle('auth-signout', async (event) => {
  const sender = event.sender;
  if (sender) {
    sender.send('auth-trigger-signout');
  }
  AUTH_STORAGE = { profile: null, tokens: null };
  saveAuthFile();
  subscriptionManager.setCurrentAccount(null);
  broadcastPremiumStatus();
  broadcastFocusState();
  return { ok: true };
});

ipcMain.handle('auth-get-profile', async () => AUTH_STORAGE.profile);

ipcMain.handle('auth-get-credentials', async () => ({
  profile: AUTH_STORAGE.profile,
  idToken: (AUTH_STORAGE.tokens && AUTH_STORAGE.tokens.id_token) || null,
}));

// Renderer login/logout (Firebase yoki lokal profil) → obunani hisobga moslash.
//   Har qanday auth usuli uchun ishonchli: renderer email'ni shu orqali main'ga yuboradi.
ipcMain.on('account-set', (e, email) => {
  const normalized = email ? String(email).toLowerCase() : null;
  _localAccountEmail = normalized;
  if (normalized) { AUTH_STORAGE.profile = { ...(AUTH_STORAGE.profile || {}), email: normalized }; }
  else if (!AUTH_STORAGE?.tokens) { AUTH_STORAGE = { profile: null, tokens: null }; }
  subscriptionManager.setCurrentAccount(normalized);
  // Bulutga bildirish — ota-ona farzandni EMAIL orqali shu orqali topadi
  try { browserCloud.reportAccount(normalized, AUTH_STORAGE?.profile?.name || ''); } catch {}
  broadcastPremiumStatus();
  broadcastFocusState();
});

// TO'LIQ PROFILNI BULUTGA SAQLASH — safenethome.html yuboradi (yosh, rol, qiziqishlar...).
//   Ilgari profil faqat localStorage'da edi → ota-ona farzand emailini topa olmasdi
//   va admin panelda foydalanuvchilar ko'rinmasdi.
ipcMain.on('account-profile', (e, prof) => {
  try {
    if (!prof || !prof.email) return;
    const email = String(prof.email).toLowerCase();
    _localAccountEmail = email;
    AUTH_STORAGE.profile = { ...(AUTH_STORAGE.profile || {}), email, name: prof.name || AUTH_STORAGE?.profile?.name };
    subscriptionManager.setCurrentAccount(email);
    browserCloud.reportAccount({ ...prof, email });
    broadcastPremiumStatus();
    broadcastFocusState();
  } catch (err) { L('WARN', 'account-profile:', err.message); }
});

// ══════════════════════════════════════════════════════════════
// PAROL MENEJERI IPC
//
// Parollar RENDERER'ga faqat ikki holatda beriladi:
//   1. `password-get-for-origin` — o'sha sahifaning O'Z origini uchun
//      (avtomatik to'ldirish). Boshqa sayt so'ray olmaydi: origin
//      so'rovchi sahifaning haqiqiy URL'idan olinadi, argumentdan emas.
//   2. `password-reveal` — foydalanuvchi boshqaruv panelida "ko'rsatish"
//      tugmasini bosganda.
// ══════════════════════════════════════════════════════════════

/** So'rov yuborgan sahifaning HAQIQIY origini (spoofing oldini olish). */
function senderOrigin(event) {
  try {
    const url = event?.sender?.getURL?.() || '';
    return passwordStore.normalizeOrigin(url);
  } catch { return ''; }
}

ipcMain.handle('password-list', async () => passwordStore.list());
ipcMain.handle('password-status', async () => passwordStore.status());
ipcMain.handle('password-reveal', async (_, id) => passwordStore.reveal(id));
ipcMain.handle('password-remove', async (_, id) => passwordStore.remove(id));
ipcMain.handle('password-remove-all', async () => passwordStore.removeAll());

// Avtomatik to'ldirish — FAQAT so'rovchi sahifaning o'z origini uchun
ipcMain.handle('password-get-for-origin', async (event) => {
  const origin = senderOrigin(event);
  if (!origin) return [];
  return passwordStore.getForOrigin(origin);
});

ipcMain.handle('password-save', async (event, payload) => {
  // Origin argumentdan EMAS, sahifaning haqiqiy URL'idan olinadi
  const origin = senderOrigin(event) || passwordStore.normalizeOrigin(payload?.origin);
  return passwordStore.save({
    origin,
    username: payload?.username,
    password: payload?.password,
  });
});

ipcMain.handle('password-mark-used', async (_, id) => { passwordStore.markUsed(id); return { ok: true }; });
ipcMain.on('password-never-ask', (event) => {
  const o = senderOrigin(event);
  if (o) passwordStore.setNeverAsk(o);
});
ipcMain.handle('password-is-never-ask', async (event) => passwordStore.isNeverAsk(senderOrigin(event)));

// ── PARENTAL CONTROL IPC (Supabase orqali) ──
ipcMain.handle('parent-add-child', async (_, childEmail) => browserCloud.addChild(childEmail));
ipcMain.handle('parent-verify-code', async (_, { childEmail, code }) => browserCloud.verifyChildCode(childEmail, code));
ipcMain.handle('parent-get-children', async () => browserCloud.getChildren());
ipcMain.handle('parent-revoke-child', async (_, childEmail) => browserCloud.revokeChild(childEmail));
ipcMain.handle('parent-get-alerts', async () => browserCloud.getParentAlerts());
ipcMain.handle('parent-mark-alerts-read', async (_, ids) => browserCloud.markParentAlertsRead(ids));

// FARZAND tomoni: AI bloklaganda ota-onaga signal (block-reporter → bu yerga)
ipcMain.on('parent-control-report-block', (_, payload) => {
  try {
    // O'z activity statistikasiga bloklangan urinishni HAR DOIM yozamiz (§20 blocked_count) —
    //   bu ichki statistika, ota-onaga signal emas.
    try { if (activityStore) activityStore.recordBlocked(); } catch (_) {}

    // OTA-ONAGA SIGNAL — FAQAT farzand ATAYIN qilganda:
    //   (a) searchQuery to'la  → bola harmful narsa QIDIRDI (masalan "hot girl", "1xbet");
    //   (b) reason=domain      → bola harmful saytga ATAY kirdi (xvideos.com va h.k.).
    //   PASSIVE blok (bola qidirmagan — sahifada behayo video avtomatik bloklandi) → SIGNAL YO'Q.
    //   Foydalanuvchi talabi: "atay qidirilganda yuborilsin; xavfsizlik uchun avto-bloklangan
    //   video (atay qidirilmagan) yuborilmasin".
    const q = String(payload?.searchQuery || '').trim();
    const intentional = !!q || /domain|url\s*match/i.test(String(payload?.reason || ''));
    if (!intentional) {
      L('INFO', 'Passive blok (qidiruvsiz) — ota-onaga signal YUBORILMADI:', payload?.category || '?');
      return;
    }
    browserCloud.sendParentAlert({
      category: payload?.category, searchQuery: q,
      url: payload?.url, reason: payload?.reason, device: payload?.device || process.platform,
    }).then((r) => {
      // Server `ok:true` bilan birga `skipped` qaytarishi mumkin — signal
      // YUBORILMAGAN bo'ladi. Ilgari bu jimgina o'tib ketardi va "nega
      // ota-onaga xabar bormadi?" degan savolga javob topib bo'lmasdi.
      if (r && r.skipped) {
        const why = r.skipped === 'no-parent'
          ? 'bu hisobga ulangan ota-ona yo\'q (ehtimol ota-ona profilidan kirilgan)'
          : r.skipped === 'no-account'
            ? 'qurilmaga hech qanday hisob kirmagan'
            : r.skipped;
        L('INFO', 'Parent signal yuborilmadi:', why);
      } else if (r && r.ok) {
        L('OK', 'Parent signal', `${payload?.category || 'unknown'} — ota-onaga yuborildi`);
      } else if (r && r.error) {
        L('WARN', 'Parent signal xatosi:', r.error);
      }
    }).catch((e) => L('WARN', 'Parent signal:', e.message));
  } catch {}
});

// Extensions IPC (legacy custom manager — JSON-based)
ipcMain.handle('extensions-list', async () => EXTENSIONS);
ipcMain.handle('extensions-install', async (_, opts) => {
  return await installExtensionFromUrl(opts && opts.url, opts && opts.name);
});
ipcMain.handle('extensions-uninstall', async (_, id) => {
  return uninstallExtension(id);
});
ipcMain.handle('extensions-toggle', async (_, { id, enabled }) => {
  return toggleExtension(id, enabled);
});

// ============================================================
// CHROME EXTENSION SYSTEM IPC — real Chrome extensions (Manifest V2/V3)
// ============================================================
let chromeExtSystem = null; // app.whenReady da initsializatsiya qilinadi

ipcMain.handle('chrome-ext-list', async () => {
  return chromeExtSystem ? chromeExtSystem.list() : [];
});

ipcMain.handle('chrome-ext-install-unpacked', async (event) => {
  if (!chromeExtSystem) return { ok: false, error: 'System hali tayyor emas' };
  const parentWin = BrowserWindow.fromWebContents(event.sender);
  return await chromeExtSystem.installUnpacked(parentWin);
});

ipcMain.handle('chrome-ext-install-crx', async (_, crxPath) => {
  if (!chromeExtSystem) return { ok: false, error: 'System hali tayyor emas' };
  return await chromeExtSystem.installFromCRX(crxPath);
});

ipcMain.handle('chrome-ext-toggle', async (_, { id, enabled }) => {
  if (!chromeExtSystem) return { ok: false, error: 'System hali tayyor emas' };
  return await chromeExtSystem.setEnabled(id, !!enabled);
});

ipcMain.handle('chrome-ext-uninstall', async (_, id) => {
  if (!chromeExtSystem) return { ok: false, error: 'System hali tayyor emas' };
  return await chromeExtSystem.uninstall(id);
});

ipcMain.handle('chrome-ext-open-popup', async (event, { id, anchor }) => {
  if (!chromeExtSystem) return { ok: false, error: 'System hali tayyor emas' };
  const parentWin = BrowserWindow.fromWebContents(event.sender);
  return chromeExtSystem.openPopup(id, parentWin, anchor);
});

ipcMain.handle('chrome-ext-open-store', async () => {
  try { shell.openExternal('https://chromewebstore.google.com/'); return { ok: true }; }
  catch (e) { return { ok: false, error: e.message }; }
});

ipcMain.handle('notifications-get', async () => {
  loadNotificationsFile();
  return getNotifications();
});

ipcMain.handle('notifications-ack', async (_, ids) => {
  if (!ids) return getNotifications();
  const items = markNotificationsRead(ids);
  broadcastToAll('notifications-updated', items);
  return items;
});

ipcMain.handle('feedback-list', async () => {
  return loadFeedbackList();
});

// ============================================================
// TEMA FAYLLARI — foydalanuvchi fonini DISKKA saqlash
//
// Ilgari fon localStorage'ga base64 sifatida yozilardi. localStorage limiti
// ~5-10 MB, base64 esa faylni ~33% kattalashtiradi — shu sabab sun'iy
// "15 MB" cheklov qo'yilgan edi va video umuman sig'masdi.
// Endi fayl diskka yoziladi, localStorage'da faqat yo'li qoladi.
// ============================================================
const THEMES_DIR = path.join(USER_DATA, 'niex-themes');

ipcMain.handle('theme-file-save', async (_, payload) => {
  try {
    const { data, ext } = payload || {};
    if (!data) return { ok: false, error: 'Fayl bo\'sh' };
    fs.mkdirSync(THEMES_DIR, { recursive: true });
    const safeExt = String(ext || 'bin').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 8) || 'bin';
    const id = 'bg_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 7);
    const file = path.join(THEMES_DIR, `${id}.${safeExt}`);
    fs.writeFileSync(file, Buffer.from(data));
    const stat = fs.statSync(file);
    L('OK', 'Tema foni saqlandi', `${path.basename(file)} (${Math.round(stat.size / 1024 / 1024)} MB)`);
    // file:// URL — renderer to'g'ridan-to'g'ri <img>/<video> src sifatida ishlatadi
    return { ok: true, path: file, url: 'file:///' + file.replace(/\\/g, '/'), size: stat.size };
  } catch (e) {
    L('ERR', 'theme-file-save:', e.message);
    return { ok: false, error: e.message };
  }
});


/* === NIEX Extra IPC Patch v1 === */
// ── QUICKLINKS IPC ──
function getQuicklinksFile() {
  const f = path.join(USER_DATA, 'quicklinks.json');
  try {
    if (!fs.existsSync(f)) return { links: [] };
    return JSON.parse(fs.readFileSync(f, 'utf8'));
  } catch (e) { return { links: [] }; }
}
function saveQuicklinksFile(data) {
  try {
    fs.mkdirSync(USER_DATA, { recursive: true });
    fs.writeFileSync(path.join(USER_DATA, 'quicklinks.json'), JSON.stringify(data, null, 2), 'utf8');
  } catch (e) {}
}
ipcMain.handle('quicklinks-list', async () => {
  return getQuicklinksFile().links || [];
});
ipcMain.handle('quicklinks-set', async (_, links) => {
  if (!Array.isArray(links)) return { ok: false, error: 'Invalid' };
  saveQuicklinksFile({ links, updatedAt: new Date().toISOString() });
  // Barcha oynalarga xabar beramiz
  for (const w of BrowserWindow.getAllWindows()) {
    w.webContents.send('quicklinks-updated', links);
  }
  return { ok: true };
});
ipcMain.handle('quicklinks-add', async (_, link) => {
  const data = getQuicklinksFile();
  const item = {
    id: link.id || ('ql_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2,5)),
    name: String(link.name || '').slice(0, 60),
    url: String(link.url || '').slice(0, 500),
    emoji: String(link.emoji || '🔗').slice(0, 8),
    color: link.color || '#00E5A0',
  };
  data.links.push(item);
  saveQuicklinksFile(data);
  return { ok: true, item };
});
ipcMain.handle('quicklinks-remove', async (_, id) => {
  const data = getQuicklinksFile();
  data.links = data.links.filter(l => l.id !== id);
  saveQuicklinksFile(data);
  return { ok: true };
});

// ── FOCUS EXTRAS (keywords, whitelist, schedules) ──
function getFocusFile(name) {
  const f = path.join(USER_DATA, 'focus-' + name + '.json');
  try {
    if (!fs.existsSync(f)) return { items: [] };
    return JSON.parse(fs.readFileSync(f, 'utf8'));
  } catch (e) { return { items: [] }; }
}
function saveFocusFile(name, data) {
  try {
    fs.mkdirSync(USER_DATA, { recursive: true });
    fs.writeFileSync(path.join(USER_DATA, 'focus-' + name + '.json'), JSON.stringify(data, null, 2), 'utf8');
  } catch (e) {}
}
ipcMain.handle('focus-keywords-get', async () => getFocusFile('keywords').items);
ipcMain.handle('focus-keywords-set', async (_, list) => {
  if (!Array.isArray(list)) return { ok: false };
  saveFocusFile('keywords', { items: list, updatedAt: new Date().toISOString() });
  return { ok: true };
});
ipcMain.handle('focus-whitelist-get', async () => getFocusFile('whitelist').items);
ipcMain.handle('focus-whitelist-set', async (_, list) => {
  if (!Array.isArray(list)) return { ok: false };
  saveFocusFile('whitelist', { items: list, updatedAt: new Date().toISOString() });
  return { ok: true };
});
ipcMain.handle('focus-schedules-get', async () => getFocusFile('schedules').items);
ipcMain.handle('focus-schedules-set', async (_, list) => {
  if (!Array.isArray(list)) return { ok: false };
  saveFocusFile('schedules', { items: list, updatedAt: new Date().toISOString() });
  return { ok: true };
});
ipcMain.handle('focus-blocks-get-full', async () => ({
  categories: blockEngine.getCategories(),
  customDomains: blockEngine.getCustomDomains(),
  keywords: getFocusFile('keywords').items,
  whitelist: getFocusFile('whitelist').items,
  schedules: getFocusFile('schedules').items,
}));

// ── FEEDBACK REPLIES IPC ──
function getRepliesFile() {
  const f = path.join(USER_DATA, 'feedback-replies.json');
  try {
    if (!fs.existsSync(f)) return { replies: [] };
    return JSON.parse(fs.readFileSync(f, 'utf8'));
  } catch (e) { return { replies: [] }; }
}
function saveRepliesFile(data) {
  try {
    fs.mkdirSync(USER_DATA, { recursive: true });
    fs.writeFileSync(path.join(USER_DATA, 'feedback-replies.json'), JSON.stringify(data, null, 2), 'utf8');
  } catch (e) {}
}
ipcMain.handle('feedback-reply-add', async (_, payload) => {
  const data = getRepliesFile();
  const reply = {
    id: 'r_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2,5),
    feedbackId: payload.feedbackId,
    from: payload.from || 'admin',
    message: String(payload.message || ''),
    createdAt: new Date().toISOString(),
  };
  data.replies.push(reply);
  saveRepliesFile(data);
  // Barcha oynalarga xabar beramiz
  for (const w of BrowserWindow.getAllWindows()) {
    w.webContents.send('feedback-reply-received', reply);
  }
  // Foydalanuvchiga notification
  appendNotification({
    title: '📬 Admin javob berdi',
    body: reply.message.slice(0, 120),
    type: 'feedback-reply',
    meta: { feedbackId: reply.feedbackId, replyId: reply.id },
  });
  return { ok: true, reply };
});
ipcMain.handle('feedback-reply-list', async () => getRepliesFile().replies);

// ── NOTIFICATIONS-ACK IPC ──
ipcMain.handle('notifications-mark-read', async (_, ids) => {
  const idList = Array.isArray(ids) ? ids : [ids].filter(Boolean);
  const items = markNotificationsRead(idList);
  return { ok: true, items };
});
/* end  === NIEX Extra IPC Patch v1 === */


ipcMain.handle('theme-file-delete', async (_, filePath) => {
  try {
    if (!filePath) return { ok: true };
    const resolved = path.resolve(String(filePath));
    // Faqat o'z papkamizdagi fayllar o'chiriladi
    if (!resolved.startsWith(path.resolve(THEMES_DIR))) return { ok: false, error: 'Ruxsat yo\'q' };
    if (fs.existsSync(resolved)) fs.unlinkSync(resolved);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

// ============================================================
// PARENT CONTROL IPC
// ============================================================

// Firebase config renderer'ga uzatish (.env dan)
ipcMain.handle('firebase-config-get', () => ({
  apiKey: process.env.FIREBASE_API_KEY || '',
  authDomain: process.env.FIREBASE_AUTH_DOMAIN || '',
  projectId: process.env.FIREBASE_PROJECT_ID || '',
  storageBucket: process.env.FIREBASE_STORAGE_BUCKET || '',
  messagingSenderId: process.env.FIREBASE_MESSAGING_SENDER_ID || '',
  appId: process.env.FIREBASE_APP_ID || '',
}));

// AI Brain (monitor.js) dan kelgan bloklash signali → toolbar counter'ni oshirish.
ipcMain.on('cia-block-increment', () => {
  ST.blockImg++;
  ST.block++;
  broadcastStats();
});

// Child sahifadan kelgan block hodisasini asosiy oynaga (parent control renderer)
// uzatamiz — u Firestore'ga notification yozadi (child o'z uid'i bilan).
ipcMain.on('parent-control-report-block', (event, payload) => {
  try {
    // Barcha window'larga forward qilamiz — safenethome kabi parent control panellari
    // real-time listener bilan bu signalni oladi.
    for (const win of BrowserWindow.getAllWindows()) {
      try {
        for (const bv of win.getBrowserViews()) {
          if (bv.webContents && !bv.webContents.isDestroyed() && bv.webContents !== event.sender) {
            bv.webContents.send('parent-control-block-event', payload);
          }
        }
        if (win.webContents && !win.webContents.isDestroyed() && win.webContents !== event.sender) {
          win.webContents.send('parent-control-block-event', payload);
        }
      } catch {}
    }
  } catch (e) { L('WARN', 'parent-control-report-block:', e.message); }
});

// Parent Control sahifasini ochish (Farzandlarni boshqarish)
ipcMain.on('open-parent-control', (event) => {
  try {
    const parentWin = BrowserWindow.fromWebContents(event.sender) || BrowserWindow.getFocusedWindow();
    const popupUrl = 'file://' + path.join(__dirname, 'parental-control', 'parent-control.html').replace(/\\/g, '/');
    const win = new BrowserWindow({
      width: 960, height: 720, parent: parentWin,
      title: 'Farzandlarni boshqarish',
      icon: NIEX_ICON,
      backgroundColor: '#0F1623',
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        preload: path.join(__dirname, 'preload.js'),
      },
    });
    win.loadURL(popupUrl);
  } catch (e) { L('ERR', 'open-parent-control:', e.message); }
});

ipcMain.on('auth-signout', (e) => {
  AUTH_STORAGE = { profile:null, tokens:null };
  saveAuthFile();
  subscriptionManager.setCurrentAccount(null); // chiqilganda → Free
  broadcastPremiumStatus();
  broadcastFocusState();
});

function broadcastStats() {
  for (const [, w] of wins) {
    try { w.tbv.webContents.send('stats-update', ST); } catch {}
  }
  maybeNotifyUsage(Date.now());
  broadcastFocusState();
}

// ── MENU ──
function buildMenu() {
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    // Menyu sarlavhasida emoji ISHLATILMAYDI — brand ikonasi oyna
    // sarlavhasida (NIEX_ICON) ko'rinadi, menyuda faqat nom turadi.
    { label:'NIEX', submenu:[
      { label:'🏠 Bosh sahifa', click:()=>{ for(const[,w]of wins) w.goHome(); } },
      { label:'🆕 Yangi oyna',  click:()=>createWin('') },
      { label:'📊 Statistika',  click:()=>{
        dialog.showMessageBox({ type:'info', title:'Niex Statistika',
          message:[
            '📊 Niex v8','',
            `🌐 Jami: ${ST.total}`,
            `✅ Ruxsat: ${ST.allow}`,
            `⛔ Blok URL: ${ST.block}`,
            `🖼️  Blok rasm: ${ST.blockImg}`,
            `🤖 AI so'rov: ${ST.ai}`,
            `⏱️  ${Math.floor((Date.now()-ST.t0)/60000)} daqiqa`
          ].join('\n')
        });
      }},
      { type:'separator' },
      { role:'quit', label:'Chiqish' },
    ]},
    { label:"Ko'rinish", submenu:[
      { role:'reload' },
      { label:'Toggle Developer Tools', accelerator:'F12', click:(_i, bw) => {
        try {
          const w = bw && wins.get(bw.id); const t = w && w.getActiveTab();
          if (!t) return;
          const wc = t.view.webContents;
          if (wc.isDevToolsOpened()) wc.closeDevTools();
          else wc.openDevTools({ mode:'detach' });
        } catch (e) { console.warn('DevTools open failed:', e && e.message); }
      } },
      { type:'separator' },
      { role:'zoomIn' }, { role:'zoomOut' }, { role:'resetZoom' },
    ]},
  ]));
}

// ── FEEDBACK + NOTIFICATIONS API SERVER ──
const FEEDBACK_DIR = path.join(USER_DATA, 'feedback');
const NOTIFICATIONS_FILE = path.join(USER_DATA, 'notifications.json');
let NOTIFICATIONS = [];

function ensureFeedbackDir() { try { fs.mkdirSync(FEEDBACK_DIR, { recursive: true }); } catch (e) {} }
function ensureNotificationsFile() {
  try {
    if (!fs.existsSync(NOTIFICATIONS_FILE)) {
      fs.writeFileSync(NOTIFICATIONS_FILE, JSON.stringify([], null, 2), 'utf8');
    }
  } catch (e) {}
}

function loadNotificationsFile() {
  try {
    ensureNotificationsFile();
    NOTIFICATIONS = JSON.parse(fs.readFileSync(NOTIFICATIONS_FILE, 'utf8')) || [];
  } catch (e) {
    NOTIFICATIONS = [];
  }
}

function saveNotificationsFile() {
  try {
    fs.writeFileSync(NOTIFICATIONS_FILE, JSON.stringify(NOTIFICATIONS, null, 2), 'utf8');
  } catch (e) {}
}

function appendNotification(notification) {
  const item = Object.assign({
    id: crypto.randomBytes(8).toString('hex'),
    title: notification.title || 'New notification',
    body: notification.body || '',
    type: notification.type || 'feedback',
    createdAt: new Date().toISOString(),
    read: false,
    meta: notification.meta || {}
  }, notification);

  NOTIFICATIONS.unshift(item);
  if (NOTIFICATIONS.length > 200) NOTIFICATIONS = NOTIFICATIONS.slice(0, 200);
  saveNotificationsFile();
  broadcastToAll('notifications-updated', NOTIFICATIONS);
}

function getNotifications() {
  return NOTIFICATIONS.slice();
}

function markNotificationsRead(ids = []) {
  if (!Array.isArray(ids)) ids = [ids];
  let changed = false;
  for (const note of NOTIFICATIONS) {
    if (ids.includes(note.id) && !note.read) {
      note.read = true;
      changed = true;
    }
  }
  if (changed) saveNotificationsFile();
  return getNotifications();
}

function loadFeedbackList() {
  ensureFeedbackDir();
  try {
    const items = fs.readdirSync(FEEDBACK_DIR)
      .filter(f => f.endsWith('.json'))
      .map(file => {
        try {
          const data = JSON.parse(fs.readFileSync(path.join(FEEDBACK_DIR, file), 'utf8'));
          return data;
        } catch (_) { return null; }
      })
      .filter(Boolean)
      .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
    return items;
  } catch (e) {
    return [];
  }
}

const feedbackServer = http.createServer((req, res) => {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Content-Type', 'application/json');

  if (req.method === 'OPTIONS') {
    res.writeHead(200);
    res.end();
    return;
  }

  if (req.method === 'POST' && (req.url === '/api/feedback' || req.url === '/feedback')) {
    let body = '';
    req.on('data', chunk => { body += chunk.toString(); });
    req.on('end', () => {
      try {
        const feedbackData = JSON.parse(body);
        const feedbackId = crypto.randomBytes(8).toString('hex');
        const feedbackFile = path.join(FEEDBACK_DIR, `feedback_${Date.now()}_${feedbackId}.json`);
        
        const feedbackObj = {
          id: feedbackId,
          timestamp: feedbackData.timestamp || new Date().toISOString(),
          email: feedbackData.email || 'anonymous@niex.local',
          text: feedbackData.text || '',
          hasImage: !!feedbackData.image,
          userAgent: feedbackData.userAgent || '',
          imageSize: feedbackData.image ? feedbackData.image.length : 0
        };

        if (feedbackData.image) {
          const imageFile = path.join(FEEDBACK_DIR, `image_${feedbackId}.base64`);
          fs.writeFileSync(imageFile, feedbackData.image, 'utf8');
        }

        fs.writeFileSync(feedbackFile, JSON.stringify(feedbackObj, null, 2), 'utf8');
        appendNotification({
          title: 'Yangi feedback',
          body: feedbackObj.text.slice(0, 120) || 'Fikr-mulohaza olishdi',
          type: 'feedback',
          meta: { feedbackId }
        });

        // BULUTGA forward — admin panel "Feedback" bo'limiga tushadi (Lovable sayt)
        try {
          browserCloud.submitFeedback({
            title: 'Brauzer feedback',
            description: feedbackObj.text || '(matnsiz)',
            category: 'general',
            priority: 'medium',
            metadata: { email: feedbackObj.email, source: 'narimon-browser' },
          });
        } catch {}

        L('📬', 'Feedback:', feedbackObj.email + ' - ' + feedbackObj.text.slice(0, 40));

        res.writeHead(200);
        res.end(JSON.stringify({ ok: true, id: feedbackId }));
      } catch (e) {
        L('ERR', 'Feedback:', e.message);
        res.writeHead(400);
        res.end(JSON.stringify({ ok: false, error: e.message }));
      }
    });
    return;
  }

  if (req.method === 'GET' && (req.url === '/api/feedback' || req.url === '/feedback')) {
    const items = loadFeedbackList();
    res.writeHead(200);
    res.end(JSON.stringify({ ok: true, items }));
    return;
  }

  if (req.method === 'GET' && req.url === '/api/notifications') {
    res.writeHead(200);
    res.end(JSON.stringify({ ok: true, items: getNotifications() }));
    return;
  }

  // AI GATEWAY DASHBOARD — Lovable admin panel shu endpointdan provayder holatini o'qiydi.
  //   Provayderlar, kalit qoldig'i, so'rovlar, response time, xatolar, oxirgi loglar.
  if (req.method === 'GET' && req.url === '/api/ai-gateway/stats') {
    res.writeHead(200);
    try { res.end(JSON.stringify({ ok: true, ...aiGateway.getStats() })); }
    catch (e) { res.end(JSON.stringify({ ok: false, error: e.message })); }
    return;
  }

  // ══════════════════════════════════════════════════
  // PREMIUM — ADMIN API (Lovable admin panel shu endpointlar bilan ishlaydi)
  // ══════════════════════════════════════════════════
  const purl = new URL(req.url, 'http://localhost:13337');

  // To'lov so'rovlari ro'yxati (filtr, qidiruv, pagination)
  if (req.method === 'GET' && purl.pathname === '/api/premium/requests') {
    const out = paymentStore.list({
      status: purl.searchParams.get('status') || 'all',
      q: purl.searchParams.get('q') || '',
      page: parseInt(purl.searchParams.get('page') || '1', 10),
      pageSize: parseInt(purl.searchParams.get('pageSize') || '20', 10),
    });
    res.writeHead(200);
    res.end(JSON.stringify({ ok: true, ...out, stats: paymentStore.stats() }));
    return;
  }

  // Skrinshot rasmini ko'rsatish (admin preview)
  if (req.method === 'GET' && purl.pathname.startsWith('/api/premium/screenshot/')) {
    const id = purl.pathname.split('/').pop();
    const p = paymentStore.screenshotPath(id);
    if (!p) { res.writeHead(404); res.end('Not found'); return; }
    try {
      const buf = fs.readFileSync(p);
      const ext = path.extname(p).slice(1).replace('jpg', 'jpeg');
      res.writeHead(200, { 'Content-Type': `image/${ext}` });
      res.end(buf);
    } catch { res.writeHead(500); res.end('err'); }
    return;
  }

  // To'lov statistikasi
  if (req.method === 'GET' && purl.pathname === '/api/premium/stats') {
    res.writeHead(200);
    res.end(JSON.stringify({ ok: true, ...paymentStore.stats(), subscription: subscriptionManager.serialize() }));
    return;
  }

  // TASDIQLASH — Pro faollashtiriladi, browser DARHOL yangilanadi (restart yo'q)
  if (req.method === 'POST' && purl.pathname === '/api/premium/approve') {
    let body = '';
    req.on('data', c => { body += c.toString(); });
    req.on('end', () => {
      try {
        const { id, months } = JSON.parse(body || '{}');
        const dec = paymentStore.decide(id, 'approve', { by: 'admin' });
        if (!dec.ok) { res.writeHead(400); res.end(JSON.stringify(dec)); return; }
        const act = subscriptionManager.activatePro({ months: months || 1, paymentId: id });
        appendNotification({ title: '🎉 Premium faollashtirildi!', body: 'Tabriklaymiz! Pro obuna faollashdi. Barcha imkoniyatlar ochildi.', type: 'premium', meta: { paymentId: id } });
        broadcastPremiumStatus();
        L('OK', 'PREMIUM APPROVED', `${dec.request.email} — Pro ${act.expiresAt?.slice(0,10)}`);
        res.writeHead(200);
        res.end(JSON.stringify({ ok: true, request: dec.request, subscription: subscriptionManager.serialize() }));
      } catch (e) { res.writeHead(400); res.end(JSON.stringify({ ok: false, error: e.message })); }
    });
    return;
  }

  // RAD ETISH — Free qoladi, foydalanuvchiga bildirishnoma
  if (req.method === 'POST' && purl.pathname === '/api/premium/reject') {
    let body = '';
    req.on('data', c => { body += c.toString(); });
    req.on('end', () => {
      try {
        const { id, reason } = JSON.parse(body || '{}');
        const dec = paymentStore.decide(id, 'reject', { by: 'admin', reason: reason || '' });
        if (!dec.ok) { res.writeHead(400); res.end(JSON.stringify(dec)); return; }
        appendNotification({ title: 'To\'lov tasdiqlanmadi', body: (reason || 'To\'lov tekshiruvidan o\'tmadi. Iltimos qayta urinib ko\'ring yoki biz bilan bog\'laning.'), type: 'premium', meta: { paymentId: id } });
        broadcastPremiumStatus();
        L('OK', 'PREMIUM REJECTED', dec.request.email);
        res.writeHead(200);
        res.end(JSON.stringify({ ok: true, request: dec.request }));
      } catch (e) { res.writeHead(400); res.end(JSON.stringify({ ok: false, error: e.message })); }
    });
    return;
  }

  if (req.method === 'POST' && req.url === '/api/notifications') {
    let body = '';
    req.on('data', chunk => { body += chunk.toString(); });
    req.on('end', () => {
      try {
        const data = JSON.parse(body);
        appendNotification({
          title: data.title || 'New notification',
          body: data.body || '',
          type: data.type || 'system',
          meta: data.meta || {}
        });
        res.writeHead(200);
        res.end(JSON.stringify({ ok: true }));
      } catch (e) {
        res.writeHead(400);
        res.end(JSON.stringify({ ok: false, error: e.message }));
      }
    });
    return;
  }

  if (req.method === 'POST' && req.url === '/api/notifications/ack') {
    let body = '';
    req.on('data', chunk => { body += chunk.toString(); });
    req.on('end', () => {
      try {
        const data = JSON.parse(body);
        const ids = Array.isArray(data.ids) ? data.ids : [data.id].filter(Boolean);
        const items = markNotificationsRead(ids);
        res.writeHead(200);
        res.end(JSON.stringify({ ok: true, items }));
      } catch (e) {
        res.writeHead(400);
        res.end(JSON.stringify({ ok: false, error: e.message }));
      }
    });
    return;
  }

  /* === NIEX Extra IPC Patch v1 === */
  // ── QUICKLINKS HTTP API ──
if (req.method === 'GET' && purl.pathname === '/api/quicklinks') {
  try {
    const f = path.join(USER_DATA, 'quicklinks.json');
    if (!fs.existsSync(f)) { res.writeHead(200); res.end(JSON.stringify({ ok: true, items: [] })); return; }
    const data = JSON.parse(fs.readFileSync(f, 'utf8'));
    res.writeHead(200); res.end(JSON.stringify({ ok: true, items: data.links || [] }));
  } catch (e) { res.writeHead(200); res.end(JSON.stringify({ ok: true, items: [] })); }
  return;
}
if (req.method === 'POST' && purl.pathname === '/api/quicklinks') {
  let body = '';
  req.on('data', c => { body += c.toString(); });
  req.on('end', () => {
    try {
      const { items } = JSON.parse(body || '{}');
      saveQuicklinksFile({ links: items || [], updatedAt: new Date().toISOString() });
      res.writeHead(200); res.end(JSON.stringify({ ok: true }));
    } catch (e) { res.writeHead(400); res.end(JSON.stringify({ ok: false, error: e.message })); }
  });
  return;
}

// ── FEEDBACK REPLIES HTTP ──
if (req.method === 'GET' && purl.pathname === '/api/feedback-replies') {
  try {
    const f = path.join(USER_DATA, 'feedback-replies.json');
    if (!fs.existsSync(f)) { res.writeHead(200); res.end(JSON.stringify({ ok: true, replies: [] })); return; }
    const data = JSON.parse(fs.readFileSync(f, 'utf8'));
    res.writeHead(200); res.end(JSON.stringify({ ok: true, replies: data.replies || [] }));
  } catch (e) { res.writeHead(200); res.end(JSON.stringify({ ok: true, replies: [] })); }
  return;
}
if (req.method === 'POST' && purl.pathname === '/api/feedback-replies') {
  let body = '';
  req.on('data', c => { body += c.toString(); });
  req.on('end', () => {
    try {
      const payload = JSON.parse(body || '{}');
      const data = getRepliesFile();
      const reply = {
        id: 'r_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2,5),
        feedbackId: payload.feedbackId,
        from: payload.from || 'admin',
        message: String(payload.message || ''),
        createdAt: new Date().toISOString(),
      };
      data.replies.push(reply);
      saveRepliesFile(data);
      // Barcha oynalarga xabar
      for (const w of BrowserWindow.getAllWindows()) {
        w.webContents.send('feedback-reply-received', reply);
      }
      appendNotification({
        title: '📬 Admin javob berdi',
        body: reply.message.slice(0, 120),
        type: 'feedback-reply',
        meta: { feedbackId: reply.feedbackId, replyId: reply.id },
      });
      res.writeHead(200); res.end(JSON.stringify({ ok: true, reply }));
    } catch (e) { res.writeHead(400); res.end(JSON.stringify({ ok: false, error: e.message })); }
  });
  return;
}

// ── FOCUS EXTRAS HTTP ──
if (req.method === 'GET' && (purl.pathname === '/api/focus/keywords' || purl.pathname === '/api/focus/whitelist' || purl.pathname === '/api/focus/schedules')) {
  const section = purl.pathname.split('/').pop();
  const f = path.join(USER_DATA, 'focus-' + section + '.json');
  if (!fs.existsSync(f)) { res.writeHead(200); res.end(JSON.stringify({ ok: true, items: [] })); return; }
  try {
    const data = JSON.parse(fs.readFileSync(f, 'utf8'));
    res.writeHead(200); res.end(JSON.stringify({ ok: true, items: data.items || [] }));
  } catch { res.writeHead(200); res.end(JSON.stringify({ ok: true, items: [] })); }
  return;
}
if (req.method === 'POST' && (purl.pathname === '/api/focus/keywords' || purl.pathname === '/api/focus/whitelist' || purl.pathname === '/api/focus/schedules')) {
  const section = purl.pathname.split('/').pop();
  let body = '';
  req.on('data', c => { body += c.toString(); });
  req.on('end', () => {
    try {
      const { items } = JSON.parse(body || '{}');
      saveFocusFile(section, { items: items || [], updatedAt: new Date().toISOString() });
      res.writeHead(200); res.end(JSON.stringify({ ok: true }));
    } catch (e) { res.writeHead(400); res.end(JSON.stringify({ ok: false, error: e.message })); }
  });
  return;
}
  /* end  === NIEX Extra IPC Patch v1 === */

  res.writeHead(404);
  res.end(JSON.stringify({ ok: false, error: 'Not found' }));
});


// ── APP ──
app.whenReady().then(() => {
  // PAROL OMBORI — shu yerda ishga tushadi, chunki `safeStorage` ilova
  // tayyor bo'lgunicha shifrlash mavjudligini `false` deb qaytaradi.
  // Windows'da DPAPI, macOS'da Keychain, Linux'da libsecret ishlatiladi.
  try {
    const { safeStorage } = require('electron');
    passwordStore.init({ userDataDir: USER_DATA, safeStorage, logger: L });
  } catch (e) { L('WARN', 'Parol ombori init:', e.message); }

  // Register custom URL scheme for Google OAuth (Desktop App standard)
  // Configure in Google Cloud Console: com.niex.browser:/oauth2redirect
  if (process.defaultApp) {
    if (process.argv.length >= 2) {
      app.setAsDefaultProtocolClient('com.niex.browser', process.execPath, [path.resolve(process.argv[1])]);
    }
  } else {
    app.setAsDefaultProtocolClient('com.niex.browser');
  }

  buildMenu();
  ensureExtDir();
  ensureFeedbackDir();
  ensureNotificationsFile();
  loadNotificationsFile();
  saveExtensionsFile();

  // Set About Panel Options to remove Electron branding
  if (app.setAboutPanelOptions) {
    app.setAboutPanelOptions({
      applicationName: 'NIEX Browser',
      applicationVersion: '1.0.0',
      copyright: 'Copyright © 2026 NIEX Ecosystem',
      authors: ['NIEX Team'],
      website: 'https://niex.uz',
      iconPath: NIEX_ICON
    });
  }

  // CSP HEADER STRIP + CORS BYPASS
  // ============================================================
  // 1. CSP strip — nsfwjs.load() ichida fetch() ishlashi uchun
  // 2. CORS bypass — Instagram/TikTok/Twitter CDN rasmlarni NSFW.js
  //    tahlil qila olishi uchun (ular Access-Control-Allow-Origin bermaydi)
  //    Bu tainted canvas muammosini yechadi va tf.browser.fromPixels ishlaydi.
  try {
    const { session: mainSession } = require('electron');

    // CREDENTIALED SO'ROVLARNI AJRATISH (ikki bug bir vaqtda hal bo'ladi):
    //
    //  • AI'ning fetch'i (loader.ts, credentials:'omit') → Cookie YO'Q →
    //    CORS beramiz → canvas toza → tahlil ishlaydi → BLOKLASH ishlaydi.
    //    (Aks holda BUGS_REPORT "BUG 2": canvas CORS xatosi → bloklanmaydi.)
    //
    //  • Saytning o'z fetch'i (YouTube ikonkalari) → Cookie BOR →
    //    TEGMAYMIZ. Credentialed so'rovda `ACAO: *` ni brauzer RAD etadi →
    //    ikonka/tugmalar ko'rinmay qoladi.
    //
    // rt==='image' (oddiy <img>) har doim xavfsiz: crossOrigin'siz <img> CORS
    // sarlavhalarini umuman e'tiborga olmaydi.
    // Voice Agent — mikrofon ruxsati. Ilgari permission handler yo'q edi; qo'shamiz
    // (ba'zi Electron versiyalari handler bo'lmasa 'media'ni rad etadi → mic ishlamaydi).
    // Boshqa ruxsatlar avvalgi (default) xatti-harakatdek beriladi — regressiya yo'q.
    try {
      mainSession.defaultSession.setPermissionRequestHandler((wc, permission, callback) => {
        callback(true); // media/microphone + qolganlari (avvalgidek)
      });
    } catch (e) { try { L('WARN', 'permission handler:', e.message); } catch (_) {} }

    const uncredentialed = new Set();
    mainSession.defaultSession.webRequest.onBeforeSendHeaders((details, callback) => {
      try {
        const h = details.requestHeaders || {};
        const hasCookie = Object.keys(h).some(k => k.toLowerCase() === 'cookie');
        if (hasCookie) uncredentialed.delete(details.id);
        else uncredentialed.add(details.id);
        if (uncredentialed.size > 3000) uncredentialed.clear(); // xotira himoyasi
        // Sec-CH-UA'ni TOZA Chrome qilamiz (Electron brand'ini yashiramiz) — faqat mavjud
        //   bo'lganда almashtiramiz, yo'q joyga QO'SHMAYMIZ. Google OAuth embedded blokidan qochish.
        let hasClientData = false;
        for (const k of Object.keys(h)) {
          const lk = k.toLowerCase();
          if (lk === 'sec-ch-ua') h[k] = SEC_CH_UA;
          else if (lk === 'sec-ch-ua-full-version-list') h[k] = SEC_CH_UA_FULL;
          else if (lk === 'sec-ch-ua-full-version') h[k] = `"${_CH_VER}"`;
          else if (lk === 'sec-ch-ua-platform') h[k] = _CH_PLATFORM;
          else if (lk === 'x-client-data') hasClientData = true;
        }
        // X-Client-Data — FAQAT Google domenlariga (maxfiylik: boshqa saytga leak yo'q).
        //   Chrome bu imzoni Google saytlariga yuboradi; Electron yubormaydi → embedded
        //   ishorasi. Qo'shib Google blokini yumshatishga urinamiz (kafolatsiz).
        try {
          const host = new URL(details.url).hostname;
          if (!hasClientData && _GOOGLE_HOST_RX.test(host)) h['X-Client-Data'] = X_CLIENT_DATA;
        } catch {}
      } catch {}
      callback({ requestHeaders: details.requestHeaders });
    });

    mainSession.defaultSession.webRequest.onHeadersReceived((details, callback) => {
      const headers = details.responseHeaders || {};
      const rt = details.resourceType; // 'image' | 'media' | 'xhr' | 'mainFrame' | ...

      // 1. CSP strip — FAQAT hujjat/frame javoblarida (nsfwjs model + inject skript).
      //    Media/xhr CSP'siga tegmaymiz.
      //    ⚠️ CAPTCHA / auth frame'lariga TEGMAYMIZ — ular xavfsizlik uchun CSP'ga
      //    tayanadi; olib tashlasak login/CAPTCHA buzilishi mumkin. Bizga u
      //    frame'larda inject ham kerak emas.
      const AUTH_FRAME_RX = /(^|\.)(recaptcha\.net|gstatic\.com\/recaptcha|google\.com\/recaptcha|accounts\.google\.com|challenges\.cloudflare\.com|hcaptcha\.com)/i;
      const isAuthFrame = (() => { try { return AUTH_FRAME_RX.test(new URL(details.url).host + new URL(details.url).pathname); } catch { return false; } })();
      if ((rt === 'mainFrame' || rt === 'subFrame') && !isAuthFrame) {
        for (const k of Object.keys(headers)) {
          const kl = k.toLowerCase();
          if (kl === 'content-security-policy' || kl === 'content-security-policy-report-only' || kl === 'x-content-security-policy') {
            delete headers[k];
          }
        }
      }

      // 2. CORS override:
      //    a) rt==='image' — har doim xavfsiz: crossOrigin'siz <img> CORS
      //       sarlavhalarini e'tiborga olmaydi; crossOrigin='anonymous' <img> esa
       //       shu tufayli ishlaydi.
      //    b) cookie'SIZ xhr/fetch — bu AI'ning rasm yuklashi (credentials:'omit').
      //       CORS bermasak canvas TAINTED bo'ladi -> tahlil o'ladi -> BLOKLASH O'LADI
      //       (BUGS_REPORT "BUG 2": canvas CORS xatosi -> bloklanmaydi).
      //    Cookie'LI so'rovlarga TEGMAYMIZ: credentialed so'rovda brauzer
      //    `ACAO: *` ni rad etadi -> YouTube ikonka/tugmalari ko'rinmay qoladi.
      //
      //    ⚠️ TOR bo'lishi SHART. AI FAQAT RASM yuklaydi. Agar cookie'siz har qanday
      //    xhr'ga tegsak — reCAPTCHA/auth so'rovlari ham cookie'siz bo'ladi va biz
      //    ularning haqiqiy ACAO'sini `*` ga almashtiramiz. Javobda
      //    `Access-Control-Allow-Credentials: true` bo'lsa, brauzer `*` ni RAD etadi
      //    → CAPTCHA qayta-qayta so'raydi, login ishlamaydi. Shuning uchun:
      //    faqat Content-Type: image/* VA ACAC yo'q bo'lgan javoblar.
      let ctIsImage = false, hasACAC = false;
      for (const k of Object.keys(headers)) {
        const kl = k.toLowerCase();
        if (kl === 'content-type' && String(headers[k]?.[0] || '').toLowerCase().startsWith('image/')) ctIsImage = true;
        else if (kl === 'access-control-allow-credentials') hasACAC = true;
      }
      const isAiFetch = (rt === 'xhr' || rt === 'other')
        && uncredentialed.has(details.id) && ctIsImage && !hasACAC;
      uncredentialed.delete(details.id);
      if (rt === 'image' || isAiFetch) {
        for (const k of Object.keys(headers)) {
          const kl = k.toLowerCase();
          if (kl === 'access-control-allow-origin' || kl === 'cross-origin-resource-policy' || kl === 'timing-allow-origin') {
            delete headers[k];
          }
        }
        headers['Access-Control-Allow-Origin'] = ['*'];
        headers['Cross-Origin-Resource-Policy'] = ['cross-origin'];
        headers['Timing-Allow-Origin'] = ['*'];
      }

      callback({ responseHeaders: headers });
    });
    L('OK', 'CSP+CORS bypass', 'faol — FAQAT rt=image (xhr/fetch tegilmaydi)');
  } catch(e) { L('WARN', 'CSP/CORS:', e.message); }

  // AI GATEWAY — Provider Manager'ni ishga tushirish (30+ kalit, D:\ai apis.txt).
  //   Local AI birinchi; faqat ishonchsiz kontent shu Gateway orqali cloud'ga boradi.
  // AI Gateway — cloud proxy orqali ishlaydi (kalitlar Supabase secrets'da).
  // `authContextProvider` faqat brauzer tokenini beradi, AI kaliti emas.
  try {
    aiGateway.init(L, { authContextProvider: () => browserCloud.getAuthContext() });
  } catch(e) { L('WARN', 'AI Gateway init:', e.message); }

  // BROWSER CLOUD — Lovable bulut (Supabase) bilan ulanish.
  //   Qurilma ro'yxati (Connected Browsers), feedback → admin, admin javobi → qo'ng'iroq.
  try {
    browserCloud.init({
      userDataDir: USER_DATA,
      logger: L,
      notify: (n) => { try { appendNotification(n); } catch {} },
      // Bulut obuna statusi o'zgarsa — local Pro'ni moslash (admin tasdiqlasa faollashadi)
      onSub: (sub) => {
        try {
          if (!sub) { L('WARN', 'PREMIUM', 'bulutdan bo\'sh sub keldi'); return; }
          _cloudSub = sub;
          const myEmail = (AUTH_STORAGE?.profile?.email || _localAccountEmail || '').toLowerCase();
          const subEmail = (sub.account_email || '').toLowerCase();
          // FAOLLASHTIRISH HISOBI: joriy login bo'lsa o'sha; bo'lmasa cloud aytgan subEmail.
          //   MUHIM: Google login email disk'da (AUTH_FILE) bo'sh bo'lishi mumkin (faqat renderer'да) —
          //   shundа myEmail app start'да bo'sh bo'lardi va Pro FAOLLASHMASDI (premium tugmasini
          //   bosmaguncha). Cloud esa Pro QAYSI emailга tegishlиligini biladi (subEmail, backend
          //   auth-token bilan himoyalangan — ishonchli). Shu bilan avtomatik faollashtiramiz.
          const activateEmail = myEmail || subEmail;
          // Mos kelish sharti: ikkovi ham bor bo'lsa TENG bo'lishi shart; biri bo'sh bo'lsa — ok.
          const emailOk = !!activateEmail && (!myEmail || !subEmail || subEmail === myEmail);
          const activeLike = sub.status === 'active' || sub.status === 'approved';
          const proLike = !sub.plan || sub.plan === 'pro'; // plan qaytmasa ham status ustuvor
          L('👑', 'PREMIUM sub keldi:', `status=${sub.status} plan=${sub.plan || '?'} subEmail=${subEmail || '?'} myEmail=${myEmail || '?'} → activate=${activateEmail || '?'} emailOk=${emailOk} activeLike=${activeLike}`);
          if (sub.status === 'inactive' || sub.status === 'expired' || sub.status === 'rejected') {
            try {
              const em = activateEmail;
              const p = em && paymentStore.requests.find(r => r.email === em && r.status === 'pending');
              if (p) { paymentStore.decide(p.id, 'reject', { by: 'cloud', reason: 'Admin rad etdi' }); }
            } catch {}
          }
          if (activeLike && proLike && emailOk) {
            // subscriptionManager account'ni bilishi shart — aks holda activatePro rad etadi.
            try { subscriptionManager.setCurrentAccount(activateEmail); } catch (_) {}
            if (subscriptionManager.serialize().planId !== 'pro') {
              const r = subscriptionManager.activatePro({ months: 1, paymentId: sub.last_payment_id || null });
              L('👑', 'PREMIUM', r && r.ok ? 'FAOL (' + activateEmail + ')' : 'activatePro RAD ETDI: ' + (r && r.error));
            } else { L('👑', 'PREMIUM', 'allaqachon Pro'); }
          } else if ((sub.status === 'expired' || sub.status === 'inactive') && subscriptionManager.serialize().planId === 'pro') {
            subscriptionManager.downgradeToFree(sub.status);
            L('👑', 'PREMIUM', 'bulut: obuna tugadi → Free');
          } else if (activeLike && !emailOk) {
            L('WARN', 'PREMIUM', 'subEmail (' + subEmail + ') myEmail (' + myEmail + ') ga MOS EMAS — Pro faollashtirilmaydi');
          }
          broadcastPremiumStatus();
        } catch(e) { L('WARN', 'onSub:', e.message); }
      },
    });
  } catch(e) { L('WARN', 'Browser cloud init:', e.message); }

  // Startup'da joriy hisobni bulutga bildirish (ota-ona farzandni email orqali topishi uchun)
  setTimeout(() => {
    try {
      const em = AUTH_STORAGE?.profile?.email || _localAccountEmail;
      if (em) browserCloud.reportAccount(em, AUTH_STORAGE?.profile?.name || '');
    } catch {}
  }, 8000);

  // ACTIVITY INTELLIGENCE — kunlik aggregate'ni bulutga davriy sync (§4/§19 batch).
  // Offline bo'lsa dirty-day saqlanadi, keyingi urinishda yuboriladi (§20).
  setInterval(syncActivityToCloud, 2 * 60 * 1000);
  setTimeout(syncActivityToCloud, 25000);

  createWin('');

  // Boshqa brauzerlarni KUZATISH (ota-ona alert) + birinchi ishga tushishда onboarding tavsiya.
  try { startOtherBrowserWatch(); } catch (e) { L('WARN', 'browser watch:', e.message); }
  setTimeout(() => { try { showBrowserOnboarding(); } catch (_) {} }, 3500);

  // AUTO-UPDATE — paketlangan ilovada niex-releases'дан yangilanishni tekshiradi.
  try { setupAutoUpdate(); } catch (e) { L('WARN', 'auto-update:', e.message); }

  // Initialize ExtensionManager (legacy custom manager)
  extensionManager = new ExtensionManager(EXT_DIR, { log: L });
  subscriptionManager = new SubscriptionManager({ storagePath: SUBSCRIPTION_FILE });
  usageManager = new UsageManager({ subscriptionManager, storagePath: USAGE_FILE, secret: process.env.SAFENET_USAGE_SECRET || 'safenet-usage-v1' });
  blockEngine = new BlockEngine({ storagePath: FOCUS_BLOCKS_FILE });
  focusScheduler = new FocusScheduler();
  focusSettingsManager = new SettingsManager({ storagePath: FOCUS_SETTINGS_FILE });
  focusStatisticsManager = new StatisticsManager({ storagePath: FOCUS_STATS_FILE });
  focusNotificationManager = new NotificationManager({ emit: (notification) => appendNotification({ title: 'Focus', body: notification.message, type: 'focus', meta: notification.meta || {} }) });
  focusManager = new FocusManager({ subscriptionManager, blockEngine, scheduler: focusScheduler, storagePath: FOCUS_STATE_FILE, onChange: () => { try { broadcastFocusState(); } catch (_) {} } });
  activityStore = new ActivityStore({ storagePath: ACTIVITY_FILE });
  activityAccountant = createAccountant({ store: activityStore, classify: ContentClassifier.classify, maxGapMs: 30000 });
  // PART 2 — NIEX'dan chiqishni kuzatuvchi (faqat bir marta ulanadi).
  initFocusExitMonitor();
  const initialExtensions = extensionManager.loadAllExtensions();
  EXTENSIONS = extensionManager.listExtensions();
  L('EXT', `Loaded ${initialExtensions.length} legacy extensions`);

  // Initialize Chrome Extension System (real Chrome extensions)
  try {
    chromeExtSystem = new ChromeExtensionSystem(USER_DATA, { log: console.log, icon: NIEX_ICON });
    chromeExtSystem.loadAllOnStartup().then(count => {
      L('CHROME-EXT', `Startup: ${count} Chrome extension yuklandi`);
    }).catch(e => L('WARN', 'Chrome ext startup:', e.message));
  } catch (e) {
    L('ERR', 'ChromeExtensionSystem init:', e.message);
  }

  // Feedback server ishga tushir
  feedbackServer.on('error', (e) => {
    L('ERR', 'Feedback API server error:', e.message);
  });
  feedbackServer.listen(13337, 'localhost', () => {
    L('OK', 'Feedback API', 'localhost:13337 da faol');
  });

  // Auto-update: 5 soniya keyin fon da tekshirish
  setTimeout(() => {
    autoUpdateScripts().catch(e => L('WARN','Auto-update xatosi:', e.message));
  }, 5000);

  // Har 6 soatda qayta tekshirish
  setInterval(() => {
    autoUpdateScripts().catch(() => {});
  }, 6 * 60 * 60 * 1000);
  console.log('\n' + '█'.repeat(50));
  console.log('  🛡️  Niex Brauzer v8');
  console.log('  ✅ YouTube / DDG / Barcha sayt filtri');
  console.log('  ✅ AI: URL + sahifa matni + rasm');
  console.log('  ✅ Multi-window (yangi oyna)');
  console.log('█'.repeat(50) + '\n');
});

// Ilova yopilishidan oldin — kutayotgan activity segmentini va storeni saqlaymiz.
app.on('before-quit', () => { try { flushActivitySeg(); if (activityStore) activityStore.flush(); } catch (_) {} });
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWin(''); });