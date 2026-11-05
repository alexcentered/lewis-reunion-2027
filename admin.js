/* Lewis Family Reunion 2027 — committee back office.
   Google proves who you are (Sign in with Google); the Apps Script backend checks the Sheet's Admins tab and hands back a
   6-hour session key, kept in this tab's sessionStorage only. Every change is checked and logged on the server. */
(() => {
'use strict';
if (window.top !== window.self) { document.documentElement.textContent = ''; return; }   // never run inside another site's frame

const $ = (s, el = document) => el.querySelector(s), $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = v => String(v == null ? '' : v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const CFG = window.LR || {};
const API = CFG.apiUrl || '', CLIENT_ID = (CFG.googleClientId || '').trim();
const SESSION_KEY = 'lr-admin-session', THEME_KEY = 'lr-admin-theme';
const box = s => ({ get(k){ try { return s.getItem(k); } catch (e) { return null; } }, set(k, v){ try { v == null ? s.removeItem(k) : s.setItem(k, v); } catch (e) {} } });
const tabStore = box(window.sessionStorage), deviceStore = box(window.localStorage);

/* ---------- formatting ---------- */
const money = n => n == null || isNaN(n) ? 'TBA' : '$' + Number(n).toLocaleString('en-US', { minimumFractionDigits: n % 1 ? 2 : 0, maximumFractionDigits: 2 });
const toDate = v => { if (!v) return null; const d = new Date(/^\d{4}-\d{2}-\d{2}$/.test(v) ? v + 'T12:00:00' : v); return isNaN(d) ? null : d; };
const fmtDate = v => { const d = toDate(v); return d ? d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: d.getFullYear() === new Date().getFullYear() ? undefined : 'numeric' }) : String(v || ''); };
const fmtWhen = v => { const d = toDate(v); return d ? d.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : String(v || ''); };
const plural = (n, one, many) => n + ' ' + (n === 1 ? one : (many || one + 's'));
const ROLE_LABEL = { owner: 'Owner', treasurer: 'Treasurer', coordinator: 'Coordinator', viewer: 'Viewer' };

/* Household payment states. Colour only where it means something: green = done, amber = waiting on the committee. */
const HH_STATUS = [
  { key: 'Paid in full', icon: '✓', tone: 'good' },
  { key: 'Payment reported, awaiting confirmation', label: 'Awaiting confirmation', icon: '◷', tone: 'warn' },
  { key: 'Partially paid', icon: '◐', tone: 'g1' },
  { key: 'Registered, payment pending', label: 'Payment pending', icon: '○', tone: 'g2' },
  { key: 'Registered, fee to be announced', label: 'Fee to be announced', icon: '◌', tone: 'g3' }
];
const hhStatus = key => HH_STATUS.find(s => s.key === key) || { key, label: key || 'Registered', icon: '·', tone: 'g3' };
const PAY_STATUS = {
  'Reported':     { label: 'To review', icon: '◷', tone: 'warn' },
  'Confirmed':    { label: 'Confirmed', icon: '✓', tone: 'good' },
  'Not received': { label: 'Not received', icon: '✕', tone: 'bad' }
};
const pill = s => `<span class="pill"><i class="t-${s.tone}" aria-hidden="true">${s.icon}</i>${esc(s.label || s.key)}</span>`;
const ENTRY_TYPES = { story: 'Stories', memoriam: 'Tributes', veteran: 'Veterans', directory: 'Directory', photo: 'Photos', market: 'Marketplace' };
const ENTRY_ONE = { story: 'Story', memoriam: 'Tribute', veteran: 'Veteran', directory: 'Directory', photo: 'Photo', market: 'Listing' };
const SHIRT_ORDER = ['Youth S', 'Youth M', 'Youth L', 'XS', 'S', 'M', 'L', 'XL', '2XL', '3XL', '4XL'];
const ACTION_LABEL = {
  'signin': 'Signed in', 'signin.denied': 'Sign-in refused', 'signout': 'Signed out',
  'payment.confirm': 'Confirmed a payment', 'payment.not_received': 'Marked not received', 'payment.reopen': 'Moved a payment back to review',
  'entry.hide': 'Hid an entry', 'entry.show': 'Showed an entry', 'household.resend': 'Sent a fresh link'
};

/* ---------- state ---------- */
const S = {
  session: null, expiresAt: 0, me: null, data: null, synced: 0, tab: 'overview', busy: 0, expiryTimer: 0,
  pay: { filter: 'Reported', q: '' }, hh: { q: '', status: '' }, ent: { type: '', vis: 'all', q: '' }, act: { q: '' }
};
const can = perm => !!(S.me && S.me.perms.indexOf(perm) >= 0);

/* ---------- theme (auto follows the device; the choice is remembered on this device) ---------- */
const THEMES = {
  auto: { icon: '◐', label: 'Auto', next: 'light', say: 'follows this device' },
  light: { icon: '○', label: 'Light', next: 'dark', say: 'light' },
  dark: { icon: '●', label: 'Dark', next: 'auto', say: 'dark' }
};
function setTheme(t){
  if (!THEMES[t]) t = 'auto';
  document.documentElement.dataset.theme = t;
  const th = THEMES[t], b = $('#themeBtn');
  b.innerHTML = `<span aria-hidden="true">${th.icon}</span><span class="tl">${th.label}</span>`;
  b.title = 'Theme: ' + th.label + '. Switch to ' + THEMES[th.next].label;
  b.setAttribute('aria-label', 'Theme ' + th.say + '. Switch to ' + THEMES[th.next].label.toLowerCase());
  deviceStore.set(THEME_KEY, t);
  if (!$('#gate').hidden) renderGoogleButton();
}
const isDark = () => { const t = document.documentElement.dataset.theme; return t === 'dark' || (t === 'auto' && !matchMedia('(prefers-color-scheme: light)').matches); };
$('#themeBtn').addEventListener('click', () => { const now = THEMES[document.documentElement.dataset.theme]; setTheme(now ? now.next : 'auto'); });
matchMedia('(prefers-color-scheme: light)').addEventListener('change', () => { if (!$('#gate').hidden) renderGoogleButton(); });

/* ---------- API ---------- */
class SessionEnded extends Error {}
async function call(op, args){
  if (!API) throw new Error('This page is not connected to the reunion server (config.js has no apiUrl).');
  const res = await fetch(API, {
    method: 'POST', credentials: 'omit', cache: 'no-store',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },   // a "simple" request: no CORS preflight, which Apps Script cannot answer
    body: JSON.stringify(Object.assign({ action: 'admin', op, session: S.session }, args || {}))
  });
  if (!res.ok) throw new Error('The reunion server answered ' + res.status + '.');
  const data = await res.json();
  if (data && data.error === 'session' && op !== 'session'){ endSession(data.message); throw new SessionEnded(data.message); }
  return data;
}
const netFail = err => err instanceof SessionEnded ? '' : (err && err.message && /config\.js|answered/.test(err.message) ? err.message : 'Could not reach the reunion server. Check your connection and try again.');
function setBusy(on){ S.busy = Math.max(0, S.busy + (on ? 1 : -1)); $('#progress').hidden = !S.busy; }

