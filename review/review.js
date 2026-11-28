/* Review pages (review/): the private key, the bar at the top, and saving to the Reviews tab in the Sheet.
   Loaded in <head> of every review page, after ../config.js. The committee pages it reuses keep their own state in
   localStorage under STATE; this file copies that state to and from the backend (actions review and reviewSave), so
   the reviewer can stop and come back on any device, and the committee sees each change in the Sheet. */
(function () {
  'use strict';
  var STATE = { order: 'lewis-homepage-order-v1', wording: 'lewis-email-wording-v1', register: 'lewis-registration-wording-v1' };
  var KEY_STORE = 'lr-review-key', SYNCED = 'lr-review-synced', SYNCED_FOR = 'lr-review-synced-for';   // the last two: older version of this page
  var PAGES = [['index.html', 'Start', 'home'], ['sample.html', '1. Sample', 'sample'], ['order.html', '2. <span class="rv-long">Homepage </span>order', 'order'],
    ['wording.html', '3. Email<span class="rv-long"> wording</span>', 'wording'], ['register.html', '4. <span class="rv-long">Registration</span><span class="rv-short">Register</span>', 'register']];
  var page = document.documentElement.getAttribute('data-review') || 'home';
  // The backup for when this page can't reach the website: a Google Sheet with the same tables, shared with the reviewer.
  var BACKUP = 'https://docs.google.com/spreadsheets/d/1dibJT8-1s4UtKp-QocN5Q3z8m5HFxCYM6w94IhsOJRI/edit';
  var BACKUP_LINK = '<a href="' + BACKUP + '" target="_blank" rel="noopener" style="color:inherit">use the backup Google Sheet</a>';
  var api = window.LR && window.LR.apiUrl;
  var ls = window.localStorage;

  function get(k) { try { return ls.getItem(k); } catch (e) { return null; } }
  function set(k, v) { try { if (v == null) ls.removeItem(k); else ls.setItem(k, v); } catch (e) {} }

  /* The key comes in the link as #vincent (or the older #k=<32 hex>) and is kept on this device. It also stays in the
     address bar and in every link between the review pages, so a reload, a bookmark, a new tab, or a phone that has cleared
     the page's storage still opens this review. A place on the page (#welcome, #me) is never taken for a key: before this,
     a reload after tapping such a link replaced the key with the place's name and every page said the link was not
     working. A tap on a link to a place scrolls there without changing the address; a link to a place on another review
     page says it with ?at=<place>. Read when the page is built (findKey), once the places on it exist. */
  var KEY_RE = /^#(?:k=)?([a-zA-Z0-9][a-zA-Z0-9-]{1,63})$/;
  var key = null, landing = null;
  function placeOf(h) {
    var id = String(h || '').replace(/^#/, '');
    try { id = decodeURIComponent(id); } catch (e) {}
    return id ? document.getElementById(id) : null;
  }
  function findKey() {
    var m = KEY_RE.exec(location.hash), spot = location.hash.length > 1 ? placeOf(location.hash) : null;
    if (m && !spot) set(KEY_STORE, m[1].toLowerCase());
    key = get(KEY_STORE);
    var at = null, search = location.search;
    try { var q = new URLSearchParams(search); at = q.get('at'); q.delete('at'); search = q.toString() ? '?' + q.toString() : ''; } catch (e) {}
    landing = spot || (at ? placeOf(at) : null);
    try { history.replaceState(history.state, '', location.pathname + search + (key ? '#' + key : '')); } catch (e) {}
  }
  /* Links to the other review pages carry the key; a place named after # in such a link moves to ?at=. */
  function keyLinks() {
    if (!key) return;
    Array.prototype.forEach.call(document.querySelectorAll('a[href]'), function (a) {
      var href = a.getAttribute('href') || '', u;
      if (href.charAt(0) === '#' || /^[a-z]+:/i.test(href) && !/^https?:/i.test(href)) return;
      try { u = new URL(href, location.href); } catch (e) { return; }
      if (u.origin !== location.origin || !/\/review\/(?:[\w-]+\.html)?$/.test(u.pathname)) return;
      if (u.hash.length > 1) u.searchParams.set('at', u.hash.slice(1));
      u.hash = key;
      a.setAttribute('href', u.href);
    });
  }
  function goTo(el, smooth) {
    var top = el.getBoundingClientRect().top + window.pageYOffset - (bar ? bar.offsetHeight : 0) - 10;
    try { window.scrollTo({ top: Math.max(0, top), behavior: smooth ? 'smooth' : 'auto' }); } catch (e) { window.scrollTo(0, Math.max(0, top)); }
  }

  /* Each editing page owns one part of the review and only ever saves that part. BASE (per part) is what the Sheet held when
     this device last agreed with it, and its rev. The backend refuses a save whose rev is out of date; the changes made
     here since BASE are then merged into the newer copy, field by field, so no tab or device can undo another's work. */
  var part = STATE[page] ? page : null;
  var BASE = 'lr-review-base-';
  var startLocal = part ? get(STATE[part]) : null;      // before the page's own script tidies it
  var base = { rev: -1, value: null };

  function isObj(o) { return o && typeof o === 'object' && !Array.isArray(o); }
  /* A part as flat fields: { 'words/why/p1': '...', layout: {...} }. Null when there is nothing (or nothing readable).
     The email wording and the registration pages already keep flat fields. */
  function flatPart(p) { return p === 'wording' || p === 'register'; }
  function flat(p, str) {
    var o; try { o = str == null ? null : JSON.parse(str); } catch (e) { o = null; }
    if (!isObj(o)) return null;
    var f = {};
    if (flatPart(p)) { Object.keys(o).forEach(function (k) { f[k] = o[k]; }); return f; }
    ['who', 'other'].forEach(function (k) { if (o[k]) f[k] = o[k]; });
    Object.keys(o.notes || {}).forEach(function (k) { f['notes/' + k] = o.notes[k]; });
    Object.keys(o.words || {}).forEach(function (k) { Object.keys(o.words[k] || {}).forEach(function (w) { f['words/' + k + '/' + w] = o.words[k][w]; }); });
    if (o.page) f.layout = { page: o.page, tray: o.tray || [] };
    if (o.tiles) f.tiles = o.tiles;
    return f;
  }
  function unflat(p, f) {
    if (flatPart(p)) return JSON.stringify(f);
    var o = { who: f.who || '', other: f.other || '', notes: {}, words: {} };
    Object.keys(f).forEach(function (k) {
      var b = k.split('/');
      if (b[0] === 'notes') o.notes[b[1]] = f[k];
      if (b[0] === 'words') { o.words[b[1]] = o.words[b[1]] || {}; o.words[b[1]][b[2]] = f[k]; }
    });
    if (f.layout) { o.page = f.layout.page; o.tray = f.layout.tray; }
    if (f.tiles) o.tiles = f.tiles;
    return JSON.stringify(o);
  }
  function canon(p, str) {
    var f = flat(p, str);
    return f ? JSON.stringify(Object.keys(f).sort().map(function (k) { return [k, f[k]]; })) : '';
  }
  /* The server's copy with this device's changes since `was` put on top. `careful`: `was` comes from the older version of this
     page, which could record it wrongly, so a missing field or a different section order is not taken as a change. */
  function merge(p, was, local, server, careful) {
    var S = flat(p, server), L = flat(p, local), B = flat(p, was);
    if (!S) return local;
    if (!L || !B) return server;
    var seen = {};
    Object.keys(B).concat(Object.keys(L)).forEach(function (k) {
      if (seen[k]) return; seen[k] = 1;
      if (JSON.stringify(L[k]) === JSON.stringify(B[k])) return;
      if (careful && (L[k] === undefined || k === 'layout' || k === 'tiles')) return;
      if (L[k] === undefined) delete S[k]; else S[k] = L[k];
    });
    return unflat(p, S);
  }
  function storedBase(p) {
    try {
      var b = JSON.parse(get(BASE + p) || 'null');
      if (b && b.key === key) return b;
      if (!b && get(SYNCED_FOR) === key) return { rev: -1, value: JSON.parse(get(SYNCED) || '{}')[p], careful: true };
    } catch (e) {}
    return { rev: -1, value: null };
  }
  function setBase(p, data) {
    base = { key: key, rev: Number(data && data.rev && data.rev[p]) || 0, value: data && data[p] != null ? data[p] : null };
    set(BASE + p, JSON.stringify(base));
  }
  function post(body) {
    return fetch(api, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(body) })
      .then(function (r) { return r.json(); });
  }

  var bar, status, cover, reviewer = '';
  function say(text, bad, backup) {
    if (!status) return;
    status.textContent = text;
    if (backup) { status.appendChild(document.createTextNode(' Or ')); status.insertAdjacentHTML('beforeend', BACKUP_LINK + '.'); }
    status.className = 'rv-status' + (bad ? ' bad' : '');
  }
  function block(html) { if (!cover) return; cover.innerHTML = '<div>' + html + '</div>'; cover.hidden = false; }
  function time(iso) {
    var d = iso ? new Date(iso) : new Date();
    return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  }

  /* The readable copy for the Sheet, from the page's own compose(), with the reviewer's name on the first line. */
  function readable() {
    if (typeof window.compose !== 'function') return null;
    try {
      var t = String(window.compose().text || '');
      return t.replace(/^(Homepage order|Email wording|Registration pages) from .*$/m, '$1 from ' + (reviewer || 'the reviewer'));
    } catch (e) { return null; }
  }

  var lastSaved = null, saving = false, changedAt = 0, retryAt = 0, ready = false, leaving = false;
  // The sample (1. Sample) has nothing to edit: it only shows the saved review, so it never saves on its own.
  var readOnly = page === 'sample';
  var server = {};
  /* Tells the page what the review holds now (lr-review-data): the saved review, plus changes on this device not saved yet,
     for every part. The sample draws the homepage from it; the other pages show words that are changed on another page. */
  function emit(saved) {
    var d = {};
    Object.keys(server).forEach(function (k) { d[k] = server[k]; });
    Object.keys(STATE).forEach(function (p) {
      var own = storedBase(p);
      if (own.value != null) d[p] = merge(p, own.value, get(STATE[p]), server[p], own.careful);
    });
    try { document.dispatchEvent(new CustomEvent('lr-review-data', { detail: { name: reviewer, data: d, saved: saved || null } })); } catch (e) {}
  }
  function now() { return part ? get(STATE[part]) : null; }
  function dirty() { return !!part && ready && !leaving && now() != null && canon(part, now()) !== lastSaved; }
  function body() {
    var b = { action: 'reviewPart', key: key, part: part, value: now(), rev: base.rev }, text = readable();
    if (text != null) b.text = text;
    return b;
  }
  /* Puts `value` on this device and draws the page again from it. At once, so nothing typed into the older copy follows. */
  function redraw(value) {
    set(STATE[part], value);
    leaving = true;
    if (get(STATE[part]) === value) location.reload();
    else say('This browser is not keeping your changes. Please try another browser, or a window that is not private.', true, true);
  }
  function save() {
    var b = body(), c = canon(part, b.value);
    saving = true; say('Saving…');
    post(b).then(function (r) {
      saving = false;
      if (r && r.ok) {
        var d = { rev: {} }; d.rev[part] = r.rev; d[part] = b.value; setBase(part, d);
        lastSaved = c; retryAt = 0; say('All changes saved at ' + time(r.saved) + '.');
      } else if (r && r.error === 'conflict' && r.data) {
        var local = now(), m = merge(part, base.value, local, r.data[part]);
        setBase(part, r.data);
        if (canon(part, m) !== canon(part, local)) redraw(m);
        else { lastSaved = canon(part, base.value); retryAt = 0; changedAt = 0; }
      } else { retryAt = Date.now() + 15000; say((r && r.message) || 'Not saved yet. Trying again soon.', true); }
    }, function () {
      saving = false; retryAt = Date.now() + 10000;
      say('Not saved yet: no connection. Your changes are kept on this device and will save when you are back online.', true);
    });
  }
  function tick() {
    if (saving || !dirty()) return;
    if (!changedAt) { changedAt = Date.now(); say('Saving…'); }
    if (Date.now() - changedAt < 1200 || Date.now() < retryAt) return;
    changedAt = 0; save();
  }
  function beacon() {
    if (!dirty() || !navigator.sendBeacon) return;
    try { navigator.sendBeacon(api, new Blob([JSON.stringify(body())], { type: 'text/plain;charset=utf-8' })); } catch (e) {}
  }

  function load() {
    if (!api) { say('The review page cannot reach the website right now.', true); return; }
    if (!key) {
      block('<b>This page needs your private review link.</b><br>Please open it from the email Alex sent you, or ' + BACKUP_LINK + '.');
      say('Not connected', true); return;
    }
    var opened = now() != null ? now() : '{}';          // what the page shows before anything is typed
    say('Opening your saved changes…');
    post({ action: 'review', key: key }).then(function (r) {
      if (!r || !r.ok) {
        if (r && r.error === 'review') { block('<b>This review link is not working.</b><br>Please ask Alex for a new one, or ' + BACKUP_LINK + ' for now.'); say('Not connected', true); }
        else say((r && r.message) || 'Could not open your saved changes. Please reload the page.', true, true);
        return;
      }
      // The registration pages need a backend that knows their part (v3); until it is deployed, nothing saves.
      if (!(r.v >= (part === 'register' ? 3 : 2))) { say('Saving is paused for a few minutes while this page is updated. Please reload it soon.', true, true); return; }
      reviewer = r.name || '';
      var who = document.querySelectorAll('[data-rv-name]');
      for (var i = 0; i < who.length; i++) who[i].textContent = reviewer || 'there';
      server = r.data || {};
      if (part) {
        var was = storedBase(part), cur = now(), sv = server[part] != null ? server[part] : null;
        // Anything typed while the saved copy was on its way counts as a change too.
        var local = startLocal == null ? (canon(part, cur) === canon(part, opened) ? null : cur) : merge(part, opened, cur, startLocal);
        var m = sv == null ? cur : merge(part, startLocal == null ? opened : was.value, local, sv, was.careful);
        setBase(part, server);
        if (sv != null && canon(part, m) !== canon(part, startLocal == null ? cur : local)) { redraw(m); return; }
        // The page tidying what it loaded is not a change; a real difference from the Sheet is. The email wording and the
        // registration pages keep only what was typed, so while the Sheet has none of that part yet, anything on this
        // device was typed here (perhaps while saving was paused) and is saved now.
        var typed = flatPart(part) && sv == null && Object.keys(flat(part, cur) || {}).length > 0;
        lastSaved = !typed && (sv == null || canon(part, m) === canon(part, sv)) ? canon(part, cur) : null;
      }
      ready = true;
      say(r.saved ? 'All changes saved. Last saved ' + new Date(r.saved).toLocaleDateString([], { month: 'short', day: 'numeric' }) + ' at ' + time(r.saved) + '.' : 'Ready. Your changes save by themselves.');
      emit(r.saved);
    }, function () { say('Could not reach the website. Check your connection, then reload the page.', true, true); });
  }

  /* The sample checks the Sheet again every 20 seconds while it is on screen, and as soon as the reviewer comes back to
     it, so it follows the review as it is saved from 2. Homepage order on any device. It only reads. */
  var POLL_MS = 20000, polledAt = 0, polling = false;
  function poll() {
    if (!readOnly || !ready || !key || polling || document.visibilityState === 'hidden' || Date.now() - polledAt < 3000) return;
    polling = true; polledAt = Date.now();
    post({ action: 'review', key: key }).then(function (r) {
      polling = false;
      if (!r || !r.ok) return;
      if (r.name) reviewer = r.name;
      server = r.data || {};
      say('Up to date with the saved review. Checked at ' + time() + '.');
      emit(r.saved);
    }, function () { polling = false; say('Could not check for new changes. Trying again in a moment.', true); });
  }

  function build() {
    findKey();
    bar = document.createElement('nav');
    bar.className = 'rv-bar'; bar.setAttribute('aria-label', 'Review pages');
    bar.innerHTML = '<div class="rv-in"><span class="rv-brand">Lewis ’27 review</span><span class="rv-tabs">' +
      PAGES.map(function (p) { return '<a href="' + p[0] + '"' + (p[2] === page ? ' aria-current="page"' : '') + '>' + p[1] + '</a>'; }).join('') +
      '</span><span class="rv-status" role="status" aria-live="polite"></span></div>';
    document.body.insertBefore(bar, document.body.firstChild);
    status = bar.querySelector('.rv-status');
    cover = document.createElement('div'); cover.className = 'rv-cover'; cover.hidden = true;
    document.body.appendChild(cover);
    keyLinks();
    // A tap on a link to a place on this page scrolls there; the address keeps the key.
    document.addEventListener('click', function (e) {
      var a = e.target.closest && e.target.closest('a[href^="#"]');
      if (!a || e.defaultPrevented || e.button || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      e.preventDefault();
      var spot = placeOf(a.getAttribute('href'));
      if (spot) goTo(spot, !(window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches));
    });
    if (landing) {
      var spot = landing;
      setTimeout(function () { goTo(spot, false); }, 0);
      // Fonts and pictures can still move things: land again once they are in, unless the reader has scrolled.
      var moved = false, off = function () { moved = true; };
      ['wheel', 'touchmove', 'keydown'].forEach(function (t) { window.addEventListener(t, off, { once: true, passive: true }); });
      window.addEventListener('load', function () { if (!moved) goTo(spot, false); });
    }
    // Save before moving to another review page, so nothing is lost between pages.
    bar.addEventListener('click', function (e) {
      var a = e.target.closest && e.target.closest('a'); if (!a || !dirty()) return;
      e.preventDefault(); save();
      var go = a.href, t0 = Date.now();
      (function wait() { if (!saving || Date.now() - t0 > 4000) location.href = go; else setTimeout(wait, 150); })();
    });
    load();
    setInterval(tick, 400);
    if (readOnly) {
      setInterval(poll, POLL_MS);
      document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'visible') poll(); });
      window.addEventListener('focus', poll);
      // 2. Homepage order open in another tab of this browser: show each change at once, before it reaches the Sheet.
      window.addEventListener('storage', function (e) { if (ready && e.key === STATE.order) emit(); });
    }
    /* The same page open in another tab of this browser shares this device's copy: when that tab changes it, draw this one
       again, so it never writes its older copy back. */
    var left = null;
    function again() { if (part && !leaving) { leaving = true; location.reload(); } }
    if (part) {
      window.addEventListener('storage', function (e) { if (e.key === STATE[part] && e.newValue != null && canon(part, e.newValue) !== canon(part, e.oldValue)) again(); });
      window.addEventListener('pageshow', function (e) { if (e.persisted) again(); });
    }
    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'hidden') { left = now(); beacon(); }
      else if (part && left != null && now() != null && canon(part, now()) !== canon(part, left)) again();
    });
    window.addEventListener('pagehide', beacon);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', build); else build();
})();
