// Matrakçı-Twin: Global Store ve Canlı Simülasyon Durum Yönetimi
// 1537 Beyân-ı Menâzil x 2026 Spatial AI (Merkez: Sarayburnu / Galata Köprüsü / Haliç Girişi)

export const PROJECTION_ORIGIN = { lon: 28.9800, lat: 41.0200 };
const METERS_PER_DEG_LON = 83950.0;
const METERS_PER_DEG_LAT = 111130.0;

export function projectLonLat(lon, lat, elev = 0) {
  const x = (lon - PROJECTION_ORIGIN.lon) * METERS_PER_DEG_LON;
  const z = -(lat - PROJECTION_ORIGIN.lat) * METERS_PER_DEG_LAT;
  return [x, elev, z];
}

export function unprojectToLonLat(x, z) {
  const lon = PROJECTION_ORIGIN.lon + x / METERS_PER_DEG_LON;
  const lat = PROJECTION_ORIGIN.lat - z / METERS_PER_DEG_LAT;
  return [lon, lat];
}

// 2. Initial Seed Dataset: 25 Yol Koridoru (Dersaadet - Üsküdar - Galata)
function createSeedRoads() {
  const roadDefs = [
    { id: 'road_01', name: 'Divanyolu Caddesi (Mese Aksı)', lanes: 2, pts: [[28.9760, 41.0080, 5], [28.9710, 41.0100, 6], [28.9640, 41.0115, 7]], vrp: true, gnn: 0.98 },
    { id: 'road_02', name: 'Eminönü - Sirkeci Sahil Yolu', lanes: 3, pts: [[28.9700, 41.0170, 2], [28.9770, 41.0150, 2], [28.9830, 41.0130, 2]], vrp: false, gnn: 0.94 },
    { id: 'road_03', name: 'Tarihi Galata Köprüsü', lanes: 3, pts: [[28.9735, 41.0180, 2.2], [28.9740, 41.0210, 4.5], [28.9745, 41.0240, 2.2]], vrp: true, gnn: 0.99 },
    { id: 'road_04', name: 'Karaköy Kemeraltı Caddesi', lanes: 2, pts: [[28.9745, 41.0240, 2], [28.9810, 41.0255, 2], [28.9870, 41.0270, 2]], vrp: false, gnn: 0.91 },
    { id: 'road_05', name: 'Galata Kulesi Yokuşu & Hendek Cad.', lanes: 1, pts: [[28.9745, 41.0240, 2], [28.9740, 41.0250, 5], [28.9742, 41.0265, 8.5]], vrp: true, gnn: 0.96 },
    { id: 'road_06', name: 'İstiklal Caddesi (Cadde-i Kebir)', lanes: 1, pts: [[28.9742, 41.0265, 8.5], [28.9780, 41.0300, 9], [28.9850, 41.0340, 9]], vrp: false, gnn: 0.88 },
    { id: 'road_07', name: 'Boğaziçi Deniz Hattı (Eminönü - Üsküdar)', lanes: 2, pts: [[28.9740, 41.0185, 0.4], [28.9950, 41.0220, 0.4], [29.0150, 41.0265, 0.4]], vrp: false, gnn: 0.95 },
    { id: 'road_08', name: 'Boğaziçi Deniz Hattı (Karaköy - Kadıköy)', lanes: 2, pts: [[28.9760, 41.0240, 0.4], [28.9950, 41.0120, 0.4], [29.0200, 40.9950, 0.4]], vrp: false, gnn: 0.93 },
    { id: 'road_09', name: 'Üsküdar Harem Sahil Yolu', lanes: 3, pts: [[29.0150, 41.0265, 2], [29.0120, 41.0180, 2], [29.0130, 41.0100, 2]], vrp: true, gnn: 0.97 },
    { id: 'road_10', name: 'Harem - Kadıköy Rıhtım Bağlantısı', lanes: 3, pts: [[29.0130, 41.0100, 2], [29.0180, 41.0020, 2], [29.0220, 40.9920, 2]], vrp: true, gnn: 0.95 },
    { id: 'road_11', name: 'Kadıköy Moda Caddesi', lanes: 1, pts: [[29.0220, 40.9920, 2], [29.0250, 40.9870, 4], [29.0270, 40.9820, 5]], vrp: false, gnn: 0.84 },
    { id: 'road_12', name: 'Üsküdar Doğancılar Yokuşu', lanes: 2, pts: [[29.0150, 41.0265, 2], [29.0200, 41.0250, 5], [29.0250, 41.0230, 7]], vrp: false, gnn: 0.89 },
    { id: 'road_13', name: 'Unkapanı Atatürk Köprüsü', lanes: 3, pts: [[28.9610, 41.0210, 2.2], [28.9640, 41.0235, 4.5], [28.9670, 41.0260, 2.2]], vrp: false, gnn: 0.96 },
    { id: 'road_14', name: 'Kasımpaşa Piyalepaşa Bulvarı', lanes: 3, pts: [[28.9670, 41.0260, 2], [28.9720, 41.0320, 4], [28.9780, 41.0380, 6]], vrp: true, gnn: 0.92 },
    { id: 'road_15', name: 'Fatih Fevzipaşa Caddesi', lanes: 2, pts: [[28.9480, 41.0190, 8], [28.9550, 41.0180, 8], [28.9620, 41.0165, 7]], vrp: false, gnn: 0.87 },
    { id: 'road_16', name: 'Süleymaniye Külliye Yolu', lanes: 1, pts: [[28.9620, 41.0165, 7], [28.9650, 41.0160, 8], [28.9680, 41.0145, 6]], vrp: true, gnn: 0.99 },
    { id: 'road_17', name: 'Balat - Ayvansaray Sahil Caddesi', lanes: 2, pts: [[28.9500, 41.0300, 2], [28.9560, 41.0260, 2], [28.9610, 41.0210, 2]], vrp: false, gnn: 0.90 },
    { id: 'road_18', name: 'Beşiktaş Çırağan Caddesi', lanes: 2, pts: [[28.9950, 41.0380, 2], [29.0040, 41.0420, 2], [29.0120, 41.0450, 2]], vrp: true, gnn: 0.94 },
    { id: 'road_19', name: 'Kabataş - Dolmabahçe Koridoru', lanes: 3, pts: [[28.9870, 41.0270, 2], [28.9920, 41.0320, 2], [28.9950, 41.0380, 2]], vrp: false, gnn: 0.95 },
    { id: 'road_20', name: 'Beyazıt - Aksaray Ordu Caddesi', lanes: 3, pts: [[28.9640, 41.0115, 7], [28.9560, 41.0100, 6], [28.9480, 41.0080, 5]], vrp: false, gnn: 0.91 },
    { id: 'road_21', name: 'Sarayburnu - Cankurtaran Sahil Aksı', lanes: 3, pts: [[28.9830, 41.0150, 2], [28.9880, 41.0120, 2], [28.9850, 41.0050, 2]], vrp: false, gnn: 0.89 },
    { id: 'road_22', name: 'Büyük Valide Hanı Lojistik Kolu', lanes: 1, pts: [[28.9700, 41.0150, 4], [28.9680, 41.0142, 6], [28.9650, 41.0135, 7]], vrp: true, gnn: 0.99 },
    { id: 'road_23', name: 'Mecidiyeköy - Şişli Aksı', lanes: 4, pts: [[28.9850, 41.0340, 9], [28.9890, 41.0450, 11], [28.9930, 41.0550, 12]], vrp: true, gnn: 0.97 },
    { id: 'road_24', name: 'Boğaziçi Köprü Katılım Yolu', lanes: 4, pts: [[29.0120, 41.0450, 5], [29.0220, 41.0480, 14], [29.0320, 41.0460, 12]], vrp: false, gnn: 0.96 },
    { id: 'road_25', name: 'Üsküdar Çamlıca Menzil Bağlantısı', lanes: 2, pts: [[29.0250, 41.0230, 7], [29.0350, 41.0250, 11], [29.0450, 41.0270, 14]], vrp: true, gnn: 0.93 },
  ];

  return roadDefs.map((def) => {
    const rawCoords = def.pts.map(([lon, lat, elev]) => projectLonLat(lon, lat, elev));
    let len = 0;
    for (let i = 0; i < rawCoords.length - 1; i++) {
      const dx = rawCoords[i + 1][0] - rawCoords[i][0];
      const dy = rawCoords[i + 1][1] - rawCoords[i][1];
      const dz = rawCoords[i + 1][2] - rawCoords[i][2];
      len += Math.hypot(dx, dy, dz);
    }
    return {
      edgeId: def.id,
      name: def.name,
      numLanes: def.lanes,
      rawCoords,
      length: Math.max(len, 50),
      muTravelTime: Math.round(len / 12),
      sigmaVariance: def.vrp ? 0.12 : 0.45,
      gnnKeepProb: def.gnn,
      isOptimalVrpRoute: def.vrp,
      isBlockedByAccident: false,
    };
  });
}

