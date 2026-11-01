/* Lewis Family Reunion 2027 — site logic. Talks to the Google Apps Script backend set in config.js. */
(() => {
'use strict';
const $ = s => document.querySelector(s), $$ = s => [...document.querySelectorAll(s)];
const esc = v => String(v == null ? '' : v).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const money = n => n == null || n === '' || isNaN(n) ? 'TBA' : '$' + Number(n).toLocaleString('en-US', {minimumFractionDigits: n % 1 ? 2 : 0, maximumFractionDigits: 2});
const store = {
  get(k){ try { return localStorage.getItem(k); } catch (e) { return null; } },
  set(k, v){ try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch (e) {} }
};
const API = (window.LR && window.LR.apiUrl) || '';

/* ---------- link parameters: ?c=<family code>&t=<private registration token> ---------- */
(function readLink(){
  const q = new URLSearchParams(location.search);
  if (q.get('c')) store.set('lr-code', q.get('c').trim());
  if (q.get('t')) store.set('lr-token', q.get('t').trim());
  if (q.has('c') || q.has('t')) history.replaceState(null, '', location.pathname + location.hash);
})();

/* ---------- look + mode ---------- */
const root = document.documentElement;
function setLook(l){ root.dataset.look = l; $$('.looks button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.l === l))); store.set('lr-look', l); drawRings(true); }
function setMode(m, save){ root.dataset.mode = m; const b = $('#modeBtn'); b.textContent = m === 'dark' ? 'Light' : 'Dark'; b.setAttribute('aria-label', 'Switch to ' + (m === 'dark' ? 'light' : 'dark') + ' mode'); if (save) store.set('lr-theme', m); drawRings(true); }
$$('.looks button').forEach(b => b.addEventListener('click', () => setLook(b.dataset.l)));
$('#modeBtn').addEventListener('click', () => setMode(root.dataset.mode === 'dark' ? 'light' : 'dark', true));

/* ---------- tree-ring canvas ---------- */
const cv = $('#rings'), ctx = cv && cv.getContext('2d');
const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
const t0 = performance.now();
let currentView = 'home';
function drawRings(once){
  if (!ctx) return;
  const dpr = Math.min(devicePixelRatio || 1, 2), S = 720;
  if (cv.width !== S * dpr){ cv.width = S * dpr; cv.height = S * dpr; }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, S, S);
  ctx.strokeStyle = getComputedStyle(root).getPropertyValue('--accent').trim();
  const t = (performance.now() - t0) / 1000;
  for (let i = 0; i < 22; i++){
    const r = 30 + i * 15;
    ctx.globalAlpha = 0.05 + (i % 4 === 0 ? 0.13 : 0.05);
    ctx.lineWidth = i % 4 === 0 ? 1.4 : 0.8;
    ctx.beginPath();
    for (let a = 0; a <= 360; a += 3){
      const th = a * Math.PI / 180;
      const wob = Math.sin(th * 3 + i * 0.7 + t * 0.15) * (2 + i * 0.25) + Math.sin(th * 5 - i * 0.4 - t * 0.1) * (1 + i * 0.12);
      const x = S / 2 + Math.cos(th) * (r + wob), y = S / 2 + Math.sin(th) * (r + wob) * 0.96;
      a === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    }
    ctx.closePath(); ctx.stroke();
  }
  ctx.globalAlpha = 1;
  if (!once && !reduce && !document.hidden && currentView === 'home') requestAnimationFrame(() => drawRings(false));
}

/* ---------- state ---------- */
const DEFAULT_AGENDA = { days: [
  { title: 'Friday', date: 'July 2', items: [ {time:'Afternoon', what:'Hotel check-in', where:'Home2 Suites Fresno Northwest'}, {time:'Evening', what:'Meet & Greet', where:'Venue TBA'} ] },
  { title: 'Saturday', date: 'July 3', items: [ {time:'Daytime', what:'Reunion activities', where:'Venue TBA'}, {time:'Evening', what:'Banquet', where:'Venue TBA'} ] },
  { title: 'Sunday', date: 'July 4', items: [ {time:'Daytime', what:'Family day and picnic', where:'Venue TBA'}, {time:'Night', what:'Fourth of July fireworks', where:''} ] },
  { title: 'Monday', date: 'July 5', items: [ {time:'Morning', what:'Farewell breakfast', where:'Venue TBA'} ] }
]};
const DAYS = [
  { key: 'fri', label: 'Fri, July 2', long: 'Check-in and Meet & Greet' },
  { key: 'sat', label: 'Sat, July 3', long: 'Reunion day and Banquet' },
  { key: 'sun', label: 'Sun, July 4', long: 'Family day and fireworks' },
  { key: 'mon', label: 'Mon, July 5', long: 'Farewell breakfast' }
];
const S = {
  info: { agenda: DEFAULT_AGENDA, email: 'lewisfamilyreunion2027@gmail.com', feeAdult: null, feeChild: null, childAge: 12, deadline: '', roomBlock: '' },
  family: null,            // branches, names, roll, entries, pay — only with the family code
  code: store.get('lr-code') || '', token: store.get('lr-token') || '',
  mine: null, codeBad: false
};

/* ---------- API ---------- */
async function api(action, payload){
  if (!API) throw Object.assign(new Error('The site is not connected to its spreadsheet yet.'), { code: 'noapi' });
  const res = await fetch(API, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify({ action, code: S.code, ...payload }) });
  if (!res.ok) throw new Error('The server answered ' + res.status + '.');
  const data = await res.json();
  if (data && data.error === 'code'){ S.codeBad = true; renderGates(); }
  return data;
}
const failText = e => (e && e.code === 'noapi') ? e.message : 'We could not reach the reunion server. Check your connection and try again.';

/* ---------- routing ---------- */
const VIEWS = ['home','reunion','register','family','photos','market','me'];
function route(){
  let v = location.hash.replace('#', '');
  if (!VIEWS.includes(v)) v = 'home';
  currentView = v;
  $$('[data-view]').forEach(s => s.classList.toggle('on', s.dataset.view === v));
  $$('.nav a').forEach(a => { if (a.getAttribute('href') === '#' + v) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current'); });
  window.scrollTo(0, 0);
  if (v === 'home') drawRings(false);
}
addEventListener('hashchange', route);
$$('.subnav button').forEach(b => b.addEventListener('click', () => {
  $$('.subnav button').forEach(x => x.setAttribute('aria-pressed', String(x === b)));
  $$('[data-subview]').forEach(d => d.hidden = d.dataset.subview !== b.dataset.sub);
}));

/* ---------- family-code gate ---------- */
const hasFamily = () => !!S.family;
function renderGates(){
  const show = !hasFamily();
  $$('[data-gate]').forEach((g, i) => {
    g.hidden = !show;
    if (!show) return;
    g.innerHTML = `<h3>Family members only</h3><p>${S.codeBad ? 'That family code did not work. ' : ''}This part of the site is for Lewis and Antone family. Open the link the reunion committee sent you, or enter the family code from it.</p>
      <div class="row"><input type="text" id="gate-in-${i}" placeholder="Family code" autocomplete="off" autocapitalize="none" spellcheck="false" aria-label="Family code" style="flex:1;min-width:200px;max-width:340px"><button type="button" class="btn" data-gate-go="${i}">Continue</button></div>`;
  });
  $('#regForm').hidden = show;
  $('.subnav').hidden = show;
  $$('[data-subview]').forEach(d => { if (show) d.hidden = true; });
  if (!show){ const on = $('.subnav [aria-pressed="true"]'); $$('[data-subview]').forEach(d => d.hidden = d.dataset.subview !== (on ? on.dataset.sub : 'tree')); }
  $$('.adder').forEach(a => a.hidden = show);
}
document.addEventListener('click', e => {
  const b = e.target.closest('[data-gate-go]'); if (!b) return;
  const v = $('#gate-in-' + b.dataset.gateGo).value.trim(); if (!v) return;
  S.code = v; S.codeBad = false; store.set('lr-code', v); loadFamily();
});
document.addEventListener('keydown', e => { if (e.key === 'Enter' && e.target.id && e.target.id.startsWith('gate-in-')){ e.preventDefault(); $(`[data-gate-go="${e.target.id.slice(8)}"]`).click(); } });

/* ---------- public info ---------- */
function fmtDate(iso){ if (!iso) return ''; const d = new Date(iso + 'T12:00:00'); return isNaN(d) ? iso : d.toLocaleDateString('en-US', {month: 'long', day: 'numeric', year: 'numeric'}); }
function renderAgenda(){
  const days = (S.info.agenda && S.info.agenda.days && S.info.agenda.days.length) ? S.info.agenda.days : DEFAULT_AGENDA.days;
  $('#agenda').innerHTML = days.map(d => `<div class="card day"><div class="d">${esc(d.date)}</div><h3>${esc(d.title)}</h3><div style="margin-top:10px">${(d.items || []).map(it => `<div class="item"><div class="t">${esc(it.time || 'Time TBA')}</div><div class="w">${esc(it.what)}</div>${it.where ? `<div class="p">${esc(it.where)}</div>` : ''}</div>`).join('')}</div></div>`).join('');
}
function feeSet(){ return S.info.feeAdult != null && S.info.feeChild != null; }
function renderInfo(){
  const i = S.info;
  $('#roomBlock').textContent = i.roomBlock || 'Room-block details coming from the committee.';
  $('#committeeEmail').textContent = i.email || 'lewisfamilyreunion2027@gmail.com';
  $('#sFeeNote').textContent = feeSet() ? `${money(i.feeAdult)} per adult, ${money(i.feeChild)} per child under ${i.childAge || 12}.` + (i.deadline ? ' Due by ' + fmtDate(i.deadline) + '.' : '')
    : 'The committee will post registration fees soon. You can register now and pay later.';
  const p = (S.family && S.family.pay) || {};
  const ways = [p.zelle && 'Zelle: ' + p.zelle, p.cashapp && 'Cash App: ' + p.cashapp, p.venmo && 'Venmo: ' + p.venmo, p.paypal && 'PayPal: ' + p.paypal].filter(Boolean);
  const how = ways.length ? 'Send payment by ' + ways.join(' · ') + '.' : 'The committee will post where to send payment.';
  $('#payHow').textContent = how + (p.verifier ? ' ' + p.verifier + ' confirms each payment.' : '') + (i.deadline ? ' Due by ' + fmtDate(i.deadline) + '.' : '');
  $('#faqPay').textContent = 'Pay the committee using the method posted on your My Registration page. Then report the payment there. Your balance updates once ' + (p.verifier || "the committee's payment verifier") + ' confirms the money arrived. Until then it shows as “awaiting confirmation.”';
  renderAgenda(); updateSummary(); renderCounts();
}
function renderCounts(){
  $('#cdDays').textContent = Math.max(0, Math.ceil((new Date('2027-07-02T12:00:00-07:00') - new Date()) / 864e5));
  const roll = S.family ? S.family.roll : null;
  $('#cdHouses').textContent = roll ? roll.length : '—';
  $('#cdBranches').textContent = roll ? new Set(roll.map(r => r.branch).filter(b => b && b !== 'Not sure yet' && b !== 'Married into the family')).size : '—';
}

/* ---------- family data ---------- */
function linesFrom(branches){
  const by = {};
  branches.forEach(b => { (by[b.line] = by[b.line] || { line: b.line, founders: b.founders, kids: [] }).kids.push(b.child); });
  return Object.values(by);
}
function renderFamily(){
  const F = S.family;
  if (!F){ $('#lines').innerHTML = ''; $('#names').innerHTML = ''; $('#meet').hidden = true; $('#roll').innerHTML = ''; ['stories','memoriam','veterans','directory','photos','market'].forEach(n => $('#list-' + n).innerHTML = ''); renderStrip([]); renderCounts(); return; }
  const L = linesFrom(F.branches || []);
  $('#lines').innerHTML = L.map(x => `<div class="card line"><div class="kicker">${esc(x.line)} line</div><h3>The ${esc(x.line === 'Lewis' ? 'Lewises' : x.line + 's')}</h3><p class="f">Descended from ${esc(x.founders)} and their children:</p><ol class="kids">${x.kids.map((k, i) => `<li><span class="num">${String(i + 1).padStart(2, '0')}</span><span>${esc(k)}</span></li>`).join('')}</ol></div>`).join('');
  const sel = $('#fBranch'), cur = sel.value;
  sel.innerHTML = '<option value="">Choose your branch</option>' + L.map(x => `<optgroup label="${esc(x.line)} line: children of ${esc(x.founders)}">${x.kids.map(k => `<option value="${esc(x.line + ': ' + k)}">${esc(k)}</option>`).join('')}</optgroup>`).join('') +
    '<optgroup label="Other"><option value="Both lines">Both lines</option><option value="Married into the family">Married into the family</option><option value="Not sure yet">Not sure yet</option></optgroup>';
  if (cur) sel.value = cur; else if (S.mine) sel.value = S.mine.reg.branch || '';
  const MEET = 'Where the two lines meet';
  const meet = (F.names || []).find(n => n.name === MEET);
  $('#meet').hidden = !meet;
  $('#meet').textContent = meet ? MEET + ': ' + meet.note : '';
  $('#names').innerHTML = (F.names || []).filter(n => n.name !== MEET).map(n => `<div class="card name"><h3>${esc(n.name)}</h3><p>${esc(n.note)}</p>${n.question ? `<div class="q">${esc(n.question)}</div>` : ''}</div>`).join('');
  const roll = (F.roll || []).slice().sort((a, b) => String(a.household).localeCompare(String(b.household)));
  $('#roll').innerHTML = roll.length ? roll.map(r => `<div class="who"><b>${esc(r.household)}</b><span>${esc(r.branch)}${r.place ? ' · ' + esc(r.place) : ''}${r.count ? ' · ' + r.count + (r.count == 1 ? ' person' : ' people') : ''}</span></div>`).join('') : '<p class="empty">No households yet. Be the first one on the list.</p>';
  const groups = { stories: 'story', memoriam: 'memoriam', veterans: 'veteran', directory: 'directory', photos: 'photo', market: 'market' };
  Object.entries(groups).forEach(([list, type]) => {
    const items = (F.entries || []).filter(e => e.type === type);
    $('#list-' + list).innerHTML = items.length ? items.map(CARD[type]).join('') : `<p class="empty">${EMPTY[type]}</p>`;
    if (type === 'photo') renderStrip(items);
  });
  renderCounts(); renderInfo();
}
const img = (e, alt) => e.photo ? `<img src="${esc(e.photo)}" alt="${esc(alt || '')}" loading="lazy" referrerpolicy="no-referrer">` : '';
const by = e => `<div class="by"><span>${e.by ? 'Shared by ' + esc(e.by) : 'Shared by family'}</span><span class="num">${esc(fmtDate(e.posted))}</span></div>`;
const CARD = {
  story: e => `<div class="entry"><div class="meta">${esc(e.subtitle || 'Family story')}</div><h3>${esc(e.title || 'A family story')}</h3><p>${esc(e.body)}</p>${by(e)}</div>`,
  memoriam: e => `<div class="entry">${img(e, e.title)}<div class="meta">${esc(e.meta)}</div><h3>${esc(e.title)}</h3>${e.subtitle ? `<p><em>“${esc(e.subtitle)}”</em></p>` : ''}${e.contact ? `<p>${esc(e.contact)}</p>` : ''}<p>${esc(e.body)}</p>${by(e)}</div>`,
  veteran: e => `<div class="entry">${img(e, e.title)}<div class="meta">${esc(e.meta)}</div><h3>${esc(e.title)}</h3>${e.subtitle ? `<p>${esc(e.subtitle)}</p>` : ''}<p>${esc(e.body)}</p>${by(e)}</div>`,
  directory: e => `<div class="entry">${img(e, e.title)}<div class="meta">${esc(e.meta)}</div><h3>${esc(e.title)}</h3><p><b style="color:var(--text);font-weight:500">${esc(e.subtitle)}</b></p><p>${esc(e.body)}</p>${e.contact ? `<p>${esc(e.contact)}</p>` : ''}${by(e)}</div>`,
  market: e => `<div class="entry">${img(e, e.title)}<div class="meta">${esc(e.meta)}</div><h3>${esc(e.title)}</h3>${e.subtitle ? `<p>From ${esc(e.subtitle)}</p>` : ''}<p>${esc(e.body)}</p>${e.contact ? `<p>Contact: ${esc(e.contact)}</p>` : ''}${by(e)}</div>`,
  photo: e => `<figure class="photo">${img(e, e.title || 'Family photo')}<figcaption><b>${esc(e.title || 'Family photo')}</b>${e.meta ? ' · ' + esc(e.meta) : ''}${e.subtitle ? ' · ' + esc(e.subtitle) : ''}${e.body ? '<br>' + esc(e.body) : ''}${by(e)}</figcaption></figure>`
};
const EMPTY = { story: 'No stories yet. Share the first one.', memoriam: 'No tributes yet.', veteran: 'No veterans added yet.', directory: 'No one has added themselves yet.', market: 'No listings yet.', photo: 'No photos yet. Add the first one below.' };
function renderStrip(items){
  const pics = items.filter(i => i.photo).slice(0, 14);
  const words = '<span>Our roots are our ancestors.</span><span>Our branches are our children.</span><span>Our story is our legacy.</span>';
  const inner = pics.length ? pics.map(p => `<img src="${esc(p.photo)}" alt="" referrerpolicy="no-referrer">`).join('') + words : words + words;
  $('#strip').innerHTML = inner + inner;
}

/* ---------- registration form ---------- */
let attendees = [{ name: '', band: 'adult', age: '', shirt: '' }];
const SHIRTS = ['Youth S','Youth M','Youth L','XS','S','M','L','XL','2XL','3XL','4XL','No shirt'];
function renderAttendees(){
  $('#attendees').innerHTML = attendees.map((a, i) => `<div class="att">
    <div class="nm"><label for="a-n${i}">Full name</label><input id="a-n${i}" data-i="${i}" data-k="name" value="${esc(a.name)}"></div>
    <div><label for="a-b${i}">Adult or child</label><select id="a-b${i}" data-i="${i}" data-k="band"><option value="adult" ${a.band === 'adult' ? 'selected' : ''}>Adult</option><option value="child" ${a.band === 'child' ? 'selected' : ''}>Child</option></select></div>
    <div><label for="a-a${i}">Age</label><input id="a-a${i}" data-i="${i}" data-k="age" inputmode="numeric" value="${esc(a.age)}"></div>
    <div><label for="a-s${i}">T-shirt</label><select id="a-s${i}" data-i="${i}" data-k="shirt"><option value="">Size</option>${SHIRTS.map(s => `<option ${a.shirt === s ? 'selected' : ''}>${s}</option>`).join('')}</select></div>
    <div>${i ? `<button type="button" class="btn quiet sm" data-rm="${i}" aria-label="Remove person ${i + 1}">Remove</button>` : ''}</div></div>`).join('');
  updateSummary();
}
['input', 'change'].forEach(ev => $('#attendees').addEventListener(ev, e => { const t = e.target; if (t.dataset.i != null){ attendees[+t.dataset.i][t.dataset.k] = t.value; updateSummary(); } }));
$('#attendees').addEventListener('click', e => { const r = e.target.dataset && e.target.dataset.rm; if (r != null){ attendees.splice(+r, 1); renderAttendees(); } });
$('#addAtt').addEventListener('click', () => { attendees.push({ name: '', band: 'adult', age: '', shirt: '' }); renderAttendees(); $('#a-n' + (attendees.length - 1)).focus(); });
$('#dayChecks').innerHTML = DAYS.map(d => `<label class="check"><input type="checkbox" name="day" value="${d.key}" checked> <span><b style="font-weight:600">${d.label}</b><br><span class="hint">${d.long}</span></span></label>`).join('');
['#fArrive', '#fDepart'].forEach(s => $(s).addEventListener('change', updateSummary));
function nights(a, d){ const n = Math.round((new Date(d + 'T12:00:00') - new Date(a + 'T12:00:00')) / 864e5); return isNaN(n) || n < 0 ? 0 : n; }
function updateSummary(){
  const named = attendees.filter(a => a.name.trim());
  const ad = named.filter(a => a.band !== 'child').length, ch = named.filter(a => a.band === 'child').length;
  $('#sAdults').textContent = ad; $('#sKids').textContent = ch;
  $('#sNights').textContent = nights($('#fArrive').value, $('#fDepart').value);
  $('#sTotal').textContent = feeSet() ? money(ad * S.info.feeAdult + ch * S.info.feeChild) : 'TBA';
}
function collectReg(){
  const v = s => $(s).value.trim();
  return { first: v('#fFirst'), middle: v('#fMiddle'), last: v('#fLast'), birthSurname: v('#fBirth'), preferred: v('#fPreferred'),
    email: v('#fEmail'), phone: v('#fPhone'), city: v('#fCity'), state: v('#fState'),
    branch: $('#fBranch').value, parents: v('#fParents'), grandparent: v('#fGrand'), spouse: v('#fSpouse'),
    attendees: attendees.filter(a => a.name.trim()).map(a => ({ name: a.name.trim(), band: a.band, age: String(a.age || '').trim(), shirt: a.shirt })),
    days: $$('input[name="day"]:checked').map(x => x.value), arrive: $('#fArrive').value, depart: $('#fDepart').value,
    lodging: $('#fLodging').value, diet: $('#fDiet').value, needs: v('#fNeeds'), travelAck: $('#fTravel').checked, showOnList: $('#fShow').checked };
}
function fillReg(r){
  const set = (s, v) => { if (v != null && v !== '') $(s).value = v; };
  set('#fFirst', r.first); set('#fMiddle', r.middle); set('#fLast', r.last); set('#fBirth', r.birthSurname); set('#fPreferred', r.preferred);
  set('#fEmail', r.email); set('#fPhone', r.phone); set('#fCity', r.city); set('#fState', r.state);
  set('#fBranch', r.branch); set('#fParents', r.parents); set('#fGrand', r.grandparent); set('#fSpouse', r.spouse);
  set('#fArrive', r.arrive); set('#fDepart', r.depart); set('#fLodging', r.lodging); set('#fDiet', r.diet); set('#fNeeds', r.needs);
  $('#fTravel').checked = true; $('#fShow').checked = r.showOnList !== false;
  $$('input[name="day"]').forEach(x => x.checked = (r.days || []).includes(x.value));
  attendees = (r.attendees && r.attendees.length) ? r.attendees.map(a => ({ ...a })) : [{ name: '', band: 'adult', age: '', shirt: '' }];
  renderAttendees();
  $('#regTitle').textContent = 'Update your registration';
  $('#regSubmit').textContent = 'Save changes';
}
function say(el, text, ok){ el.className = 'msg ' + (ok ? 'ok' : 'err'); el.textContent = text; }
function privateLink(){ return location.origin + location.pathname + '?c=' + encodeURIComponent(S.code) + '&t=' + encodeURIComponent(S.token) + '#me'; }

$('#regForm').addEventListener('submit', async e => {
  e.preventDefault();
  const msg = $('#regMsg'), r = collectReg(), miss = [];
  if (!r.first) miss.push('first name'); if (!r.last) miss.push('last name');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(r.email)) miss.push('a valid email');
  if (!r.city || !r.state) miss.push('city and state'); if (!r.branch) miss.push('branch');
  if (!r.attendees.length) miss.push('at least one person attending');
  if (!r.days.length) miss.push('at least one day'); if (!r.travelAck) miss.push('the travel box');
  if (miss.length){ say(msg, 'Still needed: ' + miss.join(', ') + '.', false); return; }
  const btn = $('#regSubmit'); btn.disabled = true; say(msg, 'Saving…', true);
  try {
    const was = !!S.mine;
    const res = await api('register', { token: S.token, reg: r });
    if (!res.ok){ say(msg, res.message || 'That did not save. Please try again.', false); btn.disabled = false; return; }
    if (res.token){ S.token = res.token; store.set('lr-token', res.token); }
    S.mine = res.mine; fillReg(S.mine.reg); renderMe();
    say(msg, was ? 'Saved.' : 'You are registered.', true);
    if (!was){
      const d = $('#regDone'); d.hidden = false;
      d.innerHTML = `<h3>You're registered. Welcome home.</h3><p class="hint">We emailed your private link to ${esc(r.email)}. Use it to come back, change your registration and report payments. This device will remember you too.</p><div class="linkbox">${esc(privateLink())}</div><div class="row"><button type="button" class="btn quiet sm" id="copyLink">Copy my link</button><a class="btn sm" href="#me">Go to My Registration</a></div>`;
      $('#copyLink').addEventListener('click', async ev => { try { await navigator.clipboard.writeText(privateLink()); ev.target.textContent = 'Copied'; } catch (_) { ev.target.textContent = 'Select the link above to copy it'; } });
      d.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' });
    }
    loadFamily(true);
  } catch (err) { say(msg, failText(err), false); }
  btn.disabled = false;
});

/* ---------- my registration ---------- */
function renderMe(){
  const m = S.mine;
  $('#meEmpty').hidden = !!m; $('#meBody').hidden = !m;
  if (!m){ $('#meStatus').innerHTML = ''; $('#meTitle').textContent = 'Your household'; return; }
  const r = m.reg, s = m.summary;
  const tone = /Paid in full/.test(s.status) ? 'ok' : /awaiting|announced/.test(s.status) ? 'info' : /Partially|pending/.test(s.status) ? 'warn' : '';
  $('#meTitle').textContent = (r.preferred || r.first) + ' ' + r.last + ' household';
  $('#meStatus').innerHTML = `<span class="pill ${tone}">${esc(s.status)}</span>`;
  const att = r.attendees || [];
  $('#meStats').innerHTML = [['Adults', att.filter(a => a.band !== 'child').length], ['Children', att.filter(a => a.band === 'child').length], ['Nights', r.nights], ['Total due', money(s.due)], ['Confirmed', money(s.confirmed)], ['Balance', money(s.balance)]]
    .map(([k, v]) => `<div class="stat"><b class="num">${esc(v)}</b><span>${k}</span></div>`).join('');
  $('#meReports').innerHTML = (m.payments || []).length ? m.payments.slice().reverse().map(p => {
    const pill = p.status === 'Confirmed' ? `<span class="pill ok">Confirmed${p.confirmedOn ? ' ' + esc(fmtDate(p.confirmedOn)) : ''}</span>` : p.status === 'Not received' ? '<span class="pill bad">Not received yet. Contact the committee</span>' : '<span class="pill info">Awaiting confirmation</span>';
    return `<div class="pay-line"><div><b class="num">${money(p.amount)}</b> <span class="hint">${esc(p.method)}${p.date ? ' · sent ' + esc(fmtDate(p.date)) : ''}${p.ref ? ' · #' + esc(p.ref) : ''}</span></div>${pill}</div>`;
  }).join('') : '<p class="empty">No payments reported yet.</p>';
}
$('#pDate').value = new Date().toISOString().slice(0, 10);
$('#payBtn').addEventListener('click', async () => {
  const msg = $('#payMsg'), amount = Number($('#pAmount').value);
  if (!S.mine){ say(msg, 'Register first, then report your payment.', false); return; }
  if (!(amount > 0)){ say(msg, 'Enter the amount you sent.', false); return; }
  $('#payBtn').disabled = true; say(msg, 'Sending…', true);
  try {
    const res = await api('report', { token: S.token, payment: { amount, method: $('#pMethod').value, date: $('#pDate').value, ref: $('#pRef').value.trim(), note: $('#pNote').value.trim() } });
    if (!res.ok) say(msg, res.message || 'That did not save.', false);
    else { S.mine = res.mine; renderMe(); ['#pAmount', '#pRef', '#pNote'].forEach(s => $(s).value = ''); say(msg, 'Reported. It shows as confirmed once the committee sees it arrive.', true); }
  } catch (err) { say(msg, failText(err), false); }
  $('#payBtn').disabled = false;
});
$('#lostBtn').addEventListener('click', async () => {
  const msg = $('#lostMsg'), email = $('#lostEmail').value.trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)){ say(msg, 'Enter the email you registered with.', false); return; }
  if (!S.code){ say(msg, 'Open the link the committee sent you first, so we know you are family.', false); return; }
  $('#lostBtn').disabled = true;
  try { const res = await api('resend', { email }); say(msg, res.message || 'Check your inbox.', !!res.ok); } catch (err) { say(msg, failText(err), false); }
  $('#lostBtn').disabled = false;
});

/* ---------- sharing stories, tributes, photos ---------- */
const FORM = {
  stories:   { type: 'story',     by: 'st-by', map: { title: 'st-title', subtitle: 'st-about', body: 'st-body' }, need: 'st-body', needMsg: 'Write the story first.' },
  memoriam:  { type: 'memoriam',  by: 'me-by', map: { title: 'me-name', subtitle: 'me-nick', meta: 'me-dates', contact: 'me-rel', body: 'me-body' }, need: 'me-name', needMsg: 'Add their name first.', photo: 'me-photo' },
  veterans:  { type: 'veteran',   by: 've-by', map: { title: 've-name', subtitle: 've-rank', meta: ['ve-branch', 've-years'], body: 've-body' }, need: 've-name', needMsg: 'Add a name first.', photo: 've-photo' },
  directory: { type: 'directory', by: 'di-by', map: { title: 'di-name', subtitle: 'di-work', meta: 'di-where', contact: 'di-contact', body: 'di-body' }, need: 'di-name', needMsg: 'Add a name first.', photo: 'di-photo' },
  market:    { type: 'market',    by: 'mk-by', map: { title: 'mk-item', subtitle: 'mk-seller', meta: 'mk-price', contact: 'mk-contact', body: 'mk-body' }, need: 'mk-item', needMsg: 'Name the product or service first.', photo: 'mk-photo' },
  photos:    { type: 'photo',     by: 'ph-by', map: { title: 'ph-who', meta: 'ph-year', subtitle: 'ph-where', body: 'ph-body' }, needPhoto: true, needMsg: 'Choose a photo first.', photo: 'ph-photo' }
};
function shrink(file){
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file), im = new Image();
    im.onload = () => {
      const max = 1600, k = Math.min(1, max / Math.max(im.naturalWidth, im.naturalHeight));
      const c = document.createElement('canvas'); c.width = Math.round(im.naturalWidth * k); c.height = Math.round(im.naturalHeight * k);
      c.getContext('2d').drawImage(im, 0, 0, c.width, c.height); URL.revokeObjectURL(url);
      resolve({ data: c.toDataURL('image/jpeg', 0.85).split(',')[1], mime: 'image/jpeg', name: file.name.replace(/\.[^.]+$/, '') + '.jpg' });
    };
    im.onerror = () => { URL.revokeObjectURL(url); reject(new Error('That file could not be opened as a photo.')); };
    im.src = url;
  });
}
$$('[data-add]').forEach(btn => btn.addEventListener('click', async () => {
  const key = btn.dataset.add, F = FORM[key], msg = $(`[data-msg="${key}"]`);
  if (!hasFamily()){ say(msg, 'Enter the family code first.', false); return; }
  if (F.need && !$('#' + F.need).value.trim()){ say(msg, F.needMsg, false); return; }
  const file = F.photo && $('#' + F.photo).files[0];
  if (F.needPhoto && !file){ say(msg, F.needMsg, false); return; }
  const fields = {};
  Object.entries(F.map).forEach(([k, id]) => { fields[k] = Array.isArray(id) ? id.map(x => $('#' + x).value.trim()).filter(Boolean).join(' · ') : $('#' + id).value.trim(); });
  btn.disabled = true; say(msg, file ? 'Preparing photo…' : 'Saving…', true);
  try {
    const photo = file ? await shrink(file) : null;
    if (photo) say(msg, 'Uploading…', true);
    const res = await api('post', { token: S.token, type: F.type, by: $('#' + F.by).value.trim(), fields, photo });
    if (!res.ok) say(msg, res.message || 'That did not save.', false);
    else {
      Object.values(F.map).flat().forEach(id => $('#' + id).value = ''); if (F.photo) $('#' + F.photo).value = '';
      say(msg, 'Shared. Thank you.', true); loadFamily(true);
    }
  } catch (err) { say(msg, err.message && /photo/.test(err.message) ? err.message : failText(err), false); }
  btn.disabled = false;
}));

