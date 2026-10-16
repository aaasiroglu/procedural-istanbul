// Matrakçı-Twin 3D Sahnesi ve Anlamsal LOD Yöneticisi (1537 Beyân-ı Menâzil x 2026 Spatial AI)
import * as THREE from 'three';
import { MATRAKCI_PALETTE, MATRAKCI_HEX } from './matrakciPalette.js';
import { twinStore, projectLonLat } from './twinStore.js';
import {
  chaikinAndSplineSmooth,
  mapSumoToSpline3D,
  buildRibbonGeometry,
} from './CartographicGeneralizer.js';
import {
  createSteppedTerrainGroup,
  createTurkishHouseMesh,
  createLandmarkMesh,
  createFloraMesh,
  createVehicleCapsuleMesh,
  registeredPolyfocalMaterials,
} from './ProceduralTurkishArch.js';
import { createGoldVrpRouteShaderMaterial } from './MatrakciShaders.js';

export class MatrakciTwinCanvas {
  constructor(renderer, sharedCamera, sharedControls) {
    this.renderer = renderer;
    this.camera = sharedCamera;
    this.controls = sharedControls;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(MATRAKCI_PALETTE.AHAR_PAPER_BG);

    // Nakkaşhane Sıcak Işıklandırması
    const ambientLight = new THREE.AmbientLight(0xfff5e6, 0.95);
    this.scene.add(ambientLight);

    this.sunLight = new THREE.DirectionalLight(0xffe6b8, 1.4);
    this.sunLight.position.set(250, 450, 200);
    this.scene.add(this.sunLight);

    // Gruplar
    this.terrainGroup = null;
    this.roadsGroup = new THREE.Group();
    this.roadsGroup.name = 'matrakci-roads';
    this.scene.add(this.roadsGroup);

    this.housesGroup = new THREE.Group();
    this.housesGroup.name = 'matrakci-houses';
    this.scene.add(this.housesGroup);

    this.landmarksGroup = new THREE.Group();
    this.landmarksGroup.name = 'matrakci-landmarks';
    this.scene.add(this.landmarksGroup);

    this.floraGroup = new THREE.Group();
    this.floraGroup.name = 'matrakci-flora';
    this.scene.add(this.floraGroup);

    this.sebekeGridGroup = new THREE.Group();
    this.sebekeGridGroup.name = 'umdetul-hisab-sebeke';
    this.scene.add(this.sebekeGridGroup);

    this.odArcsGroup = new THREE.Group();
    this.odArcsGroup.name = 'ibb-inverse-od-arcs';
    this.scene.add(this.odArcsGroup);

    this.vehiclesGroup = new THREE.Group();
    this.vehiclesGroup.name = 'sumo-vehicles';
    this.scene.add(this.vehiclesGroup);

    // Yol spline önbelleği: roadId -> { curveData, material }
    this.roadCurves = new Map();
    // Araç mesh önbelleği: vehicleId -> mesh
    this.vehicleMeshes = new Map();

    this.raycaster = new THREE.Raycaster();
    this.pointer = new THREE.Vector2();

    this.initTerrain();
    this.initRoads();
    this.initUmdetulHisabLattice();
    this.initInverseODArcs();
    this.initLandmarks();
    this.initBuildings();
    this.initFlora();
    this.initVehicles();
    this.bindEvents();

    // Store dinleyicisi
    this.unsubscribeStore = twinStore.subscribe((state) => {
      this.onStoreUpdate(state);
    });
  }

  // 1. Kademeli Zırnık Sekileri ve Deniz
  initTerrain() {
    const { group, seaMat } = createSteppedTerrainGroup();
    this.terrainGroup = group;
    this.seaMaterial = seaMat;
    this.scene.add(this.terrainGroup);
  }

  // 2. Chaikin ve B-Spline Pürüzsüz Şerit Yollar
  initRoads() {
    const state = twinStore.getState();
    state.roads.forEach((road) => {
      const curveData = chaikinAndSplineSmooth(road.rawCoords, 64);
      const isSea = road.name.includes('Deniz');
      const width = isSea ? 8.0 : road.isOptimalVrpRoute ? 5.2 : 3.8;
      const yOffset = isSea ? 0.3 : 0.8;

      const ribbonGeo = buildRibbonGeometry(curveData, width, yOffset);
      const mat = createGoldVrpRouteShaderMaterial(road.isOptimalVrpRoute, road.sigmaVariance);

      const mesh = new THREE.Mesh(ribbonGeo, mat);
      mesh.name = `road_${road.edgeId}`;
      mesh.userData = { edgeId: road.edgeId };
      this.roadsGroup.add(mesh);

      this.roadCurves.set(road.edgeId, { curveData, mat, mesh });
    });
  }