/* ---------- toast ---------- */
let toastTimer = 0;
function toast(text, tone){
  if (!text) return;
  const t = $('#toast');
  t.innerHTML = `<i class="t-${tone === 'bad' ? 'bad' : 'good'}" aria-hidden="true">${tone === 'bad' ? '✕' : '✓'}</i><span>${esc(text)}</span>`;
  t.hidden = false; clearTimeout(toastTimer);
  if (t.showPopover){ try { if (t.matches(':popover-open')) t.hidePopover(); t.showPopover(); } catch (e) {} }   // re-showing lifts it above any open dialog
  toastTimer = setTimeout(() => { if (t.hidePopover){ try { t.hidePopover(); } catch (e) {} } t.hidden = true; }, tone === 'bad' ? 9000 : 5000);
}

/* ---------- confirm dialog ---------- */
function ask({ title, body, ok }){
  const d = $('#ask');
  $('#askTitle').textContent = title; $('#askBody').textContent = body; $('#askOk').textContent = ok || 'Continue';
  d.returnValue = '';
  d.showModal(); $('#askOk').focus();
  return new Promise(resolve => d.addEventListener('close', () => resolve(d.returnValue === 'ok'), { once: true }));
}

/* ---------- sign-in gate ---------- */
let gisState = 'idle';   // idle → loading → ready | failed
function gateMsg(text, tone){ const m = $('#gateMsg'); m.className = 'gate-msg' + (tone ? ' ' + tone : ''); m.textContent = text || ''; }
function showGate(message, tone){
  $('#app').hidden = true; $('#gate').hidden = false;
  document.title = 'Sign in · Committee back office';
  gateMsg(message, tone);
  if (!CLIENT_ID){ gateMsg('The back office is not switched on yet: config.js has no googleClientId. See docs/back-office.md.', 'bad'); return; }
  loadGoogle().then(() => { renderGoogleButton(); if (!message) google.accounts.id.prompt(); }).catch(() => {
    gateMsg('Google sign-in could not load. Check your connection, or pause any content blocker for this page, then reload.', 'bad');
  });
}
function loadGoogle(){
  if (gisState === 'ready') return Promise.resolve();
  if (loadGoogle.p) return loadGoogle.p;
  gisState = 'loading';
  loadGoogle.p = new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://accounts.google.com/gsi/client'; s.async = true;
    const fail = () => { gisState = 'failed'; loadGoogle.p = null; reject(new Error('gis')); };
    const timer = setTimeout(fail, 15000);
    s.onload = () => {
      clearTimeout(timer);
      if (!(window.google && google.accounts && google.accounts.id)) return fail();
      google.accounts.id.initialize({
        client_id: CLIENT_ID, callback: onCredential, auto_select: true, cancel_on_tap_outside: true,
        context: 'signin', ux_mode: 'popup', itp_support: true, use_fedcm_for_prompt: true
      });
      gisState = 'ready'; resolve();
    };
    s.onerror = () => { clearTimeout(timer); fail(); };
    document.head.appendChild(s);
  });
  return loadGoogle.p;
}
function renderGoogleButton(){
  if (gisState !== 'ready') return;
  const el = $('#gsiBtn'); el.innerHTML = '';
  google.accounts.id.renderButton(el, { type: 'standard', theme: isDark() ? 'filled_black' : 'outline', size: 'large', shape: 'pill', text: 'signin_with', logo_alignment: 'left', width: 300 });
}
async function onCredential(resp){
  if (!resp || !resp.credential) return;
  gateMsg('Checking the committee list…', 'busy'); setBusy(true);
  try {
    const res = await call('session', { credential: resp.credential });
    if (res.ok) return startSession(res);
    google.accounts.id.disableAutoSelect();   // don't loop One Tap on an account that was just refused
    gateMsg(res.message || 'Sign-in did not go through. Please try again.', 'bad');
  } catch (err) { gateMsg(netFail(err), 'bad'); }
  finally { setBusy(false); }
}

