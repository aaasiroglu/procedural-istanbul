// Height profile of the road graph. Every OSM node gets one level, shared by all edges through it, so
// junctions never step. Roads lie on the ground; structures are classified and profiled by what they are:
//
//   span     a bridge over a dip (a valley, a river, the Bosphorus): a straight deck from bank to bank, the
//            banks' levels taken from the ground just beyond each end (the terrain model slumps into the dip)
//   viaduct  a bridge over streets or flat ground (overpasses, interchange ramps, elevated expressway): at least
//            a clearance above the highest ground beneath it, by OSM layer, then smoothed into vertical curves
//            that never dip under that clearance; its approach roads, if they are expressway or link roads,
//            become ramps that climb at a limited grade and land where an ordinary street joins
//   tunnel   between its portals, a smooth line underground
//
// A node also used by an ordinary street (not a structure, not a ramp-able road) stays on the ground: ramps
// always land, and the street grid is never lifted.

const CLEARANCE = [0, 5.5, 11, 16.5, 22]; // deck above the ground beneath a viaduct, by layer (1 = default)
const SPAN_DIP = 2.5;   // banks this much above the lowest ground under a bridge: it spans a dip
const RAMP_REACH = 260; // metres along expressway / link roads from a viaduct that may be raised into its ramp
export const BANK = 14; // metres beyond each end of a span that still belong to the bridge approach

const isLink = (e) => e.highway.endsWith('_link');
const expressway = (e) => e.highway.startsWith('motorway') || e.highway.startsWith('trunk');
const rampable = (e) => !e.bridge && !e.tunnel && (expressway(e) || isLink(e));
const maxGrade = (e) => (expressway(e) ? 0.055 : 0.07);

// Carried on its own structure above the streets (drawn by src/world/flyovers.js).
export const flyover = (e) => e.structure === 'viaduct';

