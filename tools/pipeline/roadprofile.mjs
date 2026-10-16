// Height profile of the road graph: on the ground, except bridges and the elevated expressway, which
// are lifted to a clearance by OSM layer. Their approaches are raised into ramps where the graph allows:
// a node also used by an ordinary street stays on the ground, so ramps always land.

const CLEARANCE = [0, 6.5, 11.5, 16.5, 21.5]; // road level above the ground under a bridge, by layer
const MAX_GRADE = 0.06;

// In Istanbul, any bridge or layer>=1 road is elevated clear of the streets below.
export const flyover = (e) => !e.tunnel && (!!e.bridge || (e.layer != null && e.layer >= 1));
export const elevatable = (e) => !e.tunnel && (flyover(e) || e.highway.startsWith('motorway') || e.highway.startsWith('trunk') || e.highway.endsWith('_link'));

const SPAN_DIP = 2.5;
export const BANK = 14; // metres beyond each end of a span that still belong to the bridge approach

// Returns { level: Map node id -> road level, spans: Set of edges that are bank-to-bank bridges }.
export function profileRoads(edges, pos, ground) {
  const y = new Map(), pinned = new Set(), spans = new Set();
  const g = (id) => { const p = pos(id); return ground(p[0], p[1]); };

  // Identify all nodes that belong to bridges or elevated flyovers
  const bridgeNodes = new Set();
  for (const e of edges) {
    if (flyover(e)) {
      for (const id of e.ids) bridgeNodes.add(id);
    }
  }

  // Build adjacency among elevatable edges for ramp slope propagation
  const adj = new Map();
  for (const e of edges) {
    if (!elevatable(e)) continue;
    for (let i = 1; i < e.ids.length; i++) {
      const u = e.ids[i - 1], v = e.ids[i];
      const pu = pos(u), pv = pos(v);
      const d = Math.hypot(pv[0] - pu[0], pv[1] - pu[1]);
      if (!adj.has(u)) adj.set(u, []);
      if (!adj.has(v)) adj.set(v, []);
      adj.get(u).push({ to: v, dist: d });
      adj.get(v).push({ to: u, dist: d });
    }
  }

  // BFS outwards from all bridge nodes up to 130m along elevatable edges
  const rampNodes = new Set(bridgeNodes);
  const distToBridge = new Map();
  const queue = [];
  for (const bId of bridgeNodes) {
    distToBridge.set(bId, 0);
    queue.push(bId);
  }

  const MAX_RAMP_DIST = 130; // 130m ramp allows smooth 5-6% slope from ground to 6.5m bridge
  let head = 0;
  while (head < queue.length) {
    const u = queue[head++];
    const dU = distToBridge.get(u);
    for (const neighbor of adj.get(u) ?? []) {
      const nDist = dU + neighbor.dist;
      if (nDist <= MAX_RAMP_DIST && (!distToBridge.has(neighbor.to) || nDist < distToBridge.get(neighbor.to))) {
        distToBridge.set(neighbor.to, nDist);
        rampNodes.add(neighbor.to);
        queue.push(neighbor.to);
      }
    }
  }

  // Set initial heights and determine pinned ground nodes
  for (const e of edges) {
    const isFly = flyover(e);
    const lift = isFly ? CLEARANCE[Math.max(1, Math.min(4, e.layer || 1))] : 0;
    for (const id of e.ids) {
      y.set(id, Math.max(y.get(id) ?? -Infinity, g(id) + lift));
      // Ground nodes that are NOT bridge nodes and NOT in the ramp zone get pinned to ground
      if (!elevatable(e) && !e.tunnel && !rampNodes.has(id)) {
        pinned.add(id);
      }
      // On elevatable roads, nodes at the outer end of the ramp (> 100m away) or un-elevated are pinned
      if (!bridgeNodes.has(id) && (distToBridge.get(id) ?? Infinity) >= 110 && e.layer <= 0) {
        pinned.add(id);
      }
    }
  }

  // Pin true ground nodes (never pin bridge nodes or elevated roads)
  for (const id of pinned) {
    if (!bridgeNodes.has(id)) {
      y.set(id, g(id));
    }
  }

  // Segments for grade smoothing
  const segments = [];
  for (const e of edges) {
    if (!elevatable(e) || spans.has(e)) continue;
    for (let i = 1; i < e.ids.length; i++) {
      const a = pos(e.ids[i - 1]), b = pos(e.ids[i]), d = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (d > 0.01) segments.push([e.ids[i - 1], e.ids[i], d]);
    }
  }

  // Raise the lower end of any stretch that is too steep (never a pinned node), until nothing changes
  for (let pass = 0, changed = true; changed && pass < 300; pass++) {
    changed = false;
    for (const [a, b, d] of segments) {
      const ya = y.get(a), yb = y.get(b), max = MAX_GRADE * d;
      if (ya < yb - max - 1e-3 && !pinned.has(a) && !bridgeNodes.has(a)) {
        y.set(a, Math.max(g(a), yb - max));
        changed = true;
      } else if (yb < ya - max - 1e-3 && !pinned.has(b) && !bridgeNodes.has(b)) {
        y.set(b, Math.max(g(b), ya - max));
        changed = true;
      }
    }
  }

  return { level: y, spans };
}