/* ---------- session lifecycle ---------- */
function startSession(res){
  S.session = res.session; S.expiresAt = Date.now() + (res.expiresIn || 21600) * 1000;
  tabStore.set(SESSION_KEY, JSON.stringify({ k: S.session, x: S.expiresAt }));
  absorb(res); armExpiry(); showApp();
}
function armExpiry(){
  clearTimeout(S.expiryTimer);
  S.expiryTimer = setTimeout(() => endSession('Your 6-hour session ended. Sign in again to carry on.'), Math.max(0, S.expiresAt - Date.now()));
}
function endSession(message){
  clearTimeout(S.expiryTimer);
  S.session = null; S.me = null; S.data = null; S.expiresAt = 0;
  tabStore.set(SESSION_KEY, null);
  if ($('#hh').open) $('#hh').close();
  if ($('#ask').open) $('#ask').close();
  showGate(message || '', 'info');
}
async function signOut(){
  const btn = $('#signOutBtn');
  if (S.session){   // end it on the server too, so the key is dead even if someone copied it; give up waiting after 4 s
    btn.disabled = true; setBusy(true);
    try { await Promise.race([call('signout'), new Promise(r => setTimeout(r, 4000))]); } catch (e) {}
    finally { setBusy(false); btn.disabled = false; }
  }
  if (gisState === 'ready') google.accounts.id.disableAutoSelect();
  endSession('Signed out.');
}
function absorb(res){
  if (res.me) S.me = res.me;
  if (res.data){ S.data = res.data; S.synced = Date.now(); }
}
async function refresh(quiet){
  if (!S.session) return;
  setBusy(true);
  try {
    const res = await call('snapshot');
    if (res.ok){ absorb(res); render(); if (!quiet) toast('Up to date with the Sheet.'); }
    else toast(res.message || 'Could not refresh.', 'bad');
  } catch (err) { toast(netFail(err), 'bad'); }
  finally { setBusy(false); }
}

/* ---------- console shell ---------- */
const TABS = [
  { id: 'overview', label: 'Overview', need: 'dash' },
  { id: 'payments', label: 'Payments', need: 'pay' },
  { id: 'households', label: 'Households', need: 'reg' },
  { id: 'entries', label: 'Entries', need: 'ent' },
  { id: 'activity', label: 'Activity', need: 'audit' }
];
function showApp(){
  $('#gate').hidden = true; $('#app').hidden = false;
  route();
}
function route(){
  if (!S.me) return;
  const want = location.hash.replace('#', '');
  const allowed = TABS.filter(t => can(t.need)).map(t => t.id);
  S.tab = allowed.includes(want) ? want : 'overview';
  render();
}
addEventListener('hashchange', route);

function render(){
  if (!S.me || !S.data) return;
  const d = S.data, me = S.me;
  document.title = TABS.find(t => t.id === S.tab).label + ' · Committee back office';
  const toReview = (d.payments || []).filter(p => p.status === 'Reported').length;
  $('#tabs').innerHTML = TABS.filter(t => can(t.need)).map(t => `<a href="#${t.id}"${t.id === S.tab ? ' aria-current="page"' : ''}>${t.label}${t.id === 'payments' && toReview ? `<span class="badge" aria-label="${toReview} to review">${toReview}</span>` : ''}</a>`).join('');
  const initial = esc((me.name || me.email).trim().charAt(0).toUpperCase());
  $('#who').title = (me.name ? me.name + ' · ' : '') + me.email + ' · ' + (ROLE_LABEL[me.role] || me.role);
  $('#who').innerHTML = (me.picture ? `<img src="${esc(me.picture)}" alt="" referrerpolicy="no-referrer">` : `<span class="av" aria-hidden="true">${initial}</span>`) +
    `<div class="nm"><b title="${esc(me.email)}">${esc(me.name || me.email)}</b><span>${esc(ROLE_LABEL[me.role] || me.role)}</span></div>`;
  $$('[data-panel]').forEach(p => { p.hidden = p.dataset.panel !== S.tab; });
  renderSync();
  ({ overview: renderOverview, payments: renderPayments, households: renderHouseholds, entries: renderEntries, activity: renderActivity })[S.tab]();
}
function renderSync(){
  const ago = Math.round((Date.now() - S.synced) / 60000);
  $$('[data-sync]').forEach(el => { el.textContent = 'Synced ' + (ago < 1 ? 'just now' : plural(ago, 'minute') + ' ago') + ' · ' + S.me.email + ' · ' + (ROLE_LABEL[S.me.role] || S.me.role); });
}
setInterval(() => { if (S.me && !$('#app').hidden) renderSync(); }, 30000);

