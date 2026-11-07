#!/usr/bin/env node
/* MIDO Server: per-customer username/password access to Mido's own list (mido.m3u).
   Speaks the Xtream "player_api.php" protocol so the MIDO app (and most IPTV players) can log in.
   Streams are not re-streamed: after checking the account, the server redirects to the original link.
   No dependencies: Node 18+ only. */
'use strict';
const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = +(process.env.PORT || 8080);
const LIST_URL = process.env.LIST_URL || 'https://raw.githubusercontent.com/Midodorgham/mido-lists/main/mido.m3u';
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '';
const REFRESH_MIN = +(process.env.REFRESH_MIN || 10);
const PUBLIC_DIR = path.join(__dirname, 'public');
const CUSTOMERS_FILE = path.join(DATA_DIR, 'customers.json');
const LIST_CACHE = path.join(DATA_DIR, 'list-cache.m3u');

if (!ADMIN_PASSWORD || ADMIN_PASSWORD.length < 8) {
  console.error('ADMIN_PASSWORD must be set (8+ characters).');
  process.exit(1);
}
fs.mkdirSync(DATA_DIR, { recursive: true });

/* ---------- customers ---------- */
let customers = [];
try { customers = JSON.parse(fs.readFileSync(CUSTOMERS_FILE, 'utf8')); } catch (e) { customers = []; }
let saveTimer = null;
function saveCustomers(now) {
  const write = () => {
    saveTimer = null;
    const tmp = CUSTOMERS_FILE + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(customers, null, 1), { mode: 0o600 });
    fs.renameSync(tmp, CUSTOMERS_FILE);
  };
  if (now) { if (saveTimer) clearTimeout(saveTimer); write(); }
  else if (!saveTimer) saveTimer = setTimeout(write, 5000);
}
const sec = () => Math.floor(Date.now() / 1000);
function findCustomer(u) { u = String(u || '').toLowerCase(); return customers.find(c => c.username.toLowerCase() === u); }
function safeEq(a, b) {
  const x = Buffer.from(String(a)), y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}
function customerState(c) {
  if (!c.enabled) return 'Disabled';
  if (c.exp && c.exp < sec()) return 'Expired';
  return 'Active';
}
// The account if username+password match and it may watch now, else null.
function authCustomer(u, p) {
  const c = findCustomer(u);
  if (!c || !safeEq(c.password, p || '')) return null;
  return c;
}