  // 3. Umdetü'l-Hisâb Şebeke (Lattice Matrix) Çarpımı GNN Budama Kafesi
  initUmdetulHisabLattice() {
    const size = 1800;
    const step = 90;
    const pts = [];

    // 45 Derece Diyagonal Matrakçı Kafes Çizgileri
    for (let i = -size; i <= size; i += step) {
      // Pozitif eğimli diyagonaller
      pts.push(new THREE.Vector3(i, 2.8, -size));
      pts.push(new THREE.Vector3(i + size, 2.8, 0));
      // Negatif eğimli diyagonaller
      pts.push(new THREE.Vector3(i, 2.8, size));
      pts.push(new THREE.Vector3(i + size, 2.8, 0));
    }

    const gridGeo = new THREE.BufferGeometry().setFromPoints(pts);
    const gridMat = new THREE.LineBasicMaterial({
      color: MATRAKCI_HEX.SEBEKE_LATTICE,
      transparent: true,
      opacity: 0.35,
    });
    const gridLines = new THREE.LineSegments(gridGeo, gridMat);
    this.sebekeGridGroup.add(gridLines);
  }

  // 4. İBB Inverse-OD (Başlangıç-Varış) Akış Yayları
  initInverseODArcs() {
    const odPairs = [
      { from: [28.964, 41.016, 10], to: [29.023, 40.992, 10], flow: 'Eminönü ➔ Kadıköy: 3.420 ar/sa' },
      { from: [29.015, 41.026, 8], to: [28.974, 41.025, 12], flow: 'Üsküdar ➔ Galata: 2.850 ar/sa' },
      { from: [28.976, 41.008, 12], to: [28.989, 41.045, 18], flow: 'Tarihi Yarımada ➔ Mecidiyeköy: 4.110 ar/sa' },
    ];

    const goldMat = new THREE.LineBasicMaterial({ color: MATRAKCI_HEX.CETVEL_GOLD, linewidth: 2 });
    const lapisMat = new THREE.LineBasicMaterial({ color: MATRAKCI_HEX.CETVEL_LAPIS, linewidth: 2 });

    odPairs.forEach((pair, idx) => {
      const p1 = new THREE.Vector3(...projectLonLat(pair.from[0], pair.from[1], pair.from[2]));
      const p2 = new THREE.Vector3(...projectLonLat(pair.to[0], pair.to[1], pair.to[2]));
      const dist = p1.distanceTo(p2);
      const mid = new THREE.Vector3()
        .addVectors(p1, p2)
        .multiplyScalar(0.5)
        .add(new THREE.Vector3(0, Math.min(180, dist * 0.22 + 45), 0));

      const curve = new THREE.QuadraticBezierCurve3(p1, mid, p2);
      const pts = curve.getPoints(40);
      const geo = new THREE.BufferGeometry().setFromPoints(pts);
      const arc = new THREE.Line(geo, idx % 2 === 0 ? goldMat : lapisMat);
      this.odArcsGroup.add(arc);
    });
  }

  // 5. Anıtsal Nirengiler
  initLandmarks() {
    const state = twinStore.getState();
    state.landmarks.forEach((lm) => {
      const mesh = createLandmarkMesh(lm.type, lm.name, lm.scale, state.polyfocalBendStrength);
      mesh.position.set(...lm.pos);
      this.landmarksGroup.add(mesh);
    });
  }

  // 6. Cumbalı Konutlar ve Yalılar
  initBuildings() {
    const state = twinStore.getState();
    state.buildings.forEach((b) => {
      const mesh = createTurkishHouseMesh(b.style, b.scale, state.polyfocalBendStrength);
      mesh.position.set(...b.pos);
      mesh.rotation.y = b.rotation;
      this.housesGroup.add(mesh);
    });
  }

  // 7. Selvi ve Erguvan Ağaçları
  initFlora() {
    const state = twinStore.getState();
    // Binaların arasına ve cami hazirelerine selviler ve erguvanlar serpiştir
    state.buildings.forEach((b, idx) => {
      if (idx % 2 === 0) {
        const type = idx % 4 === 0 ? 'erguvan' : 'cypress';
        const flora = createFloraMesh(type, 0.9 + (idx % 3) * 0.2);
        flora.position.set(b.pos[0] + 7, b.pos[1], b.pos[2] + 6);
        this.floraGroup.add(flora);
      }
    });
  }

  // 8. SUMO Canlı Araç Kapsülleri
  initVehicles() {
    const state = twinStore.getState();
    state.vehicles.forEach((veh) => {
      const mesh = createVehicleCapsuleMesh(veh.type);
      mesh.name = veh.id;
      mesh.userData = { vehicleId: veh.id, isVehicle: true };
      this.vehiclesGroup.add(mesh);
      this.vehicleMeshes.set(veh.id, mesh);
    });
  }

