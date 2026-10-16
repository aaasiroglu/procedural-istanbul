// Cars on the road graph (roads.json), kept around the camera only: a car that falls too far behind is
// put back on a road near the focus.
//
// Rules of the road, as far as this goes:
//   - keep right; one-way streets one way only; speed from the limit of the road
//   - follow the vehicle ahead with a time gap, including the one just past the next junction
//   - stop at red and yellow lights (the same cycle as the signal heads in props.js)
//   - a junction is crossed by one approach at a time (opposing traffic going straight on may cross
//     together); without lights, a side street gives way to the bigger road and slows right down first (stop sign)
//   - where lanes merge, vehicles queue instead of entering side by side
//   - never enter a junction without room on the far side
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { shared } from './materials.js';
import { LAMP_LAYER, lampMaterial } from './lamplight.js';

const LANE = 3.0;
const CAR_RADIUS = 330, CARS = 260; // the default number of cars, and the distance from the focus they keep within
export const MAX_CARS = 1500;
const CYCLE = 64, GREEN = 27; // seconds: must match the lens shader in props.js
const TRAFFIC_COLORS = { 1: 0x77b791, 2: 0x4d8463, 3: 0xf9a346, 4: 0xd85050, 5: 0x842320 };

function scheduledClosure(edge, now) {
  const properties = edge.ibb?.properties;
  if (!properties?.KAPATMA_NEDENI && !properties?.ETKINLIK) return false;
  const start = Date.parse(properties.E_BASLANGIC_TARIHI), end = Date.parse(properties.E_BITIS_TARIHI);
  return Number.isFinite(start) && start <= now && (!Number.isFinite(end) || now <= end);
}

