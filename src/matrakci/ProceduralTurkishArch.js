// Prosedürel Türk Mimarisi, Anıtsal Nirengiler, Flora ve Araç Kapsülleri (Düzeltilmiş ve Optimize)
import * as THREE from 'three';
import { MATRAKCI_PALETTE, MATRAKCI_HEX } from './matrakciPalette.js';
import {
  createPolyfocalBuildingMaterial,
  createOttomanSeaShaderMaterial,
} from './MatrakciShaders.js';

// Tüm polifokal malzemelerin referans listesi (kamera dönüşünde uniform güncellemesi için)
export const registeredPolyfocalMaterials = [];

export function getOrCreatePolyfocalMat(colorHex, inkHex = MATRAKCI_PALETTE.TAHRIR_INK, bend = 0.75) {
  const mat = createPolyfocalBuildingMaterial(colorHex, inkHex, bend);
  registeredPolyfocalMaterials.push(mat);
  return mat;
}

/**
 * 1. SteppedIstanbulTerrain: Tarihi Yarımada, Galata ve Üsküdar Kara Kütleleri ile Arasından Akan Minyatür Denizi
 */
export function createSteppedTerrainGroup() {
  const group = new THREE.Group();
  group.name = 'matrakci-stepped-terrain';

  // A. Osmanlı Minyatür Denizi (Boğaziçi, Haliç ve Marmara) - Zemin Düzlemi (y = 0)
  const seaGeo = new THREE.PlaneGeometry(4200, 4200, 32, 32);
  seaGeo.rotateX(-Math.PI / 2);
  const seaMat = createOttomanSeaShaderMaterial();
  const seaMesh = new THREE.Mesh(seaGeo, seaMat);
  seaMesh.position.y = 0.0;
  seaMesh.name = 'ottoman-sea';
  group.add(seaMesh);

  const t1Mat = new THREE.MeshBasicMaterial({ color: MATRAKCI_HEX.ZIRNIK_TERRACE_1 });
  const t2Mat = new THREE.MeshBasicMaterial({ color: MATRAKCI_HEX.ZIRNIK_TERRACE_2 });
  const t3Mat = new THREE.MeshBasicMaterial({ color: MATRAKCI_HEX.ZIRNIK_TERRACE_3 });
  const wallMat = new THREE.MeshBasicMaterial({ color: MATRAKCI_HEX.KUFEKI_STONE });

  // Yardımcı seki üretici
  function addTerrace(x, z, w, d, h, yBase, mat, name) {
    const geo = new THREE.BoxGeometry(w, h, d);
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(x, yBase + h * 0.5, z);
    mesh.name = name;
    group.add(mesh);
    return mesh;
  }

  // B. Tarihi Yarımada (Haliç'in Güneyi, Boğaz'ın Batısı)
  // 1. Kademe: Kıyı Sekisi (Eminönü, Sirkeci, Sarayburnu, Yedikule)
  addTerrace(-700, 750, 1900, 1400, 1.2, 0.0, t1Mat, 'yarimada-t1');
  // 2. Kademe: Orta Yamaç Sekisi (Divanyolu, Çemberlitaş, Mahmutpaşa)
  addTerrace(-750, 700, 1600, 1100, 2.8, 1.2, t2Mat, 'yarimada-t2');
  // 3. Kademe: Üst Tepe Sekisi (Süleymaniye, Beyazıt, Fatih Tepeleri)
  addTerrace(-850, 650, 1200, 800, 4.0, 4.0, t3Mat, 'yarimada-t3');

  // C. Galata & Beyoğlu / Pera (Haliç'in Kuzeyi, Boğaz'ın Batısı)
  // 1. Kademe: Kıyı Sekisi (Karaköy, Tophane, Kasımpaşa)
  addTerrace(-500, -850, 1700, 1100, 1.2, 0.0, t1Mat, 'galata-t1');
  // 2. Kademe: Galata Yamacı (Şişhane, Kuledibi, Tünel)
  addTerrace(-550, -900, 1400, 900, 3.2, 1.2, t2Mat, 'galata-t2');
  // 3. Kademe: Pera & İstiklal Sırtı (İstiklal Caddesi, Taksim Sırtı)
  addTerrace(-500, -1000, 1100, 700, 4.5, 4.4, t3Mat, 'galata-t3');

  // D. Anadolu Yakası (Üsküdar & Kadıköy - Boğaz'ın Doğusu)
  // 1. Kademe: Kıyı Sekisi (Üsküdar Meydanı, Harem Rıhtımı, Kadıköy Çarşı)
  addTerrace(1700, 0, 1600, 2400, 1.2, 0.0, t1Mat, 'anadolu-t1');
  // 2. Kademe: Çamlıca ve Doğancılar Etekleri
  addTerrace(1900, 0, 1200, 2000, 3.5, 1.2, t2Mat, 'anadolu-t2');

  // E. Aharlı Kağıt Dış Cetvel Çerçevesi (Altın Varak Pervaz)
  const frameMat = new THREE.MeshBasicMaterial({ color: MATRAKCI_HEX.CETVEL_GOLD });
  const frameGeo = new THREE.RingGeometry(2100, 2180, 64);
  frameGeo.rotateX(-Math.PI / 2);
  const frameMesh = new THREE.Mesh(frameGeo, frameMat);
  frameMesh.position.y = 0.2;
  group.add(frameMesh);

  return { group, seaMat };
}

