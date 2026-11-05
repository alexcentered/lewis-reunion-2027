/* Back-office backend tests. Run with: node --test tests/   (Node 18+, no installs needed) */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeBackend } from './gas-mock.mjs';

const CLIENT_ID = '1234-test.apps.googleusercontent.com';
const REG_HEAD = ['Household ID', 'Registered', 'Updated', 'First', 'Middle', 'Last', 'Birth surname', 'Preferred', 'Email', 'Phone', 'City', 'State',
  'Branch', 'Parents', 'Grandparent', 'Spouse', 'Adults', 'Children', 'Attendees', 'Shirt sizes', 'Days', 'Arrive', 'Depart', 'Nights', 'Lodging',
  'Diet', 'Needs', 'Show on list', 'Token hash', 'Due', 'Confirmed', 'Awaiting', 'Balance', 'Status'];
const PAY_HEAD = ['Payment ID', 'Household ID', 'Household', 'Reported', 'Amount', 'Method', 'Date sent', 'Reference', 'Note', 'Status', 'Confirmed on', 'Confirmed by'];
const ENT_HEAD = ['Entry ID', 'Type', 'Posted', 'Posted by', 'Visible', 'Title', 'Subtitle', 'Meta', 'Body', 'Contact', 'Photo ID', 'Token hash'];
const ADM_HEAD = ['Email', 'Name', 'Role', 'Active', 'Added', 'Last sign-in', 'Notes'];

function reg(o) {
  const row = Object.assign({ Adults: 1, Children: 0, Days: 'Fri Jul 2, Sat Jul 3', Lodging: 'Reunion hotel (Home2 Suites)', Nights: 3, 'Show on list': 'Yes', Diet: 'None' }, o);
  return REG_HEAD.map(h => row[h] ?? '');
}
function fixture(extra = {}) {
  return {
    Config: [['Key', 'Value', 'Note'], ['familyCode', 'roots', ''], ['feeAdult', 100, ''], ['feeChild', 50, ''], ['email', 'committee@example.com', ''],
      ['siteLive', 'yes', ''], ['siteUrl', 'https://lewisfamilyroots.com/', ''], ['photoFolderId', 'F1', ''],
      ...(extra.noClientId ? [] : [['googleClientId', CLIENT_ID, '']])],
    Registrations: [REG_HEAD,
      reg({ 'Household ID': 'H-AAA', First: 'Ann', Last: 'Lewis', Email: 'ann@example.com', Branch: 'Lewis: Mary', Adults: 2, Children: 1,
        Attendees: 'Ann Lewis · Adult ·  · M\nBob Lewis · Adult ·  · L\nCee Lewis · Child · 7 · Youth S', Days: 'Fri Jul 2, Sat Jul 3, Sun Jul 4' }),
      reg({ 'Household ID': 'H-BBB', First: 'Dee', Last: 'Antone', Email: 'dee@example.com', Branch: 'constructor', Diet: 'Vegan', Lodging: 'With family',
        Attendees: 'Dee Antone · Adult ·  · No shirt' }),
      reg({ 'Household ID': 'H-CCC', First: '=HYPERLINK("http://evil")', Last: 'X', Email: 'x@example.com', Branch: '__proto__', Attendees: 'X · Adult ·  · XL' })],
    Payments: [PAY_HEAD,
      ['P-001', 'H-AAA', 'Ann Lewis', '2026-10-01', 150, 'Zelle', '2026-10-01', 'Z1', '', 'Reported', '', ''],
      ['P-002', 'H-BBB', 'Dee Antone', '2026-10-02', 100, 'Venmo', '2026-10-02', '', '', 'Confirmed', '2026-10-03', 'treasurer@example.com']],
    Entries: [ENT_HEAD,
      ['E-001', 'story', '2026-09-01', 'Ann', true, 'How Uncle Rene got his name', '', '', 'A story.', '', '', ''],
      ['E-002', 'market', '2026-09-02', 'Dee', true, 'Pound cake', '', '$25', 'Cake.', '', '', '']],
    Branches: [['Line', 'Founders', 'Child'], ['Lewis', 'John & Mary Lewis', 'Mary']],
    Names: [['Name', 'Note', 'Question']],
    Admins: [ADM_HEAD,
      ['Owner@Example.com', 'Olive', 'owner', true, '', '', ''],
      ['treasurer@example.com', 'Tess', 'treasurer', true, '', '', ''],
      ['coord@example.com', 'Cole', 'coordinator', 'yes', '', '', ''],
      ['viewer@example.com', 'Vic', 'viewer', true, '', '', ''],
      ['former@example.com', 'Fay', 'owner', false, '', '', ''],
      ['sneaky@example.com', 'Sly', 'constructor', true, '', '', '']]
  };
}