// 3. Initial Seed Dataset: 6 Tarihi Nirengi (1.8x ölçek abartmalı) ve 2 Kervansaray Deposu
function createSeedLandmarks() {
  return [
    {
      id: 'lm_galata',
      name: 'Galata Kulesi (Burc-ı İsa)',
      type: 'galata',
      lon: 28.9742,
      lat: 41.0257,
      pos: projectLonLat(28.9742, 41.0257, 8.5),
      scale: 1.8,
    },
    {
      id: 'lm_suleymaniye',
      name: 'Süleymaniye Külliyesi (Mimar Sinan)',
      type: 'mosque',
      lon: 28.9640,
      lat: 41.0163,
      pos: projectLonLat(28.9640, 41.0163, 8.0),
      scale: 2.1,
    },
    {
      id: 'lm_ayasofya',
      name: 'Ayasofya-i Kebir Cami-i Şerifi',
      type: 'mosque',
      lon: 28.9800,
      lat: 41.0086,
      pos: projectLonLat(28.9800, 41.0086, 4.0),
      scale: 2.0,
    },
    {
      id: 'lm_sultanahmet',
      name: 'Sultanahmet Camii (Altı Minareli)',
      type: 'mosque',
      lon: 28.9768,
      lat: 41.0054,
      pos: projectLonLat(28.9768, 41.0054, 4.0),
      scale: 1.9,
    },
    {
      id: 'lm_mihrimah',
      name: 'Üsküdar Mihrimah Sultan Camii',
      type: 'mosque',
      lon: 29.0152,
      lat: 41.0268,
      pos: projectLonLat(29.0152, 41.0268, 1.5),
      scale: 1.8,
    },
    {
      id: 'lm_beyazit',
      name: 'Bâyezid Cami-i Şerifi',
      type: 'mosque',
      lon: 28.9652,
      lat: 41.0105,
      pos: projectLonLat(28.9652, 41.0105, 7.0),
      scale: 1.7,
    },
    {
      id: 'depot_valide_han',
      name: 'Büyük Valide Hanı VRP Merkez Deposu',
      type: 'kervansaray_depot',
      lon: 28.9680,
      lat: 41.0142,
      pos: projectLonLat(28.9680, 41.0142, 6.0),
      scale: 1.9,
    },
    {
      id: 'depot_uskudar_menzil',
      name: 'Üsküdar Menzilgâhı Kervansaray Deposu',
      type: 'kervansaray_depot',
      lon: 29.0190,
      lat: 41.0220,
      pos: projectLonLat(29.0190, 41.0220, 2.5),
      scale: 1.8,
    },
  ];
}