/* ---------- failed-login limiter (per IP) ---------- */
const fails = new Map();
function ipOf(req) { return (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket.remoteAddress || ''; }
function tooMany(ip) {
  const f = fails.get(ip);
  return f && f.n >= 20 && Date.now() - f.t < 10 * 60e3;
}
function noteFail(ip) {
  const f = fails.get(ip);
  if (!f || Date.now() - f.t > 10 * 60e3) fails.set(ip, { n: 1, t: Date.now() });
  else f.n++;
}

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
function idOf(s) { return (parseInt(crypto.createHash('sha1').update(s).digest('hex').slice(0, 8), 16) % 2000000000) + 1; }
function attr(line, name) { const m = new RegExp(name + '="([^"]*)"', 'i').exec(line); return m ? m[1].trim() : ''; }
function extOf(url, kind) {
  const m = /\.([a-z0-9]{2,4})(\?|$)/i.exec(url.split('#')[0]);
  const e = m ? m[1].toLowerCase() : '';
  if (kind === 'live') return 'm3u8';
  return ['mp4', 'mkv', 'avi', 'mov', 'm4v', 'ts', 'm3u8'].includes(e) ? e : 'mp4';
}

let list = { items: [], byId: new Map(), cats: { live: [], movie: [], series: [] }, series: [], seriesById: new Map(), updated: 0, ok: false, error: '' };

function parseM3U(text) {
  const items = [];
  const lines = String(text).replace(/^﻿/, '').split(/\r?\n/);
  let info = null, grp = '';
  for (let raw of lines) {
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
    const hay = it.group + ' ' + it.name;
    it.kind = SERIES_RE.test(hay) ? 'series' : (MOVIE_GROUP_RE.test(it.group) || MOVIE_EXT_RE.test(line)) ? 'movie' : 'live';
    it.url = line;
    it.id = idOf(line);
    it.ext = extOf(line, it.kind);
    items.push(it);
    info = null; grp = '';
  }
  return items;
}

function buildIndex(text) {
  const seen = new Set();
  const items = parseM3U(text).filter(it => !seen.has(it.id) && seen.add(it.id));
  const byId = new Map(items.map(it => [it.id, it]));
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
  // Series: one series per group; its entries are the episodes in list order.
  const series = [], seriesById = new Map();
  for (const it of items.filter(i => i.kind === 'series')) {
    let s = seriesById.get(it.cat);
    if (!s) {
      s = { series_id: idOf('series|' + it.group), name: it.group, cover: it.logo, cat: it.cat, episodes: [] };
      seriesById.set(it.cat, s);
      series.push(s);
    }
    if (!s.cover && it.logo) s.cover = it.logo;
    s.episodes.push(it);
  }
  const sbid = new Map(series.map(s => [s.series_id, s]));
  return { items, byId, cats, series, seriesById: sbid };
}

function fetchText(url, hops = 0) {
  return new Promise((resolve, reject) => {
    const lib = url.startsWith('https:') ? https : http;
    const req = lib.get(url, { headers: { 'User-Agent': 'MIDO-Server/1.0' }, timeout: 30000 }, res => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && hops < 5) {
        res.resume();
        return resolve(fetchText(new URL(res.headers.location, url).toString(), hops + 1));
      }
      if (res.statusCode !== 200) { res.resume(); return reject(new Error('HTTP ' + res.statusCode)); }
      const chunks = []; let size = 0;
      res.on('data', d => { size += d.length; if (size > 50e6) req.destroy(new Error('too big')); else chunks.push(d); });
      res.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
      res.on('error', reject);
    });
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', reject);
  });
}

