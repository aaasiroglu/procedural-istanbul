/**
 * MODERN CARTOGRAPHIC H3 HEXAGONAL TAZ LAYER (KEPLER.GL / DECK.GL STANDARD)
 * src/world/hexTazLayer.js
 *
 * Design Principles:
 * 1. Strict Cartographic Restraint: No arcade laser beams, no floating billboard clutter.
 * 2. Kepler.gl / Deck.gl H3 Choropleth: Elegant micro-extrusion (2m - 18m) draped flush on terrain.
 * 3. Razor-sharp 1px subtle boundary strokes.
 * 4. High-end Scientific Color Palettes (Viridis / Cividis / MFD Thermal).
 * 5. Interactive Cursor Tooltip: Minimalist, glassmorphic tooltip following the mouse on hover.
 */

import * as THREE from 'three';
import { ISTANBUL_36_TAZ_DEFINITIONS, initIstanbul36TazGrid } from './h3HexTazEngine.js';

export class HexTazLayer {
  constructor({ scene, proj, streamer, onSelectHex }) {
    this.scene = scene;
    this.proj = proj;
    this.streamer = streamer;
    this.onSelectHex = onSelectHex;

    this.group = new THREE.Group();
    this.group.name = 'hex-taz-layer';
    this.scene.add(this.group);

    this.activeMetric = 'total_outflow';
    this.selectedHexId = null;
    this.hoveredHexId = null;
    this.visible = true;

    this.tazCells = initIstanbul36TazGrid(8.5);
    this.hexMeshes = new Map(); // id -> { mesh, wireframe, cell, groundY }

    this.initTooltip();
    this.initMeshes();
  }

  initTooltip() {
    let tooltip = document.getElementById('carto-taz-tooltip');
    if (!tooltip) {
      tooltip = document.createElement('div');
      tooltip.id = 'carto-taz-tooltip';
      tooltip.style.cssText = `
        position: fixed;
        pointer-events: none;
        z-index: 2000;
        display: none;
        background: rgba(15, 23, 42, 0.92);
        backdrop-filter: blur(12px);
        -webkit-backdrop-filter: blur(12px);
        border: 1px solid rgba(56, 189, 248, 0.3);
        border-radius: 8px;
        padding: 8px 12px;
        font-family: system-ui, -apple-system, sans-serif;
        font-size: 11px;
        color: #f1f5f9;
        box-shadow: 0 8px 24px rgba(0, 0, 0, 0.6);
        transform: translate(14px, 14px);
        transition: opacity 0.1s ease;
      `;
      document.body.appendChild(tooltip);
    }
    this.tooltipEl = tooltip;

    window.addEventListener('pointermove', (e) => {
      if (this.tooltipEl && this.tooltipEl.style.display !== 'none') {
        this.tooltipEl.style.left = `${e.clientX}px`;
        this.tooltipEl.style.top = `${e.clientY}px`;
      }
    });
  }

  initMeshes() {
    const radius = 260.0; // Clean, non-overlapping regular hexagon radius

    for (const cell of this.tazCells) {
      const [cx, cz] = this.proj.project(cell.lon, cell.lat);
      const groundY = this.streamer ? this.streamer.ground(cx, cz) : 40.0;

      // Micro-extrusion height (subtle, elegant 6m base)
      const baseHeight = 6.0;

      const geom = new THREE.CylinderGeometry(radius, radius, baseHeight, 6, 1, false);
      geom.rotateY(Math.PI / 6);

      // Deck.gl style clean translucent choropleth material
      const mat = new THREE.MeshStandardMaterial({
        color: 0x0284c7,
        roughness: 0.35,
        metalness: 0.25,
        transparent: true,
        opacity: 0.42,
        side: THREE.DoubleSide,
      });

      const mesh = new THREE.Mesh(geom, mat);
      mesh.position.set(cx, groundY + baseHeight / 2.0, cz);
      mesh.userData = { isTazHex: true, hexId: cell.id, cell, groundY };

      // Razor-thin 1px perimeter stroke
      const edgeGeom = new THREE.EdgesGeometry(geom);
      const edgeMat = new THREE.LineBasicMaterial({
        color: 0x38bdf8,
        transparent: true,
        opacity: 0.85,
      });
      const wireframe = new THREE.LineSegments(edgeGeom, edgeMat);
      mesh.add(wireframe);

      this.group.add(mesh);
      this.hexMeshes.set(cell.id, { mesh, wireframe, cell, groundY });
    }

    this.updateLayerAppearance();
  }

  setMetric(metric) {
    this.activeMetric = metric;
    this.updateLayerAppearance();
  }

  setTimeHour(hour) {
    this.tazCells = initIstanbul36TazGrid(hour);
    for (const cell of this.tazCells) {
      const entry = this.hexMeshes.get(cell.id);
      if (entry) entry.cell = cell;
    }
    this.updateLayerAppearance();
  }