/**
 * 2. ProceduralTurkishHouse: Cumbalı Konut & Boğaz Yalısı
 */
export function createTurkishHouseMesh(style = 'cumba', scale = 1.0, bendStrength = 0.75) {
  const houseGroup = new THREE.Group();
  houseGroup.name = `house_${style}`;

  const isYali = style === 'yali';
  const cumbaColor = isYali ? MATRAKCI_PALETTE.ASI_BOYASI_YALI : MATRAKCI_PALETTE.TIMBER_CUMBA;

  const baseMat = getOrCreatePolyfocalMat(MATRAKCI_PALETTE.KUFEKI_STONE, MATRAKCI_PALETTE.TAHRIR_INK, bendStrength);
  const upperMat = getOrCreatePolyfocalMat(cumbaColor, MATRAKCI_PALETTE.TAHRIR_INK, bendStrength);
  const roofMat = getOrCreatePolyfocalMat(MATRAKCI_PALETTE.ZENCEFRE_ROOF, MATRAKCI_PALETTE.TAHRIR_INK, bendStrength);

  // Zemin Kat (Küfeki Taşı Kutu)
  const baseW = 4.0 * scale;
  const baseH = 2.8 * scale;
  const baseD = 4.0 * scale;
  const baseGeo = new THREE.BoxGeometry(baseW, baseH, baseD);
  const baseMesh = new THREE.Mesh(baseGeo, baseMat);
  baseMesh.position.y = baseH * 0.5;
  houseGroup.add(baseMesh);

  // Üst Kat (Cumba): %14 Sokağa Taşan Ahşap Gövde
  const cumbaW = baseW * 1.14;
  const cumbaH = 3.2 * scale;
  const cumbaD = baseD * 1.14;
  const cumbaGeo = new THREE.BoxGeometry(cumbaW, cumbaH, cumbaD);
  const cumbaMesh = new THREE.Mesh(cumbaGeo, upperMat);
  cumbaMesh.position.y = baseH + cumbaH * 0.5;
  houseGroup.add(cumbaMesh);

  // Eli Böğründe Payandalar (2 Adet Eğik Ahşap Destek)
  const strutMat = new THREE.MeshBasicMaterial({ color: MATRAKCI_HEX.TAHRIR_INK });
  for (let s = -1; s <= 1; s += 2) {
    const strutGeo = new THREE.CylinderGeometry(0.08 * scale, 0.08 * scale, 0.9 * scale);
    strutGeo.rotateZ(s * 0.45);
    const strutMesh = new THREE.Mesh(strutGeo, strutMat);
    strutMesh.position.set(s * (baseW * 0.48), baseH - 0.25 * scale, baseD * 0.52);
    houseGroup.add(strutMesh);
  }

  // Alaturka Piramidal Kırma Çatı (Zencefre Kiremit)
  const roofRadius = cumbaW * 0.72;
  const roofH = 2.2 * scale;
  const roofGeo = new THREE.ConeGeometry(roofRadius, roofH, 4);
  roofGeo.rotateY(Math.PI / 4);
  const roofMesh = new THREE.Mesh(roofGeo, roofMat);
  roofMesh.position.y = baseH + cumbaH + roofH * 0.5;
  houseGroup.add(roofMesh);

  return houseGroup;
}

/**
 * 3. MatrakciLandmark: 1.8x Ölçek Abartmalı Tarihi Nirengiler
 */
