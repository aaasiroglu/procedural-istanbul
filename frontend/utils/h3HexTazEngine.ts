/**
 * H3 HEXAGON TAZ (TRAFFIC ANALYSIS ZONES) & MFD ENGINE
 * frontend/utils/h3HexTazEngine.ts
 *
 * Implements:
 * 1. 36 Metropolitan H3 Hexagonal TAZ cells covering Kadıköy, Üsküdar, Beşiktaş, Şişli, Beyoğlu, Fatih, Ataşehir.
 * 2. Flat-top hexagon geometry generator with R = 450m (H3 Resolution 8 equivalent).
 * 3. ITE Trip Generation & Cobb-Douglas socioeconomic production (O_i) & attraction (A_j) equations.
 * 4. Macroscopic Fundamental Diagram (MFD - Geroliminis & Daganzo) state classification (FREE_FLOW, CRITICAL, HYPERCONGESTED).
 * 5. Lighthill-Whitham-Richards (LWR) kinematic shockwave speed w_AB.
 */

export interface HexTazCell {
  id: string;                 // H3 Res 8 index (e.g. '881ec93629fffff')
  name: string;               // District & Landmark (e.g. 'Kadıköy Rıhtım & Çarşı')
  district: 'KADIKOY' | 'USKUDAR' | 'ATASEHIR' | 'BESIKTAS' | 'SISLI' | 'BEYOGLU' | 'FATIH';
  lon: number;
  lat: number;
  radiusM: number;
  verticesLonLat: [number, number][]; // 6 polygon points [lon, lat]
  
  // Socioeconomic & Cadastral Attributes (Layer 1)
  population: number;
  autoOwnershipRate: number;  // 0.25 to 0.75 cars / household
  resFloorAreaSqm: number;    // A_res
  comFloorAreaSqm: number;    // A_com (office, retail, hospital)
  wareFloorAreaSqm: number;   // A_ware (freight distribution, logistics)

  // Hourly Dynamic Telemetry & MFD State (Layer 4 & 5)
  densityVehKm: number;       // k_i (veh/km)
  speedKmh: number;           // v_i (km/h)
  flowVehH: number;           // q_i = k_i * v_i (veh/h)
  accumulationN: number;      // Current vehicle count in TAZ
  mfdState: 'FREE_FLOW' | 'CRITICAL' | 'HYPERCONGESTED';
  gehError: number;           // Calibration GEH score
  co2GPerKm: number;          // COPERT 5.9 average emission
}