// 4. Initial Seed Dataset: 45 Bina Adası (Cumbalı Evler ve Yalılar)
function createSeedBuildings() {
  const bldgs = [];
  const coords = [
    // Eminönü - Süleymaniye çevresi (Tarihi Yarımada Yamaçları)
    [28.966, 41.014, 5.0, 'cumba', 1.1], [28.967, 41.015, 6.0, 'cumba', 1.0], [28.969, 41.013, 5.0, 'cumba', 1.2],
    [28.971, 41.012, 4.5, 'cumba', 1.0], [28.963, 41.017, 7.0, 'cumba', 1.3], [28.962, 41.015, 7.0, 'cumba', 0.9],
    [28.965, 41.018, 5.0, 'cumba', 1.1], [28.968, 41.017, 4.0, 'cumba', 1.2],
    // Galata - Karaköy etekleri
    [28.972, 41.024, 2.0, 'cumba', 1.1], [28.973, 41.026, 5.5, 'cumba', 1.3], [28.976, 41.025, 4.0, 'cumba', 1.0],
    [28.975, 41.027, 7.5, 'cumba', 1.2], [28.977, 41.028, 8.5, 'cumba', 1.1], [28.972, 41.028, 8.0, 'cumba', 1.0],
    [28.971, 41.023, 2.0, 'cumba', 0.9],  [28.978, 41.024, 2.5, 'cumba', 1.2],
    // Boğaz & Haliç Yalıları (Aşı boyası - Kıyı hizası)
    [28.979, 41.022, 1.2, 'yali', 1.3],  [28.982, 41.024, 1.2, 'yali', 1.2],  [28.985, 41.026, 1.2, 'yali', 1.4],
    [29.013, 41.024, 1.2, 'yali', 1.3],  [29.014, 41.022, 1.2, 'yali', 1.2],  [29.012, 41.018, 1.2, 'yali', 1.4],
    [28.955, 41.026, 1.2, 'yali', 1.2],  [28.952, 41.028, 1.2, 'yali', 1.1],
    // Üsküdar Doğancılar & Çarşı
    [29.017, 41.025, 2.0, 'cumba', 1.0],  [29.019, 41.024, 3.5, 'cumba', 1.1], [29.021, 41.023, 5.0, 'cumba', 1.2],
    [29.023, 41.022, 6.0, 'cumba', 1.0], [29.018, 41.027, 2.0, 'cumba', 0.9],  [29.020, 41.028, 2.5, 'cumba', 1.1],
    // Sultanahmet & Cankurtaran
    [28.978, 41.004, 3.5, 'cumba', 1.0], [28.980, 41.003, 3.0, 'cumba', 1.2], [28.982, 41.005, 2.5, 'cumba', 1.1],
    [28.984, 41.007, 2.0, 'cumba', 0.9],  [28.975, 41.007, 4.0, 'cumba', 1.1],
    // Balat & Fener Yamaçları
    [28.952, 41.028, 4.0, 'cumba', 1.2], [28.949, 41.030, 5.5, 'cumba', 1.1], [28.947, 41.032, 6.0, 'cumba', 1.0],
    [28.954, 41.026, 3.5, 'cumba', 1.3], [28.957, 41.024, 2.5, 'cumba', 1.0],
    // Kadıköy Moda
    [29.025, 40.988, 3.0, 'cumba', 1.1], [29.027, 40.985, 3.5, 'cumba', 1.0], [29.029, 40.982, 4.0, 'cumba', 1.2],
    [29.024, 40.990, 2.0, 'cumba', 1.0],
  ];

  coords.forEach(([lon, lat, elev, style, scale], idx) => {
    bldgs.push({
      id: `bldg_${idx}`,
      style,
      scale,
      pos: projectLonLat(lon, lat, elev),
      rotation: (idx * 0.47) % (Math.PI * 2),
    });
  });
  return bldgs;
}

