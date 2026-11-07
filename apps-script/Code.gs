/**
 * Lewis Family Reunion 2027 — site backend.
 *
 * Runs as a Google Apps Script bound to the "Lewis Reunion 2027 — Site Data" spreadsheet.
 * The public website (GitHub Pages) calls this script's web-app URL. All family data lives
 * in the spreadsheet and a private Drive folder; nothing is stored in the website's code.
 *
 * Setup (once): Extensions → Apps Script → paste this file → run setup() → Deploy → New
 * deployment → Web app → Execute as: Me · Who has access: Anyone → copy the /exec URL.
 */

const TAB = { reg: 'Registrations', pay: 'Payments', ent: 'Entries', cfg: 'Config', agenda: 'Agenda', branches: 'Branches', names: 'Names', people: 'People', treeNotes: 'Tree notes' };
const TYPES = ['story', 'memoriam', 'veteran', 'directory', 'photo', 'market'];
const DAY_LABELS = { fri: 'Fri Jul 2', sat: 'Sat Jul 3', sun: 'Sun Jul 4', mon: 'Mon Jul 5' };
/* Photo rules. The browser shrinks photos before sending, so real uploads are well under the cap.
   Keep PHOTO_MAX_BYTES equal to PHOTO.maxUpload in app.js. */
const PHOTO_MAX_BYTES = 6 * 1024 * 1024;
const PHOTO_UPLOADS_PER_HOUR = 150;          // site-wide brake so a leaked code cannot fill the Drive
const PHOTO_DUPLICATE_SECONDS = 6 * 60 * 60; // the same photo twice within 6 hours is treated as a double tap
const HEIF_BRANDS = ['heic', 'heix', 'hevc', 'hevx', 'heim', 'heis', 'mif1', 'msf1'];

/* ---------------- entry points ---------------- */

function doGet(e) {
  const p = (e && e.parameter) || {};
  if (p.action === 'signup') {
    try { return signup_(p); }
    catch (err) { console.error(err && err.stack || err); return page_('Something went wrong', '<p>Your registration may not have come through. Please email the committee.</p>'); }
  }
  // Only public info is served to plain links. Anything that needs the family code must come by POST,
  // so the code never ends up in a URL, a browser history, or a server log.
  if (p.action === 'info') return handle_({ action: 'info' });
  return out_({ ok: false, error: 'method', message: 'Please use the reunion website.' });
}

/* ---------------- sign-up by link ----------------
   The Claude page cannot send data in the background, so its Register button opens this URL in a new tab:
   ?action=signup&c=<family code>&d=<registration as base64url JSON>. The row is written and a confirmation page is shown. */
function signup_(p) {
  const cfg = config_();
  if (!codeOk_(p.c, cfg)) return page_('This link is not valid', '<p>Please open the registration page from the link the reunion committee sent you, and try again.</p>');
  let reg;
  try { reg = JSON.parse(Utilities.newBlob(Utilities.base64DecodeWebSafe(String(p.d || ''))).getDataAsString('UTF-8')); }
  catch (err) { return page_('Something went wrong', '<p>Your registration did not come through. Please go back to the registration page and press Send again.</p>'); }
  let res;
  try { res = locked_(() => register_({ reg: reg }, cfg)); }
  catch (err) { console.error(err && err.stack || err); return page_('Something went wrong', '<p>Please try again in a minute. If it keeps happening, email ' + htmlEsc_(cfg.email || 'the committee') + '.</p>'); }
  if (!res.ok && res.error === 'exists') {
    return page_('You are already registered', '<p>We already have a registration for <b>' + htmlEsc_(String(reg.email || '')) + '</b>, so nothing was changed.</p><p>To change who is coming or anything else, email the committee at <b>' + htmlEsc_(cfg.email || '') + '</b>.</p>');
  }
  if (!res.ok) return page_('A few things are missing', '<p>' + htmlEsc_(res.message || 'Please check the form.') + '</p><p>Go back to the registration page, fill them in, and press Send again.</p>');
  const r = res.mine.reg, s = res.mine.summary;
  const people = (r.attendees || []).map(a => '<li>' + htmlEsc_(a.name) + (a.band === 'child' ? ' <span>(child' + (a.age ? ', ' + htmlEsc_(a.age) : '') + ')</span>' : '') + '</li>').join('');
  const due = s.due == null ? 'The committee will post fees soon.' : 'Total due: $' + s.due + '.';
  return page_('You’re registered!',
    '<p>Thank you, ' + htmlEsc_(r.preferred || r.first) + '. The ' + htmlEsc_(r.last) + ' household is on the list for the Lewis Family Reunion, July 2–5, 2027 in Fresno.</p>' +
    '<h2>Coming</h2><ul>' + people + '</ul>' +
    '<p>' + htmlEsc_(due) + ' We sent a confirmation to <b>' + htmlEsc_(r.email) + '</b>.</p>' +
    '<p>You can close this tab.</p>');
}
/* The confirmation is plain text on purpose: Google refuses to show HtmlService pages to people signed in to
   more than one Google account ("Sorry, unable to open the file"), but plain-text replies always get through. */