// edges: graph edges ({ ids, bridge, tunnel, layer, highway, lanes }); pos: node id -> [x, z]; ground(x, z).
// Returns { level: Map node id -> road level, spans: Set of bank-to-bank bridge edges }, and marks each
// structure edge with e.structure.
export function profileRoads(edges, pos, ground) {
  const y = new Map(), spans = new Set();
  const g = (id) => { const p = pos(id); return ground(p[0], p[1]); };
  const dist = (a, b) => { const p = pos(a), q = pos(b); return Math.hypot(q[0] - p[0], q[1] - p[1]); };
  const incident = new Map();
  for (const e of edges) for (const id of e.ids) (incident.get(id) ?? incident.set(id, []).get(id)).push(e);
  for (const id of incident.keys()) y.set(id, g(id));

  // structures: connected groups of bridge edges (and of tunnel edges), joined where they share a node
  const groups = (pick) => {
    const parent = new Map(), find = (e) => { while (parent.get(e) !== e) e = parent.set(e, parent.get(parent.get(e))).get(e); return e; };
    const list = edges.filter(pick);
    for (const e of list) parent.set(e, e);
    for (const e of list) for (const id of e.ids) for (const o of incident.get(id)) if (parent.has(o)) parent.set(find(o), find(e));
    const out = new Map();
    for (const e of list) (out.get(find(e)) ?? out.set(find(e), []).get(find(e))).push(e);
    return [...out.values()];
  };
  const nodesOf = (group) => [...new Set(group.flatMap((e) => e.ids))];
  const ends = (group) => { // nodes where a group meets the rest of the network, or stops
    const members = new Set(group);
    return nodesOf(group).filter((id) => incident.get(id).some((o) => !members.has(o)) || (incident.get(id).length === 1 && (id === incident.get(id)[0].ids[0] || id === incident.get(id)[0].ids.at(-1))));
  };
  // segments of a set of edges: [a, b, length, edge]
  const segments = (list) => list.flatMap((e) => e.ids.slice(1).map((id, i) => [e.ids[i], id, dist(e.ids[i], id), e]).filter((s) => s[2] > 0.01));
  // Fill free nodes from fixed ones along the segments (weights 1/length): a linear profile along each chain.
  const harmonic = (segs, fixed, iterations = 400) => {
    const nb = new Map();
    for (const [a, b, d] of segs) { (nb.get(a) ?? nb.set(a, []).get(a)).push([b, 1 / d]); (nb.get(b) ?? nb.set(b, []).get(b)).push([a, 1 / d]); }
    for (let k = 0; k < iterations; k++) for (const [id, list] of nb) {
      if (fixed.has(id)) continue;
      let s = 0, w = 0;
      for (const [o, wt] of list) { s += y.get(o) * wt; w += wt; }
      if (w) y.set(id, s / w);
    }
  };
  const highestBeneath = (id, r = 10) => { // the highest ground under a deck point (its own width, and a little)
    const [x, z] = pos(id);
    let top = ground(x, z);
    for (const [dx, dz] of [[r, 0], [-r, 0], [0, r], [0, -r], [r * 0.7, r * 0.7], [-r * 0.7, -r * 0.7], [r * 0.7, -r * 0.7], [-r * 0.7, r * 0.7]]) top = Math.max(top, ground(x + dx, z + dz));
    return top;
  };

  // ---- bridges
  const viaductMin = new Map(); // node -> lowest level allowed (ground + clearance) on viaducts
  const fixed = new Set();
  for (const group of groups((e) => e.bridge && !e.tunnel)) {
    const members = new Set(group), groupEnds = ends(group);
    // each end's bank: the highest ground along the road for BANK metres beyond it
    const bank = new Map();
    for (const id of groupEnds) {
      const e = incident.get(id).find((o) => members.has(o));
      const i = e.ids.indexOf(id), q = pos(e.ids[i === 0 ? 1 : i - 1] ?? id), p = pos(id);
      const len = Math.hypot(p[0] - q[0], p[1] - q[1]) || 1, dx = (p[0] - q[0]) / len, dz = (p[1] - q[1]) / len;
      let top = ground(p[0], p[1]);
      for (let d = 3.5; d <= BANK; d += 3.5) top = Math.max(top, ground(p[0] + dx * d, p[1] + dz * d));
      bank.set(id, top);
    }
    let low = Infinity, below = 0;
    for (const [a, b, d] of segments(group)) {
      const p = pos(a), q = pos(b);
      for (let s = 0; s <= d; s += 3) low = Math.min(low, ground(p[0] + ((q[0] - p[0]) * s) / d, p[1] + ((q[1] - p[1]) * s) / d));
    }
    // a span: every bank stands above the dip, and the straight deck between the banks clears the ground
    const span = groupEnds.length >= 2 && Math.min(...groupEnds.map((id) => bank.get(id))) - low > SPAN_DIP;
    if (span) {
      for (const id of groupEnds) { y.set(id, bank.get(id)); fixed.add(id); }
      harmonic(segments(group), fixed);
      const clears = nodesOf(group).every((id) => y.get(id) >= g(id) + 0.5);
      if (clears) {
        for (const e of group) { e.structure = 'span'; spans.add(e); }
        for (const id of nodesOf(group)) fixed.add(id);
        continue;
      }
      for (const id of groupEnds) fixed.delete(id);
    }
    // A bridge whose every end is held on the ground by an ordinary street, with no expressway or link road to
    // ramp up on, cannot climb to a clearance: it is a street-level bridge (over a stream, or over a road
    // sunk in a cutting), straight between its ends.
    if (groupEnds.length >= 2 && groupEnds.every((id) => incident.get(id).some((o) => !members.has(o) && !o.bridge && !o.tunnel && !rampable(o)))) {
      for (const id of groupEnds) fixed.add(id);
      harmonic(segments(group), fixed);
      for (const id of nodesOf(group)) { y.set(id, Math.max(y.get(id), g(id))); fixed.add(id); }
      for (const e of group) { e.structure = 'span'; spans.add(e); }
      continue;
    }
    const clear = CLEARANCE[Math.max(1, Math.min(4, Math.max(...group.map((e) => e.layer || 1))))];
    for (const e of group) e.structure = 'viaduct';
    for (const id of nodesOf(group)) if (!groupEnds.includes(id) || incident.get(id).every((o) => members.has(o) || rampable(o))) viaductMin.set(id, Math.max(viaductMin.get(id) ?? -Infinity, highestBeneath(id) + clear));
  }

  // ---- ramps: expressway and link roads within reach of a viaduct may rise to meet it; a node any ordinary
  // street uses stays on the ground
  const onGround = (id) => incident.get(id).some((e) => !e.bridge && !e.tunnel && !rampable(e));
  const reach = new Map();
  const queue = [...viaductMin.keys()].filter((id) => !onGround(id));
  for (const id of queue) reach.set(id, 0);
  for (let h = 0; h < queue.length; h++) {
    const u = queue[h];
    for (const e of incident.get(u)) {
      if (!rampable(e)) continue;
      const i = e.ids.indexOf(u);
      for (const j of [i - 1, i + 1]) {
        const v = e.ids[j];
        if (v === undefined) continue;
        const d = reach.get(u) + dist(u, v);
        if (d <= RAMP_REACH && !(reach.get(v) <= d)) { reach.set(v, d); if (!onGround(v)) queue.push(v); }
      }
    }
  }
  const structural = edges.filter((e) => e.structure === 'viaduct' || (rampable(e) && e.ids.some((id) => reach.has(id))));
  const segs = segments(structural);
  const free = (id) => !fixed.has(id) && !onGround(id) && (viaductMin.has(id) || (reach.has(id) && reach.get(id) < RAMP_REACH));
  // No deck can be higher than the climb from the nearest node held on the ground allows: a clearance asked for
  // a few metres from a landed end is capped to a ramp at the grade limit (Dijkstra from every held node).
  const nbAll = new Map();
  for (const [a, b, d, e] of segs) { (nbAll.get(a) ?? nbAll.set(a, []).get(a)).push([b, d, e]); (nbAll.get(b) ?? nbAll.set(b, []).get(b)).push([a, d, e]); }
  const cap = new Map(), heap = [];
  for (const id of nbAll.keys()) if (!free(id)) { cap.set(id, y.get(id)); heap.push([y.get(id), id]); }
  heap.sort((p, q) => p[0] - q[0]);
  for (let h = 0; h < heap.length; h++) { // (a sorted queue is enough at this size)
    const [c, u] = heap[h];
    if (c > cap.get(u)) continue;
    for (const [v, d, e] of nbAll.get(u)) {
      const cv = c + maxGrade(e) * d;
      if (!(cap.get(v) <= cv)) { cap.set(v, cv); let k = heap.length; heap.push([cv, v]); while (k > h + 1 && heap[k - 1][0] > cv) { heap[k] = heap[k - 1]; k--; } heap[k] = [cv, v]; }
    }
  }
  const floor = (id) => Math.min(viaductMin.get(id) ?? g(id), cap.get(id) ?? Infinity);
  for (const [a, b] of segs) for (const id of [a, b]) if (free(id)) y.set(id, Math.max(y.get(id), floor(id)));

  // Grade limits by raising the lower end, alternating with smoothing that never dips under the floor:
  // the deck settles into vertical curves.
  const nb = new Map();
  for (const [a, b, d] of segs) { (nb.get(a) ?? nb.set(a, []).get(a)).push([b, d]); (nb.get(b) ?? nb.set(b, []).get(b)).push([a, d]); }
  for (let pass = 0; pass < 120; pass++) {
    for (let k = 0, changed = true; changed && k < 60; k++) {
      changed = false;
      for (const [a, b, d, e] of segs) {
        const ya = y.get(a), yb = y.get(b), max = maxGrade(e) * d;
        if (ya < yb - max - 1e-3 && free(a)) { y.set(a, yb - max); changed = true; }
        else if (yb < ya - max - 1e-3 && free(b)) { y.set(b, ya - max); changed = true; }
      }
    }
    for (const [id, list] of nb) {
      if (!free(id) || list.length !== 2) continue;
      const [[p, dp], [q, dq]] = list, mid = (y.get(p) * dq + y.get(q) * dp) / (dp + dq);
      y.set(id, Math.max(floor(id), 0.5 * y.get(id) + 0.5 * mid));
    }
  }

  // ---- tunnels: a smooth line between the portals, kept under the ground
  for (const group of groups((e) => e.tunnel)) {
    const portals = new Set(ends(group));
    for (const e of group) e.structure = 'tunnel';
    harmonic(segments(group), portals);
    // under the ground by up to 4 m, deepening no faster than 12 % from the nearest portal
    for (const id of nodesOf(group)) {
      if (portals.has(id)) continue;
      const fromPortal = Math.min(...[...portals].map((p) => dist(p, id)));
      y.set(id, Math.min(y.get(id), g(id) - Math.min(4, 0.12 * fromPortal)));
    }
  }
  return { level: y, spans };
}

// Rounds the corners of an elevated road's polyline (Chaikin, two passes) keeping its first and last point,
// so decks and the cars on them follow curves rather than OSM's chords. pts: flat [x, y, z, ...].
export function smoothCurve(pts, passes = 2) {
  let p = [];
  for (let i = 0; i < pts.length; i += 3) p.push([pts[i], pts[i + 1], pts[i + 2]]);
  for (let k = 0; k < passes && p.length > 2; k++) {
    const out = [p[0]];
    for (let i = 0; i + 1 < p.length; i++) {
      const a = p[i], b = p[i + 1], l = (u, v, t) => u.map((c, j) => c + (v[j] - c) * t);
      if (i > 0) out.push(l(a, b, 0.25));
      if (i + 2 < p.length) out.push(l(a, b, 0.75));
    }
    out.push(p.at(-1));
    p = out;
  }
  return p.flat();
}
