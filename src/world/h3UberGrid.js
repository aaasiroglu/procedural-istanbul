/**
 * COMPACT UBER H3 HONEYCOMB GRID GENERATOR (RES 9 EQUIVALENT, R = 135m)
 * src/world/h3UberGrid.js
 *
 * Implements:
 * 1. Dense, compact hexagonal honeycomb grid covering the Istanbul corridor.
 * 2. Proper geometric flat-top tiling (radius R = 135m, spacing dx = 202.5m, dz = 233.8m).
 * 3. Each micro-cell is assigned realistic cadastral land use, population, and diurnal trip generation.
 * 4. Micro-extrusion flush on terrain elevation using streamer.ground(cx, cz).
 * 5. High-performance raycasting and cursor-following tooltip.
 */

import * as THREE from 'three';

// Sector clusters across the corridor
const CORRIDOR_SECTORS = [
  { name: 'Mecidiyeköy Merkez & Viyadük', lon: 28.9940, lat: 41.0660, type: 'transit_hub', basePop: 18000, comWeight: 2.8 },
  { name: 'Cevahir & Halaskargazi Aksı', lon: 28.9890, lat: 41.0610, type: 'commercial', basePop: 22000, comWeight: 2.4 },
  { name: 'Gayrettepe & Zorlu Center', lon: 29.0145, lat: 41.0680, type: 'financial', basePop: 15000, comWeight: 3.5 },
  { name: 'Esentepe Plazalar Bölgesi', lon: 29.0080, lat: 41.0725, type: 'financial', basePop: 14000, comWeight: 3.8 },
  { name: 'Levent Çarşı & Kanyon', lon: 29.0125, lat: 41.0780, type: 'commercial', basePop: 16000, comWeight: 3.2 },
  { name: '4. Levent & Sapphire Kule', lon: 29.0075, lat: 41.0850, type: 'financial', basePop: 15000, comWeight: 3.6 },
  { name: 'Barbaros Bulvarı Üst Düğüm', lon: 29.0110, lat: 41.0600, type: 'residential', basePop: 19000, comWeight: 1.6 },
  { name: 'Yıldız & Ihlamur Vadisi', lon: 29.0010, lat: 41.0500, type: 'residential', basePop: 21000, comWeight: 1.2 },
  { name: 'Beşiktaş Meydan & İskele', lon: 29.0060, lat: 41.0425, type: 'transit_hub', basePop: 17000, comWeight: 2.5 },
  { name: 'Ortaköy Boğaz Yaklaşımı', lon: 29.0260, lat: 41.0485, type: 'commercial', basePop: 14000, comWeight: 2.1 },
  { name: 'Bomontiada & Feriköy', lon: 28.9810, lat: 41.0580, type: 'residential', basePop: 24000, comWeight: 1.5 },
  { name: 'Okmeydanı E-5 Kavşağı', lon: 28.9720, lat: 41.0670, type: 'transit_hub', basePop: 26000, comWeight: 1.8 },
  { name: 'Zincirlikuyu Metrobüs Aktarma', lon: 29.0165, lat: 41.0675, type: 'transit_hub', basePop: 12000, comWeight: 4.2 },
  { name: '15 Temmuz Köprüsü Katılımı', lon: 29.0280, lat: 41.0490, type: 'highway_node', basePop: 8000, comWeight: 2.0 },
];

export class H3UberGridLayer {
  constructor({ scene, proj, streamer, onSelectHex, zones = null }) {
    this.zones = zones; // the OD estimate's zones (public/data/od/<area>.json): when given, the grid is the real one
    this.scene = scene;
    this.proj = proj;
    this.streamer = streamer;
    this.onSelectHex = onSelectHex;

    this.group = new THREE.Group();
    this.group.name = 'h3-uber-grid-layer';
    this.scene.add(this.group);

    this.radius = 135.0; // Compact H3 Res 9 radius in meters
    this.visible = false;
    this.group.visible = false;
    this.selectedHexId = null;
    this.hoveredHexId = null;
    this.activeMetric = 'total_outflow'; // 'total_outflow', 'total_inflow', 'mfd_density', 'speed', 'co2'

    this.hexCells = [];
    this.hexMeshes = new Map();

    this.initTooltip();
    if (this.zones) this.buildFromZones();
    else this.generateHoneycombGrid();
  }