function page_(title, body) {
  const cfg = config_();
  const text = String(body)
    .replace(/<li>/g, '  • ').replace(/<\/li>/g, '\n').replace(/<ul>/g, '').replace(/<\/ul>/g, '\n')
    .replace(/<h2>/g, '\n').replace(/<\/h2>/g, '\n').replace(/<\/p>/g, '\n\n').replace(/<br\s*\/?>/g, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&')
    .replace(/\n{3,}/g, '\n\n').trim();
  const out = 'LEWIS FAMILY REUNION 2027 · FRESNO · JULY 2–5, 2027\n\n' + title.toUpperCase() + '\n' + '─'.repeat(Math.min(48, title.length)) + '\n\n' +
    text + '\n\n\nSomehow, some way, your foundation is Lewis, and you belong here.\n' + (cfg.email || '');
  return ContentService.createTextOutput(out).setMimeType(ContentService.MimeType.TEXT);
}


function doPost(e) {
  let p = {};
  try { p = JSON.parse((e && e.postData && e.postData.contents) || '{}'); }
  catch (err) { return out_({ ok: false, error: 'bad_request' }); }
  return handle_(p);
}

function handle_(p) {
  try {
    const action = String(p.action || '');
    const cfg = config_();
    if (action === 'info') return out_({ ok: true, info: publicInfo_(cfg) });
    if (!codeOk_(p.code, cfg)) return out_({ ok: false, error: 'code', message: 'That family code is not right. Please use the link the committee sent you.' });
    switch (action) {
      case 'family': return out_(familyData_(cfg));
      case 'mine': return out_(mine_(p, cfg));
      case 'register': return out_(locked_(() => register_(p, cfg)));
      case 'report': return out_(locked_(() => report_(p, cfg)));
      case 'post': return out_(locked_(() => post_(p, cfg)));
      case 'resend': return out_(locked_(() => resend_(p, cfg)));
    }
    return out_({ ok: false, error: 'unknown_action' });
  } catch (err) {
    // Log the error only, never the request: it carries the family code and the photo.
    console.error(err && err.stack || err);
    return out_({ ok: false, error: 'server', message: 'Something went wrong on our side. Please try again in a minute.' });
  }
}

/* ---------------- actions ---------------- */

function publicInfo_(cfg) {
  return {
    agenda: agenda_(),
    email: cfg.email || '',
    feeAdult: num_(cfg.feeAdult), feeChild: num_(cfg.feeChild), childAge: num_(cfg.childAge) || 12,
    deadline: iso_(cfg.deadline), roomBlock: String(cfg.roomBlock || '')
  };
}

function familyData_(cfg) {
  const branches = rows_(TAB.branches).filter(r => r.Child).map(r => ({ line: String(r.Line), founders: String(r.Founders), child: String(r.Child) }));
  const names = rows_(TAB.names).filter(r => r.Name).map(r => ({ name: String(r.Name), note: String(r.Note || ''), question: String(r.Question || '') }));
  const roll = rows_(TAB.reg).filter(r => r['Household ID'] && yes_(r['Show on list'])).map(r => ({
    household: (r.Preferred || r.First) + ' ' + r.Last + ' household',
    branch: String(r.Branch || ''), place: [r.City, r.State].filter(String).join(', '),
    count: (Number(r.Adults) || 0) + (Number(r.Children) || 0)
  }));
  const entries = rows_(TAB.ent).filter(r => r['Entry ID'] && yes_(r.Visible) && TYPES.indexOf(String(r.Type)) >= 0).map(r => ({
    id: String(r['Entry ID']), type: String(r.Type), posted: iso_(r.Posted), by: String(r['Posted by'] || ''),
    title: String(r.Title || ''), subtitle: String(r.Subtitle || ''), meta: String(r.Meta || ''),
    body: String(r.Body || ''), contact: String(r.Contact || ''),
    photo: driveImage_(r['Photo ID'], 1600), thumb: driveImage_(r['Photo ID'], 640)
  })).reverse();
  return {
    ok: true, branches, names, roll, entries, tree: tree_(), treeNotes: treeNotes_(),
    pay: { zelle: String(cfg.zelle || ''), cashapp: String(cfg.cashapp || ''), venmo: String(cfg.venmo || ''), paypal: String(cfg.paypal || ''), verifier: String(cfg.verifier || '') }
  };
}

/** The family tree (People tab): one row per person; Parents and Partners hold comma-separated person IDs. */
function tree_() {
  let rows;
  try { rows = rows_(TAB.people); } catch (err) { return []; }
  const ids = s => String(s || '').split(',').map(x => x.trim()).filter(String);
  return rows.filter(r => r.ID && r.Name).map(r => ({
    id: String(r.ID), name: String(r.Name), nickname: str_(r.Nickname), born: str_(r.Born), place: str_(r.Place), story: str_(r.Story),
    parents: ids(r.Parents), partners: ids(r.Partners), createdAt: Number(r.Order) || 0
  }));
}
function treeNotes_() {
  try { return rows_(TAB.treeNotes).filter(r => r.Title || r.Note).map(r => ({ title: str_(r.Title), note: str_(r.Note) })); }
  catch (err) { return []; }
}

function mine_(p, cfg) {
  const found = findByToken_(p.token);
  if (!found) return { ok: false, error: 'token', message: 'We could not find that registration link. Ask us to email you a new one.' };
  return { ok: true, mine: mineData_(found.row, cfg) };
}

function register_(p, cfg) {
  const r = p.reg || {};
  const v = {
    first: clean_(r.first, 60), middle: clean_(r.middle, 60), last: clean_(r.last, 60), birthSurname: clean_(r.birthSurname, 60),
    preferred: clean_(r.preferred, 60), email: clean_(r.email, 120).toLowerCase(), phone: clean_(r.phone, 40),
    city: clean_(r.city, 80), state: clean_(r.state, 40), branch: clean_(r.branch, 120), parents: clean_(r.parents, 200),
    grandparent: clean_(r.grandparent, 200), spouse: clean_(r.spouse, 120), lodging: clean_(r.lodging, 80),
    diet: clean_(r.diet, 80), needs: clean_(r.needs, 1000), arrive: clean_(r.arrive, 10), depart: clean_(r.depart, 10)
  };
  const att = (Array.isArray(r.attendees) ? r.attendees : []).slice(0, 30).map(a => ({
    name: clean_(a.name, 80), band: a.band === 'child' ? 'child' : 'adult', age: clean_(a.age, 10), shirt: clean_(a.shirt, 12)
  })).filter(a => a.name);
  const days = (Array.isArray(r.days) ? r.days : []).filter(d => DAY_LABELS[d]);
  const miss = [];
  if (!v.first) miss.push('first name'); if (!v.last) miss.push('last name');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.email)) miss.push('a valid email');
  if (!v.city || !v.state) miss.push('city and state'); if (!v.branch) miss.push('branch');
  if (!att.length) miss.push('at least one person attending'); if (!days.length) miss.push('at least one day');
  if (miss.length) return { ok: false, error: 'invalid', message: 'Still needed: ' + miss.join(', ') + '.' };

  const sh = sheet_(TAB.reg), H = headers_(sh), now = new Date();
  let rowIndex = -1, existing = null, token = null;
  const byToken = p.token ? findByToken_(p.token) : null;
  if (byToken) { rowIndex = byToken.index; existing = byToken.row; }
  else {
    const dupe = rows_(TAB.reg).find(x => String(x.Email || '').toLowerCase() === v.email);
    if (dupe) {
      sendLink_(dupe, cfg, true);
      return { ok: false, error: 'exists', message: 'That email is already registered. We just emailed you a private link to view and change it.' };
    }
  }
  const nights = nights_(v.arrive, v.depart);
  const data = {
    'Updated': now, 'First': v.first, 'Middle': v.middle, 'Last': v.last, 'Birth surname': v.birthSurname, 'Preferred': v.preferred,
    'Email': v.email, 'Phone': v.phone, 'City': v.city, 'State': v.state, 'Branch': v.branch, 'Parents': v.parents,
    'Grandparent': v.grandparent, 'Spouse': v.spouse,
    'Adults': att.filter(a => a.band === 'adult').length, 'Children': att.filter(a => a.band === 'child').length,
    'Attendees': att.map(a => [a.name, a.band === 'child' ? 'Child' : 'Adult', a.age, a.shirt].join(' · ')).join('\n'),
    'Shirt sizes': shirtSummary_(att), 'Days': days.map(d => DAY_LABELS[d]).join(', '),
    'Arrive': v.arrive, 'Depart': v.depart, 'Nights': nights, 'Lodging': v.lodging, 'Diet': v.diet, 'Needs': v.needs,
    'Show on list': r.showOnList === false ? 'No' : 'Yes'
  };
  if (existing) {
    writeRow_(sh, H, rowIndex, Object.assign({}, existing, data));
  } else {
    token = newToken_();
    const id = 'H-' + Utilities.getUuid().slice(0, 8).toUpperCase();
    Object.assign(data, { 'Household ID': id, 'Registered': now, 'Token hash': hash_(token), 'Status': '' });
    sh.appendRow(H.names.map(n => data[n] !== undefined ? data[n] : ''));
    rowIndex = sh.getLastRow();
    ['Arrive', 'Depart'].forEach(n => sh.getRange(rowIndex, H.col[n] + 1).setNumberFormat('@').setValue(v[n.toLowerCase()]));
  }
  if (existing) ['Arrive', 'Depart'].forEach(n => sh.getRange(rowIndex, H.col[n] + 1).setNumberFormat('@').setValue(v[n.toLowerCase()]));
  recompute_();
  const row = rowAt_(sh, H, rowIndex);
  if (token) {
    try { sendLink_(row, cfg, false, token); } catch (err) { console.warn('email failed', err); }
  }
  return { ok: true, token: token, mine: mineData_(row, cfg) };
}

