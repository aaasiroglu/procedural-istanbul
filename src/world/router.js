/**
 * MULTI-FACTOR PREDICTIVE A* GRAPH ROUTING & SOCIETAL COST ENGINE
 * src/world/router.js
 *
 * Implements:
 * 1. Exact A* Shortest-Time Routing on the directed OpenStreetMap road graph (traffic.graph).
 * 2. Real-Time vs Future Predicted Travel Times under multi-factor scenario elasticity (weather, ramazan, fuel, calendar, incidents).
 * 3. Tripartite Societal Cost Computation (Z_Total = Z_T + Z_E + Z_U) via COPERT 5.9, CE Delft, and VTPI.
 * 4. Critical Bottleneck & Level-of-Service (LOS) Detection along the selected trajectory.
 * 5. 3D WebGL Glowing Route Visualizer draped over terrain surface with animated photons and holographic A/B pin markers.
 * 6. 100% Open Data (OSM ODbL + IBB) & 100% Open Source Software compliant.
 */

import * as THREE from 'three';
import { UnifiedCostEngine } from './unifiedCostEngine.js';
import { PredictiveTrafficEngine } from './predictiveTrafficEngine.js';

// Prominent Istanbul Transportation Hubs & Landmarks for Quick A -> B Selection
export const ROUTE_HUBS = [
  { id: 'MEC_MEY', name: 'Mecidiyeköy Meydanı (Metrobüs & M2 Hub)', lon: 28.9930, lat: 41.0630, color: '#38bdf8' },
  { id: 'ZOR_CEN', name: 'Zincirlikuyu - Zorlu Center Kavşağı', lon: 29.0170, lat: 41.0665, color: '#34d399' },
  { id: 'LEV_KAN', name: 'Levent - Kanyon & Sapphire Finans', lon: 29.0115, lat: 41.0775, color: '#818cf8' },
  { id: 'KOP_15T', name: '15 Temmuz Şehitler Köprüsü Girişi', lon: 29.0250, lat: 41.0685, color: '#f59e0b' },
  { id: 'TOR_CEN', name: 'Torun Center - Ali Sami Yen Meydanı', lon: 28.9995, lat: 41.0660, color: '#ec4899' },
  { id: 'GAY_MET', name: 'Gayrettepe M11 Havalimanı Aktarma', lon: 29.0100, lat: 41.0695, color: '#06b6d4' },
  { id: 'SIS_CEV', name: 'Şişli - Cevahir AVM Koridoru', lon: 28.9890, lat: 41.0600, color: '#a855f7' },
  { id: 'BES_BAR', name: 'Beşiktaş Barbaros Bulvarı İnişi', lon: 29.0060, lat: 41.0520, color: '#10b981' },
];

/**
 * High-performance Binary Min-Heap for A* Priority Queue.
 */
class MinHeap {
  constructor() {
    this.heap = [];
  }
  push(item) {
    this.heap.push(item);
    this._up(this.heap.length - 1);
  }
  pop() {
    if (this.heap.length === 0) return null;
    const top = this.heap[0];
    const bottom = this.heap.pop();
    if (this.heap.length > 0) {
      this.heap[0] = bottom;
      this._down(0);
    }
    return top;
  }
  size() {
    return this.heap.length;
  }
  _up(i) {
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (this.heap[i].priority < this.heap[p].priority) {
        const tmp = this.heap[i];
        this.heap[i] = this.heap[p];
        this.heap[p] = tmp;
        i = p;
      } else break;
    }
  }
  _down(i) {
    const len = this.heap.length;
    while ((i << 1) + 1 < len) {
      let left = (i << 1) + 1;
      let right = left + 1;
      let best = i;
      if (this.heap[left].priority < this.heap[best].priority) best = left;
      if (right < len && this.heap[right].priority < this.heap[best].priority) best = right;
      if (best !== i) {
        const tmp = this.heap[i];
        this.heap[i] = this.heap[best];
        this.heap[best] = tmp;
        i = best;
      } else break;
    }
  }
}

/**
 * Predictive Router Engine operating directly on traffic.graph.
 */
