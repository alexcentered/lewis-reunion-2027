/* Lewis–Antone family tree, folded into the reunion site's "Our Family" tab.
   Three views: Rings (a full circle of growth rings), Columns (browse one family at a time), Ledger (an indented family register that scrolls down the page).
   Colors come from the site's global palette (accent dots and Light / Forest / Espresso theme), so every view works with every color.
   People arrive from the backend only after the family code is accepted. */
(() => {
  'use strict';
  const $ = s => document.querySelector(s), $$ = s => [...document.querySelectorAll(s)];
  if (!window.FamilyTree || !$('#ftStage')) return;
  const el = FamilyTree.el;
  const VIEWS = ['rings', 'columns', 'ledger'];
  const saved = (() => { try { return localStorage.getItem('lr-treeview2'); } catch (e) { return null; } })();

  let people = new Map(), T = null, R = null, lines = [], activeLine = null, notes = [];
  let view = VIEWS.includes(saved) ? saved : 'rings';
  let colPath = [];   // columns view: [lineIndex, childId, grandchildId, ...]
  let open = new Set(); // ledger view: which founding lines ('L0'…) and people are expanded
  let hitSet = new Set();
  const centerable = () => view === 'rings';

  function ensure() {
    if (T) return;
    T = FamilyTree.create({
      stage: $('#ftStage'), svg: $('#ftSvg'), mode: 'tree',
      onSelect: id => {
        if (view === 'columns' && id) pathTo(id);
        if (view === 'ledger' && id) openTo(id);
        renderDrawer(); syncFocus();
        if (view === 'columns') renderColumns();
        if (view === 'ledger') renderLedger(true);
      },
      onZoom: k => { $('#ftZoom').textContent = Math.round(k * 100) + '%'; }
    });
    T.setCrown({ span: 360, trunk: false });
    wire();
  }

  function load(rows, noteRows) {
    ensure();
    people = new Map((rows || []).filter(p => p && p.id && p.name).map(p => [String(p.id), {
      id: String(p.id), name: String(p.name), nickname: p.nickname || '', born: p.born || '', place: p.place || '', story: p.story || '',
      parents: (p.parents || []).map(String), partners: (p.partners || []).map(String), createdAt: Number(p.createdAt) || 0
    }]));
    notes = noteRows || [];
    T.setPeople(people);
    R = T.rel;
    $('#ftEmpty').hidden = people.size > 0;
    descCache.clear();
    buildLines(); renderStats(); renderNotes();
    colPath = lines.length ? [0] : [];
    open = new Set(lines.map((_, i) => 'L' + i));
    applyView(view, true);
  }

  /* ---------- views ---------- */
  function applyView(v, quiet) {
    view = v;
    const ft = $('#ft'); ft.dataset.ftview = v;
    $$('[data-ft-view]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.ftView === v)));
    $('#ftFocusBtn').hidden = v !== 'rings';
    $('#ftStage').hidden = v !== 'rings';
    $('#ftCols').hidden = v !== 'columns';
    $('#ftLedger').hidden = v !== 'ledger';
    if (!T) return;
    if (v !== 'rings' && T.focus) T.setFocus(false);
    if (v === 'columns') { if (T.selected) pathTo(T.selected); renderColumns(); }
    else if (v === 'ledger') { if (T.selected) openTo(T.selected); renderLedger(true); }
    else if (people.size) refit();
    renderDrawer(); syncFocus();
    if (!quiet) { const s = T.selected; if (s && v === 'rings') requestAnimationFrame(() => T.centerOn(s)); }
  }

  function refit() {
    if (!T || !people.size || view !== 'rings') return;
    requestAnimationFrame(() => { if ($('#ftStage').getBoundingClientRect().width) T.fit(); });
  }

  function renderStats() {
    const pairs = new Set();
    for (const [id] of people) for (const q of R.partnersOf(id)) pairs.add([id, q].sort().join('|'));
    $('#ftPeople').textContent = people.size;
    $('#ftGens').textContent = people.size ? T.rows : 0;
    $('#ftCouples').textContent = pairs.size;
  }

  function buildLines() {
    const founders = [...people.keys()].filter(id => !R.parentsOf(id).length && R.childrenOf(id).length && !R.partnersOf(id).some(q => R.parentsOf(q).length)).sort(R.order);
    lines = []; const used = new Set();
    for (const f of founders) {
      if (used.has(f)) continue;
      const couple = [f, ...R.partnersOf(f).filter(q => founders.includes(q))];
      couple.forEach(c => used.add(c));
      const desc = new Set(); const walk = x => R.childrenOf(x).forEach(c => { if (!desc.has(c)) { desc.add(c); walk(c); } });
      couple.forEach(walk);
      lines.push({ ids: couple, desc, label: couple.map(id => people.get(id).name).join(' & ') });
    }
    const box = $('#ftLines'); box.replaceChildren(el('span', { class: 'ft-label', text: 'Founding lines' }));
    lines.forEach((ln, i) => {
      ln.chip = el('button', { class: 'ft-chip', type: 'button', 'aria-pressed': 'false', onclick: () => setLine(activeLine === i ? null : i) },
        ln.label, el('span', { class: 'n', text: String(ln.desc.size) }));
      box.append(ln.chip);
    });
    activeLine = null;
  }
  function setLine(i) {
    activeLine = i;
    lines.forEach((ln, j) => ln.chip.setAttribute('aria-pressed', String(j === i)));
    if (view === 'columns') { if (i != null) { colPath = [i]; T.select(null); renderColumns(); } return; }
    if (view === 'ledger') {
      if (i != null) { open.add('L' + i); renderLedger(); const h = $(`#ftLedger [data-line="${i}"]`); if (h) h.scrollIntoView({ block: 'start', behavior: 'smooth' }); }
      return;
    }
    if (i == null) { T.setDim(null); return; }
    const ln = lines[i], keep = new Set([...ln.ids, ...ln.desc]);
    for (const id of [...keep]) R.partnersOf(id).forEach(q => keep.add(q));
    T.setDim(p => !keep.has(p.id));
    T.centerOn(ln.ids[0], .6);
  }

  /* ---------- columns view ---------- */
  const kidsOf = ids => [...new Set(ids.flatMap(id => R.childrenOf(id)))].sort(R.order);
  function pathTo(id) {
    const c = chainOf(id);
    if (!c) { colPath = lines.length ? [0] : []; return; }
    colPath = [c.li, ...(c.isFounder ? c.chain.slice(1) : c.chain)];
  }
  function chainOf(id) {
    // walk up through blood parents to a founder of one of the founding lines
    let start = id;
    if (!R.parentsOf(start).length) { const blood = R.partnersOf(start).find(q => R.parentsOf(q).length); if (blood) start = blood; }
    const chain = [start]; const seen = new Set([start]);
    for (let cur = start; ;) {
      const ps = R.parentsOf(cur); if (!ps.length) break;
      const nxt = ps.find(p => R.parentsOf(p).length) || ps[0];
      if (seen.has(nxt)) break; seen.add(nxt); chain.unshift(nxt); cur = nxt;
    }
    const li = lines.findIndex(ln => ln.ids.includes(chain[0]) || ln.ids.some(f => R.partnersOf(f).includes(chain[0])));
    if (li < 0) return null;
    return { li, chain, isFounder: lines[li].ids.includes(chain[0]) };
  }

  /* ---------- ledger view: an indented family register, read top to bottom ---------- */
  const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI', 'XII', 'XIII', 'XIV', 'XV'];
  const descCache = new Map();
  function descCount(id) {
    if (descCache.has(id)) return descCache.get(id);
    const seen = new Set(); const w = x => R.childrenOf(x).forEach(c => { if (!seen.has(c)) { seen.add(c); w(c); } }); w(id);
    descCache.set(id, seen.size); return seen.size;
  }
  function openTo(id) {
    const c = chainOf(id); if (!c) return;
    open.add('L' + c.li);
    // open every ancestor so the person is visible (not the person themself)
    const anc = c.isFounder ? c.chain.slice(1) : c.chain;
    anc.slice(0, -1).forEach(a => open.add(a));
    if (!R.parentsOf(id).length && anc.length) open.add(anc[anc.length - 1]);
  }
  function renderLedger(scrollToSel) {
    const box = $('#ftLedger'); if (!box || view !== 'ledger') return;
    const keep = box.scrollTop;
    box.replaceChildren();
    if (!lines.length) return;
    const sel = T.selected, seen = new Set();
    box.append(el('div', { class: 'lg-bar' },
      el('span', { class: 'ft-label', text: 'Family register · read top to bottom' }),
      el('span', { class: 'lg-bar-btns' },
        el('button', { class: 'ft-btn', type: 'button', text: 'Expand all', onclick: () => { lines.forEach((_, i) => open.add('L' + i)); for (const id of people.keys()) if (R.childrenOf(id).length) open.add(id); renderLedger(); } }),
        el('button', { class: 'ft-btn', type: 'button', text: 'Collapse all', onclick: () => { open = new Set(); renderLedger(); box.scrollTop = 0; } }))));
    const toggle = key => { open.has(key) ? open.delete(key) : open.add(key); renderLedger(); };
    const person = (id, depth) => {
      const p = people.get(id), kids = R.childrenOf(id), isOpen = open.has(id), again = seen.has(id);
      seen.add(id);
      const partners = R.partnersOf(id).map(q => people.get(q).name);
      const n = again ? 0 : descCount(id);
      const row = el('div', { class: 'lg-row' + (id === sel ? ' sel' : '') + (hitSet.has(id) ? ' hit' : ''), 'data-id': id, style: { '--d': String(depth) } },
        kids.length && !again
          ? el('button', { class: 'lg-tog', type: 'button', 'aria-expanded': String(isOpen), 'aria-label': (isOpen ? 'Hide' : 'Show') + ' children of ' + p.name, onclick: () => toggle(id) })
          : el('span', { class: 'lg-tog lg-leaf', 'aria-hidden': 'true' }),
        el('button', { class: 'lg-name', type: 'button', onclick: () => T.select(id) },
          el('b', { text: p.name }), p.nickname ? el('i', { text: ` “${p.nickname}”` }) : null),
        partners.length ? el('span', { class: 'lg-partner', text: '& ' + partners.join(', ') }) : null,
        el('span', { class: 'lg-meta' }, again ? 'listed above' : [p.born, n ? `${n} desc.` : ''].filter(Boolean).join(' · ')),
        el('span', { class: 'lg-gen', text: ROMAN[T.genOf(id)] || String(T.genOf(id) + 1) }));
      box.append(row);
      if (isOpen && !again) kids.forEach(k => person(k, depth + 1));
    };
    lines.forEach((ln, i) => {
      const isOpen = open.has('L' + i);
      box.append(el('div', { class: 'lg-line', 'data-line': String(i) },
        el('button', { class: 'lg-tog', type: 'button', 'aria-expanded': String(isOpen), 'aria-label': (isOpen ? 'Hide' : 'Show') + ' the ' + ln.label + ' line', onclick: () => toggle('L' + i) }),
        el('button', { class: 'lg-name', type: 'button', onclick: () => T.select(ln.ids[0]) }, el('span', { class: 'lg-num', text: String(i + 1).padStart(2, '0') }), el('b', { text: ln.label })),
        el('span', { class: 'lg-meta', text: `${ln.desc.size} descendants` })));
      ln.ids.forEach(f => seen.add(f));
      if (isOpen) kidsOf(ln.ids).forEach(k => person(k, 1));
    });
    box.scrollTop = keep;
    if (scrollToSel && sel) requestAnimationFrame(() => { const r = box.querySelector(`.lg-row[data-id="${CSS.escape(sel)}"]`); if (r) r.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); });
  }
  function row(id, { selected, onPath, count, onclick }) {
    const p = people.get(id);
    const initials = p.name.split(/\s+/).filter(w => /^[A-Za-z]/.test(w)).slice(0, 2).map(w => w[0]).join('').toUpperCase();
    return el('button', { class: 'ft-row' + (selected ? ' sel' : onPath ? ' path' : ''), type: 'button', onclick },
      el('span', { class: 'ft-mono', text: initials || '·' }),
      el('span', { class: 'ft-rname' }, p.name, p.nickname ? el('small', { text: ` “${p.nickname}”` }) : null),
      count ? el('span', { class: 'ft-rcount', text: `${count} ›` }) : null);
  }
  function renderColumns() {
    const box = $('#ftCols'); if (!box || view !== 'columns') return;
    box.replaceChildren();
    if (!lines.length) return;
    const col = (title, sub, items) => el('div', { class: 'ft-col' }, el('div', { class: 'ft-colhead' }, el('span', { text: title }), el('b', { text: sub })), ...items);
    // first column: the founding lines
    box.append(col('FOUNDING LINES', `${lines.length} families`, lines.map((ln, i) =>
      el('button', { class: 'ft-row' + (colPath[0] === i ? (colPath.length === 1 ? ' sel' : ' path') : ''), type: 'button', onclick: () => { colPath = [i]; T.select(ln.ids[0]); } },
        el('span', { class: 'ft-mono', text: String(i + 1) }), el('span', { class: 'ft-rname', text: ln.label }), el('span', { class: 'ft-rcount', text: `${ln.desc.size} ›` })))));
    let parents = lines[colPath[0]] ? lines[colPath[0]].ids : [];
    for (let depth = 1; depth <= colPath.length; depth++) {
      const kids = kidsOf(parents); if (!kids.length) break;
      const label = parents.map(id => people.get(id).name.split(' ')[0]).join(' & ');
      const pick = colPath[depth];
      box.append(col('CHILDREN OF', label, kids.map(k => row(k, {
        selected: k === pick && depth === colPath.length - 1, onPath: k === pick, count: R.childrenOf(k).length,
        onclick: () => { colPath = colPath.slice(0, depth).concat(k); T.select(k); }
      }))));
      if (!pick) break;
      parents = [pick, ...R.partnersOf(pick)];
    }
    requestAnimationFrame(() => { box.scrollLeft = box.scrollWidth; });
  }

  /* ---------- notes, drawer ---------- */
  function renderNotes() {
    const box = $('#ftNotesWrap'), list = $('#ftNotes');
    list.replaceChildren(...notes.filter(n => n && (n.title || n.note)).map(n => el('li', {}, el('b', { text: n.title || '' }), ' ' + (n.note || ''))));
    box.hidden = !list.children.length;
  }
  const link = id => el('button', { class: 'ft-link', type: 'button', onclick: () => T.select(id, { center: centerable() }), text: people.get(id).name });
  const links = ids => { const o = []; ids.forEach((id, i) => { if (i) o.push(', '); o.push(link(id)); }); return o.length ? o : ['—']; };

  function renderDrawer() {
    const d = $('#ftDrawer'); d.replaceChildren();
    const add = (...k) => d.append(...k.filter(x => x != null));
    const id = T && T.selected;
    if (!id || !people.has(id)) {
      const tips = view === 'columns'
        ? ['Pick a founding line, then a name, to open the next generation.', 'Press / to search. Press Enter to jump to a match.']
        : view === 'ledger' ? ['Use the arrows to open or close a family.', 'Select a name to read their record.', 'Press / to search. Press Enter to jump to a match.']
        : ['Drag to move. Scroll, pinch or use the buttons to zoom.', 'Press / to search. Press Enter to step through matches.', 'Focus line shows one person’s ancestors, descendants and partners.'];
      add(el('div', { class: 'ft-label', text: 'How to explore' }), el('h3', { text: 'Select a person' }),
        el('div', { class: 'ft-hint' },
          el('p', { text: 'Every name is one relative from the family tree poster. Select one to read their record and trace their line.' }),
          el('ul', {}, tips.map(t => el('li', { text: t }))),
          lines.length ? el('div', { class: 'ft-label', style: { 'margin-top': '18px' }, text: 'Start with the founders' }) : null,
          el('div', { class: 'ft-flist' }, lines.map((ln, i) => el('button', { type: 'button', onclick: () => { setLine(i); T.select(ln.ids[0], { center: centerable() }); } },
            el('span', { text: ln.label }), el('small', { text: ln.desc.size + ' desc.' }))))));
      return;
    }
    const p = people.get(id), kids = R.childrenOf(id), grand = [...new Set(kids.flatMap(R.childrenOf))];
    let all = 0; { const seen = new Set(); const w = x => R.childrenOf(x).forEach(c => { if (!seen.has(c)) { seen.add(c); w(c); } }); w(id); all = seen.size; }
    add(el('div', { class: 'ft-label', text: `Generation ${T.genOf(id) + 1}` + (all ? ` · ${all} descendant${all === 1 ? '' : 's'}` : '') }),
      el('h3', { text: p.name }),
      p.nickname ? el('div', { class: 'ft-nick', text: `“${p.nickname}”` }) : null,
      el('dl', {},
        el('dt', { text: 'Born · life' }), el('dd', { text: p.born || '—' }),
        el('dt', { text: 'Place' }), el('dd', { text: p.place || '—' }),
        el('dt', { text: 'Parents' }), el('dd', {}, links(R.parentsOf(id))),
        el('dt', { text: 'Partners' }), el('dd', {}, links(R.partnersOf(id))),
        el('dt', { text: 'Siblings' }), el('dd', {}, links(R.siblingsOf(id))),
        el('dt', { text: 'Children' }), el('dd', {}, links(kids)),
        grand.length ? el('dt', { text: 'Grandkids' }) : null, grand.length ? el('dd', {}, links(grand)) : null),
      p.story ? el('div', { class: 'ft-note' }, el('h4', { text: 'From the poster' }), el('p', { text: p.story })) : null,
      el('div', { class: 'ft-actions' },
        view === 'rings' ? el('button', { class: 'ft-btn', type: 'button', 'aria-pressed': String(T.focus), onclick: () => { T.setFocus(!T.focus); renderDrawer(); syncFocus(); }, text: T.focus ? 'Show whole tree' : 'Focus this line' }) : null,
        view === 'rings' ? el('button', { class: 'ft-btn', type: 'button', onclick: () => T.centerOn(id), text: 'Center' }) : null,
        el('a', { class: 'ft-btn', href: '#family', onclick: () => { const s = $('#st-about'); if (s) { s.value = p.name; const dd = s.closest('details'); if (dd) dd.open = true; setTimeout(() => s.closest('.section').scrollIntoView({ behavior: 'smooth' }), 30); } }, text: 'Share a story about them' })));
  }
  function syncFocus() {
    if (!T) return;
    $('#ftFocusBtn').setAttribute('aria-pressed', String(T.focus));
    $('#ftFocusBar').hidden = !T.focus || view !== 'rings';
    if (T.focus) $('#ftFocusText').textContent = T.selected && people.has(T.selected) ? `Showing the line of ${people.get(T.selected).name} · ${T.shown.size} people` : 'Select a person to focus on their line';
  }

  /* ---------- controls ---------- */
  function wire() {
    $('#ftFocusBtn').onclick = () => { T.setFocus(!T.focus); renderDrawer(); syncFocus(); };
    $('#ftFocusExit').onclick = () => { T.setFocus(false); renderDrawer(); syncFocus(); };
    $$('[data-ft-view]').forEach(b => b.onclick = () => {
      applyView(b.dataset.ftView);
      try { localStorage.setItem('lr-treeview2', b.dataset.ftView); } catch (e) {}
    });
    $('#ftZin').onclick = () => T.zoom(1.25); $('#ftZout').onclick = () => T.zoom(.8); $('#ftFit').onclick = () => T.fit();
    const q = $('#ftQ'); let hits = [], ix = -1;
    q.addEventListener('input', () => {
      T.setQuery(q.value); hits = q.value.trim() ? T.matches() : []; ix = -1;
      $('#ftCount').textContent = q.value.trim() ? `${hits.length} found` : '';
      hitSet = new Set(hits); if (view === 'ledger') renderLedger();
    });
    q.addEventListener('keydown', e => {
      if (e.key === 'Enter') { e.preventDefault(); if (hits.length) { ix = (ix + 1) % hits.length; T.select(hits[ix], { center: centerable() }); $('#ftCount').textContent = `${ix + 1} of ${hits.length}`; } }
      if (e.key === 'Escape') { q.value = ''; q.dispatchEvent(new Event('input')); }
    });
    document.addEventListener('keydown', e => {
      const visible = $('#ft').getBoundingClientRect().width > 0;
      if (visible && e.key === '/' && !/INPUT|TEXTAREA|SELECT/.test(document.activeElement && document.activeElement.tagName)) { e.preventDefault(); q.focus(); }
    });
    addEventListener('resize', () => { if (T && !T.selected) refit(); });
  }

  window.LRTree = { load, refit };
  applyView(view, true);
})();
