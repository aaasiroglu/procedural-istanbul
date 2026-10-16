/**
 * MODERN CARTOGRAPHIC OD DESIRE ARCS LAYER (DECK.GL ARCLAYER STANDARD)
 * src/world/odFlowArcsLayer.js
 *
 * Implements:
 * 1. Deck.gl ArcLayer aesthetic: Slender, anti-aliased parabolic desire lines.
 * 2. Origin-to-Destination Color Gradient (e.g., Sky Blue -> Amber).
 * 3. Volume-proportional opacity (0.35 to 0.90) and line thickness.
 * 4. Micro-pulsing traveler photons indicating flow vector.
 */

import * as THREE from 'three';

export class OdFlowArcsLayer {
  constructor({ scene, proj, streamer }) {
    this.scene = scene;
    this.proj = proj;
    this.streamer = streamer;

    this.group = new THREE.Group();
    this.group.name = 'od-flow-arcs-layer';
    this.scene.add(this.group);

    this.curves = [];
    this.animatedMeshes = [];
    this.time = 0;
    this.visible = false;
    this.group.visible = false;
  }

  clearArcs() {
    while (this.group.children.length > 0) {
      const obj = this.group.children[0];
      this.group.remove(obj);
      if (obj.geometry) obj.geometry.dispose();
      if (obj.material) {
        if (Array.isArray(obj.material)) obj.material.forEach((m) => m.dispose());
        else obj.material.dispose();
      }
    }
    this.curves = [];
    this.animatedMeshes = [];
  }

  updateArcs(corridors, selectedHexId, direction = 'outflow', tazLookup = new Map(), maxArcs = 10) {
    this.clearArcs();
    if (!selectedHexId || !corridors || corridors.length === 0) return;

    const filtered = corridors
      .filter((c) => (direction === 'outflow' ? c.originId === selectedHexId : c.destId === selectedHexId))
      .sort((a, b) => b.tripsPerHour - a.tripsPerHour)
      .slice(0, maxArcs);

    if (filtered.length === 0) return;

    const maxTrips = filtered[0].tripsPerHour || 1;

    for (const corr of filtered) {
      const origCell = tazLookup.get(corr.originId);
      const destCell = tazLookup.get(corr.destId);
      if (!origCell || !destCell) continue;

      const [ox, oz] = this.proj.project(origCell.lon, origCell.lat);
      const [dx, dz] = this.proj.project(destCell.lon, destCell.lat);

      const startY = (this.streamer ? this.streamer.ground(ox, oz) : 30) + 8.0;
      const endY = (this.streamer ? this.streamer.ground(dx, dz) : 30) + 8.0;

      const pStart = new THREE.Vector3(ox, startY, oz);
      const pEnd = new THREE.Vector3(dx, endY, dz);
      const dist = pStart.distanceTo(pEnd);

      // Deck.gl style arc apex (proportional to distance)
      const apexY = Math.max(startY, endY) + Math.min(320, 60 + dist * 0.22);
      const pMid = new THREE.Vector3((ox + dx) / 2.0, apexY, (oz + dz) / 2.0);

      const curve = new THREE.QuadraticBezierCurve3(pStart, pMid, pEnd);
      this.curves.push({ curve, corridor: corr });

      const norm = Math.max(0.2, corr.tripsPerHour / maxTrips);

      // Subdivided arc line with vertex color gradient
      const segments = 48;
      const points = curve.getPoints(segments);
      const positions = [];
      const colors = [];

      // Origin color (Cyan 0x38bdf8) -> Destination color (Amber 0xf59e0b)
      const colorOrig = direction === 'outflow' ? new THREE.Color(0x38bdf8) : new THREE.Color(0xf59e0b);
      const colorDest = direction === 'outflow' ? new THREE.Color(0xf59e0b) : new THREE.Color(0x38bdf8);

      for (let i = 0; i < points.length; i++) {
        positions.push(points[i].x, points[i].y, points[i].z);
        const t = i / (points.length - 1);
        const c = new THREE.Color().lerpColors(colorOrig, colorDest, t);
        colors.push(c.r, c.g, c.b);
      }

      const geom = new THREE.BufferGeometry();
      geom.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
      geom.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));

      // Slender, refined glowing line
      const mat = new THREE.LineBasicMaterial({
        vertexColors: true,
        transparent: true,
        opacity: 0.35 + norm * 0.55,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      });

      const lineMesh = new THREE.Line(geom, mat);
      this.group.add(lineMesh);

      // Delicate, subtle traveling photon dot
      const photonGeom = new THREE.SphereGeometry(2.5 + norm * 2.0, 8, 8);
      const photonMat = new THREE.MeshBasicMaterial({
        color: 0xffffff,
        transparent: true,
        opacity: 0.9,
      });
      const photon = new THREE.Mesh(photonGeom, photonMat);
      this.group.add(photon);

      this.animatedMeshes.push({
        photon,
        curve,
        speed: 0.35 + norm * 0.45,
        offset: Math.random(),
      });
    }
  }

  update(dt) {
    this.time += dt;
    for (const item of this.animatedMeshes) {
      const t = (this.time * item.speed + item.offset) % 1.0;
      const pos = item.curve.getPoint(t);
      item.photon.position.copy(pos);
    }
  }

  setVisible(visible) {
    this.visible = visible;
    this.group.visible = visible;
  }
}