  initTooltip() {
    let el = document.getElementById('h3-uber-tooltip');
    if (!el) {
      el = document.createElement('div');
      el.id = 'h3-uber-tooltip';
      el.style.cssText = `
        position: fixed;
        pointer-events: none;
        z-index: 2500;
        display: none;
        background: rgba(11, 15, 28, 0.94);
        backdrop-filter: blur(14px);
        -webkit-backdrop-filter: blur(14px);
        border: 1px solid rgba(56, 189, 248, 0.4);
        border-radius: 10px;
        padding: 10px 14px;
        font-family: system-ui, -apple-system, sans-serif;
        font-size: 11px;
        color: #f1f5f9;
        box-shadow: 0 12px 32px rgba(0, 0, 0, 0.7);
        transform: translate(16px, 16px);
        transition: opacity 0.12s ease;
      `;
      document.body.appendChild(el);
    }
    this.tooltipEl = el;

    window.addEventListener('pointermove', (e) => {
      if (this.tooltipEl && this.tooltipEl.style.display !== 'none') {
        this.tooltipEl.style.left = `${e.clientX}px`;
        this.tooltipEl.style.top = `${e.clientY}px`;
      }
    });
  }

  // The estimate's own zones: its H3 resolution-8 cells (their true boundaries) and its gateways (a small hexagon
  // where a major road crosses the boundary). Trips are the estimate's; speed and congestion are the median of the
  // İBB segments inside the cell in the snapshot the estimate used; density is read back from that speed.
  buildFromZones() {
    const VF = 60, KJ = 140; // (km/h, veh/km/lane: a rough link between speed and density, for the colour scale only)
    this.zones.forEach((z, index) => {
      const [cx, cz] = this.proj.project(z.lon, z.lat);
      const gateway = z.kind === 'gateway';
      const speed = z.speed_kph ?? null;
      const cell = {
        id: z.id, index, real: true, kind: z.kind,
        name: gateway ? `Geçit ${z.id}: ${z.name || 'sınır yolu'}` : `H3 ${z.id.slice(0, 9)}…`,
        sector: gateway ? 'alan sınırı (transit trafik)' : 'iç zon', type: gateway ? 'gateway' : 'h3',
        cx, cz, lon: z.lon, lat: z.lat, groundY: this.streamer ? this.streamer.ground(cx, cz) : 40.0,
        outflow: Math.round(z.out), inflow: Math.round(z.in), priorOut: Math.round(z.prior_out), priorIn: Math.round(z.prior_in),
        speedKmh: speed, segments: z.segments ?? 0, congestion: z.congestion ?? null,
        densityK: speed == null ? null : Number((KJ * Math.max(0, 1 - speed / VF)).toFixed(1)),
        mfdState: z.state ?? 'NO_DATA', co2Rate: z.co2_g_km ?? null, co2GPerKm: z.co2_g_km ?? null,
      };
      if (z.boundary) cell.cornerXZ = z.boundary.map(([lo, la]) => { const [x, zz] = this.proj.project(lo, la); return { dx: x - cx, dz: zz - cz }; });
      this.hexCells.push(cell);
    });
    this.createMeshes();
  }

  generateHoneycombGrid() {
    // Grid bounds in local projected space covering the corridor
    // Approx X: -1200 to +1400, Z: -1400 to +1200
    const R = this.radius;
    const dx = R * 1.5;
    const dz = Math.sqrt(3) * R;

    let cellIndex = 0;

    for (let col = -7; col <= 8; col++) {
      for (let row = -6; row <= 6; row++) {
        const cx = col * dx;
        const cz = row * dz + (Math.abs(col) % 2 === 1 ? dz / 2.0 : 0);

        // Check if within corridor radius (~1600m from origin)
        if (Math.hypot(cx, cz) > 1750.0) continue;

        const [lon, lat] = this.proj.unproject(cx, cz);
        const groundY = this.streamer ? this.streamer.ground(cx, cz) : 40.0;

        // Associate with nearest sector definition for realistic land use weights
        let nearestSector = CORRIDOR_SECTORS[0];
        let minDist = Infinity;
        for (const s of CORRIDOR_SECTORS) {
          const d = Math.hypot(lon - s.lon, lat - s.lat);
          if (d < minDist) {
            minDist = d;
            nearestSector = s;
          }
        }

        const h3Index = `891ec9${(cellIndex + 100).toString(16)}fffff`;
        const cellName = `${nearestSector.name} • H3-${String(cellIndex).padStart(2, '0')}`;

        // Diurnal baseline parameters
        const pop = Math.round(nearestSector.basePop * (0.8 + 0.4 * Math.sin(col + row)));
        const comRate = nearestSector.comWeight;
        const baseOutflow = Math.round(pop * 0.08 * comRate);
        const baseInflow = Math.round(pop * 0.09 * (comRate > 2.5 ? 1.6 : 0.8));
        const densityK = Number((28.0 + (cellIndex % 9) * 4.2 + (nearestSector.type === 'transit_hub' ? 14 : 0)).toFixed(1));
        const speedKmh = Number(Math.max(12.0, 72.0 * (1.0 - densityK / 140.0)).toFixed(1));
        const co2Rate = Number((160.0 + (140.0 - speedKmh) * 1.4).toFixed(1));
        const gehScore = Number((1.2 + (cellIndex % 6) * 0.4).toFixed(2));

        let mfdState = 'FREE_FLOW';
        if (densityK > 65.0) mfdState = 'HYPERCONGESTED';
        else if (densityK >= 45.0) mfdState = 'CRITICAL';

        const cellData = {
          id: h3Index,
          index: cellIndex,
          name: cellName,
          sector: nearestSector.name,
          type: nearestSector.type,
          cx,
          cz,
          lon,
          lat,
          groundY,
          pop,
          outflow: baseOutflow,
          inflow: baseInflow,
          densityK,
          speedKmh,
          mfdState,
          co2Rate,
          gehScore,
        };

        this.hexCells.push(cellData);
        cellIndex++;
      }
    }

    this.createMeshes();
  }