function report_(p, cfg) {
  const found = findByToken_(p.token);
  if (!found) return { ok: false, error: 'token', message: 'Register first, then report your payment.' };
  const pm = p.payment || {};
  const amount = Math.round(Number(pm.amount) * 100) / 100;
  if (!(amount > 0 && amount < 100000)) return { ok: false, error: 'invalid', message: 'Enter the amount you sent.' };
  const row = found.row, sh = sheet_(TAB.pay), H = headers_(sh);
  const data = {
    'Payment ID': 'P-' + Utilities.getUuid().slice(0, 8).toUpperCase(), 'Household ID': row['Household ID'],
    'Household': (row.Preferred || row.First) + ' ' + row.Last, 'Reported': new Date(), 'Amount': amount,
    'Method': clean_(pm.method, 40), 'Date sent': clean_(pm.date, 10), 'Reference': clean_(pm.ref, 80), 'Note': clean_(pm.note, 300), 'Status': 'Reported'
  };
  sh.appendRow(H.names.map(n => data[n] !== undefined ? data[n] : ''));
  sh.getRange(sh.getLastRow(), H.col['Date sent'] + 1).setNumberFormat('@').setValue(data['Date sent']);
  recompute_();
  return { ok: true, mine: mineData_(rowAt_(sheet_(TAB.reg), headers_(sheet_(TAB.reg)), found.index), cfg) };
}