export function createLandmarkMesh(type, name, scale = 1.8, bendStrength = 0.75) {
  const group = new THREE.Group();
  group.name = `landmark_${type}`;

  const stoneMat = getOrCreatePolyfocalMat(MATRAKCI_PALETTE.KUFEKI_STONE, MATRAKCI_PALETTE.TAHRIR_INK, bendStrength);
  const leadMat = getOrCreatePolyfocalMat(MATRAKCI_PALETTE.LEAD_DOME, MATRAKCI_PALETTE.TAHRIR_INK, bendStrength);
  const goldMat = new THREE.MeshBasicMaterial({ color: MATRAKCI_HEX.CETVEL_GOLD });

  if (type === 'galata') {
    // GALATA KULESİ
    const r = 4.2 * scale;
    const bodyH = 18.0 * scale;
    const bodyGeo = new THREE.CylinderGeometry(r * 0.92, r, bodyH, 16);
    const bodyMesh = new THREE.Mesh(bodyGeo, stoneMat);
    bodyMesh.position.y = bodyH * 0.5;
    group.add(bodyMesh);

    const galleryGeo = new THREE.CylinderGeometry(r * 1.08, r * 1.08, 1.8 * scale, 16);
    const galleryMesh = new THREE.Mesh(galleryGeo, stoneMat);
    galleryMesh.position.y = bodyH + 0.9 * scale;
    group.add(galleryMesh);

    const coneH = 9.5 * scale;
    const coneGeo = new THREE.ConeGeometry(r * 1.05, coneH, 16);
    const coneMesh = new THREE.Mesh(coneGeo, leadMat);
    coneMesh.position.y = bodyH + 1.8 * scale + coneH * 0.5;
    group.add(coneMesh);

    const finialGeo = new THREE.SphereGeometry(0.6 * scale, 8, 8);
    const finialMesh = new THREE.Mesh(finialGeo, goldMat);
    finialMesh.position.y = bodyH + 1.8 * scale + coneH + 0.6 * scale;
    group.add(finialMesh);
  } else if (type === 'mosque') {
    // SELATİN CAMİİ
    const w = 14.0 * scale;
    const h = 8.5 * scale;
    const harimGeo = new THREE.BoxGeometry(w, h, w);
    const harimMesh = new THREE.Mesh(harimGeo, stoneMat);
    harimMesh.position.y = h * 0.5;
    group.add(harimMesh);

    const domeR = 5.8 * scale;
    const domeGeo = new THREE.SphereGeometry(domeR, 16, 12, 0, Math.PI * 2, 0, Math.PI * 0.5);
    const domeMesh = new THREE.Mesh(domeGeo, leadMat);
    domeMesh.position.y = h;
    group.add(domeMesh);

    const alemGeo = new THREE.CylinderGeometry(0.12 * scale, 0.12 * scale, 1.8 * scale);
    const alemMesh = new THREE.Mesh(alemGeo, goldMat);
    alemMesh.position.y = h + domeR + 0.9 * scale;
    group.add(alemMesh);

    const minR = 0.55 * scale;
    const minH = 22.0 * scale;
    const offsets = [
      [-w * 0.46, -w * 0.46],
      [w * 0.46, -w * 0.46],
      [-w * 0.46, w * 0.46],
      [w * 0.46, w * 0.46],
    ];

    offsets.forEach(([ox, oz]) => {
      const mGeo = new THREE.CylinderGeometry(minR * 0.85, minR, minH, 10);
      const mMesh = new THREE.Mesh(mGeo, stoneMat);
      mMesh.position.set(ox, minH * 0.5, oz);
      group.add(mMesh);

      const sGeo = new THREE.CylinderGeometry(minR * 1.4, minR, minR * 1.1, 8);
      const sMesh = new THREE.Mesh(sGeo, stoneMat);
      sMesh.position.set(ox, minH * 0.72, oz);
      group.add(sMesh);

      const capH = 4.2 * scale;
      const capGeo = new THREE.ConeGeometry(minR * 0.95, capH, 10);
      const capMesh = new THREE.Mesh(capGeo, leadMat);
      capMesh.position.set(ox, minH + capH * 0.5, oz);
      group.add(capMesh);
    });
  } else if (type === 'kervansaray_depot') {
    // KERVANSARAY DEPOCU (3L-CVRP Lojistik Merkezi)
    const size = 18.0 * scale;
    const wallH = 4.8 * scale;
    const thick = 3.2 * scale;

    const wingNorth = new THREE.Mesh(new THREE.BoxGeometry(size, wallH, thick), stoneMat);
    wingNorth.position.set(0, wallH * 0.5, -size * 0.5 + thick * 0.5);
    const wingSouth = new THREE.Mesh(new THREE.BoxGeometry(size, wallH, thick), stoneMat);
    wingSouth.position.set(0, wallH * 0.5, size * 0.5 - thick * 0.5);
    const wingWest = new THREE.Mesh(new THREE.BoxGeometry(thick, wallH, size - thick * 2), stoneMat);
    wingWest.position.set(-size * 0.5 + thick * 0.5, wallH * 0.5, 0);
    const wingEast = new THREE.Mesh(new THREE.BoxGeometry(thick, wallH, size - thick * 2), stoneMat);
    wingEast.position.set(size * 0.5 - thick * 0.5, wallH * 0.5, 0);
    group.add(wingNorth, wingSouth, wingWest, wingEast);

    for (let k = -1; k <= 1; k++) {
      const qDome = new THREE.Mesh(new THREE.SphereGeometry(1.2 * scale, 8, 8, 0, Math.PI * 2, 0, Math.PI * 0.5), leadMat);
      qDome.position.set(k * 4.5 * scale, wallH, -size * 0.5 + thick * 0.5);
      group.add(qDome);
    }

    const poleGeo = new THREE.CylinderGeometry(0.15 * scale, 0.15 * scale, 12 * scale);
    const poleMesh = new THREE.Mesh(poleGeo, goldMat);
    poleMesh.position.y = 6 * scale;
    group.add(poleMesh);

    const flagGeo = new THREE.PlaneGeometry(2.8 * scale, 1.6 * scale);
    flagGeo.rotateY(Math.PI / 4);
    const flagMat = new THREE.MeshBasicMaterial({ color: MATRAKCI_HEX.CETVEL_GOLD, side: THREE.DoubleSide });
    const flagMesh = new THREE.Mesh(flagGeo, flagMat);
    flagMesh.position.set(1.4 * scale, 11 * scale, 0);
    group.add(flagMesh);
  }

  // Minyatür Kitâbe Etiketi
  const tagCanvas = document.createElement('canvas');
  tagCanvas.width = 384;
  tagCanvas.height = 80;
  const ctx = tagCanvas.getContext('2d');
  ctx.fillStyle = 'rgba(242, 232, 213, 0.94)';
  if (ctx.roundRect) ctx.roundRect(6, 6, 372, 68, 12); else ctx.rect(6, 6, 372, 68);
  ctx.fill();
  ctx.strokeStyle = '#D4AF37';
  ctx.lineWidth = 3;
  ctx.stroke();
  ctx.fillStyle = '#1B3B6F';
  ctx.font = 'bold 22px "Cinzel", "Times New Roman", serif';
  ctx.textAlign = 'center';
  ctx.fillText(name, 192, 46);

  const tagTexture = new THREE.CanvasTexture(tagCanvas);
  const tagMat = new THREE.SpriteMaterial({ map: tagTexture, transparent: true });
  const tagSprite = new THREE.Sprite(tagMat);
  tagSprite.scale.set(32 * scale, 7 * scale, 1);
  tagSprite.position.y = 28 * scale;
  group.add(tagSprite);

  return group;
}

