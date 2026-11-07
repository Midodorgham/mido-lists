// MIDO Server on Supabase: per-customer username/password for Mido's own list (mido.m3u).
// Edge Function name: mido. Customers live in the table public.mido_customers (see setup.sql).
// Speaks the Xtream "player_api.php" protocol, so the MIDO app logs in with server + username + password.
// Streams are not re-streamed: after checking the account it redirects to the original link.
// Secrets to set in Supabase: ADMIN_PASSWORD (8+ characters). Optional: LIST_URL.

const env = (k) => (globalThis.Deno ? globalThis.Deno.env.get(k) : globalThis.process.env[k]) || '';
const LIST_URL = env('LIST_URL') || 'https://raw.githubusercontent.com/Midodorgham/mido-lists/main/mido.m3u';
const ADMIN_PASSWORD = env('ADMIN_PASSWORD');
const DB_URL = env('SUPABASE_URL').replace(/\/+$/, '');
const DB_KEY = env('SUPABASE_SERVICE_ROLE_KEY') || env('SERVICE_KEY');
const PUBLIC_BASE = (env('PUBLIC_BASE') || (DB_URL + '/functions/v1/mido')).replace(/\/+$/, '');
const TABLE = 'mido_customers';
const DAY = 86400;
const sec = () => Math.floor(Date.now() / 1000);
const enc = new TextEncoder();

/* ---------- database (PostgREST) ---------- */
async function db(path, opts = {}) {
  const headers = { apikey: DB_KEY, 'Content-Type': 'application/json', Prefer: 'return=representation' };
  if (!DB_KEY.startsWith('sb_')) headers.Authorization = 'Bearer ' + DB_KEY;
  const r = await fetch(`${DB_URL}/rest/v1/${path}`, { method: opts.method || 'GET', headers, body: opts.body ? JSON.stringify(opts.body) : undefined });
  const txt = await r.text();
  let data = null; try { data = txt ? JSON.parse(txt) : null; } catch (_) { /* not json */ }
  if (!r.ok) { const e = new Error((data && data.message) || ('db ' + r.status)); e.status = r.status; e.code = data && data.code; throw e; }
  return data;
}
const lc = (s) => String(s || '').trim().toLowerCase();
async function getCustomer(username) {
  const u = lc(username);
  if (!USER_RE.test(u)) return null;
  const rows = await db(`${TABLE}?username=eq.${encodeURIComponent(u)}&limit=1`);
  return rows && rows[0] || null;
}
function customerState(c) {
  if (!c.enabled) return 'Disabled';
  if (c.exp && c.exp < sec()) return 'Expired';
  return 'Active';
}
function safeEq(a, b) {
  a = String(a); b = String(b);
  let d = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i++) d |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return d === 0;
}
async function authCustomer(u, p) {
  const c = await getCustomer(u);
  return c && safeEq(c.password, p || '') ? c : null;
}
// Last seen, written at most every 5 minutes per customer.
function touch(c, ip, watching) {
  if (sec() - (c.seen || 0) < 300 && !watching) return Promise.resolve();
  const body = { seen: sec(), ip: ip || '' };
  if (watching) body.watching = watching.slice(0, 120);
  return db(`${TABLE}?id=eq.${c.id}`, { method: 'PATCH', body }).catch(() => {});
}

/* ---------- failed-login limiter (per IP, per running instance) ---------- */
const fails = new Map();
function tooMany(ip) { const f = fails.get(ip); return f && f.n >= 20 && Date.now() - f.t < 10 * 60e3; }
function noteFail(ip) {
  const f = fails.get(ip);
  if (!f || Date.now() - f.t > 10 * 60e3) fails.set(ip, { n: 1, t: Date.now() }); else f.n++;
}
const ipOf = (req) => (req.headers.get('x-forwarded-for') || '').split(',')[0].trim() || req.headers.get('x-real-ip') || '';