/** Saves a story, tribute, listing or photo. Runs inside the script lock, so retries line up one at a time. */
function post_(p, cfg) {
  const type = String(p.type || '');
  if (TYPES.indexOf(type) < 0) return { ok: false, error: 'invalid', message: 'Unknown section.' };
  const hasPhoto = !!(p.photo && typeof p.photo === 'object' && p.photo.data);
  // One switch covers every upload: the photo gallery and the optional pictures on tributes, veterans, directory and market.
  if ((type === 'photo' || hasPhoto) && !yes_(cfg.photosEnabled)) {
    return { ok: false, error: 'disabled', message: type === 'photo' ? 'Photo sharing is not open yet. Please check back soon.' : 'Photo uploads are not open yet. Remove the photo and press the button again.' };
  }
  if (type === 'photo' && !hasPhoto) return { ok: false, error: 'invalid', message: 'Choose a photo first.' };

  // A retry of the same submission (slow phone, double tap, lost answer) returns the first result instead of posting twice.
  const cache = CacheService.getScriptCache();
  const sid = /^[A-Za-z0-9-]{16,64}$/.test(String(p.submissionId || '')) ? 'post:' + p.submissionId : '';
  if (sid) { const prev = cache.get(sid); if (prev) return { ok: true, id: prev, repeat: true }; }

  const f = p.fields || {};
  const data = {
    'Entry ID': 'E-' + Utilities.getUuid().slice(0, 8).toUpperCase(), 'Type': type, 'Posted': new Date(),
    'Posted by': clean_(p.by, 80), 'Visible': true, 'Title': clean_(f.title, 160), 'Subtitle': clean_(f.subtitle, 160),
    'Meta': clean_(f.meta, 120), 'Body': clean_(f.body, 4000), 'Contact': clean_(f.contact, 200), 'Photo ID': '',
    'Token hash': p.token ? hash_(String(p.token)) : ''
  };
  if (!data.Title && !data.Body && !hasPhoto) return { ok: false, error: 'invalid', message: 'Add a name or some words first.' };

  let photo = null, file = null, dupKey = '', hourKey = '';
  if (hasPhoto) {
    photo = readPhoto_(p.photo);
    if (!photo.ok) return photo;
    dupKey = 'photo:' + type + ':' + photo.hash;
    if (cache.get(dupKey)) return { ok: false, error: 'duplicate', message: 'That photo was already shared. It is in the list now.' };
    hourKey = 'photos:' + Utilities.formatDate(new Date(), 'UTC', 'yyyyMMddHH');
    if (Number(cache.get(hourKey) || 0) >= PHOTO_UPLOADS_PER_HOUR) return { ok: false, error: 'busy', message: 'Lots of photos are coming in right now. Please try again in an hour.' };
    try {
      file = photoFolder_(cfg).createFile(Utilities.newBlob(photo.bytes, photo.mime, data['Entry ID'] + '.' + photo.ext));
      // Link-only viewing is what the gallery needs to show the picture. The folder stays private, so nobody can list it.
      file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
    } catch (err) {
      console.error('Photo save failed: ' + (err && err.message));
      if (file) { try { file.setTrashed(true); } catch (e2) {} }
      return { ok: false, error: 'server', message: 'We could not save that photo. Please try again in a minute.' };
    }
    data['Photo ID'] = file.getId();
  }

  try {
    const sh = sheet_(TAB.ent), H = headers_(sh);
    sh.appendRow(H.names.map(n => data[n] !== undefined ? data[n] : ''));
  } catch (err) {
    if (file) { try { file.setTrashed(true); } catch (e2) {} }   // no orphan files in Drive
    throw err;
  }
  if (sid) cache.put(sid, data['Entry ID'], PHOTO_DUPLICATE_SECONDS);
  if (dupKey) cache.put(dupKey, data['Entry ID'], PHOTO_DUPLICATE_SECONDS);
  if (hourKey) cache.put(hourKey, String(Number(cache.get(hourKey) || 0) + 1), 3700);
  return { ok: true, id: data['Entry ID'] };
}

/** Checks an uploaded photo by its actual bytes, not by what the browser claims it is. */
function readPhoto_(ph) {
  const tooBig = { ok: false, error: 'too_big', message: 'That photo is too large. Please choose a smaller one (under ' + Math.round(PHOTO_MAX_BYTES / 1048576) + ' MB).' };
  const bad = { ok: false, error: 'invalid', message: 'That file is not a photo we can use. Please choose a JPG, PNG, HEIC or WebP picture.' };
  const b64 = String(ph.data || '');
  if (b64.length > Math.ceil(PHOTO_MAX_BYTES / 3) * 4 + 4) return tooBig;   // check before decoding anything
  if (b64.length < 64 || !/^[A-Za-z0-9+/]+={0,2}$/.test(b64)) return bad;
  let bytes;
  try { bytes = Utilities.base64Decode(b64); } catch (err) { return bad; }
  if (bytes.length > PHOTO_MAX_BYTES) return tooBig;
  const kind = sniffImage_(bytes);
  if (!kind) return bad;
  const hash = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, bytes).map(b => ('0' + (b & 255).toString(16)).slice(-2)).join('');
  return { ok: true, bytes: bytes, mime: kind.mime, ext: kind.ext, hash: hash };
}