/* ---------- overview ---------- */
function bars(list, total){
  if (!list.length) return '<p class="empty">Nothing yet.</p>';
  const max = Math.max(1, ...list.map(x => Number(x[1]) || 0));
  return `<ul class="bars">${list.map(([label, v]) => {
    const n = Number(v) || 0;
    const tip = label + ': ' + n + (total ? ' (' + Math.round(n / total * 100) + '%)' : '');
    return `<li title="${esc(tip)}"><div class="bl"><span>${esc(label)}</span><b>${n}</b></div><div class="track" aria-hidden="true"><i style="width:${(n / max * 100).toFixed(1)}%"></i></div></li>`;
  }).join('')}</ul>`;
}
function renderOverview(){
  const d = S.data.dash, fees = S.data.fees || {}, feesSet = fees.adult != null && fees.child != null;
  const days = Math.max(0, Math.ceil((new Date('2027-07-02T12:00:00-07:00') - new Date()) / 864e5));
  const tiles = [
    ['Households', d.households, plural(d.adults, 'adult') + ' · ' + plural(d.children, 'child', 'children')],
    ['Confirmed', money(d.confirmed), feesSet ? 'of ' + money(d.due) + ' due' : 'Fees not set yet'],
    ['Awaiting confirmation', money(d.awaiting), plural(d.toReview, 'payment') + ' to review'],
    ['Outstanding', feesSet ? money(d.balance) : 'TBA', 'Balance after confirmed payments'],
    ['Hotel room-nights', d.hotelNights, plural(d.hotelHouseholds, 'household') + ' at the reunion hotel'],
    ['Days to go', days, 'Friday, July 2, 2027']
  ];
  $('#kpis').innerHTML = tiles.map(([lbl, val, sub]) => `<div class="glass kpi"><div class="lbl">${esc(lbl)}</div><div class="val">${esc(val)}</div><div class="sub">${esc(sub)}</div></div>`).join('');
  const callout = $('#reviewCallout');
  callout.hidden = !(d.toReview && can('pay'));
  if (!callout.hidden) callout.innerHTML = `<span><i aria-hidden="true">◷</i><b>${plural(d.toReview, 'payment')}</b> reported by families ${d.toReview === 1 ? 'is' : 'are'} waiting for someone to check the account.</span><a class="btn sm solid" href="#payments">Review payments →</a>`;

  // Payment status: one whole split into ≤ 5 known states → thin segmented bar + a legend that carries the figures.
  const st = d.status || [], total = st.reduce((a, x) => a + x[1], 0);
  const ordered = HH_STATUS.map(s => [s, (st.find(x => x[0] === s.key) || [0, 0])[1]]).concat(st.filter(x => !HH_STATUS.some(s => s.key === x[0])).map(x => [hhStatus(x[0]), x[1]]));
  const shown = ordered.filter(x => x[1]);
  $('#ovStatus').innerHTML = !total ? '<p class="empty">No households yet.</p>' :
    `<div class="split" role="img" aria-label="${esc(shown.map(([s, n]) => (s.label || s.key) + ' ' + n).join(', '))}">${shown.map(([s, n]) => `<i class="s-${s.tone}" style="flex-grow:${n}" title="${esc((s.label || s.key) + ': ' + n + ' (' + Math.round(n / total * 100) + '%)')}"></i>`).join('')}</div>
     <ul class="legend">${shown.map(([s, n]) => `<li><i class="t-${s.tone}" aria-hidden="true">${s.icon}</i><span>${esc(s.label || s.key)}</span><b>${n}</b></li>`).join('')}</ul>`;
  $('#ovDays').innerHTML = bars(d.days || []);
  $('#ovBranches').innerHTML = bars(d.branches || [], d.households);
  const shirts = (d.shirts || []).slice().sort((a, b) => (SHIRT_ORDER.indexOf(a[0]) + 1 || 99) - (SHIRT_ORDER.indexOf(b[0]) + 1 || 99));
  const nShirts = shirts.reduce((a, x) => a + x[1], 0);
  $('#ovShirtsSub').textContent = nShirts ? plural(nShirts, 'shirt') + ' to order, by size' : 'Shirts to order, by size';
  $('#ovShirts').innerHTML = bars(shirts, nShirts);
  $('#ovLodging').innerHTML = bars(d.lodging || [], d.households);
  $('#ovDiet').innerHTML = bars(d.diet || [], d.households);
}