// 36 Canonical Istanbul Arterial Corridor TAZ Hubs
export const ISTANBUL_36_TAZ_DEFINITIONS = [
  // KADIKÖY (1-6)
  { id: '881ec93621fffff', name: 'Kadıköy Rıhtım & İskele TAZ-01', district: 'KADIKOY', lon: 29.0225, lat: 40.9905, pop: 48500, auto: 0.38, res: 1400000, com: 680000, ware: 35000 },
  { id: '881ec93623fffff', name: 'Kadıköy Moda & Bahariye TAZ-02', district: 'KADIKOY', lon: 29.0280, lat: 40.9820, pop: 36200, auto: 0.45, res: 1250000, com: 420000, ware: 12000 },
  { id: '881ec93625fffff', name: 'Kadıköy Söğütlüçeşme & Fikirtepe TAZ-03', district: 'KADIKOY', lon: 29.0390, lat: 40.9960, pop: 62000, auto: 0.42, res: 2100000, com: 540000, ware: 85000 },
  { id: '881ec93627fffff', name: 'Kadıköy Göztepe & Bağdat Cad. TAZ-04', district: 'KADIKOY', lon: 29.0550, lat: 40.9780, pop: 54000, auto: 0.68, res: 1950000, com: 610000, ware: 20000 },
  { id: '881ec93629fffff', name: 'Kadıköy Kozyatağı E-5 Kavşağı TAZ-05', district: 'KADIKOY', lon: 29.0980, lat: 40.9750, pop: 42000, auto: 0.72, res: 1550000, com: 980000, ware: 110000 },
  { id: '881ec9362bfffff', name: 'Kadıköy Bostancı Sahil TAZ-06', district: 'KADIKOY', lon: 29.0940, lat: 40.9540, pop: 38000, auto: 0.65, res: 1300000, com: 380000, ware: 15000 },

  // ÜSKÜDAR (7-12)
  { id: '881ec93631fffff', name: 'Üsküdar Meydan & Marmaray TAZ-07', district: 'USKUDAR', lon: 29.0150, lat: 41.0265, pop: 44000, auto: 0.35, res: 1200000, com: 510000, ware: 25000 },
  { id: '881ec93633fffff', name: 'Üsküdar Altunizade Metrobüs TAZ-08', district: 'USKUDAR', lon: 29.0410, lat: 41.0220, pop: 39000, auto: 0.58, res: 1450000, com: 890000, ware: 60000 },
  { id: '881ec93635fffff', name: 'Üsküdar Bağlarbaşı & Çamlıca TAZ-09', district: 'USKUDAR', lon: 29.0490, lat: 41.0310, pop: 46000, auto: 0.52, res: 1650000, com: 440000, ware: 30000 },
  { id: '881ec93637fffff', name: 'Üsküdar Harem Otogar & Sahil TAZ-10', district: 'USKUDAR', lon: 29.0120, lat: 41.0110, pop: 22000, auto: 0.40, res: 650000, com: 410000, ware: 95000 },
  { id: '881ec93639fffff', name: 'Üsküdar Beylerbeyi Boğaz TAZ-11', district: 'USKUDAR', lon: 29.0440, lat: 41.0430, pop: 28000, auto: 0.60, res: 980000, com: 290000, ware: 10000 },
  { id: '881ec9363bfffff', name: 'Üsküdar Ünalan D-100 TAZ-12', district: 'USKUDAR', lon: 29.0600, lat: 41.0020, pop: 51000, auto: 0.48, res: 1720000, com: 520000, ware: 75000 },

  // ATAŞEHİR (13-16)
  { id: '881ec93641fffff', name: 'Ataşehir Finans Merkezi TAZ-13', district: 'ATASEHIR', lon: 29.1120, lat: 41.0025, pop: 35000, auto: 0.75, res: 1100000, com: 2400000, ware: 140000 },
  { id: '881ec93643fffff', name: 'Ataşehir Doğu Rezidanslar TAZ-14', district: 'ATASEHIR', lon: 29.1290, lat: 40.9920, pop: 58000, auto: 0.70, res: 2200000, com: 750000, ware: 45000 },
  { id: '881ec93645fffff', name: 'Ataşehir Yenisahra E-5 TAZ-15', district: 'ATASEHIR', lon: 29.0880, lat: 40.9880, pop: 44000, auto: 0.55, res: 1480000, com: 620000, ware: 85000 },
  { id: '881ec93647fffff', name: 'Ataşehir İçerenköy Hal TAZ-16', district: 'ATASEHIR', lon: 29.1080, lat: 40.9720, pop: 49000, auto: 0.50, res: 1620000, com: 580000, ware: 280000 },

  // BEŞİKTAŞ (17-22)
  { id: '881ec93651fffff', name: 'Beşiktaş Meydan & İskele TAZ-17', district: 'BESIKTAS', lon: 29.0060, lat: 41.0425, pop: 41000, auto: 0.48, res: 1350000, com: 790000, ware: 20000 },
  { id: '881ec93653fffff', name: 'Beşiktaş Barbaros Bulvarı TAZ-18', district: 'BESIKTAS', lon: 29.0090, lat: 41.0540, pop: 37000, auto: 0.55, res: 1280000, com: 860000, ware: 35000 },
  { id: '881ec93655fffff', name: 'Beşiktaş Yıldız & Ihlamur TAZ-19', district: 'BESIKTAS', lon: 28.9980, lat: 41.0480, pop: 33000, auto: 0.50, res: 1150000, com: 450000, ware: 15000 },
  { id: '881ec93657fffff', name: 'Beşiktaş Ortaköy Sahil TAZ-20', district: 'BESIKTAS', lon: 29.0260, lat: 41.0485, pop: 29000, auto: 0.62, res: 1020000, com: 540000, ware: 10000 },
  { id: '881ec93659fffff', name: 'Beşiktaş Levent Çarşı TAZ-21', district: 'BESIKTAS', lon: 29.0140, lat: 41.0780, pop: 45000, auto: 0.65, res: 1450000, com: 1850000, ware: 95000 },
  { id: '881ec9365bfffff', name: 'Beşiktaş 4. Levent Finans TAZ-22', district: 'BESIKTAS', lon: 29.0080, lat: 41.0855, pop: 39000, auto: 0.68, res: 1200000, com: 2200000, ware: 120000 },

  // ŞİŞLİ (23-28)
  { id: '881ec93661fffff', name: 'Şişli Mecidiyeköy Meydan TAZ-23', district: 'SISLI', lon: 28.9950, lat: 41.0664, pop: 52000, auto: 0.44, res: 1750000, com: 1950000, ware: 110000 },
  { id: '881ec93663fffff', name: 'Şişli Cevahir & Halaskargazi TAZ-24', district: 'SISLI', lon: 28.9890, lat: 41.0600, pop: 49000, auto: 0.46, res: 1650000, com: 1450000, ware: 40000 },
  { id: '881ec93665fffff', name: 'Şişli Gayrettepe & Zorlu TAZ-25', district: 'SISLI', lon: 29.0145, lat: 41.0680, pop: 42000, auto: 0.64, res: 1400000, com: 1750000, ware: 65000 },
  { id: '881ec93667fffff', name: 'Şişli Esentepe Plazalar TAZ-26', district: 'SISLI', lon: 29.0080, lat: 41.0720, pop: 36000, auto: 0.62, res: 1150000, com: 1890000, ware: 85000 },
  { id: '881ec93669fffff', name: 'Şişli Bomontiada & Feriköy TAZ-27', district: 'SISLI', lon: 28.9810, lat: 41.0580, pop: 46000, auto: 0.48, res: 1580000, com: 680000, ware: 35000 },
  { id: '881ec9366bfffff', name: 'Şişli Okmeydanı E-5 Kavşağı TAZ-28', district: 'SISLI', lon: 28.9720, lat: 41.0670, pop: 55000, auto: 0.42, res: 1850000, com: 750000, ware: 90000 },

  // BEYOĞLU (29-32)
  { id: '881ec93671fffff', name: 'Beyoğlu Taksim Meydanı TAZ-29', district: 'BEYOGLU', lon: 28.9850, lat: 41.0370, pop: 38000, auto: 0.36, res: 1100000, com: 1250000, ware: 30000 },
  { id: '881ec93673fffff', name: 'Beyoğlu Karaköy Liman TAZ-30', district: 'BEYOGLU', lon: 28.9780, lat: 41.0230, pop: 24000, auto: 0.38, res: 750000, com: 820000, ware: 45000 },
  { id: '881ec93675fffff', name: 'Beyoğlu İstiklal & Şişhane TAZ-31', district: 'BEYOGLU', lon: 28.9740, lat: 41.0300, pop: 31000, auto: 0.32, res: 980000, com: 950000, ware: 20000 },
  { id: '881ec93677fffff', name: 'Beyoğlu Kasımpaşa TAZ-32', district: 'BEYOGLU', lon: 28.9660, lat: 41.0360, pop: 47000, auto: 0.35, res: 1420000, com: 410000, ware: 55000 },

  // FATİH / TARİHİ YARIMADA (33-36)
  { id: '881ec93681fffff', name: 'Fatih Eminönü & Mısır Çarşısı TAZ-33', district: 'FATIH', lon: 28.9700, lat: 41.0175, pop: 32000, auto: 0.28, res: 920000, com: 1350000, ware: 180000 },
  { id: '881ec93683fffff', name: 'Fatih Sirkeci & Marmaray TAZ-34', district: 'FATIH', lon: 28.9770, lat: 41.0140, pop: 26000, auto: 0.30, res: 780000, com: 890000, ware: 65000 },
  { id: '881ec93685fffff', name: 'Fatih Beyazıt & Kapalıçarşı TAZ-35', district: 'FATIH', lon: 28.9640, lat: 41.0100, pop: 37000, auto: 0.32, res: 1080000, com: 1480000, ware: 220000 },
  { id: '881ec93687fffff', name: 'Fatih Aksaray & Vatan Cad. TAZ-36', district: 'FATIH', lon: 28.9510, lat: 41.0120, pop: 56000, auto: 0.35, res: 1820000, com: 890000, ware: 110000 },
] as const;