/** Google's tokeninfo stand-in: credential "good.<email>.sig" verifies; claims can be overridden per test. */
const now = () => Math.floor(Date.now() / 1000);
function google(over = {}) {
  return cred => {
    const m = /^good\.([^.]+)\.sig$/.exec(cred);
    if (!m) return { code: 400, body: '{"error":"invalid_token"}' };
    const email = Buffer.from(m[1], 'base64url').toString();
    const claims = { iss: 'https://accounts.google.com', aud: CLIENT_ID, sub: '1', email, email_verified: 'true', name: 'Test ' + email, exp: String(now() + 3600), ...over };
    return { code: 200, body: JSON.stringify(claims) };
  };
}
const cred = email => 'good.' + Buffer.from(email).toString('base64url') + '.sig';
function signIn(b, email) { return b.post({ action: 'admin', op: 'session', credential: cred(email) }); }
function setup(opts = {}) { return makeBackend({ tabs: fixture(opts), tokeninfo: google(opts.claims) }); }

test('admin calls are POST-only: a GET with action=admin never reaches the back office', () => {
  const b = setup();
  const res = b.get({ action: 'admin', op: 'snapshot', session: 'x'.repeat(64) });
  assert.equal(res.ok, false);
  assert.equal(res.error, 'code');
});

test('sign-in fails closed when googleClientId is not configured', () => {
  const b = setup({ noClientId: true });
  const res = signIn(b, 'owner@example.com');
  assert.equal(res.error, 'not_configured');
  assert.equal(b.fetches.length, 0, 'no call to Google without a client ID');
});

test('malformed credentials are rejected without calling Google', () => {
  const b = setup();
  for (const credential of ['', 'not-a-jwt', 'a.b', 'a.b.c.d', 'a.b.c"', 'x'.repeat(5000) + '.a.b']) {
    assert.equal(b.post({ action: 'admin', op: 'session', credential }).error, 'signin', credential.slice(0, 20));
  }
  assert.equal(b.fetches.length, 0);
});

test('tokens Google rejects, or that are not ours, are refused', () => {
  const cases = {
    'Google says invalid': { tokeninfo: () => ({ code: 400, body: '{}' }) },
    'wrong audience (another site\'s token)': { claims: { aud: 'someone-else.apps.googleusercontent.com' } },
    'wrong issuer': { claims: { iss: 'https://evil.example' } },
    'expired': { claims: { exp: String(now() - 5) } },
    'unverified email': { claims: { email_verified: 'false' } }
  };
  for (const [name, c] of Object.entries(cases)) {
    const b = makeBackend({ tabs: fixture(), tokeninfo: c.tokeninfo || google(c.claims) });
    const res = signIn(b, 'owner@example.com');
    assert.equal(res.ok, false, name);
    assert.equal(res.error, 'signin', name);
    assert.equal(res.session, undefined, name);
  }
});

test('a verified Google account that is not on the Admins tab is refused and logged once per 10 minutes', () => {
  const b = setup();
  const res = signIn(b, 'stranger@example.com');
  assert.equal(res.error, 'not_listed');
  assert.equal(res.email, 'stranger@example.com');
  signIn(b, 'stranger@example.com');
  const denied = b.tab('Audit').objects().filter(r => r.Action === 'signin.denied');
  assert.equal(denied.length, 1);
  assert.equal(denied[0].Who, 'stranger@example.com');
});

