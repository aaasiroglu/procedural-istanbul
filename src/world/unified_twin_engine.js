// UNIFIED MOBILITY DIGITAL TWIN JAVASCRIPT ENGINE (src/world/unified_twin_engine.js)
// Implements the mathematical formulations of FedDT (Li et al., 2026), MDT (Wang et al., 2022),
// COPERT 5.9 Tier 3 (EMEP/EEA), CE Delft External Costs Handbook, and VTPI Perceived Time.

export const COPERT_PRESETS = {
  LCV_DIESEL_EURO6: {
    NOx: { alpha: 0.00012, beta: -0.0152, gamma: 1.854, delta: 2.14, epsilon: 0.0, zeta: 0.0084, eta: 0.88, rf: 0.0 },
    PM25: { alpha: 0.000008, beta: -0.00072, gamma: 0.048, delta: 0.082, epsilon: 0.0, zeta: 0.0051, eta: 1.02, rf: 0.0 },
    NMVOC: { alpha: 0.000015, beta: -0.0018, gamma: 0.112, delta: 0.154, epsilon: 0.0, zeta: 0.0062, eta: 1.10, rf: 0.0 },
    FC_g_km: { alpha: 0.0185, beta: -1.240, gamma: 98.5, delta: 120.4, epsilon: 0.0, zeta: 0.0042, eta: 1.0, rf: 0.0 },
  },
  HGV_RIGID_14_20T: {
    NOx: { alpha: 0.00085, beta: -0.064, gamma: 6.42, delta: 12.5, epsilon: 0.0, zeta: 0.012, eta: 1.05, rf: 0.0 },
    PM25: { alpha: 0.000045, beta: -0.0028, gamma: 0.185, delta: 0.42, epsilon: 0.0, zeta: 0.0075, eta: 1.15, rf: 0.0 },
    NMVOC: { alpha: 0.000062, beta: -0.0045, gamma: 0.32, delta: 0.65, epsilon: 0.0, zeta: 0.0082, eta: 1.12, rf: 0.0 },
    FC_g_km: { alpha: 0.085, beta: -4.85, gamma: 295.0, delta: 480.0, epsilon: 0.0, zeta: 0.0065, eta: 1.0, rf: 0.0 },
  },
  IETT_BUS_CNG: {
    NOx: { alpha: 0.00035, beta: -0.028, gamma: 2.95, delta: 5.2, epsilon: 0.0, zeta: 0.0095, eta: 1.02, rf: 0.15 },
    PM25: { alpha: 0.000012, beta: -0.00095, gamma: 0.035, delta: 0.095, epsilon: 0.0, zeta: 0.0068, eta: 1.08, rf: 0.20 },
    NMVOC: { alpha: 0.000045, beta: -0.0032, gamma: 0.21, delta: 0.38, epsilon: 0.0, zeta: 0.0078, eta: 1.10, rf: 0.10 },
    FC_g_km: { alpha: 0.072, beta: -3.95, gamma: 260.0, delta: 410.0, epsilon: 0.0, zeta: 0.0058, eta: 1.0, rf: 0.0 },
  },
  BEV_VAN: {
    NOx: { alpha: 0, beta: 0, gamma: 0, delta: 0, epsilon: 0, zeta: 0, eta: 1.0, rf: 1.0 },
    PM25: { alpha: 0, beta: 0, gamma: 0, delta: 0, epsilon: 0, zeta: 0, eta: 1.0, rf: 1.0 },
    NMVOC: { alpha: 0, beta: 0, gamma: 0, delta: 0, epsilon: 0, zeta: 0, eta: 1.0, rf: 1.0 },
    FC_g_km: { alpha: 0, beta: 0, gamma: 0, delta: 0, epsilon: 0, zeta: 0, eta: 1.0, rf: 1.0 },
  }
};

export const CE_DELFT_EXTERNAL_PRICES = {
  PM25_metro_eur_per_kg: 381.0,
  NOx_city_eur_per_kg: 21.3,
  NMVOC_city_eur_per_kg: 1.2,
  CO2_short_run_eur_per_ton: 100.0,
  WTT_bev_eur_per_vkm: 0.0381,
  baseline_crash_cost_eur_vkm: 0.045,
};

export const VTPI_BASE_VTT = {
  business_freight: 32.50,
  commute_car: 12.50,
  transit_seated: 7.50,
  transit_standing_crowded: 22.0,
  active_walk_pleasant: 5.00,
  active_walk_hostile: 24.00,
};

// 1. GEH Statistic Validation Gate (CERTH / EIT Module 2)
export function computeGEH(simFlow, obsFlow) {
  const denom = simFlow + obsFlow;
  if (denom <= 1e-4) return { geh: 0.0, isCalibrated: true, status: 'EXCELLENT' };
  const geh = Math.sqrt((2.0 * Math.pow(simFlow - obsFlow, 2)) / denom);
  return {
    geh: Number(geh.toFixed(3)),
    isCalibrated: geh < 5.0,
    recalibrationRequired: geh >= 10.0,
    status: geh < 5.0 ? 'EXCELLENT' : (geh < 10.0 ? 'WARNING' : 'RECALIB_REQUIRED')
  };
}