/* ---------- list ---------- */
const SERIES_RE = /series|مسلسل|season|s\d+\s*e\d+/i;
const MOVIE_GROUP_RE = /vod|movie|film|فيلم|[اأإآ]فلام/i;
const MOVIE_EXT_RE = /\.(mp4|mkv|avi|mov|m4v)(\?|$)/i;
// Subscription links (a username and password inside the link) are never served: same rule as build-list.sh.
function isCred(u) {
  u = String(u).toLowerCase();
  if (/[?&](username|user)=[^&#]+/.test(u) && /[?&](password|pass)=[^&#]+/.test(u)) return true;
  if (/^https?:\/\/[^\/?#]+\/[^\/?#]+\/[^\/?#]+\/\d+(\.[a-z0-9]+)?([?#]|$)/.test(u)) return true;
  if (/\/(live|movie|movies|series)\/[^\/?#]+\/[^\/?#]+\/\d+(\.[a-z0-9]+)?([?#]|$)/.test(u)) return true;
  return /\/timeshift\/[^\/?#]+\/[^\/?#]+\//.test(u);
}
// Stable numeric id from text (FNV-1a, 31 bits).
function idOf(s) {
  let h = 0x811c9dc5;
  for (const b of enc.encode(s)) { h ^= b; h = Math.imul(h, 0x01000193) >>> 0; }
  return (h % 2000000000) + 1;
}
function attr(line, name) { const m = new RegExp(name + '="([^"]*)"', 'i').exec(line); return m ? m[1].trim() : ''; }
function extOf(url, kind) {
  if (kind === 'live') return 'm3u8';
  const m = /\.([a-z0-9]{2,4})(\?|$)/i.exec(url.split('#')[0]);
  const e = m ? m[1].toLowerCase() : '';
  return ['mp4', 'mkv', 'avi', 'mov', 'm4v', 'ts', 'm3u8'].includes(e) ? e : 'mp4';
}
function parseM3U(text) {
  const items = [];
  let info = null, grp = '';
  for (const raw of String(text).replace(/^﻿/, '').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    if (/^#EXTINF/i.test(line)) {
      const comma = line.lastIndexOf(',');
      info = { name: comma >= 0 ? line.slice(comma + 1).trim() : '', logo: attr(line, 'tvg-logo'), group: attr(line, 'group-title'), tvgId: attr(line, 'tvg-id') };
      continue;
    }
    if (/^#EXTGRP:/i.test(line)) { grp = line.slice(8).trim(); continue; }
    if (line[0] === '#') continue;
    if (!/^https?:\/\//i.test(line) || isCred(line)) { info = null; grp = ''; continue; }
    const it = info || { name: '', logo: '', group: '', tvgId: '' };
    if (!it.group && grp) it.group = grp;
    if (!it.name) it.name = line.split('/').pop().split('?')[0] || 'بدون اسم';
    if (!it.group) it.group = 'عام';
    it.kind = SERIES_RE.test(it.group + ' ' + it.name) ? 'series' : (MOVIE_GROUP_RE.test(it.group) || MOVIE_EXT_RE.test(line)) ? 'movie' : 'live';
    it.url = line; it.id = idOf(line); it.ext = extOf(line, it.kind);
    items.push(it);
    info = null; grp = '';
  }
  return items;
}
function buildIndex(text) {
  const seen = new Set();
  const items = parseM3U(text).filter((it) => !seen.has(it.id) && seen.add(it.id));
  const byId = new Map(items.map((it) => [it.id, it]));
  const cats = { live: [], movie: [], series: [] };
  const catIds = new Map();
  for (const it of items) {
    const key = it.kind + '|' + it.group;
    if (!catIds.has(key)) {
      const cid = String(idOf('cat|' + key) % 1000000);
      catIds.set(key, cid);
      cats[it.kind].push({ category_id: cid, category_name: it.group, parent_id: 0 });
    }
    it.cat = catIds.get(key);
  }
  const series = [], byCat = new Map();
  for (const it of items.filter((i) => i.kind === 'series')) {
    let s = byCat.get(it.cat);
    if (!s) { s = { series_id: idOf('series|' + it.group), name: it.group, cover: it.logo, cat: it.cat, episodes: [] }; byCat.set(it.cat, s); series.push(s); }
    if (!s.cover && it.logo) s.cover = it.logo;
    s.episodes.push(it);
  }
  return { items, byId, cats, series, seriesById: new Map(series.map((s) => [s.series_id, s])) };
}
let list = { items: [], byId: new Map(), cats: { live: [], movie: [], series: [] }, series: [], seriesById: new Map(), updated: 0, checked: 0, ok: false, error: '' };
let loading = null;
async function refreshList() {
  try {
    const r = await fetch(LIST_URL, { headers: { 'User-Agent': 'MIDO-Server/1.0' } });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const text = await r.text();
    if (!/#EXTM3U|#EXTINF/i.test(text)) throw new Error('not an M3U');
    list = Object.assign(buildIndex(text), { updated: sec(), checked: sec(), ok: true, error: '' });
  } catch (e) {
    list.checked = sec(); list.ok = false; list.error = e.message;
  }
}
// Fresh list at most every 10 minutes; a failed refresh keeps the last good copy.
async function getList(force) {
  if (force || sec() - list.checked > 600) {
    if (!loading) loading = refreshList().finally(() => { loading = null; });
    if (force || !list.items.length) await loading;
  }
  return list;
}

/* ---------- responses ---------- */
const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'content-type, x-mido-token', 'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS', 'Access-Control-Max-Age': '86400' };
function send(body, status = 200, type = 'application/json; charset=utf-8', extra = {}) {
  return new Response(body, { status, headers: Object.assign({ 'Content-Type': type, 'Cache-Control': 'no-store' }, CORS, extra) });
}
const json = (obj, status) => send(JSON.stringify(obj), status || 200);
const text = (t, status) => send(t, status, 'text/plain; charset=utf-8');

/* ---------- Xtream API ---------- */
function userInfo(c, u, p) {
  return { username: u, password: p, message: 'MIDO', auth: 1, status: customerState(c), exp_date: c.exp ? String(c.exp) : null,
           is_trial: c.trial ? '1' : '0', active_cons: '0', created_at: String(c.created || 0), max_connections: String(c.max || 1),
           allowed_output_formats: ['m3u8', 'ts'] };
}
function serverInfo() {
  const h = new URL(PUBLIC_BASE);
  return { url: h.hostname, port: h.port || (h.protocol === 'https:' ? '443' : '80'), https_port: '443', server_protocol: h.protocol.replace(':', ''),
           rtmp_port: '0', timezone: 'Africa/Cairo', timestamp_now: sec(), time_now: new Date().toISOString().replace('T', ' ').slice(0, 19) };
}
function streamRow(L) {
  return (it, n) => {
    const base = { num: n + 1, name: it.name, stream_type: it.kind === 'live' ? 'live' : 'movie', stream_id: it.id, stream_icon: it.logo,
                   added: String(L.updated), category_id: it.cat, category_ids: [+it.cat], custom_sid: '', direct_source: '' };
    if (it.kind === 'live') return Object.assign(base, { epg_channel_id: it.tvgId || null, tv_archive: 0, tv_archive_duration: 0 });
    return Object.assign(base, { rating: '', rating_5based: 0, container_extension: it.ext });
  };
}
function seriesRow(L) {
  return (s, n) => ({ num: n + 1, name: s.name, series_id: s.series_id, cover: s.cover, plot: '', cast: '', director: '', genre: '', releaseDate: '',
                      last_modified: String(L.updated), rating: '', rating_5based: 0, backdrop_path: [], youtube_trailer: '', episode_run_time: '',
                      category_id: s.cat, category_ids: [+s.cat] });
}

async function playerApi(req, q) {
  const u = q.get('username') || '', p = q.get('password') || '', ip = ipOf(req);
  if (tooMany(ip)) return json({ user_info: { auth: 0, message: 'Too many attempts' } }, 429);
  const c = await authCustomer(u, p);
  if (!c) { noteFail(ip); return json({ user_info: { auth: 0 } }); }
  const state = customerState(c);
  const action = q.get('action') || '';
  await touch(c, ip);
  if (!action) {
    const ui = userInfo(c, u, p);
    if (state !== 'Active') ui.auth = 0;
    return json({ user_info: ui, server_info: serverInfo() });
  }
  if (state !== 'Active') return json([]);
  const L = await getList();
  const cat = q.get('category_id');
  switch (action) {
    case 'get_live_categories': return json(L.cats.live);
    case 'get_vod_categories': return json(L.cats.movie);
    case 'get_series_categories': return json(L.cats.series);
    case 'get_live_streams': return json(L.items.filter((i) => i.kind === 'live' && (!cat || i.cat === cat)).map(streamRow(L)));
    case 'get_vod_streams': return json(L.items.filter((i) => i.kind === 'movie' && (!cat || i.cat === cat)).map(streamRow(L)));
    case 'get_series': return json(L.series.filter((s) => !cat || s.cat === cat).map(seriesRow(L)));
    case 'get_vod_info': {
      const it = L.byId.get(+q.get('vod_id'));
      if (!it || it.kind !== 'movie') return json({ info: [], movie_data: [] });
      return json({ info: { name: it.name, movie_image: it.logo, plot: '', rating: '' },
                    movie_data: { stream_id: it.id, name: it.name, added: String(L.updated), category_id: it.cat, container_extension: it.ext } });
    }
    case 'get_series_info': {
      const s = L.seriesById.get(+q.get('series_id'));
      if (!s) return json({ seasons: [], info: {}, episodes: {} });
      const eps = s.episodes.map((e, i) => ({ id: String(e.id), episode_num: i + 1, title: e.name, container_extension: e.ext,
                                               info: { movie_image: e.logo || s.cover }, season: 1, added: String(L.updated) }));
      return json({ seasons: [{ season_number: 1, name: 'الموسم 1', episode_count: eps.length, cover: s.cover }], info: seriesRow(L)(s, 0), episodes: { 1: eps } });
    }
    case 'get_short_epg': case 'get_simple_data_table': return json({ epg_listings: [] });
    default: return json([]);
  }
}

async function getPhp(req, q) {
  const u = q.get('username') || '', p = q.get('password') || '', ip = ipOf(req);
  if (tooMany(ip)) return text('Too many attempts', 429);
  const c = await authCustomer(u, p);
  if (!c) { noteFail(ip); return text('Wrong username or password', 401); }
  if (customerState(c) !== 'Active') return text('Account ' + customerState(c), 403);
  await touch(c, ip);
  const L = await getList();
  const eu = encodeURIComponent(u), ep = encodeURIComponent(p);
  const out = ['#EXTM3U'];
  for (const it of L.items) {
    const seg = it.kind === 'live' ? 'live' : it.kind === 'movie' ? 'movie' : 'series';
    const ext = it.kind === 'live' ? (q.get('output') === 'ts' ? 'ts' : 'm3u8') : it.ext;
    out.push(`#EXTINF:-1 tvg-id="${it.tvgId}" tvg-name="${it.name.replace(/"/g, "'")}" tvg-logo="${it.logo}" group-title="${it.group.replace(/"/g, "'")}",${it.name}`);
    out.push(`${PUBLIC_BASE}/${seg}/${eu}/${ep}/${it.id}.${ext}`);
  }
  return send(out.join('\n') + '\n', 200, 'audio/x-mpegurl; charset=utf-8', { 'Content-Disposition': 'inline; filename="mido.m3u"' });
}

async function streamRedirect(req, parts) {
  const [u, p, idPart] = (parts.length === 4 ? parts.slice(1) : parts).map((x) => decodeURIComponent(x));
  const ip = ipOf(req);
  if (tooMany(ip)) return text('Too many attempts', 429);
  const c = await authCustomer(u, p);
  if (!c) { noteFail(ip); return text('Unauthorized', 401); }
  if (customerState(c) !== 'Active') return text('Account ' + customerState(c), 403);
  const L = await getList();
  const it = L.byId.get(+String(idPart).split('.')[0]);
  if (!it) return text('Not found', 404);
  await touch(c, ip, it.name);
  return new Response(null, { status: 302, headers: Object.assign({ Location: it.url, 'Cache-Control': 'no-store' }, CORS) });
}

/* ---------- admin API (used by customers.html) ---------- */
const USER_RE = /^[a-z0-9_.-]{3,32}$/;
const PASS_RE = /^[a-zA-Z0-9_.@-]{4,32}$/;
const ERR_USER = 'اليوزر: حروف إنجليزي وأرقام بس (٣ لـ ٣٢)';
const ERR_PASS = 'الباسورد: حروف إنجليزي وأرقام بس (٤ لـ ٣٢)';
const ERR_DUP = 'اليوزر ده موجود قبل كده';
function rand(n, chars) { const b = crypto.getRandomValues(new Uint8Array(n)); let s = ''; for (const x of b) s += chars[x % chars.length]; return s; }
const b64u = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
async function hmac(msg) {
  const key = await crypto.subtle.importKey('raw', enc.encode('mido-admin|' + ADMIN_PASSWORD), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return b64u(await crypto.subtle.sign('HMAC', key, enc.encode(msg)));
}
// Token = expiry.signature; changing ADMIN_PASSWORD logs everyone out.
async function makeToken() { const exp = String(sec() + 30 * DAY); return exp + '.' + await hmac(exp); }
async function isAdmin(req) {
  const t = req.headers.get('x-mido-token') || '';
  const [exp, sig] = t.split('.');
  if (!exp || !sig || +exp < sec()) return false;
  return safeEq(sig, await hmac(exp));
}
async function readJson(req) { try { return await req.json(); } catch (_) { return null; } }
function clean(c) { return Object.assign({}, c, { state: customerState(c) }); }
function dbError(e) {
  if (e.code === '23505' || e.status === 409) return json({ error: ERR_DUP }, 409);
  if (e.code === '42P01' || /mido_customers/.test(e.message)) return json({ error: 'جدول العملاء مش موجود: شغّل setup.sql في Supabase' }, 500);
  return json({ error: 'قاعدة البيانات: ' + e.message }, 500);
}

async function adminApi(req, route) {
  const ip = ipOf(req);
  if (route === 'login' && req.method === 'POST') {
    if (tooMany(ip)) return json({ error: 'محاولات كتير، استنى ١٠ دقايق' }, 429);
    const b = await readJson(req) || {};
    if (!safeEq(b.password || '', ADMIN_PASSWORD)) { noteFail(ip); return json({ error: 'الباسورد غلط' }, 401); }
    return json({ token: await makeToken() });
  }
  if (!(await isAdmin(req))) return json({ error: 'login' }, 401);
  try {
    if (route === 'status' && req.method === 'GET') {
      const L = await getList(new URL(req.url).searchParams.get('refresh') === '1');
      const k = { live: 0, movie: 0, series: 0 };
      L.items.forEach((i) => k[i.kind]++);
      const customers = await db(`${TABLE}?select=*&order=created.desc`);
      return json({ server: PUBLIC_BASE, list: { url: LIST_URL, ok: L.ok, error: L.error, updated: L.updated, counts: k, series: L.series.length },
                    customers: customers.map(clean), now: sec() });
    }
    if (route === 'customers' && req.method === 'POST') {
      const b = await readJson(req);
      if (!b) return json({ error: 'بيانات غلط' }, 400);
      const username = lc(b.username) || 'mido' + rand(5, '0123456789');
      const password = String(b.password || '').trim() || rand(8, 'abcdefghjkmnpqrstuvwxyz23456789');
      if (!USER_RE.test(username)) return json({ error: ERR_USER }, 400);
      if (!PASS_RE.test(password)) return json({ error: ERR_PASS }, 400);
      const c = { id: rand(12, '0123456789abcdef'), username, password, name: String(b.name || '').slice(0, 80), phone: String(b.phone || '').slice(0, 30),
                  note: String(b.note || '').slice(0, 300), exp: b.exp ? Math.floor(+b.exp) : null, enabled: b.enabled !== false, trial: !!b.trial,
                  max: Math.max(1, Math.min(10, +b.max || 1)), created: sec(), seen: 0, ip: '', watching: '' };
      const rows = await db(TABLE, { method: 'POST', body: c });
      return json(clean(rows[0]));
    }
    const m = /^customers\/([a-f0-9]{12})$/.exec(route);
    if (m) {
      const rows = await db(`${TABLE}?id=eq.${m[1]}&limit=1`);
      if (!rows.length) return json({ error: 'مش موجود' }, 404);
      if (req.method === 'DELETE') { await db(`${TABLE}?id=eq.${m[1]}`, { method: 'DELETE' }); return json({ ok: true }); }
      if (req.method === 'PUT') {
        const b = await readJson(req);
        if (!b) return json({ error: 'بيانات غلط' }, 400);
        const ch = {};
        if (b.username !== undefined) { const nu = lc(b.username); if (!USER_RE.test(nu)) return json({ error: ERR_USER }, 400); ch.username = nu; }
        if (b.password !== undefined) { const np = String(b.password).trim(); if (!PASS_RE.test(np)) return json({ error: ERR_PASS }, 400); ch.password = np; }
        for (const k of ['name', 'phone', 'note']) if (b[k] !== undefined) ch[k] = String(b[k]).slice(0, k === 'note' ? 300 : 80);
        if (b.exp !== undefined) ch.exp = b.exp ? Math.floor(+b.exp) : null;
        if (b.enabled !== undefined) ch.enabled = !!b.enabled;
        if (b.trial !== undefined) ch.trial = !!b.trial;
        if (b.max !== undefined) ch.max = Math.max(1, Math.min(10, +b.max || 1));
        const out = await db(`${TABLE}?id=eq.${m[1]}`, { method: 'PATCH', body: ch });
        return json(clean(out[0]));
      }
    }
    return json({ error: 'not found' }, 404);
  } catch (e) { return dbError(e); }
}

/* ---------- router ---------- */
export async function handle(req) {
  if (req.method === 'OPTIONS') return send(null, 204);
  if (!ADMIN_PASSWORD || ADMIN_PASSWORD.length < 8) return text('Set the ADMIN_PASSWORD secret (8+ characters) in Supabase.', 500);
  if (!DB_URL || !DB_KEY) return text('Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY.', 500);
  try {
    const url = new URL(req.url);
    // Supabase passes /mido/... (or /functions/v1/mido/...): keep only what follows the function name.
    const p = (url.pathname.replace(/\/+/g, '/').replace(/^\/(functions\/v1\/)?mido(?=\/|$)/, '') || '/');
    if (p === '/player_api.php' || p === '/panel_api.php') return await playerApi(req, url.searchParams);
    if (p === '/get.php') return await getPhp(req, url.searchParams);
    if (p === '/xmltv.php') return send('<?xml version="1.0" encoding="UTF-8"?>\n<tv generator-info-name="MIDO"></tv>\n', 200, 'application/xml; charset=utf-8');
    if (p.startsWith('/admin/')) return await adminApi(req, p.slice(7));
    if (p === '/' || p === '/health') return json({ ok: true, name: 'MIDO Server' });
    const parts = p.split('/').filter(Boolean);
    if (parts.length === 4 && ['live', 'movie', 'series'].includes(parts[0])) return await streamRedirect(req, parts);
    if (parts.length === 3 && /^\d+(\.\w+)?$/.test(parts[2])) return await streamRedirect(req, parts);
    return text('Not found', 404);
  } catch (e) {
    console.error(e);
    return json({ error: 'server' }, 500);
  }
}

if (globalThis.Deno) globalThis.Deno.serve(handle);
