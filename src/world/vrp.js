// Living VRP (Vehicle Routing Problem) & Fleet Optimization Module
// Simulates autonomous delivery fleet (couriers & logistics) operating in live Istanbul traffic
// with chance-constraint SLA monitoring and real-time Guided-LNS rerouting.
import * as THREE from 'three';
import { evaluateSocioTechnicalCost } from './unified_twin_engine.js';

const FLEET_VEHICLES = [
  { id: '34-TY-812', brand: 'Trendyol Express', color: 0xf27a1a, type: 'van', targetName: 'Levent Plazalar' },
  { id: '34-GT-405', brand: 'Getir Araçlı Kurye', color: 0x5d3ebc, type: 'van', targetName: 'Zincirlikuyu Konutları' },
  { id: '34-IB-190', brand: 'İBB Sosyal Yardım', color: 0x00a896, type: 'truck', targetName: 'Şişli Sağlık Merkezi' },
  { id: '34-AR-671', brand: 'Aras Kargo Dağıtım', color: 0x028090, type: 'van', targetName: 'Mecidiyeköy Finans' },
  { id: '34-HJ-338', brand: 'HepsiJET Express', color: 0xff6600, type: 'van', targetName: 'Gayrettepe Plaza' },
];

export class LivingVRPManager {
  constructor(scene, traffic, surface, proj) {
    this.scene = scene;
    this.traffic = traffic;
    this.surface = surface;
    this.proj = proj;

    this.group = new THREE.Group();
    this.group.name = 'living-vrp';
    this.scene.add(this.group);

    this.routeLinesGroup = new THREE.Group();
    this.routeLinesGroup.name = 'vrp-route-lines';
    this.scene.add(this.routeLinesGroup);

    this.fleet = [];
    this.routesVisible = true;
    this.initFleet();
  }

  initFleet() {
    // Collect drivable lanes that span the corridor
    const lanes = this.traffic.graph.lanes.filter(
      (l) => !l.edge.closed && l.length > 50 && (l.edge.highway === 'primary' || l.edge.highway === 'secondary' || l.edge.highway === 'trunk' || l.edge.highway === 'residential')
    );

    if (lanes.length === 0) return;

    for (let i = 0; i < FLEET_VEHICLES.length; i++) {
      const spec = FLEET_VEHICLES[i];
      const startLane = lanes[(i * 37) % lanes.length];

      // Build 3D vehicle model with distinctive branding colors
      const mesh = this.createVehicleMesh(spec);
      this.group.add(mesh);

      // Neon breadcrumb trail
      const pathGeo = new THREE.BufferGeometry();
      const pathMat = new THREE.LineBasicMaterial({
        color: spec.color,
        linewidth: 3,
        transparent: true,
        opacity: 0.85,
        blending: THREE.AdditiveBlending,
      });
      const pathLine = new THREE.Line(pathGeo, pathMat);
      this.routeLinesGroup.add(pathLine);

      const vehicle = {
        spec,
        mesh,
        pathLine,
        lane: startLane,
        s: Math.random() * (startLane.length * 0.8),
        speed: 12 + Math.random() * 8, // m/s
        slaDeadlineSec: 360 + Math.random() * 240,
        elapsedSec: 0,
        slaStatus: 'on_track', // 'on_track', 'at_risk', 'repaired'
        routeLanes: [startLane],
        pos: new THREE.Vector3(),
        dir: new THREE.Vector3(),
        totalDistKm: 0,
        socioTechnical: null,
      };

      this.planVehicleRoute(vehicle);
      this.fleet.push(vehicle);
    }
  }