test('inactive members and unknown roles (including prototype keys) are refused', () => {
  const b = setup();
  assert.equal(signIn(b, 'former@example.com').error, 'not_listed');
  assert.equal(signIn(b, 'sneaky@example.com').error, 'not_listed', 'Role "constructor" must not resolve to Object.prototype.constructor');
});

test('an owner signs in: session issued, only its hash cached, sign-in stamped and audited', () => {
  const b = setup();
  const res = signIn(b, 'owner@example.com');
  assert.equal(res.ok, true);
  assert.match(res.session, /^[0-9a-f]{64}$/);
  assert.equal(res.expiresIn, 21600);
  assert.deepEqual(res.me.role, 'owner');
  const keys = [...b.cache.map.keys()].filter(k => k.startsWith('adm:'));
  assert.deepEqual(keys, ['adm:' + b.sha256(res.session)], 'raw session key is never stored');
  assert.equal(b.cache.map.get(keys[0]).ttl, 21600);
  const owner = b.tab('Admins').objects()[0];
  assert.ok(owner['Last sign-in'], 'Last sign-in stamped');
  assert.equal(b.tab('Audit').objects().at(-1).Action, 'signin');
  for (const k of ['dash', 'households', 'payments', 'entries', 'audit']) assert.ok(k in res.data, 'owner sees ' + k);
});

test('a bad or missing session key gets error "session"', () => {
  const b = setup();
  for (const session of [undefined, '', 'short', 'f'.repeat(64)]) {
    assert.equal(b.post({ action: 'admin', op: 'snapshot', session }).error, 'session');
  }
});

test('removing a member (untick Active) locks them out on their next call', () => {
  const b = setup();
  const { session } = signIn(b, 'treasurer@example.com');
  assert.equal(b.post({ action: 'admin', op: 'snapshot', session }).ok, true);
  b.tab('Admins').put(3, 4, false);
  assert.equal(b.post({ action: 'admin', op: 'snapshot', session }).error, 'session');
});

test('roles see only what they need (least privilege)', () => {
  const b = setup();
  const seen = email => Object.keys(signIn(b, email).data).filter(k => ['households', 'payments', 'entries', 'audit'].includes(k)).sort();
  assert.deepEqual(seen('treasurer@example.com'), ['households', 'payments']);
  assert.deepEqual(seen('coord@example.com'), ['entries', 'households']);
  assert.deepEqual(seen('viewer@example.com'), []);
});

test('roles cannot act outside their permissions', () => {
  const b = setup();
  const as = email => signIn(b, email).session;
  const viewer = as('viewer@example.com'), coord = as('coord@example.com'), treas = as('treasurer@example.com');
  assert.equal(b.post({ action: 'admin', op: 'payment.set', session: viewer, id: 'P-001', status: 'Confirmed' }).error, 'forbidden');
  assert.equal(b.post({ action: 'admin', op: 'payment.set', session: coord, id: 'P-001', status: 'Confirmed' }).error, 'forbidden');
  assert.equal(b.post({ action: 'admin', op: 'entry.visible', session: treas, id: 'E-001', visible: false }).error, 'forbidden');
  assert.equal(b.post({ action: 'admin', op: 'household.resend', session: viewer, id: 'H-AAA' }).error, 'forbidden');
  assert.equal(b.tab('Payments').objects()[0].Status, 'Reported', 'nothing was written');
});

