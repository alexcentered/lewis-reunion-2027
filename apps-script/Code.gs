/**
 * Lewis Family Reunion 2027 — site backend.
 *
 * Runs as a Google Apps Script bound to the "Lewis Reunion 2027 — Site Data" spreadsheet.
 * The public website (GitHub Pages) calls this script's web-app URL. All family data lives
 * in the spreadsheet and a private Drive folder; nothing is stored in the website's code.
 *
 * Setup (once): Extensions → Apps Script → paste this file → run setup() → Deploy → New
 * deployment → Web app → Execute as: Me · Who has access: Anyone → copy the /exec URL.
 *
 * Mail: every email goes through sendMail_ (section "mail"): Brevo API first (sender from Config mailFrom), the
 * deployer's Gmail (MailApp) second, and the MailQueue tab third, which drainMailQueue() empties every hour.
 * Script Properties (Project Settings → Script Properties): BREVO_API_KEY. Without it, MailApp is used.
 * ANTHROPIC_API_KEY is optional: the menu item "Draft update with AI" (draftUpdate) uses it to turn committee notes into a draft.
 * Committee Updates (section "committee updates"): the Updates tab holds one broadcast email per row; sendUpdates() (menu
 * "Send approved updates now" and a daily trigger) queues an Approved row to every registered household in its Audience.
 * Tabs this file writes to: Registrations, Payments, Entries, Config, MailQueue and Updates (both created by setup()).
 */

const TAB = { reg: 'Registrations', pay: 'Payments', ent: 'Entries', cfg: 'Config', agenda: 'Agenda', branches: 'Branches', names: 'Names', people: 'People', treeNotes: 'Tree notes', mail: 'MailQueue', updates: 'Updates' };
/* Mail layer constants. MAIL_RESERVE keeps a few MailApp sends back so the committee's own scripts never hit zero. */
const MAIL_RESERVE = 5;
const MAIL_HEADERS = ['Queued', 'To', 'Subject', 'Html', 'Text', 'Status', 'Attempts', 'Last error', 'Sent', 'Via', 'Key', 'Kind', 'Household ID'];
const MAIL_MAX_ATTEMPTS = 20;      // a queued email that fails this often is marked Failed (never deleted)
const MAIL_CLAIM_MINUTES = 15;     // a MailQueue row left 'Sending' this long belongs to a drain that died and is claimed again
const BREVO_URL = 'https://api.brevo.com/v3/smtp/email';
/* Committee Updates (section "committee updates"). One Updates row per broadcast email. Approved (a checkbox) with a
   blank "Sent at" means sendUpdates() will send it; Sent, Failed and Skipped are the counts it writes back. Skipped =
   households left out for Mail opt-out = Yes or a blank email, so the committee can see why Sent differs from the roll. */
const UPDATE_HEADERS = ['ID', 'Created', 'Subject', 'Notes', 'Draft', 'Approved', 'Audience', 'Sent at', 'Sent', 'Failed', 'Skipped'];
const UPDATE_AUDIENCES = ['all', 'unpaid', 'paid', 'test'];   // any other Audience value is matched against the Registrations Branch column
const REG_OPTOUT = 'Mail opt-out';                            // Registrations column; the committee types Yes when a household replies STOP
const UPDATE_SENDING = 'sending…';                            // "Sent at" while a run holds the row or has not finished it; the next run resumes it
const UPDATE_QUEUE_MS = 4 * 60000;                            // sendUpdates stops queueing after this and leaves the rest to the next run
const RUN_MS = 6 * 60000;                                     // Apps Script stops any run at six minutes; the drain after queueing gets what is left
const UPDATE_FOOTER = 'You are getting this because your household is registered for the Lewis Family Reunion. To stop these updates, reply with the word STOP.';
const SIGNOFF = 'Somehow, some way, your foundation is Lewis — and you belong here.';
/* Claude API for draftUpdate(). Raw HTTP: Apps Script has no SDK. Key = Script Property ANTHROPIC_API_KEY (never logged). */
const CLAUDE_URL = 'https://api.anthropic.com/v1/messages';
const CLAUDE_MODEL = 'claude-opus-5-5';
/* Config tab keys the mail layer reads. config_() fills these in when the row is missing or blank;
   ensureConfigKeys_() (run by setup) appends the rows so the committee can see and change them. */
const CONFIG_DEFAULTS = {
  mailFrom: 'committee@lewisfamilyroots.com',   // Brevo sender address; must be a verified sender on the domain
  mailFromName: 'Lewis Family Reunion 2027',   // display name on every email (Brevo and MailApp)
  mailReplyTo: '',                              // blank = replies go to the Config "email" address
  notifyCommittee: 'No'                         // Yes = email the committee (Config "email") on each new registration
};
const CONFIG_NOTES = {
  mailFrom: 'Sender address for emails sent through Brevo', mailFromName: 'Sender name on every email',
  mailReplyTo: 'Reply-to address; blank means the "email" row', notifyCommittee: 'Yes = email the committee about each new registration'
};
/* The reunion hotel, as printed in the registration email (regDetails_). The hotel card in index.html shows the same
   facts; change both together. Config roomBlock adds a note under them (a booking cutoff, for example). */