  buildTerrainConformingGeometry(cell, initialHeight) {
    const R = cell.kind === 'gateway' ? 120 : this.radius;
    const angles = [0, 1, 2, 3, 4, 5].map((k) => Math.PI / 6 + (k * Math.PI) / 3);
    const corners = cell.cornerXZ || angles.map((a) => ({
      dx: R * Math.cos(a),
      dz: R * Math.sin(a),
    }));

    const gy0 = this.streamer ? this.streamer.ground(cell.cx, cell.cz) : (cell.groundY || 30.0);
    const gyCorners = corners.map((c) =>
      this.streamer ? this.streamer.ground(cell.cx + c.dx, cell.cz + c.dz) : gy0
    );

    cell.gy0 = gy0;
    cell.gyCorners = gyCorners;
    cell.corners = corners;

    const positions = [];
    const H = initialHeight;

    const getBot = (k) => [corners[k].dx, gyCorners[k] + 0.15, corners[k].dz];
    const getTop = (k) => [corners[k].dx, gyCorners[k] + 0.15 + H, corners[k].dz];
    const centerBot = [0, gy0 + 0.15, 0];
    const centerTop = [0, gy0 + 0.15 + H, 0];

    // 1. Top Cap (6 triangles)
    for (let k = 0; k < 6; k++) {
      const k2 = (k + 1) % 6;
      positions.push(...centerTop, ...getTop(k), ...getTop(k2));
    }

    // 2. Side Walls (6 quads = 12 triangles)
    for (let k = 0; k < 6; k++) {
      const k2 = (k + 1) % 6;
      const b1 = getBot(k), b2 = getBot(k2);
      const t1 = getTop(k), t2 = getTop(k2);
      positions.push(...b1, ...b2, ...t2);
      positions.push(...b1, ...t2, ...t1);
    }

    // 3. Bottom Cap (6 triangles)
    for (let k = 0; k < 6; k++) {
      const k2 = (k + 1) % 6;
      positions.push(...centerBot, ...getBot(k2), ...getBot(k));
    }

    const geom = new THREE.BufferGeometry();
    geom.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geom.computeVertexNormals();

    // 4. Perimeter wireframe on top rim
    const linePos = [];
    for (let k = 0; k <= 6; k++) {
      const idx = k % 6;
      linePos.push(corners[idx].dx, gyCorners[idx] + 0.15 + H, corners[idx].dz);
    }
    const wireGeom = new THREE.BufferGeometry();
    wireGeom.setAttribute('position', new THREE.Float32BufferAttribute(linePos, 3));

    return { geom, wireGeom };
  }