/* ---------- loading ---------- */
async function loadInfo(){
  if (!API) return;
  try { const res = await fetch(API + '?action=info'); const d = await res.json(); if (d.ok){ S.info = { ...S.info, ...d.info }; renderInfo(); } } catch (e) {}
}
async function loadFamily(quiet){
  if (!S.code){ renderGates(); return; }
  if (!API){ renderGates(); setBanner(); return; }
  try {
    const d = await api('family', {});
    if (d.ok){ S.family = d; S.codeBad = false; store.set('lr-code', S.code); }
    else if (d.error === 'code'){ S.family = null; store.set('lr-code', null); }
  } catch (e) { if (!quiet) setBanner('We could not reach the reunion server just now. Some sections will appear when the connection returns.'); }
  renderGates(); renderFamily();
  if (S.family && S.token && !S.mine) loadMine();
}
async function loadMine(){
  try {
    const d = await api('mine', { token: S.token });
    if (d.ok){ S.mine = d.mine; fillReg(S.mine.reg); renderFamily(); }
    else if (d.error === 'token'){ S.token = ''; store.set('lr-token', null); }
  } catch (e) {}
  renderMe();
}
function setBanner(text){
  const b = $('#accessBanner');
  if (!API){ b.hidden = false; b.innerHTML = '<b>Almost ready.</b> Registration opens as soon as the committee connects this site to its spreadsheet.'; return; }
  b.hidden = !text; if (text) b.textContent = text;
}

/* ---------- boot ---------- */
setLook(store.get('lr-look') || 'sequoia');
setMode(store.get('lr-theme') || 'light');
renderAttendees(); renderInfo(); renderMe(); renderFamily(); renderGates(); route(); setBanner();
document.addEventListener('visibilitychange', () => { if (!document.hidden && currentView === 'home') drawRings(false); });
addEventListener('lr-refresh', () => { loadFamily(true); if (S.token) loadMine(); });
loadInfo(); loadFamily();
})();