test('treasurer confirms a payment: status, stamp, balance and audit all update', () => {
  const b = setup();
  const { session } = signIn(b, 'treasurer@example.com');
  const res = b.post({ action: 'admin', op: 'payment.set', session, id: 'P-001', status: 'Confirmed', expect: 'Reported' });
  assert.equal(res.ok, true, res.message);
  const pay = b.tab('Payments').objects()[0];
  assert.equal(pay.Status, 'Confirmed');
  assert.equal(pay['Confirmed by'], 'treasurer@example.com');
  assert.ok(pay['Confirmed on']);
  const ann = res.data.households.find(h => h.id === 'H-AAA');
  assert.equal(ann.due, 250);         // 2 adults × 100 + 1 child × 50
  assert.equal(ann.confirmed, 150);
  assert.equal(ann.balance, 100);
  assert.equal(ann.status, 'Partially paid');
  assert.equal(res.data.dash.toReview, 0);
  const a = b.tab('Audit').objects().at(-1);
  assert.equal(a.Action, 'payment.confirm');
  assert.equal(a.Target, 'P-001');
  assert.match(a.Detail, /Reported → Confirmed/);
});

test('optimistic concurrency: a decision on a stale screen writes nothing and returns fresh data', () => {
  const b = setup();
  const { session } = signIn(b, 'treasurer@example.com');
  const res = b.post({ action: 'admin', op: 'payment.set', session, id: 'P-002', status: 'Not received', expect: 'Reported' });
  assert.equal(res.error, 'stale');
  assert.equal(b.tab('Payments').objects()[1].Status, 'Confirmed');
  assert.ok(res.data.payments, 'fresh list attached');
});

test('moving a payment back to review clears who/when it was decided', () => {
  const b = setup();
  const { session } = signIn(b, 'owner@example.com');
  const res = b.post({ action: 'admin', op: 'payment.set', session, id: 'P-002', status: 'Reported', expect: 'Confirmed' });
  assert.equal(res.ok, true);
  const pay = b.tab('Payments').objects()[1];
  assert.equal(pay.Status, 'Reported');
  assert.equal(pay['Confirmed on'], '');
  assert.equal(pay['Confirmed by'], '');
  assert.equal(b.tab('Audit').objects().at(-1).Action, 'payment.reopen');
});

test('payment.set rejects unknown statuses and unknown payments', () => {
  const b = setup();
  const { session } = signIn(b, 'owner@example.com');
  assert.equal(b.post({ action: 'admin', op: 'payment.set', session, id: 'P-001', status: 'Paid' }).error, 'invalid');
  assert.equal(b.post({ action: 'admin', op: 'payment.set', session, id: 'P-404', status: 'Confirmed' }).error, 'missing');
});

test('coordinator hides and re-shows an entry; non-boolean input is refused', () => {
  const b = setup();
  const { session } = signIn(b, 'coord@example.com');
  assert.equal(b.post({ action: 'admin', op: 'entry.visible', session, id: 'E-002', visible: 'no' }).error, 'invalid');
  const hid = b.post({ action: 'admin', op: 'entry.visible', session, id: 'E-002', visible: false });
  assert.equal(hid.ok, true);
  assert.equal(b.tab('Entries').objects()[1].Visible, false);
  assert.equal(hid.data.entries.find(e => e.id === 'E-002').visible, false);
  // the family pages stop showing it
  const fam = b.post({ action: 'family', code: 'roots' });
  assert.deepEqual(fam.entries.map(e => e.id), ['E-001']);
  b.post({ action: 'admin', op: 'entry.visible', session, id: 'E-002', visible: true });
  assert.equal(b.tab('Entries').objects()[1].Visible, true);
});

test('resending a household link rotates their token, emails them, and throttles repeats', () => {
  const b = setup();
  const { session } = signIn(b, 'treasurer@example.com');
  const before = b.tab('Registrations').objects()[0]['Token hash'];
  const res = b.post({ action: 'admin', op: 'household.resend', session, id: 'H-AAA' });
  assert.equal(res.ok, true, res.message);
  assert.equal(b.mail.length, 1);
  assert.equal(b.mail[0].to, 'ann@example.com');
  assert.notEqual(b.tab('Registrations').objects()[0]['Token hash'], before);
  assert.equal(b.post({ action: 'admin', op: 'household.resend', session, id: 'H-AAA' }).error, 'busy');
  assert.equal(b.mail.length, 1);
});