// 2. LWR Kinematic Shockwave Speed (Estrada Module 1)
export function computeShockwaveSpeed(qUp, kUp, qBottleneck, kBottleneck) {
  const dk = kBottleneck - kUp;
  if (Math.abs(dk) < 1e-4) return 0.0;
  return (qBottleneck - qUp) / dk; // km/h
}

export function computeSpillbackTimeMin(wKmh, linkLenM) {
  if (wKmh >= -0.01) return Infinity;
  const wMs = Math.abs(wKmh) * (1000.0 / 3600.0);
  return Number((linkLenM / wMs / 60.0).toFixed(2));
}

// 3. COPERT 5.9 Hot Factor
export function copert59HotFactor(speedKmh, p) {
  const v = Math.max(5.0, Math.min(130.0, speedKmh));
  const num = p.alpha * v * v + p.beta * v + p.gamma + (p.delta / v);
  const den = p.epsilon * v * v + p.zeta * v + p.eta;
  if (Math.abs(den) < 1e-6) return 0.0;
  return Math.max(0.0, (num / den) * (1.0 - p.rf));
}

// 4. Socio-Technical Cost Function Z_Total = Z_T + Z_E + Z_U
export function evaluateSocioTechnicalCost({
  distanceKm,
  speedKmh,
  travelTimeH,
  travelTimeStdH = 0.05,
  category = 'LCV_DIESEL_EURO6',
  isLoaded = true,
  purpose = 'business_freight',
  losGrade = 'C',
  isNight = false,
  isHighway = false
}) {
  const preset = COPERT_PRESETS[category] || COPERT_PRESETS.LCV_DIESEL_EURO6;

  // Z_T (Operational MITMA)
  const cT = isLoaded ? 36.89 : 27.43;
  const cV = isLoaded ? 1.3281 : 0.3407;
  const zT = cT * travelTimeH + cV * distanceKm;

  // Z_E (Environmental CE Delft)
  let zE = 0;
  let noxG = 0, pm25G = 0, co2eqG = 0;

  if (category === 'BEV_VAN') {
    const wtt = CE_DELFT_EXTERNAL_PRICES.WTT_bev_eur_per_vkm * distanceKm;
    const noise = 0.008 * distanceKm * (isNight ? 1.5 : 1.0);
    const crash = CE_DELFT_EXTERNAL_PRICES.baseline_crash_cost_eur_vkm * distanceKm;
    zE = wtt + noise + crash;
  } else {
    const noxRate = copert59HotFactor(speedKmh, preset.NOx);
    const pm25Rate = copert59HotFactor(speedKmh, preset.PM25);
    const fcRate = copert59HotFactor(speedKmh, preset.FC_g_km);

    noxG = noxRate * distanceKm;
    pm25G = pm25Rate * distanceKm;
    const co2Rate = fcRate * 3.15 + 0.60;
    co2eqG = co2Rate * distanceKm;

    const airPollution = (noxG / 1000.0) * CE_DELFT_EXTERNAL_PRICES.NOx_city_eur_per_kg +
                         (pm25G / 1000.0) * CE_DELFT_EXTERNAL_PRICES.PM25_metro_eur_per_kg;
    const climate = (co2eqG / 1000000.0) * CE_DELFT_EXTERNAL_PRICES.CO2_short_run_eur_per_ton;
    const noiseFactor = category.includes('HGV') ? 16.6 : (category.includes('BUS') ? 12.0 : 2.5);
    const noise = (0.015 * noiseFactor * (isNight ? 2.0 : 1.0)) * distanceKm;
    const crash = CE_DELFT_EXTERNAL_PRICES.baseline_crash_cost_eur_vkm * (isHighway ? 0.75 : 1.0) * distanceKm;

    zE = airPollution + climate + noise + crash;
  }

  // Z_U (User & Perceived Time VTPI)
  const baseVTT = VTPI_BASE_VTT[purpose] || 32.50;
  const losMults = { A: 0.8, B: 0.9, C: 1.0, D: 1.2, E: 1.5, F: 1.85 };
  const psiLOS = losMults[losGrade.toUpperCase()] || 1.0;
  const effectiveTimeH = travelTimeH + (1.645 * travelTimeStdH);
  const zU = baseVTT * psiLOS * effectiveTimeH;

  const zTotal = zT + zE + zU;

  return {
    zTotalEur: Number(zTotal.toFixed(3)),
    zTOperationalEur: Number(zT.toFixed(3)),
    zEEnvironmentalEur: Number(zE.toFixed(3)),
    zUPerceivedUserEur: Number(zU.toFixed(3)),
    sharesPct: {
      operational: Number(((zT / zTotal) * 100).toFixed(1)),
      environmental: Number(((zE / zTotal) * 100).toFixed(1)),
      user: Number(((zU / zTotal) * 100).toFixed(1)),
    },
    emissions: {
      noxG: Number(noxG.toFixed(2)),
      pm25G: Number(pm25G.toFixed(3)),
      co2eqG: Number(co2eqG.toFixed(1)),
    }
  };
}
