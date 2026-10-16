// Kartografik Genelleştirme ve B-Spline Motoru (Mini Motorways Akışkanlığı & Matrakçı Estetiği)
import * as THREE from 'three';

/**
 * 1. Chaikin Köşe Kesme (2 İterasyon) ve Centripetal Catmull-Rom B-Spline Yumuşatma
 * @param {Array<[number, number, number]>} rawPoints - Ham köşe koordinatları [x, y, z]
 * @param {number} samples - Eğri boyunca örnek sayısı (varsayılan: 64)
 */
export function chaikinAndSplineSmooth(rawPoints, samples = 64) {
  if (!rawPoints || rawPoints.length < 2) {
    const dummy = new THREE.Vector3(0, 0, 0);
    return {
      curve: null,
      points: [dummy],
      tangents: [new THREE.Vector3(0, 0, 1)],
      normals: [new THREE.Vector3(1, 0, 0)],
      length: 1,
    };
  }

  // Chaikin İterasyonu Fonksiyonu
  function chaikinCut(pts) {
    if (pts.length < 3) return pts;
    const res = [pts[0]]; // Başlangıç sabit
    for (let i = 0; i < pts.length - 1; i++) {
      const p0 = pts[i];
      const p1 = pts[i + 1];
      const q = [
        0.75 * p0[0] + 0.25 * p1[0],
        0.75 * p0[1] + 0.25 * p1[1],
        0.75 * p0[2] + 0.25 * p1[2],
      ];
      const r = [
        0.25 * p0[0] + 0.75 * p1[0],
        0.25 * p0[1] + 0.75 * p1[1],
        0.25 * p0[2] + 0.75 * p1[2],
      ];
      res.push(q, r);
    }
    res.push(pts[pts.length - 1]); // Bitiş sabit
    return res;
  }

  // 2 İterasyon Chaikin Köşe Kesme
  const iter1 = chaikinCut(rawPoints);
  const iter2 = chaikinCut(iter1);

  // THREE.CatmullRomCurve3 (Centripetal, alpha = 0.5 ile düğüm katlanmasını önler)
  const vectors = iter2.map((p) => new THREE.Vector3(p[0], p[1], p[2]));
  const curve = new THREE.CatmullRomCurve3(vectors, false, 'centripetal', 0.5);

  const points = [];
  const tangents = [];
  const normals = [];

  const totalLength = curve.getLength();

  for (let i = 0; i <= samples; i++) {
    const u = i / samples;
    const pt = curve.getPointAt(u);
    const tgt = curve.getTangentAt(u).normalize();

    // 2D Yatay Normal: N(u) = normalize(-T_z, 0, T_x)
    let nx = -tgt.z;
    let nz = tgt.x;
    const len = Math.hypot(nx, nz);
    if (len > 1e-6) {
      nx /= len;
      nz /= len;
    } else {
      nx = 1;
      nz = 0;
    }
    const nrm = new THREE.Vector3(nx, 0, nz);

    points.push(pt);
    tangents.push(tgt);
    normals.push(nrm);
  }

  return {
    curve,
    points,
    tangents,
    normals,
    length: Math.max(totalLength, 1),
    samples,
  };
}

/**
 * 2. SUMO Şerit ve Pozisyon Verisini 3B Minyatür B-Spline Eğrisine Eşleme
 * @param {object} curveData - chaikinAndSplineSmooth çıktısı
 * @param {number} laneIndex - Şerit indeksi (0, 1, ...)
 * @param {number} numLanes - Toplam şerit sayısı
 * @param {number} lanePos - Şerit başlangıcından itibaren metre cinsinden mesafe
 * @param {number} edgeLength - Toplam şerit uzunluğu
 * @param {number} laneWidth - Şerit genişliği (varsayılan: 2.6m)
 */