/* ---------- payments ---------- */
const PAY_FILTERS = [['Reported', 'To review'], ['Not received', 'Not received'], ['Confirmed', 'Confirmed'], ['', 'All']];
function renderPayments(){
  const all = S.data.payments || [], q = S.pay.q.toLowerCase();
  const count = f => all.filter(p => !f || p.status === f).length;
  $('#payFilter').innerHTML = PAY_FILTERS.map(([f, label]) => `<button type="button" data-pf="${esc(f)}" aria-pressed="${S.pay.filter === f}">${label}<span class="n">${count(f)}</span></button>`).join('');
  const list = all.filter(p => (!S.pay.filter || p.status === S.pay.filter) && (!q || [p.household, p.method, p.ref, p.note, p.id].join(' ').toLowerCase().includes(q)));
  $('#paySum').textContent = plural(list.length, 'payment') + ' · ' + money(list.reduce((a, p) => a + p.amount, 0));
  $('#payList').innerHTML = list.length ? list.map(payRow).join('') :
    `<p class="empty">${S.pay.filter === 'Reported' && !q ? 'Nothing to review. Every reported payment has been checked.' : 'No payments match.'}</p>`;
}
function payRow(p){
  const st = PAY_STATUS[p.status] || { label: p.status, icon: '·', tone: 'g3' };
  const who = can('reg') && p.householdId ? `<button type="button" class="link" data-hh="${esc(p.householdId)}">${esc(p.household || 'Unknown household')}</button>` : `<b>${esc(p.household || 'Unknown household')}</b>`;
  const meta = [p.method, p.sent && 'sent ' + fmtDate(p.sent), p.ref && 'ref ' + p.ref, p.reported && 'reported ' + fmtWhen(p.reported)].filter(Boolean).map(esc).join(' · ');
  const decided = p.status !== 'Reported' && (p.decidedOn || p.decidedBy) ? `<div class="hint">${esc(st.label)}${p.decidedOn ? ' ' + esc(fmtDate(p.decidedOn)) : ''}${p.decidedBy ? ' by ' + esc(p.decidedBy) : ''}</div>` : '';
  let actions = '';
  if (!p.id) actions = '<span class="hint">Added straight on the Sheet, so change it there.</span>';
  else if (can('pay.write')) actions = p.status === 'Reported'
    ? `<button type="button" class="btn sm" data-pay="Confirmed" data-id="${esc(p.id)}"><span class="k" aria-hidden="true">✓</span>Confirm received</button><button type="button" class="btn sm" data-pay="Not received" data-id="${esc(p.id)}"><span class="x" aria-hidden="true">✕</span>Not received</button>`
    : `<button type="button" class="btn sm" data-pay="Reported" data-id="${esc(p.id)}">↺ Back to review</button>`;
  return `<article class="pay glass"><div class="pay-main"><div>${who}</div><div class="pay-meta">${meta}</div>${p.note ? `<div class="pay-note">“${esc(p.note)}”</div>` : ''}${decided}</div>
    <div class="pay-amt num">${money(p.amount)}</div><div class="pay-st">${pill(st)}</div><div class="pay-act">${actions}</div></article>`;
}
async function decidePayment(id, status){
  const p = (S.data.payments || []).find(x => x.id === id);
  if (!p) return;
  const who = p.household || 'this household', amt = money(p.amount);
  const copy = {
    'Confirmed': { title: `Confirm ${amt} from ${who}?`, body: 'Only confirm once you can see the money in the account. Their balance updates straight away, and their page shows the payment as confirmed.', ok: '✓ Confirm received' },
    'Not received': { title: `Mark ${amt} from ${who} as not received?`, body: 'Use this when the money has not arrived. Their page will ask them to contact the committee.', ok: '✕ Mark not received' },
    'Reported': { title: `Move ${amt} from ${who} back to review?`, body: 'This undoes the decision. The payment stops counting toward their balance until someone confirms it again.', ok: '↺ Move back to review' }
  }[status];
  if (!await ask(copy)) return;
  await act('payment.set', { id, status, expect: p.status });
}
$('#payFilter').addEventListener('click', e => { const b = e.target.closest('[data-pf]'); if (b){ S.pay.filter = b.dataset.pf; renderPayments(); } });
$('#payQ').addEventListener('input', e => { S.pay.q = e.target.value.trim(); renderPayments(); });

