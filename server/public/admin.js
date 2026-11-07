'use strict';
const $ = s => document.querySelector(s);
const DAY = 86400;
let state = { server: '', list: null, customers: [], now: 0 };
let filter = 'all';

function toast(msg, bad) {
  const t = $('#toast'); t.textContent = msg; t.className = 'toast show' + (bad ? ' bad' : '');
  clearTimeout(toast.t); toast.t = setTimeout(() => { t.className = 'toast'; }, 2600);
}
function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
function ar(n) { return String(n).replace(/\d/g, d => '٠١٢٣٤٥٦٧٨٩'[d]); }
function genPass() { const c = 'abcdefghjkmnpqrstuvwxyz23456789'; const a = new Uint32Array(8); crypto.getRandomValues(a); return Array.from(a, x => c[x % c.length]).join(''); }
function fmtDate(t) { return t ? new Date(t * 1000).toLocaleDateString('ar-EG', { day: 'numeric', month: 'long', year: 'numeric' }) : ''; }
function ago(t) {
  if (!t) return 'لسه مافتحش';
  const d = state.now - t;
  if (d < 120) return 'دلوقتي';
  if (d < 3600) return 'من ' + ar(Math.floor(d / 60)) + ' دقيقة';
  if (d < DAY) return 'من ' + ar(Math.floor(d / 3600)) + ' ساعة';
  return 'من ' + ar(Math.floor(d / DAY)) + ' يوم';
}