  bindEvents() {
    this.onPointerDown = (e) => {
      if (twinStore.getState().viewMode !== 'matrakci') return;
      this.pointer.x = (e.clientX / innerWidth) * 2 - 1;
      this.pointer.y = -(e.clientY / innerHeight) * 2 + 1;

      this.raycaster.setFromCamera(this.pointer, this.camera);
      const intersects = this.raycaster.intersectObjects(this.vehiclesGroup.children, true);

      if (intersects.length > 0) {
        let root = intersects[0].object;
        while (root.parent && root.parent !== this.vehiclesGroup) {
          root = root.parent;
        }
        if (root.userData && root.userData.vehicleId) {
          twinStore.selectVehicle(root.userData.vehicleId);
        }
      }
    };

    window.addEventListener('pointerdown', this.onPointerDown);
  }

  onStoreUpdate(state) {
    // Kafes görünürlüğü
    this.sebekeGridGroup.visible = state.showSebekeGrid;

    // Kaos/kaza anında yolların varyans shader uniformlarını güncelle
    state.roads.forEach((r) => {
      const item = this.roadCurves.get(r.edgeId);
      if (item && item.mat && item.mat.uniforms) {
        item.mat.uniforms.uVariance.value = r.sigmaVariance;
      }
    });
  }

  // Her Karede Güncelleme (Anlamsal LOD, Araç Yörüngeleri ve Shader Zamanı)
  update(dt, elapsedTime) {
    const state = twinStore.getState();

    // 1. Shader Uniformlarını Güncelle
    if (this.seaMaterial && this.seaMaterial.uniforms) {
      this.seaMaterial.uniforms.uTime.value = elapsedTime;
    }
    this.roadCurves.forEach(({ mat }) => {
      if (mat && mat.uniforms) {
        mat.uniforms.uTime.value = elapsedTime;
      }
    });

    // 2. Polifokal Bükülme için Kamera Yatay Yönünü Güncelle
    const camDir = new THREE.Vector3();
    this.camera.getWorldDirection(camDir);
    camDir.y = 0;
    if (camDir.lengthSq() > 0.001) camDir.normalize();
    for (const mat of registeredPolyfocalMaterials) {
      if (mat && mat.uniforms && mat.uniforms.uCameraDirXZ) {
        mat.uniforms.uCameraDirXZ.value.copy(camDir);
      }
    }

    // 3. Kamera Koordinatlarını ve Anlamsal LOD Hesapla (Yalnızca belirgin zoom değişiminde tetikle)
    const camDist = this.camera.position.distanceTo(this.controls.target);
    const currentZoom = Math.max(10, Math.min(19, 18.2 - Math.log2(camDist / 35)));
    if (Math.abs(state.camera.zoom - currentZoom) > 0.08) {
      twinStore.setCamera({ zoom: currentZoom });
    }

    const lod = state.semanticLod; // 'macro' | 'meso' | 'micro'

    // 3. Anlamsal LOD Görsel Ölçeklemeleri
    if (lod === 'macro') {
      // Makro Mod: Evler gizli, OD akışları ve anıtsal nirengiler önde
      this.housesGroup.visible = false;
      this.floraGroup.visible = false;
      this.odArcsGroup.visible = true;
    } else if (lod === 'meso') {
      // Mezo Mod: Fraktal İstanbul, cumbalı evler ve selviler yükselir
      this.housesGroup.visible = true;
      this.floraGroup.visible = true;
      this.odArcsGroup.visible = true;
    } else {
      // Mikro Mod: Şerit detayları ve canlı araçlar tam görünümde
      this.housesGroup.visible = true;
      this.floraGroup.visible = true;
      this.odArcsGroup.visible = false;
    }

    // 4. Canlı SUMO Araçlarını B-Spline Yörüngesinde Yürüt
    for (const veh of state.vehicles) {
      const mesh = this.vehicleMeshes.get(veh.id);
      if (!mesh) continue;

      const curveItem = this.roadCurves.get(veh.edgeId);
      if (!curveItem) continue;

      const road = state.roads.find((r) => r.edgeId === veh.edgeId);
      const numLanes = road ? road.numLanes : 2;

      // mapSumoToSpline3D ile şerit ve dönüş hesabı
      const { position, yaw } = mapSumoToSpline3D(
        curveItem.curveData,
        veh.laneIndex,
        numLanes,
        veh.lanePos,
        veh.edgeLength
      );

      mesh.position.copy(position);
      mesh.rotation.y = yaw;

      // Seçili VRP aracına hafif altın titreşimi ver
      if (state.selectedVehicleId === veh.id) {
        mesh.scale.setScalar(1.35 + Math.sin(elapsedTime * 6.0) * 0.1);
      } else {
        mesh.scale.setScalar(1.0);
      }
    }
  }

  render(dt, elapsedTime) {
    this.update(dt, elapsedTime);
    this.renderer.render(this.scene, this.camera);
  }

  dispose() {
    window.removeEventListener('pointerdown', this.onPointerDown);
    if (this.unsubscribeStore) this.unsubscribeStore();
  }
}
