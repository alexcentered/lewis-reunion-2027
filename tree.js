/* Lewis–Antone family tree, folded into the reunion site's "Our Family" tab.
   Three views, tied to the site's look switcher (the three color dots):
     Sequoia → Ledger (generations in rows), Harvest → Rings (a full circle of growth rings), Slate → Columns (browse one family at a time).
   People arrive from the backend only after the family code is accepted. */
(() => {
  'use strict';
  const $ = s => document.querySelector(s), $$ = s => [...document.querySelectorAll(s)];
  if (!window.FamilyTree || !$('#ftStage')) return;
  const el = FamilyTree.el;
  const VIEW_OF_LOOK = { sequoia: 'ledger', harvest: 'rings', slate: 'columns' };
  const LOOK_OF_VIEW = { ledger: 'sequoia', rings: 'harvest', columns: 'slate' };

  let people = new Map(), T = null, R = null, lines = [], activeLine = null, notes = [];
  let view = VIEW_OF_LOOK[document.documentElement.dataset.look] || 'ledger';
  let colPath = [];   // columns view: [lineIndex, childId, grandchildId, ...]

  function ensure() {
    if (T) return;
    T = FamilyTree.create({
      stage: $('#ftStage'), svg: $('#ftSvg'), mode: view === 'rings' ? 'tree' : 'chart',
      onSelect: id => { if (view === 'columns' && id) pathTo(id); renderDrawer(); syncFocus(); if (view === 'columns') renderColumns(); },
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
    buildLines(); renderStats(); renderNotes();
    colPath = lines.length ? [0] : [];
    applyView(view, true);
  }

  /* ---------- views ---------- */
  function applyView(v, quiet) {
    view = v;
    const ft = $('#ft'); ft.dataset.ftview = v;
    $$('[data-ft-view]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.ftView === v)));
    $('#ftOrient').hidden = v !== 'ledger';
    $('#ftFocusBtn').hidden = v === 'columns';
    $('#ftStage').hidden = v === 'columns';
    $('#ftCols').hidden = v !== 'columns';
    if (!T) return;
    if (v === 'columns') { if (T.focus) T.setFocus(false); if (T.selected) pathTo(T.selected); renderColumns(); }
    else if (people.size) { T.setMode(v === 'rings' ? 'tree' : 'chart'); refit(); }
    renderDrawer(); syncFocus();
    if (!quiet) { const s = T.selected; if (s && v !== 'columns') requestAnimationFrame(() => T.centerOn(s)); }
  }
  function onLook(look) { const v = VIEW_OF_LOOK[look]; if (v && v !== view) applyView(v); }

  function refit() {
    if (!T || !people.size || view === 'columns') return;
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
    if (i == null) { T.setDim(null); return; }
    const ln = lines[i], keep = new Set([...ln.ids, ...ln.desc]);
    for (const id of [...keep]) R.partnersOf(id).forEach(q => keep.add(q));
    T.setDim(p => !keep.has(p.id));
    T.centerOn(ln.ids[0], .6);
  }

  /* ---------- columns view ---------- */
  const kidsOf = ids => [...new Set(ids.flatMap(id => R.childrenOf(id)))].sort(R.order);
  function pathTo(id) {
    // walk up through blood parents to a founder, then rebuild the column path
    let start = id;
    if (!R.parentsOf(start).length) { const blood = R.partnersOf(start).find(q => R.parentsOf(q).length); if (blood) start = blood; }
    const chain = [start]; const seen = new Set([start]);
    for (let cur = start; ;) {
      const ps = R.parentsOf(cur); if (!ps.length) break;
      const nxt = ps.find(p => R.parentsOf(p).length) || ps[0];
      if (seen.has(nxt)) break; seen.add(nxt); chain.unshift(nxt); cur = nxt;
    }
    const li = lines.findIndex(ln => ln.ids.includes(chain[0]) || ln.ids.some(f => R.partnersOf(f).includes(chain[0])));
    if (li < 0) { colPath = lines.length ? [0] : []; return; }
    const isFounder = lines[li].ids.includes(chain[0]);
    colPath = [li, ...(isFounder ? chain.slice(1) : chain)];
    if (isFounder && chain.length === 1) colPath = [li];
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
  const link = id => el('button', { class: 'ft-link', type: 'button', onclick: () => T.select(id, { center: view !== 'columns' }), text: people.get(id).name });
  const links = ids => { const o = []; ids.forEach((id, i) => { if (i) o.push(', '); o.push(link(id)); }); return o.length ? o : ['—']; };

  function renderDrawer() {
    const d = $('#ftDrawer'); d.replaceChildren();
    const add = (...k) => d.append(...k.filter(x => x != null));
    const id = T && T.selected;
    if (!id || !people.has(id)) {
      const tips = view === 'columns'
        ? ['Pick a founding line, then a name, to open the next generation.', 'Press / to search. Press Enter to jump to a match.']
        : ['Drag to move. Scroll, pinch or use the buttons to zoom.', 'Press / to search. Press Enter to step through matches.', 'Focus line shows one person’s ancestors, descendants and partners.'];
      add(el('div', { class: 'ft-label', text: 'How to explore' }), el('h3', { text: 'Select a person' }),
        el('div', { class: 'ft-hint' },
          el('p', { text: 'Every name is one relative from the family tree poster. Select one to read their record and trace their line.' }),
          el('ul', {}, tips.map(t => el('li', { text: t }))),
          lines.length ? el('div', { class: 'ft-label', style: { 'margin-top': '18px' }, text: 'Start with the founders' }) : null,
          el('div', { class: 'ft-flist' }, lines.map((ln, i) => el('button', { type: 'button', onclick: () => { setLine(i); T.select(ln.ids[0], { center: view !== 'columns' }); } },
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
        view !== 'columns' ? el('button', { class: 'ft-btn', type: 'button', 'aria-pressed': String(T.focus), onclick: () => { T.setFocus(!T.focus); renderDrawer(); syncFocus(); }, text: T.focus ? 'Show whole tree' : 'Focus this line' }) : null,
        view !== 'columns' ? el('button', { class: 'ft-btn', type: 'button', onclick: () => T.centerOn(id), text: 'Center' }) : null,
        el('a', { class: 'ft-btn', href: '#family', onclick: () => { const s = $('#st-about'); if (s) { s.value = p.name; const dd = s.closest('details'); if (dd) dd.open = true; setTimeout(() => s.closest('.section').scrollIntoView({ behavior: 'smooth' }), 30); } }, text: 'Share a story about them' })));
  }
  function syncFocus() {
    if (!T) return;
    $('#ftFocusBtn').setAttribute('aria-pressed', String(T.focus));
    $('#ftFocusBar').hidden = !T.focus || view === 'columns';
    if (T.focus) $('#ftFocusText').textContent = T.selected && people.has(T.selected) ? `Showing the line of ${people.get(T.selected).name} · ${T.shown.size} people` : 'Select a person to focus on their line';
  }

  /* ---------- controls ---------- */
  function wire() {
    $('#ftFocusBtn').onclick = () => { T.setFocus(!T.focus); renderDrawer(); syncFocus(); };
    $('#ftFocusExit').onclick = () => { T.setFocus(false); renderDrawer(); syncFocus(); };
    $$('[data-ft-orient]').forEach(b => b.onclick = () => {
      $$('[data-ft-orient]').forEach(x => x.setAttribute('aria-pressed', String(x === b)));
      T.setOrient(b.dataset.ftOrient);
    });
    // the view buttons switch the whole site's look, which switches the view
    $$('[data-ft-view]').forEach(b => b.onclick = () => {
      const look = LOOK_OF_VIEW[b.dataset.ftView];
      if (window.LRSetLook) window.LRSetLook(look); else applyView(b.dataset.ftView);
    });
    addEventListener('lr-look', e => onLook(e.detail));
    $('#ftZin').onclick = () => T.zoom(1.25); $('#ftZout').onclick = () => T.zoom(.8); $('#ftFit').onclick = () => T.fit();
    const q = $('#ftQ'); let hits = [], ix = -1;
    q.addEventListener('input', () => {
      T.setQuery(q.value); hits = q.value.trim() ? T.matches() : []; ix = -1;
      $('#ftCount').textContent = q.value.trim() ? `${hits.length} found` : '';
    });
    q.addEventListener('keydown', e => {
      if (e.key === 'Enter') { e.preventDefault(); if (hits.length) { ix = (ix + 1) % hits.length; T.select(hits[ix], { center: view !== 'columns' }); $('#ftCount').textContent = `${ix + 1} of ${hits.length}`; } }
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