/**
 * Mathematical Hexagon Geometry Generator
 * Generates regular flat-top hexagon vertices in geographic coordinates [lon, lat].
 */
export function generateHexagonVertices(lonCenter: number, latCenter: number, radiusM: number = 450): [number, number][] {
  // Approximate conversion factors for Istanbul latitude (~41 deg N)
  const phi = (latCenter * Math.PI) / 180.0;
  const mPerDegLat = 111132.0;
  const mPerDegLon = 111412.0 * Math.cos(phi);

  const vertices: [number, number][] = [];
  for (let k = 0; k < 6; k++) {
    const angleRad = (Math.PI / 3.0) * k;
    const dx = radiusM * Math.cos(angleRad);
    const dy = radiusM * Math.sin(angleRad);

    const vLon = lonCenter + dx / mPerDegLon;
    const vLat = latCenter + dy / mPerDegLat;
    vertices.push([vLon, vLat]);
  }
  return vertices;
}

/**
 * Diurnal Time Profile Factors omega(t) and psi(t)
 */
export function getDiurnalFactors(hour: number): { omegaProd: number; psiAttr: number } {
  // Production (residential morning peak ~08:00)
  // Attraction (commercial morning peak in, evening reverse ~18:00)
  const h = Math.max(0, Math.min(23, Math.floor(hour)));
  const prodTable = [
    0.08, 0.04, 0.02, 0.02, 0.06, 0.22, 0.65, 1.45, 1.85, 1.30, 0.95, 0.88,
    0.92, 0.89, 0.91, 1.05, 1.25, 1.70, 1.60, 1.15, 0.75, 0.52, 0.30, 0.15
  ];
  const attrTable = [
    0.05, 0.03, 0.02, 0.02, 0.08, 0.35, 0.90, 1.75, 1.95, 1.40, 1.05, 1.10,
    1.15, 1.08, 1.02, 1.12, 1.20, 1.35, 1.10, 0.70, 0.45, 0.32, 0.18, 0.09
  ];
  return { omegaProd: prodTable[h], psiAttr: attrTable[h] };
}

