/**
 * UNIFIED SOCIO-TECHNICAL COST ENGINE (Z_Total = Z_T + Z_E + Z_U)
 * frontend/utils/unifiedCostEngine.ts
 *
 * Implements:
 * 1. Z_T (Operational Cost - MITMA / EU Fleet Framework):
 *    - Fuel consumption as a function of average speed: FC(v) = alpha0 + alpha1/v + alpha2*v^2
 *    - Commercial driver labor cost & vehicle capital depreciation
 * 2. Z_E (Environmental Externalities - COPERT 5.9 Tier 3 & CE Delft Handbook):
 *    - Hot exhaust emissions: CO2, NOx, PM2.5 (g/km)
 *    - CE Delft Damage Valuations: CO2 at €100/tonne, Air pollution, and Urban noise
 * 3. Z_U (User Perceived Travel Time Cost - VTPI Framework):
 *    - Value of Travel Time (VOT) segmented by trip purpose (commute vs personal)
 *    - Nonlinear Congestion Disutility Multiplier: alpha_cong = 1.0 + 1.2 * (t_cong / t_ff - 1)^1.5
 */

export interface CostBreakdown {
  zOperationalTL: number;       // Z_T
  zEnvironmentalTL: number;     // Z_E
  zUserPerceivedTL: number;     // Z_U
  zTotalTL: number;             // Z_Total = Z_T + Z_E + Z_U
  
  // Detailed Telemetry
  co2Grams: number;
  noxGrams: number;
  pm25Grams: number;
  fuelLiters: number;
  congestionMultiplier: number;
  currency: 'TRY' | 'EUR';
}

export interface CorridorInput {
  distanceKm: number;
  travelTimeMinutes: number;
  freeFlowMinutes: number;
  mode: 'private_car' | 'gtfs_transit' | 'vrp_freight';
  vehicleCount?: number;
}

export class UnifiedCostEngine {
  // Socioeconomic unit prices (2026 Istanbul baseline)
  private fuelPricePerLiterTL = 43.50; // Diesel / Gasoline average
  private driverHourlyWageTL = 220.0;  // Commercial/VRP driver
  private votCommuteTLPerHour = 180.0; // Value of Time for business/commute
  private votLeisureTLPerHour = 95.0;  // Value of Time for personal travel
  private eurToTryRate = 41.50;        // EUR/TRY parity

  // CE Delft Handbook external damage costs (EUR per kg / tonne)
  private co2CostEurPerTonne = 105.0;  // €105 / tonne CO2
  private noxCostEurPerKg = 16.20;     // €16.20 / kg NOx in metropolitan area
  private pm25CostEurPerKg = 48.50;    // €48.50 / kg PM2.5 in dense urban center
  private noiseCostEurPerVkm = 0.015;  // €0.015 / veh-km urban road noise

  /**
   * Computes COPERT 5.9 Tier 3 Emission Factors (g/km) as a function of speed (km/h)
   */
  public computeCopertEmissions(speedKmh: number, mode: 'private_car' | 'gtfs_transit' | 'vrp_freight'): {
    co2GPerKm: number;
    noxGPerKm: number;
    pm25GPerKm: number;
    fuelLitersPer100Km: number;
  } {
    const v = Math.max(8.0, Math.min(120.0, speedKmh));

    if (mode === 'vrp_freight') {
      // Light Commercial Vehicle (LCV / N1 Diesel Euro 6)
      const co2 = 125.0 + 380.0 / v + 0.018 * Math.pow(v, 2);
      const nox = 0.42 + 2.1 / v;
      const pm25 = 0.015 + 0.08 / v;
      const fuelLiters = (co2 / 2640.0) * 100.0; // 2640g CO2 per liter diesel
      return {
        co2GPerKm: Number(co2.toFixed(1)),
        noxGPerKm: Number(nox.toFixed(3)),
        pm25GPerKm: Number(pm25.toFixed(4)),
        fuelLitersPer100Km: Number(fuelLiters.toFixed(2))
      };
    } else if (mode === 'gtfs_transit') {
      // Urban Transit Bus / BRT per vehicle (or prorated per passenger capacity)
      const co2 = 520.0 + 1200.0 / v + 0.055 * Math.pow(v, 2);
      const nox = 1.85 + 5.5 / v;
      const pm25 = 0.045 + 0.22 / v;
      const fuelLiters = (co2 / 2640.0) * 100.0;
      return {
        co2GPerKm: Number(co2.toFixed(1)),
        noxGPerKm: Number(nox.toFixed(3)),
        pm25GPerKm: Number(pm25.toFixed(4)),
        fuelLitersPer100Km: Number(fuelLiters.toFixed(2))
      };
    } else {
      // Passenger Car (M1 Euro 6 Petrol/Diesel mix)
      const co2 = 98.0 + 260.0 / v + 0.012 * Math.pow(v, 2);
      const nox = 0.18 + 0.95 / v;
      const pm25 = 0.008 + 0.04 / v;
      const fuelLiters = (co2 / 2390.0) * 100.0;
      return {
        co2GPerKm: Number(co2.toFixed(1)),
        noxGPerKm: Number(nox.toFixed(3)),
        pm25GPerKm: Number(pm25.toFixed(4)),
        fuelLitersPer100Km: Number(fuelLiters.toFixed(2))
      };
    }
  }