async function api(path, opts) {
  opts = opts || {};
  const r = await fetch('/admin/api/' + path, {
    method: opts.method || 'GET', credentials: 'same-origin',
    headers: opts.body ? { 'Content-Type': 'application/json' } : {},
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  let data = {};
  try { data = await r.json(); } catch (e) {}
  if (r.status === 401 && path !== 'login') { show('login'); throw new Error('login'); }
  if (!r.ok) throw new Error(data.error || ('خطأ ' + r.status));
  return data;
}
function show(which) { $('#login').hidden = which !== 'login'; $('#app').hidden = which !== 'app'; }

function view(c) {
  if (c.state === 'Active' && c.exp && c.exp - state.now < 3 * DAY) return 'soon';
  return c.state;
}
const STATE_AR = { Active: 'شغال', soon: 'بيخلص قريب', Expired: 'خلص', Disabled: 'موقوف' };

function expText(c) {
  if (!c.exp) return 'من غير ما يخلص';
  const left = c.exp - state.now;
  if (left <= 0) return 'خلص ' + fmtDate(c.exp);
  const d = Math.ceil(left / DAY);
  return 'باقي ' + (d <= 1 ? 'أقل من يوم' : ar(d) + ' يوم') + ' (' + fmtDate(c.exp) + ')';
}

function credsText(c) {
  const s = state.server;
  return [
    'أهلاً' + (c.name ? ' ' + c.name : '') + '، دي بيانات اشتراكك في MIDO:',
    '',
    'السيرفر: ' + s,
    'اليوزر: ' + c.username,
    'الباسورد: ' + c.password,
    c.exp ? 'صالح لحد: ' + fmtDate(c.exp) : '',
    '',
    'في تطبيق MIDO اختار «Xtream» واكتب البيانات دي.',
    'ولو برنامج تاني بيطلب لينك M3U:',
    s + '/get.php?username=' + encodeURIComponent(c.username) + '&password=' + encodeURIComponent(c.password) + '&type=m3u_plus&output=m3u8',
  ].filter((l, i, a) => l || a[i - 1] !== '').join('\n');
}
async function copy(text) {
  try { await navigator.clipboard.writeText(text); toast('اتنسخ ✅، ابعته للعميل'); }
  catch (e) {
    const ta = document.createElement('textarea'); ta.value = text; document.body.appendChild(ta); ta.select();
    try { document.execCommand('copy'); toast('اتنسخ ✅'); } catch (_) { toast('مقدرتش أنسخ، انسخه بإيدك', true); }
    ta.remove();
  }
}

function renderTop() {
  $('#serverUrl').textContent = state.server;
  const L = state.list, k = L.counts;
  const when = L.updated ? new Date(L.updated * 1000).toLocaleTimeString('ar-EG', { hour: 'numeric', minute: '2-digit' }) : '';
  $('#listInfo').textContent = (L.ok ? 'القايمة اتحدّثت ' : '⚠️ آخر تحديث فشل، شغال بآخر نسخة. ') + when;
  const cs = state.customers;
  const n = s => cs.filter(c => view(c) === s).length;
  const parts = [
    [ar(cs.length), 'عميل'], [ar(n('Active') + n('soon')), 'شغال'], [ar(n('Expired')), 'خلص'],
    [ar(k.live), 'قناة'], [ar(k.movie), 'فيلم'], [ar(L.series), 'مسلسل'],
  ].filter((p, i) => i < 2 || p[0] !== '٠');
  $('#stats').innerHTML = parts.map(p => `<div class="stat"><b>${p[0]}</b><span>${p[1]}</span></div>`).join('');
}

function renderList() {
  const q = $('#search').value.trim().toLowerCase();
  const arr = state.customers
    .filter(c => filter === 'all' || view(c) === filter)
    .filter(c => !q || [c.name, c.username, c.phone, c.note].join(' ').toLowerCase().includes(q))
    .sort((a, b) => (b.created || 0) - (a.created || 0));
  if (!arr.length) {
    $('#list').innerHTML = `<div class="empty">${state.customers.length ? 'مفيش عملاء بالشكل ده' : 'لسه مفيش عملاء. اعمل أول حساب من فوق 👆'}</div>`;
    return;
  }
  $('#list').innerHTML = arr.map(c => {
    const v = view(c);
    return `<div class="cust" data-id="${c.id}">
      <div class="cust-head"><h3>${esc(c.name || c.username)}</h3><span class="badge b-${v}">${STATE_AR[v]}</span></div>
      <div class="meta">
        <span>اليوزر: <span class="mono">${esc(c.username)}</span></span>
        <span>الباسورد: <span class="mono">${esc(c.password)}</span></span>
        ${c.phone ? `<span>📱 <span class="mono">${esc(c.phone)}</span></span>` : ''}
        <span>⏳ ${expText(c)}</span>
        <span>👁️ ${ago(c.seen)}${c.watching && state.now - c.seen < 3 * 3600 ? ' · ' + esc(c.watching) : ''}</span>
        ${c.note ? `<span>📝 ${esc(c.note)}</span>` : ''}
      </div>
      <div class="acts">
        <button class="btn sm ghost" data-a="copy">📋 نسخ البيانات</button>
        <button class="btn sm ghost" data-a="renew">➕ جدّد شهر</button>
        <button class="btn sm ghost" data-a="toggle">${c.enabled ? '⏸️ إيقاف' : '▶️ تشغيل'}</button>
        <button class="btn sm ghost" data-a="edit">✏️ تعديل</button>
        <button class="btn sm danger" data-a="del">🗑️ حذف</button>
      </div>
    </div>`;
  }).join('');
}

async function load() {
  const d = await api('status');
  state = d;
  show('app'); renderTop(); renderList();
}

function durationToExp(v, from) {
  if (v === 'none') return null;
  return Math.max(from || 0, state.now) + parseInt(v, 10) * DAY;
}

function dlg(title, html, okText) {
  return new Promise(resolve => {
    const d = $('#dlg');
    $('#dlgTitle').textContent = title; $('#dlgBody').innerHTML = html; $('#dlgOk').textContent = okText || 'حفظ';
    const form = $('#dlgForm');
    const onSubmit = e => {
      e.preventDefault();
      const ok = e.submitter && e.submitter.value === 'ok';
      if (ok && !form.reportValidity()) return;
      form.removeEventListener('submit', onSubmit);
      d.close();
      resolve(ok ? new FormData(form) : null);
    };
    form.addEventListener('submit', onSubmit);
    d.addEventListener('cancel', () => { form.removeEventListener('submit', onSubmit); resolve(null); }, { once: true });
    d.showModal();
  });
}

function dateInput(t) { const d = new Date((t || state.now) * 1000); return d.toISOString().slice(0, 10); }

async function onAction(id, a, btn) {
  const c = state.customers.find(x => x.id === id);
  if (!c) return;
  if (a === 'copy') return copy(credsText(c));
  try {
    btn.disabled = true;
    if (a === 'renew') {
      const exp = Math.max(c.exp || state.now, state.now) + 30 * DAY;
      await api('customers/' + id, { method: 'PUT', body: { exp, enabled: true } });
      toast('اتجدد لحد ' + fmtDate(exp));
    } else if (a === 'toggle') {
      await api('customers/' + id, { method: 'PUT', body: { enabled: !c.enabled } });
      toast(c.enabled ? 'اتوقف ⏸️' : 'اشتغل ▶️');
    } else if (a === 'del') {
      const ok = await dlg('حذف ' + (c.name || c.username) + '؟', '<p class="muted full">الحساب هيتمسح ومش هيقدر يفتح تاني. لو عايز توقفه بس دوس «إيقاف».</p>', 'احذف');
      if (!ok) return;
      await api('customers/' + id, { method: 'DELETE' });
      toast('اتحذف');
    } else if (a === 'edit') {
      const f = await dlg('تعديل ' + (c.name || c.username), `
        <label>الاسم<input name="name" value="${esc(c.name)}" maxlength="80"></label>
        <label>الموبايل<input name="phone" value="${esc(c.phone)}" maxlength="30"></label>
        <label>اليوزر<input name="username" dir="ltr" value="${esc(c.username)}" required maxlength="32" autocapitalize="off" spellcheck="false"></label>
        <label>الباسورد<input name="password" dir="ltr" value="${esc(c.password)}" required maxlength="32" autocapitalize="off" spellcheck="false"></label>
        <label>ينتهي يوم<input name="exp" type="date" value="${c.exp ? dateInput(c.exp) : ''}"></label>
        <label>ملاحظة<input name="note" value="${esc(c.note)}" maxlength="300"></label>
        <p class="muted full">سيب «ينتهي يوم» فاضي لو مش عايزه يخلص.</p>`);
      if (!f) return;
      const ed = f.get('exp');
      // End of the chosen day, Cairo time is close enough: 23:59 local.
      const exp = ed ? Math.floor(new Date(ed + 'T23:59:00').getTime() / 1000) : null;
      await api('customers/' + id, { method: 'PUT', body: {
        name: f.get('name'), phone: f.get('phone'), username: f.get('username').trim(), password: f.get('password').trim(), note: f.get('note'), exp } });
      toast('اتحفظ ✅');
    }
    await load();
  } catch (e) { if (e.message !== 'login') toast(e.message, true); }
  finally { btn.disabled = false; }
}

document.addEventListener('DOMContentLoaded', () => {
  $('#loginForm').addEventListener('submit', async e => {
    e.preventDefault();
    $('#loginErr').textContent = '';
    try { await api('login', { method: 'POST', body: { password: $('#adminPass').value } }); $('#adminPass').value = ''; await load(); }
    catch (err) { $('#loginErr').textContent = err.message; }
  });
  $('#logoutBtn').addEventListener('click', async () => { await api('logout', { method: 'POST' }).catch(() => {}); show('login'); });
  $('#refreshBtn').addEventListener('click', async e => {
    const b = e.currentTarget; b.disabled = true;
    try { const r = await api('refresh', { method: 'POST' }); await load(); toast(r.ok ? 'القايمة اتحدّثت ✅' : 'التحديث فشل: ' + r.error, !r.ok); }
    catch (err) { if (err.message !== 'login') toast(err.message, true); }
    finally { b.disabled = false; }
  });
  const af = $('#addForm');
  af.password.value = genPass();
  $('#genPass').addEventListener('click', () => { af.password.value = genPass(); });
  af.addEventListener('submit', async e => {
    e.preventDefault();
    const b = af.querySelector('[type=submit]'); b.disabled = true;
    try {
      const dur = af.duration.value;
      const c = await api('customers', { method: 'POST', body: {
        name: af.name.value.trim(), phone: af.phone.value.trim(), username: af.username.value.trim(),
        password: af.password.value.trim(), note: af.note.value.trim(), exp: durationToExp(dur), trial: dur === '1d' } });
      await load();
      af.reset(); af.password.value = genPass(); af.duration.value = '30d';
      const text = credsText(c);
      const ok = await dlg('الحساب اتعمل ✅', `<pre class="creds">${esc(text)}</pre>`, '📋 انسخ وابعته');
      if (ok) copy(text);
    } catch (err) { if (err.message !== 'login') toast(err.message, true); }
    finally { b.disabled = false; }
  });
  $('#search').addEventListener('input', renderList);
  $('#filters').addEventListener('click', e => {
    const ch = e.target.closest('.chip'); if (!ch) return;
    filter = ch.dataset.f;
    document.querySelectorAll('#filters .chip').forEach(x => x.classList.toggle('on', x === ch));
    renderList();
  });
  $('#list').addEventListener('click', e => {
    const b = e.target.closest('[data-a]'); if (!b) return;
    onAction(b.closest('.cust').dataset.id, b.dataset.a, b);
  });
  load().catch(() => show('login'));
});