/**
 * 4. OttomanFlora: Selvi Ağaçları ve Boğaz Erguvanları
 */
export function createFloraMesh(type = 'cypress', scale = 1.0) {
  const group = new THREE.Group();
  group.name = `flora_${type}`;

  if (type === 'cypress') {
    const trunkMat = new THREE.MeshBasicMaterial({ color: 0x4a3525 });
    const trunkMesh = new THREE.Mesh(new THREE.CylinderGeometry(0.12 * scale, 0.18 * scale, 1.2 * scale), trunkMat);
    trunkMesh.position.y = 0.6 * scale;
    group.add(trunkMesh);

    const foliageMat = new THREE.MeshBasicMaterial({ color: MATRAKCI_HEX.CYPRESS_GREEN });
    const cone1 = new THREE.Mesh(new THREE.ConeGeometry(0.85 * scale, 4.2 * scale, 8), foliageMat);
    cone1.position.y = 3.0 * scale;
    const cone2 = new THREE.Mesh(new THREE.ConeGeometry(0.65 * scale, 3.2 * scale, 8), foliageMat);
    cone2.position.y = 4.2 * scale;
    group.add(cone1, cone2);
  } else {
    const trunkMat = new THREE.MeshBasicMaterial({ color: 0x5a4232 });
    const trunkMesh = new THREE.Mesh(new THREE.CylinderGeometry(0.16 * scale, 0.22 * scale, 1.5 * scale), trunkMat);
    trunkMesh.position.y = 0.75 * scale;
    group.add(trunkMesh);

    const erguvanMat = new THREE.MeshBasicMaterial({ color: MATRAKCI_HEX.ERGUVAN_PURPLE });
    const s1 = new THREE.Mesh(new THREE.SphereGeometry(1.4 * scale, 8, 8), erguvanMat);
    s1.position.set(0, 2.5 * scale, 0);
    const s2 = new THREE.Mesh(new THREE.SphereGeometry(1.0 * scale, 8, 8), erguvanMat);
    s2.position.set(0.6 * scale, 2.8 * scale, 0.3 * scale);
    const s3 = new THREE.Mesh(new THREE.SphereGeometry(0.9 * scale, 8, 8), erguvanMat);
    s3.position.set(-0.5 * scale, 2.6 * scale, -0.4 * scale);
    group.add(s1, s2, s3);
  }

  return group;
}