test('sign-out ends the session', () => {
  const b = setup();
  const { session } = signIn(b, 'owner@example.com');
  assert.equal(b.post({ action: 'admin', op: 'signout', session }).ok, true);
  assert.equal(b.post({ action: 'admin', op: 'snapshot', session }).error, 'session');
});

test('family-typed text cannot become a formula in the Audit tab', () => {
  const b = setup();
  const { session } = signIn(b, 'owner@example.com');
  b.post({ action: 'admin', op: 'household.resend', session, id: 'H-CCC' });
  const detail = b.tab('Audit').objects().at(-1).Detail;
  assert.ok(detail.startsWith("'"), 'leading quote keeps =HYPERLINK as text: ' + detail);
});

test('dashboard tallies are right, and branch names like __proto__ count as plain text', () => {
  const b = setup();
  const { data } = signIn(b, 'viewer@example.com');
  const d = data.dash;
  assert.equal(d.households, 3);
  assert.equal(d.adults, 4);
  assert.equal(d.children, 1);
  assert.equal(d.toReview, 1);
  assert.deepEqual(d.days, [['Fri Jul 2', 5], ['Sat Jul 3', 5], ['Sun Jul 4', 3], ['Mon Jul 5', 0]]);
  assert.deepEqual(Object.fromEntries(d.branches), { 'Lewis: Mary': 1, 'constructor': 1, ['__proto__']: 1 });   // computed key: a plain '__proto__': literal would set the prototype
  assert.deepEqual(Object.fromEntries(d.shirts), { M: 1, L: 1, 'Youth S': 1, XL: 1 });
  assert.deepEqual(d.diet, [['Vegan', 1]]);
  assert.equal(d.hotelHouseholds, 2);
  assert.equal(d.hotelNights, 6);
});

test('setup() creates the Admins and Audit tabs, seeds the first owner, and adds the googleClientId key', () => {
  const tabs = fixture({ noClientId: true });
  delete tabs.Admins;
  const b = makeBackend({ tabs, effectiveUser: 'First.Owner@Example.com' });
  b.ctx.setup();
  const admins = b.tab('Admins');
  assert.deepEqual(admins.data[0], ADM_HEAD);
  const first = admins.objects();
  assert.equal(first.length, 1);
  assert.equal(first[0].Email, 'first.owner@example.com');
  assert.equal(first[0].Role, 'owner');
  assert.equal(first[0].Active, true);
  assert.ok(admins.validations.some(v => v.rule.checkbox), 'Active is a checkbox column');
  assert.ok(admins.validations.some(v => v.rule.list && v.rule.list.includes('treasurer')), 'Role is a dropdown');
  assert.ok(b.tab('Audit'), 'Audit tab created');
  assert.ok(b.tab('Config').objects().some(r => r.Key === 'googleClientId'));
  b.ctx.setup();   // idempotent
  assert.equal(b.tab('Admins').objects().length, 1);
  assert.equal(b.tab('Config').objects().filter(r => r.Key === 'googleClientId').length, 1);
});

test('regression: the family "mine" view still parses attendees after the shared parser refactor', () => {
  const b = setup();
  const r = b.post({ action: 'register', code: 'roots', reg: { first: 'Gail', last: 'Lewis', email: 'gail@example.com', city: 'Fresno', state: 'CA',
    branch: 'Lewis: Mary', days: ['fri'], arrive: '2027-07-02', depart: '2027-07-05',
    attendees: [{ name: 'Gail Lewis', band: 'adult', shirt: 'M' }, { name: 'Kid Lewis', band: 'child', age: '9', shirt: 'Youth M' }] } });
  assert.equal(r.ok, true, r.message);
  const mine = b.post({ action: 'mine', code: 'roots', token: r.token });
  assert.deepEqual(mine.mine.reg.attendees, [
    { name: 'Gail Lewis', band: 'adult', age: '', shirt: 'M' },
    { name: 'Kid Lewis', band: 'child', age: '9', shirt: 'Youth M' }
  ]);
  assert.equal(mine.mine.summary.due, 150);
});
