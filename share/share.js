/* Lewis Family Reunion 2027: the committee's outreach kit (share/index.html).
   Builds the family link, three text messages and the flyer's QR code in the browser. The family code is read from this
   browser (the site stores it as lr-code when someone opens the family link) or typed here; it is never sent anywhere
   and never written into the repo. Fees come from the backend's public "info" answer, the same one the site uses. */
(() => {
'use strict';
const $ = s => document.querySelector(s), $$ = s => [...document.querySelectorAll(s)];
const store = {
  get(k){ try { return localStorage.getItem(k); } catch (e) { return null; } },
  set(k, v){ try { v == null || v === '' ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch (e) {} }
};
const esc = v => String(v == null ? '' : v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const SITE = 'https://lewisfamilyroots.com/';
const API = (window.LR && window.LR.apiUrl) || '';
/* The same four age groups as FEE_BANDS in app.js and Code.gs. */
const BANDS = [
  { key: 'a23', long: '23 and older', short: '23+' }, { key: 'y16', long: '16 to 22', short: '16–22' },
  { key: 'c4', long: '4 to 15', short: '4–15' }, { key: 'i0', long: '3 and under', short: '3 and under' }
];
const S = { code: '', fees: null };

/* ---------- page theme: follows the device until someone picks one ---------- */
const dark = matchMedia('(prefers-color-scheme: dark)');
function applyTheme(pick){
  const t = pick === 'auto' ? (dark.matches ? 'dark' : 'light') : pick;
  document.documentElement.dataset.theme = t;
  $$('[data-theme-pick]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.themePick === pick)));
}
let themePick = ['dark', 'light'].includes(store.get('lr-share-theme')) ? store.get('lr-share-theme') : 'auto';
applyTheme(themePick);
dark.addEventListener('change', () => { if (themePick === 'auto') applyTheme('auto'); });
$$('[data-theme-pick]').forEach(b => b.addEventListener('click', () => { themePick = b.dataset.themePick; store.set('lr-share-theme', themePick === 'auto' ? null : themePick); applyTheme(themePick); }));

/* ---------- the link ---------- */
const normCode = v => String(v || '').trim().toLowerCase();
function link(){ return S.code ? SITE + '?c=' + encodeURIComponent(S.code) + '#register' : SITE + '#register'; }
const money = n => '$' + Number(n).toLocaleString('en-US', { maximumFractionDigits: 2 });
const feeText = (f, label) => BANDS.map(b => label(b) + ' ' + (Number(f[b.key]) ? money(f[b.key]) : 'free'));

/* ---------- text messages ---------- */
function messages(){
  const url = link(), f = S.fees;
  const needCode = S.code ? '' : '\n\nYou will need the family code. Ask a committee member for it.';
  const plain = 'Hello family! Registration is open for the Lewis Family Reunion 2027, July 2-5 in Fresno, California.\n\n' +
    'Register your household here:\n' + url + needCode + '\n\n' +
    (f ? 'Fees by age at the reunion: ' + feeText(f, b => b.long).join(', ') + '. You can register now and pay later.\n\n' : '') +
    'Hotel: Home2 Suites by Hilton Fresno Northwest, (559) 512-8410, group code 501.\n\n' +
    'Please share this with Lewis family only. Questions? committee@lewisfamilyroots.com';
  const short = 'Lewis Family Reunion 2027: July 2-5 in Fresno, CA. Registration is open. Register your household: ' + url + (S.code ? '' : ' (ask the committee for the family code)');
  const rule = '━━━━━━━━━━━━━━━━';
  const cool = rule + '\nL E W I S   F A M I L Y\nR E U N I O N   2 0 2 7\n' + rule + '\nFrom their roots, we rise.\n\n' +
    '◆ July 2 → 5, 2027\n◆ Fresno, California\n◆ Four days. One family.\n\n' +
    'REGISTRATION IS OPEN\n▸ ' + url + needCode + '\n\n' +
    (f ? feeText(f, b => b.short).join(' · ') + '\n' : '') +
    'Stay: Home2 Suites Fresno Northwest · group code 501\n\n' +
    '“Somehow, some way, your foundation is Lewis, and you belong here.”';
  return { plain, short, cool };
}
/* A text of only basic characters is cut into 160-character parts (153 when there are several); any other character makes it 70 (67). */
const GSM = /^[A-Za-z0-9 \r\n@£$¥èéùìòÇØøÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ!"#¤%&'()*+,\-.\/:;<=>?¡ÄÖÑÜ§¿äöñüà^{}\\\[~\]|€]*$/;
function parts(t){ const basic = GSM.test(t), n = [...t].length; return { n, basic, parts: basic ? (n <= 160 ? 1 : Math.ceil(n / 153)) : (n <= 70 ? 1 : Math.ceil(n / 67)) }; }

/* ---------- QR code ---------- */
function qrMatrix(text){
  const q = qrcode(0, 'M'); q.addData(text); q.make();
  const n = q.getModuleCount(), rows = [];
  for (let r = 0; r < n; r++){ const row = []; for (let c = 0; c < n; c++) row.push(q.isDark(r, c)); rows.push(row); }
  return rows;
}
function qrSvg(rows){
  const n = rows.length; let d = '';
  rows.forEach((row, r) => row.forEach((on, c) => { if (on) d += 'M' + c + ' ' + r + 'h1v1h-1z'; }));
  return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + n + ' ' + n + '" shape-rendering="crispEdges"><rect width="' + n + '" height="' + n + '" fill="#fff"/><path d="' + d + '" fill="#000"/></svg>';
}
function qrPng(rows){
  const n = rows.length, quiet = 4, px = Math.max(8, Math.floor(1024 / (n + quiet * 2))), size = (n + quiet * 2) * px;
  const cv = document.createElement('canvas'); cv.width = cv.height = size;
  const g = cv.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, size, size); g.fillStyle = '#000';
  rows.forEach((row, r) => row.forEach((on, c) => { if (on) g.fillRect((c + quiet) * px, (r + quiet) * px, px, px); }));
  return cv.toDataURL('image/png');
}

/* ---------- render ---------- */
function render(){
  const url = link();
  $('#link').textContent = url;
  $('#codeNote').className = 'note' + (S.code ? '' : ' warn');
  $('#codeNote').textContent = S.code
    ? 'This link opens registration with the family code already filled in. Family only: please do not post it publicly.'
    : 'No family code yet, so this is the public address: people will be asked for the family code. Type the code above to make the family link.';
  const m = messages();
  [['plain', m.plain], ['short', m.short], ['cool', m.cool]].forEach(([k, t]) => {
    $('#m-' + k).textContent = t;
    const p = parts(t);
    $('#c-' + k).textContent = p.n + ' characters' + (p.parts > 1 ? ' · sends as ' + p.parts + ' text parts on older phones' : '');
  });
  let rows = null;
  try { rows = qrMatrix(url); } catch (e) { rows = null; }
  $('#qr').innerHTML = rows ? qrSvg(rows) : '';
  if (rows) $('#qrPng').href = qrPng(rows);
  $('#flyerCode').innerHTML = S.code ? 'Family code: <b>' + esc(S.code) + '</b>' : 'Ask a committee member for the <b>family code</b>.';
  $('#flyerPrivate').textContent = S.code ? 'For Lewis family only. Please do not post publicly.' : '';
  if (S.fees) $('#flyerFees').innerHTML = '<b>Registration fees, by age</b>' + BANDS.map(b => '<span>' + esc(b.long) + ' <strong>' + (Number(S.fees[b.key]) ? esc(money(S.fees[b.key])) : 'free') + '</strong></span>').join(' · ');
  fit();
}
/* The flyer is drawn at letter size (816 by 1056) and scaled down to fit the screen. */
function fit(){
  const stage = $('#stage'), k = Math.min(1, stage.clientWidth / 816);
  $('#scaler').style.transform = 'scale(' + k + ')';
  stage.style.height = Math.round(1056 * k) + 'px';
}
addEventListener('resize', fit);

/* ---------- controls ---------- */
/* A code typed here is kept under its own name, so a half-typed code never replaces the one the website itself remembers. */
$('#code').addEventListener('input', e => { S.code = normCode(e.target.value); store.set('lr-share-code', S.code); render(); });
async function copy(text, done){
  try { await navigator.clipboard.writeText(text); $('#copyStatus').textContent = done; }
  catch (e) { $('#copyStatus').textContent = 'Copying is blocked in this browser. Press and hold the text to select and copy it.'; }
}
$('#copyLink').addEventListener('click', () => copy(link(), 'Link copied.'));
$$('[data-copy]').forEach(b => b.addEventListener('click', () => copy($('#' + b.dataset.copy).textContent, 'Message copied. Paste it into your text.')));
$$('[data-flyer]').forEach(b => b.addEventListener('click', () => {
  $('#flyer').className = 'flyer ' + b.dataset.flyer;
  $$('[data-flyer]').forEach(x => x.setAttribute('aria-pressed', String(x === b)));
}));
/* Printing uses a full-size copy of the flyer, so the on-screen scaling never reaches the paper. */
$('#print').addEventListener('click', () => {
  const root = $('#printRoot'); root.innerHTML = '';
  const copyEl = $('#flyer').cloneNode(true); copyEl.removeAttribute('id'); copyEl.querySelectorAll('[id]').forEach(n => n.removeAttribute('id'));
  root.appendChild(copyEl);
  window.print();
});

/* ---------- boot ---------- */
S.code = normCode(store.get('lr-share-code') || store.get('lr-code'));
$('#code').value = S.code;
render();
if (API){
  fetch(API + '?action=info').then(r => r.json()).then(d => {
    const list = d && d.ok && d.info && Array.isArray(d.info.fees) ? d.info.fees : null;
    if (!list) return;
    const f = {}; list.forEach(x => { f[x.key] = x.fee; });
    if (BANDS.every(b => f[b.key] != null && f[b.key] !== '' && !isNaN(f[b.key]))){ S.fees = f; render(); }
  }).catch(() => {});
}
})();
