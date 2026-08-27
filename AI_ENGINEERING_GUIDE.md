# Niex — AI Engineering Guide

**Read this file completely before writing a single line of code.**

This is not a style guide. It is a record of how this project has actually broken,
written by an AI that broke it. Every rule below exists because ignoring it cost
the founder hours. If you are an AI assistant working on Niex, this document
defines the standard of work expected of you.

---

## 0. The one-paragraph summary

Niex is a child-safe AI browser. Its whole value is: **block confirmed harmful
content, never touch anything else.** The project has one recurring failure mode:
an assistant "fixes" the blocker, ships it without verifying, and the browser
swings from *blocking nothing* to *breaking every site*. The founder has seen this
cycle many times and is rightly tired of it. Your job is to break the cycle: find
root causes, prove your fix with evidence, and never claim something works that
you have not actually observed working.

---

## 1. The standard of thinking (this is the point of this file)

### 1.1 Never guess. Find the root cause.

The founder's rule: **"Before patch: Root Cause Analysis (no guessing)."**

Bad: *"The thumbnails aren't blocked — let me lower the threshold."*
Good: *"Let me add a diagnostic log that prints the model's score for the images
that are passing, run it, and see the real number before changing anything."*

Symptoms lie. Two real examples from this project:

- **"AI blocks nothing."** The obvious theory was "thresholds too high." The
  actual cause was that the NSFW model never loaded — the weight files were
  missing. Every threshold change was noise for days.
- **"YouTube buttons are invisible."** The obvious theory was "the blocker is
  hiding them." The counter-evidence was in the log the whole time: `0 blocked`.
  The blocker was innocent. The real cause was a CORS header rewrite (see §4.1).

When your theory and the log disagree, **the log is right.**

### 1.2 Verify before you claim. "Fixed" is a factual statement.

Do not write "fixed" unless you have evidence. Evidence means one of:

- A test you ran that failed before and passes now.
- A live API call whose response you read.
- A log line from the running app.

