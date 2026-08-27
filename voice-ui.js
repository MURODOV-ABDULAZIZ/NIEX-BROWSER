/**
 * NIEX Voice Agent — Hands-free ("NIEX") Mic UI + Command Guide (Prompt 5).
 * ========================================================================
 *
 * Har sahifaga inject qilinadi (main.js: file:// + https://). FAQAT bitta rejim —
 * HANDS-FREE: "NIEX" deb chaqirilsa aktivlashadi, keyin buyruq bajariladi
 * (foydalanuvchi qurilmaga TEGMASDAN masofadan boshqaradi). Qo'lda mic tugmasi YO'Q.
 *
 * PRO-only: voice faqat Pro obunachilarga (safenet_voice.available). Free'da UI YO'Q.
 * FAQAT ko'rinadigan tab tinglaydi (Page Visibility). Audio saqlanmaydi (maxfiylik).
 * Buyruqlar INGLIZCHA (ishonchli STT). Yon tarafda ? — yo'riqnoma.
 *
 * Bog'liq: NIEXVoiceRecorder, NIEXWakeListener, NIEXParseWake, NIEXVoiceAgent,
 * safenet_voice, safenet_voice_stt.
 */
(function () {
  'use strict';
  if (window.__niexVoiceUI) return;
  if (!window.NIEXVoiceAgent || !window.safenet_voice) return;
  window.__niexVoiceUI = true;

  // PRO tekshiruvi. Startup'da obuna/hisob KECH yuklanishi mumkin (bulut login) →
  //   available() DASTLAB false qaytishi mumkin (shu sabab avval faqat refresh/yangi tabда
  //   ko'rinardi). Shuning uchun QAYTA tekshiramiz: vaqt bo'yicha (30s) + sahifa ko'rinsa/
  //   fokuslanganda. Pro bo'lgan zahoti UI quriladi.
  var built = false, retries = 0, retryIv = null;
  function tryBuild() {
    if (built) return;
    var availFn = window.safenet_voice.available;
    Promise.resolve(typeof availFn === 'function' ? availFn() : true)
      .then(function (okPro) { if (okPro && !built) { built = true; if (retryIv) { clearInterval(retryIv); retryIv = null; } buildUI(); } })
      .catch(function () {});
  }
  // Retry sxemasi: tez boshlanadi (500ms×5), keyin sekinlashadi (2500ms×~24) — jami ~60s.
  //   Bosh sahifada Pro-sub yuklanishни kutmasdan darhol UI qurishga urinadi.
  function scheduleNext() {
    if (built || retries > 30) { if (retryIv) { clearInterval(retryIv); retryIv = null; } return; }
    if (retryIv) clearInterval(retryIv);
    var delay = retries < 5 ? 500 : 2500;
    retryIv = setTimeout(function () { retries++; tryBuild(); scheduleNext(); }, delay);
  }
  document.addEventListener('visibilitychange', function () { if (!document.hidden) tryBuild(); });
  window.addEventListener('focus', tryBuild);
  // Pro obuna FAOLLASHGAN zahoti (premium-status-changed broadcast) — darhol quramiz,
  //   retry timing'ini kutmasdan. Bu bosh sahifada Pro kech kelса ham voice'ni ko'rsatadi.
  try {
    if (window.safenet_premium && typeof window.safenet_premium.onStatusChanged === 'function') {
      window.safenet_premium.onStatusChanged(function () { tryBuild(); });
    }
  } catch (e) {}
  tryBuild();
  scheduleNext();

  function buildUI() {
    // ---------- DOM ----------
    var wrap = document.createElement('div');
    wrap.id = '__niexVoiceWrap';
    wrap.style.cssText = 'position:fixed;top:6px;left:8px;z-index:2147483000;display:flex;flex-direction:column;align-items:flex-start;gap:4px;font-family:system-ui,sans-serif;pointer-events:none';
    var row = document.createElement('div');
    row.style.cssText = 'display:flex;align-items:center;gap:6px;pointer-events:none';
    // Hands-free ("NIEX") tugmasi — CHAP tarafda, logo oldida.
    var hf = document.createElement('button');
    hf.type = 'button';
    hf.style.cssText = 'pointer-events:auto;width:32px;height:32px;border-radius:50%;border:1px solid #2d3f5e;background:#131b2c;color:#e8f0fe;cursor:pointer;font-size:15px;line-height:1;display:flex;align-items:center;justify-content:center;transition:all .18s;opacity:.55';
    hf.textContent = '🎧';
    // Yo'riqnoma tugmasi.
    var help = document.createElement('button');
    help.type = 'button';
    help.style.cssText = 'pointer-events:auto;width:22px;height:22px;border-radius:50%;border:1px solid #2d3f5e;background:#131b2c;color:#8ea3c4;cursor:pointer;font-size:12px;line-height:1;display:flex;align-items:center;justify-content:center';
    help.textContent = '?';
    help.title = 'Voice commands guide';
    // Holat matni.
    var label = document.createElement('span');
    label.style.cssText = 'pointer-events:none;font-size:11px;color:#8ea3c4;max-width:260px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;background:rgba(15,22,35,.86);padding:3px 9px;border-radius:8px;display:none';
    row.appendChild(hf); row.appendChild(help); row.appendChild(label);
    // Debug preview — "You said:" + result.
    var debug = document.createElement('div');
    debug.style.cssText = 'pointer-events:none;font-size:10.5px;color:#a5b1c8;max-width:340px;background:rgba(15,22,35,.92);padding:5px 10px;border-radius:8px;border:1px solid #1e2d45;line-height:1.35;display:none;white-space:pre-wrap;word-break:break-word';
    // Yo'riqnoma paneli.
    var guide = document.createElement('div');
    guide.style.cssText = 'pointer-events:auto;font-size:11.5px;color:#cdd8ea;max-width:330px;background:rgba(13,19,30,.97);padding:10px 12px;border-radius:10px;border:1px solid #24354f;line-height:1.5;display:none;box-shadow:0 8px 28px rgba(0,0,0,.45)';
    guide.innerHTML =
      '<div style="font-weight:600;color:#00e5a0;margin-bottom:6px">🎧 NIEX Voice — say <b>“NIEX”</b> then a command</div>' +
      '<div style="display:grid;grid-template-columns:1fr;gap:2px">' +
      '<div>• <b>open youtube</b> / go to google</div>' +
      '<div>• <b>search 505 music</b> (on youtube)</div>' +
      '<div>• <b>open first video</b> / open 3rd result</div>' +
      '<div>• <b>play</b> / <b>pause</b></div>' +
      '<div>• <b>louder 5</b> / lower 3 / mute</div>' +
      '<div>• <b>next video</b> / previous video</div>' +
      '<div>• <b>scroll down</b> / scroll up</div>' +
      '<div>• <b>go back</b> / reload / new tab / close tab</div>' +
      '</div>' +
      '<div style="margin-top:7px;color:#7d8ba6;font-size:10.5px">Example: “NIEX, open first video” · “NIEX, louder 4”</div>' +
      '<div style="margin-top:10px;padding-top:9px;border-top:1px solid #24354f">' +
        '<div style="font-weight:600;color:#7ecbff;margin-bottom:4px">🔑 Connect your own Groq key <span style="color:#7d8ba6;font-weight:400">(free — voice works reliably)</span></div>' +
        '<ol style="margin:0 0 6px 16px;padding:0;color:#cdd8ea">' +
          '<li>Open <b>console.groq.com/keys</b> (sign in with Google)</li>' +
          '<li>Click <b>Create API Key</b> → give it a name → Submit</li>' +
          '<li><b>Copy</b> the key (starts with <code>gsk_</code>) — shown only once</li>' +
          '<li>Paste it below → <b>Save</b></li>' +
        '</ol>' +
      '</div>';
    wrap.appendChild(row); wrap.appendChild(debug); wrap.appendChild(guide);

    // BYO Groq kalit — interaktiv qismlar (createElement: CSP-xavfsiz, .style CSSOM).
    var keyBox = document.createElement('div');
    keyBox.style.cssText = 'display:flex;flex-direction:column;gap:6px;margin-top:2px';
    var keyIn = document.createElement('input');
    keyIn.type = 'password'; keyIn.placeholder = 'gsk_...'; keyIn.autocomplete = 'off'; keyIn.spellcheck = false;
    keyIn.style.cssText = 'width:100%;box-sizing:border-box;background:#0a0f18;border:1px solid #2d3f5e;border-radius:8px;color:#e8f0fe;font-size:12px;padding:7px 9px;font-family:monospace';
    var keyRow = document.createElement('div');
    keyRow.style.cssText = 'display:flex;gap:6px;align-items:center';
    var keySave = document.createElement('button');
    keySave.type = 'button'; keySave.textContent = 'Save & activate';
    keySave.style.cssText = 'flex:1;pointer-events:auto;background:#0d2119;border:1px solid #00e5a0;color:#7effcf;border-radius:8px;font-size:12px;font-weight:600;padding:7px 10px;cursor:pointer';
    var keyClear = document.createElement('button');
    keyClear.type = 'button'; keyClear.textContent = 'Remove';
    keyClear.style.cssText = 'pointer-events:auto;background:#1a1420;border:1px solid #533;color:#e88;border-radius:8px;font-size:12px;padding:7px 10px;cursor:pointer;display:none';
    keyRow.appendChild(keySave); keyRow.appendChild(keyClear);
    var keyStatus = document.createElement('div');
    keyStatus.style.cssText = 'font-size:11px;color:#7d8ba6;min-height:14px';
    keyBox.appendChild(keyIn); keyBox.appendChild(keyRow); keyBox.appendChild(keyStatus);
    guide.appendChild(keyBox);

    var keyOk = false;   // voice HOZIR ishlay oladimi (user kaliti bor / dev-shared)
    function keyStat(text, color) { keyStatus.textContent = text || ''; keyStatus.style.color = color || '#7d8ba6'; }
    function loadKeyState() {
      if (!window.safenet_voice.getApiKey) { keyOk = true; return; }
      window.safenet_voice.getApiKey().then(function (r) {
        keyOk = !!(r && r.effective);
        if (r && r.hasKey) { keyStat('✓ Your key is active: ' + r.masked, '#00e5a0'); keyClear.style.display = ''; keyIn.placeholder = 'gsk_… (replace)'; }
        else if (r && r.effective) { keyStat('Shared dev keys active.', '#7d8ba6'); keyClear.style.display = 'none'; }
        else { keyStat('⚠ Voice needs YOUR Groq key — paste it above to start.', '#ffbe3c'); keyClear.style.display = 'none'; }
        reflectKeyState();
        if (keyOk) startWake();   // kalit tayyor + hands-free yoqilган bo'lsa — ishga tushiramiz
      }).catch(function () {});
    }
    // Kalit yo'q bo'lsa: hands-free o'chiq, yo'riqnoma ochiq, "API ulang" ko'rsatiladi.
    function reflectKeyState() {
      if (keyOk) return;
      hfOn = false; renderHf();
      showLabel('🔑 Ovoz uchun API kalit ulang');
      guide.style.display = 'block';
    }
    keySave.addEventListener('click', function () {
      var v = (keyIn.value || '').trim();
      if (!v) { keyStat('Paste your gsk_… key first.', '#ffbe3c'); return; }
      keySave.disabled = true; keyStat('Checking with Groq…', '#7ecbff');
      window.safenet_voice.setApiKey(v).then(function (r) {
        keySave.disabled = false;
        if (r && r.ok) { keyIn.value = ''; keyOk = true; keyStat('✓ Saved & activated: ' + r.masked, '#00e5a0'); keyClear.style.display = ''; showLabel('✓ Ovoz tayyor — 🎧 ni yoqing'); }
        else { keyStat('✗ ' + ((r && r.message) || 'Could not verify the key.'), '#ff6e6e'); }
      }).catch(function () { keySave.disabled = false; keyStat('✗ Error saving key.', '#ff6e6e'); });
    });
    keyClear.addEventListener('click', function () {
      window.safenet_voice.clearApiKey().then(function () { stopWake(); loadKeyState(); }).catch(function () {});
    });
    (document.body || document.documentElement).appendChild(wrap);

    // ---------- Holat / debug ----------
    var lastTranscript = '';
    function showDebug(transcript, status, message) {
      if (transcript) lastTranscript = transcript;
      if (!lastTranscript && !status) { debug.style.display = 'none'; return; }
      var s = lastTranscript ? 'You said: "' + lastTranscript + '"' : '';
      if (status) { s += (s ? '\n' : '') + 'Result: ' + status + (message ? ' — ' + message : ''); }
      debug.textContent = s; debug.style.display = 'block';
    }
    var resetTimer = null;
    function showLabel(text) { if (!text) { label.style.display = 'none'; return; } label.textContent = text; label.style.display = 'inline-block'; }
    function autoReset(ms) { resetTimer = setTimeout(function () { agent.reset(); render('idle'); }, ms || 2200); }

    var recorder = window.NIEXVoiceRecorder ? new window.NIEXVoiceRecorder({ maxMs: 12000 }) : null;
    var agent = window.NIEXVoiceAgent.createVoiceAgent({
      record: recorder || {},
      runCommand: function (text) { return window.safenet_voice.command(text); },
      onState: render,
    });

    // Holat 🎧 tugmasi + label + debug orqali ko'rsatiladi (qo'lda mic tugmasi yo'q).
    function hfGlow(color, shadow) { hf.style.borderColor = color; hf.style.boxShadow = shadow || 'none'; }
    function render(state, data) {
      data = data || {};
      if (resetTimer) { clearTimeout(resetTimer); resetTimer = null; }
      if (data.transcript) lastTranscript = data.transcript;
      switch (state) {
        case 'listening': hfGlow('#3c9cff'); showLabel('Listening…'); break;
        case 'transcribing': hfGlow('#3c9cff'); showLabel('Transcribing…'); break;
        case 'understanding': hfGlow('#3c9cff', '0 0 0 2px rgba(60,156,255,.5)'); showLabel(data.transcript ? ('“' + data.transcript + '”') : 'Working…'); showDebug(data.transcript, null); break;
        case 'executing': hfGlow('#00e5a0', '0 0 0 2px rgba(0,229,160,.5)'); showLabel('Doing it…'); break;
        case 'success': hfGlow('#00e5a0', '0 0 0 2px rgba(0,229,160,.7)'); showLabel('Done ✓'); showDebug(null, 'Done'); autoReset(); break;
        case 'blocked': hfGlow('#ff4757'); showLabel(data.message || 'Blocked by NIEX'); showDebug(null, 'BLOCKED', data.message); autoReset(5000); break;
        case 'needs_clarification': hfGlow('#ffbe3c'); showLabel(data.message || 'Please clarify'); showDebug(null, 'Clarify', data.message); autoReset(5000); break;
        case 'error': hfGlow('#ff6e6e'); showLabel(data.message || 'Didn’t catch that'); showDebug(null, (data.result && data.result.status) || 'error', data.message || 'Not understood'); autoReset(6000); break;
        case 'cancelled': hfGlow('#2d3f5e'); showLabel('Cancelled'); autoReset(1500); break;
        default: showLabel(''); renderHf(); // idle → HF holatiga qaytamiz
      }
      syncWake(state);
    }

    // ---------- Hands-free (wake-word) ----------
    var wake = null, hfOn = false, armed = false, armedTimer = null;
    function renderHf() {
      hf.style.opacity = hfOn ? '1' : '.55';
      hf.style.borderColor = hfOn ? '#00e5a0' : '#2d3f5e';
      hf.style.background = hfOn ? '#0d2119' : '#131b2c';
      hf.style.boxShadow = hfOn ? '0 0 0 1px rgba(0,229,160,.35)' : 'none';
      hf.title = hfOn ? 'Hands-free ON — say “NIEX …”. Click to turn off.' : 'Hands-free OFF — click, then say “NIEX …”.';
    }
    function disarm() { armed = false; if (armedTimer) { clearTimeout(armedTimer); armedTimer = null; } }
    function arm() {
      armed = true; hf.style.boxShadow = '0 0 0 3px rgba(0,229,160,.8)';
      showLabel('🎧 NIEX — say your command');
      if (armedTimer) clearTimeout(armedTimer);
      armedTimer = setTimeout(function () { armed = false; renderHf(); if (!agent.isBusy()) showLabel(''); }, 8000);
    }
    function onWakeUtterance(text) {
      if (!hfOn || !text || agent.isBusy()) return;
      var parsed = window.NIEXParseWake ? window.NIEXParseWake(text) : { hit: false, rest: text };
      var cmd = null;
      if (armed) {
        if (parsed.hit && !parsed.rest) { arm(); return; }   // yana faqat "NIEX" — qayta armed
        disarm(); renderHf(); cmd = parsed.hit ? parsed.rest : text;
      }
      else if (parsed.hit) { if (parsed.rest) cmd = parsed.rest; else { arm(); return; } }
      else return; // wake yo'q — e'tibormay (maxfiylik)
      if (!cmd || cmd.length < 2) { showLabel('Command not heard'); showDebug(text, 'unclear', 'Say NIEX + a command'); return; }
      if (wake) wake.pause();
      showDebug(cmd, null);
      try { agent.runText(cmd); } catch (_) {}
    }
    function startWake() {
      if (!hfOn || !keyOk || document.hidden || !window.NIEXWakeListener) return;  // kalitsiz ishlamaydi
      if (wake && wake.isRunning()) return;
      wake = new window.NIEXWakeListener({
        onUtterance: onWakeUtterance,
        onError: function (err) { if (err === 'mic-denied' || err === 'unsupported') { hfOn = false; renderHf(); persistHf(false); showLabel('Mic unavailable'); } },
        onStatus: function () {},
      });
      wake.start();
    }
    function stopWake() { disarm(); if (wake) { try { wake.stop(); } catch (_) {} wake = null; } }
    var busyStates = { listening: 1, transcribing: 1, understanding: 1, executing: 1 };
    function syncWake(state) {
      if (!wake || !wake.isRunning()) return;
      if (busyStates[state]) { if (!wake.isPaused()) wake.pause(); }
      else { setTimeout(function () { if (wake && wake.isRunning() && hfOn && !document.hidden && !agent.isBusy()) wake.resume(); }, 700); }
    }
    function persistHf(on) { try { if (window.safenet_voice.setHandsFree) window.safenet_voice.setHandsFree(on); } catch (_) {} }

    hf.addEventListener('click', function () {
      if (!keyOk) { guide.style.display = 'block'; showLabel('🔑 Avval o’z API kalitingizni ulang'); try { keyIn.focus(); } catch (_) {} return; }
      hfOn = !hfOn; renderHf(); persistHf(hfOn);
      if (hfOn) { startWake(); showLabel('🎧 Hands-free on — say “NIEX …”'); setTimeout(function () { if (!agent.isBusy()) showLabel(''); }, 2000); }
      else { stopWake(); showLabel('Hands-free off'); setTimeout(function () { if (!agent.isBusy()) showLabel(''); }, 1600); }
    });
    help.addEventListener('click', function () { guide.style.display = guide.style.display === 'none' ? 'block' : 'none'; });

    document.addEventListener('visibilitychange', function () {
      if (!hfOn) return;
      if (document.hidden) stopWake(); else startWake();
    });

    // Boshlang'ich: global HF sozlamasi (barcha saytlarda bir xil).
    (function initHf() {
      var getHF = window.safenet_voice.getHandsFree;
      if (typeof getHF !== 'function') { renderHf(); return; }
      Promise.resolve().then(getHF).then(function (on) { hfOn = !!on; renderHf(); startWake(); })
        .catch(function () { renderHf(); });
    })();

    loadKeyState();   // kalit holatini yuklaydi; kalit yo'q → "API ulang", bor → wake
    render('idle');

    // WATCHDOG — hands-free tirikligini kafolatlaydi. Agar listener race/timeout tufayli
    //   noto'g'ri PAUSE'da yoki butunlay TO'XTAB qolsa (1-2 buyruqdan keyin "eshitmay
    //   qolish" muammosi), uni 3s ichida qayta tiklaydi. Ilgari faqat YANGI TAB ochish
    //   qutqarardi. agent.isBusy() endi timeout bilan ishonchli bo'shaydi (voice-agent.js).
    setInterval(function () {
      if (!hfOn || !keyOk || document.hidden) return;
      if (!wake || !wake.isRunning()) { startWake(); return; }
      if (wake.isPaused() && !agent.isBusy()) { try { wake.resume(); } catch (_) {} }
    }, 3000);
  }
})();