/* ---------- households ---------- */
function hhFiltered(){
  const q = S.hh.q.toLowerCase();
  return (S.data.households || []).filter(h => (!S.hh.status || h.status === S.hh.status) &&
    (!q || [h.name, h.first, h.last, h.email, h.phone, h.city, h.state, h.branch, h.id, h.attendees.map(a => a.name).join(' ')].join(' ').toLowerCase().includes(q)))
    .sort((a, b) => a.last.localeCompare(b.last) || a.name.localeCompare(b.name));
}
function renderHouseholds(){
  const all = S.data.households || [];
  const present = HH_STATUS.filter(s => all.some(h => h.status === s.key)).map(s => s.key).concat([...new Set(all.map(h => h.status))].filter(k => !HH_STATUS.some(s => s.key === k)));
  if (S.hh.status && !present.includes(S.hh.status)) S.hh.status = '';
  $('#hhStatus').innerHTML = '<option value="">Every payment status</option>' + present.map(k => `<option value="${esc(k)}"${k === S.hh.status ? ' selected' : ''}>${esc(hhStatus(k).label || k)}</option>`).join('');
  const list = hhFiltered();
  const people = list.reduce((a, h) => a + h.adults + h.children, 0);
  $('#hhSum').textContent = plural(list.length, 'household') + ' · ' + plural(people, 'person', 'people') + (list.length !== all.length ? ' (of ' + all.length + ')' : '');
  $('#hhRows').innerHTML = list.length ? list.map(h => `<tr data-hh="${esc(h.id)}">
      <td><button type="button" class="link" data-hh="${esc(h.id)}">${esc(h.name)}</button><div class="hint">${esc(h.email)}</div></td>
      <td class="c-branch">${esc(h.branch)}</td><td class="c-from">${esc([h.city, h.state].filter(Boolean).join(', '))}</td>
      <td class="r num">${h.adults + h.children}</td><td>${pill(hhStatus(h.status))}</td><td class="r num">${money(h.balance)}</td></tr>`).join('')
    : `<tr><td colspan="6" class="empty">${all.length ? 'No households match.' : 'No one has registered yet.'}</td></tr>`;
}
$('#hhQ').addEventListener('input', e => { S.hh.q = e.target.value.trim(); renderHouseholds(); });
$('#hhStatus').addEventListener('change', e => { S.hh.status = e.target.value; renderHouseholds(); });

function openHousehold(id){
  const h = (S.data.households || []).find(x => x.id === id);
  if (!h) return;
  const row = (k, v) => v ? `<dt>${esc(k)}</dt><dd>${v}</dd>` : '';
  const pays = (S.data.payments || []).filter(p => p.householdId === id);
  const days = h.days ? esc(h.days) : '';
  $('#hhBody').innerHTML = `
    <div class="panel-head" style="margin-bottom:6px"><div><div class="eyebrow">${esc(h.id)} · registered ${esc(fmtDate(h.registered))}</div><h2 id="hhTitle">${esc(h.name)} household</h2></div>${pill(hhStatus(h.status))}</div>
    <div class="money">${[['Due', h.due], ['Confirmed', h.confirmed], ['Awaiting', h.awaiting], ['Balance', h.balance]].map(([k, v]) => `<div><b>${money(v)}</b><span>${k}</span></div>`).join('')}</div>
    <dl class="dl">
      ${row('Email', h.email ? `<a href="mailto:${esc(h.email)}">${esc(h.email)}</a>` : '')}
      ${row('Phone', h.phone ? `<a href="tel:${esc(h.phone.replace(/[^\d+]/g, ''))}">${esc(h.phone)}</a>` : '')}
      ${row('From', esc([h.city, h.state].filter(Boolean).join(', ')))}
      ${row('Branch', esc(h.branch))}
      ${row('Parents', esc(h.parents))}${row('Grandparent', esc(h.grandparent))}${row('Spouse or partner', esc(h.spouse))}
      ${row('Days', days)}
      ${row('Stay', h.arrive ? esc(fmtDate(h.arrive) + ' → ' + fmtDate(h.depart) + ' · ' + plural(h.nights, 'night')) : '')}
      ${row('Lodging', esc(h.lodging))}${row('Diet', h.diet && h.diet !== 'None' ? esc(h.diet) : '')}${row('Needs', esc(h.needs))}
      ${row('Who’s coming list', h.showOnList ? 'Shown' : 'Hidden at their request')}
    </dl>
    <div class="sec">Coming · ${plural(h.adults, 'adult')}, ${plural(h.children, 'child', 'children')}</div>
    <table class="mini"><thead><tr><th>Name</th><th>Age group</th><th>Age</th><th>T-shirt</th></tr></thead><tbody>${h.attendees.map(a => `<tr><td>${esc(a.name)}</td><td>${a.band === 'child' ? 'Child' : 'Adult'}</td><td>${esc(a.age)}</td><td>${esc(a.shirt)}</td></tr>`).join('')}</tbody></table>
    ${S.data.payments ? `<div class="sec">Payments</div>${pays.length ? `<table class="mini"><tbody>${pays.map(p => `<tr><td class="num">${money(p.amount)}</td><td>${esc(p.method)}</td><td>${esc(fmtDate(p.sent))}</td><td>${pill(PAY_STATUS[p.status] || { label: p.status, icon: '·', tone: 'g3' })}</td></tr>`).join('')}</tbody></table>` : '<p class="hint">No payments reported yet.</p>'}` : ''}
    <div class="dlg-actions actions">
      ${can('reg.resend') ? `<button type="button" class="btn" data-resend="${esc(h.id)}">${S.data.siteLive ? '↻ Email a fresh private link' : '↻ Email their receipt again'}</button>` : ''}
      <button type="button" class="btn solid" data-close>Close</button>
    </div>`;
  const d = $('#hh');
  if (!d.open) d.showModal();
}
$('#hh').addEventListener('click', e => {
  if (e.target === e.currentTarget || e.target.closest('[data-close]')) $('#hh').close();   // click on the backdrop or Close
});
async function resend(id){
  const h = (S.data.households || []).find(x => x.id === id);
  if (!h) return;
  const live = S.data.siteLive;
  const ok = await ask(live
    ? { title: `Email ${h.name} a fresh private link?`, body: `It goes to ${h.email}. Their old link stops working, so only do this when they have asked for it or lost it.`, ok: 'Send the link' }
    : { title: `Email ${h.name} their receipt again?`, body: `It goes to ${h.email} and lists who is on their registration.`, ok: 'Send the receipt' });
  if (!ok) return;
  const res = await act('household.resend', { id });
  if (res && $('#hh').open) openHousehold(id);
}