// ---------------------------------------------------------------- models
// Parts carry a colour and a code per vertex (aGlow): 0 paint, 1 headlamp, 2 tail lamp, 3 glass, 4 rubber and
// trim. Paint of colour 1,1,1 is tinted per car by the instance colour; glass and trim are dark, so the tint
// barely shows on them.
function finish(g, rgb, code) {
  g = g.index ? g.toNonIndexed() : g;
  const n = g.attributes.position.count, c = new Float32Array(n * 3), e = new Float32Array(n);
  for (let i = 0; i < n; i++) { c.set(rgb, i * 3); e[i] = code; }
  g.setAttribute('color', new THREE.BufferAttribute(c, 3));
  g.setAttribute('aGlow', new THREE.BufferAttribute(e, 1));
  g.deleteAttribute('uv');
  return g;
}
const part = (w, h, d, x, y, z, rgb, code = 0) => finish(new THREE.BoxGeometry(w, h, d).translate(x, y, z), rgb, code);
// A block that narrows and shortens towards its top: width w0 and length zA0..zB0 at y0, w1 and zA1..zB1 at y1.
function taper(w0, w1, y0, y1, zA0, zB0, zA1, zB1, rgb, code = 0) {
  const g = new THREE.BoxGeometry(1, 1, 1), p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const top = p.getY(i) > 0, front = p.getZ(i) > 0;
    p.setXYZ(i, p.getX(i) * (top ? w1 : w0), top ? y1 : y0, top ? (front ? zB1 : zA1) : (front ? zB0 : zA0));
  }
  const flat = g.toNonIndexed();
  flat.computeVertexNormals();
  return finish(flat, rgb, code);
}
const wheel = (r, x, z) => [
  finish(new THREE.CylinderGeometry(r, r, 0.24, 14).rotateZ(Math.PI / 2).translate(x, r, z), TYRE, 4),
  finish(new THREE.CylinderGeometry(r * 0.58, r * 0.58, 0.25, 10).rotateZ(Math.PI / 2).translate(x, r, z), [0.55, 0.56, 0.58], 4),
];
const PAINT = [1, 1, 1], GLASS = [0.03, 0.04, 0.05], TYRE = [0.015, 0.015, 0.015], TRIM = [0.05, 0.05, 0.055], LAMP = [1, 1, 1];
// A vehicle along +z: length L, width W, body up to `belt`, cabin from z0 to z1 (fractions of L) up to `roof`,
// its windscreen leaning back by `rake` metres.
function vehicle({ L, W, belt, roof, z0, z1, box, rake = 0.5, tyre = 0.31 }) {
  const zr = -L / 2, zf = L / 2, sill = 0.24, parts = [];
  parts.push(taper(W * 0.97, W, sill, belt, zr + 0.06, zf - 0.06, zr, zf - 0.02, PAINT));                 // body
  parts.push(part(W * 1.01, 0.16, L + 0.06, 0, sill + 0.04, 0, TRIM, 4));                                // bumpers and sills
  const c0 = zr + z0 * L, c1 = zr + z1 * L, back = rake * 0.6, zm = (c0 + c1) / 2;
  parts.push(taper(W * 0.9, W * 0.76, belt, roof, c0, c1, c0 + back, c1 - rake, GLASS, 3));               // glasshouse
  parts.push(taper(W * 0.78, W * 0.72, roof - 0.02, roof + 0.05, c0 + back - 0.02, c1 - rake + 0.02, c0 + back + 0.1, c1 - rake - 0.1, PAINT)); // roof
  if (c1 - c0 > 2.2) parts.push(taper(W * 0.905, W * 0.765, belt, roof, zm - 0.07, zm + 0.07, zm - 0.07, zm + 0.07, PAINT)); // the pillar between the doors
  if (box) parts.push(part(W, box.h, box.len * L, 0, belt + box.h / 2, (box.z - 0.5) * L, [0.92, 0.92, 0.9])); // cargo body (not tinted much)
  parts.push(part(W * 0.5, 0.16, 0.05, 0, belt - 0.3, zf, TRIM, 4));                                      // grille
  for (const z of [zf + 0.01, zr - 0.01]) parts.push(part(0.34, 0.13, 0.03, 0, sill + 0.22, z, [0.9, 0.9, 0.86], 4)); // number plates
  for (const sx of [-1, 1]) {
    const far = L > 8 ? 0.34 : 0.31;
    for (const wz of [far, -far]) parts.push(...wheel(tyre, sx * (W / 2 - 0.1), wz * L));
    parts.push(part(0.38, 0.15, 0.07, sx * (W / 2 - 0.26), belt - 0.2, zf - 0.02, LAMP, 1));
    parts.push(part(0.36, 0.13, 0.07, sx * (W / 2 - 0.24), belt - 0.18, zr + 0.02, LAMP, 2));
    parts.push(part(0.1, 0.1, 0.16, sx * (W / 2 + 0.03), belt + 0.08, c1 - rake * 0.5, PAINT));           // mirrors
  }
  return mergeGeometries(parts);
}
// What the lamps throw on the road: a long pool ahead of the car and a short red one behind it, as one
// instanced mesh per vehicle type that shares the cars' own matrices. Like the street lamps' pools
// (props.js), it multiplies the road under it.
export function beamTexture() {
  const W = 128, H = 128, data = new Uint8Array(W * H * 4), step = THREE.MathUtils.smoothstep;
  for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
    // A fan opening from the lamps (the middle of the near edge) to the full width of the quad at its far
    // end: straight sides that fade softly, a rounded far edge, brightest near the car.
    const u = ((i + 0.5) / W) * 2 - 1, v = (j + 0.5) / H;
    const side = 1 - step(Math.abs(u) / Math.max(v, 0.03), 0.3, 0.98);   // inside the two straight edges, which fade out widely
    const reach = 1 - step(Math.hypot(u * 0.55, v), 0.55, 0.99);          // the arc at the far end
    const value = side * reach * step(v, 0, 0.06) * (0.1 + 0.9 * Math.exp(-v * 3.4));
    data.set([value * 255, value * 255, value * 255, 255], (j * W + i) * 4);
  }
  const t = new THREE.DataTexture(data, W, H);
  t.magFilter = t.minFilter = THREE.LinearFilter;
  t.needsUpdate = true;
  return t;
}
function beamGeometry(L) {
  const g = new THREE.BufferGeometry(), y = 0.14, pos = [], uv = [], col = []; // (held clear of the road: it must never dip under it)
  const quad = (x, zNear, zFar, rgb) => {
    pos.push(-x, y, zNear, x, y, zNear, x, y, zFar, -x, y, zNear, x, y, zFar, -x, y, zFar);
    uv.push(0, 0, 1, 0, 1, 1, 0, 0, 1, 1, 0, 1);
    for (let i = 0; i < 6; i++) col.push(...rgb);
  };
  quad(7.5, L / 2 - 0.3, L / 2 + 24, [1, 0.95, 0.84]);       // headlamps, dipped: a fan 24 m long, 35 degrees wide
  quad(-3.2, -L / 2 + 0.3, -L / 2 - 6, [0.34, 0.02, 0.012]);  // tail lamps
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  return g;
}
const TYPES = [
  { name: 'compact', share: 0.28, L: 4.05, spec: { L: 4.05, W: 1.73, belt: 0.95, roof: 1.48, z0: 0.16, z1: 0.82, rake: 0.58, tyre: 0.29 } },
  { name: 'sedan', share: 0.28, L: 4.60, spec: { L: 4.60, W: 1.76, belt: 0.92, roof: 1.44, z0: 0.20, z1: 0.72, rake: 0.75, tyre: 0.31 } },
  { name: 'taxi', share: 0.16, L: 4.55, spec: { L: 4.55, W: 1.75, belt: 0.92, roof: 1.46, z0: 0.20, z1: 0.72, rake: 0.72, tyre: 0.30 } },
  { name: 'van', share: 0.14, L: 4.95, spec: { L: 4.95, W: 1.88, belt: 1.10, roof: 1.95, z0: 0.06, z1: 0.88, rake: 0.45, tyre: 0.34 } },
  { name: 'truck', share: 0.08, L: 6.40, spec: { L: 6.40, W: 2.15, belt: 1.05, roof: 2.30, z0: 0.72, z1: 0.97, rake: 0.18, tyre: 0.42, box: { h: 2.1, len: 0.70, z: 0.36 } } },
  { name: 'bus', share: 0.06, L: 10.8, spec: { L: 10.8, W: 2.55, belt: 1.25, roof: 3.10, z0: 0.02, z1: 0.98, rake: 0.14, tyre: 0.48 } },
];
const CAR_COLORS = [0xd4d4d0, 0xd4d4d0, 0x111214, 0x111214, 0xa4a7ab, 0xa4a7ab, 0x6d7278, 0x1f3a6e, 0x8c1c1c, 0xc4b68f];
const TAXI_COLORS = [0xf59e0b, 0xfacc15, 0xeab308, 0xf59e0b]; // Iconic Istanbul yellow taxi
const BUS_COLORS = [0x2e8b57, 0xe8e4d8, 0xc0392b];

// Vehicle models for cars parked in car parks (props.js): geometries by type, the paint material, colours.
let parkedKit = null;
export function parkedVehicles() {
  parkedKit ??= { models: TYPES.slice(0, 3).map((t) => vehicle(t.spec)), material: carMaterial(false), colors: [0xd4d4d0, 0x111214, 0xa4a7ab, 0x1f3a6e] };
  return parkedKit;
}