/** Recognises JPEG, PNG, WebP and HEIC/HEIF from the first bytes of the file. Anything else is refused. */
function sniffImage_(bytes) {
  const b = i => i < bytes.length ? bytes[i] & 255 : -1;
  const ascii = (from, n) => { let s = ''; for (let i = from; i < from + n; i++) s += String.fromCharCode(b(i)); return s; };
  if (b(0) === 0xFF && b(1) === 0xD8 && b(2) === 0xFF) return { mime: 'image/jpeg', ext: 'jpg' };
  if (b(0) === 0x89 && ascii(1, 3) === 'PNG' && b(4) === 0x0D && b(5) === 0x0A && b(6) === 0x1A && b(7) === 0x0A) return { mime: 'image/png', ext: 'png' };
  if (ascii(0, 4) === 'RIFF' && ascii(8, 4) === 'WEBP') return { mime: 'image/webp', ext: 'webp' };
  if (ascii(4, 4) === 'ftyp' && HEIF_BRANDS.indexOf(ascii(8, 4)) >= 0) return /^(mif1|msf1)$/.test(ascii(8, 4)) ? { mime: 'image/heif', ext: 'heif' } : { mime: 'image/heic', ext: 'heic' };
  return null;
}

/** Gallery link for a Drive photo. Handed out only to people with the family code (see familyData_). */
function driveImage_(id, width) {
  id = String(id || '').trim();
  if (!/^[A-Za-z0-9_-]{10,}$/.test(id)) return '';
  return 'https://drive.google.com/thumbnail?id=' + encodeURIComponent(id) + '&sz=w' + width;
}

function resend_(p, cfg) {
  const email = clean_(p.email, 120).toLowerCase();
  const generic = { ok: true, message: 'If that email is registered, a new private link is on its way. Check your inbox and spam folder.' };
  if (!email) return generic;
  const cache = CacheService.getScriptCache(), key = 'resend:' + email;
  if (cache.get(key)) return generic;
  cache.put(key, '1', 600);
  const sh = sheet_(TAB.reg), H = headers_(sh), all = sh.getDataRange().getValues();
  for (let i = 1; i < all.length; i++) {
    if (String(all[i][H.col.Email] || '').toLowerCase() === email) { sendLink_(rowAt_(sh, H, i + 1), cfg, true); break; }
  }
  return generic;
}

/* ---------------- committee side ---------------- */

/** Runs when a committee member edits the sheet: stamps confirmations and refreshes balances. */
function onEdit(e) {
  try {
    const sh = e.range.getSheet(), name = sh.getName();
    if (name === TAB.pay) {
      const H = headers_(sh), statusCol = H.col.Status + 1;
      if (e.range.getColumn() <= statusCol && e.range.getLastColumn() >= statusCol) {
        for (let r = e.range.getRow(); r <= e.range.getLastRow(); r++) {
          if (r < 2) continue;
          const st = sh.getRange(r, statusCol).getValue();
          const onCell = sh.getRange(r, H.col['Confirmed on'] + 1), byCell = sh.getRange(r, H.col['Confirmed by'] + 1);
          if (st === 'Confirmed' || st === 'Not received') {
            if (!onCell.getValue()) onCell.setValue(new Date());
            if (!byCell.getValue()) { const who = Session.getActiveUser().getEmail(); if (who) byCell.setValue(who); }
          }
        }
      }
      recompute_();
    } else if (name === TAB.cfg || name === TAB.reg) {
      recompute_();
    }
  } catch (err) { console.warn(err); }
}

function onOpen() {
  SpreadsheetApp.getUi().createMenu('Reunion')
    .addItem('Refresh balances and status', 'recompute_')
    .addItem('Sync photo privacy', 'syncPhotoSharing')
    .addItem('Run setup', 'setup')
    .addToUi();
}

/**
 * Installed by setup() as an "on edit" trigger (simple onEdit cannot touch Drive).
 * Unticking Visible on the Entries tab makes that photo private in Drive; ticking it again re-opens the link.
 */
function onEntriesEdit(e) {
  try {
    if (!e || !e.range) return;
    const sh = e.range.getSheet();
    if (sh.getName() !== TAB.ent) return;
    const H = headers_(sh);
    if (H.col.Visible === undefined || H.col['Photo ID'] === undefined) return;
    const vc = H.col.Visible + 1, pc = H.col['Photo ID'] + 1;
    const hits = c => e.range.getColumn() <= c && e.range.getLastColumn() >= c;
    if (!hits(vc) && !hits(pc)) return;
    const folder = existingPhotoFolder_(config_());
    if (!folder) return;
    const first = Math.max(2, e.range.getRow()), last = e.range.getLastRow();
    if (last < first) return;
    const vals = sh.getRange(first, 1, last - first + 1, H.names.length).getValues();
    vals.forEach(r => { const id = String(r[pc - 1] || '').trim(); if (id) setPhotoSharing_(id, yes_(r[vc - 1]), folder); });
  } catch (err) { console.warn('Photo privacy sync: ' + (err && err.message)); }
}