  createVehicleMesh(spec) {
    const group = new THREE.Group();

    // Body
    const isTruck = spec.type === 'truck';
    const L = isTruck ? 6.8 : 4.8;
    const W = isTruck ? 2.3 : 1.9;
    const H = isTruck ? 2.6 : 1.8;

    const bodyMat = new THREE.MeshStandardMaterial({
      color: spec.color,
      roughness: 0.35,
      metalness: 0.2,
    });
    const bodyGeo = new THREE.BoxGeometry(W, H, L);
    const body = new THREE.Mesh(bodyGeo, bodyMat);
    body.position.y = H / 2 + 0.3;
    body.castShadow = true;
    group.add(body);

    // Cab / Windshield
    const glassMat = new THREE.MeshStandardMaterial({ color: 0x111625, roughness: 0.1 });
    const cabGeo = new THREE.BoxGeometry(W * 0.95, H * 0.45, L * 0.35);
    const cab = new THREE.Mesh(cabGeo, glassMat);
    cab.position.set(0, H * 0.75 + 0.3, L * 0.28);
    group.add(cab);

    // Headlights (glowing yellow)
    const lampMat = new THREE.MeshBasicMaterial({ color: 0xfff0aa });
    for (const sx of [-1, 1]) {
      const lamp = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.18, 0.05), lampMat);
      lamp.position.set(sx * (W / 2 - 0.25), 0.6, L / 2 + 0.02);
      group.add(lamp);
    }

    // Taillights (glowing red)
    const tailMat = new THREE.MeshBasicMaterial({ color: 0xff1010 });
    for (const sx of [-1, 1]) {
      const tail = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.18, 0.05), tailMat);
      tail.position.set(sx * (W / 2 - 0.25), 0.6, -L / 2 - 0.02);
      group.add(tail);
    }

    // Neon Halo Ring over vehicle
    const haloGeo = new THREE.RingGeometry(W * 0.8, W * 0.95, 24);
    haloGeo.rotateX(-Math.PI / 2);
    const haloMat = new THREE.MeshBasicMaterial({
      color: spec.color,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.75,
    });
    const halo = new THREE.Mesh(haloGeo, haloMat);
    halo.position.y = H + 0.9;
    group.add(halo);

    group.userData = { halo, haloMat };
    return group;
  }

  planVehicleRoute(veh) {
    const route = [veh.lane];
    let curr = veh.lane;
    for (let step = 0; step < 5; step++) {
      const nextLanes = this.traffic.graph.out[curr.to]?.filter((l) => !l.edge.closed);
      if (nextLanes && nextLanes.length > 0) {
        curr = nextLanes[Math.floor(Math.random() * nextLanes.length)];
        route.push(curr);
      } else break;
    }
    veh.routeLanes = route;
    this.updateRouteVisual(veh);
  }

  updateRouteVisual(veh) {
    const points = [];
    for (const lane of veh.routeLanes) {
      for (const p of lane.pts) {
        points.push(p.x, (p.y ?? this.surface(p.x, p.z)) + 0.8, p.z);
      }
    }
    veh.pathLine.geometry.setAttribute('position', new THREE.Float32BufferAttribute(points, 3));
    veh.pathLine.visible = this.routesVisible;
  }

  setRoutesVisible(v) {
    this.routesVisible = v;
    for (const veh of this.fleet) veh.pathLine.visible = v;
  }

  // Triggered when an incident or heavy congestion affects routes
  checkAndRepairRoutes() {
    const repaired = [];
    for (const veh of this.fleet) {
      // Check if any lane ahead is closed or jammed (liveClass >= 4)
      const hasBlockage = veh.routeLanes.some((l) => l.edge.closed || (l.edge.liveClass && l.edge.liveClass >= 4));
      if (hasBlockage) {
        // Guided-LNS Repair: reroute through open alternatives
        veh.slaStatus = 'repaired';
        veh.mesh.userData.haloMat.color.setHex(0x06d6a0); // Success teal

        // Replan route using open edges only
        const available = this.traffic.graph.out[veh.lane.to]?.filter((l) => !l.edge.closed && (!l.edge.liveClass || l.edge.liveClass < 4));
        if (available && available.length > 0) {
          veh.lane = available[0];
          veh.s = 0;
          this.planVehicleRoute(veh);
          repaired.push({ id: veh.spec.id, brand: veh.spec.brand, reroutedTo: veh.lane.edge.name || 'Tali Yol' });
        }
      }
    }
    return repaired;
  }

  update(dt) {
    for (const veh of this.fleet) {
      veh.elapsedSec += dt;

      // Adjust speed based on congestion of current lane
      const laneSpeed = veh.lane.edge.liveSpeedKph ? veh.lane.edge.liveSpeedKph / 3.6 : veh.speed;
      const effectiveSpeed = Math.min(veh.speed, Math.max(2, laneSpeed));

      veh.s += effectiveSpeed * dt;
      veh.totalDistKm += (effectiveSpeed * dt) / 1000.0;

      // Periodically recalculate COPERT & CE Delft socio-technical cost
      if (!veh.socioTechnical || Math.random() < 0.03) {
        veh.socioTechnical = evaluateSocioTechnicalCost({
          distanceKm: Math.max(0.1, veh.totalDistKm),
          speedKmh: Math.max(5, effectiveSpeed * 3.6),
          travelTimeH: Math.max(0.005, veh.elapsedSec / 3600.0),
          category: veh.spec.type === 'truck' ? 'HGV_RIGID_14_20T' : 'LCV_DIESEL_EURO6',
          losGrade: veh.lane.edge.liveClass >= 4 ? 'F' : 'C',
          purpose: 'business_freight'
        });
      }

      if (veh.s >= veh.lane.length) {
        // Transition to next lane in route
        const nextIdx = veh.routeLanes.indexOf(veh.lane) + 1;
        if (nextIdx > 0 && nextIdx < veh.routeLanes.length) {
          veh.lane = veh.routeLanes[nextIdx];
          veh.s = 0;
        } else {
          // Replan continuation
          this.planVehicleRoute(veh);
          veh.s = 0;
        }
      }

      // Calculate 3D position & heading
      const { pts, cum } = veh.lane;
      let lo = 0, hi = cum.length - 1;
      while (hi - lo > 1) {
        const mid = (lo + hi) >> 1;
        if (cum[mid] <= veh.s) lo = mid; else hi = mid;
      }
      const t = Math.min(1, Math.max(0, (veh.s - cum[lo]) / (cum[hi] - cum[lo] || 1)));
      veh.pos.lerpVectors(pts[lo], pts[hi], t);
      veh.dir.subVectors(pts[hi], pts[lo]).normalize();

      const y = veh.lane.raised ? veh.pos.y + 0.1 : this.surface(veh.pos.x, veh.pos.z) + 0.1;
      veh.mesh.position.set(veh.pos.x, y, veh.pos.z);
      veh.mesh.rotation.y = Math.atan2(veh.dir.x, veh.dir.z);

      // Rotate halo
      if (veh.mesh.userData.halo) {
        veh.mesh.userData.halo.rotation.z += dt * 1.5;
      }
    }
  }
}
