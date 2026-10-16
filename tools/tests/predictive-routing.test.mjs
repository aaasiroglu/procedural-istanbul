import test from 'node:test';
import assert from 'node:assert/strict';
import { PredictiveTrafficEngine } from '../../src/world/predictiveTrafficEngine.js';
import { UnifiedCostEngine } from '../../src/world/unifiedCostEngine.js';
import { TrafficRouter, ROUTE_HUBS } from '../../src/world/router.js';

test('PredictiveTrafficEngine: Diurnal baseline and scenario elasticity modifiers', () => {
  const engine = new PredictiveTrafficEngine();

  // 1. 24-hour profile baseline
  const baselineProfile = engine.compute24hProfile({ calendar: 'weekday', ramazan: 'none', weather: 'clear' });
  assert.equal(baselineProfile.length, 24, '24 hours must be generated');

  // Verify morning and evening rush peaks
  const morningRush = baselineProfile[8]; // 08:00
  const deepNight = baselineProfile[3];  // 03:00
  assert.ok(morningRush.baselineDemand > deepNight.baselineDemand * 5, 'Morning rush demand must exceed night calm by >5x');

  // 2. Ramazan Iftar Shift
  const ramazanFactors17 = engine.computeHourFactors(17, { ramazan: 'ramazan_month' });
  assert.ok(ramazanFactors17.ramazanMod > 1.3, 'Hour 17 (Iftar rush) must have >30% bump');

  const ramazanFactors19 = engine.computeHourFactors(19, { ramazan: 'ramazan_month' });
  assert.ok(ramazanFactors19.ramazanMod < 0.3, 'Hour 19 (Iftar moment) must have massive drop <0.3');

  // 3. Weather Friction Factors
  const snowFactors = engine.computeHourFactors(17, { weather: 'heavy_snow' });
  assert.equal(snowFactors.weatherSpeedMod, 0.55, 'Heavy snow speed modifier must be 0.55 (-45%)');
  assert.equal(snowFactors.weatherTransitShift, 0.28, 'Heavy snow must trigger +28% transit shift');

  // 4. Fuel Price Demand Elasticity (eps = -0.18)
  const highFuelFactors = engine.computeHourFactors(17, { fuelPrice: 65.0 });
  assert.ok(highFuelFactors.fuelDemandFactor < 1.0, 'Fuel price hike to 65 TL must depress demand');
});

test('UnifiedCostEngine: COPERT 5.9 Tier 3 and Societal Externalities (Z_Total)', () => {
  const costEngine = new UnifiedCostEngine();

  // Test passenger car emissions at 45 km/h
  const copertCar = costEngine.computeCopertEmissions(45.0, 'passenger_car');
  assert.ok(copertCar.co2GPerKm > 80 && copertCar.co2GPerKm < 200, 'CO2 emission should be in realistic range');
  assert.ok(copertCar.fuelLitersPer100Km > 4.0 && copertCar.fuelLitersPer100Km < 12.0, 'Fuel consumption realistic');

  // Test Freight emissions
  const copertTruck = costEngine.computeCopertEmissions(30.0, 'vrp_freight');
  assert.ok(copertTruck.co2GPerKm > copertCar.co2GPerKm, 'Freight truck CO2 must exceed passenger car');

  // Full Societal Cost
  const cost = costEngine.evaluateCorridorCost({
    distanceKm: 8.5,
    travelTimeMinutes: 24.0,
    freeFlowMinutes: 12.0,
    mode: 'passenger_car'
  });

  assert.ok(cost.zOperationalTL > 0, 'Z_T Operational cost must be positive');
  assert.ok(cost.zEnvironmentalTL > 0, 'Z_E Environmental cost must be positive');
  assert.ok(cost.zUserPerceivedTL > 0, 'Z_U User time cost must be positive');
  assert.ok(cost.zTotalTL === Number((cost.zOperationalTL + cost.zEnvironmentalTL + cost.zUserPerceivedTL).toFixed(2)), 'Z_Total must equal sum of Z_T + Z_E + Z_U');
  assert.ok(cost.congestionMultiplier > 1.0, 'Congestion multiplier must be >1 when delayed');
});