function carMaterial(lit = true) {
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.28, metalness: 0.5 });
  m.onBeforeCompile = (shader) => {
    shader.uniforms.uLampOn = { value: 0 }; shader.uniforms.uLampMap = shared.uLampMap; // (no lamp light here; the sampler still needs its texture)
    shader.uniforms.uNight = shared.uNight;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float aGlow;\nvarying float vGlow;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvGlow = aGlow;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float uNight;\nvarying float vGlow;')
      // lamps keep their own colour instead of the body paint, and shine at night
      .replace('#include <color_fragment>', `#include <color_fragment>
        vec3 lamp = vGlow > 1.5 ? vec3(0.9, 0.03, 0.02) : vec3(1.0, 0.96, 0.85);
        if (vGlow > 0.5 && vGlow < 2.5) diffuseColor.rgb = lamp * 0.6;`)
      // glass is a dark mirror, rubber and trim are matt, the paint has a hard shine
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = vGlow > 3.5 ? 0.85 : vGlow > 2.5 ? 0.06 : roughnessFactor;')
      .replace('#include <metalnessmap_fragment>', '#include <metalnessmap_fragment>\nmetalnessFactor = vGlow > 3.5 ? 0.0 : vGlow > 2.5 ? 0.9 : metalnessFactor;')
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        if (vGlow > 0.5 && vGlow < 2.5) totalEmissiveRadiance += lamp * (0.15 + uNight * ${lit ? '(vGlow > 1.5 ? 2.0 : 3.6)' : '0.0'});`)
      // (the windows are marked in alpha for the reflection pass, like those of the buildings)
      .replace('#include <opaque_fragment>', '#include <opaque_fragment>\nif (vGlow > 2.5 && vGlow < 3.5) gl_FragColor.a = 0.1;');
  };
  m.customProgramCacheKey = () => (lit ? 'car-v3' : 'car-parked-v3');
  return m;
}

// ---------------------------------------------------------------- the graph, as directed lanes
function buildGraph({ nodes, edges, signals }, surface) {
  const signalled = new Set(signals), out = nodes.map(() => []), into = nodes.map(() => []), lanes = [];
  for (const e of edges) {
    if (e.highway === 'service' && e.lanes <= 1) continue; // driveways and yards: not through traffic
    const pts = [];
    for (let i = 0; i < e.pts.length; i += 3) pts.push(new THREE.Vector3(e.pts[i], e.pts[i + 1], e.pts[i + 2]));
    const minor = ['residential', 'unclassified', 'living_street', 'service'].includes(e.highway);
    const weight = e.highway.startsWith('motorway') ? 5 : ['trunk', 'primary'].includes(e.highway) ? 4 : ['secondary', 'tertiary'].includes(e.highway) ? 2.5 : 1;
    for (const fwd of [true, false]) {
      if (fwd ? e.oneway === -1 : e.oneway === 1) continue;
      const p = fwd ? pts : [...pts].reverse(), cum = [0];
      for (let i = 1; i < p.length; i++) cum.push(cum[i - 1] + Math.hypot(p[i].x - p[i - 1].x, p[i].z - p[i - 1].z));
      if (cum.at(-1) < 1) continue;
      const ibbSpeed = fwd ? e.ibb?.speedForward : e.ibb?.speedBackward;
      const limitKph = e.maxspeedTagged ? e.maxspeed : ibbSpeed ?? e.maxspeed;
      const speed = Math.min(15, Math.max(4.5, (limitKph * (minor ? 0.6 : 0.8)) / 3.6));
      const n = e.oneway ? Math.max(1, e.lanes) : Math.max(1, Math.floor(e.lanes / 2));
      // lateral offset of lane k, to the right of travel for right-hand traffic: one-way roads centred on the
      // line; two-way roads sit on their right half, with a single-lane street shared down the middle.
      const offset = (k) => (e.oneway ? (k - (n - 1) / 2) * LANE : e.lanes >= 2 ? (k + 0.5) * LANE : 1.15);
      // An expressway ramp climbing to its flyover is a structure of its own (flyovers.js builds it where the
      // road's level stands 1.5 m above the ground somewhere): cars follow the road's level there too.
      let ramp = false;
      if (!e.flyover && !e.span && !e.tunnel && (e.highway.startsWith('motorway') || e.highway.startsWith('trunk') || e.highway.endsWith('_link'))) {
        for (let i = 1; i < p.length && !ramp; i++) for (let s = 0; s <= 1; s += Math.min(1, 3 / (cum[i] - cum[i - 1] || 1))) {
          if (p[i - 1].y + (p[i].y - p[i - 1].y) * s - surface(p[i - 1].x + (p[i].x - p[i - 1].x) * s, p[i - 1].z + (p[i].z - p[i - 1].z) * s) > 1.2) { ramp = true; break; }
        }
      }
      const lane = {
        ramp, pts: p, cum, length: cum.at(-1), from: fwd ? e.a : e.b, to: fwd ? e.b : e.a, n, offset, speed, weight, motorway: e.highway.startsWith('motorway'),
        raised: !!e.flyover, hidden: !!e.tunnel, signal: signalled.has(fwd ? e.b : e.a), edge: e, cars: [],
      };
      // which way the signal for this approach is phased (see lensMaterial in props.js)
      const a = p.at(-2), b = p.at(-1);
      const facing = (Math.atan2(-(b.x - a.x), -(b.z - a.z)) + Math.PI * 2) % (Math.PI * 2); // the signal head faces the traffic
      lane.phase = Math.round(facing / (Math.PI / 2)) % 2;
      lane.hx = (b.x - a.x) / (Math.hypot(b.x - a.x, b.z - a.z) || 1); lane.hz = (b.z - a.z) / (Math.hypot(b.x - a.x, b.z - a.z) || 1);
      lanes.push(lane); out[lane.from].push(lane); into[lane.to].push(lane);
    }
  }
  // a junction: where a driver meets traffic from another road (three or more road ends)
  const junction = nodes.map((_, i) => new Set([...out[i], ...into[i]].map((l) => l.edge)).size >= 3);
  // OSM draws a big crossing as several nodes a few metres apart (one per carriageway that meets there).
  // Junction nodes joined by a short road form one junction: `group` is its id, shared by its nodes.
  const group = nodes.map((_, i) => i);
  const find = (i) => { while (group[i] !== i) { group[i] = group[group[i]]; i = group[i]; } return i; };
  for (const l of lanes) if (l.length < 26 && junction[l.from] && junction[l.to]) group[find(l.from)] = find(l.to);
  nodes.forEach((_, i) => { group[i] = find(i); });
  for (const l of lanes) {
    l.inside = group[l.from] === group[l.to] && junction[l.to]; // a link within one junction: no stopping on it
    if (l.inside) l.signal = false;
  }
  // The stop line: the junction node is the centre of the crossing, so a waiting vehicle stands back from
  // it by half the width of the widest road that meets there (plus the pedestrian crossing).
  const reach = nodes.map(() => 0);
  for (const l of lanes) {
    const half = (l.edge.oneway ? l.n : Math.max(1, l.edge.lanes)) * LANE / 2;
    reach[l.to] = Math.max(reach[l.to], half); reach[l.from] = Math.max(reach[l.from], half);
  }
  for (const l of lanes) l.stop = Math.min(reach[l.to] + 5.5, l.length * 0.45);
  return { lanes, out, into, junction, group, nodes };
}

const tmp = new THREE.Vector3(), tmp2 = new THREE.Vector3();
// Position and unit heading at distance s along a lane.
function along(lane, s, pos, dir) {
  const { pts, cum } = lane;
  let lo = 0, hi = cum.length - 1;
  while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (cum[mid] <= s) lo = mid; else hi = mid; }
  const t = Math.min(1, Math.max(0, (s - cum[lo]) / (cum[hi] - cum[lo] || 1)));
  pos.lerpVectors(pts[lo], pts[hi], t);
  dir.subVectors(pts[hi], pts[lo]);
  const l = Math.hypot(dir.x, dir.z) || 1;
  dir.multiplyScalar(1 / l);
}

export class Traffic {
  // roads: parsed roads.json; surface(x, z): height of the road surface there.
  constructor(roads, surface) {
    this.surface = surface;
    this.graph = buildGraph(roads, surface);
    // which approach holds each junction: { lane, until, straight (everyone crossing is going straight on) }
    this.crossing = roads.nodes.map(() => ({ lane: null, until: 0, straight: false }));
    this.group = new THREE.Group();
    this.group.name = 'traffic';
    this.time = 0;
    this.seed = 12345;

    const material = carMaterial();
    // what the lamps throw on the road, for the light map (lamplight.js)
    this.beam = lampMaterial(beamTexture(), { vertexColors: true });
    this.fleets = TYPES.map((t) => {
      const mesh = new THREE.InstancedMesh(vehicle(t.spec), material, Math.ceil(MAX_CARS * t.share * 1.25) + 8);
      mesh.castShadow = true; mesh.frustumCulled = false; mesh.count = 0;
      const beams = new THREE.InstancedMesh(beamGeometry(t.L), this.beam, mesh.instanceMatrix.count);
      beams.instanceMatrix = mesh.instanceMatrix; // the lamps go where the cars go
      beams.frustumCulled = false; beams.count = 0;
      beams.layers.set(LAMP_LAYER);
      this.group.add(mesh, beams);
      return { ...t, mesh, beams };
    });
    this.cars = [];
    this.count = CARS;   // how many cars there are (the panel changes it)
    this.liveTrafficIndex = null;
    this.scenarioSpeedFactor = 1.0;
    this.scenarioVehicleFactor = 1.0;
    this.liveOverlay = null;
    this.liveOverlayEdges = [];
    this.highway = 5;    // how much busier the expressway is than its class alone would make it
    this.headlights = 5; // strength of the light the lamps throw on the road at night
    this.dummy = new THREE.Object3D();
    this.dummy.rotation.order = 'YXZ'; // heading first, then pitch about the car's own axle
    this.color = new THREE.Color();

    this.uniqueEdges = [...new Set(this.graph.lanes.map((l) => l.edge))];
    for (const edge of this.uniqueEdges) {
      if (!edge.pts || edge.pts.length < 6) {
        edge.calcLength = 0; edge.midX = 0; edge.midZ = 0;
        continue;
      }
      const mid = Math.floor(edge.pts.length / 6) * 3;
      edge.midX = edge.pts[mid];
      edge.midZ = edge.pts[mid + 2];
      let len = 0;
      for (let i = 3; i < edge.pts.length; i += 3) {
        len += Math.hypot(edge.pts[i] - edge.pts[i - 3], edge.pts[i + 2] - edge.pts[i - 1]);
      }
      edge.calcLength = len;
    }
    this.cachedEstimate = null;
    this.estimateTimer = 999;
    this.lastEstimateFocus = null;
  }

  setScenarioFactors({ speedFactor = 1.0, vehicleFactor = 1.0 } = {}) {
    this.scenarioSpeedFactor = THREE.MathUtils.clamp(speedFactor, 0.15, 2.5);
    this.scenarioVehicleFactor = THREE.MathUtils.clamp(vehicleFactor, 0.20, 2.5);
  }

  setLiveTrafficIndex(index) {
    this.liveTrafficIndex = THREE.MathUtils.clamp(Math.round(index), 1, 99);
    const intensity = (this.liveTrafficIndex - 1) / 98;
    this.liveVehicleFactor = 0.55 + intensity * 1.95;
    this.liveSpeedFactor = 1 - intensity * 0.55;
  }

  clearLiveTrafficIndex() {
    this.liveTrafficIndex = null;
    this.liveVehicleFactor = 1;
    this.liveSpeedFactor = 1;
    this.scenarioSpeedFactor = 1;
    this.scenarioVehicleFactor = 1;
  }

  attachLiveSegments(rows, project, bounds) {
    const segments = rows.map((row) => ({
      id: row.S,
      pts: JSON.parse(row.G).map(([lat, lon]) => project(lon, lat)),
    })).filter((segment) => segment.pts.some(([x, z]) =>
      x >= bounds.minX - 40 && x <= bounds.maxX + 40 && z >= bounds.minZ - 40 && z <= bounds.maxZ + 40));
    const edges = new Set(this.graph.lanes.map((lane) => lane.edge));
    let matched = 0;
    for (const edge of edges) {
      const n = edge.pts.length / 3, mid = Math.floor((n - 1) / 2) * 3;
      const x = edge.pts[mid], z = edge.pts[mid + 2];
      const prev = Math.max(0, mid - 3), next = Math.min(edge.pts.length - 3, mid + 3);
      const dx = edge.pts[next] - edge.pts[prev], dz = edge.pts[next + 2] - edge.pts[prev + 2];
      const length = Math.hypot(dx, dz) || 1;
      let best = Infinity, bestId = null;
      for (const segment of segments) for (let i = 1; i < segment.pts.length; i++) {
        const a = segment.pts[i - 1], b = segment.pts[i], sx = b[0] - a[0], sz = b[1] - a[1];
        const segmentLength = Math.hypot(sx, sz) || 1;
        if (Math.abs((dx * sx + dz * sz) / (length * segmentLength)) < 0.55) continue;
        const t = Math.max(0, Math.min(1, ((x - a[0]) * sx + (z - a[1]) * sz) / (segmentLength * segmentLength)));
        const distance = Math.hypot(x - a[0] - sx * t, z - a[1] - sz * t);
        if (distance < best) { best = distance; bestId = segment.id; }
      }
      edge.liveSegmentId = best < 20 ? bestId : null;
      if (edge.liveSegmentId != null) matched++;
    }
    this.liveMatchedEdges = matched;
    return matched;
  }

  updateLiveSegmentSpeeds(data) {
    const records = new Map(), priority = { BM: 1, FD: 2, FE: 3 };
    for (const row of data) {
      const id = Number(row.S), previous = records.get(id);
      if (!previous || (priority[row.T] ?? 0) > (priority[previous.T] ?? 0)) records.set(id, row);
    }
    const edges = this.uniqueEdges || new Set(this.graph.lanes.map((lane) => lane.edge));
    let matched = 0, closed = 0;
    for (const edge of edges) {
      const directId = Number(edge.ibb?.vsegDirId), fallbackId = Number(edge.liveSegmentId);
      const row = records.get(directId) ?? records.get(fallbackId);
      const speed = row ? Number(row.V) : null;
      edge.liveClass = row && Number.isFinite(Number(row.C)) ? Number(row.C) : null;
      edge.liveSpeedKph = Number.isFinite(speed) ? Math.max(0, speed) : null;
      edge.closed = scheduledClosure(edge, Date.now()) || !!row && (row.T === 'FE' || (Number(row.C) === 0 && speed === 0));
      if (row) matched++;
      if (edge.closed) closed++;
    }

    // Propagate live congestion to immediate connecting links lacking direct sensors
    for (const lane of this.graph.lanes) {
      if (lane.edge.liveClass == null && !lane.edge.closed) {
        // Check connecting lanes at start or end junction
        const neighbors = [...(this.graph.into[lane.from] ?? []), ...(this.graph.out[lane.to] ?? [])];
        let maxClass = null;
        for (const n of neighbors) {
          if (n.edge.liveClass != null && (maxClass == null || n.edge.liveClass > maxClass)) {
            maxClass = n.edge.liveClass;
          }
        }
        if (maxClass != null && maxClass >= 3) {
          // Congested upstream/downstream corridor spills into this road
          lane.edge.liveClass = Math.max(2, maxClass - 1);
          lane.edge.liveSpeedKph = Math.min(lane.edge.maxspeed, Math.max(12, 50 - (maxClass - 2) * 12));
        }
      }
    }

    for (const lane of this.graph.lanes)
      lane.liveSpeed = lane.edge.liveSpeedKph == null ? null : lane.edge.liveSpeedKph / 3.6;
    this.updateTrafficOverlay();
    return { matched, closed };
  }

  clearLiveSegmentSpeeds() {
    const edges = this.uniqueEdges || new Set(this.graph.lanes.map((lane) => lane.edge));
    for (const edge of edges) {
      edge.liveClass = null; edge.liveSpeedKph = null; edge.closed = scheduledClosure(edge, Date.now());
    }
    for (const lane of this.graph.lanes) lane.liveSpeed = null;
    this.updateTrafficOverlay();
  }

  estimateLocalVehicleCount(focus, radius = CAR_RADIUS) {
    if (this.liveTrafficIndex == null) return null;
    let estimated = 0;
    const edges = this.uniqueEdges;
    for (const edge of edges) {
      if (edge.closed) continue;
      if (Math.hypot(edge.midX - focus.x, edge.midZ - focus.z) > radius) continue;
      const length = edge.calcLength ?? 0;
      const freeSpeed = Math.max(10, edge.maxspeedTagged ? edge.maxspeed : edge.ibb?.speedForward ?? edge.maxspeed);
      const speed = edge.liveSpeedKph ?? freeSpeed * this.liveSpeedFactor;
      const speedRatio = THREE.MathUtils.clamp(speed / freeSpeed, 0, 1);
      const vehiclesPerKmLane = 8 + 120 * (1 - speedRatio);
      estimated += vehiclesPerKmLane * (length / 1000) * Math.max(1, edge.lanes);
    }
    return Math.min(MAX_CARS, Math.round(estimated));
  }

  updateTrafficOverlay() {
    const edges = [...new Set(this.graph.lanes.map((lane) => lane.edge))]
      .filter((edge) => edge.liveClass != null || edge.closed);
    const previous = this.liveOverlayEdges.map(({ edge }) => edge);
    const changed = edges.length !== previous.length || edges.some((edge, i) => edge !== previous[i]);
    if (changed) {
      if (this.liveOverlay) {
        this.group.remove(this.liveOverlay);
        this.liveOverlay.geometry.dispose();
        this.liveOverlay.material.dispose();
      }
      const positions = [], colors = [], indices = [], ranges = [];
      for (const edge of edges) {
        const points = [];
        for (let i = 0; i < edge.pts.length; i += 3) points.push([edge.pts[i], edge.pts[i + 1], edge.pts[i + 2]]);
        if (points.length < 2) continue;
        const width = Math.min(16, Math.max(2.5, edge.ibb?.width ?? edge.width ?? edge.lanes * 3)), half = width / 2;
        const start = positions.length / 3;
        for (let i = 0; i < points.length; i++) {
          const prev = points[Math.max(0, i - 1)], next = points[Math.min(points.length - 1, i + 1)];
          const length = Math.hypot(next[0] - prev[0], next[2] - prev[2]) || 1;
          const nx = -(next[2] - prev[2]) / length * half, nz = (next[0] - prev[0]) / length * half;
          positions.push(points[i][0] + nx, points[i][1] + 0.22, points[i][2] + nz,
            points[i][0] - nx, points[i][1] + 0.22, points[i][2] - nz);
          colors.push(0, 0, 0, 0, 0, 0);
          if (i > 0) {
            const a = start + (i - 1) * 2, b = start + i * 2;
            indices.push(a, b, a + 1, b, b + 1, a + 1);
          }
        }
        ranges.push({ edge, start, count: points.length * 2 });
      }
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
      geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
      geometry.setIndex(indices);
      this.liveOverlay = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({
        vertexColors: true, transparent: true, opacity: 0.82, depthWrite: false, side: THREE.DoubleSide,
      }));
      this.liveOverlay.renderOrder = 3;
      this.group.add(this.liveOverlay);
      this.liveOverlayEdges = ranges;
    }
    if (!this.liveOverlay) return;
    const colors = this.liveOverlay.geometry.attributes.color;
    for (const { edge, start, count } of this.liveOverlayEdges) {
      const color = new THREE.Color(edge.closed ? 0x17191b : TRAFFIC_COLORS[edge.liveClass] ?? 0x858585);
      for (let i = start; i < start + count; i++) colors.setXYZ(i, color.r, color.g, color.b);
    }
    colors.needsUpdate = true;
  }

  rnd() { this.seed = (this.seed * 1664525 + 1013904223) >>> 0; return this.seed / 4294967296; }

  // A lane with some part within `radius` of the focus, picked by weight; null if the area has none.
  pick(focus, radius, filter) {
    let best = null, bestKey = -1;
    for (const l of this.graph.lanes) {
      if (!filter(l)) continue;
      const m = l.pts[l.pts.length >> 1];
      if (Math.hypot(m.x - focus.x, m.z - focus.z) > radius) continue;

      // Live traffic density factor: congested (red/orange) roads accumulate cars; free-flow (green) roads stay fluid.
      let liveDensity = 1.0;
      const liveClass = l.edge.liveClass;
      if (liveClass != null) {
        // 1: >60 km/h (green, fast) -> light density
        // 2: 45-60 km/h (light green) -> normal light density
        // 3: 30-45 km/h (orange, slowing) -> medium density
        // 4: 15-30 km/h (red, heavy) -> high density / queue
        // 5: <15 km/h (dark red, jam) -> very high density
        const classWeights = { 1: 0.45, 2: 0.75, 3: 1.8, 4: 4.2, 5: 6.5 };
        liveDensity = classWeights[liveClass] ?? 1.0;
      } else if (l.liveSpeed != null && l.speed > 0) {
        const ratio = THREE.MathUtils.clamp(l.liveSpeed / l.speed, 0.1, 1.2);
        liveDensity = Math.max(0.4, 0.6 + (1 - ratio) * 4.5);
      } else if (this.liveTrafficIndex != null) {
        liveDensity = 0.6 + (this.liveTrafficIndex / 100) * 0.9;
      }

      // On highways: if fluid (green), do not artificially over-pack cars (keep fluid); if congested, jam up.
      const mwFactor = l.motorway ? (liveClass && liveClass <= 2 ? 1.6 : this.highway) : 1.0;
      const weight = l.weight * Math.min(l.length, 120) * l.n * mwFactor * liveDensity;
      const key = Math.pow(this.rnd(), 1 / Math.max(0.01, weight));
      if (key > bestKey) { bestKey = key; best = l; }
    }
    return best;
  }

  spawnCar(car, focus) {
    for (let attempt = 0; attempt < 8; attempt++) {
      const lane = this.pick(focus, this.radius ?? CAR_RADIUS, (l) => !l.hidden && !l.edge.closed && l.length > 15);
      if (!lane) return false;
      const isCongested = (lane.edge.liveClass >= 3) || (lane.liveSpeed != null && lane.liveSpeed < 6.0);
      const minGap = isCongested ? 4.5 : 12;
      // a clear stretch, away from the ends of the road
      const s = Math.min(lane.length - 6, Math.max(6, 6 + this.rnd() * (lane.length - 12)));
      if (lane.cars.some((o) => o !== car && Math.abs(o.s - s) < minGap)) continue;
      if (car.lane) car.lane.cars.splice(car.lane.cars.indexOf(car), 1);
      const spawnV = (lane.liveSpeed ?? lane.speed) * (isCongested ? 0.2 : 0.6);
      Object.assign(car, { lane, s, k: Math.floor(this.rnd() * lane.n), v: spawnV, next: undefined, waited: 0 });
      lane.cars.push(car);
      return true;
    }
    return false;
  }

  // The road a car will take after `lane`: not straight back; straighter and bigger roads preferred.
  chooseNext(lane) {
    const a = lane.pts.at(-2), b = lane.pts.at(-1), hx = b.x - a.x, hz = b.z - a.z, hl = Math.hypot(hx, hz) || 1;
    let next = null, key = -1;
    for (const o of this.graph.out[lane.to]) {
      if (o.edge === lane.edge || o.edge.closed) continue;
      const ox = o.pts[1].x - o.pts[0].x, oz = o.pts[1].z - o.pts[0].z, ol = Math.hypot(ox, oz) || 1;
      const straight = (hx * ox + hz * oz) / (hl * ol);
      if (straight < -0.6) continue;
      const k = Math.pow(this.rnd(), 1 / (o.weight * (0.4 + Math.max(0, straight) * 1.6)));
      if (k > key) { key = k; next = o; }
    }
    return next;
  }

  // May `car` cross the junction at the end of `lane` now? Claims the junction if so. The junction belongs
  // to one approach at a time; a vehicle going straight on may share it with oncoming traffic doing the same.
  mayCross(car, lane, toEnd) {
    const node = lane.to, x = this.crossing[this.graph.group[node]], now = shared.uTime.value, next = car.next;
    const straight = !!next && lane.hx * (next.pts[1].x - next.pts[0].x) + lane.hz * (next.pts[1].z - next.pts[0].z) > 0.8 * (next.cum[1] || 1);
    if (x.lane && x.lane !== lane && now < x.until) {
      const oncoming = lane.hx * x.lane.hx + lane.hz * x.lane.hz < -0.8;
      if (!(oncoming && straight && x.straight)) return false;
    }
    // without lights, give way to anyone arriving soon on a bigger road
    if (!lane.signal) for (const o of this.graph.into[node]) {
      if (o === lane || o.edge === lane.edge || o.weight <= lane.weight) continue;
      for (const c of o.cars) if (c.v > 0.5 && (o.length - c.s) / Math.max(c.v, 2) < 4.5) return false;
    }
    const until = now + toEnd / Math.max(car.v, 2) + 3.5; // time to get there and across
    if (x.lane === lane && now < x.until) { x.until = Math.max(x.until, until); x.straight = x.straight && straight; }
    else { x.lane = lane; x.until = until; x.straight = straight; }
    return true;
  }

  // red or yellow for a lane's approach? (27 s green, 3 s yellow, the rest red; the cross street 32 s later)
  stopLight(lane) { return lane.signal && (shared.uTime.value + lane.phase * 32) % CYCLE > GREEN; }

  update(dt, focus) {
    this.time += dt;
    const d = this.dummy;

    // ---- cars
    // more cars are spread over a wider circle, so the streets do not simply jam
    this.estimateTimer = (this.estimateTimer || 0) + dt;
    if (
      this.cachedEstimate == null ||
      this.estimateTimer >= 1.5 ||
      !this.lastEstimateFocus ||
      Math.hypot(focus.x - this.lastEstimateFocus.x, focus.z - this.lastEstimateFocus.z) > 80
    ) {
      this.estimateTimer = 0;
      this.lastEstimateFocus = { x: focus.x, z: focus.z };
      this.cachedEstimate = this.estimateLocalVehicleCount(focus);
    }
    const estimate = this.cachedEstimate;
    const baseTarget = estimate == null ? Math.round(this.count * (this.liveVehicleFactor || 1.0)) : Math.max(Math.round(this.count * 0.75), estimate);
    const target = Math.min(MAX_CARS, Math.round(baseTarget * (this.scenarioVehicleFactor || 1.0)));
    this.liveDemandEstimate = estimate;
    this.radius = estimate == null ? CAR_RADIUS * Math.min(2.4, Math.max(1, Math.sqrt(target / CARS))) : CAR_RADIUS;
    while (this.cars.length > target) { const gone = this.cars.pop(); if (gone.lane) gone.lane.cars.splice(gone.lane.cars.indexOf(gone), 1); }
    while (this.cars.length < target) {
      const r = this.rnd(); let acc = 0, type = 0;
      for (let i = 0; i < TYPES.length; i++) { acc += TYPES[i].share; if (r < acc) { type = i; break; } }
      const palette = TYPES[type].name === 'bus' ? BUS_COLORS : TYPES[type].name === 'taxi' ? TAXI_COLORS : CAR_COLORS;
      const car = { type, color: palette[Math.floor(this.rnd() * palette.length)], lane: null };
      if (!this.spawnCar(car, focus)) break;
      this.cars.push(car);
    }
    const counts = this.fleets.map(() => 0);
    const { junction, into } = this.graph;
    for (const car of this.cars) {
      if (!car.lane && !this.spawnCar(car, focus)) continue; // nowhere to drive near the focus right now
      const lane = car.lane, L = TYPES[car.type].L;
      if (car.next?.edge.closed) car.next = undefined;
      if (car.next === undefined) car.next = this.chooseNext(lane); // null at a dead end
      const next = car.next, toEnd = lane.length - car.s - L / 2; // front bumper to the end of this road

      // 1. the vehicle ahead: in this lane, or the last one on the road it is about to join
      let gap = Infinity, lead = 0;
      const kNext = next ? Math.min(car.k, next.n - 1) : car.k;
      for (const o of lane.cars) {
        if (o === car) continue;
        // same lane, or merging into the same lane at the end of this road (ties go to the left lane)
        const merging = next && toEnd < 35 && o.k !== car.k && Math.min(o.k, next.n - 1) === kNext && o.next === next;
        if (o.k === car.k ? o.s <= car.s : !(merging && (o.s > car.s + 0.5 || (Math.abs(o.s - car.s) <= 0.5 && o.k < car.k)))) continue;
        const g = o.s - car.s - (TYPES[o.type].L + L) / 2;
        if (g < gap) { gap = Math.max(g, 0); lead = o.v; }
      }
      let roomAhead = true;
      if (next) {
        for (const o of next.cars) {
          if (o.k !== kNext) continue;
          const g = toEnd + o.s - TYPES[o.type].L / 2;
          if (g < gap) { gap = g; lead = o.v; }
          if (o.s < TYPES[o.type].L / 2 + L + 3) roomAhead = false; // the far side is still occupied
        }
      }
      // 2. the junction: a red light, no room beyond it, or the turn of another vehicle
      const stopAt = toEnd - lane.stop, braking = (car.v * car.v) / 7 + 5;
      const past = stopAt < -1; // already over the stop line: committed to crossing
      // (on a link inside a junction the car is already crossing: it only keeps clear of the vehicle ahead)
      let hold = !lane.inside && !past && (this.stopLight(lane) || (junction[lane.to] && !roomAhead));
      const giveWay = junction[lane.to] && !lane.signal && into[lane.to].some((o) => o.edge !== lane.edge && o.weight > lane.weight);
      if (!hold && !lane.inside && junction[lane.to] && stopAt < braking + 8) hold = !this.mayCross(car, lane, toEnd) && !past;
      if (hold && stopAt < gap) { gap = Math.max(0, stopAt); lead = 0; }

      // 3. speed: the limit, slower into a junction, a crawl up to a give-way line, a time gap behind the leader
      const baseLimit = lane.liveSpeed == null ? lane.speed * this.liveSpeedFactor : lane.liveSpeed;
      const limit = baseLimit * (this.scenarioSpeedFactor || 1.0);
      let want = lane.edge.closed ? 0 : limit * (toEnd < 14 ? 0.55 : 1);
      if (giveWay && toEnd < 14) want = Math.min(want, 1.2 + toEnd * 0.35);
      const isCongested = (lane.edge.liveClass >= 3) || (lane.liveSpeed != null && lane.liveSpeed < 6.0);
      const stopBuffer = isCongested ? 1.3 : 2.5;
      if (gap < Infinity) want = Math.min(want, Math.max(0, lead + (gap - stopBuffer) / 1.3));
      if (gap < (isCongested ? 0.4 : 0.6)) want = 0;
      car.v = Math.max(0, car.v + THREE.MathUtils.clamp(want - car.v, -6 * dt, 2.2 * dt));
      car.s += car.v * dt;
      // stuck for a long time (a jam that cannot clear): start again somewhere else
      car.waited = car.v < 0.2 ? (car.waited ?? 0) + dt : 0;
      const maxWait = isCongested ? 240 : 45;
      if (car.waited > maxWait && !this.stopLight(lane)) { if (!this.spawnCar(car, focus)) continue; }

      if (car.lane === lane && car.s >= lane.length) {
        lane.cars.splice(lane.cars.indexOf(car), 1);
        const x = this.crossing[this.graph.group[lane.to]];
        // still clearing the junction; longer if the way on is another link inside it
        if (x.lane === lane) x.until = Math.max(x.until, shared.uTime.value + 2.2 + (next?.inside ? next.length / Math.max(car.v, 3) : 0));
        if (next) { car.lane = next; car.s -= lane.length; car.k = Math.min(car.k, next.n - 1); car.next = undefined; next.cars.push(car); }
        else { car.lane = null; if (!this.spawnCar(car, focus)) continue; }
      }
      // left behind by the camera: start again nearby
      along(car.lane, car.s, tmp, tmp2);
      if (Math.hypot(tmp.x - focus.x, tmp.z - focus.z) > (this.radius ?? CAR_RADIUS) + 90) { if (!this.spawnCar(car, focus)) continue; along(car.lane, car.s, tmp, tmp2); }
      if (car.lane.hidden) continue;

      const off = car.lane.offset(car.k), px = tmp.x - tmp2.z * off, pz = tmp.z + tmp2.x * off;
      const fleet = this.fleets[car.type];
      if (counts[car.type] >= fleet.mesh.instanceMatrix.count) continue; // (more of this type than there are instances for)
      const i = counts[car.type]++;
      // (a ramp comes down to the ground: the higher of its level and the ground)
      const onRamp = car.lane.ramp && tmp.y > this.surface(px, pz) + 0.03;
      d.position.set(px, car.lane.raised || onRamp ? tmp.y + 0.04 : this.surface(px, pz) + 0.07, pz);
      // nose up or down with the road (and with it the light the lamps throw on it): the slope over the car's length
      const slope = car.lane.raised || onRamp ? tmp2.y : (this.surface(px + tmp2.x * 5, pz + tmp2.z * 5) - this.surface(px - tmp2.x * 5, pz - tmp2.z * 5)) / 10;
      d.rotation.set(-Math.atan(slope), Math.atan2(tmp2.x, tmp2.z), 0);
      d.updateMatrix();
      fleet.mesh.setMatrixAt(i, d.matrix);
      fleet.mesh.setColorAt(i, this.color.setHex(car.color));
    }
    const night = shared.uNight.value;
    this.beam.color.setScalar(0.36 * this.headlights * night); // the light on the road just ahead of a car
    this.beam.visible = night > 0.02;
    this.fleets.forEach((f, i) => {
      f.mesh.count = f.beams.count = counts[i];
      f.mesh.instanceMatrix.needsUpdate = true;
      if (f.mesh.instanceColor) f.mesh.instanceColor.needsUpdate = true;
    });
  }
}