// 5. Initial Seed Dataset: 40 Hareketli SUMO Aracı
function createSeedVehicles(roads) {
  const vehicles = [];

  for (let i = 0; i < 40; i++) {
    const isVrp = i < 8;
    const isFerry = i >= 32;
    const isBus = !isVrp && !isFerry && i % 3 === 0;
    const type = isVrp ? 'vrp_van' : isFerry ? 'bosphorus_ferry' : isBus ? 'iett_bus' : 'civil_car';

    const targetRoad = isFerry
      ? (i % 2 === 0 ? roads.find((r) => r.edgeId === 'road_07') : roads.find((r) => r.edgeId === 'road_08'))
      : isVrp
      ? roads.filter((r) => r.isOptimalVrpRoute)[i % 7]
      : roads[i % roads.length];

    const edgeLength = targetRoad ? targetRoad.length : 300;
    const speed = isFerry ? 7.5 : isVrp ? 10.5 : isBus ? 8.5 : 12.0;

    const cargoPackages = [];
    if (isVrp) {
      const packageCount = 12 + (i % 6);
      for (let p = 0; p < packageCount; p++) {
        cargoPackages.push({
          id: `PKG_${i}_${p + 1}`,
          dims: [0.4 + (p % 3) * 0.1, 0.3 + (p % 2) * 0.1, 0.5],
          pos: [(p % 2) * 0.45 - 0.22, Math.floor(p / 4) * 0.35 + 0.15, (p % 3) * 0.5 - 0.5],
          seqOrder: packageCount - p,
        });
      }
    }

    vehicles.push({
      id: `veh_${i + 1}`,
      type,
      edgeId: targetRoad ? targetRoad.edgeId : 'road_01',
      laneIndex: isFerry ? 0 : i % (targetRoad ? targetRoad.numLanes : 2),
      lanePos: (i * 37) % edgeLength,
      edgeLength,
      speed,
      slopeAngle: 0.02,
      batterySoc: isVrp ? 88.5 - (i * 2.1) : undefined,
      cargo3D: isVrp
        ? {
            volumeFillPct: 91.4 - (i % 4) * 2.5,
            weightFillPct: 86.0 - (i % 3) * 3.0,
            lifoCompliant: true,
            packages: cargoPackages,
          }
        : undefined,
      slaConfidence: isVrp ? 96.4 - (i % 5) * 1.2 : undefined,
    });
  }
  return vehicles;
}

// 6. Matrakçı Twin Global Store Sınıfı
class TwinStore {
  constructor() {
    this.roads = createSeedRoads();
    this.landmarks = createSeedLandmarks();
    this.buildings = createSeedBuildings();
    this.vehicles = createSeedVehicles(this.roads);

    this.state = {
      viewMode: 'matrakci',
      semanticLod: 'meso',
      camera: {
        longitude: 28.9800,
        latitude: 41.0200,
        zoom: 14.2,
        pitch: 50,
        bearing: -20,
      },
      showSebekeGrid: true,
      polyfocalBendStrength: 0.75,
      chaosScenarioActive: false,
      selectedVehicleId: null,
      tributeModalOpen: false,
      vehicles: this.vehicles,
      roads: this.roads,
      landmarks: this.landmarks,
      buildings: this.buildings,
    };

    this.listeners = new Set();
    this.lastTime = performance.now();
    this.startSimulationLoop();
  }

