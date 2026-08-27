/**
 * NIEX Voice Agent — Local Simple-Command Detector (Prompt 3).
 * ===========================================================
 *
 * Aniq, bir bosqichli buyruqlarni Qwen'SIZ aniqlaydi (tejamkorlik + tezlik +
 * offline'da ham ishlaydi). Murakkab/ko'p bosqichli buyruqlar → null (interpreter
 * ularni Qwen'ga uzatadi). Bu OG'IR NLP EMAS — faqat ravshan buyruqlar.
 *
 * TIL: INGLIZCHA asosiy (STT='en' — ishonchli), O'ZBEKCHA fallback (Whisper uz'ni
 * transkript qilsa ham tushunadi). Sof modul (Node + brauzer).
 */
(function (root, factory) {
  const schema = (typeof require === 'function') ? require('./action-schema') : root.NIEXVoiceSchema;
  const api = factory(schema);
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.NIEXVoiceLocal = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function (S) {
  'use strict';

  // Aggresiv normalizatsiya: kichraytiradi, tinish belgilarni yo'qotadi,
  //   Whisper'ning tipik uz misheardlarini tuzatadi (fallback). Inglizcha toza matnга
  //   bu qoidalar deyarli ta'sir qilmaydi (aniq uz naqshlarga qaratilgan).
  function norm(t) {
    var s = String(t || '').toLowerCase()
      // Kirill → lotin transliteratsiyasi (Whisper uz'ni ba'zan kirill qaytaradi)
      .replace(/ю/g, 'yu').replace(/я/g, 'ya').replace(/ё/g, 'yo').replace(/ц/g, 'ts')
      .replace(/ч/g, 'ch').replace(/ш/g, 'sh').replace(/щ/g, 'sh').replace(/ж/g, 'j')
      .replace(/х/g, 'x').replace(/ы/g, 'i').replace(/э/g, 'e')
      .replace(/а/g, 'a').replace(/б/g, 'b').replace(/в/g, 'v').replace(/г/g, 'g')
      .replace(/д/g, 'd').replace(/е/g, 'e').replace(/з/g, 'z').replace(/и/g, 'i')
      .replace(/й/g, 'y').replace(/к/g, 'k').replace(/л/g, 'l').replace(/м/g, 'm')
      .replace(/н/g, 'n').replace(/о/g, 'o').replace(/п/g, 'p').replace(/р/g, 'r')
      .replace(/с/g, 's').replace(/т/g, 't').replace(/у/g, 'u').replace(/ф/g, 'f')
      .replace(/ъ/g, "'").replace(/ь/g, '').replace(/ў/g, "o'").replace(/қ/g, 'q')
      .replace(/ғ/g, "g'").replace(/ҳ/g, 'h')
      // Tinish belgilar + qavslar
      .replace(/[.!?,:;(){}\[\]"«»]/g, ' ')
      // Whisper "You tube" ni ajratib yozadi — birlashtiramiz
      .replace(/\byou\s+tube\b/g, 'youtube')
      .replace(/\byu\s+tube\b/g, 'youtube')
      .replace(/\biu\s?tub\b/g, 'youtube')
      .replace(/\byou\s+t[uy]b\b/g, 'youtube')
      .replace(/\byutub\b/g, 'youtube')
      .replace(/\bgugl\b/g, 'google')
      // Uz Whisper misheardlari (fallback) → kanonik so'z.
      .replace(/\byang?[eiy]+\b/g, 'yangi')
      .replace(/\byank[ei]?\b/g, 'yangi')
      .replace(/\bsa[jk]h?i?fa?h?\b/g, 'sahifa')
      .replace(/\boj[hkg]?\b/g, 'och')
      .replace(/\bqu[sh]h?\b/g, 'och')
      .replace(/\bpaus?[ae]\b/g, 'pause')
      .replace(/\bskrol\b/g, 'scroll')
      .replace(/\bochib?\s*yubor(?:ing)?\b/g, 'och')
      .replace(/\bpauzalash\b/g, 'pauza')
      .replace(/\bnovi[y]?\s+tab\b/g, 'yangi tab')
      .replace(/\s+/g, ' ').trim();
    return fuzzyReplace(s);
  }

  // Kanonik so'zlar — INGLIZCHA buyruqlar + o'zbekcha fallback. fuzzyReplace ularni
  //   saqlaydi va yaqin mishearlarni shularга tuzatadi.
  const CANON = [
    // Saytlar
    'youtube', 'google', 'gmail', 'instagram', 'telegram', 'wikipedia',
    'facebook', 'twitter', 'reddit', 'chatgpt', 'yandex',
    // Inglizcha buyruq fe'llari/otlari
    'search', 'find', 'open', 'play', 'pause', 'stop', 'resume', 'next', 'previous',
    'back', 'forward', 'reload', 'refresh', 'scroll', 'down', 'up', 'close', 'tab',
    'louder', 'lower', 'quieter', 'volume', 'sound', 'mute', 'unmute', 'video', 'site',
    'result', 'link', 'first', 'second', 'third', 'fourth', 'fifth', 'type', 'write',
    // O'zbekcha fallback
    'yangi', 'sahifa', 'sayt', 'varaq', 'oyna',
    'och', 'ochib', 'oching', 'kirish', 'kiring', 'kirib',
    'qidir', 'izla', 'topib', 'qidiruv',
    'pauza', 'toxtat', 'davom', 'ettir',
    'keyingi', 'oldingi', 'videoni', 'natija', 'natijani',
    'birinchi', 'ikkinchi', 'uchinchi', 'beshinchi', 'tortinchi',
    'pastga', 'tepaga', 'yuqoriga', 'orqaga', 'oldinga', 'yangila',
    'bosing', 'click', 'yozib', 'kiritib', 'searchbox', 'textarea', 'input',
    'minecraft', 'salom', 'dunyo', 'hello'];
  function editDist(a, b, cap) {
    if (a === b) return 0;
    var la = a.length, lb = b.length;
    if (Math.abs(la - lb) > cap) return cap + 1;
    var v0 = [], v1 = [];
    for (var i = 0; i <= lb; i++) v0[i] = i;
    for (var i = 0; i < la; i++) {
      v1[0] = i + 1;
      var minRow = v1[0];
      for (var j = 0; j < lb; j++) {
        var cost = a.charCodeAt(i) === b.charCodeAt(j) ? 0 : 1;
        v1[j + 1] = Math.min(v1[j] + 1, v0[j + 1] + 1, v0[j] + cost);
        if (v1[j + 1] < minRow) minRow = v1[j + 1];
      }
      if (minRow > cap) return cap + 1;
      var tmp = v0; v0 = v1; v1 = tmp;
    }
    return v0[lb];
  }
  function fuzzyReplace(s) {
    if (!s) return s;
    var toks = s.split(/(\s+)/);
    for (var k = 0; k < toks.length; k++) {
      var tok = toks[k];
      if (!/^[a-z]+$/.test(tok) || tok.length < 4) continue;
      if (CANON.indexOf(tok) !== -1) continue;
      var best = null, bestD = 3;
      for (var c = 0; c < CANON.length; c++) {
        var w = CANON[c];
        if (Math.abs(w.length - tok.length) > 2) continue;
        var lim = w.length <= 5 ? 1 : 2;
        var d = editDist(tok, w, bestD);
        if (d <= lim && d < bestD) { best = w; bestD = d; if (d === 0) break; }
      }
      if (best) toks[k] = best;
    }
    return toks.join('');
  }

  // Murakkablik / MVP-tashqari belgilar.
  const COMPLEX_MULTI = /\b(keyin|va shundan|hamda|and then|then)\b/;
  const RANKING = /\b(eng |birinchisidan|latest|so['’]nggisini|oxirgisini|last one)\b/;

  // Bir intent → action. Tartib muhim (aniqrog'i birinchi). INGLIZCHA + o'zbekcha.
  const RULES = [
    // Media
    { rx: /\b(pause|paused|stop|halt|pauza|pauze|to['’]xtat|toxtat|to['’]xtatib|to['’]xtasin|toxtasin|hold on)\b/, act: { type: 'pause' }, when: (t) => !/\b(video|result|link|site|sayt)\b.*\b\d/.test(t) },
    { rx: /\b(resume|continue|davom ettir|davom et|unpause|keep playing)\b/, act: { type: 'play' } },
    { rx: /\b(play|o['’]ynat|oynat|ijro et|ijro)\b/, act: { type: 'play' }, when: (t) => !/\b(first|second|third|fourth|fifth|birinchi|ikkinchi|uchinchi)\b/.test(t) },
    { rx: /\b(next|next video|keyingi|keyingisi)\b/, act: { type: 'next_video' }, when: (t) => /\b(video|next|keyingi|keyingisi)\b/.test(t) && !/\b(sahifa|page|tab)\b/.test(t) },
    { rx: /\b(previous|prev|oldingi|avvalgi|last video)\b/, act: { type: 'previous_video' }, when: (t) => /\b(video|previous|prev|oldingi|avvalgi)\b/.test(t) && !/\b(sahifa|page|tab)\b/.test(t) },
    // Navigatsiya
    { rx: /\b(go back|back|orqaga|ortga|orqaga qaytar|ortga qaytar)\b/, act: { type: 'go_back' }, when: (t) => !/\b(video)\b/.test(t) },
    { rx: /\b(go forward|forward|oldinga|oldinga o['’]t)\b/, act: { type: 'go_forward' }, when: (t) => !/\b(video)\b/.test(t) },
    { rx: /\b(reload|refresh|yangila|yangilash|qayta yukla)\b/, act: { type: 'reload' } },
    // Scroll (volume EMAS — "volume up/down" avval detectVolume'da tutiladi)
    { rx: /\b(scroll down|page down|pastga|past|down)\b/, act: { type: 'scroll', direction: 'down', amount: S.LIMITS.SCROLL_DEFAULT }, when: (t) => (/\b(scroll|pastga|past|aylantir|tush)\b/.test(t) || /\bdown\b/.test(t)) && !/\b(volume|sound)\b/.test(t) },
    { rx: /\b(scroll up|page up|tepaga|yuqoriga|up)\b/, act: { type: 'scroll', direction: 'up', amount: S.LIMITS.SCROLL_DEFAULT }, when: (t) => (/\b(scroll|tepaga|yuqoriga|aylantir|ko['’]tar)\b/.test(t) || /\bup\b/.test(t)) && !/\b(volume|sound)\b/.test(t) },
    // Tab
    { rx: /\b(new tab|open tab|yangi\s+(tab|oyna|varaq|sahifa|sayt|window|page)|new\s+(tab|window|page))\b/, act: { type: 'new_tab' } },
    { rx: /\byangi\s+(sahifa|sayt|varaq|tab|oyna)\s+(och|ochib|oching)\b/, act: { type: 'new_tab' } },
    { rx: /\b(close tab|close this tab|tabni yop|oynani yop|tab yop|sahifani yop)\b/, act: { type: 'close_tab' } },
  ];

  // Ochish: "open youtube" / "go to youtube" / "youtube och" — faqat MA'LUM sayt.
  const OPEN_VERBS = /\b(open|go to|goto|visit|launch|och|ochib|oching|ochib ber|ochsang|kir|kiring|kirib)\b/;
  const SITE_SUFFIX_RX = /\s*(['’]ni|['’]ga|ni|ga|dan|saytini|saytiga)\b/g;
  function detectOpenSite(t) {
    if (!OPEN_VERBS.test(t)) return null;
    if (/\b(search|find|qidir|izla)\b/.test(t)) return null; // "search on youtube" → detectSearch
    let best = null;
    const clean = t.replace(SITE_SUFFIX_RX, ' ').replace(/\s+/g, ' ');
    for (const name of Object.keys(S.KNOWN_SITES)) {
      const rx = new RegExp('\\b' + name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b', 'i');
      if (rx.test(clean) && (!best || name.length > best.length)) best = name;
    }
    if (!best) return null;
    return { type: 'open_site', url: S.KNOWN_SITES[best] };
  }

  // Search: "search X" / "search X on youtube" / "youtube da X ni qidir" / "google'dan X qidir".
  const SEARCH_VERBS = /\b(search|find|look up|lookup|qidir|qidr|izla|topib ber|topgin|topib|toping)\b/;
  const SEARCH_ENGINES = ['youtube', 'google', 'yandex', 'wikipedia', 'bing', 'duckduckgo'];
  // Query'dan olib tashlanadigan bo'g'inlar (ing + uz).
  const SEARCH_STOP = /\b(search|find|look up|lookup|for|on|in|the|qidir|qidr|izla|topib ber|topgin|topib|toping|dan|da|['’]dan|['’]da|['’]ni|ni|ga|deb)\b/gi;
  function detectSearch(t) {
    if (!SEARCH_VERBS.test(t)) return null;
    if (RANKING.test(t)) return null;
    let engine = null;
    for (const e of SEARCH_ENGINES) {
      // engine nomi + ixtiyoriy uz suffiks ("youtube'da") YOKI "on/in youtube".
      const rx = new RegExp('\\b(?:on|in)\\s+' + e + '\\b|\\b' + e + "['’]?(?:dan|da|ni|ga)?\\b", 'i');
      if (rx.test(t)) { engine = e; break; }
    }
    let q = ' ' + t + ' ';
    if (engine) q = q.replace(new RegExp('\\b(?:on|in)\\s+' + engine + '\\b|\\b' + engine + "['’]?(?:dan|da|ni|ga)?\\b", 'gi'), ' ');
    q = q.replace(SEARCH_STOP, ' ').replace(/['’]/g, ' ').replace(/\s+/g, ' ').trim();
    if (!q || q.length < 2) return null;
    const act = { type: 'search', query: q };
    if (engine) act.engine = engine;
    return act;
  }

  // type_text — aktiv sahifadagi input'ga yozish. "type X" / "qidiruvga X deb yoz/qidir".
  const TYPE_BOX_RX = /\b(qidiruv|search\s?input|searchbox|search box|search bar|search|textarea|input|field)\b/;
  const TYPE_WRITE_VERB = /\b(type|write|enter|yoz|yozib|kiritib|kirit)\b/;
  const TYPE_SEARCH_VERB = /\b(qidir|qidr|izla)\b/;
  const TYPE_QUOTED = /["“”'’«»‘]([^"“”'’«»‘]{1,180})["“”'’«»‘]/;
  const TYPE_DEB_BOX = /\b(?:qidiruv(?:ga)?|search(?:\s?input|\s?box|\s?bar)?(?:['’]?ga)?|searchbox|textarea(?:['’]?ga)?|input(?:['’]?ga)?|field)\s+(.+?)\s+deb\s+(?:yoz|yozib|kirit|kiritib|qidir|qidr|izla)/i;
  const TYPE_DEB_WRITE = /(.+?)\s+deb\s+(?:yoz|yozib|kirit|kiritib)/i;
  const TYPE_EN = /\b(?:type|write|enter)\s+(?:in\s+)?(?:the\s+)?(?:search\s?(?:box|bar|input)?\s+)?(.+?)\s*$/i;
  function detectTypeText(t) {
    const hasBox = TYPE_BOX_RX.test(t);
    const hasWrite = TYPE_WRITE_VERB.test(t);
    const hasSearchVerb = TYPE_SEARCH_VERB.test(t);
    if (!hasWrite && !(hasBox && hasSearchVerb)) return null;
    let target = null, query = null;
    if (/\btextarea(?:['’]?ga|ga)?\b/.test(t)) target = 'textarea';
    else if (/\b(qidiruv|search\s?input|searchbox|search\s?box|search\s?bar|search)\b/.test(t)) target = 'search';
    else if (/\b(input|field)(?:['’]?ga|ga)?\b/.test(t)) target = 'input';
    let m = t.match(TYPE_QUOTED);
    if (m) query = m[1].trim();
    if (!query) { m = t.match(TYPE_DEB_BOX); if (m) query = m[1].trim(); }
    if (!query) { m = t.match(TYPE_DEB_WRITE); if (m) query = m[1].replace(/^(qidiruvga|search|input|textarea|searchbox|field)\b/i, '').trim(); }
    if (!query && /\b(type|write|enter)\b/.test(t)) { m = t.match(TYPE_EN); if (m) query = m[1].trim(); }
    if (!query || query.length < 2) return null;
    const act = { type: 'type_text', query };
    if (target) act.target = target;
    if (hasSearchVerb) { act.submit = true; if (!act.target) act.target = 'search'; }
    return act;
  }

  // open_result: "open first video/result/site" / "play the first video" / "3rd result" /
  //   "birinchi videoni qoy" / "1-videoni och".
  const WORD_ORD = {
    first: 1, second: 2, third: 3, fourth: 4, fifth: 5, sixth: 6, seventh: 7, eighth: 8, ninth: 9, tenth: 10,
    birinchi: 1, ikkinchi: 2, uchinchi: 3, beshinchi: 5, tortinchi: 4, "to'rtinchi": 4, "to’rtinchi": 4,
  };
  const RESULT_VERB = /\b(open|play|click|show|qoy|qo['’]y|och|ochib|oching|ko['’]rsat|ijro|tanla)\b/;
  const RESULT_NOUN = /\b(video\w*|result\w*|link\w*|site\w*|sayt\w*|natija\w*)\b/;
  const ORD_PATTERNS = [
    /\b(\d{1,2})\s*(?:st|nd|rd|th|chi|inchi|nchi)\b/,                               // 1st, 3rd, 2-chi
    /\b(?:number|no|#)\s*(\d{1,2})\b/,                                              // number 3
    /\b(\d{1,2})[\s\-]*(?:video|result|link|site|sayt|natija)/,                     // 3 video
    /(?:video|result|link|site|sayt|natija)[\s\-]*(\d{1,2})\b/,                     // video 3
  ];
  function detectOpenResult(t) {
    // Fe'l SHART ("open"/"play"/"click"...). NOUN endi IXTIYORIY: "open first" ham
    //   "open first result" kabi tushuniladi (foydalanuvchi ko'pincha "video"/"result"
    //   so'zini aytmaydi). Ordinal signalning o'zi (so'z-ordinal "first", yoki raqam+
    //   suffiks "3rd", yoki noun+raqam "video 2") kerakli aniqlikni beradi.
    if (!RESULT_VERB.test(t)) return null;
    let idx = null;
    for (const w of Object.keys(WORD_ORD)) {
      if (new RegExp('\\b' + w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b').test(t)) { idx = WORD_ORD[w]; break; }
    }
    if (idx == null) {
      for (const rx of ORD_PATTERNS) { const m = t.match(rx); if (m) { idx = parseInt(m[1], 10); break; } }
    }
    if (idx == null || idx < 1 || idx > 30) return null;
    return { type: 'open_result', index: idx };
  }

  // set_volume: "louder 5" (+50) / "lower 3" (-30) / "quieter" / "mute" / "volume 50".
  const VOL_UP = /\b(louder|volume up|turn up|raise (?:the )?volume|increase (?:the )?volume|loud sound|up volume|more volume)\b/;
  const VOL_DOWN = /\b(quieter|softer|volume down|turn down|lower (?:the )?volume|decrease (?:the )?volume|reduce (?:the )?volume|lower sound|down volume|less volume|lower)\b/;
  const VOL_MUTE = /\b(mute|silence|no sound|ovozsiz)\b/;
  const VOL_UNMUTE = /\b(unmute|un mute)\b/;
  const VOL_MAX = /\b(max volume|full volume|maximum volume|volume max)\b/;
  const VOL_SET = /\b(?:set )?volume\s+(?:to\s+)?(\d{1,3})\b/;
  const VOL_NUM = /\b(\d{1,2})\b/;
  function detectVolume(t) {
    if (VOL_UNMUTE.test(t)) return { type: 'set_volume', level: 60 };
    if (VOL_MUTE.test(t)) return { type: 'set_volume', level: 0 };
    if (VOL_MAX.test(t)) return { type: 'set_volume', level: 100 };
    // Absolute "set volume 50" (aniq "volume N").
    let m = t.match(VOL_SET);
    if (m) { let lv = parseInt(m[1], 10); if (lv <= 10) lv = lv * 10; return { type: 'set_volume', level: Math.max(0, Math.min(100, lv)) }; }
    const up = VOL_UP.test(t), down = VOL_DOWN.test(t);
    if (!up && !down) return null;
    let n = null; const nm = t.match(VOL_NUM); if (nm) n = parseInt(nm[1], 10);
    const step = (n != null && n >= 1 && n <= 10) ? n * 10 : 20;  // N×10; sonsiz — 20 (2 pog'ona)
    return { type: 'set_volume', delta: up ? step : -step };
  }

  // Click: "click X" / "bosing X" — aniq target, arbitrary JS YO'Q.
  const CLICK_RX = /\b(click|tap|bos|bosgin|bosing)\b/;
  const CLICK_TARGET = /\b(?:click|tap|bos|bosgin|bosing)\s+(?:on\s+)?(.+?)(?:\s+(?:tugma|button|link|ni|ga))?\s*$/i;
  function detectClick(t) {
    if (!CLICK_RX.test(t)) return null;
    const m = t.match(CLICK_TARGET);
    if (!m) return null;
    let target = m[1].trim().replace(/['’]/g, '');
    if (/[<>{}();`\\]/.test(target)) return null;
    if (!target || target.length < 2 || target.length > 60) return null;
    if (/^(shu|bu|o['’]sha|it|this|that|here|there)$/i.test(target)) return null;
    return { type: 'click', target };
  }

  /**
   * @returns {null | { actions:[...], source:'local' }}  null → interpreter qaror qiladi.
   */
  function detect(text) {
    const t = norm(text);
    if (!t) return null;
    if (COMPLEX_MULTI.test(t)) return null;

    // open_result ("open first video") — RANKING gate'dan OLDIN.
    const res = detectOpenResult(t);  if (res)    return { actions: [res],    source: 'local' };
    // set_volume ("volume up/down") — scroll RULES'dan OLDIN ("up"/"down" ziddiyati).
    const vol = detectVolume(t);      if (vol)    return { actions: [vol],    source: 'local' };

    if (RANKING.test(t)) return null;

    for (const r of RULES) {
      if (r.rx.test(t) && (!r.when || r.when(t))) {
        return { actions: [{ ...r.act }], source: 'local' };
      }
    }
    const open = detectOpenSite(t);   if (open)   return { actions: [open],   source: 'local' };
    const type = detectTypeText(t);   if (type)   return { actions: [type],   source: 'local' };
    const srch = detectSearch(t);     if (srch)   return { actions: [srch],   source: 'local' };
    const clk  = detectClick(t);      if (clk)    return { actions: [clk],    source: 'local' };
    return null;
  }

  return { detect, norm };
}));