  updateLayerAppearance() {
    let maxVal = 1;
    for (const cell of this.tazCells) {
      let val = 0;
      if (this.activeMetric === 'total_outflow') val = cell.productionO;
      else if (this.activeMetric === 'total_inflow') val = cell.attractionA;
      else if (this.activeMetric === 'mfd_density') val = cell.densityVehKm;
      else if (this.activeMetric === 'geh_error') val = cell.gehError;
      else if (this.activeMetric === 'co2') val = cell.co2GPerKm;
      if (val > maxVal) maxVal = val;
    }

    for (const [id, entry] of this.hexMeshes) {
      const cell = entry.cell;
      let val = 0;

      if (this.activeMetric === 'total_outflow') val = cell.productionO;
      else if (this.activeMetric === 'total_inflow') val = cell.attractionA;
      else if (this.activeMetric === 'mfd_density') val = cell.densityVehKm;
      else if (this.activeMetric === 'geh_error') val = cell.gehError;
      else if (this.activeMetric === 'co2') val = cell.co2GPerKm;

      const norm = Math.max(0.05, Math.min(1.0, val / maxVal));
      // Subtle cartographic extrusion: 4m (min) to 24m (max)
      const targetHeight = 4.0 + norm * 20.0;
      entry.mesh.scale.set(1.0, targetHeight / 6.0, 1.0);
      entry.mesh.position.y = entry.groundY + targetHeight / 2.0;

      const isSelected = id === this.selectedHexId;
      const isHovered = id === this.hoveredHexId;

      if (isSelected) {
        entry.mesh.material.color.setHex(0xf59e0b); // Refined amber selection
        entry.mesh.material.opacity = 0.75;
        entry.wireframe.material.color.setHex(0xfde047);
      } else if (isHovered) {
        entry.mesh.material.color.setHex(0x38bdf8); // Sky blue hover
        entry.mesh.material.opacity = 0.65;
        entry.wireframe.material.color.setHex(0xffffff);
      } else {
        if (this.activeMetric === 'mfd_density' || this.activeMetric === 'geh_error') {
          // Scientific smooth heat ramp: Emerald -> Ochre -> Brick Red
          if (norm < 0.45) {
            entry.mesh.material.color.setHex(0x10b981);
            entry.wireframe.material.color.setHex(0x34d399);
          } else if (norm < 0.75) {
            entry.mesh.material.color.setHex(0xf59e0b);
            entry.wireframe.material.color.setHex(0xfbbf24);
          } else {
            entry.mesh.material.color.setHex(0xef4444);
            entry.wireframe.material.color.setHex(0xf87171);
          }
        } else if (this.activeMetric === 'co2') {
          entry.mesh.material.color.setHex(norm > 0.6 ? 0x9333ea : 0x0284c7);
          entry.wireframe.material.color.setHex(norm > 0.6 ? 0xc084fc : 0x38bdf8);
        } else {
          // Standard Kepler Dark-Slate to Cyan ramp
          const c = new THREE.Color().lerpColors(new THREE.Color(0x0f172a), new THREE.Color(0x0284c7), norm);
          entry.mesh.material.color.copy(c);
          entry.wireframe.material.color.setHex(0x38bdf8);
        }
        entry.mesh.material.opacity = 0.45;
      }
    }
  }

  showTooltip(cell, clientX, clientY) {
    if (!this.tooltipEl || !cell) return;
    this.tooltipEl.innerHTML = `
      <div style="font-weight: 700; color: #ffffff; margin-bottom: 4px; display: flex; align-items: center; gap: 6px;">
        <span style="color: #38bdf8;">⬡</span>
        <span>${cell.name}</span>
      </div>
      <div style="display: grid; grid-template-columns: auto auto; gap: 4px 12px; font-size: 10px; color: #cbd5e1;">
        <span style="color: #94a3b8;">Bölge / İlçe:</span>
        <strong style="color: #f8fafc;">${cell.district}</strong>
        <span style="color: #94a3b8;">Üretim (O_i):</span>
        <strong style="font-family: monospace; color: #10b981;">${cell.productionO.toLocaleString()} çıkış/sa</strong>
        <span style="color: #94a3b8;">Çekim (A_j):</span>
        <strong style="font-family: monospace; color: #38bdf8;">${cell.attractionA.toLocaleString()} giriş/sa</strong>
        <span style="color: #94a3b8;">MFD Durumu:</span>
        <strong style="color: ${cell.mfdState === 'HYPERCONGESTED' ? '#f43f5e' : '#fbbf24'};">${cell.mfdState}</strong>
        <span style="color: #94a3b8;">GEH Kalibrasyon:</span>
        <strong style="font-family: monospace; color: #34d399;">${cell.gehError}</strong>
      </div>
    `;
    this.tooltipEl.style.left = `${clientX}px`;
    this.tooltipEl.style.top = `${clientY}px`;
    this.tooltipEl.style.display = 'block';
  }

  hideTooltip() {
    if (this.tooltipEl) this.tooltipEl.style.display = 'none';
  }

  selectHex(hexId) {
    this.selectedHexId = hexId;
    this.updateLayerAppearance();
    if (this.onSelectHex) {
      const entry = this.hexMeshes.get(hexId);
      this.onSelectHex(entry ? entry.cell : null);
    }
  }

  setHovered(hexId, clientX, clientY) {
    if (this.hoveredHexId !== hexId) {
      this.hoveredHexId = hexId;
      this.updateLayerAppearance();
      if (hexId) {
        const entry = this.hexMeshes.get(hexId);
        if (entry) this.showTooltip(entry.cell, clientX, clientY);
      } else {
        this.hideTooltip();
      }
    }
  }

  setVisible(visible) {
    this.visible = visible;
    this.group.visible = visible;
    if (!visible) this.hideTooltip();
  }

  toggleVisible() {
    this.setVisible(!this.visible);
    return this.visible;
  }

  update(dt) {
    // Pure clean cartographic geometry; zero spinning arcade props
  }

  raycast(raycaster) {
    if (!this.visible) return null;
    const intersects = raycaster.intersectObjects(this.group.children, true);
    for (const hit of intersects) {
      let obj = hit.object;
      while (obj && !obj.userData.isTazHex && obj.parent) {
        obj = obj.parent;
      }
      if (obj && obj.userData && obj.userData.isTazHex) {
        return obj.userData.hexId;
      }
    }
    return null;
  }
}