  getState() {
    return this.state;
  }

  subscribe(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  notify() {
    for (const listener of this.listeners) {
      try {
        listener(this.state);
      } catch (err) {
        console.error('TwinStore listener error:', err);
      }
    }
  }

  setViewMode(mode) {
    if (this.state.viewMode === mode) return;
    this.state.viewMode = mode;
    this.notify();
  }

  setCamera(cam) {
    let changed = false;
    if (cam.zoom != null && Math.abs(this.state.camera.zoom - cam.zoom) > 0.08) {
      this.state.camera.zoom = cam.zoom;
      changed = true;

      // Otomatik Anlamsal LOD
      let lod = 'meso';
      if (cam.zoom < 13.5) lod = 'macro';
      else if (cam.zoom >= 16.0) lod = 'micro';
      if (this.state.semanticLod !== lod) {
        this.state.semanticLod = lod;
      }
    }
    if (cam.pitch != null) this.state.camera.pitch = cam.pitch;
    if (cam.bearing != null) this.state.camera.bearing = cam.bearing;

    if (changed) {
      this.notify();
    }
  }

  toggleSebekeGrid() {
    this.state.showSebekeGrid = !this.state.showSebekeGrid;
    this.notify();
  }

  setPolyfocalBendStrength(val) {
    this.state.polyfocalBendStrength = Math.max(0, Math.min(1.5, val));
    this.notify();
  }

  selectVehicle(id) {
    this.state.selectedVehicleId = id;
    this.notify();
  }

  setTributeModalOpen(open) {
    this.state.tributeModalOpen = !!open;
    this.notify();
  }

  triggerChaosScenario() {
    this.state.chaosScenarioActive = !this.state.chaosScenarioActive;
    const isBlocked = this.state.chaosScenarioActive;

    const targetRoad = this.roads.find((r) => r.edgeId === 'road_03');
    if (targetRoad) {
      targetRoad.isBlockedByAccident = isBlocked;
      targetRoad.sigmaVariance = isBlocked ? 0.95 : 0.12;
      targetRoad.muTravelTime = isBlocked ? 900 : 35;
    }

    this.vehicles.forEach((v) => {
      if (v.type === 'vrp_van') {
        if (isBlocked && v.edgeId === 'road_03') {
          v.edgeId = 'road_13';
          v.lanePos = 0;
          v.speed = 14.0;
          if (v.slaConfidence) v.slaConfidence = 89.2;
        } else if (!isBlocked && v.edgeId === 'road_13') {
          v.edgeId = 'road_03';
          v.lanePos = 0;
          if (v.slaConfidence) v.slaConfidence = 96.4;
        }
      }
    });

    this.notify();
  }

  startSimulationLoop() {
    const loop = (currentTime) => {
      const dt = Math.min((currentTime - this.lastTime) / 1000, 0.1);
      this.lastTime = currentTime;

      for (const veh of this.vehicles) {
        let currentRoad = this.roads.find((r) => r.edgeId === veh.edgeId);
        if (!currentRoad) continue;

        let effectiveSpeed = veh.speed;
        if (currentRoad.isBlockedByAccident && veh.type !== 'bosphorus_ferry') {
          effectiveSpeed = Math.max(1.5, veh.speed * 0.15);
        }

        veh.lanePos += effectiveSpeed * dt;

        if (veh.lanePos >= veh.edgeLength) {
          veh.lanePos = 0;
          if (veh.type === 'bosphorus_ferry') {
            veh.edgeId = veh.edgeId === 'road_07' ? 'road_08' : 'road_07';
          } else {
            const nextCandidates = this.roads.filter(
              (r) => !r.name.includes('Deniz') && (!r.isBlockedByAccident || veh.type !== 'vrp_van')
            );
            const nextRoad = nextCandidates[Math.floor(Math.random() * nextCandidates.length)];
            if (nextRoad) {
              veh.edgeId = nextRoad.edgeId;
              veh.edgeLength = nextRoad.length;
              veh.laneIndex = Math.floor(Math.random() * nextRoad.numLanes);
            }
          }
        }
      }

      requestAnimationFrame(loop);
    };

    requestAnimationFrame(loop);
  }
}

export const twinStore = new TwinStore();
