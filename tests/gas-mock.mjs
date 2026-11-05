/* In-memory stand-ins for the Google Apps Script services Code.gs uses, so the backend can run under `node --test`.
   Only the calls Code.gs makes are modelled. Sheets are plain 2-D arrays; row 1 holds the headers. */
import { readFileSync } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import vm from 'node:vm';

const CODE = readFileSync(new URL('../apps-script/Code.gs', import.meta.url), 'utf8');

class Range {
  constructor(sheet, row, col, rows = 1, cols = 1) { Object.assign(this, { sheet, row, col, rows, cols }); }
  getValues() {
    const out = [];
    for (let r = 0; r < this.rows; r++) {
      const line = this.sheet.data[this.row - 1 + r] || [];
      out.push(Array.from({ length: this.cols }, (_, c) => line[this.col - 1 + c] ?? ''));
    }
    return out;
  }
  getValue() { return this.getValues()[0][0]; }
  setValues(v) {
    v.forEach((line, r) => line.forEach((val, c) => this.sheet.put(this.row + r, this.col + c, val)));
    return this;
  }
  setValue(v) { return this.setValues([[v]]); }
  setNumberFormat() { return this; }
  setFontWeight() { return this; }
  setDataValidation(rule) { this.sheet.validations.push({ row: this.row, col: this.col, rows: this.rows, rule }); return this; }
  getRow() { return this.row; }
  getColumn() { return this.col; }
  getLastRow() { return this.row + this.rows - 1; }
  getLastColumn() { return this.col + this.cols - 1; }
  getSheet() { return this.sheet; }
}

class Sheet {
  constructor(name, rows = []) { this.name = name; this.data = rows.map(r => r.slice()); this.validations = []; }
  getName() { return this.name; }
  put(row, col, val) {
    while (this.data.length < row) this.data.push([]);
    const line = this.data[row - 1];
    while (line.length < col) line.push('');
    line[col - 1] = val;
  }
  getLastRow() {
    for (let i = this.data.length; i > 0; i--) if (this.data[i - 1].some(v => v !== '' && v != null)) return i;
    return 0;
  }
  getLastColumn() { return Math.max(0, ...this.data.map(r => r.length)); }
  getRange(row, col, rows = 1, cols = 1) { return new Range(this, row, col, rows, cols); }
  getDataRange() { return new Range(this, 1, 1, Math.max(1, this.getLastRow()), Math.max(1, this.getLastColumn())); }
  appendRow(values) { this.data.splice(this.getLastRow(), 0, values.slice()); return this; }
  setFrozenRows() { return this; }
  /** Rows as header-keyed objects, for assertions. */
  objects() {
    const [head, ...rest] = this.data;
    return rest.filter(r => r.some(v => v !== '' && v != null)).map(r => Object.fromEntries(head.map((h, i) => [h, r[i] ?? ''])));
  }
}

class Cache {
  constructor() { this.map = new Map(); }
  get(k) { return this.map.has(k) ? this.map.get(k).v : null; }
  put(k, v, ttl) { this.map.set(k, { v: String(v), ttl }); }
  remove(k) { this.map.delete(k); }
}

const ruleBuilder = () => {
  const rule = {};
  const b = {
    requireValueInList(list) { rule.list = list; return b; },
    requireCheckbox() { rule.checkbox = true; return b; },
    setAllowInvalid(x) { rule.allowInvalid = x; return b; },
    build() { return rule; }
  };
  return b;
};

/**
 * Builds a fresh backend: `tabs` maps tab name → rows (row 1 = headers).
 * `tokeninfo(credential)` returns { code, body } for Google's verification endpoint.
 */
export function makeBackend({ tabs, tokeninfo = () => ({ code: 400, body: '{}' }), effectiveUser = 'owner@example.com' }) {
  const sheets = new Map(Object.entries(tabs).map(([name, rows]) => [name, new Sheet(name, rows)]));
  const cache = new Cache();
  const mail = [], fetches = [];
  const ss = {
    getSheetByName: n => sheets.get(n) || null,
    insertSheet: n => { const s = new Sheet(n); sheets.set(n, s); return s; },
    getId: () => 'SPREADSHEET'
  };
  const sandbox = {
    console: { log() {}, warn() {}, error() {} },
    SpreadsheetApp: { getActive: () => ss, newDataValidation: ruleBuilder, getUi: () => ({}) },
    CacheService: { getScriptCache: () => cache },
    UrlFetchApp: {
      fetch(url) {
        fetches.push(url);
        const m = /[?&]id_token=([^&]*)/.exec(url);
        const { code, body } = tokeninfo(m ? decodeURIComponent(m[1]) : '');
        return { getResponseCode: () => code, getContentText: () => body };
      }
    },
    LockService: { getScriptLock: () => ({ tryLock: () => true, releaseLock() {} }) },
    MailApp: { sendEmail: m => mail.push(m) },
    ContentService: {
      MimeType: { JSON: 'json', TEXT: 'text' },
      createTextOutput: s => ({ setMimeType() { return this; }, getContent: () => s })
    },
    Session: {
      getScriptTimeZone: () => 'America/Los_Angeles',
      getActiveUser: () => ({ getEmail: () => '' }),
      getEffectiveUser: () => ({ getEmail: () => effectiveUser })
    },
    DriveApp: { getFolderById: id => ({ getId: () => id, getUrl: () => 'https://drive.example/' + id }) },
    Utilities: {
      getUuid: () => randomUUID(),
      DigestAlgorithm: { SHA_256: 'sha256' },
      Charset: { UTF_8: 'utf8' },
      computeDigest: (alg, s) => Array.from(createHash(alg).update(String(s), 'utf8').digest()).map(b => (b > 127 ? b - 256 : b)),
      formatDate: d => d.toISOString().slice(0, 10)
    }
  };
  const ctx = vm.createContext(sandbox);
  vm.runInContext(CODE, ctx, { filename: 'Code.gs' });
  /** Same-realm JSON copy, so assert.deepStrictEqual works on values built inside the VM. */
  const plain = v => JSON.parse(JSON.stringify(v));
  return {
    ctx, sheets, cache, mail, fetches, plain,
    tab: n => sheets.get(n),
    post: body => plain(JSON.parse(ctx.doPost({ postData: { contents: JSON.stringify(body) } }).getContent())),
    get: params => JSON.parse(ctx.doGet({ parameter: params }).getContent()),
    sha256: s => createHash('sha256').update(s, 'utf8').digest('hex'),
    date: iso => vm.runInContext(`new Date(${JSON.stringify(iso)})`, ctx)
  };
}
