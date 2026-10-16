/**
 * MODERN CARTOGRAPHIC ROAD TRAFFIC FLOW VEIN LAYER (UBER MOVEMENT / MAPBOX STANDARD)
 * src/world/roadHeatmapLayer.js
 *
 * Implements:
 * 1. Uber Movement / Mapbox Traffic Standard: Elegant, slender glowing flow veins along the road centerline.
 * 2. Leaves realistic asphalt textures, white lane dashes, and curbs crisp and visible.
 * 3. Additive glowing veins (width 1.4m - 2.4m, opacity 0.52).
 * 4. Refined scientific Level of Service (LOS) color ramp:
 *    - Green (Free-flow), Amber (Stable/Dense), Crimson (Congested), Violet (Shockwave / Breakdown).
 */

import * as THREE from 'three';

const LOS_COLORS = {
  A: new THREE.Color(0x10b981), // Emerald
  B: new THREE.Color(0x34d399), // Light green
  C: new THREE.Color(0xfbbf24), // Amber
  D: new THREE.Color(0xf97316), // Orange
  E: new THREE.Color(0xef4444), // Crimson
  F: new THREE.Color(0xd946ef), // Cyberpunk Violet
};

export class RoadHeatmapLayer {
  constructor({ scene, traffic, streamer }) {
    this.scene = scene;
    this.traffic = traffic;
    this.streamer = streamer;

    this.group = new THREE.Group();
    this.group.name = 'road-traffic-heatmap';
    this.scene.add(this.group);

    this.mode = 'los';
    this.visible = false;
    this.group.visible = false;
    this.time = 0;

    this.initMesh();
  }

  initMesh() {
    if (!this.traffic?.graph?.lanes?.length) return;

    const lanes = this.traffic.graph.lanes;
    const edges = [...new Set(lanes.map((l) => l.edge))];

    const positions = [];
    const colors = [];
    const indices = [];
    this.edgeRanges = [];

    let vertexOffset = 0;

    for (const edge of edges) {
      if (!edge.pts || edge.pts.length < 6) continue;

      const pts = [];
      for (let i = 0; i < edge.pts.length; i += 3) {
        pts.push([edge.pts[i], edge.pts[i + 1], edge.pts[i + 2]]);
      }

      if (pts.length < 2) continue;

      // Slender centerline vein: 1.6m width (leaves lane dashes and sidewalks visible)
      const halfW = 0.8;
      const startV = vertexOffset;

      for (let i = 0; i < pts.length; i++) {
        const prev = pts[Math.max(0, i - 1)];
        const next = pts[Math.min(pts.length - 1, i + 1)];

        const dx = next[0] - prev[0];
        const dz = next[2] - prev[2];
        const len = Math.hypot(dx, dz) || 1.0;

        const nx = -(dz / len) * halfW;
        const nz = (dx / len) * halfW;

        const py = pts[i][1] + 0.18; // Gently floating above road surface

        positions.push(pts[i][0] + nx, py, pts[i][2] + nz);
        positions.push(pts[i][0] - nx, py, pts[i][2] - nz);

        colors.push(0.06, 0.72, 0.50);
        colors.push(0.06, 0.72, 0.50);

        if (i > 0) {
          const a = startV + (i - 1) * 2;
          const b = startV + i * 2;
          indices.push(a, b, a + 1);
          indices.push(b, b + 1, a + 1);
        }
      }

      const count = pts.length * 2;
      vertexOffset += count;
      this.edgeRanges.push({ edge, start: startV, count });
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    geometry.setIndex(indices);

    // Subtle additive glowing vein material
    this.material = new THREE.MeshBasicMaterial({
      vertexColors: true,
      transparent: true,
      opacity: 0.52,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    });

    this.mesh = new THREE.Mesh(geometry, this.material);
    this.mesh.renderOrder = 4;
    this.group.add(this.mesh);

    this.updateColors();
  }

  setMode(mode) {
    this.mode = mode;
    this.updateColors();
  }

  updateColors(chaosActive = false) {
    if (!this.mesh) return;

    const colorAttr = this.mesh.geometry.attributes.color;

    for (const range of this.edgeRanges) {
      const edge = range.edge;
      const maxSpeed = edge.maxspeed || 50;
      let liveSpeed = edge.liveSpeedKph != null ? edge.liveSpeedKph : maxSpeed * 0.85;

      if (chaosActive && (edge.highway === 'trunk' || edge.highway === 'primary' || edge.name?.includes('Mecidiyeköy'))) {
        liveSpeed = Math.max(6.0, liveSpeed * 0.2);
      }

      const ratio = Math.max(0.05, Math.min(1.0, liveSpeed / maxSpeed));
      let targetColor;

      if (this.mode === 'co2') {
        if (ratio < 0.3) targetColor = new THREE.Color(0xd946ef);
        else if (ratio < 0.6) targetColor = new THREE.Color(0xf43f5e);
        else targetColor = new THREE.Color(0x06b6d4);
      } else if (this.mode === 'density') {
        if (ratio > 0.8) targetColor = LOS_COLORS.A;
        else if (ratio > 0.55) targetColor = LOS_COLORS.C;
        else if (ratio > 0.35) targetColor = LOS_COLORS.D;
        else targetColor = LOS_COLORS.F;
      } else {
        if (edge.closed) {
          targetColor = new THREE.Color(0x1e1e24);
        } else if (ratio >= 0.85) {
          targetColor = LOS_COLORS.A;
        } else if (ratio >= 0.65) {
          targetColor = LOS_COLORS.B;
        } else if (ratio >= 0.45) {
          targetColor = LOS_COLORS.C;
        } else if (ratio >= 0.25) {
          targetColor = LOS_COLORS.D;
        } else if (ratio >= 0.12) {
          targetColor = LOS_COLORS.E;
        } else {
          targetColor = LOS_COLORS.F;
        }
      }

      for (let i = range.start; i < range.start + range.count; i++) {
        colorAttr.setXYZ(i, targetColor.r, targetColor.g, targetColor.b);
      }
    }

    colorAttr.needsUpdate = true;
  }

  update(dt, chaosActive = false) {
    this.time += dt;
    if (this.material && chaosActive) {
      this.material.opacity = 0.45 + 0.2 * Math.sin(this.time * 4.0);
    }
  }

  setVisible(visible) {
    this.visible = visible;
    this.group.visible = visible;
  }
}