/**
 * 5. Prosedürel Araç Kapsülleri (SUMO VRP Kuryesi, İETT Otobüsü, Şehir Arabası, Boğaz Vapuru)
 */
export function createVehicleCapsuleMesh(type) {
  const group = new THREE.Group();
  group.name = `veh_${type}`;

  if (type === 'vrp_van') {
    const bodyMat = new THREE.MeshBasicMaterial({ color: MATRAKCI_HEX.CETVEL_GOLD });
    const bodyMesh = new THREE.Mesh(new THREE.BoxGeometry(2.0, 1.5, 4.2), bodyMat);
    bodyMesh.position.y = 0.85;
    group.add(bodyMesh);

    const roofMat = new THREE.MeshBasicMaterial({ color: MATRAKCI_HEX.JENGAR_TURQUOISE });
    const roofMesh = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.3, 3.8), roofMat);
    roofMesh.position.y = 1.7;
    group.add(roofMesh);

    const wheelMat = new THREE.MeshBasicMaterial({ color: MATRAKCI_HEX.TAHRIR_INK });
    for (const wx of [-1.05, 1.05]) {
      for (const wz of [-1.3, 1.3]) {
        const wMesh = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.35, 0.2, 8).rotateZ(Math.PI / 2), wheelMat);
        wMesh.position.set(wx, 0.35, wz);
        group.add(wMesh);
      }
    }
  } else if (type === 'iett_bus') {
    const busMat = new THREE.MeshBasicMaterial({ color: MATRAKCI_HEX.ZENCEFRE_ROOF });
    const busMesh = new THREE.Mesh(new THREE.BoxGeometry(2.4, 2.2, 8.5), busMat);
    busMesh.position.y = 1.3;
    group.add(busMesh);

    const roofMat = new THREE.MeshBasicMaterial({ color: MATRAKCI_HEX.FOAM_CREAM });
    const roofMesh = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.25, 8.2), roofMat);
    roofMesh.position.y = 2.5;
    group.add(roofMesh);
  } else if (type === 'bosphorus_ferry') {
    const hullMat = new THREE.MeshBasicMaterial({ color: MATRAKCI_HEX.FOAM_CREAM });
    const hullMesh = new THREE.Mesh(new THREE.BoxGeometry(4.8, 2.2, 16.0), hullMat);
    hullMesh.position.y = 0.8;
    group.add(hullMesh);

    const stripeMat = new THREE.MeshBasicMaterial({ color: MATRAKCI_HEX.JENGAR_TURQUOISE });
    const stripeMesh = new THREE.Mesh(new THREE.BoxGeometry(5.0, 0.4, 15.8), stripeMat);
    stripeMesh.position.y = 1.6;
    group.add(stripeMesh);

    const cabinMat = new THREE.MeshBasicMaterial({ color: MATRAKCI_HEX.TIMBER_CUMBA });
    const cabinMesh = new THREE.Mesh(new THREE.BoxGeometry(3.6, 1.8, 8.0), cabinMat);
    cabinMesh.position.y = 2.6;
    group.add(cabinMesh);

    const pipeMat = new THREE.MeshBasicMaterial({ color: MATRAKCI_HEX.TAHRIR_INK });
    const pipeMesh = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, 2.8, 8), pipeMat);
    pipeMesh.position.set(0, 4.4, -1.0);
    group.add(pipeMesh);
  } else {
    const carMat = new THREE.MeshBasicMaterial({ color: MATRAKCI_HEX.KUFEKI_STONE });
    const carMesh = new THREE.Mesh(new THREE.BoxGeometry(1.8, 1.2, 3.4), carMat);
    carMesh.position.y = 0.7;
    group.add(carMesh);
  }

  return group;
}
