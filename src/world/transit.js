// Public Transit (Metro & Metrobüs) Stations, Moving Articulated Metrobüs Fleet & Dynamic Incident Simulation
import * as THREE from 'three';

export const STATIONS = [
  {
    id: 'mecidiyekoy-metrobus',
    name: 'Mecidiyeköy Metrobüs',
    type: 'metrobus',
    lon: 28.9950,
    lat: 41.0664,
    lines: ['34', '34A', '34AS', '34BZ', '34G'],
    status: 'normal',
    desc: 'Metrobüs Ana Aktarma İstasyonu',
  },
  {
    id: 'zincirlikuyu-metrobus',
    name: 'Zincirlikuyu Metrobüs',
    type: 'metrobus',
    lon: 29.0175,
    lat: 41.0683,
    lines: ['34', '34AS', '34BZ', '34G', '34Z'],
    status: 'normal',
    desc: 'Boğaziçi Köprüsü Öncesi Son Metrobüs İstasyonu',
  },
  {
    id: 'sisli-mecidiyekoy-metro',
    name: 'Şişli - Mecidiyeköy Metro',
    type: 'metro',
    lon: 28.9928,
    lat: 41.0638,
    lines: ['M2 Yenikapı - Hacıosman', 'M7 Yıldız - Mahmutbey'],
    status: 'normal',
    desc: 'M2 & M7 Metro Entegrasyon İstasyonu',
  },
  {
    id: 'gayrettepe-metro',
    name: 'Gayrettepe Metro',
    type: 'metro',
    lon: 29.0118,
    lat: 41.0694,
    lines: ['M2 Yenikapı - Hacıosman', 'M11 Gayrettepe - İstanbul Havalimanı'],
    status: 'normal',
    desc: 'Havalimanı Hızlı Metro Aktarma İstasyonu',
  },
  {
    id: 'levent-metro',
    name: 'Levent Metro',
    type: 'metro',
    lon: 29.0135,
    lat: 41.0772,
    lines: ['M2 Yenikapı - Hacıosman', 'M6 Levent - Boğaziçi Üniversitesi'],
    status: 'normal',
    desc: 'Finans Merkezi & Plazalar Bölgesi Metro İstasyonu',
  },
];

export class TransitSystem {
  constructor(scene, proj, surface) {
    this.scene = scene;
    this.proj = proj;
    this.surface = surface;
    this.group = new THREE.Group();
    this.group.name = 'transit-system';
    this.markers = [];
    this.metrobusFleet = [];
    this.activeIncidents = new Set();
    this.listeners = [];

    this.initMarkers();
    this.initMetrobusCorridor();
    this.scene.add(this.group);
  }

  initMarkers() {
    for (const station of STATIONS) {
      const [x, z] = this.proj.project(station.lon, station.lat);
      const groundY = this.surface(x, z);

      const isMetrobus = station.type === 'metrobus';
      const baseColor = isMetrobus ? 0xffb703 : 0x06d6a0; // Yellow for Metrobüs, Teal/Cyan for Metro

      // Ground Pulsing Ring
      const ringGeo = new THREE.RingGeometry(3.5, 4.2, 32);
      ringGeo.rotateX(-Math.PI / 2);
      const ringMat = new THREE.MeshBasicMaterial({
        color: baseColor,
        side: THREE.DoubleSide,
        transparent: true,
        opacity: 0.6,
      });
      const ring = new THREE.Mesh(ringGeo, ringMat);
      ring.position.set(x, groundY + 0.15, z);
      this.group.add(ring);

      // Pillar
      const pillarGeo = new THREE.CylinderGeometry(0.7, 0.7, 16, 8);
      const pillarMat = new THREE.MeshStandardMaterial({ color: 0x1f242d, roughness: 0.7 });
      const pillar = new THREE.Mesh(pillarGeo, pillarMat);
      pillar.position.set(x, groundY + 8, z);

      // Glowing Beacon
      const beaconGeo = new THREE.DodecahedronGeometry(isMetrobus ? 3.0 : 2.5);
      const beaconMat = new THREE.MeshStandardMaterial({
        color: baseColor,
        emissive: baseColor,
        emissiveIntensity: 0.8,
        roughness: 0.2,
      });
      const beacon = new THREE.Mesh(beaconGeo, beaconMat);
      beacon.position.set(x, groundY + 17, z);

      const markerObj = { station, x, z, y: groundY, pillar, beacon, beaconMat, ring, ringMat, baseColor };
      this.markers.push(markerObj);
      this.group.add(pillar, beacon);
    }
  }

