// City compiler: raw OSM / terrain / İBB data -> streaming tiles in public/tiles/<area>/.
//   manifest.json   area, origin, bounds, tile list, terrain grid description, attribution
//   terrain.bin     Float32 height grid (TP metres), row-major, rows run north -> south (+z)
//   t_<x>_<z>.bin   per 256 m tile: buildings, ground surfaces (roads, paint, parks, water), props (trees,
//                   poles, lights, signals) and wires (format: src/shared/tileformat.js)
//   roads.json      drivable road graph from OSM (junction nodes + polyline edges; y = road level, above the
//                   ground on bridges and the elevated expressway)
//   structures.json footbridges, station platforms and canopies (tools/pipeline/extras.mjs)
//   rails.json      surface and elevated railway lines from OSM, with their height profile (y = track bed)
// Usage: node tools/pipeline/compile.mjs [--area=koridor] [--no-ads]   (--no-ads: leave out the invented billboards, screens and banners)
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { resolveArea, ROOT } from './config.mjs';
import { makeProjection, TILE, tileOf, tileKey } from '../../src/shared/geo.js';
import { encodeTile, AREA, BFLAG, PROP, VERSION } from '../../src/shared/tileformat.js';
import { readOsm, buildRoadGraph, fuseIbbRoads, buildRailways } from './osm.mjs';
import { buildHeightGrid, sampleGrid } from './terrain.mjs';
import { AREAS } from './config.mjs';
import { PolyIndex, readLand, clipRing, placeProps } from './landscape.mjs';
import { buildMarkings } from './markings.mjs';
import { profileRailways } from './rails.mjs';
import { readPlaces, placeSigns, placeAds } from './signs.mjs';
import { placeFurniture } from './furniture.mjs';
import { readExtra, buildExtras } from './extras.mjs';
import { SPORT, MATERIAL } from '../../src/shared/tileformat.js';
import { inRings } from './landscape.mjs';
import { profileRoads, flyover, smoothCurve, BANK } from './roadprofile.mjs';
import { DECK_FLAG, CORRIDOR_MARGIN, projectOnDeck } from '../../src/shared/decks.js';

const TERRAIN_STEP = 5; // metres

const area = resolveArea();
const proj = makeProjection(...area.origin);
const t0 = Date.now();
const log = (...a) => console.log(((Date.now() - t0) / 1000).toFixed(1).padStart(6) + 's', ...a);

const [minX, maxZ] = proj.project(area.bbox.west, area.bbox.south);
const [maxX, minZ] = proj.project(area.bbox.east, area.bbox.north);
const bounds = { minX, maxX, minZ, maxZ };
const inBounds = (x, z) => x >= minX && x <= maxX && z >= minZ && z <= maxZ;
log(`area ${area.id}: ${(maxX - minX).toFixed(0)} x ${(maxZ - minZ).toFixed(0)} m around [${area.origin}]`);
const ibbGdb = path.join(ROOT, 'data/ibb-local/network.gdb');
const ibbNetworkFile = path.join(area.rawDir, 'ibb_network.geojson');
if (fs.existsSync(ibbGdb)) {
  execFileSync(process.env.PYTHON ?? 'python', [
    path.join(ROOT, 'tools/pipeline/ibb_network.py'), '--gdb', ibbGdb,
    '--bbox', `${area.bbox.west},${area.bbox.south},${area.bbox.east},${area.bbox.north}`,
    '--output', ibbNetworkFile,
  ], { cwd: ROOT, stdio: 'inherit' });
}

// ---------------------------------------------------------------- geometry helpers
const r2 = (v) => Math.round(v * 100) / 100;
// Signed area seen from above, positive = counter-clockwise (x east, -z north).
const areaEN = (ring) => {
  let s = 0;
  for (let i = 0, n = ring.length; i < n; i++) {
    const [x1, z1] = ring[i], [x2, z2] = ring[(i + 1) % n];
    s += x2 * z1 - x1 * z2;
  }
  return s / 2;
};

// lon/lat ring -> clean world ring: closing point dropped, near-duplicate and collinear points removed.
function cleanRing(ll) {
  let pts = ll.map(([lon, lat]) => proj.project(lon, lat)).map(([x, z]) => [r2(x), r2(z)]);
  if (pts.length > 1) { const [a, b] = [pts[0], pts.at(-1)]; if (Math.hypot(a[0] - b[0], a[1] - b[1]) < 0.02) pts.pop(); }
  pts = pts.filter((p, i) => { const q = pts[(i + pts.length - 1) % pts.length]; return Math.hypot(p[0] - q[0], p[1] - q[1]) >= 0.02; });
  for (let changed = true; changed && pts.length > 3;) {
    changed = false;
    for (let i = 0; i < pts.length; i++) {
      const a = pts[(i + pts.length - 1) % pts.length], b = pts[i], c = pts[(i + 1) % pts.length];
      const cross = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
      const len = Math.hypot(c[0] - a[0], c[1] - a[1]);
      if (Math.abs(cross) / Math.max(len, 1e-6) < 0.01) { pts.splice(i, 1); changed = true; break; }
    }
  }
  return pts.length >= 3 ? pts : null;
}