/* CSV of the households shown. Cells that start like a formula get a leading quote, so a spreadsheet keeps them as text. */
function exportCsv(){
  const list = hhFiltered();
  if (!list.length){ toast('No households to export.', 'bad'); return; }
  const cols = [['Household ID', 'id'], ['Household', 'name'], ['First', 'first'], ['Last', 'last'], ['Email', 'email'], ['Phone', 'phone'], ['City', 'city'], ['State', 'state'],
    ['Branch', 'branch'], ['Adults', 'adults'], ['Children', 'children'], ['Attendees', h => h.attendees.map(a => a.name + (a.band === 'child' ? ' (child' + (a.age ? ' ' + a.age : '') + ')' : '') + (a.shirt ? ' [' + a.shirt + ']' : '')).join('; ')],
    ['Days', 'days'], ['Arrive', 'arrive'], ['Depart', 'depart'], ['Nights', 'nights'], ['Lodging', 'lodging'], ['Diet', 'diet'], ['Needs', 'needs'],
    ['Due', 'due'], ['Confirmed', 'confirmed'], ['Awaiting', 'awaiting'], ['Balance', 'balance'], ['Status', 'status'], ['Registered', h => fmtDate(h.registered)]];
  const cell = v => { let s = String(v == null ? '' : v); if (/^[=+\-@\t\r]/.test(s)) s = "'" + s; return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
  const lines = [cols.map(c => cell(c[0])).join(',')].concat(list.map(h => cols.map(([, k]) => cell(typeof k === 'function' ? k(h) : h[k])).join(',')));
  const blob = new Blob(['\ufeff' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = 'lewis-reunion-households-' + new Date().toISOString().slice(0, 10) + '.csv';
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  toast('Exported ' + plural(list.length, 'household') + '. The file holds contact details, so keep it private.');
}
$('#csvBtn').addEventListener('click', exportCsv);

/* ---------- entries ---------- */
function renderEntries(){
  const all = S.data.entries || [], q = S.ent.q.toLowerCase();
  if (!$('#entType').options.length) $('#entType').innerHTML = '<option value="">Every section</option>' + Object.entries(ENTRY_TYPES).map(([k, v]) => `<option value="${k}">${v}</option>`).join('');
  const vis = [['all', 'All'], ['shown', 'Showing'], ['hidden', 'Hidden']];
  $('#entVis').innerHTML = vis.map(([k, label]) => `<button type="button" data-ev="${k}" aria-pressed="${S.ent.vis === k}">${label}<span class="n">${all.filter(e => (!S.ent.type || e.type === S.ent.type) && (k === 'all' || (k === 'shown') === e.visible)).length}</span></button>`).join('');
  const list = all.filter(e => (!S.ent.type || e.type === S.ent.type) && (S.ent.vis === 'all' || (S.ent.vis === 'shown') === e.visible) &&
    (!q || [e.title, e.subtitle, e.meta, e.body, e.by, e.contact].join(' ').toLowerCase().includes(q)));
  $('#entSum').textContent = plural(list.length, 'entry', 'entries') + (all.some(e => !e.visible) ? ' · ' + all.filter(e => !e.visible).length + ' hidden in total' : '');
  $('#entList').innerHTML = list.length ? list.map(e => `<article class="glass entry${e.visible ? '' : ' off'}">
      ${e.photo ? `<img src="${esc(e.photo)}" alt="" loading="lazy" referrerpolicy="no-referrer">` : ''}
      <div class="eyebrow">${esc(ENTRY_ONE[e.type] || e.type)}${e.meta ? ' · ' + esc(e.meta) : ''}</div>
      <h3>${esc(e.title || '(untitled)')}</h3>${e.subtitle ? `<div class="hint">${esc(e.subtitle)}</div>` : ''}
      ${e.body ? `<div class="body">${esc(e.body)}</div>` : ''}${e.contact ? `<div class="hint">${esc(e.contact)}</div>` : ''}
      <div class="foot"><span class="hint">${esc(e.by || 'Family')} · ${esc(fmtDate(e.posted))}</span>
        ${can('ent.write') ? `<label class="switch"><input type="checkbox" data-vis="${esc(e.id)}"${e.visible ? ' checked' : ''}><span>${e.visible ? 'Showing' : 'Hidden'}</span></label>` : `<span class="hint">${e.visible ? 'Showing' : 'Hidden'}</span>`}</div>
    </article>`).join('') : '<p class="empty">No entries match.</p>';
}
$('#entType').addEventListener('change', e => { S.ent.type = e.target.value; renderEntries(); });
$('#entVis').addEventListener('click', e => { const b = e.target.closest('[data-ev]'); if (b){ S.ent.vis = b.dataset.ev; renderEntries(); } });
$('#entQ').addEventListener('input', e => { S.ent.q = e.target.value.trim(); renderEntries(); });
$('#entList').addEventListener('change', async e => {
  const sw = e.target.closest('[data-vis]'); if (!sw) return;
  sw.disabled = true;
  const res = await act('entry.visible', { id: sw.dataset.vis, visible: sw.checked });
  if (!res || !res.ok) renderEntries();   // put the switch back the way the Sheet says
});

/* ---------- activity ---------- */
function renderActivity(){
  const q = S.act.q.toLowerCase(), all = S.data.audit || [];
  const list = all.filter(a => !q || [a.who, a.action, ACTION_LABEL[a.action], a.target, a.detail].join(' ').toLowerCase().includes(q));
  $('#actRows').innerHTML = list.length ? list.map(a => `<tr><td class="num">${esc(fmtWhen(a.when))}</td><td>${esc(a.who)}</td>
      <td>${a.action === 'signin.denied' ? '<span class="t-bad" aria-hidden="true">✕ </span>' : ''}${esc(ACTION_LABEL[a.action] || a.action)}${a.target ? `<div class="hint">${esc(a.target)}</div>` : ''}</td><td>${esc(a.detail)}</td></tr>`).join('')
    : '<tr><td colspan="4" class="empty">Nothing logged yet.</td></tr>';
}
$('#actQ').addEventListener('input', e => { S.act.q = e.target.value.trim(); renderActivity(); });

/* ---------- actions ---------- */
async function act(op, args){
  setBusy(true);
  try {
    const res = await call(op, args);
    absorb(res); render();
    toast(res.message || (res.ok ? 'Done.' : 'That did not go through. Please try again.'), res.ok ? 'ok' : 'bad');
    return res;
  } catch (err) { toast(netFail(err), 'bad'); return null; }
  finally { setBusy(false); }
}
document.addEventListener('click', e => {
  const pay = e.target.closest('[data-pay]');
  if (pay){ decidePayment(pay.dataset.id, pay.dataset.pay); return; }
  const rs = e.target.closest('[data-resend]');
  if (rs){ resend(rs.dataset.resend); return; }
  const hh = e.target.closest('[data-hh]');
  if (hh && can('reg') && !$('#hh').contains(hh)) openHousehold(hh.dataset.hh);
});
$('#refreshBtn').addEventListener('click', () => refresh(false));
$('#signOutBtn').addEventListener('click', signOut);
document.addEventListener('keydown', e => {
  if (e.key !== '/' || e.metaKey || e.ctrlKey || /^(INPUT|SELECT|TEXTAREA)$/.test(document.activeElement.tagName) || $('#app').hidden) return;
  const s = $(`[data-panel="${S.tab}"] [data-search]`);
  if (s){ e.preventDefault(); s.focus(); }
});
document.addEventListener('visibilitychange', () => {
  if (document.hidden || !S.session) return;
  if (Date.now() >= S.expiresAt) return endSession('Your 6-hour session ended. Sign in again to carry on.');
  if (Date.now() - S.synced > 60000) refresh(true);   // catch up on what others changed while this tab was in the background
});

/* ---------- boot ---------- */
setTheme(deviceStore.get(THEME_KEY) || 'auto');
(function boot(){
  let saved = null;
  try { saved = JSON.parse(tabStore.get(SESSION_KEY) || 'null'); } catch (e) {}
  if (!saved || !saved.k || !(saved.x > Date.now())){ tabStore.set(SESSION_KEY, null); showGate(''); return; }
  S.session = saved.k; S.expiresAt = saved.x; armExpiry();
  setBusy(true);
  call('snapshot').then(res => {
    if (res.ok){ absorb(res); showApp(); }
    else showGate(res.message || '', 'bad');
  }).catch(err => { if (!(err instanceof SessionEnded)) showGate(netFail(err), 'bad'); }).finally(() => setBusy(false));
})();
})();