  initMetrobusCorridor() {
    // Key control waypoints along the central D-100 Metrobüs corridor
    const waypoints = [
      [28.9870, 41.0645], // Çağlayan - Mecidiyeköy yaklaşımı
      [28.9950, 41.0664], // Mecidiyeköy Metrobüs İstasyonu
      [29.0040, 41.0674], // Gayrettepe / Çevre Yolu ayrımı
      [29.0175, 41.0683], // Zincirlikuyu Metrobüs Aktarma Merkezi
      [29.0270, 41.0686], // 15 Temmuz Şehitler Köprüsü Girişi
    ];

    const projPoints = waypoints.map(([lon, lat]) => {
      const [x, z] = this.proj.project(lon, lat);
      return new THREE.Vector3(x, this.surface(x, z), z);
    });

    // Create Eastbound & Westbound spline tracks
    const eastTrack = new THREE.CatmullRomCurve3(
      projPoints.map((p) => new THREE.Vector3(p.x, p.y + 0.4, p.z - 1.8))
    );
    const westTrack = new THREE.CatmullRomCurve3(
      [...projPoints].reverse().map((p) => new THREE.Vector3(p.x, p.y + 0.4, p.z + 1.8))
    );

    // Spawn 4 Articulated Metrobüs vehicles
    const fleetSpecs = [
      { id: 'M-3401', line: '34G', track: eastTrack, progress: 0.05, speed: 0.024 },
      { id: 'M-3402', line: '34BZ', track: eastTrack, progress: 0.55, speed: 0.022 },
      { id: 'M-3403', line: '34AS', track: westTrack, progress: 0.2, speed: 0.025 },
      { id: 'M-3404', line: '34Z', track: westTrack, progress: 0.7, speed: 0.023 },
    ];

    for (const spec of fleetSpecs) {
      const bus = this.createMetrobusMesh(spec.line);
      this.group.add(bus.root);
      this.metrobusFleet.push({
        ...spec,
        mesh: bus.root,
        frontMesh: bus.front,
        rearMesh: bus.rear,
        bellowsMesh: bus.bellows,
        state: 'moving', // 'moving', 'dwelling'
        dwellTimer: 0,
      });
    }
  }