// OSM already stores projected coordinates for us. Use the same cleanup logic, without reprojecting them.
function cleanWorldRing(pts) {
  let ring = pts.map(([x, z]) => [r2(x), r2(z)]);
  if (ring.length > 1) { const [a, b] = [ring[0], ring.at(-1)]; if (Math.hypot(a[0] - b[0], a[1] - b[1]) < 0.02) ring.pop(); }
  ring = ring.filter((p, i) => { const q = ring[(i + ring.length - 1) % ring.length]; return Math.hypot(p[0] - q[0], p[1] - q[1]) >= 0.02; });
  for (let changed = true; changed && ring.length > 3;) {
    changed = false;
    for (let i = 0; i < ring.length; i++) {
      const a = ring[(i + ring.length - 1) % ring.length], b = ring[i], c = ring[(i + 1) % ring.length];
      const cross = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
      const len = Math.hypot(c[0] - a[0], c[1] - a[1]);
      if (Math.abs(cross) / Math.max(len, 1e-6) < 0.01) { ring.splice(i, 1); changed = true; break; }
    }
  }
  return ring.length >= 3 ? ring : null;
}

// [[outer, ...holes]] in lon/lat -> world polygons with outer CCW and holes CW; drops slivers.
function cleanPolygons(polys, minArea = 0.5) {
  const out = [];
  for (const rings of polys) {
    const outer = cleanRing(rings[0]);
    if (!outer || Math.abs(areaEN(outer)) < minArea) continue;
    if (areaEN(outer) < 0) outer.reverse();
    const holes = [];
    for (const h of rings.slice(1)) {
      const ring = cleanRing(h);
      if (!ring || Math.abs(areaEN(ring)) < 0.1) continue;
      if (areaEN(ring) > 0) ring.reverse();
      holes.push(ring);
    }
    out.push([outer, ...holes]);
  }
  return out;
}

const centroidOf = (polys) => {
  let sx = 0, sz = 0, sa = 0;
  for (const [outer] of polys) {
    const a = Math.abs(areaEN(outer));
    const cx = outer.reduce((s, p) => s + p[0], 0) / outer.length, cz = outer.reduce((s, p) => s + p[1], 0) / outer.length;
    sx += cx * a; sz += cz * a; sa += a;
  }
  return [sx / sa, sz / sa];
};

// ---------------------------------------------------------------- terrain
const grid = buildHeightGrid(path.join(area.rawDir, 'dem'), proj, bounds, TERRAIN_STEP);
let gMin = Infinity, gMax = -Infinity;
for (const v of grid.data) { gMin = Math.min(gMin, v); gMax = Math.max(gMax, v); }
log(`terrain ${grid.w} x ${grid.h} @ ${TERRAIN_STEP} m, ${gMin.toFixed(1)}..${gMax.toFixed(1)} m TP` +
  ` (${grid.stats.fallback} cells from dem10b, ${grid.stats.holes} filled)`);
const ground = (x, z) => sampleGrid(grid, x, z);

// ---------------------------------------------------------------- tiles
const tiles = new Map();
const tileFor = (x, z) => {
  const [tx, tz] = tileOf(x, z), k = tileKey(tx, tz);
  if (!tiles.has(k)) tiles.set(k, { tx, tz, buildings: [], areas: [], props: [], wires: [], walls: [], signs: [] });
  return tiles.get(k);
};
// Point-in-polygon indexes used to place paint, trees and street furniture.
const idx = { building: new PolyIndex(), road: new PolyIndex(), carriageway: new PolyIndex(), sidewalk: new PolyIndex(), water: new PolyIndex() };
const bstats = { heights: [], usage: {} };