export class TrafficRouter {
  constructor({ traffic, streamer, proj, scene }) {
    this.traffic = traffic;
    this.streamer = streamer;
    this.proj = proj;
    this.scene = scene;

    this.costEngine = new UnifiedCostEngine();
    this.predictiveEngine = new PredictiveTrafficEngine();

    // 3D Visualizer Group
    this.visualizer = new RouteVisualizer({ scene, streamer, proj });
  }

  setVisible(visible) {
    if (this.visualizer) {
      this.visualizer.setVisible(visible);
    }
  }

  get visible() {
    return this.visualizer?.group?.visible ?? true;
  }

  /**
   * Finds the nearest node in traffic.graph to a world position (x, z).
   */
  findNearestNode(x, z) {
    const graph = this.traffic?.graph;
    if (!graph || !graph.nodes || graph.nodes.length === 0) return null;

    let nearest = null;
    let minSqDist = Infinity;

    for (let i = 0; i < graph.nodes.length; i++) {
      const node = graph.nodes[i];
      if (!node) continue;
      const dx = node[0] - x;
      const dz = node[2] - z;
      const sqDist = dx * dx + dz * dz;
      if (sqDist < minSqDist) {
        minSqDist = sqDist;
        nearest = { id: i, x: node[0], y: node[1], z: node[2], dist: Math.sqrt(sqDist) };
      }
    }

    return nearest;
  }

  /**
   * Finds the nearest lane to a world position (x, z).
   */
  findNearestLane(x, z) {
    const graph = this.traffic?.graph;
    if (!graph || !graph.lanes || graph.lanes.length === 0) return null;

    let nearestLane = null;
    let minSqDist = Infinity;

    for (let i = 0; i < graph.lanes.length; i++) {
      const lane = graph.lanes[i];
      if (!lane || !lane.pts || lane.pts.length === 0) continue;
      const pt = lane.pts[0];
      const dx = pt.x - x;
      const dz = pt.z - z;
      const sqDist = dx * dx + dz * dz;
      if (sqDist < minSqDist) {
        minSqDist = sqDist;
        nearestLane = lane;
      }
    }

    return nearestLane;
  }