test('TrafficRouter: A* routing, future forecasting, and robustness on mock graph', () => {
  // Construct a robust mock directed road graph
  const nodes = [
    [0, 10, 0],      // Node 0: Origin
    [200, 12, 100],  // Node 1: Intermediate
    [400, 15, 250],  // Node 2: Destination
    [500, 15, 500],  // Node 3: Outlier
  ];

  const lanes = [
    {
      from: 0,
      to: 1,
      length: 220,
      speed: 12.0,
      pts: [{ x: 0, y: 10, z: 0 }, { x: 200, y: 12, z: 100 }],
      edge: { maxspeed: 50, name: 'Büyükdere Caddesi' }
    },
    {
      from: 1,
      to: 2,
      length: 260,
      speed: 10.0,
      pts: [{ x: 200, y: 12, z: 100 }, { x: 400, y: 15, z: 250 }],
      edge: { maxspeed: 50, name: 'Zincirlikuyu Bağlantısı' }
    }
  ];

  const out = [[lanes[0]], [lanes[1]], [], []];
  const into = [[], [lanes[0]], [lanes[1]], []];

  const mockTraffic = {
    graph: { nodes, lanes, out, into },
    liveSpeedFactor: 1.0,
    scenarioSpeedFactor: 1.0
  };

  const mockStreamer = {
    surface: (x, z) => 12.0,
    ground: (x, z) => 12.0
  };

  const router = new TrafficRouter({
    traffic: mockTraffic,
    streamer: mockStreamer,
    proj: { project: (lon, lat) => [lon * 10, lat * 10], unproject: (x, z) => [x / 10, z / 10] },
    scene: null
  });

  const pointA = { x: 0, z: 0, name: 'Nokta A' };
  const pointB = { x: 400, z: 250, name: 'Nokta B' };

  // Calculate route under normal weather
  const normalRoute = router.findRoute(pointA, pointB, {
    hour: 17,
    scenario: { weather: 'clear', ramazan: 'none' }
  });

  assert.ok(normalRoute, 'Route must be computed');
  assert.equal(normalRoute.pathLanesCount, 2, 'Path must use both lanes 0->1 and 1->2');
  assert.ok(normalRoute.distanceKm > 0.4, 'Distance must be >0.4 km');
  assert.ok(normalRoute.liveMinutes > 0, 'Live duration must be positive');

  // Calculate route under Heavy Snow & Ramazan Iftar Rush
  const crisisRoute = router.findRoute(pointA, pointB, {
    hour: 17,
    scenario: { weather: 'heavy_snow', ramazan: 'ramazan_month' }
  });

  assert.ok(crisisRoute.predictedMinutes > normalRoute.predictedMinutes, 'Crisis predicted travel time must strictly exceed normal time');
  assert.ok(crisisRoute.costs.predicted.zTotalTL > normalRoute.costs.predicted.zTotalTL, 'Societal cost under crisis must exceed normal cost');
  assert.ok(crisisRoute.coordinates3D.length >= 3, '3D coordinates must be generated');
});

test('UrbanMorphologyEngine: momepy topology, libpysal spatial weights, and road2citygml3 spaces', async () => {
  const { UrbanMorphologyEngine } = await import('../../src/world/urbanMorphologyEngine.js');

  const nodes = [
    [0, 10, 0],
    [100, 10, 50],
    [200, 10, 100],
    [300, 10, 150]
  ];

  const lanes = [
    {
      from: 0,
      to: 1,
      length: 115,
      speed: 13.8,
      pts: [{ x: 0, y: 10, z: 0 }, { x: 50, y: 10, z: 20 }, { x: 100, y: 10, z: 50 }],
      edge: { maxspeed: 50, highway: 'primary', lanes: 2, sidewalk: 'both' }
    },
    {
      from: 1,
      to: 2,
      length: 120,
      speed: 13.8,
      pts: [{ x: 100, y: 10, z: 50 }, { x: 200, y: 10, z: 100 }],
      edge: { maxspeed: 50, highway: 'primary', lanes: 2 }
    },
    {
      from: 1,
      to: 3,
      length: 220,
      speed: 11.0,
      pts: [{ x: 100, y: 10, z: 50 }, { x: 300, y: 10, z: 150 }],
      edge: { maxspeed: 40, highway: 'secondary', lanes: 1 }
    }
  ];

  const mockTraffic = {
    graph: {
      nodes,
      lanes,
      out: [[lanes[0]], [lanes[1], lanes[2]], [], []],
      into: [[], [lanes[0]], [lanes[1]], [lanes[2]]]
    }
  };

  const mockHexCells = [
    { id: 'hex_0', x: 0, z: 0, lat: 41.06, lon: 29.00 },
    { id: 'hex_1', x: 400, z: 200, lat: 41.062, lon: 29.005 },
    { id: 'hex_2', x: 800, z: 400, lat: 41.065, lon: 29.010 }
  ];

  const morphoEngine = new UrbanMorphologyEngine({
    traffic: mockTraffic,
    streamer: null,
    proj: null,
    hexCells: mockHexCells
  });

  // 1. momepy & NetworkX Topology
  const topo = morphoEngine.analyzeNetworkTopology();
  assert.equal(topo.nodeCount, 4);
  assert.equal(topo.laneCount, 3);
  assert.ok(topo.avgSinuosity >= 1.0, 'Sinuosity must be >= 1.0');
  assert.equal(topo.intersectionsCount, 1, 'Node 1 has degree 3 (1 in + 2 out), forming an intersection');

  // 2. libpysal Spatial Weights (W)
  const weights = morphoEngine.computeSpatialWeightsMatrix();
  assert.equal(weights.N, 3);
  // Verify row-standardization (sum of each row equals ~1.0)
  for (let i = 0; i < weights.N; i++) {
    let rowSum = 0;
    for (let j = 0; j < weights.N; j++) rowSum += weights.W[i][j];
    assert.ok(Math.abs(rowSum - 1.0) < 0.01, `Row ${i} must sum to 1.0`);
  }

  // 3. Moran's I
  const moran = morphoEngine.computeMoransI([85.0, 78.0, 20.0]);
  assert.ok(moran != null);
  assert.ok(Number.isFinite(moran.globalMoranI), 'Global Moran I must be finite');
  assert.equal(moran.lisaClusters.length, 3);

  // 4. road2citygml3 CityGML 3.0 Transportation Module
  const cityGml = morphoEngine.classifyCityGml30Spaces();
  assert.equal(cityGml.trafficSpacesCount, 3, 'Must identify 3 granular TrafficSpace lanes');
  assert.ok(cityGml.auxiliaryTrafficSpacesCount >= 1, 'Must extract AuxiliaryTrafficSpace for sidewalk');
  assert.equal(cityGml.dualRepresentationCompliant, true);
});