export function mapSumoToSpline3D(curveData, laneIndex, numLanes, lanePos, edgeLength, laneWidth = 2.6) {
  const u = Math.min(1, Math.max(0, lanePos / Math.max(edgeLength, 1)));
  const lateralOffset = (laneIndex - (numLanes - 1) / 2) * laneWidth;

  let centerPt, tangent, normal;
  if (curveData.curve) {
    centerPt = curveData.curve.getPointAt(u);
    tangent = curveData.curve.getTangentAt(u).normalize();
    let nx = -tangent.z;
    let nz = tangent.x;
    const len = Math.hypot(nx, nz);
    if (len > 1e-6) {
      nx /= len;
      nz /= len;
    } else {
      nx = 1;
      nz = 0;
    }
    normal = new THREE.Vector3(nx, 0, nz);
  } else {
    centerPt = new THREE.Vector3(0, 0, 0);
    tangent = new THREE.Vector3(0, 0, 1);
    normal = new THREE.Vector3(1, 0, 0);
  }

  const p3D = new THREE.Vector3(
    centerPt.x + lateralOffset * normal.x,
    centerPt.y,
    centerPt.z + lateralOffset * normal.z
  );

  // Dönüş Açısı (Yaw): theta = atan2(T_x, T_z)
  const yaw = Math.atan2(tangent.x, tangent.z);

  return {
    position: p3D,
    yaw,
    tangent,
    normal,
    u,
  };
}

/**
 * 3. B-Spline Şerit Geometrisi Üretimi (Ribbon Geometry)
 * @param {object} curveData - chaikinAndSplineSmooth çıktısı
 * @param {number} width - Yol genişliği (metre)
 * @param {number} yOffset - Zemin kaldırma miktarı (metre, z-fighting önler)
 * @param {number} waveAmplitude - Deniz/dalga için opsiyonel dikey kıvrım
 */
export function buildRibbonGeometry(curveData, width, yOffset = 0.15, waveAmplitude = 0) {
  const { points, normals, length, samples } = curveData;
  const count = points.length;

  const positions = new Float32Array(count * 2 * 3);
  const uvs = new Float32Array(count * 2 * 2);
  const vertexNormals = new Float32Array(count * 2 * 3);
  const indices = [];

  const halfW = width * 0.5;

  for (let i = 0; i < count; i++) {
    const pt = points[i];
    const nrm = normals[i];
    const u = i / samples;

    const wave = waveAmplitude > 0 ? Math.sin(u * Math.PI * 8) * waveAmplitude : 0;
    const y = pt.y + yOffset + wave;

    // Sol Kenar Köşesi: C(u) - (w/2) * N(u)
    const lx = pt.x - halfW * nrm.x;
    const lz = pt.z - halfW * nrm.z;

    // Sağ Kenar Köşesi: C(u) + (w/2) * N(u)
    const rx = pt.x + halfW * nrm.x;
    const rz = pt.z + halfW * nrm.z;

    const baseIdx = i * 2;

    // Sol köşe vertex
    positions[baseIdx * 3 + 0] = lx;
    positions[baseIdx * 3 + 1] = y;
    positions[baseIdx * 3 + 2] = lz;

    vertexNormals[baseIdx * 3 + 0] = 0;
    vertexNormals[baseIdx * 3 + 1] = 1;
    vertexNormals[baseIdx * 3 + 2] = 0;

    uvs[baseIdx * 2 + 0] = u * (length / Math.max(width, 1));
    uvs[baseIdx * 2 + 1] = 0.0;

    // Sağ köşe vertex
    positions[(baseIdx + 1) * 3 + 0] = rx;
    positions[(baseIdx + 1) * 3 + 1] = y;
    positions[(baseIdx + 1) * 3 + 2] = rz;

    vertexNormals[(baseIdx + 1) * 3 + 0] = 0;
    vertexNormals[(baseIdx + 1) * 3 + 1] = 1;
    vertexNormals[(baseIdx + 1) * 3 + 2] = 0;

    uvs[(baseIdx + 1) * 2 + 0] = u * (length / Math.max(width, 1));
    uvs[(baseIdx + 1) * 2 + 1] = 1.0;

    // İki üçgen yüzey indeksi (quad)
    if (i < count - 1) {
      const v0 = baseIdx;
      const v1 = baseIdx + 1;
      const v2 = baseIdx + 2;
      const v3 = baseIdx + 3;

      indices.push(v0, v2, v1);
      indices.push(v1, v2, v3);
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new THREE.BufferAttribute(vertexNormals, 3));
  geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeBoundingSphere();

  return geometry;
}