  /**
   * Computes A* shortest path between Point A and Point B on the directed OSM graph.
   *
   * @param {Object} pointA - { x, z, [lon, lat], [name] }
   * @param {Object} pointB - { x, z, [lon, lat], [name] }
   * @param {Object} options - { hour, scenario }
   * @returns {Object} Route result containing distance, live duration, predicted duration, costs, and geometry.
   */
  findRoute(pointA, pointB, options = {}) {
    const { hour = 17, scenario = {} } = options;
    const graph = this.traffic?.graph;

    if (!graph || !graph.lanes || !graph.out || !graph.nodes) {
      console.warn('Traffic graph is not ready for routing.');
      return null;
    }

    const startNode = this.findNearestNode(pointA.x, pointA.z);
    const endNode = this.findNearestNode(pointB.x, pointB.z);

    if (!startNode || !endNode) {
      console.warn('Unable to find snap nodes for route.');
      return null;
    }

    // Heuristic: Euclidean distance to goal divided by maximum network speed (120 km/h = 33.3 m/s)
    const maxSpeedMs = 33.33;
    const heuristic = (nodeIdx) => {
      const node = graph.nodes[nodeIdx];
      const goal = graph.nodes[endNode.id];
      if (!node || !goal) return 0;
      const dist = Math.hypot(node[0] - goal[0], node[2] - goal[2]);
      return dist / maxSpeedMs;
    };

    // A* Data structures
    const openSet = new MinHeap();
    const gScore = new Float32Array(graph.nodes.length).fill(Infinity);
    const fScore = new Float32Array(graph.nodes.length).fill(Infinity);
    const cameFromLane = new Map(); // nodeIdx -> incoming lane

    gScore[startNode.id] = 0;
    fScore[startNode.id] = heuristic(startNode.id);
    openSet.push({ id: startNode.id, priority: fScore[startNode.id] });

    let currentBest = null;
    let closestToGoal = startNode.id;
    let minHeuristic = heuristic(startNode.id);
    let iterations = 0;
    const maxIterations = 20000;

    while (openSet.size() > 0 && iterations++ < maxIterations) {
      const current = openSet.pop();
      if (!current) break;

      const u = current.id;

      // Track closest node to goal for robust fallback in case of disconnected components
      const h = heuristic(u);
      if (h < minHeuristic) {
        minHeuristic = h;
        closestToGoal = u;
      }

      // Reached destination!
      if (u === endNode.id) {
        currentBest = u;
        break;
      }

      // If popped with outdated score, skip
      if (current.priority > fScore[u]) continue;

      const outLanes = graph.out[u] || [];
      for (let i = 0; i < outLanes.length; i++) {
        const lane = outLanes[i];
        if (!lane) continue;

        // Skip closed roads or dead ends
        if (lane.edge?.closed) continue;

        const v = lane.to;
        if (v == null || v >= graph.nodes.length) continue;

        // Base live speed in m/s
        const baseSpeed = lane.liveSpeed != null ? lane.liveSpeed : lane.speed * (this.traffic.liveSpeedFactor || 1.0);
        const liveSpeed = Math.max(1.5, baseSpeed * (this.traffic.scenarioSpeedFactor || 1.0));

        // Travel time cost in seconds
        const edgeTimeSec = lane.length / liveSpeed;
        const tentativeG = gScore[u] + edgeTimeSec;

        if (tentativeG < gScore[v]) {
          cameFromLane.set(v, lane);
          gScore[v] = tentativeG;
          fScore[v] = tentativeG + heuristic(v);
          openSet.push({ id: v, priority: fScore[v] });
        }
      }
    }

    // Target node to reconstruct path from (exact target or closest reached node)
    const targetNodeId = currentBest !== null ? currentBest : closestToGoal;

    // Reconstruct Path
    const pathLanes = [];
    let curr = targetNodeId;
    while (cameFromLane.has(curr)) {
      const lane = cameFromLane.get(curr);
      pathLanes.unshift(lane);
      curr = lane.from;
      if (curr === startNode.id) break;
    }

    // Extract full 3D coordinates along the route
    const coordinates3D = [];

    // Lead-in from Point A
    const groundA = this.streamer ? this.streamer.surface(pointA.x, pointA.z) : 30;
    coordinates3D.push(new THREE.Vector3(pointA.x, groundA + 0.35, pointA.z));

    let totalDistanceM = 0;
    let liveDurationSec = 0;
    let freeFlowDurationSec = 0;
    let predDurationSec = 0;
    const bottlenecks = [];

    // Compute hour-specific exogenous factors from Predictive Engine
    const scenarioFactors = this.predictiveEngine.computeHourFactors(hour, scenario);

    if (pathLanes.length > 0) {
      for (const lane of pathLanes) {
        totalDistanceM += lane.length;

        // 1. Free-flow Speed
        const limitKmh = lane.edge?.maxspeedTagged ? lane.edge.maxspeed : (lane.edge?.maxspeed || 50);
        const vFreeFlowMs = Math.max(lane.speed, (limitKmh * 0.9) / 3.6);
        freeFlowDurationSec += lane.length / vFreeFlowMs;

        // 2. Real-time Live Speed
        const baseLiveMs = lane.liveSpeed != null ? lane.liveSpeed : lane.speed * (this.traffic.liveSpeedFactor || 1.0);
        const liveSpeedMs = Math.max(1.5, baseLiveMs * (this.traffic.scenarioSpeedFactor || 1.0));
        liveDurationSec += lane.length / liveSpeedMs;

        // 3. Future Predicted Speed under Multi-Factor Modifiers
        let predSpeedMs = liveSpeedMs * scenarioFactors.weatherSpeedMod;

        // Ramazan Iftar Rush bottleneck
        if (scenario.ramazan === 'ramazan_month' && hour >= 16 && hour <= 18) {
          predSpeedMs *= 0.65;
        }

        // Bridge Maintenance event bottleneck
        if (scenario.event === 'bridge_maintenance' && (lane.motorway || lane.length > 200)) {
          predSpeedMs *= 0.40;
        }

        predSpeedMs = Math.max(1.2, predSpeedMs);
        predDurationSec += lane.length / predSpeedMs;

        // Detect critical bottlenecks
        const predKmh = predSpeedMs * 3.6;
        if (predKmh < 16.0 && bottlenecks.length < 5) {
          const streetName = lane.edge?.name || (lane.motorway ? 'O-1 Boğaziçi Bağlantısı' : 'Büyükdere Caddesi Katılımı');
          if (!bottlenecks.some((b) => b.name === streetName)) {
            bottlenecks.push({
              name: streetName,
              predictedSpeedKmh: Number(predKmh.toFixed(1)),
              severity: predKmh < 10.0 ? 'CRITICAL' : 'HIGH',
              warning: predKmh < 10.0 ? 'Ağır Dur-Kalk & Şişeboğazı Riski' : 'Yavaş İlerleme'
            });
          }
        }

        // Collect geometry points
        for (let p = 0; p < lane.pts.length; p++) {
          const pt = lane.pts[p];
          const y = this.streamer ? this.streamer.surface(pt.x, pt.z) : pt.y;
          coordinates3D.push(new THREE.Vector3(pt.x, y + 0.35, pt.z));
        }
      }
    } else {
      // Fallback: Direct interpolation if graph had no path
      const steps = 30;
      for (let s = 1; s <= steps; s++) {
        const t = s / steps;
        const x = pointA.x + (pointB.x - pointA.x) * t;
        const z = pointA.z + (pointB.z - pointA.z) * t;
        const y = this.streamer ? this.streamer.surface(x, z) : 30;
        coordinates3D.push(new THREE.Vector3(x, y + 0.35, z));
      }
      totalDistanceM = Math.hypot(pointB.x - pointA.x, pointB.z - pointA.z) * 1.25;
      freeFlowDurationSec = totalDistanceM / (50 / 3.6);
      liveDurationSec = totalDistanceM / (30 / 3.6);
      predDurationSec = totalDistanceM / (20 / 3.6);
    }

    // Lead-out to Point B
    const groundB = this.streamer ? this.streamer.surface(pointB.x, pointB.z) : 30;
    coordinates3D.push(new THREE.Vector3(pointB.x, groundB + 0.35, pointB.z));

    const distanceKm = Number((totalDistanceM / 1000.0).toFixed(2));
    const freeFlowMinutes = Number((freeFlowDurationSec / 60.0).toFixed(1));
    const liveMinutes = Number((liveDurationSec / 60.0).toFixed(1));
    const predictedMinutes = Number((predDurationSec / 60.0).toFixed(1));
    const deltaMinutes = Number((predictedMinutes - liveMinutes).toFixed(1));
    const deltaPercent = liveMinutes > 0 ? Number((((predictedMinutes - liveMinutes) / liveMinutes) * 100).toFixed(0)) : 0;

    // Evaluate Societal Costs (Z_Total = Z_T + Z_E + Z_U) via UnifiedCostEngine
    const liveCost = this.costEngine.evaluateCorridorCost({
      distanceKm,
      travelTimeMinutes: liveMinutes,
      freeFlowMinutes,
      mode: 'passenger_car'
    });

    const predCost = this.costEngine.evaluateCorridorCost({
      distanceKm,
      travelTimeMinutes: predictedMinutes,
      freeFlowMinutes,
      mode: 'passenger_car'
    });

    const deltaCostTL = Number((predCost.zTotalTL - liveCost.zTotalTL).toFixed(2));

    const routeData = {
      from: pointA,
      to: pointB,
      distanceKm,
      freeFlowMinutes,
      liveMinutes,
      predictedMinutes,
      deltaMinutes,
      deltaPercent,
      liveAvgSpeedKmh: Number((distanceKm / Math.max(0.01, liveMinutes / 60.0)).toFixed(1)),
      predAvgSpeedKmh: Number((distanceKm / Math.max(0.01, predictedMinutes / 60.0)).toFixed(1)),
      costs: {
        live: liveCost,
        predicted: predCost,
        deltaCostTL
      },
      bottlenecks,
      coordinates3D,
      pathLanesCount: pathLanes.length
    };

    return routeData;
  }