  createMetrobusMesh(lineName) {
    const root = new THREE.Group();

    // Livery: IETT Yellow/White/Turquoise
    const bodyMat = new THREE.MeshStandardMaterial({
      color: 0xfdb813, // IETT Yellow
      roughness: 0.4,
      metalness: 0.1,
    });
    const roofMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.5 });
    const glassMat = new THREE.MeshStandardMaterial({ color: 0x141e2b, roughness: 0.1 });
    const bellowsMat = new THREE.MeshStandardMaterial({ color: 0x242424, roughness: 0.8 }); // Körüklü bağlantı

    // Front Car (9m long)
    const front = new THREE.Group();
    const frontBody = new THREE.Mesh(new THREE.BoxGeometry(2.55, 3.1, 8.8), bodyMat);
    frontBody.position.y = 1.7;
    frontBody.castShadow = true;
    front.add(frontBody);

    // Front Roof (White)
    const frontRoof = new THREE.Mesh(new THREE.BoxGeometry(2.52, 0.2, 8.7), roofMat);
    frontRoof.position.y = 3.3;
    front.add(frontRoof);

    // Windshield & Side Windows
    const frontGlass = new THREE.Mesh(new THREE.BoxGeometry(2.56, 1.3, 3.2), glassMat);
    frontGlass.position.set(0, 2.1, 2.7);
    front.add(frontGlass);

    // Illuminated Destination Sign (LED)
    const ledMat = new THREE.MeshBasicMaterial({ color: 0xffa500 });
    const ledSign = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.35, 0.05), ledMat);
    ledSign.position.set(0, 2.9, 4.42);
    front.add(ledSign);

    // Headlights
    const lampMat = new THREE.MeshBasicMaterial({ color: 0xfffbe6 });
    for (const sx of [-1, 1]) {
      const lamp = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.22, 0.05), lampMat);
      lamp.position.set(sx * 1.0, 0.7, 4.42);
      front.add(lamp);
    }
    front.position.z = 4.8;
    root.add(front);

    // Accordion Bellows (Körüklü akordeon)
    const bellows = new THREE.Mesh(new THREE.BoxGeometry(2.48, 2.95, 1.2), bellowsMat);
    bellows.position.y = 1.68;
    root.add(bellows);

    // Rear Car (8m long)
    const rear = new THREE.Group();
    const rearBody = new THREE.Mesh(new THREE.BoxGeometry(2.55, 3.1, 7.8), bodyMat);
    rearBody.position.y = 1.7;
    rearBody.castShadow = true;
    rear.add(rearBody);

    const rearRoof = new THREE.Mesh(new THREE.BoxGeometry(2.52, 0.2, 7.7), roofMat);
    rearRoof.position.y = 3.3;
    rear.add(rearRoof);

    // Rear Taillights
    const tailMat = new THREE.MeshBasicMaterial({ color: 0xff1010 });
    for (const sx of [-1, 1]) {
      const tail = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.35, 0.05), tailMat);
      tail.position.set(sx * 1.0, 1.2, -3.92);
      rear.add(tail);
    }
    rear.position.z = -4.5;
    root.add(rear);

    return { root, front, rear, bellows };
  }

  onIncidentChange(cb) {
    this.listeners.push(cb);
  }

  notify(msg, type = 'warning') {
    for (const cb of this.listeners) cb(msg, type);
  }

  triggerIncident(scenarioId, traffic) {
    if (this.activeIncidents.has(scenarioId)) {
      this.resolveIncident(scenarioId, traffic);
      return false;
    }
    this.activeIncidents.add(scenarioId);

    if (scenarioId === 'bridge-closure') {
      let closedCount = 0;
      for (const lane of traffic.graph.lanes) {
        const m = lane.pts[lane.pts.length >> 1];
        if (m.x > 250 && m.x < 900 && m.z > -300 && m.z < 300) {
          lane.edge.closed = true;
          lane.edge.liveClass = 5;
          lane.edge.liveSpeedKph = 2;
          lane.liveSpeed = 2 / 3.6;
          closedCount++;
        }
      }
      traffic.updateTrafficOverlay();
      this.notify(`🚨 TKM: 15 Temmuz Şehitler Köprüsü katılımında zincirleme kaza! ${closedCount} şerit trafiğe kapatıldı.`, 'danger');
    } else if (scenarioId === 'metrobus-jam') {
      const st = this.markers.find((m) => m.station.id === 'mecidiyekoy-metrobus');
      if (st) {
        st.beaconMat.color.setHex(0xe63946);
        st.beaconMat.emissive.setHex(0xe63946);
        st.beaconMat.emissiveIntensity = 1.4;
      }
      this.notify('⚠️ İETT: Mecidiyeköy Metrobüs durağında araç arızası! Seferler kontrollü sağlanıyor.', 'warning');
    } else if (scenarioId === 'metro-breakdown') {
      const st = this.markers.find((m) => m.station.id === 'gayrettepe-metro');
      if (st) {
        st.beaconMat.color.setHex(0xe63946);
        st.beaconMat.emissive.setHex(0xe63946);
        st.beaconMat.emissiveIntensity = 1.4;
      }
      this.notify('🚇 Metro İstanbul: M11 Gayrettepe - Havalimanı hattı teknik arıza nedeniyle geçici süre kapatılmıştır.', 'danger');
    } else if (scenarioId === 'levent-work') {
      let slowedCount = 0;
      for (const lane of traffic.graph.lanes) {
        const m = lane.pts[lane.pts.length >> 1];
        if (m.x > -200 && m.x < 400 && m.z < -600 && m.z > -1200) {
          lane.edge.liveClass = 4;
          lane.edge.liveSpeedKph = 14;
          lane.liveSpeed = 14 / 3.6;
          slowedCount++;
        }
      }
      traffic.updateTrafficOverlay();
      this.notify('🚧 TKM: Büyükdere Caddesi Levent mevkiinde altyapı çalışması. 1 şerit kapalı, trafik ağır akıyor.', 'warning');
    }
    return true;
  }

  resolveIncident(scenarioId, traffic) {
    this.activeIncidents.delete(scenarioId);

    if (scenarioId === 'bridge-closure' || scenarioId === 'levent-work') {
      for (const lane of traffic.graph.lanes) {
        lane.edge.closed = false;
        lane.edge.liveClass = null;
        lane.edge.liveSpeedKph = null;
        lane.liveSpeed = null;
      }
      traffic.updateTrafficOverlay();
      this.notify('✅ TKM: Olay yeri temizlendi, tüm şeritler yeniden trafiğe açıldı.', 'success');
    } else if (scenarioId === 'metrobus-jam') {
      const st = this.markers.find((m) => m.station.id === 'mecidiyekoy-metrobus');
      if (st) {
        st.beaconMat.color.setHex(st.baseColor);
        st.beaconMat.emissive.setHex(st.baseColor);
        st.beaconMat.emissiveIntensity = 0.8;
      }
      this.notify('✅ İETT: Mecidiyeköy Metrobüs durağında seferler normale döndü.', 'success');
    } else if (scenarioId === 'metro-breakdown') {
      const st = this.markers.find((m) => m.station.id === 'gayrettepe-metro');
      if (st) {
        st.beaconMat.color.setHex(st.baseColor);
        st.beaconMat.emissive.setHex(st.baseColor);
        st.beaconMat.emissiveIntensity = 0.8;
      }
      this.notify('✅ Metro İstanbul: Gayrettepe istasyonu yeniden yolcu alımına açıldı.', 'success');
    }
  }

  update(dt, time) {
    // 1. Station Beacons Bobbing & Rings Pulsing
    for (const m of this.markers) {
      m.beacon.rotation.y = time * 0.8;
      m.beacon.position.y = m.y + 17 + Math.sin(time * 2 + m.x * 0.01) * 0.7;
      if (m.ringMat) {
        m.ringMat.opacity = 0.35 + Math.sin(time * 3 + m.z * 0.02) * 0.25;
      }
    }

    // 2. Metrobüs Fleet Along Corridor Splines
    for (const bus of this.metrobusFleet) {
      // Dwell at station stops (Mecidiyeköy ~ 0.25, Zincirlikuyu ~ 0.75)
      const nearStation = Math.abs(bus.progress - 0.26) < 0.015 || Math.abs(bus.progress - 0.76) < 0.015;
      if (nearStation && bus.state === 'moving') {
        bus.state = 'dwelling';
        bus.dwellTimer = 2.5; // Dwell duration in seconds
      }

      if (bus.state === 'dwelling') {
        bus.dwellTimer -= dt;
        if (bus.dwellTimer <= 0) {
          bus.state = 'moving';
        }
      } else {
        bus.progress = (bus.progress + bus.speed * dt) % 1.0;
      }

      const point = bus.track.getPointAt(bus.progress);
      const tangent = bus.track.getTangentAt(bus.progress).normalize();

      bus.mesh.position.copy(point);
      bus.mesh.rotation.y = Math.atan2(tangent.x, tangent.z);
    }
  }
}