function applyList(text, ok, error) {
  const idx = buildIndex(text);
  list = Object.assign(idx, { updated: sec(), ok, error: error || '' });
}
async function refreshList() {
  try {
    const text = await fetchText(LIST_URL);
    if (!/#EXTM3U|#EXTINF/i.test(text)) throw new Error('not an M3U');
    applyList(text, true);
    fs.writeFileSync(LIST_CACHE, text);
    console.log(`[list] ${list.items.length} items`);
  } catch (e) {
    console.error('[list] refresh failed:', e.message);
    if (!list.items.length) {
      try { applyList(fs.readFileSync(LIST_CACHE, 'utf8'), false, e.message); } catch (_) { list.error = e.message; }
    } else { list.ok = false; list.error = e.message; }
  }
}

/* ---------- helpers ---------- */
function send(res, code, body, type, extra) {
  res.writeHead(code, Object.assign({ 'Content-Type': type || 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }, extra || {}));
  res.end(body);
}
const json = (res, obj, code) => send(res, code || 200, JSON.stringify(obj));
function readBody(req) {
  return new Promise((resolve, reject) => {
    let s = '';
    req.on('data', d => { s += d; if (s.length > 1e6) { req.destroy(); reject(new Error('too big')); } });
    req.on('end', () => { try { resolve(s ? JSON.parse(s) : {}); } catch (e) { reject(e); } });
    req.on('error', reject);
  });
}
function hostBase(req) {
  const proto = (req.headers['x-forwarded-proto'] || '').split(',')[0] || (req.socket.encrypted ? 'https' : 'http');
  return `${proto}://${req.headers.host || 'localhost:' + PORT}`;
}

/* ---------- Xtream API ---------- */
function userInfo(c, u, p) {
  return {
    username: u, password: p, message: 'MIDO', auth: 1, status: customerState(c),
    exp_date: c.exp ? String(c.exp) : null, is_trial: c.trial ? '1' : '0', active_cons: '0',
    created_at: String(c.created || 0), max_connections: String(c.max || 1),
    allowed_output_formats: ['m3u8', 'ts'],
  };
}
function serverInfo(req) {
  const h = new URL(hostBase(req));
  return { url: h.hostname, port: h.port || (h.protocol === 'https:' ? '443' : '80'), https_port: '443',
           server_protocol: h.protocol.replace(':', ''), rtmp_port: '0', timezone: 'Africa/Cairo',
           timestamp_now: sec(), time_now: new Date().toISOString().replace('T', ' ').slice(0, 19) };
}
function streamRow(it, n) {
  const base = { num: n + 1, name: it.name, stream_type: it.kind === 'live' ? 'live' : 'movie', stream_id: it.id,
                 stream_icon: it.logo, added: String(list.updated), category_id: it.cat, category_ids: [+it.cat],
                 custom_sid: '', direct_source: '' };
  if (it.kind === 'live') return Object.assign(base, { epg_channel_id: it.tvgId || null, tv_archive: 0, tv_archive_duration: 0 });
  return Object.assign(base, { rating: '', rating_5based: 0, container_extension: it.ext });
}
function seriesRow(s, n) {
  return { num: n + 1, name: s.name, series_id: s.series_id, cover: s.cover, plot: '', cast: '', director: '', genre: '',
           releaseDate: '', last_modified: String(list.updated), rating: '', rating_5based: 0, backdrop_path: [],
           youtube_trailer: '', episode_run_time: '', category_id: s.cat, category_ids: [+s.cat] };
}

function playerApi(req, res, q) {
  const u = q.get('username') || '', p = q.get('password') || '';
  const ip = ipOf(req);
  if (tooMany(ip)) return json(res, { user_info: { auth: 0, message: 'Too many attempts' } }, 429);
  const c = authCustomer(u, p);
  if (!c) { noteFail(ip); return json(res, { user_info: { auth: 0 } }); }
  const state = customerState(c);
  c.seen = sec(); c.ip = ip; saveCustomers();
  const action = q.get('action') || '';
  if (!action) {
    if (state !== 'Active') return json(res, { user_info: Object.assign(userInfo(c, u, p), { auth: 0 }), server_info: serverInfo(req) });
    return json(res, { user_info: userInfo(c, u, p), server_info: serverInfo(req) });
  }
  if (state !== 'Active') return json(res, []);
  const cat = q.get('category_id');
  const byCat = arr => cat ? arr.filter(x => String(x.category_id || x.cat) === String(cat)) : arr;
  switch (action) {
    case 'get_live_categories': return json(res, list.cats.live);
    case 'get_vod_categories': return json(res, list.cats.movie);
    case 'get_series_categories': return json(res, list.cats.series);
    case 'get_live_streams': return json(res, list.items.filter(i => i.kind === 'live' && (!cat || i.cat === cat)).map(streamRow));
    case 'get_vod_streams': return json(res, list.items.filter(i => i.kind === 'movie' && (!cat || i.cat === cat)).map(streamRow));
    case 'get_series': return json(res, byCat(list.series).map(seriesRow));
    case 'get_vod_info': {
      const it = list.byId.get(+q.get('vod_id'));
      if (!it || it.kind !== 'movie') return json(res, { info: [], movie_data: [] });
      return json(res, { info: { name: it.name, movie_image: it.logo, plot: '', rating: '' },
                         movie_data: { stream_id: it.id, name: it.name, added: String(list.updated), category_id: it.cat, container_extension: it.ext } });
    }
    case 'get_series_info': {
      const s = list.seriesById.get(+q.get('series_id'));
      if (!s) return json(res, { seasons: [], info: {}, episodes: {} });
      const eps = s.episodes.map((e, i) => ({ id: String(e.id), episode_num: i + 1, title: e.name, container_extension: e.ext,
                                              info: { movie_image: e.logo || s.cover }, season: 1, added: String(list.updated) }));
      return json(res, { seasons: [{ season_number: 1, name: 'الموسم 1', episode_count: eps.length, cover: s.cover }],
                         info: seriesRow(s, 0), episodes: { 1: eps } });
    }
    case 'get_short_epg': case 'get_simple_data_table': return json(res, { epg_listings: [] });
    default: return json(res, []);
  }
}

function getPhp(req, res, q) {
  const u = q.get('username') || '', p = q.get('password') || '';
  const ip = ipOf(req);
  if (tooMany(ip)) return send(res, 429, 'Too many attempts', 'text/plain');
  const c = authCustomer(u, p);
  if (!c) { noteFail(ip); return send(res, 401, 'Wrong username or password', 'text/plain; charset=utf-8'); }
  if (customerState(c) !== 'Active') return send(res, 403, 'Account ' + customerState(c), 'text/plain; charset=utf-8');
  c.seen = sec(); c.ip = ip; saveCustomers();
  const b = hostBase(req), eu = encodeURIComponent(u), ep = encodeURIComponent(p);
  const out = ['#EXTM3U'];
  for (const it of list.items) {
    const seg = it.kind === 'live' ? 'live' : it.kind === 'movie' ? 'movie' : 'series';
    const ext = it.kind === 'live' ? (q.get('output') === 'ts' ? 'ts' : 'm3u8') : it.ext;
    out.push(`#EXTINF:-1 tvg-id="${it.tvgId}" tvg-name="${it.name.replace(/"/g, "'")}" tvg-logo="${it.logo}" group-title="${it.group.replace(/"/g, "'")}",${it.name}`);
    out.push(`${b}/${seg}/${eu}/${ep}/${it.id}.${ext}`);
  }
  send(res, 200, out.join('\n') + '\n', 'audio/x-mpegurl; charset=utf-8', { 'Content-Disposition': 'inline; filename="mido.m3u"' });
}

// /live/u/p/123.m3u8, /movie/u/p/123.mp4, /series/u/p/123.mp4, /u/p/123
function streamRedirect(req, res, parts) {
  let u, p, idPart;
  if (parts.length === 4) [, u, p, idPart] = parts; else [u, p, idPart] = parts;
  u = decodeURIComponent(u); p = decodeURIComponent(p);
  const ip = ipOf(req);
  if (tooMany(ip)) return send(res, 429, 'Too many attempts', 'text/plain');
  const c = authCustomer(u, p);
  if (!c) { noteFail(ip); return send(res, 401, 'Unauthorized', 'text/plain'); }
  if (customerState(c) !== 'Active') return send(res, 403, 'Account ' + customerState(c), 'text/plain');
  const it = list.byId.get(+String(idPart).split('.')[0]);
  if (!it) return send(res, 404, 'Not found', 'text/plain');
  c.seen = sec(); c.ip = ip; c.watching = it.name; saveCustomers();
  res.writeHead(302, { Location: it.url, 'Cache-Control': 'no-store' });
  res.end();
}

/* ---------- admin ---------- */
const sessions = new Map(); // token -> expiry ms
function cookieToken(req) { const m = /(?:^|;\s*)mido_admin=([a-f0-9]{64})/.exec(req.headers.cookie || ''); return m ? m[1] : ''; }
function isAdmin(req) {
  const t = cookieToken(req), e = t && sessions.get(t);
  if (!e || e < Date.now()) { if (t) sessions.delete(t); return false; }
  return true;
}
const USER_RE = /^[a-zA-Z0-9_.-]{3,32}$/;
const PASS_RE = /^[a-zA-Z0-9_.@-]{4,32}$/;
function publicCustomer(c) { return Object.assign({}, c, { state: customerState(c) }); }
function rand(n, chars) { const b = crypto.randomBytes(n); let s = ''; for (const x of b) s += chars[x % chars.length]; return s; }

async function adminApi(req, res, route) {
  const ip = ipOf(req);
  if (route === 'login' && req.method === 'POST') {
    if (tooMany(ip)) return json(res, { error: 'محاولات كتير، استنى ١٠ دقايق' }, 429);
    const b = await readBody(req).catch(() => ({}));
    if (!safeEq(b.password || '', ADMIN_PASSWORD)) { noteFail(ip); return json(res, { error: 'الباسورد غلط' }, 401); }
    const t = crypto.randomBytes(32).toString('hex');
    sessions.set(t, Date.now() + 30 * 864e5);
    const secure = hostBase(req).startsWith('https') ? '; Secure' : '';
    return send(res, 200, '{"ok":true}', null, { 'Set-Cookie': `mido_admin=${t}; HttpOnly; SameSite=Strict; Path=/; Max-Age=2592000${secure}` });
  }
  if (!isAdmin(req)) return json(res, { error: 'login' }, 401);
  // Same-origin check for state-changing calls.
  if (req.method !== 'GET') {
    const o = req.headers.origin;
    if (o && new URL(o).host !== req.headers.host) return json(res, { error: 'origin' }, 403);
  }
  if (route === 'logout' && req.method === 'POST') {
    sessions.delete(cookieToken(req));
    return send(res, 200, '{"ok":true}', null, { 'Set-Cookie': 'mido_admin=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0' });
  }
  if (route === 'status' && req.method === 'GET') {
    const k = { live: 0, movie: 0, series: 0 };
    list.items.forEach(i => k[i.kind]++);
    return json(res, { server: hostBase(req), list: { url: LIST_URL, ok: list.ok, error: list.error, updated: list.updated, counts: k, series: list.series.length },
                       customers: customers.map(publicCustomer), now: sec() });
  }
  if (route === 'refresh' && req.method === 'POST') { await refreshList(); return json(res, { ok: list.ok, error: list.error }); }
  if (route === 'customers' && req.method === 'POST') {
    const b = await readBody(req).catch(() => null);
    if (!b) return json(res, { error: 'بيانات غلط' }, 400);
    const username = String(b.username || '').trim() || 'mido' + rand(5, '0123456789');
    const password = String(b.password || '').trim() || rand(8, 'abcdefghjkmnpqrstuvwxyz23456789');
    if (!USER_RE.test(username)) return json(res, { error: 'اليوزر: حروف إنجليزي وأرقام بس (٣ لـ ٣٢)' }, 400);
    if (!PASS_RE.test(password)) return json(res, { error: 'الباسورد: حروف إنجليزي وأرقام بس (٤ لـ ٣٢)' }, 400);
    if (findCustomer(username)) return json(res, { error: 'اليوزر ده موجود قبل كده' }, 409);
    const c = { id: crypto.randomBytes(6).toString('hex'), username, password, name: String(b.name || '').slice(0, 80),
                phone: String(b.phone || '').slice(0, 30), note: String(b.note || '').slice(0, 300),
                exp: b.exp ? +b.exp : null, enabled: b.enabled !== false, trial: !!b.trial, max: Math.max(1, Math.min(10, +b.max || 1)),
                created: sec(), seen: 0 };
    customers.push(c); saveCustomers(true);
    return json(res, publicCustomer(c));
  }
  const m = /^customers\/([a-f0-9]{12})$/.exec(route);
  if (m) {
    const c = customers.find(x => x.id === m[1]);
    if (!c) return json(res, { error: 'مش موجود' }, 404);
    if (req.method === 'DELETE') { customers = customers.filter(x => x !== c); saveCustomers(true); return json(res, { ok: true }); }
    if (req.method === 'PUT') {
      const b = await readBody(req).catch(() => null);
      if (!b) return json(res, { error: 'بيانات غلط' }, 400);
      if (b.username !== undefined && b.username !== c.username) {
        const nu = String(b.username).trim();
        if (!USER_RE.test(nu)) return json(res, { error: 'اليوزر: حروف إنجليزي وأرقام بس (٣ لـ ٣٢)' }, 400);
        const other = findCustomer(nu);
        if (other && other !== c) return json(res, { error: 'اليوزر ده موجود قبل كده' }, 409);
        c.username = nu;
      }
      if (b.password !== undefined) {
        const np = String(b.password).trim();
        if (!PASS_RE.test(np)) return json(res, { error: 'الباسورد: حروف إنجليزي وأرقام بس (٤ لـ ٣٢)' }, 400);
        c.password = np;
      }
      for (const k of ['name', 'phone', 'note']) if (b[k] !== undefined) c[k] = String(b[k]).slice(0, k === 'note' ? 300 : 80);
      if (b.exp !== undefined) c.exp = b.exp ? +b.exp : null;
      if (b.enabled !== undefined) c.enabled = !!b.enabled;
      if (b.trial !== undefined) c.trial = !!b.trial;
      if (b.max !== undefined) c.max = Math.max(1, Math.min(10, +b.max || 1));
      saveCustomers(true);
      return json(res, publicCustomer(c));
    }
  }
  json(res, { error: 'not found' }, 404);
}

const STATIC = { 'admin.html': 'text/html; charset=utf-8', 'admin.js': 'application/javascript; charset=utf-8', 'admin.css': 'text/css; charset=utf-8', 'icon.png': 'image/png' };
function serveStatic(res, name) {
  fs.readFile(path.join(PUBLIC_DIR, name), (err, buf) => {
    if (err) return send(res, 404, 'Not found', 'text/plain');
    send(res, 200, buf, STATIC[name], {
      'Cache-Control': 'no-cache',
      'Content-Security-Policy': "default-src 'self'; img-src 'self' https: data:; style-src 'self' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; frame-ancestors 'none'",
      'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer',
    });
  });
}

/* ---------- router ---------- */
const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://x');
    const p = url.pathname.replace(/\/+/g, '/');
    if (p === '/player_api.php' || p === '/panel_api.php') return playerApi(req, res, url.searchParams);
    if (p === '/get.php') return getPhp(req, res, url.searchParams);
    if (p === '/xmltv.php') return send(res, 200, '<?xml version="1.0" encoding="UTF-8"?>\n<tv generator-info-name="MIDO"></tv>\n', 'application/xml; charset=utf-8');
    if (p === '/' ) { res.writeHead(302, { Location: '/admin' }); return res.end(); }
    if (p === '/admin' || p === '/admin/') return serveStatic(res, 'admin.html');
    if (p.startsWith('/admin/api/')) return await adminApi(req, res, p.slice(11));
    const sm = /^\/admin\/([a-z]+\.(?:js|css|png))$/.exec(p);
    if (sm && STATIC[sm[1]]) return serveStatic(res, sm[1]);
    if (p === '/health') return json(res, { ok: true, items: list.items.length });
    const parts = p.split('/').filter(Boolean);
    if (parts.length === 4 && ['live', 'movie', 'series'].includes(parts[0])) return streamRedirect(req, res, parts);
    if (parts.length === 3 && /^\d+(\.\w+)?$/.test(parts[2])) return streamRedirect(req, res, parts);
    send(res, 404, 'Not found', 'text/plain');
  } catch (e) {
    console.error(e);
    if (!res.headersSent) send(res, 500, '{"error":"server"}');
  }
});

refreshList().then(() => {
  server.listen(PORT, () => console.log(`MIDO Server on port ${PORT}`));
});
setInterval(refreshList, REFRESH_MIN * 60e3).unref();
process.on('SIGTERM', () => { saveCustomers(true); process.exit(0); });
process.on('SIGINT', () => { saveCustomers(true); process.exit(0); });