  createMeshes() {
    const baseHeight = 5.0;

    for (const cell of this.hexCells) {
      const { geom, wireGeom } = this.buildTerrainConformingGeometry(cell, baseHeight);

      const mat = new THREE.MeshStandardMaterial({
        color: 0x0284c7,
        roughness: 0.35,
        metalness: 0.25,
        transparent: true,
        opacity: 0.45,
        side: THREE.DoubleSide,
      });

      const mesh = new THREE.Mesh(geom, mat);
      mesh.position.set(cell.cx, 0, cell.cz);
      mesh.userData = { isUberHex: true, hexId: cell.id, cell };

      const edgeMat = new THREE.LineBasicMaterial({
        color: 0x38bdf8,
        transparent: true,
        opacity: 0.85,
      });
      const wireframe = new THREE.Line(wireGeom, edgeMat);
      mesh.add(wireframe);

      this.group.add(mesh);
      this.hexMeshes.set(cell.id, { mesh, wireframe, cell, baseHeight });
    }

    this.updateAppearance();
  }

  setMetric(metric) {
    this.activeMetric = metric;
    this.updateAppearance();
  }

  applyScenarioModifiers({ speedFactor = 1.0, demandFactor = 1.0, rainMm = 0, snowActive = false, ramazanActive = false }) {
    // (the estimate's zones are one observed snapshot: what-if modifiers do not rewrite them)
    if (this.hexCells.some((c) => c.real)) { this.updateAppearance(); return; }
    for (const cell of this.hexCells) {
      cell.outflow = Math.round(cell.outflow * demandFactor * (ramazanActive ? 1.35 : 1.0));
      cell.inflow = Math.round(cell.inflow * demandFactor * (ramazanActive ? 1.35 : 1.0));

      let effSpeed = cell.speedKmh * speedFactor;
      if (rainMm > 5) effSpeed *= 0.82;
      if (snowActive) effSpeed *= 0.58;
      cell.effectiveSpeed = Number(Math.max(8.0, effSpeed).toFixed(1));

      cell.effectiveDensity = Number(Math.min(135.0, cell.densityK * (1.0 / (speedFactor * (snowActive ? 0.6 : 1.0)))).toFixed(1));

      if (cell.effectiveDensity > 65.0) cell.effectiveMfdState = 'HYPERCONGESTED';
      else if (cell.effectiveDensity >= 45.0) cell.effectiveMfdState = 'CRITICAL';
      else cell.effectiveMfdState = 'FREE_FLOW';
    }

    this.updateAppearance();
  }

  updateCellHeight(entry, targetHeight) {
    const { mesh, wireframe, cell } = entry;
    const geom = mesh.geometry;
    const pos = geom.attributes.position;
    const H = targetHeight;
    const { gy0, gyCorners } = cell;

    let pIdx = 0;
    // Top Cap (18 vertices)
    for (let k = 0; k < 6; k++) {
      const k2 = (k + 1) % 6;
      pos.setXYZ(pIdx++, 0, gy0 + 0.15 + H, 0);
      pos.setXYZ(pIdx++, cell.corners[k].dx, gyCorners[k] + 0.15 + H, cell.corners[k].dz);
      pos.setXYZ(pIdx++, cell.corners[k2].dx, gyCorners[k2] + 0.15 + H, cell.corners[k2].dz);
    }
    // Side Walls (36 vertices)
    for (let k = 0; k < 6; k++) {
      const k2 = (k + 1) % 6;
      pIdx += 2; // skip b1, b2
      pos.setXYZ(pIdx++, cell.corners[k2].dx, gyCorners[k2] + 0.15 + H, cell.corners[k2].dz); // t2
      pIdx += 1; // skip b1
      pos.setXYZ(pIdx++, cell.corners[k2].dx, gyCorners[k2] + 0.15 + H, cell.corners[k2].dz); // t2
      pos.setXYZ(pIdx++, cell.corners[k].dx, gyCorners[k] + 0.15 + H, cell.corners[k].dz); // t1
    }
    pos.needsUpdate = true;
    geom.computeVertexNormals();

    if (wireframe && wireframe.geometry) {
      const wPos = wireframe.geometry.attributes.position;
      for (let k = 0; k <= 6; k++) {
        const idx = k % 6;
        wPos.setXYZ(k, cell.corners[idx].dx, gyCorners[idx] + 0.15 + H, cell.corners[idx].dz);
      }
      wPos.needsUpdate = true;
    }
  }

