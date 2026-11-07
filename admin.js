/* لوحة MIDO: بتعدّل ملفات قايمة MIDO على GitHub من المتصفح.
   المفتاح (token) بيتحفظ في المتصفح ده بس (localStorage) ومابيتبعتش غير لـ api.github.com. */
(function () {
  'use strict';

  // ---------- الإعدادات ----------
  var host = /^([a-z0-9-]+)\.github\.io$/i.exec(location.hostname);
  var seg0 = location.pathname.split('/').filter(Boolean)[0] || '';
  var CFG = { owner: 'Midodorgham', repo: 'mido-lists', branch: 'main', html: '' };
  if (host) {
    CFG.owner = host[1];
    CFG.repo = seg0 && !/\.html?$/i.test(seg0) ? seg0 : host[1] + '.github.io';
  }

  var TOKEN_KEY = 'mido_admin_token';
  var TOKEN_URL = 'https://github.com/settings/tokens/new?scopes=public_repo&description=MIDO%20Admin';
  var FT = 'https://raw.githubusercontent.com/Free-TV/IPTV/master/playlists/playlist_';
  var MAX_UPLOAD = 5 * 1024 * 1024;
  // [اسم القايمة في Free-TV, الاسم بالعربي, علامة, مفعّلة من الأول]
  var PRESETS = [
    ['egypt', 'مصر', '🇪🇬', true],
    ['zz_news_ar', 'أخبار عربي', '📰', true],
    ['zz_documentaries_ar', 'وثائقي عربي', '🌍', true],
    ['saudi_arabia', 'السعودية', '🇸🇦', true],
    ['united_arab_emirates', 'الإمارات', '🇦🇪', true],
    ['qatar', 'قطر', '🇶🇦'],
    ['lebanon', 'لبنان', '🇱🇧'],
    ['iraq', 'العراق', '🇮🇶'],
    ['zz_movies', 'قنوات أفلام (إنجليزي)', '🎬'],
    ['zz_documentaries_en', 'وثائقي (إنجليزي)', '🌎'],
    ['zz_news_en', 'أخبار (إنجليزي)', '🗞️']
  ];
  var LINKS = [
    ['📱', 'تطبيق MIDO للآيفون', 'آخر نسخة، بتتسطّب بـ Sideloadly', 'https://github.com/Midodorgham/mido-tv-ios/releases/tag/ios-sideload'],
    ['📊', 'MIDO Manager', 'العملاء والاشتراكات والفلوس', 'https://claude.ai/artifact/EriAN7BJBKXJY246Bi9jSX'],
    ['🛒', 'صفحة البيع', 'الباقات والطلب على واتساب', 'https://claude.ai/artifact/9SARMrWWnqrA5gE26henxk'],
    ['📘', 'دليل السيرفر', 'السيرفر والمصادر القانونية خطوة بخطوة', 'https://claude.ai/artifact/HodZCVdcPNuPXNXbbAxMHz'],
    ['🗂️', 'ملفات القايمة على GitHub', 'لو حبيت تشوف الملفات نفسها', ''],
    ['📺', 'مصدر القنوات المجانية', 'Free-TV: قنوات مجانية رسمية بس', 'https://github.com/Free-TV/IPTV']
  ];
  var SRC_HEADER = [
    '# قوايم أونلاين: كل سطر = لينك قايمة M3U بتتنزل من جديد كل يوم وتتضاف لـ mido.m3u',
    '# أسهل طريقة تعدّلها: من «لوحة MIDO» (قسم «قوايم أونلاين»).',
    '# السطر اللي بيبدأ بـ # مقفول. ماتحطش لينك اشتراك فيه يوزر وباسورد (هيتشال لوحده).'
  ];
  var CRED_MSG = '🚫 ده لينك اشتراك (فيه يوزر وباسورد). الـ repo عام وأي حد يقدر يشوفه، فده هيكشف بيانات اشتراكك، وكمان مينفعش تعيد توزيع اشتراك إنت مشترك فيه. حط بس لينكات ليك حق تعرضها.';
  var CRED_FILE_MSG = '🚫 الملف ده كله لينكات اشتراك (فيها يوزر وباسورد)، فمش هنرفعه: الـ repo عام وده هيكشف بيانات اشتراكك، ومينفعش تعيد توزيع اشتراك إنت مشترك فيه.';
  var CRED_SRC_MSG = '🚫 ده لينك اشتراك (فيه يوزر وباسورد)، مينفعش يتحط هنا: الـ repo عام وده هيكشف بيانات اشتراكك. حط لينكات قوايم عامة بس، زي قوايم Free-TV.';

  // ---------- أدوات صغيرة ----------
  function $(s) { return document.querySelector(s); }
  function h(tag, attrs) {
    var e = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function (k) {
      var v = attrs[k];
      if (v == null || v === false) return;
      if (k === 'text') e.textContent = v;
      else if (k === 'class') e.className = v;
      else if (k.slice(0, 2) === 'on') e.addEventListener(k.slice(2), v);
      else e.setAttribute(k, v === true ? '' : String(v));
    });
    for (var i = 2; i < arguments.length; i++) append(e, arguments[i]);
    return e;
  }
  function append(e, c) {
    if (c == null || c === false) return;
    if (Array.isArray(c)) { c.forEach(function (x) { append(e, x); }); return; }
    e.appendChild(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  function show(sel, on) { var e = typeof sel === 'string' ? $(sel) : sel; if (e) e.hidden = !on; }
  function msg(sel, text) { var e = $(sel); e.textContent = text || ''; e.hidden = !text; }
  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
  function num(n) { return Number(n || 0).toLocaleString('ar-EG'); }
  function settle(list) {
    return Promise.all(list.map(function (p) { return Promise.resolve(p).then(function () {}, function (e) { console.warn(e); }); }));
  }
  function ago(iso) {
    var s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
    if (!isFinite(s)) return '';
    if (s < 60) return 'من شوية';
    function say(n, one, two, few, many) { return n === 1 ? one : n === 2 ? two : n <= 10 ? 'من ' + num(n) + ' ' + few : 'من ' + num(n) + ' ' + many; }
    var m = Math.round(s / 60); if (m < 60) return say(m, 'من دقيقة', 'من دقيقتين', 'دقايق', 'دقيقة');
    var hr = Math.round(m / 60); if (hr < 24) return say(hr, 'من ساعة', 'من ساعتين', 'ساعات', 'ساعة');
    var d = Math.round(hr / 24); return say(d, 'من يوم', 'من يومين', 'أيام', 'يوم');
  }
  function kb(n) { n = Number(n || 0); return n < 1024 * 1024 ? num(Math.max(1, Math.round(n / 1024))) + ' ك.ب' : num(Math.round(n / 104857.6) / 10) + ' م.ب'; }

  // نفس تنضيف اللينكات اللي في التطبيق (النسخ من شات عربي بيحط علامات مخفية)
  function stripInvisible(s) { return String(s == null ? '' : s).replace(/[​-‏‪-‮⁠-⁩﻿]/g, '').trim(); }
  function cleanUrl(s) {
    s = stripInvisible(s);
    var m = s.match(/https?:\/\/[^\s"'<>`]+/i);
    if (m) s = m[0];
    return s.replace(/[)\]}.,;:!?،؛]+$/, '');
  }
  function isHttp(u) { return /^https?:\/\/[^\s\/?#]+([\/?#]\S*)?$/i.test(String(u || '')); }
  // لينك اشتراك؟ (يوزر وباسورد جوه اللينك، زي لوحات Xtream) — نفس الفحص اللي في build-list.sh
  function isCred(u) {
    u = String(u || '').toLowerCase();
    if (/[?&](username|user)=[^&#]+/.test(u) && /[?&](password|pass)=[^&#]+/.test(u)) return true;
    if (/\/(live|movie|movies|series)\/[^\/?#]+\/[^\/?#]+\/\d+(\.[a-z0-9]+)?([?#]|$)/.test(u)) return true;
    return /\/timeshift\/[^\/?#]+\/[^\/?#]+\//.test(u);
  }

  // نفس تقسيم التطبيق: مسلسلات ثم أفلام ثم لايف
  var MOVIE_RE = /vod|movie|film|فيلم|[اأإآ]فلام/i, SERIES_RE = /series|مسلسل|season|s\d+e\d+/i;
  function kindOf(group, name, url) {
    if (SERIES_RE.test(group + ' ' + name)) return 'series';
    if (MOVIE_RE.test(group) || /\.(mp4|mkv|avi)(\?|$)/.test(String(url).toLowerCase())) return 'movie';
    return 'live';
  }
  var KIND = { movie: ['🎬', 'الأفلام'], series: ['📺', 'المسلسلات'], live: ['🔴', 'اللايف'] };
  function fixGroup(kind, group) {
    var g = stripInvisible(group).replace(/\s+/g, ' ').replace(/"/g, "'");
    if (kind === 'movie') return !g ? 'أفلام' : MOVIE_RE.test(g) ? g : 'أفلام ' + g;
    if (kind === 'series') return !g ? 'مسلسلات' : /series|مسلسل|season/i.test(g) ? g : 'مسلسلات ' + g;
    return g || 'قنوات';
  }

  // ---------- M3U ----------
  function normNL(s) { return String(s || '').replace(/^﻿/, '').replace(/\r\n?/g, '\n'); }
  function entryOf(lines) {
    var inf = lines[0].trim(), url = lines[lines.length - 1].trim();
    var name = (inf.split(',').pop() || '').trim();
    var logo = (inf.match(/tvg-logo="([^"]*)"/i) || [])[1] || '';
    var group = (inf.match(/group-title="([^"]*)"/i) || [])[1] || '';
    return { type: 'entry', lines: lines, name: name, logo: logo, group: group, url: url, kind: kindOf(group, name, url) };
  }
  // بيقسم الملف لـ «بلوكات» (عنصر أو سطر عادي) عشان نعدّل عنصر من غير ما نبوّظ باقي الملف
  function parseM3U(text) {
    var lines = normNL(text).split('\n'), blocks = [], cur = null;
    lines.forEach(function (line) {
      var t = line.trim();
      if (/^#EXTINF/i.test(t)) { if (cur) blocks.push({ type: 'raw', lines: cur }); cur = [line]; return; }
      if (cur) {
        cur.push(line);
        if (t && t.charAt(0) !== '#') { blocks.push(entryOf(cur)); cur = null; }
        return;
      }
      blocks.push({ type: 'raw', lines: [line] });
    });
    if (cur) blocks.push({ type: 'raw', lines: cur });
    return blocks;
  }
  function joinBlocks(blocks) { return blocks.map(function (b) { return b.lines.join('\n'); }).join('\n'); }
  function entries(blocks) { return blocks.filter(function (b) { return b.type === 'entry'; }); }
  function sameEntry(b, orig) { return b.type === 'entry' && b.lines.join('\n') === orig; }
  function makeLines(o) {
    function one(s) { return stripInvisible(s).replace(/[\r\n\t]+/g, ' ').replace(/\s{2,}/g, ' ').trim(); }
    var inf = '#EXTINF:-1';
    var logo = one(o.logo).replace(/"/g, '%22');
    if (logo) inf += ' tvg-logo="' + logo + '"';
    inf += ' group-title="' + one(o.group).replace(/"/g, "'") + '",' + one(o.name).replace(/,/g, '،');
    return [inf, o.url];
  }
  function kindCounts(list) {
    var c = { live: 0, movie: 0, series: 0 };
    list.forEach(function (b) { c[b.kind]++; });
    return c;
  }

  // ---------- GitHub ----------
  var TOKEN = '';
  var store = {
    get: function () { try { return localStorage.getItem(TOKEN_KEY) || ''; } catch (e) { return ''; } },
    set: function (v) { try { localStorage.setItem(TOKEN_KEY, v); } catch (e) {} },
    del: function () { try { localStorage.removeItem(TOKEN_KEY); } catch (e) {} }
  };
  function fail(status, message, code) { var e = new Error(message || ('HTTP ' + status)); e.status = status; e.code = code || ''; return e; }
  function repoPath() { return '/repos/' + encodeURIComponent(CFG.owner) + '/' + encodeURIComponent(CFG.repo); }
  function gh(path, opt) {
    opt = opt || {};
    var url = 'https://api.github.com' + (path.charAt(0) === '/' ? path : repoPath() + '/' + path);
    var headers = { Accept: opt.raw ? 'application/vnd.github.raw+json' : 'application/vnd.github+json' };
    if (TOKEN) headers.Authorization = 'Bearer ' + TOKEN;
    if (opt.body) headers['Content-Type'] = 'application/json';
    return fetch(url, { method: opt.method || 'GET', headers: headers, body: opt.body ? JSON.stringify(opt.body) : undefined, cache: 'no-store' })
      .then(null, function () { throw fail(0, 'net', 'net'); })
      .then(function (r) {
        return r.text().then(function (text) {
          if (!r.ok) {
            var m = ''; try { m = JSON.parse(text).message || ''; } catch (e) {}
            throw fail(r.status, m);
          }
          gh.scopes = r.headers.get('X-OAuth-Scopes');
          if (opt.raw) return text;
          return text ? JSON.parse(text) : null;
        });
      });
  }
  function enc(p) { return p.split('/').map(encodeURIComponent).join('/'); }
  function q() { return 'ref=' + encodeURIComponent(CFG.branch) + '&t=' + Date.now(); }
  function b64e(str) {
    var bytes = new TextEncoder().encode(str), bin = '';
    for (var i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(bin);
  }
  function b64d(s) {
    var bin = atob(String(s || '').replace(/\s+/g, '')), bytes = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new TextDecoder().decode(bytes);
  }
  function getFile(path) {
    return gh('contents/' + enc(path) + '?' + q()).then(function (j) {
      if (!j || Array.isArray(j) || j.type !== 'file') throw fail(400, 'not a file');
      if (j.content || !j.size) return { text: normNL(j.content ? b64d(j.content) : ''), sha: j.sha };
      return gh('contents/' + enc(path) + '?' + q(), { raw: true }).then(function (t) { return { text: normNL(t), sha: j.sha }; });
    }, function (e) { if (e.status === 404) return null; throw e; });
  }
  function listDir(path) {
    return gh('contents/' + enc(path) + '?' + q()).then(function (j) { return Array.isArray(j) ? j : []; },
      function (e) { if (e.status === 404) return []; throw e; });
  }
  function putFile(path, text, sha, message) {
    var body = { message: message, content: b64e(text), branch: CFG.branch };
    if (sha) body.sha = sha;
    return gh('contents/' + enc(path), { method: 'PUT', body: body });
  }
  function delFile(path, sha, message) {
    return gh('contents/' + enc(path), { method: 'DELETE', body: { message: message, sha: sha, branch: CFG.branch } });
  }
  // يقرا الملف، يطبّق التعديل، ويحفظ. لو الملف اتغيّر في النص (من جهاز تاني) يعيد المحاولة.
  function editFile(path, change, message) {
    var tries = 0;
    function attempt() {
      return getFile(path).then(function (cur) {
        var next = change(cur ? cur.text : null);
        if (next == null || (cur && next === cur.text)) return { text: cur ? cur.text : '', res: null };
        return putFile(path, next, cur && cur.sha, message).then(function (res) { return { text: next, res: res }; }, function (e) {
          if ((e.status === 409 || e.status === 422) && ++tries < 3) return sleep(700).then(attempt);
          throw e;
        });
      });
    }
    return attempt();
  }
  function commitSha(res) { return res && res.commit && res.commit.sha; }
  function rawLink() { return 'https://raw.githubusercontent.com/' + CFG.owner + '/' + CFG.repo + '/' + CFG.branch + '/mido.m3u'; }
  function repoUrl() { return CFG.html || 'https://github.com/' + CFG.owner + '/' + CFG.repo; }

  function errText(e) {
    if (!e) return 'حصلت مشكلة.';
    if (e.code === 'net') return 'مفيش نت، أو GitHub مش بيرد. جرّب تاني.';
    if (e.code === 'gone') return 'العنصر ده اتغيّر من جهاز تاني. حدّثنا القايمة، جرّب تاني.';
    if (e.status === 401) return 'المفتاح غلط أو انتهت مدته. دوس «خروج» واعمل مفتاح جديد.';
    if (e.status === 403 && /rate limit/i.test(e.message)) return 'GitHub موقّفنا شوية عشان طلبات كتير. استنى دقيقة وجرّب تاني.';
    if (e.status === 403 || e.status === 404) return 'المفتاح ده مالوش صلاحية تعديل على القايمة. اعمل مفتاح جديد من زرار «اعمل مفتاح» (لازم يبقى فيه public_repo).';
    if (e.status === 409) return 'الملف اتغيّر من مكان تاني. دوس «تحديث الصفحة» وجرّب تاني.';
    if (e.status === 413 || /too large/i.test(e.message)) return 'الملف كبير أوي.';
    return 'حصلت مشكلة: ' + (e.message || 'مش معروفة') + '.';
  }

  // ---------- الحالة ----------
  var S = { mine: { text: null, blocks: [] }, files: [], src: null, info: null, kind: 'movie', editing: null, upload: null, watch: null, q: '' };

  // ---------- الدخول ----------
  function connect(token) {
    TOKEN = token;
    var login = '';
    return gh('/user').then(function (u) {
      login = u && u.login || '';
      var scopes = gh.scopes;
      return gh(repoPath()).then(function (repo) {
        if (repo.permissions && repo.permissions.push === false) throw fail(403, '', 'nopush');
        if (scopes != null && !/(^|[\s,])(public_repo|repo)([\s,]|$)/.test(scopes)) throw fail(403, '', 'scope');
        CFG.owner = repo.owner && repo.owner.login || CFG.owner;
        CFG.repo = repo.name || CFG.repo;
        CFG.branch = repo.default_branch || CFG.branch;
        CFG.html = repo.html_url || '';
        return login;
      }, function (e) { if (e.status === 404) throw fail(404, '', 'norepo'); throw e; });
    }).then(null, function (e) { e.login = login; throw e; });
  }
  function setupError(e) {
    if (e.code === 'norepo') return 'مفيش repo اسمه «' + CFG.repo + '» على حساب ' + CFG.owner + '. اتأكد إنه اتعمل (Public).';
    if (e.code === 'nopush') return 'المفتاح ده من حساب «' + (e.login || '؟') + '»، والقايمة على حساب «' + CFG.owner + '». اعمل المفتاح وإنت داخل بحساب ' + CFG.owner + '.';
    if (e.code === 'scope') return 'المفتاح ده ناقصه صلاحية public_repo. اعمله تاني من زرار «اعمل مفتاح» من غير ما تشيل العلامة اللي عليها.';
    if (e.status === 401) return 'المفتاح ده مش شغال (غلط أو انتهت مدته). اعمل واحد جديد وانسخه كله.';
    return errText(e);
  }
  function showSetup(err) {
    show('#loading', false); show('#main', false); show('#offline', false); show('#who', false);
    show('#setup', true);
    msg('#tok-err', err || '');
  }
  function showMain(login) {
    show('#loading', false); show('#setup', false); show('#offline', false);
    show('#main', true); show('#who', true);
    $('#who-name').textContent = '👤 ' + (login || CFG.owner);
    $('#dev-link').textContent = rawLink();
    renderLinks();
  }
  function start() {
    show('#loading', true); show('#setup', false); show('#offline', false);
    return connect(TOKEN).then(function (login) { showMain(login); return loadAll(); }, function (e) {
      if (e.code === 'net') { show('#loading', false); show('#offline', true); return; }
      if (e.status === 401) { store.del(); TOKEN = ''; showSetup('المفتاح اللي كان محفوظ انتهت مدته أو اتلغى. اعمل مفتاح جديد.'); return; }
      showSetup(setupError(e));
    });
  }
  function saveToken() {
    var btn = $('#tok-save');
    var t = stripInvisible($('#tok').value).replace(/\s+/g, '');
    if (!/^(gh[pousr]_|github_pat_)[A-Za-z0-9_]{20,}$/.test(t)) { msg('#tok-err', 'ده مش شكل مفتاح GitHub. المفتاح بيبدأ بـ ghp_، انسخه كله.'); return; }
    msg('#tok-err', '');
    busy(btn, true);
    connect(t).then(function (login) {
      store.set(t); $('#tok').value = '';
      showMain(login); toast('✅ اتربطت الصفحة بحسابك'); return loadAll();
    }, function (e) { TOKEN = ''; msg('#tok-err', setupError(e)); })
      .then(function () { busy(btn, false); });
  }
  function logout() {
    if (!confirm('تخرج وتمسح المفتاح من الجهاز ده؟')) return;
    store.del(); TOKEN = ''; S.watch = null;
    showSetup('');
  }

  function busy(btn, on) { if (!btn) return; btn.disabled = !!on; btn.classList.toggle('busy', !!on); }
  var toastTimer = 0;
  function toast(text, bad) {
    var t = $('#toast');
    t.textContent = text; t.className = 'toast show' + (bad ? ' bad' : '');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.className = 'toast'; }, bad ? 6500 : 3800);
  }
  function run(btn, job, onErr) {
    busy(btn, true);
    return Promise.resolve().then(job).then(null, function (e) {
      if (onErr && onErr(e) === true) return;
      toast(errText(e), true);
      if (e && e.code === 'gone') loadMine();
    }).then(function () { busy(btn, false); });
  }

  // ---------- التحميل ----------
  function loadAll() { return settle([loadMine(), loadFiles(), loadSources(), loadStatus()]); }
  function loadMine() {
    return getFile('my-list.m3u').then(function (f) { msg('#mine-err', ''); setMine(f ? f.text : null); },
      function (e) { msg('#mine-err', errText(e)); });
  }
  function loadFiles() {
    return listDir('lists').then(function (items) {
      msg('#files-err', '');
      S.files = items.filter(function (x) { return x.type === 'file' && /\.m3u8?$/i.test(x.name); });
      renderFiles();
    }, function (e) { msg('#files-err', errText(e)); });
  }
  function loadSources() {
    return getFile('sources.txt').then(function (f) {
      msg('#online-err', '');
      var urls = f ? f.text.split('\n').map(function (l) { return l.trim(); }).filter(function (l) { return l && l.charAt(0) !== '#'; })
        : PRESETS.filter(function (p) { return p[3]; }).map(function (p) { return FT + p[0] + '.m3u8'; });
      S.src = { on: {}, custom: [], dirty: false };
      urls.forEach(function (u) {
        var key = presetKey(u);
        if (key) S.src.on[key] = true;
        else if (S.src.custom.indexOf(u) < 0) S.src.custom.push(u);
      });
      renderSources();
    }, function (e) { msg('#online-err', errText(e)); });
  }
  function loadInfo() {
    return getFile('build-info.json').then(function (f) {
      try { S.info = f ? JSON.parse(f.text) : null; } catch (e) { S.info = null; }
      renderStats(); renderFiles(); renderSources();
    }, function () { renderStats(); });
  }
  function latestRun() {
    return gh('actions/workflows/build.yml/runs?per_page=1&t=' + Date.now()).then(function (j) {
      return (j && j.workflow_runs || [])[0] || null;
    }, function (e) { if (e.status === 404) return null; throw e; });
  }
  function loadStatus() {
    $('#dev-link').textContent = rawLink();
    return settle([loadInfo(), latestRun().then(renderRun, function () { renderRun(undefined); })]);
  }

  // ---------- العرض ----------
  function renderStats() {
    var box = $('#stats'), i = S.info;
    box.textContent = '';
    if (!i) { append(box, h('span', { class: 'chip dim', text: 'العدد هيظهر بعد أول تحديث للقايمة' })); return; }
    append(box, [
      i.live ? h('span', { class: 'chip', text: '🔴 لايف ' + num(i.live) }) : null,
      i.movie ? h('span', { class: 'chip', text: '🎬 أفلام ' + num(i.movie) }) : null,
      i.series ? h('span', { class: 'chip', text: '📺 مسلسلات ' + num(i.series) }) : null,
      h('span', { class: 'chip dim', text: 'الكل ' + num(i.total) })
    ]);
    if (i.removed > 0) append(box, h('span', { class: 'chip warn', text: '🚫 اتشال ' + num(i.removed) + ' لينك اشتراك' }));
  }
  function renderRun(r) {
    var pub = $('#pub');
    pub.textContent = '';
    if (r === undefined) { append(pub, [h('span', { class: 'dot' }), 'مش قادرين نعرف حالة آخر تحديث دلوقتي.']); return; }
    if (!r) { append(pub, [h('span', { class: 'dot' }), 'القايمة لسه ماتعملتش ولا مرة. أول ما تضيف حاجة هتتعمل لوحدها.']); return; }
    if (r.status !== 'completed') { append(pub, [h('span', { class: 'dot busy' }), 'بنجهّز القايمة الجديدة… (أقل من دقيقة غالبًا)']); return; }
    if (r.conclusion === 'success') { append(pub, [h('span', { class: 'dot ok' }), 'القايمة اتحدّثت ' + ago(r.updated_at || r.created_at)]); return; }
    if (r.conclusion === 'cancelled' || r.conclusion === 'skipped') { append(pub, [h('span', { class: 'dot' }), 'آخر تحديث اتلغى، والتحديث الجاي هيتعمل لوحده.']); return; }
    append(pub, [h('span', { class: 'dot bad' }), 'آخر تحديث للقايمة ماكملش. ',
      isHttp(r.html_url) ? h('a', { href: r.html_url, target: '_blank', rel: 'noopener noreferrer', text: 'التفاصيل' }) : null]);
  }
  function thumb(logo, emoji) {
    var box = h('div', { class: 'thumb', 'aria-hidden': 'true' }, emoji);
    if (isHttp(logo)) {
      var img = h('img', { alt: '', loading: 'lazy', decoding: 'async', referrerpolicy: 'no-referrer' });
      img.addEventListener('error', function () { img.remove(); });
      img.src = logo;
      box.appendChild(img);
    }
    return box;
  }
  function setMine(text) {
    S.mine = { text: text, blocks: parseM3U(text || '') };
    renderMine();
  }
  function renderMine() {
    var list = entries(S.mine.blocks).slice().reverse();   // الأحدث فوق
    $('#mine-count').textContent = num(list.length);
    show('#mine-q', list.length > 8);
    show('#mine-empty', !list.length);
    var qq = S.q.toLowerCase();
    var shown = qq ? list.filter(function (b) { return (b.name + ' ' + b.group + ' ' + b.url).toLowerCase().indexOf(qq) >= 0; }) : list;
    var ul = $('#mine');
    ul.textContent = '';
    shown.slice(0, 200).forEach(function (b) {
      var k = KIND[b.kind];
      append(ul, h('li', { class: 'item' }, thumb(b.logo, k[0]),
        h('div', { class: 'meta' },
          h('b', { text: b.name || '(من غير اسم)' }),
          h('small', { text: k[0] + ' ' + k[1] + (b.group ? ' · ' + b.group : '') }),
          h('span', { class: 'url', dir: 'ltr', text: b.url }),
          h('div', { class: 'acts' },
            h('button', { type: 'button', class: 'mini', onclick: function () { startEdit(b); } }, '✏️ تعديل'),
            h('button', { type: 'button', class: 'mini danger', onclick: function (ev) { delEntry(b, ev.currentTarget); } }, '🗑️ مسح'),
            isHttp(b.url) ? h('a', { class: 'mini', href: b.url, target: '_blank', rel: 'noopener noreferrer' }, '▶️ تجربة') : null))));
    });
    var more = shown.length - 200;
    msg('#mine-more', more > 0 ? 'وفيه ' + num(more) + ' كمان. دوّر بالاسم عشان تلاقيهم.' : (qq && !shown.length ? 'مفيش حاجة بالاسم ده.' : ''));
    var dl = $('#groups'), seen = {};
    dl.textContent = '';
    list.forEach(function (b) { if (b.group && !seen[b.group]) { seen[b.group] = 1; append(dl, h('option', { value: b.group })); } });
  }
  function fileInfo(name) {
    var f = S.info && S.info.files || [];
    for (var i = 0; i < f.length; i++) if (f[i].name === name) return f[i];
    return null;
  }
  function renderFiles() {
    var ul = $('#files');
    ul.textContent = '';
    $('#files-count').textContent = num(S.files.length);
    show('#files-empty', !S.files.length);
    S.files.forEach(function (f) {
      var inf = fileInfo(f.name);
      append(ul, h('li', { class: 'item' }, h('div', { class: 'thumb', 'aria-hidden': 'true' }, '📄'),
        h('div', { class: 'meta' },
          h('b', { dir: 'auto', text: f.name.replace(/\.m3u8?$/i, '') }),
          h('small', { text: kb(f.size) + (inf ? ' · ' + num(inf.count) + ' قناة/فيلم' : '') }),
          h('div', { class: 'acts' },
            h('button', { type: 'button', class: 'mini danger', onclick: function (ev) { delList(f, ev.currentTarget); } }, '🗑️ مسح'),
            isHttp(f.html_url) ? h('a', { class: 'mini', href: f.html_url, target: '_blank', rel: 'noopener noreferrer' }, '👁️ عرض') : null))));
    });
  }
  function presetKey(u) {
    for (var i = 0; i < PRESETS.length; i++) if (u === FT + PRESETS[i][0] + '.m3u8') return PRESETS[i][0];
    return '';
  }
  function srcInfo(url) {
    var s = S.info && S.info.sources || [];
    for (var i = 0; i < s.length; i++) if (s[i].url === url) return s[i];
    return null;
  }
  function srcNote(inf) {
    if (!inf) return '';
    if (inf.status === 'failed') return '⚠️ مانزلتش';
    return num(inf.count) + (inf.status === 'cached' ? ' (آخر نسخة)' : '');
  }
  function renderSources() {
    if (!S.src) return;
    var box = $('#presets');
    box.textContent = '';
    PRESETS.forEach(function (p) {
      var key = p[0], on = !!S.src.on[key], note = on ? srcNote(srcInfo(FT + key + '.m3u8')) : '';
      append(box, h('button', {
        type: 'button', class: 'tg', 'aria-pressed': on ? 'true' : 'false',
        onclick: function () { if (S.src.on[key]) delete S.src.on[key]; else S.src.on[key] = true; S.src.dirty = true; renderSources(); }
      }, p[2] + ' ' + p[1], note ? h('small', { text: ' · ' + note }) : null));
    });
    var ul = $('#custom');
    ul.textContent = '';
    S.src.custom.forEach(function (u, i) {
      var note = srcNote(srcInfo(u));
      append(ul, h('li', { class: 'item' }, h('div', { class: 'thumb', 'aria-hidden': 'true' }, '🌐'),
        h('div', { class: 'meta' },
          h('span', { class: 'url', dir: 'ltr', text: u, style: 'font-size:13px;color:var(--txt)' }),
          note ? h('small', { text: note }) : null,
          h('div', { class: 'acts' },
            h('button', { type: 'button', class: 'mini danger', onclick: function () { S.src.custom.splice(i, 1); S.src.dirty = true; renderSources(); } }, '✕ شيل')))));
    });
    $('#src-save').disabled = !S.src.dirty;
    $('#src-state').textContent = S.src.dirty ? 'فيه تغييرات لسه ماتحفظتش' : '';
  }
  function renderLinks() {
    var box = $('#links');
    box.textContent = '';
    LINKS.forEach(function (l) {
      var href = l[3] || repoUrl();
      append(box, h('a', { href: href, target: '_blank', rel: 'noopener noreferrer' },
        h('span', { class: 'ic', 'aria-hidden': 'true' }, l[0]),
        h('span', null, h('b', { text: l[1] }), h('small', { text: l[2] }))));
    });
  }

  // ---------- متابعة النشر ----------
  // بعد أي حفظ، GitHub بيجمع القايمة من جديد (أقل من دقيقة). بنتابع لحد ما يخلص.
  function watchPublish(sha) {
    var me = {}; S.watch = me;
    var t0 = Date.now();
    renderRun({ status: 'queued' });
    function tick() {
      if (S.watch !== me) return;
      if (Date.now() - t0 > 240000) { S.watch = null; loadStatus(); return; }
      latestRun().then(function (r) {
        if (S.watch !== me) return;
        if (r && (!sha || r.head_sha === sha)) {
          if (r.status === 'completed') {
            S.watch = null;
            renderRun(r);
            if (r.conclusion === 'success') { loadInfo(); toast('📡 القايمة الجديدة جاهزة. هتظهر في الأجهزة خلال حوالي ٥ دقايق.'); }
            return;
          }
          renderRun(r);
        }
        setTimeout(tick, 5000);
      }, function () { setTimeout(tick, 8000); });
    }
    setTimeout(tick, 4000);
  }

  // ---------- إضافة / تعديل ----------
  var NAME_PH = { movie: 'اسم الفيلم', series: 'اسم المسلسل ورقم الحلقة، مثلًا: الحلقة ١', live: 'اسم القناة' };
  function setKind(k) {
    S.kind = k;
    Array.prototype.forEach.call(document.querySelectorAll('#kinds button'), function (b) { b.setAttribute('aria-pressed', b.getAttribute('data-kind') === k ? 'true' : 'false'); });
    $('#f-name').placeholder = NAME_PH[k];
    updatePreview();
  }
  function formValues() {
    var name = stripInvisible($('#f-name').value), url = cleanUrl($('#f-url').value);
    var logoIn = stripInvisible($('#f-logo').value), logo = logoIn ? cleanUrl(logoIn) : '';
    return { name: name, url: url, logo: logo, logoIn: logoIn, group: fixGroup(S.kind, $('#f-group').value) };
  }
  function updatePreview() {
    var v = formValues(), k = kindOf(v.group, v.name, v.url), where = $('#f-where');
    where.textContent = '';
    append(where, ['هيظهر في: ', h('b', { text: KIND[k][0] + ' ' + KIND[k][1] }), ' ← قسم «' + v.group + '»']);
    if (k !== S.kind) append(where, h('span', { class: 'warn', style: 'display:block;margin:2px 0 0', text: k === 'movie' ? '(عشان اللينك mp4 أو اسم القسم فيه «أفلام»)' : '(عشان الاسم أو القسم فيه كلمة «مسلسل»)' }));
    var a = $('#f-test');
    if (isHttp(v.url)) { a.href = v.url; a.removeAttribute('aria-disabled'); } else { a.removeAttribute('href'); a.setAttribute('aria-disabled', 'true'); }
    var img = $('#f-img');
    if (isHttp(v.logo)) { if (img.getAttribute('src') !== v.logo) img.src = v.logo; img.hidden = false; }
    else { img.hidden = true; img.removeAttribute('src'); }
  }
  function resetForm() {
    S.editing = null;
    ['#f-name', '#f-url', '#f-group', '#f-logo'].forEach(function (s) { $(s).value = ''; });
    $('#add-title').textContent = '➕ ضيف فيلم أو قناة';
    show('#f-cancel', false);
    msg('#f-err', '');
    setKind(S.kind);
  }
  function startEdit(b) {
    S.editing = { orig: b.lines.join('\n') };
    $('#f-name').value = b.name; $('#f-url').value = b.url; $('#f-logo').value = b.logo;
    // نشيل الكلمة اللي الصفحة بتزودها لوحدها عشان ماتتكررش
    var g = b.group;
    if (b.kind === 'movie' && /^أفلام /.test(g)) g = g.replace(/^أفلام /, '');
    else if (b.kind === 'series' && /^مسلسلات /.test(g)) g = g.replace(/^مسلسلات /, '');
    else if ((b.kind === 'movie' && g === 'أفلام') || (b.kind === 'series' && g === 'مسلسلات') || (b.kind === 'live' && g === 'قنوات')) g = '';
    $('#f-group').value = g;
    $('#add-title').textContent = '✏️ تعديل «' + b.name + '»';
    show('#f-cancel', true);
    msg('#f-err', '');
    setKind(b.kind);
    $('#sec-add').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
  function saveEntry() {
    var v = formValues();
    if (!v.name) return msg('#f-err', 'اكتب الاسم الأول.');
    if (!isHttp(v.url)) return msg('#f-err', 'لينك الفيديو لازم يبدأ بـ http:// أو https://');
    if (isCred(v.url)) return msg('#f-err', CRED_MSG);
    if (v.logoIn && !isHttp(v.logo)) return msg('#f-err', 'لينك الصورة لازم يبدأ بـ http:// أو https://');
    msg('#f-err', '');
    var lines = makeLines(v), editing = S.editing;
    var dupName = '';
    return run($('#f-save'), function () {
      return editFile('my-list.m3u', function (text) {
        var base = text == null ? '#EXTM3U\n' : text, blocks = parseM3U(base);
        var dup = entries(blocks).filter(function (b) { return b.url === v.url && !(editing && sameEntry(b, editing.orig)); })[0];
        if (dup) { dupName = dup.name; throw fail(0, 'dup', 'dup'); }
        if (editing) {
          var i = -1;
          blocks.some(function (b, j) { if (sameEntry(b, editing.orig)) { i = j; return true; } return false; });
          if (i < 0) throw fail(0, 'gone', 'gone');
          blocks[i] = entryOf(lines);
          return joinBlocks(blocks);
        }
        if (base.slice(-1) !== '\n') base += '\n';
        return base + lines.join('\n') + '\n';
      }, (editing ? 'تعديل: ' : 'إضافة: ') + v.name).then(function (r) {
        setMine(r.text);
        resetForm();
        toast(editing ? '✅ اتعدّل' : '✅ اتضاف «' + v.name + '»');
        if (r.res) watchPublish(commitSha(r.res));
      });
    }, function (e) {
      if (e.code === 'dup') { msg('#f-err', 'اللينك ده موجود قبل كده في قايمتك باسم «' + dupName + '».'); return true; }
      if (e.code === 'gone') { msg('#f-err', errText(e)); resetForm(); loadMine(); return true; }
      msg('#f-err', errText(e)); return true;
    });
  }
  function delEntry(b, btn) {
    if (!confirm('تمسح «' + b.name + '» من القايمة؟')) return;
    var orig = b.lines.join('\n');
    run(btn, function () {
      return editFile('my-list.m3u', function (text) {
        var blocks = parseM3U(text || ''), i = -1;
        blocks.some(function (x, j) { if (sameEntry(x, orig)) { i = j; return true; } return false; });
        if (i < 0) throw fail(0, 'gone', 'gone');
        blocks.splice(i, 1);
        return joinBlocks(blocks);
      }, 'حذف: ' + b.name).then(function (r) {
        if (S.editing && S.editing.orig === orig) resetForm();
        setMine(r.text); toast('🗑️ اتمسح «' + b.name + '»');
        if (r.res) watchPublish(commitSha(r.res));
      });
    });
  }

  // ---------- ملفات M3U ----------
  function readFile(f) {
    return new Promise(function (res, rej) {
      var r = new FileReader();
      r.onload = function () { res(r.result); };
      r.onerror = function () { rej(r.error); };
      r.readAsArrayBuffer(f);
    });
  }
  function decode(buf) {
    try { return new TextDecoder('utf-8', { fatal: true }).decode(buf); }
    catch (e) { try { return new TextDecoder('windows-1256').decode(buf); } catch (e2) { return new TextDecoder().decode(buf); } }
  }
  var NAME_RE = (function () { try { return new RegExp('[^\\p{L}\\p{N}_-]+', 'gu'); } catch (e) { return /[^A-Za-z0-9_؀-ۿ-]+/g; } })();
  function cleanName(s) {
    return stripInvisible(s).replace(/\.(m3u8?|txt)$/i, '').toLowerCase().replace(NAME_RE, '-').replace(/-{2,}/g, '-').replace(/^-+|-+$/g, '').slice(0, 50);
  }
  function pickFile(ev) {
    var input = ev.target, f = input.files && input.files[0];
    msg('#up-err', ''); show('#up-box', false); S.upload = null;
    if (!f) return;
    if (f.size > MAX_UPLOAD) { msg('#up-err', 'الملف أكبر من ٥ ميجا. قسّمه لملفات أصغر وارفعهم واحد واحد.'); input.value = ''; return; }
    readFile(f).then(function (buf) {
      input.value = '';
      var text = normNL(decode(buf)), all = entries(parseM3U(text));
      if (!all.length) { msg('#up-err', 'الملف ده مش قايمة M3U (مفيهوش ولا قناة أو فيلم).'); return; }
      var good = all.filter(function (b) { return !isCred(b.url); }), bad = all.length - good.length;
      if (!good.length) { msg('#up-err', CRED_FILE_MSG); return; }
      var first = text.split('\n')[0].trim();
      var out = [/^#EXTM3U/i.test(first) ? first : '#EXTM3U'].concat(good.map(function (b) {
        return b.lines.map(function (l) { return l.trim(); }).filter(Boolean).join('\n');
      })).join('\n') + '\n';
      var c = kindCounts(good);
      S.upload = { text: out };
      $('#up-sum').textContent = 'الملف فيه ' + num(good.length) + ': ' + [c.live ? '🔴 لايف ' + num(c.live) : '', c.movie ? '🎬 أفلام ' + num(c.movie) : '',
        c.series ? '📺 مسلسلات ' + num(c.series) : ''].filter(Boolean).join(' · ');
      msg('#up-warn', bad ? '🚫 شلنا ' + num(bad) + ' لينك اشتراك (فيهم يوزر وباسورد): الـ repo عام وأي حد يقدر يشوفه، ومينفعش تعيد توزيع اشتراك إنت مشترك فيه.' : '');
      $('#up-name').value = cleanName(f.name) || ('list-' + new Date().toISOString().slice(0, 10));
      show('#up-box', true);
    }, function () { input.value = ''; msg('#up-err', 'مش قادرين نقرا الملف ده.'); });
  }
  function closeUpload() { S.upload = null; show('#up-box', false); $('#up-file').value = ''; msg('#up-err', ''); }
  function doUpload() {
    if (!S.upload) return;
    var nm = cleanName($('#up-name').value);
    if (!nm) { msg('#up-err', 'اكتب اسم للملف (حروف أو أرقام).'); return; }
    msg('#up-err', '');
    var path = 'lists/' + nm + '.m3u', text = S.upload.text;
    run($('#up-go'), function () {
      return listDir('lists').then(function (items) {
        var ex = items.filter(function (x) { return x.path === path; })[0];
        if (ex && !confirm('فيه ملف اسمه «' + nm + '» قبل كده. تستبدله بالجديد؟')) return;
        return putFile(path, text, ex && ex.sha, (ex ? 'تحديث ملف: ' : 'رفع ملف: ') + nm).then(function (res) {
          toast('✅ اترفع «' + nm + '»');
          closeUpload();
          loadFiles();
          watchPublish(commitSha(res));
        });
      });
    }, function (e) { msg('#up-err', errText(e)); return true; });
  }
  function delList(f, btn) {
    var nm = f.name.replace(/\.m3u8?$/i, '');
    if (!confirm('تمسح ملف «' + nm + '»؟ كل اللي فيه هيتشال من اللينك.')) return;
    run(btn, function () {
      return delFile(f.path, f.sha, 'حذف ملف: ' + nm).then(function (res) {
        toast('🗑️ اتمسح «' + nm + '»'); loadFiles(); watchPublish(commitSha(res));
      });
    });
  }

  // ---------- القوايم الأونلاين ----------
  function addSource() {
    if (!S.src) return;
    var u = cleanUrl($('#src-url').value);
    if (!isHttp(u)) return msg('#src-err', 'اللينك لازم يبدأ بـ http:// أو https://');
    if (isCred(u)) return msg('#src-err', CRED_SRC_MSG);
    if (/\/mido\.m3u(\?|$)/i.test(u) && u.toLowerCase().indexOf('/' + CFG.repo.toLowerCase() + '/') >= 0) return msg('#src-err', 'ده لينك قايمتك نفسها 🙂 مش محتاج تضيفه.');
    var key = presetKey(u);
    if (key) { if (S.src.on[key]) return msg('#src-err', 'القايمة دي متعلّم عليها فوق.'); S.src.on[key] = true; }
    else if (S.src.custom.indexOf(u) >= 0) return msg('#src-err', 'اللينك ده موجود قبل كده.');
    else S.src.custom.push(u);
    msg('#src-err', '');
    $('#src-url').value = '';
    S.src.dirty = true;
    renderSources();
  }
  function sourcesText() {
    var lines = SRC_HEADER.slice();
    PRESETS.forEach(function (p) { if (S.src.on[p[0]]) lines.push(FT + p[0] + '.m3u8'); });
    S.src.custom.forEach(function (u) { lines.push(u); });
    return lines.join('\n') + '\n';
  }
  function saveSources() {
    if (!S.src) return;
    var text = sourcesText();
    run($('#src-save'), function () {
      return editFile('sources.txt', function () { return text; }, 'تحديث القوايم الأونلاين').then(function (r) {
        S.src.dirty = false;
        toast('✅ اتحفظت القوايم');
        if (r.res) watchPublish(commitSha(r.res));
      });
    }).then(renderSources);
  }

  // ---------- لينك الأجهزة ----------
  function copyLink() {
    var v = rawLink();
    function fallback() {
      var ta = h('textarea', { readonly: true, style: 'position:fixed;top:-100px;opacity:0' });
      ta.value = v; document.body.appendChild(ta); ta.select();
      try { document.execCommand('copy'); } catch (e) {}
      ta.remove();
    }
    var p = navigator.clipboard && navigator.clipboard.writeText ? navigator.clipboard.writeText(v).then(null, fallback) : Promise.resolve(fallback());
    p.then(function () { toast('📋 اتنسخ اللينك'); });
  }
  function shareLink() {
    navigator.share({ title: 'قايمة MIDO', text: 'لينك قايمة MIDO (حطه في التطبيق ← M3U):', url: rawLink() }).then(null, function () {});
  }

  // ---------- البداية ----------
  function init() {
    $('#mk-token').href = TOKEN_URL;
    renderLinks();
    $('#tok-save').addEventListener('click', saveToken);
    $('#tok').addEventListener('keydown', function (e) { if (e.key === 'Enter') saveToken(); });
    $('#logout').addEventListener('click', logout);
    $('#retry').addEventListener('click', start);
    $('#refresh').addEventListener('click', function () { var b = $('#refresh'); run(b, loadAll); });
    $('#copy-link').addEventListener('click', copyLink);
    if (navigator.share) { show('#share-link', true); $('#share-link').addEventListener('click', shareLink); }
    Array.prototype.forEach.call(document.querySelectorAll('#kinds button'), function (b) {
      b.addEventListener('click', function () { setKind(b.getAttribute('data-kind')); });
    });
    ['#f-name', '#f-url', '#f-group', '#f-logo'].forEach(function (s) { $(s).addEventListener('input', updatePreview); });
    $('#f-img').addEventListener('error', function () { $('#f-img').hidden = true; });
    $('#f-save').addEventListener('click', saveEntry);
    $('#f-cancel').addEventListener('click', resetForm);
    $('#mine-q').addEventListener('input', function (e) { S.q = e.target.value.trim(); renderMine(); });
    $('#up-file').addEventListener('change', pickFile);
    $('#up-go').addEventListener('click', doUpload);
    $('#up-cancel').addEventListener('click', closeUpload);
    $('#src-add').addEventListener('click', addSource);
    $('#src-url').addEventListener('keydown', function (e) { if (e.key === 'Enter') addSource(); });
    $('#src-save').addEventListener('click', saveSources);
    window.addEventListener('beforeunload', function (e) { if (S.src && S.src.dirty && TOKEN) { e.preventDefault(); e.returnValue = ''; } });
    setKind('movie');
    TOKEN = store.get();
    if (TOKEN) start(); else showSetup('');
  }
  init();
})();
