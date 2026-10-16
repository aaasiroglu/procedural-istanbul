// Elevated roads, viaducts, expressway flyovers and ramps.
// Mathematically connects all road-viaduct junctions, ramps and flyovers with seamless miter joints,
// true polyline geometry (no artificial tangent shooting), inner parapet suppression and smooth ground landing.

import * as THREE from 'three';
import { Soup, sections } from './rails.js';

export const JUNCTION_PARAMS = {
  // 1. Zemin Birleşim (Ground Landing Cutoff)
  rampMinHeightCutoff: 0.05,     // Rampanın zemine değme eşiği (metre) - 5cm kotuna kadar kesintisiz iner
  retainingWallSink: 0.40,        // İstinat duvarının zemin altına gömülme derinliği (metre)
  
  // 2. Kesişim & Miter Düğüm Birleştirme (Junction Node Miter & Weld)
  miterMaxExtension: 1.40,       // Keskin açılarda aşırı miter uzamasını sınırlama katsayısı
  
  // 3. Çatallanma ve Rampa Parapet Ayrımı (Inner Parapet Suppression at Merges & Forks)
  parapetSuppressionRadius: 24.0,// Katılım/ayrılma noktalarında iç korkulukları yumuşakça bastırma mesafesi (metre)
  
  // 4. İskele (Pier) ve Taşıyıcı Ayak Yerleşimi
  pierSpacing: 27.0,             // Viyadük ayak aralığı (metre)
  pierMinHeight: 3.2,            // Ayak dikilmesi için gereken minimum net zemin açıklığı (metre)
  
  // 5. Geometri Eşikleri
  step: 3.0,                     // Kesit örnekleme aralığı (metre)
  deckAbove: 2.0,                // Kutu kirişli viyadük alt açıklığı eşiği (metre)
};

const concrete = [0.6, 0.6, 0.58];
const asphalt = [0.3, 0.3, 0.32];
const paint = [0.9, 0.9, 0.87];
const barrier = [0.7, 0.72, 0.72];