// ---------------------------------------------------------------- OSM
const osm = readOsm(path.join(area.rawDir, 'osm.json'));
const graph = buildRoadGraph(osm, proj.project, inBounds);
const ibbFeatures = fs.existsSync(ibbNetworkFile) ? JSON.parse(fs.readFileSync(ibbNetworkFile, 'utf8')).features : [];
const fusion = fuseIbbRoads(graph.edges, ibbFeatures, proj.project, graph.pos, r2);
log(`road data fusion: ${fusion.matched}/${graph.edges.length} OSM edges matched to ${fusion.candidates} local IBB segments; OSM tags retained`);
// road level per node: the ground, or above it on bridges and the elevated expressway
const { level, spans } = profileRoads(graph.edges, graph.pos, ground);
const roadsOut = {
  nodes: graph.nodes.map(({ id, p }) => [r2(p[0]), r2(level.get(id) ?? ground(p[0], p[1])), r2(p[1])]),
  edges: graph.edges.map((edge) => {
    edge.span = spans.has(edge) ? 1 : 0; // a street-level bridge: treated as an ordinary road from here on
    edge.flyover = flyover(edge) ? 1 : 0; // carried on its own structure above the streets
    const { ids, way, spanLength, spanEnds, structure, ...e } = edge;
    let pts = ids.flatMap((id) => { const [x, z] = graph.pos(id); return [x, level.get(id), z]; });
    // elevated roads (viaducts and the ramps raised to them) follow rounded curves, not OSM's chords
    const raised = ids.some((id) => { const [x, z] = graph.pos(id); return level.get(id) - ground(x, z) > 0.5; });
    if (structure === 'viaduct' || (raised && !edge.span && !edge.tunnel)) pts = smoothCurve(pts);
    return { ...e, way, pts: pts.map(r2) };
  }),
};
const byClass = {};
let km = 0;
for (const e of graph.edges) {
  let len = 0;
  for (let i = 1; i < e.ids.length; i++) { const p = graph.pos(e.ids[i - 1]), q = graph.pos(e.ids[i]); len += Math.hypot(q[0] - p[0], q[1] - p[1]); }
  byClass[e.highway] = (byClass[e.highway] ?? 0) + len / 1000; km += len / 1000;
}
log(`road graph (OSM): ${roadsOut.nodes.length} nodes, ${roadsOut.edges.length} edges, ${km.toFixed(1)} km`);
log(`  ${Object.entries(byClass).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v.toFixed(1)}`).join(', ')}`);
log(`  bridges ${roadsOut.edges.filter((e) => e.bridge).length}, tunnels ${roadsOut.edges.filter((e) => e.tunnel).length}, oneway ${roadsOut.edges.filter((e) => e.oneway).length}`);
// The deck line runs BANK metres past each end, level, to cover the ground that slumps towards the dip.
const decks = roadsOut.edges.filter((e) => e.span).map((e) => {
  const p = e.pts, n = p.length;
  const out = (i, j) => { // point BANK metres beyond point i, away from point j
    const len = Math.hypot(p[i] - p[j], p[i + 2] - p[j + 2]) || 1;
    return [r2(p[i] + ((p[i] - p[j]) / len) * BANK), p[i + 1], r2(p[i + 2] + ((p[i + 2] - p[j + 2]) / len) * BANK)];
  };
  return { pts: [...out(0, 3), ...p, ...out(n - 3, n - 6)], half: Math.max(1, e.lanes) * 1.65 + CORRIDOR_MARGIN };
});
// Under a road bridge the terrain model shows the bridge, not the track bed below it.
const underBridge = (x, z) => decks.some((d) => { const p = projectOnDeck(d, x, z); return p.inside && p.dist <= d.half - CORRIDOR_MARGIN + 6; });
const rails = profileRailways(buildRailways(osm, proj.project, inBounds), ground, inBounds, underBridge, () => undefined);
// Station buildings stand over the tracks as solid blocks. Record where each track
// crosses a building outline so the client can put a tunnel mouth there: [x, y, z, dirX, dirZ], pointing in.
let portals = 0;
for (const line of rails) {
  const p = line.pts; // (line.portals already holds the tunnel mouths)
  for (let i = 3; i < p.length; i += 3) {
    const len = Math.hypot(p[i] - p[i - 3], p[i + 2] - p[i - 1]);
    if (len < 0.01) continue;
    const at = (d) => [p[i - 3] + ((p[i] - p[i - 3]) * d) / len, p[i - 2] + ((p[i + 1] - p[i - 2]) * d) / len, p[i - 1] + ((p[i + 2] - p[i - 1]) * d) / len];
    let was = idx.building.has(p[i - 3], p[i - 1]);
    for (let d = 0.5; d <= len; d += 0.5) {
      const q = at(Math.min(d, len)), now = idx.building.has(q[0], q[2]);
      if (now !== was) {
        const s = now ? 1 : -1; // direction pointing into the building
        line.portals.push([r2(q[0]), r2(q[1]), r2(q[2]), r2((s * (p[i] - p[i - 3])) / len), r2((s * (p[i + 2] - p[i - 1])) / len)]);
        portals++; was = now;
      }
    }
  }
}
log(`railways: ${portals} portals where tracks pass through buildings`);
log(`railways (OSM): ${rails.length} lines (${rails.filter((r) => r.bridge).length} elevated sections, ${rails.filter((r) => r.deck.length).length} on surveyed decks)`);

const extraRaw = readExtra(path.join(area.rawDir, 'osm_extra.json'), proj.project);
const lampFile = path.join(area.rawDir, 'osm_lights.json');
if (fs.existsSync(lampFile)) {
  const knownPoints = new Set(extraRaw.points.map((p) => p.id));
  for (const e of JSON.parse(fs.readFileSync(lampFile, 'utf8')).elements) {
    if (e.type !== 'node' || knownPoints.has(e.id)) continue;
    const [x, z] = proj.project(e.lon, e.lat);
    extraRaw.points.push({ id: e.id, tags: e.tags ?? {}, x, z });
  }
}

// Buildings: extruded from the OSM building polygons.
//
// OSM's Simple 3D Buildings: a complex mapped as building:part ways (a podium, its towers, each with its own
// height and min_height) is drawn from its parts, and its outline (the building=* way around them) is not drawn,
// or a mall's whole footprint would rise to its tallest tower's height.
{
  const ringOf = (w) => {
    if (!w.closed || w.pts.length < 4) return null;
    const polygon = cleanWorldRing(w.pts);
    if (!polygon || Math.abs(areaEN(polygon)) < 0.5) return null;
    return areaEN(polygon) > 0 ? polygon : polygon.reverse();
  };
  const inside = (x, z, ring) => {
    let c = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [xi, zi] = ring[i], [xj, zj] = ring[j];
      if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) c = !c;
    }
    return c;
  };
  const num = (v) => { const f = parseFloat(v); return Number.isFinite(f) ? f : NaN; };
  // Below ground, not a building one sees: metro stations and their halls (location=underground, or a station,
  // car park or service structure on a negative layer), anything in a tunnel. A negative layer alone is not
  // enough: in Istanbul hundreds of ordinary blocks on slopes carry layer=-1.
  const underground = (t) => t.location === 'underground' || t.location === 'indoor' || !!t.tunnel
    || (parseFloat(t.layer) < 0 && (['train_station', 'transportation', 'parking', 'service', 'station'].includes(t.building) || !!t.railway || !!t.public_transport || t.station === 'subway'))
    || (parseInt(t['building:min_level'], 10) < 0 && !(parseInt(t['building:levels'], 10) > 0))
    || !!t['bridge:support'] || t.man_made === 'bridge'; // (a bridge's towers and piers: src/world/flyovers.js draws those)
  let buried = 0;
  const parts = [];
  for (const w of extraRaw.ways) {
    const t = w.tags;
    if (!t || !t['building:part'] || t['building:part'] === 'no' || underground(t)) continue;
    const ring = ringOf(w);
    if (ring) parts.push({ w, ring, c: centroidOf([[ring]]) });
  }
  const outlines = [];
  for (const w of extraRaw.ways) {
    const t = w.tags;
    if (!t || !t.building || t.building === 'no' || t.building === 'roof' || t['building:part']) continue;
    if (underground(t)) { buried++; continue; }
    const ring = ringOf(w);
    if (!ring) continue;
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    for (const [x, z] of ring) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z); }
    outlines.push({ w, ring, box: [x0, x1, z0, z1], parts: 0 });
  }
  // each part belongs to the outline around its centroid (if any: parts are sometimes mapped without one)
  for (const p of parts) {
    const [x, z] = p.c;
    p.parent = outlines.find((o) => x >= o.box[0] && x <= o.box[1] && z >= o.box[2] && z <= o.box[3] && inside(x, z, o.ring));
    if (p.parent) p.parent.parts++;
  }

  // One extruded building from a ring, its tags, and (for a part) the outline's tags beneath them.
  const extrude = (id, tags, ring) => {
    const polys = [ring];
    const [cx, cz] = centroidOf([polys]);
    if (!inBounds(cx, cz)) return false;
    // Istanbul: most footprints are only building=yes, without levels. A footprint that size is in Istanbul is
    // almost always an apartment block of 4 to 8 storeys (a stable pick per way, so it does not change between
    // compiles); small ones are houses or sheds; mosques, schools and the like keep their own kind.
    const kind = tags.building, footprint = Math.abs(areaEN(ring));
    const religious = kind === 'mosque' || tags.amenity === 'place_of_worship' || kind === 'religious';
    const pick = (lo, hi) => lo + (Number(String(id).slice(-4)) % (hi - lo + 1));
    const small = footprint < 90 || kind === 'house' || kind === 'detached' || kind === 'shed' || kind === 'garage';
    const levels = parseInt(tags['building:levels'], 10);
    const storeys = levels || (religious ? 2 : small ? pick(1, 3) : kind === 'office' ? pick(6, 14) : pick(4, 8));
    const top = num(tags.height) || storeys * 3.1;
    const bottom = num(tags.min_height) || (parseInt(tags['building:min_level'], 10) || 0) * 3.1;
    const height = top - bottom;
    if (!(height > 0.5)) return false;
    const usage = religious ? 441
      : kind === 'office' ? 401 : (kind === 'commercial' || kind === 'retail') ? 402 : kind === 'hotel' ? 403
      : ['school', 'university', 'hospital', 'public', 'civic', 'government', 'college', 'kindergarten'].includes(kind) ? 421
      : ['industrial', 'warehouse'].includes(kind) ? 450
      : storeys <= 2 && small ? 411 : 412;
    bstats.heights.push(top);
    bstats.usage[usage] = (bstats.usage[usage] ?? 0) + 1;
    tileFor(cx, cz).buildings.push({
      usage, storeys: Math.max(1, Math.round(height / 3.1)), flags: BFLAG.NO_SOLID, base: r2(ground(cx, cz) + bottom),
      height: r2(height), measuredHeight: height, polygons: [polys], surfaces: [],
    });
    return true;
  };

  let made = 0, fromParts = 0, replaced = 0;
  for (const o of outlines) {
    if (o.parts) { replaced++; continue; }
    if (extrude(o.w.id, o.w.tags, o.ring)) made++;
  }
  for (const p of parts) {
    // the part's kind is its outline's (a tower of an office complex is an office); its size is its own only
    const { height, min_height, 'building:levels': _l, 'building:min_level': _m, ...inherited } = p.parent?.w.tags ?? {};
    const tags = { building: 'yes', ...inherited, ...p.w.tags };
    if (p.w.tags.building === undefined && inherited.building) tags.building = inherited.building;
    if (extrude(p.w.id, tags, p.ring)) fromParts++;
  }
  log(`buildings (OSM fallback): ${made} from footprints, ${fromParts} from the parts of ${replaced} complexes (their outlines not drawn), ${buried} underground structures left out`);
}

// ---------------------------------------------------------------- land cover, paint, props
const landRaw = readLand(path.join(area.rawDir, 'osm_land.json'));
const xz = (ll) => ll.map(([lon, lat]) => proj.project(lon, lat));
const land = landRaw.areas.map(({ kind, ring, code }) => {
  const r = xz(ring).slice(0, -1); // drop the closing point
  if (areaEN(r) < 0) r.reverse();
  return { kind, ring: r, code: kind === AREA.PITCH ? code : 0 };
}).filter((a) => a.ring.length >= 3 && Math.abs(areaEN(a.ring)) > 4);
for (const a of land) if (a.kind === AREA.WATER) idx.water.add([a.ring]);
idx.park = new PolyIndex(); // (paths in a park get lamps)
for (const a of land) if (a.kind === AREA.PARK) idx.park.add([a.ring]);
// Large areas (a park can span a kilometre) are cut at tile edges so they stream with their tile.
const lstats = {};
const pushClipped = (kind, ring, code = 0) => {
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  for (const [x, z] of ring) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z); }
  for (let tx = Math.floor(Math.max(x0, minX) / TILE); tx <= Math.floor(Math.min(x1, maxX) / TILE); tx++)
    for (let tz = Math.floor(Math.max(z0, minZ) / TILE); tz <= Math.floor(Math.min(z1, maxZ) / TILE); tz++) {
      const piece = clipRing(ring, tx * TILE, tz * TILE, (tx + 1) * TILE, (tz + 1) * TILE);
      if (!piece || Math.abs(areaEN(piece)) < 1) continue;
      tileFor((tx + 0.5) * TILE, (tz + 0.5) * TILE).areas.push({ kind, code, polygons: [[piece.map(([x, z]) => [r2(x), r2(z)])]] });
    }
};
const courtLines = [];
for (const { kind, ring, code } of land) {
  lstats[kind] = (lstats[kind] ?? 0) + 1;
  pushClipped(kind, ring, code);
  // a tennis court gets its lines: the outline, the net and the service boxes, fitted to the pitch
  if (kind === AREA.PITCH && code === SPORT.TENNIS) {
    let best = null;
    for (let i = 0; i < ring.length; i++) {
      const [ax, az] = ring[i], [bx, bz] = ring[(i + 1) % ring.length], len = Math.hypot(bx - ax, bz - az);
      if (!best || len > best.len) best = { len, dx: (bx - ax) / (len || 1), dz: (bz - az) / (len || 1) };
    }
    const cx = ring.reduce((s, p) => s + p[0], 0) / ring.length, cz = ring.reduce((s, p) => s + p[1], 0) / ring.length;
    const { dx, dz } = best, at = (u, v) => [cx + dx * u - dz * v, cz + dz * u + dx * v];
    const line = (u0, v0, u1, v1) => { const w = 0.05, along = Math.abs(u1 - u0) > Math.abs(v1 - v0); courtLines.push(along ? [at(u0, v0 - w), at(u1, v0 - w), at(u1, v0 + w), at(u0, v0 + w)] : [at(u0 - w, v0), at(u0 + w, v0), at(u0 + w, v1), at(u0 - w, v1)]); };
    const L = 11.885, W = 5.485, S = 4.115; // half length, half width (doubles), half width (singles)
    if ([at(-L, -W), at(L, -W), at(L, W), at(-L, W)].every(([x, z]) => inRings(x, z, [ring]))) { // only where a full court fits
      for (const v of [-W, -S, S, W]) line(-L, v, L, v);
      for (const u of [-L, -6.4, 0, 6.4, L]) line(u, Math.abs(u) === 6.4 ? -S : -W, u, Math.abs(u) === 6.4 ? S : W);
      line(-6.4, 0, 6.4, 0);
    }
  }
}
const kindName = Object.fromEntries(Object.entries(AREA).map(([k, v]) => [v, k.toLowerCase()]));
log(`land cover (OSM): ${Object.entries(lstats).map(([k, v]) => `${kindName[k]} ${v}`).join(', ')}`);

const worldLand = {
  stops: extraRaw.points.filter((p) => p.tags.highway === 'stop').map((p) => p.id),
  crossings: landRaw.crossings.map(xz), signals: landRaw.signals,
  crossingNodes: landRaw.crossingNodes,
};
// Derive tiled asphalt and explicitly mapped sidewalks from OSM.
let osmRoadPatches = 0, osmSidewalkPatches = 0;
const addRoadPatch = (kind, ring, index) => {
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  for (const [x, z] of ring) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z); }
  for (let tx = Math.floor(Math.max(x0, minX) / TILE); tx <= Math.floor(Math.min(x1, maxX) / TILE); tx++)
    for (let tz = Math.floor(Math.max(z0, minZ) / TILE); tz <= Math.floor(Math.min(z1, maxZ) / TILE); tz++) {
      const piece = clipRing(ring, Math.max(tx * TILE, minX), Math.max(tz * TILE, minZ), Math.min((tx + 1) * TILE, maxX), Math.min((tz + 1) * TILE, maxZ));
      if (!piece || Math.abs(areaEN(piece)) < 0.2) continue;
      if (areaEN(piece) < 0) piece.reverse();
      const polygon = [piece.map(([x, z]) => [r2(x), r2(z)])];
      tileFor((tx + 0.5) * TILE, (tz + 0.5) * TILE).areas.push({ kind, code: 0, polygons: [polygon] });
      index.add(polygon);
      if (kind === AREA.CARRIAGEWAY) idx.road.add(polygon);
      if (kind === AREA.CARRIAGEWAY) osmRoadPatches++; else osmSidewalkPatches++;
    }
};
const sidewalkValue = (value) => value != null && !['no', 'none'].includes(value);
for (const edge of graph.edges) {
  if (edge.tunnel) continue;
  if (edge.flyover || edge.span) continue; // 3D elevated structure is generated by flyovers.js
  const pts = edge.ids.map(graph.pos);
  const width = Math.min(32, Math.max(3.5, edge.width ?? edge.lanes * 3));
  const half = width / 2;
  const baseSidewalk = ['yes', 'both'].includes(edge.sidewalk);
  const leftSidewalk = edge.sidewalkLeft != null ? sidewalkValue(edge.sidewalkLeft) : baseSidewalk || edge.sidewalk === 'left';
  const rightSidewalk = edge.sidewalkRight != null ? sidewalkValue(edge.sidewalkRight) : baseSidewalk || edge.sidewalk === 'right';
  const sidewalkWidth = Math.min(5, Math.max(1.2, edge.sidewalkWidth ?? 1.8));
  const strip = (a, b, halfWidth, offset = 0) => {
    const dx = b[0] - a[0], dz = b[1] - a[1], length = Math.hypot(dx, dz);
    if (length < 0.1) return;
    const nx = -dz / length, nz = dx / length;
    const cx = offset * nx, cz = offset * nz;
    addRoadPatch(offset ? AREA.SIDEWALK : AREA.CARRIAGEWAY, [
      [a[0] + cx + nx * halfWidth - dx / length * halfWidth, a[1] + cz + nz * halfWidth - dz / length * halfWidth],
      [b[0] + cx + nx * halfWidth + dx / length * halfWidth, b[1] + cz + nz * halfWidth + dz / length * halfWidth],
      [b[0] + cx - nx * halfWidth + dx / length * halfWidth, b[1] + cz - nz * halfWidth + dz / length * halfWidth],
      [a[0] + cx - nx * halfWidth - dx / length * halfWidth, a[1] + cz - nz * halfWidth - dz / length * halfWidth],
    ], offset ? idx.sidewalk : idx.carriageway);
  };
  for (let i = 1; i < pts.length; i++) {
    strip(pts[i - 1], pts[i], half);
    if (leftSidewalk) strip(pts[i - 1], pts[i], sidewalkWidth / 2, -(half + sidewalkWidth / 2));
    if (rightSidewalk) strip(pts[i - 1], pts[i], sidewalkWidth / 2, half + sidewalkWidth / 2);
  }
}
log(`road surfaces (OSM): ${osmRoadPatches} asphalt pieces, ${osmSidewalkPatches} mapped sidewalk pieces`);
const paint = buildMarkings({ edges: graph.edges, pos: graph.pos, idx, land: worldLand, inBounds });
for (const m of paint.marks) {
  const ring = m.ring.map(([x, z]) => [r2(x), r2(z)]);
  if (areaEN(ring) < 0) ring.reverse();
  const cx = ring.reduce((s, p) => s + p[0], 0) / 4, cz = ring.reduce((s, p) => s + p[1], 0) / 4;
  if (inBounds(cx, cz)) tileFor(cx, cz).areas.push({ kind: m.kind, code: 0, polygons: [[ring]] });
}
// Street-level bridges. Every road polygon touching a bridge's corridor is tied to that deck (the client
// holds it at deck level between the banks), and the edges of those polygons that face open air over the
// dip get a parapet.
const GROUND_KINDS = new Set([AREA.PARK, AREA.WOOD, AREA.WATER, AREA.PITCH]);
let deckAreas = 0, deckWalls = 0;
for (const t of tiles.values()) {
  for (const a of t.areas) {
    if (GROUND_KINDS.has(a.kind)) continue;
    const deck = decks.findIndex((d) => a.polygons.some((rings) => rings[0].some(([x, z]) => { const p = projectOnDeck(d, x, z); return p.inside && p.dist <= d.half; })));
    if (deck < 0) continue;
    a.code = DECK_FLAG | deck; deckAreas++;
    if (a.kind !== AREA.ROAD) continue;
    // outer rings only: a hole in a road outline is a median or a pier, not the edge of the bridge
    for (const [ring] of a.polygons) for (let i = 0; i < ring.length; i++) {
      const [ax, az] = ring[i], [bx, bz] = ring[(i + 1) % ring.length], len = Math.hypot(bx - ax, bz - az);
      if (len < 0.3) continue;
      const mx = (ax + bx) / 2, mz = (az + bz) / 2, p = projectOnDeck(decks[deck], mx, mz);
      if (!p.inside || p.y - ground(mx, mz) < 1.5) continue;                 // on the bank: no drop here
      // Open air beyond? road polygons can leave gaps of a few metres in the middle of a bridge, so
      // an edge counts as the side of the bridge only if no road surface follows within 9 m.
      const nx = -(bz - az) / len, nz = (bx - ax) / len;
      if ([0.5, 1.5, 3, 5, 7, 9].some((d) => idx.road.has(mx + nx * d, mz + nz * d)) || len < 1.5) continue;
      t.walls.push([ax, az, bx, bz, deck]); deckWalls++;
    }
  }
}
log(`street bridges: ${decks.length} decks, ${deckAreas} polygons on them, ${deckWalls} parapet segments`);

// ---- everything else OSM maps: paths, stairs, platforms, car parks, barriers, water, gates, small objects
const roadAt = new Map();
for (const e of graph.edges) e.ids.forEach((id, i) => {
  const p = graph.pos(e.ids[Math.max(0, i - 1)]), q = graph.pos(e.ids[Math.min(e.ids.length - 1, i + 1)]), l = Math.hypot(q[0] - p[0], q[1] - p[1]) || 1;
  roadAt.set(id, { dx: (q[0] - p[0]) / l, dz: (q[1] - p[1]) / l });
});
const extras = buildExtras(extraRaw, { idx, ground, inBounds, rails, roadAt });
const centre = (ring) => [ring.reduce((s, p) => s + p[0], 0) / ring.length, ring.reduce((s, p) => s + p[1], 0) / ring.length];
const rounded = (ring) => { const r = ring.map(([x, z]) => [r2(x), r2(z)]); if (areaEN(r) < 0) r.reverse(); return r; };
for (const a of extras.areas) {
  if (a.clip) { pushClipped(a.kind, a.ring, a.code); continue; }
  const [cx, cz] = centre(a.ring);
  if (inBounds(cx, cz)) tileFor(cx, cz).areas.push({ kind: a.kind, code: a.code, polygons: [[rounded(a.ring)]] });
}
for (const m of [...extras.marks, ...courtLines.map((ring) => ({ kind: AREA.MARK_WHITE, ring }))]) {
  const [cx, cz] = centre(m.ring);
  if (inBounds(cx, cz)) tileFor(cx, cz).areas.push({ kind: m.kind, code: 0, polygons: [[rounded(m.ring)]] });
}
for (const b of extras.barriers) tileFor((b[0] + b[2]) / 2, (b[1] + b[3]) / 2).walls.push(b);
fs.mkdirSync(area.outDir, { recursive: true });
log(`OSM extras: ${Object.entries(extras.count).map(([k, v]) => `${k} ${v}`).join(', ')}`);

const placed = placeProps({
  land, trees: landRaw.trees.map(([lon, lat, g]) => [...proj.project(lon, lat), g]), treeRows: landRaw.treeRows.map((row) => Object.assign(xz(row), { genus: row.genus })), vending: xz(landRaw.vending),
  edges: roadsOut.edges, idx, inBounds,
});
const allProps = [...placed.props, ...paint.props, ...extras.props];
for (const p of allProps) tileFor(p.x, p.z).props.push({ ...p, x: r2(p.x), z: r2(p.z) });
for (const w of placed.wires) tileFor(w[0], w[1]).wires.push(w.map(r2));
const propName = Object.fromEntries(Object.entries(PROP).map(([k, v]) => [v, k.toLowerCase()]));
const pcount = {};
for (const p of allProps) pcount[propName[p.kind]] = (pcount[propName[p.kind]] ?? 0) + 1;
log(`paint: ${paint.marks.length} marks; props: ${Object.entries(pcount).map(([k, v]) => `${k} ${v}`).join(', ')}; wires ${placed.wires.length}`);

// ---------------------------------------------------------------- OSM building hints
// building:colour and building:material, where a mapper recorded them, override the generated finish.
const CSS = { white: 0xf2f2f0, black: 0x1c1c1e, grey: 0x9a9a9a, gray: 0x9a9a9a, gainsboro: 0xdcdcdc, yellow: 0xe6cf5a, brown: 0x7a5236, beige: 0xe6dcc0, red: 0xa83232, blue: 0x3a5f95, green: 0x4f7d4f, orange: 0xd98a3a, pink: 0xe6a8b8, silver: 0xc0c0c0, cream: 0xf3ead2 };
const MATERIALS = { concrete: MATERIAL.CONCRETE, cement: MATERIAL.CONCRETE, glass: MATERIAL.GLASS, 'concrete/glass': MATERIAL.GLASS, metal: MATERIAL.METAL, metal_plates: MATERIAL.METAL,
  wood: MATERIAL.METAL, tiles: MATERIAL.TILE, brick: MATERIAL.BRICK, plaster: MATERIAL.PLASTER };
let hinted = 0;
for (const w of extraRaw.ways) {
  const colour = (w.tags['building:colour'] ?? '').split(';')[0].trim().toLowerCase(), material = MATERIALS[w.tags['building:material']];
  if (!w.tags.building || (!colour && !material)) continue;
  const rgb = /^#?[0-9a-f]{6}$/.test(colour) ? Number.parseInt(colour.replace('#', ''), 16) : CSS[colour];
  const hint = ((rgb != null ? 0x80000000 | rgb : 0) | ((material ?? 0) << 24)) >>> 0;
  if (!hint) continue;
  const [cx, cz] = centre(w.pts);
  if (!inBounds(cx, cz)) continue;
  // the building under the middle of the OSM outline (it may be filed under a neighbouring tile)
  const [tx, tz] = [Math.floor(cx / TILE), Math.floor(cz / TILE)];
  search: for (let i = tx - 1; i <= tx + 1; i++) for (let j = tz - 1; j <= tz + 1; j++)
    for (const b of tiles.get(tileKey(i, j))?.buildings ?? []) if (b.polygons.some((rings) => inRings(cx, cz, rings))) { b.hint = hint; hinted++; break search; }
}
log(`OSM building hints: ${hinted} buildings with a mapped colour or material`);
// Steel lattice towers: OSM has their outline as a closed shell; the client draws it as open steelwork.
let lattice = 0;
for (const e of JSON.parse(fs.readFileSync(path.join(area.rawDir, 'osm_poi.json'), 'utf8')).elements) {
  const t = e.tags ?? {}, at = e.center ?? e;
  if (t.man_made !== 'tower' || t['tower:construction'] !== 'lattice' || at.lat == null) continue;
  const [cx, cz] = proj.project(at.lon, at.lat), [tx, tz] = [Math.floor(cx / TILE), Math.floor(cz / TILE)];
  search: for (let i = tx - 1; i <= tx + 1; i++) for (let j = tz - 1; j <= tz + 1; j++)
    for (const b of tiles.get(tileKey(i, j))?.buildings ?? []) if (b.polygons.some((rings) => inRings(cx, cz, rings))) { b.flags |= BFLAG.LATTICE; lattice++; break search; }
}
log(`lattice towers (OSM): ${lattice}`);

// ---------------------------------------------------------------- signboards
const places = readPlaces(path.join(area.rawDir, 'osm_poi.json'), proj.project);
// (src: the tile's own building, so a block found to have shops on its ground floor can be given a shopfront)
const signBuildings = [...tiles.values()].flatMap((t) => t.buildings.map((b) => ({ ring: b.polygons[0][0], base: b.base, height: b.height, usage: b.usage, storeys: b.storeys < 255 ? b.storeys : 0, src: b })));
const signs = placeSigns(places, signBuildings, (x, z) => idx.road.has(x, z));
// Billboards, screens and banners are invented, not mapped data: --no-ads leaves them out.
const ads = process.argv.includes('--no-ads') ? [] : placeAds(signBuildings); // (the origin is the Scramble Crossing)
signs.push(...ads);
log(`ads: ${ads.filter((s) => s.style === 3).length} billboards, ${ads.filter((s) => s.style === 4).length} screens, ${ads.filter((s) => s.style === 5).length} rooftop boards, ${ads.filter((s) => s.style === 6).length} banners`);
for (const s of signs) if (inBounds(s.x, s.z)) tileFor(s.x, s.z).signs.push({ ...s, x: r2(s.x), y: r2(s.y), z: r2(s.z), w: r2(s.w), h: r2(s.h) });
log(`signs: ${signs.length} from ${places.length} named places (fascia ${signs.filter((s) => s.style === 0).length}, blade ${signs.filter((s) => s.style === 1).length}, building names ${signs.filter((s) => s.style === 2).length})`);

// ---------------------------------------------------------------- street furniture
const furniture = placeFurniture(path.join(area.rawDir, 'osm_poi.json'), proj.project, idx, ground, inBounds);
for (const p of furniture.props) tileFor(p.x, p.z).props.push({ ...p, x: r2(p.x), z: r2(p.z) });
for (const s of furniture.signs) tileFor(s.x, s.z).signs.push({ ...s, x: r2(s.x), y: r2(s.y), z: r2(s.z), w: r2(s.w), h: r2(s.h) });
log(`street furniture (OSM): ${Object.entries(furniture.count).map(([k, v]) => `${propName[k]} ${v}`).join(', ')}`);

// ---------------------------------------------------------------- write
fs.rmSync(area.outDir, { recursive: true, force: true });
fs.mkdirSync(area.outDir, { recursive: true });
let bytes = 0;
const tileList = [];
for (const t of [...tiles.values()].sort((a, b) => a.tz - b.tz || a.tx - b.tx)) {
  const file = `t_${t.tx}_${t.tz}.bin`, buf = encodeTile(t);
  fs.writeFileSync(path.join(area.outDir, file), buf);
  bytes += buf.length;
  const entry = { x: t.tx, z: t.tz, file, buildings: t.buildings.length, areas: t.areas.length, props: t.props.length, signs: t.signs.length, bytes: buf.length };
  tileList.push(entry);
}
fs.writeFileSync(path.join(area.outDir, 'terrain.bin'), Buffer.from(grid.data.buffer));
// junction nodes with traffic signals (indices into roads.json nodes), for the traffic simulation
const signalIds = new Set(landRaw.signals);
roadsOut.signals = graph.nodes.map((n, i) => (signalIds.has(n.id) ? i : -1)).filter((i) => i >= 0);
fs.writeFileSync(path.join(area.outDir, 'roads.json'), JSON.stringify(roadsOut));
fs.writeFileSync(path.join(area.outDir, 'rails.json'), JSON.stringify(rails));
fs.writeFileSync(path.join(area.outDir, 'structures.json'), JSON.stringify(extras.structures));
const manifest = {
  format: VERSION, area: area.id, name: area.name, compiled: new Date().toISOString(),
  origin: { lon: area.origin[0], lat: area.origin[1] },
  frame: 'metres; x east, y up (TP height), z south',
  tileSize: TILE, bounds: Object.fromEntries(Object.entries(bounds).map(([k, v]) => [k, r2(v)])),
  meshes: area.meshes,
  terrain: { file: 'terrain.bin', x0: r2(grid.x0), z0: r2(grid.z0), step: grid.step, w: grid.w, h: grid.h, min: r2(gMin), max: r2(gMax) },
  roads: 'roads.json', rails: 'rails.json', structures: 'structures.json',
  ...(area.view ? { view: area.view } : {}),
  // street-level bridge decks: road polygons marked with a deck, and street objects, follow these instead of the terrain (src/shared/decks.js)
  decks,
  tiles: tileList,
  attribution: [
    'Buildings, roads and railways: © OpenStreetMap contributors (ODbL 1.0)',
    'Elevation: Mapzen Terrain Tiles (SRTM, GMTED and others) via AWS Open Data',
    'Traffic: © İBB Açık Veri / UYM',
  ],
};
fs.writeFileSync(path.join(area.outDir, 'manifest.json'), JSON.stringify(manifest, null, 1));
// the list of compiled areas, for the client's city switch
const order = (id) => { const i = Object.keys(AREAS).indexOf(id); return i < 0 ? 1e9 : i; };
const tilesDir = path.join(ROOT, 'public/tiles');
const compiled = fs.readdirSync(tilesDir).filter((d) => fs.existsSync(path.join(tilesDir, d, 'manifest.json')))
  .map((d) => ({ id: d, name: JSON.parse(fs.readFileSync(path.join(tilesDir, d, 'manifest.json'), 'utf8')).name }))
  .sort((p, q) => order(p.id) - order(q.id)); // (as listed in config.mjs)
fs.writeFileSync(path.join(tilesDir, 'areas.json'), JSON.stringify(compiled));
const mb = (n) => (n / 1e6).toFixed(1) + ' MB';
const size = (f) => fs.statSync(path.join(area.outDir, f)).size;
log(`wrote ${tileList.length} tiles (${mb(bytes)}), terrain ${mb(size('terrain.bin'))}, roads ${mb(size('roads.json'))}, rails ${mb(size('rails.json'))} -> ${path.relative(process.cwd(), area.outDir)}`);