  /**
   * Computes Z_Total = Z_T + Z_E + Z_U
   */
  public evaluateCorridorCost(input: CorridorInput): CostBreakdown {
    const { distanceKm, travelTimeMinutes, freeFlowMinutes, mode } = input;
    const vehCount = input.vehicleCount || 1;
    const speedKmh = distanceKm / Math.max(0.01, travelTimeMinutes / 60.0);

    // 1. Operational Cost (Z_T)
    const emissions = this.computeCopertEmissions(speedKmh, mode);
    const fuelLiters = (emissions.fuelLitersPer100Km / 100.0) * distanceKm * vehCount;
    const fuelCostTL = fuelLiters * this.fuelPricePerLiterTL;

    // Vehicle wear & tires (~1.45 TL/km)
    const wearCostTL = distanceKm * 1.45 * vehCount;

    // Labor cost (applicable for commercial VRP and public transit)
    const hours = travelTimeMinutes / 60.0;
    const laborCostTL = mode === 'vrp_freight' || mode === 'gtfs_transit'
      ? hours * this.driverHourlyWageTL * vehCount
      : 0.0;

    const zOperationalTL = fuelCostTL + wearCostTL + laborCostTL;

    // 2. Environmental Externalities (Z_E - CE Delft)
    const totalCo2G = emissions.co2GPerKm * distanceKm * vehCount;
    const totalNoxG = emissions.noxGPerKm * distanceKm * vehCount;
    const totalPm25G = emissions.pm25GPerKm * distanceKm * vehCount;

    const co2DamageEur = (totalCo2G / 1e6) * this.co2CostEurPerTonne;
    const noxDamageEur = (totalNoxG / 1e3) * this.noxCostEurPerKg;
    const pm25DamageEur = (totalPm25G / 1e3) * this.pm25CostEurPerKg;
    const noiseDamageEur = distanceKm * this.noiseCostEurPerVkm * vehCount;

    const totalDamageEur = co2DamageEur + noxDamageEur + pm25DamageEur + noiseDamageEur;
    const zEnvironmentalTL = totalDamageEur * this.eurToTryRate;

    // 3. User Perceived Travel Time Cost (Z_U - VTPI)
    // Non-linear congestion penalty factor
    const delayRatio = Math.max(1.0, travelTimeMinutes / Math.max(0.1, freeFlowMinutes));
    const congestionMultiplier = 1.0 + 1.2 * Math.pow(delayRatio - 1.0, 1.5);

    const baseVotTLPerHour = mode === 'vrp_freight' ? 240.0 : this.votCommuteTLPerHour;
    const zUserPerceivedTL = hours * baseVotTLPerHour * congestionMultiplier * vehCount;

    const zTotalTL = zOperationalTL + zEnvironmentalTL + zUserPerceivedTL;

    return {
      zOperationalTL: Number(zOperationalTL.toFixed(2)),
      zEnvironmentalTL: Number(zEnvironmentalTL.toFixed(2)),
      zUserPerceivedTL: Number(zUserPerceivedTL.toFixed(2)),
      zTotalTL: Number(zTotalTL.toFixed(2)),
      co2Grams: Math.round(totalCo2G),
      noxGrams: Number(totalNoxG.toFixed(1)),
      pm25Grams: Number(totalPm25G.toFixed(2)),
      fuelLiters: Number(fuelLiters.toFixed(2)),
      congestionMultiplier: Number(congestionMultiplier.toFixed(2)),
      currency: 'TRY'
    };
  }
}

export const unifiedCostEngine = new UnifiedCostEngine();
