/* Review pages (review/): the private key, the bar at the top, and saving to the Reviews tab in the Sheet.
   Loaded in <head> of every review page, after ../config.js. The committee pages it reuses keep their own state in
   localStorage under STATE; this file copies that state to and from the backend (actions review and reviewSave), so
   the reviewer can stop and come back on any device, and the committee sees each change in the Sheet. */
(function () {
  'use strict';
  var STATE = { order: 'lewis-homepage-order-v1', wording: 'lewis-email-wording-v1' };
  var KEY_STORE = 'lr-review-key', SYNCED = 'lr-review-synced', SYNCED_FOR = 'lr-review-synced-for', RELOADED = 'lr-review-reloaded';
  var PAGES = [['index.html', 'Start', 'home'], ['sample.html', '1. Sample', 'sample'], ['order.html', '2. <span class="rv-long">Homepage </span>order', 'order'],
    ['wording.html', '3. Email<span class="rv-long"> wording</span>', 'wording']];
  var page = document.documentElement.getAttribute('data-review') || 'home';
  // The backup for when this page can't reach the website: a Google Sheet with the same tables, shared with the reviewer.
  var BACKUP = 'https://docs.google.com/spreadsheets/d/1dibJT8-1s4UtKp-QocN5Q3z8m5HFxCYM6w94IhsOJRI/edit';
  var BACKUP_LINK = '<a href="' + BACKUP + '" target="_blank" rel="noopener" style="color:inherit">use the backup Google Sheet</a>';
  var api = window.LR && window.LR.apiUrl;
  var ls = window.localStorage;

  function get(k) { try { return ls.getItem(k); } catch (e) { return null; } }
  function set(k, v) { try { if (v == null) ls.removeItem(k); else ls.setItem(k, v); } catch (e) {} }

  // The key arrives once in the link, as #vincent (or the older #k=<32 hex>), is kept on this device, and is taken out
  // of the address bar.
  var m = /^#(?:k=)?([a-zA-Z0-9][a-zA-Z0-9-]{1,63})$/.exec(location.hash);
  if (m) {
    set(KEY_STORE, m[1].toLowerCase());
    try { history.replaceState(null, '', location.pathname + location.search); } catch (e) {}
  }
  var key = get(KEY_STORE);

  // What the Sheet last had, so a page this device has not opened yet (nothing stored here) never blanks it.
  var base = {};
  function dataNow() { var d = {}; Object.keys(STATE).forEach(function (k) { var v = get(STATE[k]); d[k] = v != null ? v : (base[k] != null ? base[k] : null); }); return d; }
  function json(d) { return JSON.stringify(d); }
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
      return t.replace(/^(Homepage order|Email wording) from .*$/m, '$1 from ' + (reviewer || 'the reviewer'));
    } catch (e) { return null; }
  }

  var lastSaved = null, saving = false, changedAt = 0, retryAt = 0, ready = false;
  // The sample (1. Sample) has nothing to edit: it only shows the saved review, so it never saves on its own.
  var readOnly = page === 'sample';
  /* Tells the page what the review holds now (lr-review-data), so the sample can draw it. */
  function emit(saved) {
    try { document.dispatchEvent(new CustomEvent('lr-review-data', { detail: { name: reviewer, data: dataNow(), saved: saved || null } })); } catch (e) {}
  }
  function save() {
    var d = dataNow(), j = json(d), body = { action: 'reviewSave', key: key, data: d };
    var text = readable();
    if (page === 'order' && text != null) body.order = text;
    if (page === 'wording' && text != null) body.wording = text;
    saving = true; say('Saving…');
    post(body).then(function (r) {
      saving = false;
      if (r && r.ok) { lastSaved = j; base = d; set(SYNCED, j); set(SYNCED_FOR, key); retryAt = 0; say('All changes saved at ' + time(r.saved) + '.'); }
      else { retryAt = Date.now() + 15000; say((r && r.message) || 'Not saved yet. Trying again soon.', true); }
    }, function () {
      saving = false; retryAt = Date.now() + 10000;
      say('Not saved yet: no connection. Your changes are kept on this device and will save when you are back online.', true);
    });
  }
  function tick() {
    if (!ready || saving || readOnly) return;
    var j = json(dataNow());
    if (j === lastSaved) return;
    if (!changedAt) { changedAt = Date.now(); say('Saving…'); }
    if (Date.now() - changedAt < 1200 || Date.now() < retryAt) return;
    changedAt = 0; save();
  }
  function beacon() {
    if (readOnly || !ready || json(dataNow()) === lastSaved || !navigator.sendBeacon) return;
    var body = { action: 'reviewSave', key: key, data: dataNow() }, text = readable();
    if (page === 'order' && text != null) body.order = text;
    if (page === 'wording' && text != null) body.wording = text;
    try { navigator.sendBeacon(api, new Blob([JSON.stringify(body)], { type: 'text/plain;charset=utf-8' })); } catch (e) {}
  }

  function load() {
    if (!api) { say('The review page cannot reach the website right now.', true); return; }
    if (!key) {
      block('<b>This page needs your private review link.</b><br>Please open it from the email Alex sent you, or ' + BACKUP_LINK + '.');
      say('Not connected', true); return;
    }
    say('Opening your saved changes…');
    post({ action: 'review', key: key }).then(function (r) {
      if (!r || !r.ok) {
        if (r && r.error === 'review') { block('<b>This review link is not working.</b><br>Please ask Alex for a new one, or ' + BACKUP_LINK + ' for now.'); say('Not connected', true); }
        else say((r && r.message) || 'Could not open your saved changes. Please reload the page.', true, true);
        return;
      }
      reviewer = r.name || '';
      var who = document.querySelectorAll('[data-rv-name]');
      for (var i = 0; i < who.length; i++) who[i].textContent = reviewer || 'there';
      var server = r.data || {};
      Object.keys(STATE).forEach(function (k) { if (server[k] != null) base[k] = server[k]; });
      var local = dataNow(), synced = get(SYNCED_FOR) === key ? get(SYNCED) : null;
      // Right after this page reloaded itself to show the saved state, the page may have tidied that state: not a change.
      var justReloaded = Date.now() - Number(sessionStorage.getItem(RELOADED) || 0) < 15000;
      if (synced != null && json(local) !== synced && !justReloaded) {
        // Changes made here that never reached the Sheet (for example offline): this device wins.
        ready = true; save(); emit(); return;
      }
      // A page the reviewer has not saved yet (null on the server) keeps what this device shows.
      var newer = Object.keys(STATE).filter(function (k) { return server[k] != null && server[k] !== get(STATE[k]); });
      if (newer.length) {
        newer.forEach(function (k) { set(STATE[k], server[k]); });
        set(SYNCED, json(dataNow())); set(SYNCED_FOR, key);
        if ((page === 'order' || page === 'wording') && !justReloaded) {
          sessionStorage.setItem(RELOADED, String(Date.now()));
          location.reload(); return;
        }
      }
      lastSaved = json(dataNow()); set(SYNCED, lastSaved); set(SYNCED_FOR, key);
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
      var server = r.data || {};
      // Changes made on this device that have not reached the Sheet yet (offline) stay; 2. Homepage order saves them.
      var pending = get(SYNCED_FOR) === key && get(SYNCED) != null && get(SYNCED) !== json(dataNow());
      if (!pending) Object.keys(STATE).forEach(function (k) { if (server[k] != null) { base[k] = server[k]; set(STATE[k], server[k]); } });
      lastSaved = json(dataNow());
      if (!pending) { set(SYNCED, lastSaved); set(SYNCED_FOR, key); }
      say('Up to date with the saved review. Checked at ' + time() + '.');
      emit(r.saved);
    }, function () { polling = false; say('Could not check for new changes. Trying again in a moment.', true); });
  }

  function build() {
    bar = document.createElement('nav');
    bar.className = 'rv-bar'; bar.setAttribute('aria-label', 'Review pages');
    bar.innerHTML = '<div class="rv-in"><span class="rv-brand">Lewis ’27 review</span><span class="rv-tabs">' +
      PAGES.map(function (p) { return '<a href="' + p[0] + '"' + (p[2] === page ? ' aria-current="page"' : '') + '>' + p[1] + '</a>'; }).join('') +
      '</span><span class="rv-status" role="status" aria-live="polite"></span></div>';
    document.body.insertBefore(bar, document.body.firstChild);
    status = bar.querySelector('.rv-status');
    cover = document.createElement('div'); cover.className = 'rv-cover'; cover.hidden = true;
    document.body.appendChild(cover);
    // Save before moving to another review page, so nothing is lost between pages.
    bar.addEventListener('click', function (e) {
      var a = e.target.closest && e.target.closest('a'); if (!a || !ready || readOnly || json(dataNow()) === lastSaved) return;
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
    document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'hidden') beacon(); });
    window.addEventListener('pagehide', beacon);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', build); else build();
})();