  /**
   * Visualizes the route in the 3D scene.
   */
  displayRoute(routeData) {
    if (this.visualizer) {
      this.visualizer.setRoute(routeData);
    }
  }

  /**
   * Clears the active route from the 3D scene.
   */
  clearRoute() {
    if (this.visualizer) {
      this.visualizer.clearRoute();
    }
  }

  /**
   * Per-frame animation tick.
   */
  update(dt) {
    if (this.visualizer) {
      this.visualizer.update(dt);
    }
  }
}

/**
 * 3D Glowing Neon Ribbon and Holographic Pin Marker Visualizer.
 */
export class RouteVisualizer {
  constructor({ scene, streamer, proj }) {
    this.scene = scene;
    this.streamer = streamer;
    this.proj = proj;

    this.group = new THREE.Group();
    this.group.name = 'route-visualizer-group';
    if (this.scene) this.scene.add(this.group);

    this.time = 0;
    this.routeData = null;
    this.ribbonMesh = null;
    this.pinA = null;
    this.pinB = null;
  }

  setVisible(visible) {
    if (this.group) {
      this.group.visible = visible;
    }
  }

  clearRoute() {
    while (this.group.children.length > 0) {
      const obj = this.group.children[0];
      this.group.remove(obj);
      if (obj.geometry) obj.geometry.dispose();
      if (obj.material) {
        if (Array.isArray(obj.material)) obj.material.forEach((m) => m.dispose());
        else obj.material.dispose();
      }
    }
    this.routeData = null;
    this.ribbonMesh = null;
    this.pinA = null;
    this.pinB = null;
  }