If you cannot verify something (e.g. it needs the browser UI, or a cloud deploy
you don't control), **say so explicitly**: *"I could not verify this end-to-end;
here is exactly what to check."* An honest "unverified" is worth more than a
confident "done" that turns out false. The founder tests everything; a false
claim is discovered within minutes and destroys trust.

### 1.3 A fix that introduces a bug is not a fix

Founder's rule: **"One bug fixed must NEVER introduce another bug — strictly
forbidden."**

Before you ship a change, ask: *what else touches this?* Concretely:

- Changing a **network header rule** affects every site, not the one you tested.
- Changing a **threshold** affects both false negatives and false positives.
- Adding a **skip/guard** can silently disable the whole feature (see §4.2).

If a change has blast radius beyond the reported bug, narrow it until it doesn't.

### 1.4 Finish the work

Do not stop at "the backend is done, the UI is left." Either complete the chain
(user action → storage → UI reflects it), or state precisely what remains and
why. Half-wired features are worse than none: they look done and fail silently.

### 1.5 Read the existing docs before designing anything

This repo already contains hard-won knowledge. Read before you build:

- `BUGS_REPORT.md` (founder's desktop) — the canonical bug history. **BUG 2 in
  that file describes the exact CORS/canvas trap that was re-introduced twice
  after it was documented.** Read it.
- `PARENT_CONTROL.md` — parental-control design.
- `MONITOR_BUGS_TRACKER.md`, `AI_BRAIN_INTEGRATION.md`.

---

## 2. The prime directive: selective blocking

> **Harmful → block fully:** hide media, prevent click-through, prevent opening
> the original URL, prevent opening the image/video, prevent context-menu bypass
> on that specific item.
>
> **Not harmful / unknown-safe → pass through untouched.** No blur, no click
> interception, no URL rewrite, no thumbnail replacement.
>
> **False positives on ordinary videos/images/pages are a regression** and must
> be fixed.

Corollaries that have bitten us:

- **Never block site chrome.** Logos, buttons, icons, avatars, menus, player
  controls are not content. Blocking them makes the site unusable.
- **Never full-page-block a content platform** (YouTube, Instagram, TikTok…).
  Good and bad content coexist there; block individual items only. Full-page
  blocks are for dedicated harmful domains.
- **Fail open, not closed.** If the model errors, the network dies, or the cloud
  quota is gone, *do not block*. Local protection continues; a broken analyzer
  must never turn into a wall.

---

## 3. Architecture map (know where you are)

Two codebases, one product.

### 3.1 Electron browser — `D:\Narimon Ecosystem\BRAUZER\BRAUZER`

| Path | What it is |
|---|---|
| `main.js` | Main process. Windows, tabs, toolbar HTML, IPC, network headers, block page. **~4000 lines; the toolbar UI is a template literal inside it.** |
| `preload.js` | contextBridge → `window.safenet`, `safenet_auth`, `safenet_premium`, `safenet_parent`, `_ipc`. |
| `monitor.js` | **Built artifact — never edit.** Compiled from `mvp_uchun_miya/`. |
| `mvp_uchun_miya/src/ai-brain/` | The AI Brain source (TypeScript). Edit here, then rebuild. |
| `ai-gateway/` | Cloud AI failover: 28 keys (Groq/Gemini/OpenRouter), one at a time, 429 → next key. |
| `cloud/browser-cloud.js` | Talks to Supabase `browser-api` (feedback, notifications, payments, parental). |
| `premium/payment-store.js` | Local payment requests. |
| `parental-control/` | Parental UI. `parent-control-supabase.js` is live; the Firebase `parent-control-service.js` is dead. |
| `premium.html`, `safenethome.html` | Premium page, home page. |

**Rebuild after any `mvp_uchun_miya/src` change:**
```bash
cd mvp_uchun_miya && npx vite build --config vite.monitor.config.ts
cp dist-monitor/monitor.js ../monitor.js
```
Forgetting this means you are testing the old code. It has happened.

### 3.2 Lovable site — `D:\sweet-simple`

React + Vite + Supabase. **Push to `https://github.com/antigravty01-droid/just-type-it.git` (branch `main`).**
The older `clayunknown001-ctrl/sweet-simple` repo is dead — do not push there.

| Path | What it is |
|---|---|
| `src/pages/AdminDashboard.tsx` | Admin: Overview, Feedback, B2B keys, Core Script, Browser, Admins. |
| `src/components/admin/BrowserAdminPanel.tsx` | Browser tab: devices, users, payments, AI limits. |
| `supabase/functions/browser-api/index.ts` | **The single API the browser talks to.** All routes live here. |
| `supabase/migrations/` | Schema. Lovable applies these. |

### 3.3 Data flow

```
Browser (Electron)                 Supabase (browser-api)          Lovable admin
  AI Brain blocks locally
  feedback ──────────────────────► feedback table ───────────────► Feedback tab
  payment  ──────────────────────► payment_requests ─────────────► Browser tab
  poll /my-subscription ◄───────── browser_subscriptions ◄──────── approve/reject
  poll /notifications ◄─────────── notifications ◄──────────────── admin reply
  child blocked search ──────────► parent_alerts ────────────────► parent's browser
```

Key idea: **the browser polls every 30s.** There is no push. If something doesn't
appear instantly, wait 30s before declaring it broken.

---

## 4. Known traps — read these before touching related code

These are real bugs that were shipped. Do not recreate them.

### 4.1 The CORS ↔ canvas trap (**the single worst one — caused twice**)

**The coupling:** the AI reads pixels from a canvas to classify an image. If the
canvas is *tainted* (cross-origin image without CORS), pixel reads throw →
analysis dies → **nothing gets blocked.** So `image/loader.ts` fetches images with
`fetch(url, {credentials:'omit'})` → blob → objectURL, and `main.js` must add CORS
headers to that fetch for the canvas to be clean.

**The trap:** it is tempting to add `Access-Control-Allow-Origin: *` to every
`image/*` response. **Do not.** A site's own credentialed (cookie-bearing)
requests then receive `ACAO: *`, which the browser **rejects** for credentialed
requests → YouTube's icons and buttons stop rendering (they remain clickable but
invisible). Reverting to "images only" swings the other way: the AI's fetch loses
CORS → canvas tainted → blocking dies again. Both extremes were shipped.

**The correct rule** (implemented in `main.js`, inside `app.whenReady`):

- `onBeforeSendHeaders`: record `details.id` in an `uncredentialed` Set when the
  request has **no `Cookie` header**.
- `onHeadersReceived`: apply the CORS override only when
  - `resourceType === 'image'` (safe: a plain `<img>` ignores CORS headers, and
    `crossOrigin='anonymous'` images need them), **or**
  - `resourceType` is `xhr`/`other` **and** the id is uncredentialed **and** the
    response `Content-Type` is `image/*` **and** the response has **no**
    `Access-Control-Allow-Credentials`.
- **Never** touch `media` (breaks video streaming) or non-image responses
  (breaks reCAPTCHA and auth: their XHRs are cookie-less too, and rewriting their
  real `ACAO` makes the CAPTCHA loop forever).

**Verify it in isolation before shipping** — this exact test caught two bugs:

```bash
node -e "
const un=new Set();
function send(id,h){Object.keys(h).some(k=>k.toLowerCase()==='cookie')?un.delete(id):un.add(id)}
function cors(id,rt,r){let img=false,acac=false;
  for(const k of Object.keys(r)){const kl=k.toLowerCase();
    if(kl==='content-type'&&String(r[k][0]).toLowerCase().startsWith('image/'))img=true;
    else if(kl==='access-control-allow-credentials')acac=true;}
  const ai=(rt==='xhr'||rt==='other')&&un.has(id)&&img&&!acac; un.delete(id);
  return rt==='image'||ai;}
const T=[
 ['AI image fetch',1,{},'xhr',{'Content-Type':['image/jpeg']},true],
 ['reCAPTCHA xhr',2,{},'xhr',{'Content-Type':['application/json'],'Access-Control-Allow-Credentials':['true']},false],
 ['YT icon (cookie)',3,{Cookie:'a'},'xhr',{'Content-Type':['image/svg+xml']},false],
 ['plain <img>',4,{Cookie:'a'},'image',{'Content-Type':['image/webp']},true],
 ['video stream',5,{Cookie:'a'},'media',{'Content-Type':['video/mp4']},false]];
let p=0; for(const[n,i,h,rt,r,w]of T){send(i,h);const g=cors(i,rt,r);
 if(g===w)p++; console.log((g===w?'OK  ':'FAIL')+' '+n+' -> '+g);}
console.log(p+'/'+T.length);"
```

Also: **CSP stripping** must skip auth/captcha frames (`recaptcha`,
`accounts.google.com`, `hcaptcha`, `challenges.cloudflare.com`).

### 4.2 Over-broad guards silently kill the feature

A guard was added to stop the AI analysing site chrome. Its selector list
included `button`, `[role="button"]`, `header`, `nav`. On Instagram and YouTube,
**content images live inside clickable wrappers** — so the guard skipped the
content too and **blocking dropped to near zero.**

Rule: guard selectors must be **narrow and specific** (`ytd-masthead`, `#guide`,
`.ytp-chrome-*`) plus a size heuristic (icons ≤64px). Never use generic
structural selectors to identify "UI".

### 4.3 Local state and cloud state diverge

The browser keeps a local payment store; the admin approves/rejects in the cloud.
Rejecting in the cloud left the browser showing *"awaiting confirmation"* forever
because the browser read `pending` from its **local** store.

Rule: **the cloud is the source of truth** for anything the admin controls. When
`/my-subscription` returns a non-pending status, reconcile the local store.
Any time you have the same fact in two places, define which one wins — and make
the other follow.

### 4.4 Fields that exist in one layer but never reach the next

`subscriptionManager.serialize()` returned `loggedIn`, but `buildPremiumStatus()`
constructed its own object and **didn't pass it through** — so the Premium page
told a logged-in user to "log in first". The data existed at every layer except
the one that mattered.

Rule: when you add a field, **trace it to the UI that consumes it.** Don't assume
an intermediate mapper forwards it.

### 4.5 Device-wide vs account-scoped

Pro was stored per device, so switching accounts still showed Pro, and a dev
"Upgrade" button granted Pro with no payment. Subscription is now **keyed by
account email** (`subscriptionManager.setCurrentAccount(email)`), and Pro can only
be activated by an approved payment.

Rule: anything that represents *entitlement* must be scoped to the account, never
the device. And never leave a debug bypass that grants paid features.

### 4.6 One userData directory per process

Two Electron instances sharing `userData` corrupt storage:
`LOCK: Access denied`, `Could not open the quota database, resetting` → cookies
and localStorage stop persisting → **the user is logged out of every site on
every restart.** Twelve zombie `electron.exe` processes were found fighting over
one directory.

Rules:
- `app.requestSingleInstanceLock()` is in place — one instance per profile.
- To run a second independent browser (e.g. testing parent + child on one
  machine): `NIEX_PROFILE=child` gives it its own `userData`.
- If storage errors appear, kill leftovers: `taskkill /F /IM electron.exe`.

### 4.7 Code identifiers are not branding

The product was renamed SafeNet/Narimon → **Niex**. Only user-visible strings
changed. **Do not rename**: `window.safenet`, `safenet_auth`, `safenet_premium`,
`__parentControlBridge`, localStorage keys (`sn_u`, `sn_user_profile`), file names
(`safenet_home.html`), IPC channel names. Renaming them breaks the bridges and
wipes user data.

### 4.8 Pushing code ≠ deploying it

**Lovable does not automatically deploy Supabase edge functions or run migrations
from an external GitHub push.** Code sat in the repo for hours while the founder
tested an old deployed function and blamed the code. The tell: an error message
you already changed still appears in production.

Rule: after pushing backend changes, **probe the live endpoint** to confirm the
new version is live before asking anyone to test:

```bash
curl -s -X POST "https://rrohtmspmuyyvswwqfsw.supabase.co/functions/v1/browser-api/api/v1/..." \
  -H "apikey: <publishable key>" -H "Content-Type: application/json" -d '{...}'
```
If the response matches the old behaviour, it is a deploy problem, not a code
problem. Tell the founder to ask Lovable to redeploy; don't "fix" working code.

---

## 5. The blocking pipeline (how it actually works)

```
image/video appears
   → scanner.ts: skip chrome UI, skip tiny icons
   → brain-processor.ts: NSFW model (local, ~50ms) + skin/центre analysis
        harmful (confident)  → block now, no cloud call
        safe but high-risk site → CLOUD SHADOW (fire-and-forget, non-blocking)
   → escalate.ts → window.safenet.checkImageData → IPC
   → main.js snFetch → ai-gateway → Groq/Gemini/OpenRouter
   → cloud says harmful → block; cloud unavailable → local decision stands
```

Design rules:
- **Local first, always.** Cloud is a shadow that follows; it must never block
  the UI or delay the local decision.
- **Cloud is deduped and budgeted** (`escalate.ts`), and the gateway caches
  results so the same image is never paid for twice.
- **Never re-analyse already-blocked content** — it wastes quota.
- Video: a **frame** is captured and sent as an image. Do not upload whole videos;
  it's slow and only Gemini supports it.

### Check the AI budget before blaming limits

The founder once suspected quota exhaustion. The state file proved otherwise:
28 requests used out of ~144,000/day available, 0 keys exhausted. The real cause
was that escalation almost never fired.

```bash
node -e "const s=require('./ai-gateway/state.json');
for(const[p,k]of Object.entries(s.slots))console.log(p,'keys',k.length,
'exhausted',k.filter(x=>x.exhausted).length,'requests',k.reduce((a,x)=>a+(x.requests||0),0))"
```

---

## 6. Working agreement with the founder

- **Uzbek**, short, direct. Max ~2 lines unless he asks for explanation. No
  padding, no over-explaining, no restating his request back to him.
- **Start implementing.** He does not want plans and options; he wants working
  code and an honest status.
- Report only: **completed / error / need user action**.
- **MVP mindset**: KISS, no unnecessary features, don't rewrite working systems,
  extend rather than replace.
- He tests everything, immediately, and sends screenshots. Assume every claim
  will be checked within minutes.
- When he says a fix didn't work, **believe him and re-diagnose** — do not defend
  the previous theory.
- He is a solo bootstrapped founder shipping an MVP. Wasted cycles cost him real
  time and money. Respect that.

### Things he has explicitly asked for, repeatedly
- Nothing pornographic may slip through — but ordinary content must be untouched.
- Don't leave AI modules exposed in the browser; don't log sensitive data; don't
  show debug info in production; protect the Knowledge Base.
- Design: he handles it. Don't redesign; fix function.

---

## 7. Definition of done

A change is done when **all** of these are true:

1. The root cause is identified and stated — not just the symptom.
2. The fix is narrow: it cannot break unrelated sites or features.
3. `node -c` passes for touched JS; `npx tsc --noEmit -p tsconfig.app.json` is
   clean for touched TS.
4. `monitor.js` is rebuilt **and copied** if `mvp_uchun_miya/src` changed.
5. There is **evidence** it works: a test run, a live API response, or a log line.
6. Backend changes are confirmed **deployed** (probe the endpoint), not just
   pushed.
7. What you could not verify is stated plainly, with exact steps for the founder
   to check.
8. Nothing that used to work is now broken — and you checked, not assumed.

---

## 8. Quick reference

```bash
# Rebuild AI Brain (mandatory after mvp_uchun_miya/src changes)
cd mvp_uchun_miya && npx vite build --config vite.monitor.config.ts && cp dist-monitor/monitor.js ../monitor.js

# Syntax
node -c main.js && node -c preload.js

# Second independent browser (parent/child testing)
$env:NIEX_PROFILE="child"; python browser.py

# Kill zombie processes (storage LOCK errors)
taskkill /F /IM electron.exe

# Push site (NEW repo only)
cd D:\sweet-simple && git push origin main   # → antigravty01-droid/just-type-it

# Live gateway/AI budget
node -e "const s=require('./ai-gateway/state.json');console.log(JSON.stringify(s.slots,null,1))"
```

**Live Supabase:** `https://rrohtmspmuyyvswwqfsw.supabase.co`
Publishable key format is the new opaque style (`sb_publishable_...`) — it goes in
the `apikey` header, **never** as `Authorization: Bearer`.

---

## 9. Final word

The founder does not need an AI that is fast. He needs one that is **correct and
honest**. It is always acceptable to say:

> *"I don't know yet — here is the diagnostic I'm running to find out."*

It is never acceptable to say "fixed" without proof, or to fix one bug by
creating another. If you only remember one thing from this file: **the log is
right, your theory is a guess, and nothing is done until you have watched it
work.**