const HOTEL = {
  name: 'Home2 Suites by Hilton Fresno Northwest', address: '6965 W. Farrington Avenue, Fresno, CA 93722', phone: '(559) 512-8410',
  groupCode: '501', hotelCode: 'FATNOHT'
};
const TYPES = ['story','memoriam', 'veteran', 'directory', 'photo', 'market'];
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
  const people = (r.attendees || []).map(a => '<li>' + htmlEsc_(a.name) + (a.band === 'child' ? ' <span>(child' + (a.age ? ', ' + htmlEsc_(a.age) : '') + ')</span>' : '') + (a.diet ? ' <span>' + htmlEsc_(a.diet) + '</span>' : '') + '</li>').join('');
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
  const text = htmlToText_(body);
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
      case 'tree': return out_({ ok: true, tree: tree_(), treeNotes: treeNotes_() });
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
    ok: true, branches, names, roll, entries,
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
    name: clean_(a.name, 80), band: a.band === 'child' ? 'child' : 'adult', age: clean_(a.age, 10), shirt: clean_(a.shirt, 12),
    diet: /^none$/i.test(clean_(a.diet, 40)) ? '' : clean_(a.diet, 40)
  })).filter(a => a.name);
  const days = (Array.isArray(r.days) ? r.days : []).filter(d => DAY_LABELS[d]);
  const miss = [];
  if (!v.first) miss.push('first name'); if (!v.last) miss.push('last name');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.email)) miss.push('a valid email');
  if (v.phone.replace(/\D/g, '').length < 10) miss.push('a cell phone number');   // required since Nov 2026; the site checks the same
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
      // A mail failure here must not turn into a server error: the answer is the same either way.
      try { sendLink_(dupe, cfg, true); } catch (err) { console.warn('email failed', err); }
      return { ok: false, error: 'exists', message: 'That email is already registered. We just emailed you a private link to view and change it.' };
    }
  }
  const nights = nights_(v.arrive, v.depart);
  const data = {
    'Updated': now, 'First': v.first, 'Middle': v.middle, 'Last': v.last, 'Birth surname': v.birthSurname, 'Preferred': v.preferred,
    'Email': v.email, 'Phone': v.phone, 'City': v.city, 'State': v.state, 'Branch': v.branch, 'Parents': v.parents,
    'Grandparent': v.grandparent, 'Spouse': v.spouse,
    'Adults': att.filter(a => a.band === 'adult').length, 'Children': att.filter(a => a.band === 'child').length,
    'Attendees': att.map(a => [a.name, a.band === 'child' ? 'Child' : 'Adult', a.age, a.shirt, a.diet].join(' · ')).join('\n'),
    'Shirt sizes': shirtSummary_(att), 'Days': days.map(d => DAY_LABELS[d]).join(', '),
    'Arrive': v.arrive, 'Depart': v.depart, 'Nights': nights, 'Lodging': v.lodging, 'Diet': dietSummary_(att) || v.diet, 'Needs': v.needs,
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
  // The row is saved at this point. A renamed header or a mail problem must not lose the confirmation.
  try { recompute_(); } catch (err) { console.error('recompute failed', err); }
  const row = rowAt_(sh, H, rowIndex);
  if (token) {
    try { sendLink_(row, cfg, false, token); } catch (err) { console.warn('email failed', err); }
    if (yes_(cfg.notifyCommittee) && cfg.email) {
      try { sendMail_(committeeEmail_(row, cfg), cfg); } catch (err) { console.warn('committee email failed', err); }
    }
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
    if (String(all[i][H.col.Email] || '').toLowerCase() === email) {
      try { sendLink_(rowAt_(sh, H, i + 1), cfg, true); } catch (err) { console.warn('email failed', err); }
      break;
    }
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
    .addItem('Send queued mail now', 'drainMailQueue')
    .addItem('Send me a test email', 'testSendMail')
    .addItem('Send approved updates now', 'sendUpdates')
    .addItem('Draft update with AI', 'draftUpdate')
    .addItem('Sync photo privacy', 'syncPhotoSharing')
    .addItem('Run setup', 'setup')
    .addToUi();
}

/**
 * Installed by setup() as an "on edit" trigger. Runs as the script owner, so it may call Brevo (a simple onEdit
 * cannot). When a committee member sets a Payments Status to Confirmed or Not received, the household gets one
 * receipt email. The Payments column "Receipt sent" records "<Status> · <time> · <route>" and stops repeats:
 * editing the row again sends nothing, moving Confirmed to Not received sends one new email, and setting the
 * Status back to Reported sends nothing. The simple onEdit above still stamps Confirmed on/by.
 */
function onPaymentsEdit(e) {
  try {
    if (!e || !e.range) return;
    const sh = e.range.getSheet();
    if (sh.getName() !== TAB.pay) return;
    const H = headers_(sh);
    if (H.col.Status === undefined) return;
    const hits = c => e.range.getColumn() <= c && e.range.getLastColumn() >= c;
    if (!hits(H.col.Status + 1)) return;
    const first = Math.max(2, e.range.getRow()), last = e.range.getLastRow();
    if (last < first) return;
    const res = locked_(() => { paymentReceipts_(sh, first, last); return { ok: true }; });
    if (!res.ok) console.warn('Payment receipts: the sheet was busy; set the Status again to retry.');
  } catch (err) { console.warn('Payment receipts: ' + (err && err.message)); }
}

/** Sends the receipt for each Payments row in [first, last] whose Status changed. Runs inside the script lock. */
function paymentReceipts_(sh, first, last) {
  const cfg = config_();
  try { recompute_(); } catch (err) { console.warn('recompute failed', err); }   // so the receipt shows fresh totals
  ensureTab_(TAB.pay, ['Payment ID', 'Receipt sent']);
  const H = headers_(sh), regs = rows_(TAB.reg);
  for (let r = first; r <= last; r++) {
    const pay = rowAt_(sh, H, r), st = String(pay.Status || '');
    if (st !== 'Confirmed' && st !== 'Not received') continue;
    if (String(pay['Receipt sent'] || '').indexOf(st) === 0) continue;
    const reg = regs.find(x => x['Household ID'] && x['Household ID'] === pay['Household ID']);
    if (!reg || !reg.Email) { console.warn('Payment receipts: no registration with an email for row ' + r); continue; }
    // A row the committee typed by hand has no Payment ID. Give it one (same shape as report_) and store it first,
    // so the receipt key 'receipt:<Payment ID>:<Status>' is unique to this row instead of shared by every blank one.
    if (!str_(pay['Payment ID']).trim()) { pay['Payment ID'] = 'P-' + Utilities.getUuid().slice(0, 8).toUpperCase(); sh.getRange(r, H.col['Payment ID'] + 1).setValue(pay['Payment ID']); }
    const res = sendMail_(receiptEmail_(reg, pay, cfg), cfg);
    if (res.ok) sh.getRange(r, H.col['Receipt sent'] + 1).setValue(st + ' · ' + new Date().toISOString() + ' · ' + res.via);
    else console.warn('Payment receipts: row ' + r + ' not sent: ' + res.error);
  }
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

/** Creates the trigger for handler fn unless one exists. build receives a TriggerBuilder and returns it configured. */
function ensureTrigger_(fn, build) {
  const have = ScriptApp.getProjectTriggers().some(t => t.getHandlerFunction() === fn);
  if (!have) build(ScriptApp.newTrigger(fn)).create();
}

/** Installable triggers: photo privacy and payment receipts on edit, the mail queue every hour, approved updates daily at 9. Safe to run again. */
function installTriggers_() {
  const ss = SpreadsheetApp.getActive();
  ensureTrigger_('onEntriesEdit', b => b.forSpreadsheet(ss).onEdit());
  ensureTrigger_('onPaymentsEdit', b => b.forSpreadsheet(ss).onEdit());
  ensureTrigger_('drainMailQueue', b => b.timeBased().everyHours(1));
  ensureTrigger_('sendUpdates', b => b.timeBased().everyDays(1).atHour(9));
}

/** Creates the tab with these headers if it is missing; otherwise appends any header not yet present (never reorders). */
function ensureTab_(name, headers) {
  const ss = SpreadsheetApp.getActive();
  let sh = ss.getSheetByName(name);
  if (!sh) {
    sh = ss.insertSheet(name);
    sh.getRange(1, 1, 1, headers.length).setValues([headers]);
    sh.setFrozenRows(1);
    return sh;
  }
  const lastCol = sh.getLastColumn();
  const have = lastCol ? sh.getRange(1, 1, 1, lastCol).getValues()[0].map(String) : [];
  const missing = headers.filter(h => have.indexOf(h) < 0);
  if (missing.length) sh.getRange(1, have.length + 1, 1, missing.length).setValues([missing]);
  return sh;
}

/** Appends a Config row for every key in CONFIG_DEFAULTS that the tab does not have yet. */
function ensureConfigKeys_() {
  const sh = sheet_(TAB.cfg), have = sh.getDataRange().getValues().slice(1).map(r => String(r[0]).trim());
  Object.keys(CONFIG_DEFAULTS).forEach(k => { if (have.indexOf(k) < 0) sh.appendRow([k, CONFIG_DEFAULTS[k], CONFIG_NOTES[k] || '']); });
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
 * Run from the editor (safe to run again): creates the MailQueue and Updates tabs and the mail Config rows, adds the
 * "Receipt sent" column to Payments and "Mail opt-out" to Registrations, creates the private photo folder if needed and
 * keeps it private, installs the triggers, syncs photo sharing with the Visible boxes, and asks Google for permissions.
 */
function setup() {
  ensureTab_(TAB.mail, MAIL_HEADERS);
  sheet_(TAB.pay);                              // a clear "Missing tab" error beats creating a one-column Payments tab
  ensureTab_(TAB.pay, ['Receipt sent']);
  sheet_(TAB.reg);
  ensureTab_(TAB.reg, [REG_OPTOUT]);            // appends the column; existing columns keep their places
  updatesSheet_();
  ensureConfigKeys_();
  const cfg = config_();
  const folder = photoFolder_(cfg);
  lockFolder_(folder);
  installTriggers_();
  syncPhotoSharing();
  recompute_();
  let hasKey = false, hasClaude = false;
  try { hasKey = !!PropertiesService.getScriptProperties().getProperty('BREVO_API_KEY'); } catch (err) {}
  try { hasClaude = !!PropertiesService.getScriptProperties().getProperty('ANTHROPIC_API_KEY'); } catch (err) {}
  console.log('Setup complete. Photo folder: ' + folder.getUrl() + '. Photo uploads are ' + (yes_(cfg.photosEnabled) ? 'ON' : 'OFF') + ' (Config tab: photosEnabled).');
  console.log('Updates tab is ready (tick Approved to send at 9 am, or use the Reunion menu). ' +
    (hasClaude ? 'ANTHROPIC_API_KEY is set, so "Draft update with AI" works.' : 'ANTHROPIC_API_KEY is not set (Project Settings → Script Properties), so "Draft update with AI" will ask for it; sending works without it.'));
  console.log('Mail: from ' + cfg.mailFromName + ' <' + cfg.mailFrom + '>, reply-to ' + (cfg.mailReplyTo || cfg.email || '(none)') + '. ' +
    (hasKey ? 'BREVO_API_KEY is set, so Brevo is tried first.' : 'BREVO_API_KEY is not set (Project Settings → Script Properties), so only MailApp is used.') +
    ' MailApp sends left today: ' + MailApp.getRemainingDailyQuota() + '.');
}

/* ---------------- helpers ---------------- */

function mineData_(row, cfg) {
  const pays = rows_(TAB.pay).filter(p => p['Household ID'] === row['Household ID']).map(p => ({
    amount: Number(p.Amount) || 0, method: String(p.Method || ''), date: iso_(p['Date sent']), ref: String(p.Reference || ''),
    status: String(p.Status || 'Reported'), confirmedOn: iso_(p['Confirmed on'])
  }));
  const att = String(row.Attendees || '').split('\n').filter(String).map(l => {
    const [name, band, age, shirt, diet] = l.split(' · ');
    return { name: name || '', band: /child/i.test(band || '') ? 'child' : 'adult', age: age || '', shirt: shirt || '', diet: diet || '' };
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

/**
 * Emails the household its private link. rotate = true makes a new token first (older links stop working);
 * a token passed in is used as is (register_ has just stored its hash). Returns sendMail_'s result.
 */
function sendLink_(row, cfg, rotate, token) {
  // Before the site is live there is no link to send, so the token is left alone and a plain receipt goes out.
  if (!yes_(cfg.siteLive)) return sendReceipt_(row, cfg);
  if (!token) {
    token = newToken_();
    const sh = sheet_(TAB.reg), H = headers_(sh), all = sh.getDataRange().getValues();
    for (let i = 1; i < all.length; i++) {
      if (all[i][H.col['Household ID']] === row['Household ID']) { sh.getRange(i + 1, H.col['Token hash'] + 1).setValue(hash_(token)); break; }
    }
  }
  return sendMail_(linkEmail_(row, cfg, token, rotate), cfg);
}

/** Until the full site is live, registrants get a plain receipt instead of a private edit link. */
function sendReceipt_(row, cfg) {
  const name = row.Preferred || row.First || 'cousin';
  const html = mailWrap_(
    '<p>Hi ' + htmlEsc_(name) + ',</p>' +
    '<p>Thank you for registering for the Lewis Family Reunion, July 2–5, 2027 in Fresno. Here is what we have for your household.</p>' +
    regDetails_(row, cfg, false) +
    '<p>To change anything, or with any question, reply to this email. It reaches the committee.</p>', cfg);
  return sendMail_({
    to: String(row.Email), toName: name, subject: 'You are registered: Lewis Family Reunion 2027', html: html, text: htmlToText_(html),
    // The minute in the key: a double tap sends one email, but a resend asked for later the same day still goes out.
    key: 'receipt0:' + row['Household ID'] + ':' + Utilities.formatDate(new Date(), 'UTC', 'yyyyMMddHHmm'), kind: 'receipt0', householdId: String(row['Household ID'] || '')
  }, cfg);
}

/* ---------------- mail ----------------
   One door for every email: sendMail_(msg, cfg). It tries Brevo (sender = Config mailFrom, key = Script Property
   BREVO_API_KEY), then the deployer's Gmail through MailApp (about 100 recipients a day), and otherwise parks the
   message in the MailQueue tab for drainMailQueue() to send later. Every email, sent or queued, is a MailQueue row,
   so the committee has one place to look. Nothing in this section throws; callers get { ok, via, error }.
   msg = { to, toName, subject, html, text, key, kind, householdId }. key makes a repeat of the same email within
   6 hours a no-op (via 'dupe'). opts (tests only): { skipBrevo, skipMailApp }. */

function sendMail_(msg, cfg, opts) {
  opts = opts || {};
  const res = { ok: false, via: '', error: '' };
  if (!msg || !msg.to) { res.error = 'no recipient'; return res; }
  if (!msg.text) msg.text = htmlToText_(msg.html);
  const cacheKey = msg.key ? 'mail:' + msg.key : '';
  let cache = null;
  try { cache = CacheService.getScriptCache(); if (cacheKey && cache.get(cacheKey)) return { ok: true, via: 'dupe', error: '' }; } catch (err) { console.warn('mail cache: ' + (err && err.message)); }
  const errors = [];
  if (opts.skipBrevo) errors.push('Brevo skipped');
  else {
    try {
      const b = brevoSend_(msg, cfg);
      if (b.ok) { res.ok = true; res.via = 'Brevo ' + b.id; } else errors.push(b.error);
    } catch (err) { errors.push('Brevo: ' + (err && err.message)); }
  }
  if (!res.ok) {
    if (opts.skipMailApp) errors.push('MailApp skipped');
    else {
      try {
        if (MailApp.getRemainingDailyQuota() > MAIL_RESERVE) { mailAppSend_(msg, cfg); res.ok = true; res.via = 'MailApp'; }
        else errors.push('MailApp daily quota used up');
      } catch (err) { errors.push('MailApp: ' + (err && err.message)); }
    }
  }
  if (res.ok) {
    try { logMail_(msg, res.via); } catch (err) { console.warn('MailQueue log: ' + (err && err.message)); }
    try { if (cacheKey && cache) cache.put(cacheKey, '1', 6 * 3600); } catch (err) {}
    return res;
  }
  res.error = errors.join('; ');
  try { enqueue_(msg, res.error); res.ok = true; res.via = 'queued'; }
  catch (err) { res.error += '; queue: ' + (err && err.message); console.error('Mail lost: ' + res.error); }
  return res;
}

/** The MailApp (Gmail) send. Kept in one place so the only MailApp.sendEmail calls are here and in send_. */
function mailAppSend_(msg, cfg) {
  MailApp.sendEmail({
    to: String(msg.to), subject: String(msg.subject || ''), htmlBody: String(msg.html || ''), body: String(msg.text || ''),
    name: cfg.mailFromName, replyTo: cfg.mailReplyTo || cfg.email || undefined
  });
}

/**
 * One transactional email through the Brevo API. Returns { ok, id, error, quota, config }: any 2xx is ok (Brevo
 * answers 201 with a messageId), config = the key is missing or refused (401/403), quota = 402/429. Callers treat every
 * other failure (4xx, 5xx, network) alike: try MailApp, else leave the row queued. The key and the message body are never logged.
 */
function brevoSend_(msg, cfg) {
  let key = '';
  try { key = PropertiesService.getScriptProperties().getProperty('BREVO_API_KEY') || ''; } catch (err) {}
  if (!key) return { ok: false, error: 'Brevo: no BREVO_API_KEY script property', config: true };
  const to = { email: String(msg.to) };
  if (msg.toName) to.name = String(msg.toName);
  const replyTo = String(cfg.mailReplyTo || cfg.email || '').trim();
  const payload = {
    sender: { name: String(cfg.mailFromName || ''), email: String(cfg.mailFrom || '') }, to: [to],
    subject: String(msg.subject || ''), htmlContent: String(msg.html || ''), textContent: String(msg.text || htmlToText_(msg.html))
  };
  if (replyTo) payload.replyTo = { email: replyTo };
  let resp;
  try {
    resp = UrlFetchApp.fetch(BREVO_URL, { method: 'post', contentType: 'application/json', headers: { 'api-key': key }, muteHttpExceptions: true, payload: JSON.stringify(payload) });
  } catch (err) { return { ok: false, error: 'Brevo: ' + (err && err.message) }; }
  const status = resp.getResponseCode();
  let body = {};
  try { body = JSON.parse(resp.getContentText() || '{}') || {}; } catch (err) {}
  if (status >= 200 && status < 300) return { ok: true, id: String(body.messageId || '') };
  const error = 'Brevo ' + status + (body.code ? ' ' + body.code : '') + (body.message ? ': ' + String(body.message).slice(0, 200) : '');
  return { ok: false, error: error, config: status === 401 || status === 403, quota: status === 402 || status === 429 };
}

/** Plain-text version of simple HTML (paragraphs, lists, line breaks, links). Used for email text parts and page_. */
function htmlToText_(html) {
  return String(html == null ? '' : html)
    .replace(/<li[^>]*>/g, '  • ').replace(/<\/li>/g, '\n').replace(/<ul[^>]*>/g, '').replace(/<\/ul>/g, '\n')
    .replace(/<h2[^>]*>/g, '\n').replace(/<\/h2>/g, '\n').replace(/<\/p>/g, '\n\n').replace(/<br\s*\/?>/g, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&')
    .replace(/\n{3,}/g, '\n\n').trim();
}

/** The shared email frame: Georgia body plus the committee sign-off. bodyHtml is already escaped HTML. */
function mailWrap_(bodyHtml, cfg) {
  return '<div style="font-family:Georgia,serif;font-size:16px;line-height:1.6;color:#1b1b18;max-width:560px">' + bodyHtml +
    '<p>' + SIGNOFF + '</p>' +
    '<p>The Lewis Family Reunion Committee<br>' + htmlEsc_(cfg.email || '') + '</p></div>';
}

/** One MailQueue row as { header: value }; appendMail_ lays it out in the tab's live header order. */
function mailRow_(msg, status, attempts, error, sent, via) {
  return {
    Queued: new Date(), To: String(msg.to || ''), Subject: String(msg.subject || ''), Html: String(msg.html || ''), Text: String(msg.text || ''),
    Status: status, Attempts: attempts, 'Last error': String(error || ''), Sent: sent || '', Via: String(via || ''),
    Key: String(msg.key || ''), Kind: String(msg.kind || ''), 'Household ID': String(msg.householdId || '')
  };
}
/** Appends a MailQueue row by header name (the register_ pattern), so a moved or deleted column cannot misalign it. */
function appendMail_(data) {
  const sh = ensureTab_(TAB.mail, MAIL_HEADERS), H = headers_(sh);
  sh.appendRow(H.names.map(n => data[n] !== undefined ? data[n] : ''));
}
/** Parks an email for drainMailQueue(). lastError says why the direct send did not happen. */
function enqueue_(msg, lastError) { appendMail_(mailRow_(msg, 'Queued', 0, lastError, '', '')); }
/** Records an email that went out directly, so MailQueue is the full log. */
function logMail_(msg, via) { appendMail_(mailRow_(msg, 'Sent', 1, '', new Date(), via)); }

/**
 * Hourly trigger and menu item "Send queued mail now". Two steps so the script lock is held for a moment, not for the
 * whole run (registrations used to get "Lots of cousins at once!" during a drain). claim_ (under locked_) takes the
 * Queued rows, oldest first and at most 100, marks each Status 'Sending' with 'claimed <ISO time>' in Last error, and
 * releases the lock. send_ then works through them for at most 4.5 minutes without the lock, writing Status, Attempts,
 * Last error, Sent and Via per row as it goes; rows it does not reach go back to Queued. A row left 'Sending' for more
 * than MAIL_CLAIM_MINUTES (a run that died) is claimed again by the next run.
 * Brevo is used until a quota or key problem closes it for the run (no attempt counted), then MailApp within today's
 * quota. Any other Brevo failure (bad address, 5xx, network) falls through to MailApp the same way the live path does.
 * A row that could not be sent gets exactly one more Attempt per run and is marked Failed at MAIL_MAX_ATTEMPTS; what
 * was not tried (both routes closed) stays Queued with the reason. The committee retries a Failed row by typing Queued.
 * MailQueue rows are never deleted by code, so a row number noted under the lock still points at the same row later;
 * do not delete rows by hand while a drain is running.
 */
function drainMailQueue(maxMs) {
  const claim = locked_(claim_);
  if (claim.error === 'busy') { console.log('Mail queue: the sheet is busy; try again in a minute.'); return claim; }
  const res = send_(claim, maxMs);   // the trigger passes an event object here, which send_ ignores
  console.log('Mail queue: ' + res.sent + ' sent, ' + res.failed + ' failed, ' + res.left + ' still queued' + (res.dupes ? ', ' + res.dupes + ' already sent (dupe)' : '') + '.');
  return res;
}

/** Status cell text as the committee may have typed it ('queued ' counts as Queued). */
function mailStatus_(v) { return String(v == null ? '' : v).trim().toLowerCase(); }

/** Under the lock: pick the rows to send and mark them 'Sending'. Returns { ok, sh, H, todo: [{ row, r }], left }. */
function claim_() {
  const sh = ensureTab_(TAB.mail, MAIL_HEADERS), H = headers_(sh), last = sh.getLastRow(), col = n => H.col[n];
  const out = { ok: true, sh: sh, H: H, todo: [], left: 0 };
  if (last < 2) return out;
  const all = sh.getRange(2, 1, last - 1, H.names.length).getValues(), stale = Date.now() - MAIL_CLAIM_MINUTES * 60000;
  const todo = [];
  all.forEach((r, i) => {
    const st = mailStatus_(r[col('Status')]);
    if (st === 'queued') todo.push({ row: i + 2, r: r });
    else if (st === 'sending') {   // a claim with no readable time, or an old one, belongs to a run that died
      const m = /^claimed (\S+)/.exec(String(r[col('Last error')] || '')), t = m ? new Date(m[1]).getTime() : NaN;
      if (isNaN(t) || t < stale) todo.push({ row: i + 2, r: r });
    }
  });
  todo.sort((a, b) => new Date(a.r[col('Queued')]) - new Date(b.r[col('Queued')]));
  out.todo = todo.slice(0, 100);
  out.left = todo.length - out.todo.length;   // rows the cap left for the next run
  const now = new Date().toISOString();
  out.todo.forEach(item => mailWrite_(sh, H, item.row, { Status: 'Sending', 'Last error': 'claimed ' + now }));
  SpreadsheetApp.flush();   // the 'Sending' marks must be on the sheet before locked_ releases the lock, or a parallel run claims the same rows
  return out;
}

/** Writes some of Status, Attempts, Last error, Sent, Via on one MailQueue row, as one block when they sit side by side. */
function mailWrite_(sh, H, row, vals) { cells_(sh, H, row, ['Status', 'Attempts', 'Last error', 'Sent', 'Via'], vals); }
/** Writes vals[name] for each header in order that vals has and the tab knows, as one block when the columns sit side by side. */
function cells_(sh, H, row, order, vals) {
  const names = order.filter(n => vals[n] !== undefined && H.col[n] !== undefined);
  const cols = names.map(n => H.col[n]);
  if (cols.length && cols.every((c, i) => c === cols[0] + i)) sh.getRange(row, cols[0] + 1, 1, cols.length).setValues([names.map(n => vals[n])]);
  else names.forEach((n, i) => sh.getRange(row, cols[i] + 1).setValue(vals[n]));
}

/**
 * Outside the lock: sends the claimed rows for at most maxMs (default and cap 4.5 minutes; sendUpdates passes what is left of
 * its own run). A row whose key the script cache saw go out in the last 6 hours (sendMail_'s guard, now applied to queued rows
 * too) is marked Sent with Via 'dupe' and not sent again. Returns { ok, sent, failed, left, dupes }.
 */
function send_(claim, maxMs) {
  const start = Date.now(), limit = typeof maxMs === 'number' && maxMs > 0 ? Math.min(maxMs, 270000) : 270000;
  const out = { ok: true, sent: 0, failed: 0, left: claim.left, dupes: 0 };
  const sh = claim.sh, H = claim.H, col = n => H.col[n];
  if (!claim.todo.length) return out;
  const cfg = config_();
  let cache = null;
  try { cache = CacheService.getScriptCache(); } catch (err) {}
  let brevoOpen = true, budget = 0, n = 0;
  try { budget = MailApp.getRemainingDailyQuota() - MAIL_RESERVE; } catch (err) { budget = 0; }
  for (const item of claim.todo) {
    if (Date.now() - start > limit) break;
    n++;
    const r = item.r;
    const msg = { to: r[col('To')], subject: r[col('Subject')], html: r[col('Html')], text: r[col('Text')], key: r[col('Key')] };
    let attempts = Number(r[col('Attempts')]) || 0, status = 'Queued', via = '', sent = '', tried = false, seen = false;
    const errs = [];
    try { seen = !!(msg.key && cache && cache.get('mail:' + msg.key)); } catch (err) {}
    if (seen) { status = 'Sent'; via = 'dupe'; out.dupes++; }   // a second copy of an email that already went out
    else try {
      if (brevoOpen) {
        const b = brevoSend_(msg, cfg);
        if (b.ok) { status = 'Sent'; via = 'Brevo ' + b.id; }
        else { errs.push(b.error); if (b.quota || b.config) brevoOpen = false; else tried = true; }   // quota/key: not this message's fault
      } else errs.push('Brevo closed for this run');
      if (status === 'Queued') {
        if (budget > 0) {
          try { mailAppSend_(msg, cfg); budget--; status = 'Sent'; via = 'MailApp'; }
          catch (err) { tried = true; errs.push('MailApp: ' + (err && err.message)); }
        } else errs.push('MailApp daily quota used up');
      }
    } catch (err) { tried = true; errs.push(String(err && err.message || err)); }
    if (status === 'Sent') {
      sent = new Date(); attempts++; if (!seen) out.sent++;
      try { if (msg.key && cache) cache.put('mail:' + msg.key, '1', 6 * 3600); } catch (err) {}
    } else if (tried) { attempts++; if (attempts >= MAIL_MAX_ATTEMPTS) status = 'Failed'; }
    if (status === 'Failed') out.failed++; else if (status === 'Queued') out.left++;
    mailWrite_(sh, H, item.row, { Status: status, Attempts: attempts, 'Last error': status === 'Sent' ? '' : errs.join('; '), Sent: sent, Via: via });
  }
  // Rows the clock left: hand them back now instead of waiting MAIL_CLAIM_MINUTES for a reclaim.
  claim.todo.slice(n).forEach(item => { mailWrite_(sh, H, item.row, { Status: 'Queued', 'Last error': String(item.r[col('Last error')] || '') }); out.left++; });
  return out;
}

/* ---------------- committee updates ----------------
   The Updates tab is the committee's broadcast tool. They write a Subject and either a Draft (plain text or simple HTML)
   or bullet Notes for draftUpdate() to turn into a Draft, choose an Audience, read the Draft, and tick Approved. sendUpdates()
   (daily trigger at 9, or menu "Send approved updates now") takes every Approved row whose "Sent at" is blank or still
   'sending…' (a run that stopped or died), queues one MailQueue row per household through enqueue_ (never a direct send:
   Brevo allows about 300 a day and drainMailQueue() paces the rest over the following hours), and writes Sent at, Sent,
   Failed and Skipped back. The MailQueue key update:<ID>:<email> is the record of who has been queued: a recipient whose
   key is already there is never queued twice, so a run can stop, die or be repeated safely. Opt-out is by a STOP reply:
   the committee types Yes in the Registrations column "Mail opt-out" by hand. */

/**
 * Menu "Send approved updates now" and the daily trigger. onlyId (tests) limits the run to one Updates row; the trigger
 * passes an event object, which is ignored. The script lock is held only for claimUpdates_, which marks the rows it takes
 * with Sent at = 'sending…' so an overlapping run or a second click takes nothing twice. Recipients are then built and
 * queued outside the lock, skipping keys already in MailQueue. Queueing stops after UPDATE_QUEUE_MS: the row then keeps
 * 'sending…' with an "In progress" note in Failed and the next run (menu, or the trigger next morning) carries on from
 * there. Sent = recipients present in MailQueue for this update; Sent at becomes a date only when all of them are. An
 * error leaves 'sending…' and an "ERROR:" note so the next run retries. drainMailQueue() runs once at the end, with what
 * is left of the six-minute run, so the first batch leaves at once; otherwise the hourly drain sends.
 */
function sendUpdates(onlyId) {
  if (typeof onlyId !== 'string') onlyId = undefined;
  const start = Date.now();
  const claim = locked_(() => claimUpdates_(onlyId));
  if (claim.error === 'busy') { console.log('Updates: the sheet is busy; try again in a minute.'); return claim; }
  const out = { ok: true, updates: claim.todo.length, queued: 0, pending: 0 };
  if (!claim.todo.length) { console.log('Updates: nothing approved and unsent.'); return out; }
  const cfg = config_(), regs = rows_(TAB.reg), sh = claim.sh, H = claim.H, keys = updateKeys_();
  claim.todo.forEach(item => {
    const upd = item.upd, res = { 'Sent at': new Date(), Sent: 0, Failed: '', Skipped: 0 };
    try {
      const aud = audience_(upd.Audience, regs, cfg);
      res.Skipped = aud.skipped;
      if (!String(upd.Draft == null ? '' : upd.Draft).trim()) res.Failed = 'Draft is blank; nothing was sent';
      else if (!aud.rows.length) res.Failed = aud.known ? (aud.why || 'No households matched') : 'No households matched audience "' + str_(upd.Audience).trim() + '"';
      else {
        let stopped = false;
        for (const row of aud.rows) {
          const msg = updateEmail_(row, upd, cfg);
          if (keys.has(msg.key)) { res.Sent++; continue; }   // queued by an earlier run
          if (Date.now() - start > UPDATE_QUEUE_MS) { stopped = true; break; }
          enqueue_(msg, 'update ' + upd.ID); keys.add(msg.key); res.Sent++; out.queued++;
        }
        if (stopped) { res['Sent at'] = UPDATE_SENDING; res.Failed = 'In progress: ' + res.Sent + ' of ' + aud.rows.length + ' queued; the next run continues'; out.pending++; }
      }
    } catch (err) {
      res['Sent at'] = UPDATE_SENDING; res.Failed = 'ERROR: ' + (err && err.message || err) + '; the next run retries'; out.pending++;
      console.error('Update ' + upd.ID + ': ' + (err && err.stack || err));
    }
    cells_(sh, H, item.row, ['Sent at', 'Sent', 'Failed', 'Skipped'], res);
    console.log('Update ' + upd.ID + ' (' + str_(upd.Audience) + '): ' + res.Sent + ' queued, ' + res.Skipped + ' skipped' + (res.Failed ? ', ' + res.Failed : '') + '.');
  });
  if (out.queued) {
    const left = RUN_MS - (Date.now() - start);
    if (left > 60000) { try { drainMailQueue(left - 30000); } catch (err) { console.warn('Updates: drain after queueing: ' + (err && err.message)); } }
    else console.log('Updates: no time left in this run to send; the hourly drain will.');
  }
  console.log('Updates: ' + out.queued + ' queued' + (out.pending ? ', ' + out.pending + ' update(s) still in progress' : '') + '; Brevo allows about 300 a day, and the hourly drain carries the rest.');
  return out;
}

/**
 * Under the lock, briefly: the Approved rows whose "Sent at" is blank or 'sending…' (a run that stopped or died, resumed now)
 * get an ID (and Created) if blank and Sent at = 'sending…'. onlyId limits the claim to that one ID. Returns { ok, sh, H, todo: [{ row, upd }] }.
 */
function claimUpdates_(onlyId) {
  const sh = updatesSheet_(), H = headers_(sh), last = sh.getLastRow(), out = { ok: true, sh: sh, H: H, todo: [] };
  if (last < 2 || H.col.Approved === undefined || H.col['Sent at'] === undefined) return out;
  const all = sh.getRange(2, 1, last - 1, H.names.length).getValues();
  all.forEach((r, i) => {
    const upd = {}; H.names.forEach((n, j) => { if (n) upd[n] = r[j]; });
    const at = String(upd['Sent at'] == null ? '' : upd['Sent at']).trim().toLowerCase();
    if (!yes_(upd.Approved) || (at && at !== UPDATE_SENDING)) return;
    if (onlyId && str_(upd.ID).trim() !== onlyId) return;
    const row = i + 2;
    if (!str_(upd.ID).trim()) { upd.ID = 'U-' + Utilities.getUuid().slice(0, 8).toUpperCase(); if (H.col.ID !== undefined) sh.getRange(row, H.col.ID + 1).setValue(upd.ID); }
    if (H.col.Created !== undefined && !upd.Created) sh.getRange(row, H.col.Created + 1).setValue(new Date());
    sh.getRange(row, H.col['Sent at'] + 1).setValue(UPDATE_SENDING);
    out.todo.push({ row: row, upd: upd });
  });
  SpreadsheetApp.flush();   // the marks must be on the sheet before locked_ releases the lock, or a parallel run claims the same rows
  return out;
}

/** Every update:<ID>:<email> key already in MailQueue, read once per run: who has been queued for which update. */
function updateKeys_() {
  const sh = ensureTab_(TAB.mail, MAIL_HEADERS), H = headers_(sh), last = sh.getLastRow(), keys = new Set();
  if (last < 2 || H.col.Key === undefined) return keys;
  sh.getRange(2, H.col.Key + 1, last - 1, 1).getValues().forEach(r => { const k = String(r[0] || ''); if (k.indexOf('update:') === 0) keys.add(k); });
  return keys;
}

/** The Updates tab, created with its headers and an Approved checkbox column (rows 2 to 200) when missing. An existing tab is left as it is. */
function updatesSheet_() {
  const had = !!SpreadsheetApp.getActive().getSheetByName(TAB.updates), sh = ensureTab_(TAB.updates, UPDATE_HEADERS);
  if (!had) {
    const c = headers_(sh).col.Approved;
    if (c !== undefined) sh.getRange(2, c + 1, 199, 1).setDataValidation(SpreadsheetApp.newDataValidation().requireCheckbox().build());
  }
  return sh;
}

/**
 * Who gets an update. value is the Audience cell: all (every household), unpaid (Balance > 0), paid (Status "Paid in full"),
 * test (only the committee address from Config), or a Branch name (case does not matter). Households with Mail opt-out = Yes
 * or a blank email are counted in skipped; one row per email. Returns { rows, skipped, known, why }: known = the value is a
 * keyword or matched at least one Branch, so an empty list with known false means a misspelt audience.
 */
function audience_(value, regs, cfg) {
  const a = String(value == null ? '' : value).trim().toLowerCase(), out = { rows: [], skipped: 0, known: UPDATE_AUDIENCES.indexOf(a) >= 0, why: '' };
  if (a === 'test') {
    const to = String(cfg.email || '').trim();
    if (to) out.rows.push({ 'Household ID': 'COMMITTEE', Email: to, Preferred: 'committee' }); else out.why = 'Config "email" is blank, so a test has nowhere to go';
    return out;
  }
  let pick;
  if (a === 'all') pick = () => true;
  else if (a === 'unpaid') pick = r => (num_(r.Balance) || 0) > 0;
  else if (a === 'paid') pick = r => str_(r.Status).trim() === 'Paid in full';
  else pick = r => str_(r.Branch).trim().toLowerCase() === a && !!a;
  const seen = {};
  regs.forEach(r => {
    if (!pick(r)) return;
    out.known = true;
    const email = str_(r.Email).trim().toLowerCase();
    if (!email || yes_(r[REG_OPTOUT])) { out.skipped++; return; }
    if (seen[email]) return;   // two households sharing an address get one copy
    seen[email] = true;
    out.rows.push(r);
  });
  return out;
}

/** One MailQueue message for a household: the Draft as HTML with "Hi <name>," on top and the STOP footer, inside the usual frame. */
function updateEmail_(row, upd, cfg) {
  const name = str_(row.Preferred).trim() || str_(row.First).trim() || 'cousin', email = str_(row.Email).trim();
  const body = greet_(draftHtml_(upd.Draft), name) + '<p style="font-size:14px;color:#555">' + htmlEsc_(UPDATE_FOOTER) + '</p>';
  const html = mailWrap_(body, cfg);
  return {
    to: email, toName: name, subject: str_(upd.Subject).trim() || 'An update from the Lewis Family Reunion committee', html: html, text: htmlToText_(html),
    key: 'update:' + upd.ID + ':' + email.toLowerCase(), kind: 'update', householdId: String(row['Household ID'] || '')
  };
}

/**
 * The Draft cell as HTML. Anything with <p> or <br> is trusted as written by the committee. Plain text is split into paragraphs
 * at blank lines, escaped, with single line breaks kept as <br>. A closing sign-off line is dropped because mailWrap_ adds it:
 * in plain text before the split (so a paragraph it ended is still closed), in HTML with the <br> before it, and an emptied <p> goes too.
 */
function draftHtml_(draft) {
  const s = String(draft == null ? '' : draft).replace(/\r\n?/g, '\n').trim();
  if (/<p[\s>]|<br/i.test(s)) {
    return s.replace(/\s*(?:<br\s*\/?>)?\s*Somehow, some way, your foundation is Lewis[^<\n]*belong here\.?\s*(?=(?:<\/p>)?\s*$)/i, '').replace(/<p[^>]*>\s*<\/p>\s*$/i, '');
  }
  return s.replace(/\s*Somehow, some way, your foundation is Lewis[^<\n]*belong here\.?\s*$/i, '')
    .split(/\n\s*\n/).map(p => p.trim()).filter(String).map(p => '<p>' + htmlEsc_(p).replace(/\n/g, '<br>') + '</p>').join('');
}

/**
 * Puts "Hi <name>," first. If the first line (up to a tag or line break, optionally opening the first <p>) is a greeting such as
 * "Hi,", "Hello everyone," or "Dear family," it is replaced; otherwise a greeting paragraph is added in front.
 */
function greet_(html, name) {
  const hi = 'Hi ' + htmlEsc_(name) + ',', m = /^(\s*(?:<p[^>]*>)?\s*)([^<\n]*)/.exec(html);
  if (m && /^(hi|hello|hey|dear|greetings)\b[^\n<]{0,40},\s*$/i.test(m[2])) return m[1] + hi + html.slice(m[0].length);
  return '<p>' + hi + '</p>' + html;
}

/**
 * Menu "Draft update with AI". Takes the first Updates row with Notes and an empty Draft (or a Draft that says just "redo"),
 * asks Claude for the email body, and writes it into Draft with Approved unticked so a person reads it before anything is sent.
 * Needs the Script Property ANTHROPIC_API_KEY; costs pennies per draft. Problems are written into Draft starting "ERROR:".
 */
function draftUpdate() {
  const sh = updatesSheet_(), H = headers_(sh), last = sh.getLastRow();
  if (H.col.Notes === undefined || H.col.Draft === undefined) { alert_('The Updates tab needs Notes and Draft columns.'); return; }
  let target = null;
  for (let r = 2; r <= last && !target; r++) {
    const row = rowAt_(sh, H, r), draft = str_(row.Draft).trim();
    if (str_(row.Notes).trim() && (!draft || draft.toLowerCase() === 'redo')) target = { r: r, row: row };
  }
  if (!target) { alert_('Nothing to draft. Put bullet notes in the Notes column of a row with an empty Draft.'); return; }
  let key = '';
  try { key = PropertiesService.getScriptProperties().getProperty('ANTHROPIC_API_KEY') || ''; } catch (err) {}
  if (!key) { alert_('No ANTHROPIC_API_KEY yet. In the Apps Script editor open Project Settings, then Script Properties, and add ANTHROPIC_API_KEY with a key from the Anthropic Console. Sending updates works without it.'); return; }
  const cfg = config_(), text = clean_(claudeDraft_(key, updatePrompt_(), updateContext_(target.row, cfg)), 20000);
  sh.getRange(target.r, H.col.Draft + 1).setValue(text);
  if (H.col.Approved !== undefined) sh.getRange(target.r, H.col.Approved + 1).setValue(false);
  const ok = !/^ERROR:/.test(text);
  console.log('Draft update: row ' + target.r + (ok ? ' drafted (' + text.length + ' characters).' : ' ' + text.slice(0, 200)));
  alert_(ok ? 'Draft written to row ' + target.r + '. Read it, edit it, set the Audience, then tick Approved.' : 'The draft did not come back. Row ' + target.r + ' says: ' + text.slice(0, 300));
}

/** The voice the drafts are written in. The greeting is left out because updateEmail_ adds "Hi <name>," per household. */
function updatePrompt_() {
  return 'You write email updates from the Lewis Family Reunion 2027 committee to the registered families. ' +
    'Voice: a warm cousin on the committee writing to family. Plain English, short sentences, short paragraphs. No emojis. ' +
    'No subject line. Do not open with a greeting or a name; the script adds the greeting itself, so start directly with the news. ' +
    'Use only the facts in the notes and the context; do not invent dates, prices, places or deadlines. ' +
    'End with this exact line on its own: ' + SIGNOFF + ' ' +
    'Output only the email body as plain text with a blank line between paragraphs.';
}

/** The notes plus the facts Claude may use: dates and city, fees and deadline when Config has them, payment handles, the website. */
function updateContext_(upd, cfg) {
  const facts = ['Lewis Family Reunion, July 2-5, 2027, Fresno, California.'];
  const fa = num_(cfg.feeAdult), fc = num_(cfg.feeChild);
  if (fa !== null && fc !== null) facts.push('Fees: ' + money_(fa) + ' per adult, ' + money_(fc) + ' per child (age ' + (num_(cfg.childAge) !== null ? num_(cfg.childAge) : 12) + ' and under).');
  if (cfg.deadline) facts.push('Payment deadline: ' + iso_(cfg.deadline) + '.');
  const pay = payLine_(cfg); if (pay) facts.push(pay);
  const site = siteBase_(cfg); if (site) facts.push('Website: ' + site);
  return 'Subject the committee chose (do not repeat it as a heading): ' + (str_(upd.Subject).trim() || '(none yet)') + '\n\n' +
    'Notes from the committee:\n' + str_(upd.Notes).trim() + '\n\n' +
    'Facts you may use when the notes call for them:\n' + facts.join('\n');
}

/**
 * One Claude API call (POST /v1/messages). Returns the drafted text, or a line starting "ERROR:" for the committee to read:
 * a refusal (HTTP 200 with stop_reason "refusal"), a draft cut off at max_tokens (stop_reason "max_tokens"; a whole email
 * is a few hundred tokens, so 16000 only runs out on runaway output), a non-2xx status with the first 200 characters of the
 * body, or a network error.
 * fallbacks: "default" lets Anthropic retry a declined request on another model inside the same call. No thinking, temperature or
 * tool settings are sent. The key and the request are never logged.
 */
function claudeDraft_(key, system, user) {
  const body = { model: CLAUDE_MODEL, max_tokens: 16000, fallbacks: 'default', system: system, messages: [{ role: 'user', content: user }] };
  let resp;
  try {
    resp = UrlFetchApp.fetch(CLAUDE_URL, {
      method: 'post', contentType: 'application/json', muteHttpExceptions: true, payload: JSON.stringify(body),
      headers: { 'x-api-key': key, 'anthropic-version': '2026-10-21', 'anthropic-beta': 'server-side-fallback-2026-07-01' }
    });
  } catch (err) { return 'ERROR: ' + (err && err.message || err); }
  const status = resp.getResponseCode(), raw = String(resp.getContentText() || '');
  if (status < 200 || status >= 300) return 'ERROR: HTTP ' + status + ' ' + raw.slice(0, 200);
  let data = {};
  try { data = JSON.parse(raw) || {}; } catch (err) { return 'ERROR: the reply was not JSON. ' + raw.slice(0, 200); }
  if (data.stop_reason === 'refusal') return 'ERROR: the AI declined to draft this one. ' + (data.stop_details && data.stop_details.explanation || '');
  if (data.stop_reason === 'max_tokens') return 'ERROR: the draft was cut off. Shorten the notes and try again.';
  const text = (data.content || []).filter(b => b && b.type === 'text').map(b => String(b.text || '')).join('').trim();
  return text || 'ERROR: the reply had no text.';
}

/** A dialog when run from the menu, a log line when run from the editor (where there is no UI). */
function alert_(msg) {
  try { SpreadsheetApp.getUi().alert(msg); } catch (err) { console.log(msg); }
}

/* ---------------- email templates ----------------
   Each builder returns a sendMail_ message: { to, toName, subject, html, text, key, kind, householdId }.
   Wording ("Family code", "Registration code", "My Registration") matches the website; keep them in step. */

/** Website address without query or hash, from Config siteUrl. */
function siteBase_(cfg) { return String(cfg.siteUrl || '').replace(/[?#].*$/, ''); }
/** Attendee names from the Registrations "Attendees" cell (one "name · band · age · shirt" line per person). */
function attendeeNames_(row) { return String(row.Attendees || '').split('\n').filter(String).map(l => { const f = l.split(' · '); return f[0] + (f[4] ? ' (' + f[4] + ')' : ''); }); }
/** "abcd1234..." as "abcd 1234 ..." so a code can be read aloud or typed from paper. */
function groups_(s) { return (String(s || '').match(/.{1,4}/g) || []).join(' '); }
/** $25 or $12.50. */
function money_(n) { n = Math.round((Number(n) || 0) * 100) / 100; return '$' + (n % 1 ? n.toFixed(2) : String(n)); }
/** The button plus the same link spelled out, for mail clients that strip styles or links. */
function linkButton_(link, label) {
  return '<p><a href="' + htmlEsc_(link) + '" style="display:inline-block;background:#2f6e4e;color:#fff;padding:12px 20px;border-radius:999px;text-decoration:none">' + label + '</a></p>';
}
/** The grey "codes" box. lines are already-escaped HTML fragments, one per line. */
function codeBox_(lines) {
  return '<p style="font-size:14px;background:#f4f1ea;padding:12px 16px;border-radius:8px">' + lines.join('<br>') + '</p>';
}

/** "Estimated total: $N (A adults × $fa, C children × $fc). Due by YYYY-MM-DD." or the fees-pending sentence. */
function dueLine_(row, cfg) {
  const fa = num_(cfg.feeAdult), fc = num_(cfg.feeChild);
  if (fa === null || fc === null) return 'Registration fees will be announced soon; nothing is due yet.';
  const a = Number(row.Adults) || 0, c = Number(row.Children) || 0;
  let s = 'Estimated total: ' + money_(a * fa + c * fc) + ' (' + a + (a === 1 ? ' adult × ' : ' adults × ') + money_(fa) + ', ' + c + (c === 1 ? ' child × ' : ' children × ') + money_(fc) + ').';
  if (cfg.deadline) s += ' Due by ' + iso_(cfg.deadline) + '.';
  return s;
}

/** "Ways to pay: Zelle ..., Cash App ..." from the Config handles, or '' when none is set. */
function payLine_(cfg) {
  const ways = [['Zelle', cfg.zelle], ['Cash App', cfg.cashapp], ['Venmo', cfg.venmo], ['PayPal', cfg.paypal]]
    .filter(w => String(w[1] || '').trim()).map(w => w[0] + ' ' + String(w[1]).trim());
  return ways.length ? 'Ways to pay: ' + ways.join(', ') + '.' : '';
}

/**
 * The middle of both registration emails (linkEmail_ and sendReceipt_): the household's details with its Household ID,
 * what happens next, and the reunion hotel with the group-rate codes. live = the site is live, so payments are reported
 * on My Registration; otherwise by replying. HOTEL holds the same facts as the hotel card in index.html.
 */
function regDetails_(row, cfg, live) {
  const id = str_(row['Household ID']).trim(), people = attendeeNames_(row);
  const travel = [iso_(row.Arrive) ? 'arriving ' + iso_(row.Arrive) : '', iso_(row.Depart) ? 'leaving ' + iso_(row.Depart) : ''].filter(String).join(', ');
  const mine = [
    id ? ['Household ID', '<b>' + htmlEsc_(id) + '</b>'] : null,
    people.length ? ['Coming', htmlEsc_(people.join(', '))] : null,
    str_(row.Days) ? ['Days', htmlEsc_(str_(row.Days))] : null,
    travel ? ['Travel', htmlEsc_(travel)] : null,
    str_(row.Lodging) ? ['Staying', htmlEsc_(str_(row.Lodging))] : null
  ].filter(Boolean).map(l => l[0] + ': ' + l[1]);
  const fees = num_(cfg.feeAdult) !== null && num_(cfg.feeChild) !== null, pay = payLine_(cfg);
  const next = fees ? [
    htmlEsc_(dueLine_(row, cfg) + (pay ? ' ' + pay : '')),
    (live ? 'After you pay, report the payment on your My Registration page.' : 'After you pay, reply to this email with the amount, the method and the date.') +
      (id ? ' Please put your household ID, ' + htmlEsc_(id) + ', in the payment note so we can match it to you.' : ''),
    'The committee confirms each payment and emails you a receipt.'
  ] : [
    'Registration fees will be announced soon. Nothing is due yet; we will email you when they are set.',
    'Keep your household ID, ' + (id ? htmlEsc_(id) : 'shown above') + '. You will put it in the note when you pay.'
  ];
  next.push('The committee will email updates about the schedule and the venues as plans are confirmed.');
  const block = str_(cfg.roomBlock).trim();
  return '<p><b>Your registration</b><br>' + mine.join('<br>') + '</p>' +
    '<p><b>What happens next</b></p><ul>' + next.map(n => '<li>' + n + '</li>').join('') + '</ul>' +
    '<p><b>Reunion hotel</b><br>' + htmlEsc_(HOTEL.name) + '<br>' + htmlEsc_(HOTEL.address) + '<br>' + htmlEsc_(HOTEL.phone) + '<br>' +
    'Group rate available. Group code: <b>' + HOTEL.groupCode + '</b>. Hotel code: <b>' + HOTEL.hotelCode + '</b>.' +
    (block ? '<br>' + htmlEsc_(block) : '') + '</p>';
}

/** The registration email: private link as a button, then the same link, family code and registration code in plain text. */
function linkEmail_(row, cfg, token, rotate) {
  const name = row.Preferred || row.First || 'cousin', base = siteBase_(cfg), code = String(cfg.familyCode || '');
  const link = base + '?c=' + encodeURIComponent(code) + '&t=' + token + '#me';
  const html = mailWrap_(
    '<p>Hi ' + htmlEsc_(name) + ',</p>' +
    '<p>' + (rotate ? 'Here is a fresh private link to your registration. Older links and codes no longer work.' : 'Thank you for registering for the Lewis Family Reunion, July 2–5, 2027 in Fresno.') + '</p>' +
    linkButton_(link, 'Open my registration') +
    codeBox_([
      'Link: <a href="' + htmlEsc_(link) + '">' + htmlEsc_(link) + '</a>',
      'Website: ' + htmlEsc_(base),
      'Family code: <b>' + htmlEsc_(code) + '</b>',
      'Registration code: <b>' + htmlEsc_(groups_(token)) + '</b>',
      'If the link does not open, go to the website, open My Registration, and type the family code and the registration code.'
    ]) +
    regDetails_(row, cfg, true) +
    '<p>Use the link to update who is coming, report a payment, and see when the committee confirms it. Please keep this email; anyone with the link or codes can change your registration.</p>' +
    '<p>Questions? Reply to this email. It reaches the committee.</p>', cfg);
  return {
    to: String(row.Email), toName: name, subject: rotate ? 'Your Lewis Reunion registration link' : 'You are registered: Lewis Family Reunion 2027',
    html: html, text: htmlToText_(html), key: 'link:' + row['Household ID'] + ':' + hash_(token).slice(0, 12), kind: 'link', householdId: String(row['Household ID'] || '')
  };
}

/**
 * Receipt for a Payments row the committee marked Confirmed or Not received. Carries the family code and the
 * site link but never the registration code: only its hash is stored, and making a new one would log the cousin out.
 */
function receiptEmail_(row, pay, cfg) {
  const name = row.Preferred || row.First || 'cousin', st = String(pay.Status || ''), ok = st === 'Confirmed';
  const base = siteBase_(cfg), code = String(cfg.familyCode || ''), link = base + '?c=' + encodeURIComponent(code) + '#me';
  const feesSet = row.Due !== '' && row.Due !== null && row.Due !== undefined;
  const details = [
    'Amount: ' + htmlEsc_(money_(pay.Amount)), 'Method: ' + htmlEsc_(str_(pay.Method) || 'not given'), 'Date sent: ' + htmlEsc_(iso_(pay['Date sent']) || 'not given'),
    str_(pay.Reference) ? 'Reference: ' + htmlEsc_(str_(pay.Reference)) : ''
  ].filter(String);
  const html = mailWrap_(
    '<p>Hi ' + htmlEsc_(name) + ',</p>' +
    '<p>' + (ok ? 'The committee has confirmed the payment you reported. Thank you!'
      : 'The committee has not found the payment you reported yet. Please check the details below and reply to this email so we can sort it out together.') + '</p>' +
    '<p>' + details.join('<br>') + '</p>' +
    '<p>Confirmed so far: ' + htmlEsc_(money_(row.Confirmed)) + '<br>' + (feesSet ? 'Remaining balance: ' + htmlEsc_(money_(row.Balance)) : 'Fees to be announced') + '</p>' +
    linkButton_(link, 'Open the reunion website') +
    codeBox_([
      'Website: <a href="' + htmlEsc_(link) + '">' + htmlEsc_(link) + '</a>',
      'Family code: <b>' + htmlEsc_(code) + '</b>',
      'To open your registration, use the private link from your registration email, or choose Email my link on the My Registration page.'
    ]), cfg);
  return {
    to: String(row.Email), toName: name, subject: (ok ? 'Payment confirmed' : 'We have not found your payment yet') + ': Lewis Family Reunion 2027',
    html: html, text: htmlToText_(html), key: 'receipt:' + pay['Payment ID'] + ':' + st, kind: 'receipt', householdId: String(row['Household ID'] || '')
  };
}

/** Heads-up to the committee (Config email) about a new household. Sent when Config notifyCommittee is Yes. */
function committeeEmail_(row, cfg) {
  const who = ((row.Preferred || row.First || '') + ' ' + (row.Last || '')).trim(), id = String(row['Household ID'] || '');
  const lines = [
    ['Household', who + (id ? ' (' + id + ')' : '')], ['Branch', row.Branch], ['Adults', row.Adults], ['Children', row.Children], ['Days', row.Days],
    ['From', [row.City, row.State].filter(String).join(', ')], ['Email', row.Email], ['Phone', row.Phone], ['Dietary needs', row.Diet]
  ].filter(l => String(l[1] == null ? '' : l[1]).trim()).map(l => '<b>' + l[0] + ':</b> ' + htmlEsc_(str_(l[1])));
  const html = mailWrap_('<p>A new household registered on the website.</p><p>' + lines.join('<br>') + '</p><p>Details are in the Registrations tab.</p>', cfg);
  return {
    to: String(cfg.email), toName: 'Reunion Committee', subject: 'New registration: ' + who, html: html, text: htmlToText_(html),
    key: 'committee:' + id, kind: 'committee', householdId: id
  };
}

/* ---------------- operator tests (run from the editor or the menu) ---------------- */

/**
 * Menu "Send me a test email" / editor: sends a sample registration email to the person running it through the
 * full chain and logs the route. testSendMail('mailapp') skips Brevo so the Gmail fallback can be checked.
 */
function testSendMail(mode) {
  const cfg = config_(), me = Session.getEffectiveUser().getEmail();
  const row = { 'Household ID': 'H-TEST', First: 'Test', Last: 'Lewis', Email: me, Adults: 2, Children: 1, Attendees: 'Test Lewis · Adult\nCousin Lewis · Adult\nLittle Lewis · Child · 7' };
  const msg = linkEmail_(row, cfg, newToken_(), false);
  msg.subject = '[Test] ' + msg.subject; msg.key = 'test:' + Utilities.getUuid(); msg.kind = 'test';
  const res = sendMail_(msg, cfg, { skipBrevo: mode === 'mailapp' });
  console.log('Test email to ' + me + ': ' + (res.ok ? 'sent via ' + res.via : 'not sent') + (res.error ? ' (' + res.error + ')' : '') + '. The link in it leads nowhere; only the email itself is being tested.');
  return res;
}

/** Forces one row into MailQueue (no Brevo, no MailApp), then runs drainMailQueue() and logs the row before and after. */
function testEnqueue() {
  const cfg = config_(), me = Session.getEffectiveUser().getEmail();
  const html = mailWrap_('<p>This email waited in the MailQueue tab and was sent by drainMailQueue().</p>', cfg);
  const msg = { to: me, toName: 'Test', subject: '[Test] Queued mail: Lewis Family Reunion 2027', html: html, text: htmlToText_(html), key: 'test:' + Utilities.getUuid(), kind: 'test', householdId: '' };
  const before = sendMail_(msg, cfg, { skipBrevo: true, skipMailApp: true });
  const find = () => rows_(TAB.mail).find(r => r.Key === msg.key);
  const q = find();
  console.log('Before drain: ' + JSON.stringify(before) + '; row status ' + (q ? q.Status : 'missing'));
  drainMailQueue();
  const a = find();
  console.log('After drain: ' + (a ? a.Status + (a.Via ? ' via ' + a.Via : '') + (a['Last error'] ? ' (' + a['Last error'] + ')' : '') : 'row missing'));
}

/**
 * Appends an approved Updates row with its own ID and Audience "test" (goes only to the Config email), runs sendUpdates() for
 * that row alone (other Approved rows wait for the trigger or the menu), and logs its MailQueue row.
 */
function testUpdate() {
  const sh = updatesSheet_(), H = headers_(sh), id = 'U-TEST-' + Utilities.getUuid().replace(/-/g, '').slice(0, 6).toUpperCase();
  const data = { ID: id, Created: new Date(), Subject: 'Test update', Notes: 'test', Draft: 'This is a test update from the committee.\n\nNothing to do.', Approved: true, Audience: 'test' };
  // The checkbox validation makes Sheets treat rows 2-200 as used, so appendRow would land at row 201. Use the first empty row.
  writeRow_(sh, H, firstEmptyRow_(sh, H), data);
  sendUpdates(id);
  const row = rows_(TAB.mail).filter(r => String(r.Key).indexOf('update:' + id + ':') === 0).slice(-1)[0];
  console.log('Test update ' + id + ': MailQueue row is ' + (row ? row.To + ' | ' + row.Subject + ' | ' + row.Status : 'missing') + '. The Updates row shows Sent at, Sent 1.');
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

/** The Config tab as { key: value }, with CONFIG_DEFAULTS filled in where a row is missing or blank. */
function config_() {
  const out = {};
  rows_(TAB.cfg).forEach(r => { if (r.Key) out[String(r.Key).trim()] = r.Value; });
  Object.keys(CONFIG_DEFAULTS).forEach(k => { if (out[k] === undefined || String(out[k]).trim() === '') out[k] = CONFIG_DEFAULTS[k]; });
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
/** First row below the header whose ID and Subject (or the first two columns) are blank; the row after the last one when none. */
function firstEmptyRow_(sh, H) {
  const last = sh.getLastRow();
  if (last < 2) return 2;
  const a = H.col.ID !== undefined ? H.col.ID : 0, b = H.col.Subject !== undefined ? H.col.Subject : 1;
  const vals = sh.getRange(2, 1, last - 1, H.names.length).getValues();
  for (let i = 0; i < vals.length; i++) if (String(vals[i][a] || '') === '' && String(vals[i][b] || '') === '') return i + 2;
  return last + 1;
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
/** "Name: Vegan; Name: Gluten-free" for the Diet column, from the per-person choices. Blank when nobody needs anything. */
function dietSummary_(att) { return att.filter(a => a.diet).map(a => a.name + ': ' + a.diet).join('; '); }
function shirtSummary_(att) {
  const c = {}; att.forEach(a => { if (a.shirt && a.shirt !== 'No shirt') c[a.shirt] = (c[a.shirt] || 0) + 1; });
  return Object.keys(c).map(k => c[k] + '×' + k).join(', ');
}
/* 32 hex characters (one UUID), printed in the email as eight groups of four. Tokens issued before this change were
   64 characters long; they keep working because findByToken_ compares hashes and only requires 32 or more characters. */
function newToken_() { return Utilities.getUuid().replace(/-/g, ''); }
function hash_(s) {
  return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, String(s), Utilities.Charset.UTF_8)
    .map(b => ('0' + (b & 255).toString(16)).slice(-2)).join('');
}
function htmlEsc_(s) { return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