  updateAppearance() {
    let maxVal = 1;
    for (const cell of this.hexCells) {
      let v = 0;
      if (this.activeMetric === 'total_outflow') v = cell.outflow;
      else if (this.activeMetric === 'total_inflow') v = cell.inflow;
      else if (this.activeMetric === 'mfd_density') v = cell.effectiveDensity || cell.densityK;
      else if (this.activeMetric === 'speed') v = cell.effectiveSpeed || cell.speedKmh;
      else if (this.activeMetric === 'co2') v = cell.co2Rate;
      if (v > maxVal) maxVal = v;
    }

    for (const [id, entry] of this.hexMeshes) {
      const cell = entry.cell;
      let val = 0;
      if (this.activeMetric === 'total_outflow') val = cell.outflow;
      else if (this.activeMetric === 'total_inflow') val = cell.inflow;
      else if (this.activeMetric === 'mfd_density') val = cell.effectiveDensity || cell.densityK;
      else if (this.activeMetric === 'speed') val = cell.effectiveSpeed || cell.speedKmh;
      else if (this.activeMetric === 'co2') val = cell.co2Rate;

      const norm = Math.max(0.08, Math.min(1.0, val / maxVal));
      const targetHeight = 4.0 + norm * 18.0;

      this.updateCellHeight(entry, targetHeight);

      const isSelected = id === this.selectedHexId;
      const isHovered = id === this.hoveredHexId;

      if (isSelected) {
        entry.mesh.material.color.setHex(0xf59e0b); // Gold amber
        entry.mesh.material.opacity = 0.82;
        entry.wireframe.material.color.setHex(0xfde047);
      } else if (isHovered) {
        entry.mesh.material.color.setHex(0x38bdf8); // Sky blue
        entry.mesh.material.opacity = 0.75;
        entry.wireframe.material.color.setHex(0xffffff);
      } else {
        if (this.activeMetric === 'mfd_density' || this.activeMetric === 'speed') {
          // Density / Congestion Palette
          const state = cell.effectiveMfdState || cell.mfdState;
          if (state === 'NO_DATA') {
            entry.mesh.material.color.setHex(0x475569); // slate: no İBB segment in this cell
            entry.wireframe.material.color.setHex(0x64748b);
          } else if (state === 'FREE_FLOW') {
            entry.mesh.material.color.setHex(0x10b981); // Emerald
            entry.wireframe.material.color.setHex(0x34d399);
          } else if (state === 'CRITICAL') {
            entry.mesh.material.color.setHex(0xf59e0b); // Amber
            entry.wireframe.material.color.setHex(0xfbbf24);
          } else {
            entry.mesh.material.color.setHex(0xef4444); // Crimson red
            entry.wireframe.material.color.setHex(0xf87171);
          }
        } else if (this.activeMetric === 'co2') {
          entry.mesh.material.color.setHex(norm > 0.6 ? 0x9333ea : 0x0284c7);
          entry.wireframe.material.color.setHex(norm > 0.6 ? 0xc084fc : 0x38bdf8);
        } else {
          // Kepler dark-to-cyan choropleth ramp
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
    if (cell.real) { this.showRealTooltip(cell, clientX, clientY); return; }
    const speed = cell.effectiveSpeed || cell.speedKmh;
    const density = cell.effectiveDensity || cell.densityK;
    const state = cell.effectiveMfdState || cell.mfdState;

    this.tooltipEl.innerHTML = `
      <div style="font-weight: 700; color: #ffffff; margin-bottom: 6px; display: flex; align-items: center; justify-content: space-between; gap: 8px;">
        <span style="display: flex; align-items: center; gap: 5px;">
          <span style="color: #38bdf8; font-size: 13px;">⬡</span>
          <span>${cell.name}</span>
        </span>
        <span style="font-family: monospace; font-size: 9px; padding: 2px 5px; background: rgba(56, 189, 248, 0.15); border-radius: 4px; color: #38bdf8;">H3 Res 9</span>
      </div>
      <div style="display: grid; grid-template-columns: auto auto; gap: 4px 14px; font-size: 10px; color: #cbd5e1;">
        <span style="color: #94a3b8;">Bölge / Fonksiyon:</span>
        <strong style="color: #f8fafc;">${cell.sector} (${cell.type})</strong>
        <span style="color: #94a3b8;">Üretim (O_i):</span>
        <strong style="font-family: monospace; color: #10b981;">${cell.outflow.toLocaleString()} yolcu/sa</strong>
        <span style="color: #94a3b8;">Çekim (A_j):</span>
        <strong style="font-family: monospace; color: #38bdf8;">${cell.inflow.toLocaleString()} yolcu/sa</strong>
        <span style="color: #94a3b8;">Trafik Hızı:</span>
        <strong style="font-family: monospace; color: ${speed < 25 ? '#f43f5e' : '#34d399'};">${speed} km/h</strong>
        <span style="color: #94a3b8;">Yoğunluk (k):</span>
        <strong style="font-family: monospace; color: ${density > 60 ? '#f43f5e' : '#fbbf24'};">${density} veh/km (${state})</strong>
        <span style="color: #94a3b8;">CO2 Emisyonu:</span>
        <strong style="font-family: monospace; color: #a855f7;">${cell.co2Rate} g/km</strong>
      </div>
    `;
    this.tooltipEl.style.left = `${clientX}px`;
    this.tooltipEl.style.top = `${clientY}px`;
    this.tooltipEl.style.display = 'block';
  }

  showRealTooltip(cell, clientX, clientY) {
    const n = (v) => (v == null ? '—' : Math.round(v).toLocaleString('tr-TR'));
    const STATE = { FREE_FLOW: 'akıcı (İBB 1–2)', CRITICAL: 'yoğun (İBB 3)', HYPERCONGESTED: 'çok yoğun (İBB 4–5)', NO_DATA: 'İBB segmenti yok' };
    const row = (k, v, c = '#f8fafc') => `<span style="color:#94a3b8">${k}</span><strong style="font-family:monospace;color:${c}">${v}</strong>`;
    this.tooltipEl.innerHTML = `
      <div style="font-weight:700;color:#fff;margin-bottom:6px;display:flex;justify-content:space-between;gap:10px">
        <span>${cell.name}</span>
        <span style="font-family:monospace;font-size:9px;padding:2px 5px;background:rgba(52,211,153,.15);border-radius:4px;color:#34d399">gerçek veri</span>
      </div>
      <div style="display:grid;grid-template-columns:auto auto;gap:4px 14px;font-size:10px">
        ${row('Üretim (tahmin)', `${n(cell.outflow)} araç/sa`, '#34d399')}
        ${row('Çekim (tahmin)', `${n(cell.inflow)} araç/sa`, '#38bdf8')}
        ${row('Prior (üretim / çekim)', `${n(cell.priorOut)} / ${n(cell.priorIn)}`, '#94a3b8')}
        ${row('İBB medyan hız', cell.speedKmh == null ? '—' : `${cell.speedKmh} km/sa (${cell.segments} segment)`, cell.speedKmh != null && cell.speedKmh < 25 ? '#f43f5e' : '#34d399')}
        ${row('Durum', STATE[cell.mfdState] || cell.mfdState, '#fbbf24')}
        ${row('CO2 (hıza bağlı eğri)', cell.co2Rate == null ? '—' : `${cell.co2Rate} g/km`, '#a855f7')}
      </div>
      <div style="margin-top:6px;font-size:9px;color:#64748b">Kaynak: ters O-D tahmini (İBB sayımlarıyla sabitlenmiş) ve İBB canlı hız görüntüsü</div>`;
    this.tooltipEl.style.left = `${clientX}px`;
    this.tooltipEl.style.top = `${clientY}px`;
    this.tooltipEl.style.display = 'block';
  }

  hideTooltip() {
    if (this.tooltipEl) this.tooltipEl.style.display = 'none';
  }

  get selectedHex() {
    if (!this.selectedHexId) return null;
    return this.hexMeshes.get(this.selectedHexId)?.cell || null;
  }

  selectHex(hexId) {
    this.selectedHexId = hexId;
    this.updateAppearance();
    if (this.onSelectHex) {
      const entry = this.hexMeshes.get(hexId);
      this.onSelectHex(entry ? entry.cell : null);
    }
  }

  setHovered(hexId, clientX, clientY) {
    if (this.hoveredHexId !== hexId) {
      this.hoveredHexId = hexId;
      this.updateAppearance();
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

  raycast(raycaster) {
    if (!this.visible) return null;
    const intersects = raycaster.intersectObjects(this.group.children, true);
    for (const hit of intersects) {
      let obj = hit.object;
      while (obj && !obj.userData.isUberHex && obj.parent) {
        obj = obj.parent;
      }
      if (obj && obj.userData && obj.userData.isUberHex) {
        return obj.userData.hexId;
      }
    }
    return null;
  }

  update(dt) {
    // Optional subtle pulse for selected hex wireframe
    if (this.selectedHexId && this.hexMeshes.has(this.selectedHexId)) {
      this.time = (this.time || 0) + dt;
      const entry = this.hexMeshes.get(this.selectedHexId);
      if (entry && entry.wireframe) {
        entry.wireframe.material.opacity = 0.7 + 0.3 * Math.sin(this.time * 5.0);
      }
    }
  }
}