/**
 * Menu: Reunion → Sync photo privacy. Visible photos can be opened by link (the gallery needs that);
 * hidden photos are private; the photo folder itself is never shared, so its contents cannot be listed.
 * Only files inside the photo folder are touched.
 */
function syncPhotoSharing() {
  const folder = existingPhotoFolder_(config_());
  if (!folder) { console.log('No photo folder yet. Run setup first.'); return; }
  lockFolder_(folder);
  let open = 0, closed = 0, skipped = 0;
  rows_(TAB.ent).forEach(r => {
    const id = String(r['Photo ID'] || '').trim();
    if (!id) return;
    const visible = yes_(r.Visible);
    if (setPhotoSharing_(id, visible, folder)) { if (visible) open++; else closed++; } else skipped++;
  });
  console.log('Photo privacy synced. Viewable by link: ' + open + '. Private (hidden): ' + closed + '. Skipped (not in the photo folder or missing): ' + skipped + '.');
}

function setPhotoSharing_(id, visible, folder) {
  try {
    const file = DriveApp.getFileById(id);
    let inFolder = false;
    const parents = file.getParents();
    while (parents.hasNext()) if (parents.next().getId() === folder.getId()) { inFolder = true; break; }
    if (!inFolder) return false;   // never change sharing on a file that is not a reunion upload
    const access = file.getSharingAccess();
    if (visible && access !== DriveApp.Access.ANYONE_WITH_LINK) file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
    if (!visible && access !== DriveApp.Access.PRIVATE) file.setSharing(DriveApp.Access.PRIVATE, DriveApp.Permission.NONE);
    return true;
  } catch (err) { return false; }
}

/** The photo folder must never be shared by link or publicly: that would let anyone list every upload. */
function lockFolder_(folder) {
  const access = folder.getSharingAccess();
  if (access !== DriveApp.Access.PRIVATE) {
    folder.setSharing(DriveApp.Access.PRIVATE, DriveApp.Permission.NONE);
    console.warn('The photo folder was shared (' + access + '). It is private again; people you added by name keep their access.');
  }
}

function installPhotoTrigger_() {
  const have = ScriptApp.getProjectTriggers().some(t => t.getHandlerFunction() === 'onEntriesEdit');
  if (!have) ScriptApp.newTrigger('onEntriesEdit').forSpreadsheet(SpreadsheetApp.getActive()).onEdit().create();
}

/** Recalculates Due, Confirmed, Awaiting, Balance and Status for every household. */
function recompute_() {
  const cfg = config_(), sh = sheet_(TAB.reg), H = headers_(sh), last = sh.getLastRow();
  if (last < 2) return;
  const totals = {};
  rows_(TAB.pay).forEach(p => {
    const id = p['Household ID']; if (!id) return;
    totals[id] = totals[id] || { c: 0, a: 0 };
    if (p.Status === 'Confirmed') totals[id].c += Number(p.Amount) || 0;
    else if (p.Status === 'Reported' || !p.Status) totals[id].a += Number(p.Amount) || 0;
  });
  const fa = num_(cfg.feeAdult), fc = num_(cfg.feeChild), feeSet = fa !== null && fc !== null;
  const ids = sh.getRange(2, H.col['Household ID'] + 1, last - 1, 1).getValues();
  const ad = sh.getRange(2, H.col.Adults + 1, last - 1, 1).getValues();
  const ch = sh.getRange(2, H.col.Children + 1, last - 1, 1).getValues();
  const outRows = ids.map((idRow, i) => {
    const id = idRow[0]; if (!id) return ['', '', '', '', ''];
    const t = totals[id] || { c: 0, a: 0 };
    const due = feeSet ? (Number(ad[i][0]) || 0) * fa + (Number(ch[i][0]) || 0) * fc : '';
    const bal = feeSet ? Math.max(0, due - t.c) : '';
    let st;
    if (feeSet && due > 0 && t.c >= due) st = 'Paid in full';
    else if (t.a > 0) st = 'Payment reported, awaiting confirmation';
    else if (t.c > 0) st = 'Partially paid';
    else if (!feeSet) st = 'Registered, fee to be announced';
    else st = 'Registered, payment pending';
    return [due, t.c, t.a, bal, st];
  });
  sh.getRange(2, H.col.Due + 1, outRows.length, 5).setValues(outRows);
}

/**
 * Run from the editor (safe to run again): creates the private photo folder if needed, keeps it private,
 * installs the photo-privacy trigger, syncs photo sharing with the Visible boxes, and asks Google for permissions.
 */
function setup() {
  const cfg = config_();
  const folder = photoFolder_(cfg);
  lockFolder_(folder);
  installPhotoTrigger_();
  syncPhotoSharing();
  recompute_();
  console.log('Setup complete. Photo folder: ' + folder.getUrl() + '. Photo uploads are ' + (yes_(cfg.photosEnabled) ? 'ON' : 'OFF') + ' (Config tab: photosEnabled).');
}

/* ---------------- helpers ---------------- */