export async function buildFlyovers(url, ground, customParams = {}) {
  const params = { ...JUNCTION_PARAMS, ...customParams };
  const { edges } = await (await fetch(url)).json();
  const soup = new Soup();

  // Helper point evaluator with miter scaling
  const at = (c, l, v) => [
    c.p[0] + c.n[0] * (l * c.miterScale),
    c.p[1] + v,
    c.p[2] + c.n[2] * (l * c.miterScale),
  ];

  const sweep = (a, b, profile, color) => {
    const pa = typeof profile === 'function' ? profile(a) : profile;
    const pb = typeof profile === 'function' ? profile(b) : profile;
    for (let j = 0; j + 1 < pa.length; j++) {
      soup.quad(at(a, ...pa[j]), at(b, ...pb[j]), at(b, ...pb[j + 1]), at(a, ...pa[j + 1]), color);
    }
  };

  // 1. Discover all elevated edges and their approach ramps
  const elevSet = new Set();
  const edgeMaxH = new Float32Array(edges.length);

  for (let idx = 0; idx < edges.length; idx++) {
    const e = edges[idx];
    if (e.tunnel) continue;

    let maxH = 0;
    for (let p = 1; p < e.pts.length; p += 3) {
      const h = e.pts[p] - ground(e.pts[p - 1], e.pts[p + 1]);
      if (h > maxH) maxH = h;
    }
    edgeMaxH[idx] = maxH;

    const isExpressway = e.highway.startsWith('motorway') || e.highway.startsWith('trunk');
    const isBridge = !!(e.flyover || e.span || e.bridge || (e.layer != null && e.layer > 0));

    // Seed directly elevated edges: true bridges, upper-layer spans, or roads with clear vertical clearance (>= 2.5m or expressway >= 2.0m)
    if (isBridge || maxH >= 2.5 || (isExpressway && maxH >= 2.0)) {
      elevSet.add(idx);
    }
  }

  // Expand along connected approach ramps joining elevated bridge nodes
  let expanded = true;
  let pass = 0;
  while (expanded && pass < 2) {
    pass++;
    expanded = false;
    const elevNodes = new Set();
    elevSet.forEach((i) => {
      elevNodes.add(edges[i].a);
      elevNodes.add(edges[i].b);
    });

    for (let idx = 0; idx < edges.length; idx++) {
      if (elevSet.has(idx) || edges[idx].tunnel) continue;
      if (elevNodes.has(edges[idx].a) || elevNodes.has(edges[idx].b)) {
        if (edgeMaxH[idx] >= 0.85) {
          elevSet.add(idx);
          expanded = true;
        }
      }
    }
  }

  // 2. Build sections along true road polylines (using rails.js robust sections)
  const elevatedList = [];
  elevSet.forEach((idx) => {
    const e = edges[idx];
    const cs = sections(e.pts, ground);
    if (cs.length < 2) return;

    const isExpressway = e.highway.startsWith('motorway') || e.highway.startsWith('trunk');
    const lanes = Math.max(1, e.lanes);
    const halfWidth = e.span
      ? lanes * 1.65 + 7
      : (lanes * 3.3 + (isExpressway ? 2.2 : 1.4)) / 2;

    cs.forEach((c) => {
      c.miterScale = 1.0;
      c.suppressLeftParapet = 0;
      c.suppressRightParapet = 0;
    });

    elevatedList.push({
      edge: e,
      idx,
      isExpressway,
      lanes,
      w: halfWidth,
      cs,
    });
  });

  // 3. Topological Node Adjacency Graph
  const nodeMap = new Map(); // nodeId -> [{ item, isStart }]
  elevatedList.forEach((item) => {
    const e = item.edge;
    if (!nodeMap.has(e.a)) nodeMap.set(e.a, []);
    if (!nodeMap.has(e.b)) nodeMap.set(e.b, []);
    nodeMap.get(e.a).push({ item, isStart: true });
    nodeMap.get(e.b).push({ item, isStart: false });
  });

  // 4. Mathematical Miter Normal Welding at Continuous Joints (Degree = 2)
  nodeMap.forEach((conns) => {
    if (conns.length === 2) {
      const c1 = conns[0];
      const c2 = conns[1];
      const sec1 = c1.isStart ? c1.item.cs[0] : c1.item.cs[c1.item.cs.length - 1];
      const sec2 = c2.isStart ? c2.item.cs[0] : c2.item.cs[c2.item.cs.length - 1];

      // Outward headings away from the junction
      const d1 = c1.isStart ? [sec1.t[0], sec1.t[2]] : [-sec1.t[0], -sec1.t[2]];
      const d2 = c2.isStart ? [sec2.t[0], sec2.t[2]] : [-sec2.t[0], -sec2.t[2]];

      const dot = d1[0] * d2[0] + d1[1] * d2[1];
      if (dot < -0.2) {
        // Continuous road: bisector tangent & normal
        let tx = d1[0] - d2[0];
        let tz = d1[1] - d2[1];
        const len = Math.hypot(tx, tz);
        if (len > 1e-4) {
          tx /= len;
          tz /= len;
          const nx = -tz, nz = tx;
          const cosHalf = Math.sqrt(Math.max(0.1, (1 - dot) / 2));
          const miter = Math.min(params.miterMaxExtension, 1.0 / cosHalf);

          // Snap both endpoints exactly to the joint midpoint
          const midX = (sec1.p[0] + sec2.p[0]) * 0.5;
          const midY = (sec1.p[1] + sec2.p[1]) * 0.5;
          const midZ = (sec1.p[2] + sec2.p[2]) * 0.5;
          sec1.p[0] = sec2.p[0] = midX;
          sec1.p[1] = sec2.p[1] = midY;
          sec1.p[2] = sec2.p[2] = midZ;

          sec1.n = [nx, 0, nz];
          sec2.n = [nx, 0, nz];
          sec1.miterScale = miter;
          sec2.miterScale = miter;
        }
      }
    }
  });

  // 5. Parapet Suppression at Merges and Forks (Degree >= 3)
  nodeMap.forEach((conns) => {
    if (conns.length >= 3) {
      const c0 = conns[0];
      const pNode = c0.isStart ? c0.item.cs[0].p : c0.item.cs[c0.item.cs.length - 1].p;
      const R = params.parapetSuppressionRadius;

      conns.forEach((c) => {
        const item = c.item;
        const cs = item.cs;
        const dir = c.isStart ? [cs[0].t[0], cs[0].t[2]] : [-cs[cs.length - 1].t[0], -cs[cs.length - 1].t[2]];

        cs.forEach((sec) => {
          const d = Math.hypot(sec.p[0] - pNode[0], sec.p[2] - pNode[2]);
          if (d < R) {
            const factor = Math.max(0, 1.0 - d / R);
            conns.forEach((other) => {
              if (other.item === item) return;
              const otherDir = other.isStart ? [other.item.cs[0].t[0], other.item.cs[0].t[2]] : [-other.item.cs[other.item.cs.length - 1].t[0], -other.item.cs[other.item.cs.length - 1].t[2]];
              const cross = dir[0] * otherDir[1] - dir[1] * otherDir[0];
              if (cross > 0.08) {
                sec.suppressRightParapet = Math.max(sec.suppressRightParapet, factor);
              } else if (cross < -0.08) {
                sec.suppressLeftParapet = Math.max(sec.suppressLeftParapet, factor);
              }
            });
          }
        });
      });
    }
  });

  // 6. Sweep Decks, Parapets, Retaining Walls and Piers
  const STEP = params.step;
  const DECK_ABOVE = params.deckAbove;
  const RAMP_CUTOFF = params.rampMinHeightCutoff;

  for (const item of elevatedList) {
    const { edge: e, isExpressway, lanes, w, cs } = item;

    for (let i = 0; i + 1 < cs.length; i++) {
      const a = cs[i], b = cs[i + 1], h = Math.max(a.h, b.h);
      if (h <= RAMP_CUTOFF) continue;

      if (e.span) {
        // Girders seen from below; the road surface is draped on the deck
        if (Math.min(a.h, b.h) > DECK_ABOVE) {
          sweep(a, b, [[-w, -0.3], [-w, -1.5], [w, -1.5], [w, -0.3]], concrete);
        }
        continue;
      }

      // Asphalt Deck Surface
      sweep(a, b, [[-w + 0.25, 0], [w - 0.25, 0]], asphalt);

      // Lane Paint
      const line = (o) => sweep(a, b, [[o - 0.07, 0.015], [o + 0.07, 0.015]], paint);
      line(-w + 0.75);
      line(w - 0.75);
      if (Math.floor(a.s / (STEP * 2)) % 2 === 0) {
        for (let k = 1; k < lanes; k++) {
          line(-w + 0.75 + (k * (2 * w - 1.5)) / lanes);
        }
      }

      // Parapets with smooth junction suppression
      const topHeight = isExpressway ? 1.9 : 1.0;

      // Left Parapet
      const leftH = topHeight * Math.max(0, 1.0 - a.suppressLeftParapet);
      if (leftH > 0.15) {
        sweep(a, b, [[-(w - 0.25), 0], [-(w - 0.25), Math.min(0.9, leftH)], [-w, Math.min(0.9, leftH)]], concrete);
        if (isExpressway && leftH > 0.9) {
          sweep(a, b, [[-(w - 0.1), 0.9], [-(w - 0.1), leftH]], barrier);
        }
      }

      // Right Parapet
      const rightH = topHeight * Math.max(0, 1.0 - a.suppressRightParapet);
      if (rightH > 0.15) {
        sweep(a, b, [[w - 0.25, 0], [w - 0.25, Math.min(0.9, rightH)], [w, Math.min(0.9, rightH)]], concrete);
        if (isExpressway && rightH > 0.9) {
          sweep(a, b, [[w - 0.1, 0.9], [w - 0.1, rightH]], barrier);
        }
      }

      // Underside Box Girder vs Retaining Wall
      if (Math.min(a.h, b.h) > DECK_ABOVE) {
        // Box girder underside
        sweep(a, b, [[-w, 0.9], [-w, -0.5], [-w * 0.55, -1.5], [w * 0.55, -1.5], [w, -0.5], [w, 0.9]], concrete);
      } else {
        // Ramp on fill between retaining walls, sinking 40cm under ground to avoid steps
        sweep(a, b, (c) => [[-w, 0.9], [-w, -Math.max(c.h, 0) - params.retainingWallSink]], concrete);
        sweep(a, b, (c) => [[w, -Math.max(c.h, 0) - params.retainingWallSink], [w, 0.9]], concrete);
      }
    }

    // Concrete Piers
    for (const c of cs) {
      if (
        !e.span &&
        c.h > params.pierMinHeight &&
        Math.round(c.s / STEP) % Math.round(params.pierSpacing / STEP) === 1
      ) {
        soup.box(
          c.p,
          c.t,
          c.n,
          1.15,
          Math.min(1.5, w * 0.4),
          c.p[1] - c.h - 1.5,
          c.p[1] - 1.5,
          concrete
        );
      }
    }
  }

  // Convert colors to SRGB ColorSpace
  for (let i = 0; i < soup.col.length; i += 3) {
    const c = new THREE.Color().setRGB(soup.col[i], soup.col[i + 1], soup.col[i + 2], THREE.SRGBColorSpace);
    soup.col[i] = c.r;
    soup.col[i + 1] = c.g;
    soup.col[i + 2] = c.b;
  }

  const mesh = soup.mesh(
    new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.85,
      metalness: 0.02,
      side: THREE.DoubleSide,
    })
  );
  mesh.name = 'flyovers';
  return mesh;
}