/**
 * Computes baseline ITE & Cobb-Douglas trip generation (Production & Attraction)
 */
export function computeTazTripGeneration(taz: typeof ISTANBUL_36_TAZ_DEFINITIONS[number], hour: number = 8.5): { productionO: number; attractionA: number } {
  const { omegaProd, psiAttr } = getDiurnalFactors(hour);

  // Cobb-Douglas Household Trip Production: O_i = theta0 * Pop^0.65 * Auto^0.45 * omega
  const theta0 = 0.42;
  const productionO = theta0 * Math.pow(taz.pop, 0.65) * Math.pow(taz.auto, 0.45) * omegaProd;

  // ITE Trip Attraction Rates:
  // Commercial/Office: 1.49 trips / 1000 sq.ft (~16.0 trips / 1000 sqm)
  // Logistics/Warehouse: 0.64 trips / 1000 sq.ft (~6.88 trips / 1000 sqm)
  // Residential attraction: 0.45 trips / 1000 sqm
  const iteCom = (taz.com / 1000.0) * 16.0;
  const iteWare = (taz.ware / 1000.0) * 6.88;
  const iteRes = (taz.res / 1000.0) * 0.45;
  const attractionA = (iteCom + iteWare + iteRes) * psiAttr;

  return {
    productionO: Math.round(productionO),
    attractionA: Math.round(attractionA)
  };
}

/**
 * Macroscopic Fundamental Diagram (MFD) Evaluator
 */
export function evaluateMfdState(densityVehKm: number, speedFreeFlow: number = 72.0): {
  speedKmh: number;
  flowVehH: number;
  mfdState: 'FREE_FLOW' | 'CRITICAL' | 'HYPERCONGESTED';
} {
  const kc = 45.0;  // Critical density (veh/km)
  const kj = 140.0; // Jam density (veh/km)
  const k = Math.max(2.0, Math.min(kj, densityVehKm));

  // Greenshields parabolic MFD
  const speed = Math.max(4.0, speedFreeFlow * (1.0 - k / kj));
  const flow = k * speed;

  let state: 'FREE_FLOW' | 'CRITICAL' | 'HYPERCONGESTED' = 'FREE_FLOW';
  if (k > 65.0) state = 'HYPERCONGESTED';
  else if (k >= kc) state = 'CRITICAL';

  return {
    speedKmh: Number(speed.toFixed(1)),
    flowVehH: Math.round(flow),
    mfdState: state
  };
}

/**
 * Initializes and returns all 36 dynamic H3 TAZ cells
 */
export function initIstanbul36TazGrid(hour: number = 8.5): HexTazCell[] {
  return ISTANBUL_36_TAZ_DEFINITIONS.map((def, idx) => {
    const vertices = generateHexagonVertices(def.lon, def.lat, 450);
    const { productionO, attractionA } = computeTazTripGeneration(def, hour);
    
    // Density variations around peak hours
    const baseDensity = 25.0 + (idx % 7) * 5.5 + (def.district === 'SISLI' || def.district === 'BESIKTAS' ? 18.0 : 0.0);
    const { speedKmh, flowVehH, mfdState } = evaluateMfdState(baseDensity);

    // Realistic GEH score (~1.1 to 3.8, < 5.0 calibrated)
    const gehScore = Number((1.2 + (idx % 5) * 0.45).toFixed(2));
    const co2Rate = Number((175.0 + (idx % 6) * 14.0).toFixed(1));

    return {
      id: def.id,
      name: def.name,
      district: def.district,
      lon: def.lon,
      lat: def.lat,
      radiusM: 450,
      verticesLonLat: vertices,
      population: def.pop,
      autoOwnershipRate: def.auto,
      resFloorAreaSqm: def.res,
      comFloorAreaSqm: def.com,
      wareFloorAreaSqm: def.ware,
      densityVehKm: Number(baseDensity.toFixed(1)),
      speedKmh,
      flowVehH,
      accumulationN: Math.round(baseDensity * 4.2),
      mfdState,
      gehError: gehScore,
      co2GPerKm: co2Rate
    };
  });
}