function mineData_(row, cfg) {
  const pays = rows_(TAB.pay).filter(p => p['Household ID'] === row['Household ID']).map(p => ({
    amount: Number(p.Amount) || 0, method: String(p.Method || ''), date: iso_(p['Date sent']), ref: String(p.Reference || ''),
    status: String(p.Status || 'Reported'), confirmedOn: iso_(p['Confirmed on'])
  }));
  const att = String(row.Attendees || '').split('\n').filter(String).map(l => {
    const [name, band, age, shirt] = l.split(' · ');
    return { name: name || '', band: /child/i.test(band || '') ? 'child' : 'adult', age: age || '', shirt: shirt || '' };
  });
  const dayKeys = Object.keys(DAY_LABELS).filter(k => String(row.Days || '').indexOf(DAY_LABELS[k]) >= 0);
  return {
    householdId: row['Household ID'],
    reg: {
      first: str_(row.First), middle: str_(row.Middle), last: str_(row.Last), birthSurname: str_(row['Birth surname']),
      preferred: str_(row.Preferred), email: str_(row.Email), phone: str_(row.Phone), city: str_(row.City), state: str_(row.State),
      branch: str_(row.Branch), parents: str_(row.Parents), grandparent: str_(row.Grandparent), spouse: str_(row.Spouse),
      attendees: att, days: dayKeys, arrive: iso_(row.Arrive), depart: iso_(row.Depart), nights: Number(row.Nights) || 0,
      lodging: str_(row.Lodging), diet: str_(row.Diet), needs: str_(row.Needs), showOnList: yes_(row['Show on list']), travelAck: true
    },
    summary: {
      due: row.Due === '' ? null : Number(row.Due), confirmed: Number(row.Confirmed) || 0, awaiting: Number(row.Awaiting) || 0,
      balance: row.Balance === '' ? null : Number(row.Balance), status: str_(row.Status) || 'Registered'
    },
    payments: pays
  };
}

function sendLink_(row, cfg, rotate, token) {
  const sh = sheet_(TAB.reg), H = headers_(sh);
  if (!token) {
    token = newToken_();
    const all = sh.getDataRange().getValues();
    for (let i = 1; i < all.length; i++) {
      if (all[i][H.col['Household ID']] === row['Household ID']) { sh.getRange(i + 1, H.col['Token hash'] + 1).setValue(hash_(token)); break; }
    }
  }
  if (!yes_(cfg.siteLive)) return sendReceipt_(row, cfg);
  const base = String(cfg.siteUrl || '').replace(/[?#].*$/, '');
  const link = base + '?c=' + encodeURIComponent(cfg.familyCode) + '&t=' + token + '#me';
  const name = row.Preferred || row.First || 'cousin';
  const html =
    '<div style="font-family:Georgia,serif;font-size:16px;line-height:1.6;color:#1b1b18;max-width:560px">' +
    '<p>Hi ' + htmlEsc_(name) + ',</p>' +
    '<p>' + (rotate ? 'Here is a fresh private link to your registration' : 'Thank you for registering for the Lewis Family Reunion, July 2–5, 2027 in Fresno') + '.</p>' +
    '<p><a href="' + link + '" style="display:inline-block;background:#2f6e4e;color:#fff;padding:12px 20px;border-radius:999px;text-decoration:none">Open my registration</a></p>' +
    '<p>Use this link to update who is coming, report a payment, and see when the committee confirms it. Please keep it to yourself; anyone with it can change your registration.' +
    (rotate ? ' Older links no longer work.' : '') + '</p>' +
    '<p>Somehow, some way, your foundation is Lewis — and you belong here.</p>' +
    '<p>The Lewis Family Reunion Committee<br>' + htmlEsc_(cfg.email || '') + '</p></div>';
  MailApp.sendEmail({
    to: String(row.Email), subject: rotate ? 'Your Lewis Reunion registration link' : 'You are registered: Lewis Family Reunion 2027',
    htmlBody: html, name: 'Lewis Family Reunion 2027', replyTo: cfg.email || undefined
  });
}

/** Until the full site is live, registrants get a plain receipt instead of a private edit link. */
function sendReceipt_(row, cfg) {
  const name = row.Preferred || row.First || 'cousin';
  const people = String(row.Attendees || '').split('\n').filter(String).map(l => '<li>' + htmlEsc_(l.split(' · ')[0]) + '</li>').join('');
  const html =
    '<div style="font-family:Georgia,serif;font-size:16px;line-height:1.6;color:#1b1b18;max-width:560px">' +
    '<p>Hi ' + htmlEsc_(name) + ',</p>' +
    '<p>Thank you for registering for the Lewis Family Reunion, July 2–5, 2027 in Fresno. Here is who we have on your registration:</p>' +
    '<ul>' + people + '</ul>' +
    '<p>The committee will email you about fees and payment. To change anything, reply to this email.</p>' +
    '<p>Somehow, some way, your foundation is Lewis — and you belong here.</p>' +
    '<p>The Lewis Family Reunion Committee<br>' + htmlEsc_(cfg.email || '') + '</p></div>';
  MailApp.sendEmail({ to: String(row.Email), subject: 'You are registered: Lewis Family Reunion 2027', htmlBody: html, name: 'Lewis Family Reunion 2027', replyTo: cfg.email || undefined });
}

function findByToken_(token) {
  token = String(token || '');
  if (token.length < 32) return null;
  const h = hash_(token), sh = sheet_(TAB.reg), H = headers_(sh), all = sh.getDataRange().getValues();
  for (let i = 1; i < all.length; i++) {
    if (all[i][H.col['Token hash']] === h) return { index: i + 1, row: rowAt_(sh, H, i + 1) };
  }
  return null;
}

function agenda_() {
  const days = [];
  rows_(TAB.agenda).forEach(r => {
    if (!r.Day && !r.What) return;
    // Sheets turns a typed "July 2" into a date; show it as text again ("July 2"), never a raw timestamp.
    const date = r.Date instanceof Date ? Utilities.formatDate(r.Date, Session.getScriptTimeZone() || 'America/Los_Angeles', 'MMMM d') : String(r.Date || '');
    let d = days.find(x => x.title === String(r.Day) && x.date === date);
    if (!d) { d = { title: String(r.Day), date: date, items: [] }; days.push(d); }
    d.items.push({ time: String(r.Time || ''), what: String(r.What || ''), where: String(r.Where || '') });
  });
  return { days };
}

function config_() {
  const out = {};
  rows_(TAB.cfg).forEach(r => { if (r.Key) out[String(r.Key).trim()] = r.Value; });
  return out;
}

function photoFolder_(cfg) {
  const id = String(cfg.photoFolderId || '');
  if (id) { try { return DriveApp.getFolderById(id); } catch (err) {} }
  const ss = SpreadsheetApp.getActive(), parents = DriveApp.getFileById(ss.getId()).getParents();
  const parent = parents.hasNext() ? parents.next() : DriveApp.getRootFolder();
  const folder = parent.createFolder('Lewis Reunion 2027 — Shared Photos');
  const sh = sheet_(TAB.cfg), all = sh.getDataRange().getValues();
  for (let i = 1; i < all.length; i++) if (all[i][0] === 'photoFolderId') { sh.getRange(i + 1, 2).setValue(folder.getId()); return folder; }
  sh.appendRow(['photoFolderId', folder.getId(), 'Filled in automatically by setup()']);
  return folder;
}

/** The photo folder if setup has made one; never creates anything. */
function existingPhotoFolder_(cfg) {
  const id = String(cfg.photoFolderId || '').trim();
  if (!id) return null;
  try { return DriveApp.getFolderById(id); } catch (err) { return null; }
}

function codeOk_(code, cfg) {
  const want = String(cfg.familyCode || '').trim().toLowerCase();
  return !!want && String(code || '').trim().toLowerCase() === want;
}

function sheet_(name) {
  const sh = SpreadsheetApp.getActive().getSheetByName(name);
  if (!sh) throw new Error('Missing tab: ' + name);
  return sh;
}
function headers_(sh) {
  const names = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].map(String);
  const col = {}; names.forEach((n, i) => { if (n) col[n] = i; });
  return { names, col };
}
function rows_(name) {
  const sh = sheet_(name), all = sh.getDataRange().getValues();
  if (all.length < 2) return [];
  const head = all[0].map(String);
  return all.slice(1).map(r => { const o = {}; head.forEach((h, i) => { if (h) o[h] = r[i]; }); return o; });
}
function rowAt_(sh, H, index) {
  const vals = sh.getRange(index, 1, 1, H.names.length).getValues()[0], o = {};
  H.names.forEach((n, i) => { if (n) o[n] = vals[i]; });
  return o;
}
function writeRow_(sh, H, index, obj) {
  sh.getRange(index, 1, 1, H.names.length).setValues([H.names.map(n => obj[n] !== undefined ? obj[n] : '')]);
}
function locked_(fn) {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(20000)) return { ok: false, error: 'busy', message: 'Lots of cousins at once! Please try again in a moment.' };
  try { return fn(); } finally { lock.releaseLock(); }
}
function out_(obj) { return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON); }

