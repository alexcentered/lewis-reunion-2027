/* Family tree engine: generational layout, pan/zoom SVG rendering, lineage highlighting.
   Shared by the standalone Lewis–Antone tree and the reunion page. */
(function () {
  const SVGNS = "http://www.w3.org/2000/svg";
  const NW = 168, NH = 58, STEP = 184, ROW = 150, ROOT_GAP = 80;

  function el(tag, attrs = {}, ...kids) {
    const n = tag.startsWith("svg:") ? document.createElementNS(SVGNS, tag.slice(4)) : document.createElement(tag);
    for (const [a, v] of Object.entries(attrs)) {
      if (v == null || v === false) continue;
      if (a === "text") n.textContent = v;
      else if (a.startsWith("on")) n.addEventListener(a.slice(2), v);
      else if (a === "style" && typeof v === "object") for (const [k, s] of Object.entries(v)) n.style.setProperty(k, s);
      else n.setAttribute(a, v);
    }
    for (const k of kids.flat()) if (k != null && k !== false) n.append(k.nodeType ? k : document.createTextNode(String(k)));
    return n;
  }
  const trunc = (s, n) => { s = s || ""; return s.length > n ? s.slice(0, n - 1) + "…" : s; };

  /* ---------- relationships over a Map(id -> person) ---------- */
  function relations(people) {
    const kids = new Map(), partners = new Map();
    for (const id of people.keys()) { kids.set(id, []); partners.set(id, new Set()); }
    for (const [id, p] of people) {
      for (const q of p.parents || []) if (people.has(q) && q !== id) kids.get(q).push(id);
      for (const q of p.partners || []) if (people.has(q) && q !== id) { partners.get(id).add(q); partners.get(q).add(id); }
    }
    const order = (a, b) => (people.get(a).createdAt || 0) - (people.get(b).createdAt || 0);
    for (const list of kids.values()) list.sort(order);
    const parentsOf = id => (people.get(id)?.parents || []).filter(q => people.has(q) && q !== id);
    const partnersOf = id => [...(partners.get(id) || [])].sort(order);
    const childrenOf = id => kids.get(id) || [];
    const siblingsOf = id => {
      const ps = parentsOf(id); if (!ps.length) return [];
      const s = new Set(); ps.forEach(p => childrenOf(p).forEach(c => c !== id && s.add(c)));
      return [...s].sort(order);
    };
    function lineage(id) {
      const set = new Set([id]);
      const up = x => parentsOf(x).forEach(p => { if (!set.has(p)) { set.add(p); up(p); } });
      const down = x => childrenOf(x).forEach(c => { if (!set.has(c)) { set.add(c); down(c); } });
      up(id); down(id);
      return set;
    }
    return { parentsOf, partnersOf, childrenOf, siblingsOf, lineage, order };
  }

  /* ---------- layout ---------- */
  function layout(people, R) {
    const ids = [...people.keys()].sort(R.order);
    // generations: child below parents, partners share a row, parentless people sit just above their children
    const gen = {}; ids.forEach(i => gen[i] = 0);
    for (let it = 0; it < 80; it++) {
      let changed = false;
      const bump = (i, v) => { if (v > gen[i]) { gen[i] = v; changed = true; } };
      for (const i of ids) { const ps = R.parentsOf(i); if (ps.length) bump(i, Math.max(...ps.map(p => gen[p])) + 1); }
      for (const i of ids) for (const q of R.partnersOf(i)) { const m = Math.max(gen[i], gen[q]); bump(i, m); bump(q, m); }
      for (const i of ids) { const ks = R.childrenOf(i); if (ks.length) bump(i, Math.min(...ks.map(k => gen[k])) - 1); }
      for (const i of ids) { const ks = R.childrenOf(i); if (ks.length > 1) { const m = Math.max(...ks.map(k => gen[k])); ks.forEach(k => bump(k, m)); } }
      if (!changed) break;
    }
    // units: a person with their married-in partners beside them
    const inlawOf = {};
    for (const i of ids) {
      if (R.parentsOf(i).length) continue;
      const ps = R.partnersOf(i);
      const blood = ps.find(q => R.parentsOf(q).length);
      if (blood) { inlawOf[i] = blood; continue; }
      const earlier = ps.find(q => !inlawOf[q] && R.order(q, i) < 0 && !R.parentsOf(q).length);
      if (earlier) inlawOf[i] = earlier;
    }
    const unitOf = i => inlawOf[i] || i;
    const members = {};
    for (const i of ids) (members[unitOf(i)] ||= [unitOf(i)]);
    for (const i of ids) if (inlawOf[i]) members[unitOf(i)].push(i);
    const primary = c => {
      const ps = R.parentsOf(c);
      return ps.find(p => R.parentsOf(p).length) || ps[0];
    };
    const unitKids = {};
    for (const i of ids) {
      if (inlawOf[i]) continue;
      const p = primary(i);
      if (p) (unitKids[unitOf(p)] ||= []).push(i);
    }
    const visited = new Set();
    function place(u) {
      visited.add(u);
      const subs = (unitKids[u] || []).filter(k => !visited.has(k)).map(place);
      let nodes = [], cont = new Map();
      const merge = (s, gap) => {
        if (!nodes.length) { nodes = s.nodes; cont = s.cont; return; }
        let shift = -Infinity;
        for (const [r, [mn]] of s.cont) if (cont.has(r)) shift = Math.max(shift, cont.get(r)[1] + STEP + gap - mn);
        if (shift === -Infinity) shift = Math.max(...[...cont.values()].map(v => v[1])) + STEP + gap - Math.min(...[...s.cont.values()].map(v => v[0]));
        s.nodes.forEach(n => n.x += shift);
        nodes = nodes.concat(s.nodes);
        for (const [r, [mn, mx]] of s.cont) {
          const a = mn + shift, b = mx + shift;
          if (cont.has(r)) { const c = cont.get(r); cont.set(r, [Math.min(c[0], a), Math.max(c[1], b)]); } else cont.set(r, [a, b]);
        }
      };
      subs.forEach(s => merge(s, 0));
      const m = members[u] || [u];
      const width = (m.length - 1) * STEP;
      let start = 0;
      if (subs.length) {
        const xs = subs.map(s => s.anchorX);
        start = (Math.min(...xs) + Math.max(...xs)) / 2 - width / 2;
        start = (Math.min(...xs) + Math.max(...xs)) / 2 - width / 2;
      }
      const r = gen[u];
      // keep the unit clear of anything already on its row
      if (cont.has(r)) { const [mn, mx] = cont.get(r); if (start <= mx && start + width >= mn) start = mx + STEP; }
      m.forEach((id, i) => nodes.push({ id, x: start + i * STEP, r: gen[id] }));
      const row = cont.get(r);
      cont.set(r, row ? [Math.min(row[0], start), Math.max(row[1], start + width)] : [start, start + width]);
      // in-laws on a different row than the anchor (rare) still need a contour entry
      m.forEach((id, i) => { const rr = gen[id]; if (rr !== r) { const x = start + i * STEP; const c = cont.get(rr); cont.set(rr, c ? [Math.min(c[0], x), Math.max(c[1], x)] : [x, x]); } });
      return { nodes, cont, anchorX: start };
    }
    const roots = ids.filter(i => !inlawOf[i] && !primary(i));
    let forest = null;
    const all = { nodes: [], cont: new Map() };
    for (const r of roots) {
      if (visited.has(r)) continue;
      const s = place(r);
      if (!forest) { forest = s; all.nodes = s.nodes; all.cont = s.cont; continue; }
      let shift = -Infinity;
      for (const [row, [mn]] of s.cont) if (all.cont.has(row)) shift = Math.max(shift, all.cont.get(row)[1] + STEP + ROOT_GAP - mn);
      if (shift === -Infinity) shift = Math.max(...[...all.cont.values()].map(v => v[1])) + STEP + ROOT_GAP - Math.min(...[...s.cont.values()].map(v => v[0]));
      s.nodes.forEach(n => n.x += shift);
      all.nodes = all.nodes.concat(s.nodes);
      for (const [row, [mn, mx]] of s.cont) {
        const a = mn + shift, b = mx + shift;
        if (all.cont.has(row)) { const c = all.cont.get(row); all.cont.set(row, [Math.min(c[0], a), Math.max(c[1], b)]); } else all.cont.set(row, [a, b]);
      }
    }
    // anything unreached (cycles in bad data) goes on the far right
    let extraX = all.nodes.length ? Math.max(...all.nodes.map(n => n.x)) + STEP * 2 : 0;
    for (const i of ids) if (!all.nodes.some(n => n.id === i)) { all.nodes.push({ id: i, x: extraX, r: gen[i] }); extraX += STEP; }
    const pos = {};
    for (const n of all.nodes) pos[n.id] = { x: n.x, r: n.r };
    return { pos, gen, rows: new Set(Object.values(gen)).size, inlawOf };
  }

  /* ---------- the view ---------- */
  function create(opts) {
    const { stage, svg } = opts;
    const vp = el("svg:g"), gEdges = el("svg:g"), gNodes = el("svg:g");
    vp.append(gEdges, gNodes); svg.append(vp);
    let all = new Map(), shown = new Map(), R = relations(all), L = { pos: {}, gen: {}, rows: 0 };
    let selected = null, focus = false, orient = "down", query = "", dimFn = null, hl = null;
    let mode = opts.mode || "tree", TP = {}, trunkH = 0;
    // crown geometry: label length, ring spacing, minimum arc gap between neighbours, fan span, innermost radius
    const TL = 160, RING = 230, GAPPX = 21, R0 = 440;
    // ring style: a full circle of rings with no trunk; crown style: a half fan over a trunk
    let SPAN = 180 * Math.PI / 180, showTrunk = true, rings = [];
    const view = { x: 0, y: 0, k: 1 };
    const nodeEls = new Map(); let edgeEls = [];

    const Y = id => mode === "tree" ? TP[id].y : L.pos[id].r * ROW * (orient === "down" ? 1 : -1);
    const X = id => mode === "tree" ? TP[id].x : L.pos[id].x;
    const polar = (r, th) => [r * Math.sin(th), -r * Math.cos(th)];

    function radial() {
      TP = {};
      const ids = Object.keys(L.pos); if (!ids.length) return;
      const xs = ids.map(i => L.pos[i].x), x0 = Math.min(...xs), W = Math.max(Math.max(...xs) - x0, STEP);
      const want = i => ids.length === 1 ? 0 : -SPAN / 2 + (L.pos[i].x - x0) / W * SPAN;
      const rows = {};
      for (const i of ids) (rows[L.pos[i].r] ||= []).push(i);
      let prev = null; const half = SPAN / 2; rings = [];
      for (const g of Object.keys(rows).map(Number).sort((a, b) => a - b)) {
        const ring = rows[g].sort((a, b) => L.pos[a].x - L.pos[b].x);
        // each ring is just big enough for its own leaves, then leaves are nudged apart along it
        let r = Math.max(prev == null ? R0 : prev + RING, ring.length * GAPPX / (SPAN * .92));
        prev = r; rings.push(r);
        const gap = GAPPX / r, d = ring.map(want), a = [];
        ring.forEach((_, k) => a[k] = k ? Math.max(d[k], a[k - 1] + gap) : d[k]);
        const off = d.reduce((t, v, k) => t + v - a[k], 0) / ring.length;
        for (let k = 0; k < a.length; k++) a[k] += off;
        if (a[0] < -half) { const sft = -half - a[0]; for (let k = 0; k < a.length; k++) a[k] += sft; }
        if (a[a.length - 1] > half) { const sft = a[a.length - 1] - half; for (let k = 0; k < a.length; k++) a[k] -= sft; }
        ring.forEach((i, k) => { const [x, y] = polar(r, a[k]); TP[i] = { x, y, th: a[k], rad: r }; });
      }
      trunkH = Math.max(380, R0 * .9);
    }
    function subset() {
      if (!(focus && selected && all.has(selected))) return all;
      const RA = relations(all);
      const keep = RA.lineage(selected);
      for (const id of [...keep]) RA.partnersOf(id).forEach(q => keep.add(q));
      RA.siblingsOf(selected).forEach(s => keep.add(s));
      const m = new Map();
      for (const [id, p] of all) if (keep.has(id)) m.set(id, p);
      return m;
    }
    function rebuild(keepView) {
      shown = subset();
      R = relations(shown);
      L = layout(shown, R);
      if (mode === "tree") radial();
      draw();
      if (!keepView) fit();
      opts.onLayout?.(api);
    }
    function drawTree() {
      const H = trunkH;
      if (!showTrunk) {
        // growth rings: one per generation, between the leaf rings, plus the heartwood
        gEdges.append(el("svg:circle", { class: "ringguide heart", r: (R0 * .55).toFixed(1) }));
        rings.forEach((r, k) => {
          gEdges.append(el("svg:circle", { class: "ringguide", r: (r - 14).toFixed(1) }));
          gEdges.append(el("svg:circle", { class: "ringguide grain", r: (r + TL + 30).toFixed(1) }));
        });
      }
      // trunk and roots
      if (showTrunk) gEdges.append(el("svg:path", { class: "trunk", d: `M-26,0 C-30,${H * .35} -46,${H * .72} -88,${H} L88,${H} C46,${H * .72} 30,${H * .35} 26,0 Z` }));
      for (let i = -3; i <= 3 && showTrunk; i++) {
        const ex = i * H * .42, ey = H + 140 + (3 - Math.abs(i)) * 45;
        gEdges.append(el("svg:path", { class: "root", "stroke-width": 16 - Math.abs(i) * 3.5, d: `M${i * 14},${H - 12} C${i * 26},${H + 70} ${ex * .55},${ey - 50} ${ex},${ey}` }));
      }
      // limbs from the trunk to each founding family
      for (const id of shown.keys()) {
        if (R.parentsOf(id).length || L.inlawOf[id]) continue;
        const t = TP[id], [cx, cy] = polar(t.rad * .55, t.th);
        const e = el("svg:path", { class: "branch limb", "stroke-width": 11, d: `M0,0 C0,${-t.rad * .3} ${cx},${cy} ${t.x},${t.y}` });
        e._limb = id; e._ids = [id]; edgeEls.push(e); gEdges.append(e);
      }
      // partners: an arc along the ring when side by side, a dashed chord when they sit in different branches
      const seen = new Set();
      for (const id of shown.keys()) for (const q of R.partnersOf(id)) {
        const key = id < q ? id + "|" + q : q + "|" + id; if (seen.has(key)) continue; seen.add(key);
        const a = TP[id], b = TP[q];
        let d, cls = "edge partner";
        if (a.rad === b.rad && Math.abs(L.pos[id].x - L.pos[q].x) <= STEP + 1 && Math.abs(a.th - b.th) * a.rad < GAPPX * 3) {
          d = `M${a.x},${a.y} A${a.rad},${a.rad} 0 0 ${b.th > a.th ? 1 : 0} ${b.x},${b.y}`;
        } else {
          const [mx, my] = polar(Math.min(a.rad, b.rad) * .8, (a.th + b.th) / 2);
          d = `M${a.x},${a.y} Q${mx},${my} ${b.x},${b.y}`; cls += " far";
        }
        const e = el("svg:path", { d, class: cls }); e._ids = [id, q]; edgeEls.push(e); gEdges.append(e);
      }
      // branches: from the end of the parent's leaf to the child, thinner each generation
      for (const c of shown.keys()) {
        const ps = R.parentsOf(c); if (!ps.length) continue;
        const near = ps.length === 2 && TP[ps[0]].rad === TP[ps[1]].rad && Math.abs(L.pos[ps[0]].x - L.pos[ps[1]].x) <= STEP + 1;
        const p = ps.find(p => R.parentsOf(p).length) || ps[0];
        const ths = near ? (TP[ps[0]].th + TP[ps[1]].th) / 2 : TP[p].th;
        const rs = TP[p].rad + TL + 10, re = TP[c].rad - 9, rm = (rs + re) / 2, tc = TP[c].th;
        // out from the parent, along this generation's ring, then out to the child; bends are rounded
        const bend = Math.min(26, (re - rs) / 3), dt = tc - ths, sg = Math.sign(dt) || 1, turn = Math.min(Math.abs(dt), bend / rm) * sg;
        const P = (r, t) => polar(r, t).map(v => v.toFixed(1)).join(",");
        let d;
        if (Math.abs(dt) * rm < 4) d = `M${P(rs, ths)} L${P(re, tc)}`;
        else d = `M${P(rs, ths)} L${P(rm - bend, ths)} Q${P(rm, ths)} ${P(rm, ths + turn)} A${rm.toFixed(1)},${rm.toFixed(1)} 0 ${Math.abs(dt - 2 * turn) > Math.PI ? 1 : 0} ${dt > 0 ? 1 : 0} ${P(rm, tc - turn)} Q${P(rm, tc)} ${P(rm + bend, tc)} L${P(re, tc)}`;
        const w = Math.max(1.1, 7 - L.gen[p] * .7);
        const e = el("svg:path", { class: "branch", "stroke-width": w.toFixed(2), d });
        e._ids = [c, ...ps]; e._child = c; e._parents = ps; edgeEls.push(e); gEdges.append(e);
      }
      // leaves: a bud on the ring and the name reading outward
      for (const [id, p] of shown) {
        const t = TP[id], flip = t.th < 0, phi = t.th * 180 / Math.PI - 90 + (flip ? 180 : 0);
        const color = opts.colorOf?.(p);
        const g = el("svg:g", { class: "node tnode", transform: `translate(${t.x},${t.y}) rotate(${phi.toFixed(2)})`, tabindex: "0", role: "button", "aria-label": p.name + (p.nickname ? `, ${p.nickname}` : ""), "data-id": id },
          el("svg:rect", { class: "hitbox", x: flip ? -(TL + 6) : -8, y: -11, width: TL + 14, height: 22 }),
          color ? el("svg:circle", { r: 5.5, fill: color, class: "bud" }) : el("svg:circle", { r: 4.5, class: "pip bud" }),
          el("svg:text", { class: "tl", x: flip ? -11 : 11, y: 4, "text-anchor": flip ? "end" : "start", text: (p.elder ? "◆ " : "") + trunc(p.name, 21) }));
        g._base = "node tnode"; nodeEls.set(id, g); gNodes.append(g);
      }
      paint();
    }
    function draw() {
      gEdges.replaceChildren(); gNodes.replaceChildren(); nodeEls.clear(); edgeEls = [];
      svg.classList.toggle("crown", mode === "tree");
      if (mode === "tree") return drawTree();
      const down = orient === "down", half = NH / 2;
      // partner links
      const seen = new Set();
      for (const id of shown.keys()) for (const q of R.partnersOf(id)) {
        const key = id < q ? id + "|" + q : q + "|" + id; if (seen.has(key)) continue; seen.add(key);
        const ax = X(id), bx = X(q), ay = Y(id), by = Y(q);
        let d, cls = "edge partner";
        if (ay === by && Math.abs(ax - bx) <= STEP + 1) {
          const [l, r] = ax < bx ? [ax, bx] : [bx, ax];
          d = `M${l + NW / 2},${ay} L${r - NW / 2},${ay}`;
        } else {
          const lift = down ? -half - 40 : half + 40;
          d = `M${ax},${ay + (down ? -half : half)} C${ax},${ay + lift} ${bx},${by + lift} ${bx},${by + (down ? -half : half)}`;
          cls += " far";
        }
        const e = el("svg:path", { d, class: cls }); e._ids = [id, q]; edgeEls.push(e); gEdges.append(e);
      }
      // parent → child elbows
      for (const c of shown.keys()) {
        const ps = R.parentsOf(c); if (!ps.length) continue;
        let sx, sy;
        const near = ps.length === 2 && Y(ps[0]) === Y(ps[1]) && Math.abs(X(ps[0]) - X(ps[1])) <= STEP + 1;
        if (near) { sx = (X(ps[0]) + X(ps[1])) / 2; sy = Y(ps[0]); }
        else {
          const p = ps.find(p => R.parentsOf(p).length && L.pos[p]) || ps[0];
          sx = X(p); sy = Y(p) + (down ? half : -half);
        }
        const cx = X(c), cy = Y(c) + (down ? -half : half);
        const my = cy + (down ? -28 : 28);
        const e = el("svg:path", { d: `M${sx},${sy} V${my} H${cx} V${cy}`, class: "edge" }); e._ids = [c, ...ps]; e._child = c; e._parents = ps;
        edgeEls.push(e); gEdges.append(e);
      }
      for (const [id, p] of shown) {
        const color = opts.colorOf?.(p);
        const tag = opts.tagOf ? opts.tagOf(p, L.gen[id], api) : `GEN ${L.gen[id] + 1}`;
        const meta = [p.born, p.place].filter(Boolean).join(" · ");
        const g = el("svg:g", { class: "node", transform: `translate(${X(id) - NW / 2},${Y(id) - half})`, tabindex: "0", role: "button", "aria-label": p.name + (p.nickname ? `, ${p.nickname}` : ""), "data-id": id },
          el("svg:rect", { class: "card", width: NW, height: NH, rx: 11 }),
          color ? el("svg:circle", { cx: 15, cy: half, r: 5, fill: color }) : el("svg:circle", { cx: 15, cy: half, r: 4, class: "pip" }),
          el("svg:text", { class: "tag", x: 28, y: 16, text: trunc(tag + (p.nickname ? "  ·  " + p.nickname.toUpperCase() : ""), 26) }),
          el("svg:text", { class: "nm", x: 28, y: 33, text: trunc(p.name, 19) }),
          el("svg:text", { class: "meta", x: 28, y: 48, text: trunc(meta || " ", 24) }));
        nodeEls.set(id, g); gNodes.append(g);
      }
      paint();
    }
    function matches(p) {
      if (!query) return false;
      return [p.name, p.nickname, p.place, p.born].some(v => (v || "").toLowerCase().includes(query));
    }
    function paint() {
      const lin = selected && shown.has(selected) ? R.lineage(selected) : null;
      hl = lin ? new Set(lin) : null;
      if (hl) R.partnersOf(selected).forEach(q => hl.add(q));
      for (const [id, g] of nodeEls) {
        const p = shown.get(id);
        const dim = (hl && !hl.has(id)) || (dimFn && dimFn(p));
        g.setAttribute("class", (g._base || "node") + (id === selected ? " sel" : "") + (matches(p) ? " hit" : "") + (dim ? " dim" : ""));
      }
      for (const e of edgeEls) {
        let on;
        if (e._child) on = lin && lin.has(e._child) && e._parents.some(p => hl.has(p));
        else if (e._limb) on = lin && lin.has(e._limb);
        else on = hl && e._ids.includes(selected);
        const dim = hl && !on;
        e.classList.toggle("hl", !!on); e.classList.toggle("dim", !!dim);
      }
      opts.onPaint?.(api);
    }
    function applyView() { vp.setAttribute("transform", `translate(${view.x},${view.y}) scale(${view.k})`); opts.onZoom?.(view.k); }
    function bounds(ids) {
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      if (mode === "tree") {
        for (const id of ids) {
          const t = TP[id]; if (!t) continue;
          const [ox, oy] = polar(t.rad + TL + 10, t.th);
          x0 = Math.min(x0, t.x, ox); x1 = Math.max(x1, t.x, ox); y0 = Math.min(y0, t.y, oy); y1 = Math.max(y1, t.y, oy);
        }
        if (ids.length === shown.size && showTrunk) { x0 = Math.min(x0, -trunkH * 1.3); x1 = Math.max(x1, trunkH * 1.3); y1 = Math.max(y1, trunkH + 300); }
        return { x0, y0, x1, y1 };
      }
      for (const id of ids) { if (!L.pos[id]) continue; x0 = Math.min(x0, X(id) - NW / 2); x1 = Math.max(x1, X(id) + NW / 2); y0 = Math.min(y0, Y(id) - NH / 2); y1 = Math.max(y1, Y(id) + NH / 2); }
      return { x0, y0, x1, y1 };
    }
    function fit(ids) {
      const list = ids || [...shown.keys()]; if (!list.length) return;
      const b = bounds(list), r = stage.getBoundingClientRect(), pad = 40;
      if (!r.width) return;
      view.k = Math.min(1.2, Math.max(.04, Math.min((r.width - pad * 2) / (b.x1 - b.x0), (r.height - pad * 2) / (b.y1 - b.y0))));
      view.x = r.width / 2 - view.k * (b.x0 + b.x1) / 2; view.y = r.height / 2 - view.k * (b.y0 + b.y1) / 2;
      applyView();
    }
    function centerOn(id, k) {
      if (!L.pos[id]) return;
      const r = stage.getBoundingClientRect();
      view.k = k || Math.max(view.k, .85);
      let [px, py] = [X(id), Y(id)];
      if (mode === "tree") [px, py] = polar(TP[id].rad + TL / 2, TP[id].th);
      view.x = r.width / 2 - view.k * px; view.y = r.height / 2 - view.k * py;
      applyView();
    }
    function zoomAt(f, cx, cy) {
      const k = Math.min(2.5, Math.max(.03, view.k * f)), ratio = k / view.k;
      view.x = cx - (cx - view.x) * ratio; view.y = cy - (cy - view.y) * ratio; view.k = k; applyView();
    }
    // pointer: drag, pinch, tap
    stage.addEventListener("wheel", e => {
      e.preventDefault();
      const r = stage.getBoundingClientRect();
      if (e.ctrlKey || Math.abs(e.deltaY) >= Math.abs(e.deltaX)) zoomAt(Math.exp(-e.deltaY * (e.ctrlKey ? .01 : .0015)), e.clientX - r.left, e.clientY - r.top);
      else { view.x -= e.deltaX; applyView(); }
    }, { passive: false });
    const pts = new Map(); let drag = null, moved = false, pinch = null;
    stage.addEventListener("pointerdown", e => {
      if (e.target.closest("button,input,select,a")) return;
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      try { stage.setPointerCapture(e.pointerId); } catch (_) {}
      if (pts.size === 1) { drag = { x: e.clientX, y: e.clientY, vx: view.x, vy: view.y }; moved = false; }
      if (pts.size === 2) { const [a, b] = [...pts.values()]; pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), k: view.k }; moved = true; }
    });
    stage.addEventListener("pointermove", e => {
      if (!pts.has(e.pointerId)) return;
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pinch && pts.size === 2) {
        const [a, b] = [...pts.values()], r = stage.getBoundingClientRect();
        zoomAt((pinch.k * Math.hypot(a.x - b.x, a.y - b.y) / pinch.d) / view.k, (a.x + b.x) / 2 - r.left, (a.y + b.y) / 2 - r.top); return;
      }
      if (!drag) return;
      const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
      if (Math.abs(dx) + Math.abs(dy) > 4) { moved = true; stage.classList.add("dragging"); }
      view.x = drag.vx + dx; view.y = drag.vy + dy; applyView();
    });
    const end = e => {
      if (!pts.has(e.pointerId)) return;
      pts.delete(e.pointerId);
      if (pts.size < 2) pinch = null;
      if (!pts.size) {
        stage.classList.remove("dragging");
        if (!moved && e.type === "pointerup") {
          const n = document.elementFromPoint(e.clientX, e.clientY)?.closest?.(".node");
          if (n) api.select(n.dataset.id === selected ? null : n.dataset.id);
          else if (selected && !focus) api.select(null);
        }
        drag = null;
      }
    };
    stage.addEventListener("pointerup", end);
    stage.addEventListener("pointercancel", end);
    gNodes.addEventListener("keydown", e => {
      const n = e.target.closest(".node");
      if (n && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); api.select(n.dataset.id); }
    });

    const api = {
      el, NW, NH,
      get people() { return all; },
      get shown() { return shown; },
      get selected() { return selected; },
      get focus() { return focus; },
      get rel() { return relations(all); },
      genOf: id => L.gen[id],
      get rows() { return L.rows; },
      setPeople(map, { keepView } = {}) {
        const first = !all.size && map.size;
        all = map;
        if (selected && !all.has(selected)) selected = null;
        rebuild(keepView && !first);
      },
      select(id, { center } = {}) {
        selected = id && all.has(id) ? id : null;
        if (focus) { rebuild(false); if (selected) centerOn(selected); }
        else { paint(); if (center && selected) centerOn(selected); }
        opts.onSelect?.(selected, api);
      },
      setFocus(on) { focus = !!on; rebuild(false); if (focus && selected) centerOn(selected); },
      setOrient(o) { orient = o; rebuild(false); },
      setMode(m) { mode = m; rebuild(false); if (selected) centerOn(selected); },
      setCrown({ span = 180, trunk = true } = {}) { SPAN = span * Math.PI / 180; showTrunk = trunk; if (mode === "tree") { rebuild(false); if (selected) centerOn(selected); } },
      get mode() { return mode; },
      setQuery(q) { query = (q || "").trim().toLowerCase(); paint(); },
      matches() { return [...shown.keys()].filter(id => matches(shown.get(id))).sort(R.order); },
      setDim(fn) { dimFn = fn; paint(); },
      fit: () => fit(), centerOn,
      zoom: f => { const r = stage.getBoundingClientRect(); zoomAt(f, r.width / 2, r.height / 2); },
    };
    return api;
  }

  window.FamilyTree = { create, el };
})();