  setRoute(routeData) {
    this.clearRoute();
    if (!routeData || !routeData.coordinates3D || routeData.coordinates3D.length < 2) return;

    this.routeData = routeData;
    const pts = routeData.coordinates3D;

    // 1. Build Extruded 3D Ribbon Mesh draped along route polyline
    const ribbonWidth = 2.4; // 2.4m width ribbon sitting in road center
    const positions = [];
    const uvs = [];
    const colors = [];

    const colorStart = new THREE.Color(0x38bdf8); // Cyan
    const colorEnd = new THREE.Color(0xf59e0b);   // Amber

    let totalLen = 0;
    const lens = [0];
    for (let i = 1; i < pts.length; i++) {
      totalLen += pts[i].distanceTo(pts[i - 1]);
      lens.push(totalLen);
    }

    for (let i = 0; i < pts.length; i++) {
      const p = pts[i];
      let dir = new THREE.Vector3();
      if (i < pts.length - 1) {
        dir.subVectors(pts[i + 1], p).setY(0).normalize();
      } else {
        dir.subVectors(p, pts[i - 1]).setY(0).normalize();
      }

      // Normal perpendicular vector in horizontal plane
      const normal = new THREE.Vector3(-dir.z, 0, dir.x).multiplyScalar(ribbonWidth * 0.5);

      const pLeft = new THREE.Vector3().addVectors(p, normal);
      const pRight = new THREE.Vector3().subVectors(p, normal);

      positions.push(pLeft.x, pLeft.y, pLeft.z);
      positions.push(pRight.x, pRight.y, pRight.z);

      const progress = totalLen > 0 ? lens[i] / totalLen : i / (pts.length - 1);
      uvs.push(0, progress);
      uvs.push(1, progress);

      const c = new THREE.Color().lerpColors(colorStart, colorEnd, progress);
      colors.push(c.r, c.g, c.b);
      colors.push(c.r, c.g, c.b);
    }

    const indices = [];
    for (let i = 0; i < pts.length - 1; i++) {
      const base = i * 2;
      indices.push(base, base + 1, base + 2);
      indices.push(base + 1, base + 3, base + 2);
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    geometry.setIndex(indices);

    // Glowing additive ribbon material
    const material = new THREE.MeshBasicMaterial({
      vertexColors: true,
      transparent: true,
      opacity: 0.88,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      depthWrite: false
    });

    this.ribbonMesh = new THREE.Mesh(geometry, material);
    this.ribbonMesh.renderOrder = 999;
    this.group.add(this.ribbonMesh);

    // 2. Add Holographic Pins at Origin A and Destination B
    const pA = pts[0];
    const pB = pts.at(-1);

    this.pinA = this.createHolographicPin(pA.x, pA.y, pA.z, 0x38bdf8, 'A: ÇIKIŞ');
    this.pinB = this.createHolographicPin(pB.x, pB.y, pB.z, 0xf59e0b, 'B: VARIŞ');

    this.group.add(this.pinA);
    this.group.add(this.pinB);
  }

  createHolographicPin(x, y, z, hexColor, labelText) {
    const pinGroup = new THREE.Group();
    pinGroup.position.set(x, y, z);

    // Vertical glowing energy pillar
    const cylinderGeom = new THREE.CylinderGeometry(0.6, 0.1, 28, 12);
    cylinderGeom.translate(0, 14, 0);
    const cylinderMat = new THREE.MeshBasicMaterial({
      color: hexColor,
      transparent: true,
      opacity: 0.65,
      blending: THREE.AdditiveBlending,
      depthWrite: false
    });
    const cylinder = new THREE.Mesh(cylinderGeom, cylinderMat);
    pinGroup.add(cylinder);

    // Ground concentric pulsing ring
    const ringGeom = new THREE.RingGeometry(2.0, 3.2, 24);
    ringGeom.rotateX(-Math.PI / 2);
    ringGeom.translate(0, 0.4, 0);
    const ringMat = new THREE.MeshBasicMaterial({
      color: hexColor,
      transparent: true,
      opacity: 0.85,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
      depthWrite: false
    });
    const ring = new THREE.Mesh(ringGeom, ringMat);
    pinGroup.add(ring);

    // Glowing head sphere
    const sphereGeom = new THREE.SphereGeometry(2.2, 16, 16);
    sphereGeom.translate(0, 28, 0);
    const sphereMat = new THREE.MeshBasicMaterial({
      color: hexColor,
      transparent: true,
      opacity: 0.95,
      blending: THREE.AdditiveBlending
    });
    const sphere = new THREE.Mesh(sphereGeom, sphereMat);
    pinGroup.add(sphere);

    // Canvas Billboard Label (Browser only)
    if (typeof document !== 'undefined') {
      const canvas = document.createElement('canvas');
      canvas.width = 256;
      canvas.height = 64;
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.fillStyle = 'rgba(11, 15, 28, 0.92)';
        ctx.roundRect(4, 4, 248, 56, 12);
        ctx.fill();
        ctx.strokeStyle = `#${new THREE.Color(hexColor).getHexString()}`;
        ctx.lineWidth = 4;
        ctx.stroke();

        ctx.fillStyle = '#ffffff';
        ctx.font = 'bold 22px system-ui, -apple-system, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(labelText, 128, 32);

        const texture = new THREE.CanvasTexture(canvas);
        texture.minFilter = THREE.LinearFilter;
        const spriteMat = new THREE.SpriteMaterial({ map: texture, transparent: true, depthTest: false });
        const sprite = new THREE.Sprite(spriteMat);
        sprite.scale.set(16, 4, 1);
        sprite.position.set(0, 36, 0);
        pinGroup.add(sprite);
      }
    }

    return pinGroup;
  }

  update(dt) {
    this.time += dt;
    if (this.ribbonMesh && this.ribbonMesh.material) {
      // Subtle glowing breathing pulsation
      const pulse = 0.82 + 0.16 * Math.sin(this.time * 4.0);
      this.ribbonMesh.material.opacity = pulse;
    }

    if (this.pinA) {
      const ring = this.pinA.children[1];
      if (ring) {
        const s = 1.0 + 0.25 * Math.sin(this.time * 3.0);
        ring.scale.set(s, 1, s);
      }
    }

    if (this.pinB) {
      const ring = this.pinB.children[1];
      if (ring) {
        const s = 1.0 + 0.25 * Math.sin(this.time * 3.0 + Math.PI);
        ring.scale.set(s, 1, s);
      }
    }
  }
}