/** Trims, caps length, and stops text from being read as a spreadsheet formula. */
function clean_(v, max) {
  let s = String(v == null ? '' : v).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').trim().slice(0, max || 200);
  if (/^[=+\-@\t\r|]/.test(s)) s = "'" + s;
  return s;
}
function str_(v) { return v instanceof Date ? iso_(v) : String(v == null ? '' : v).replace(/^'/, ''); }
function num_(v) { return v === '' || v === null || v === undefined || isNaN(Number(v)) ? null : Number(v); }
function yes_(v) { return v === true || /^(yes|true|y|1)$/i.test(String(v).trim()); }
function iso_(v) {
  if (v instanceof Date) return Utilities.formatDate(v, Session.getScriptTimeZone() || 'America/Los_Angeles', 'yyyy-MM-dd');
  return String(v == null ? '' : v).replace(/^'/, '').slice(0, 10);
}
function nights_(a, d) {
  const x = new Date(a + 'T12:00:00'), y = new Date(d + 'T12:00:00'), n = Math.round((y - x) / 864e5);
  return isNaN(n) || n < 0 ? 0 : n;
}
function shirtSummary_(att) {
  const c = {}; att.forEach(a => { if (a.shirt && a.shirt !== 'No shirt') c[a.shirt] = (c[a.shirt] || 0) + 1; });
  return Object.keys(c).map(k => c[k] + '×' + k).join(', ');
}
function newToken_() { return (Utilities.getUuid() + Utilities.getUuid()).replace(/-/g, ''); }
function hash_(s) {
  return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, String(s), Utilities.Charset.UTF_8)
    .map(b => ('0' + (b & 255).toString(16)).slice(-2)).join('');
}
function htmlEsc_(s) { return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
