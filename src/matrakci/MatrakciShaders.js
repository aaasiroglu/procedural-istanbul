// Matrakçı-Twin Özel GLSL Shader Sistemi (Düzeltilmiş Polifokal Projeksiyon, Cel-Shading, Minyatür Denizi ve Altın VRP Rotaları)
import * as THREE from 'three';
import { MATRAKCI_PALETTE } from './matrakciPalette.js';

/**
 * 1. Matrakçı Polifokal Bina ve Mimari Shader Malzemesi
 * Dünya koordinatında kameraya doğru bükülme, dünya-uzayı tahrir is mürekkebi konturu ve 4-seviyeli cel-shading.
 */
export function createPolyfocalBuildingMaterial(
  baseColorHex = MATRAKCI_PALETTE.TIMBER_CUMBA,
  inkColorHex = MATRAKCI_PALETTE.TAHRIR_INK,
  bendStrength = 0.75
) {
  const baseColor = new THREE.Color(baseColorHex);
  const inkColor = new THREE.Color(inkColorHex);

  const vertexShader = `
    uniform float uBendStrength;
    uniform vec3 uCameraDirXZ;
    varying vec3 vWorldNormal;
    varying vec3 vWorldPos;
    varying float vLocalY;

    void main() {
      vLocalY = position.y;
      // Dünya uzayında normal vektörü
      vWorldNormal = normalize(mat3(modelMatrix) * normal);

      vec4 worldPosition = modelMatrix * vec4(position, 1.0);

      // Matrakçı Polifokal Bükülme: Taban sabit kalır, yükseklik arttıkça kameraya doğru eğilir
      float bendFactor = max(0.0, position.y) * 0.12 * uBendStrength;
      worldPosition.xz += uCameraDirXZ.xz * bendFactor;

      vWorldPos = worldPosition.xyz;
      gl_Position = projectionMatrix * viewMatrix * worldPosition;
    }
  `;

  const fragmentShader = `
    precision highp float;

    uniform vec3 uBaseColor;
    uniform vec3 uInkColor;
    varying vec3 vWorldNormal;
    varying vec3 vWorldPos;
    varying float vLocalY;

    // Aharlı parşömen gürültü fonksiyonu
    float hash(vec2 p) {
      return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
    }

    void main() {
      vec3 norm = normalize(vWorldNormal);

      // 1. Tahrir Çizgisi: Dünya uzayında kenar normallerinde (|N · V| < 0.25) is mürekkebi konturu
      vec3 viewDir = normalize(cameraPosition - vWorldPos);
      float edgeVal = abs(dot(norm, viewDir));
      if (edgeVal < 0.22) {
        gl_FragColor = vec4(uInkColor, 1.0);
        return;
      }

      // 2. Nakkaşhane Işık Modeli: Dünya uzayında sıcak kandil/güneş ışığı
      vec3 lightDir = normalize(vec3(0.40, 0.85, 0.35));
      float nDotL = max(0.0, dot(norm, lightDir));

      // 4-Basamaklı Cel-Shading
      float cel = 0.42;
      if (nDotL > 0.72) cel = 1.0;
      else if (nDotL > 0.42) cel = 0.80;
      else if (nDotL > 0.18) cel = 0.60;

      // Aharlı kağıt mikro gren dokusu
      float paperGrain = (hash(vWorldPos.xz * 1.5) - 0.5) * 0.06;

      vec3 finalColor = uBaseColor * (cel + paperGrain);
      gl_FragColor = vec4(finalColor, 1.0);
    }
  `;

  return new THREE.ShaderMaterial({
    vertexShader,
    fragmentShader,
    uniforms: {
      uBaseColor: { value: baseColor },
      uInkColor: { value: inkColor },
      uBendStrength: { value: bendStrength },
      uCameraDirXZ: { value: new THREE.Vector3(0, 0, 1) },
    },
    side: THREE.DoubleSide,
  });
}

/**
 * 2. Osmanlı Minyatür Denizi Shader Malzemesi (Boğaziçi ve Haliç)
 * Yumuşak helezon dalgalar, kıyı köpüğü ve tahrir dalga çizgileri.
 */
export function createOttomanSeaShaderMaterial() {
  const jengarColor = new THREE.Color(MATRAKCI_PALETTE.JENGAR_TURQUOISE);
  const lapisColor = new THREE.Color(MATRAKCI_PALETTE.CETVEL_LAPIS);
  const foamColor = new THREE.Color(MATRAKCI_PALETTE.FOAM_CREAM);
  const inkColor = new THREE.Color(MATRAKCI_PALETTE.TAHRIR_INK);

  const vertexShader = `
    varying vec2 vUv;
    varying vec3 vWorldPos;

    void main() {
      vUv = uv;
      vec4 worldPosition = modelMatrix * vec4(position, 1.0);
      vWorldPos = worldPosition.xyz;
      gl_Position = projectionMatrix * viewMatrix * worldPosition;
    }
  `;

  const fragmentShader = `
    precision highp float;

    uniform float uTime;
    uniform vec3 uJengar;
    uniform vec3 uLapis;
    uniform vec3 uFoam;
    uniform vec3 uInk;
    varying vec2 vUv;
    varying vec3 vWorldPos;

    void main() {
      // Yumuşak ölçekli minyatür dalga koordinatları (moiré önleyici)
      vec2 st = vWorldPos.xz * 0.009;

      // Balık pulu / helezonik dalga deseni
      float wave1 = sin(st.x * 3.14 + uTime * 0.6) * cos(st.y * 3.14 - uTime * 0.4);
      float wave2 = sin((st.x + st.y) * 2.2 - uTime * 0.5);

      // Deniz derinlik gradyanı (Jengar Turkuazı -> Lâciverd)
      float depthGrad = clamp((vWorldPos.x + 800.0) / 2400.0, 0.0, 1.0);
      vec3 waterColor = mix(uJengar, uLapis, depthGrad + wave1 * 0.12);

      // Dalga tepelerinde helezonik köpük halkaları (Foam Cream)
      float foamPattern = smoothstep(0.55, 0.88, wave1 * 0.6 + wave2 * 0.4);

      // İs mürekkebi dalga sınır çizgisi
      float waveEdge = smoothstep(0.47, 0.51, wave1 * 0.6 + wave2 * 0.4) - smoothstep(0.51, 0.55, wave1 * 0.6 + wave2 * 0.4);

      vec3 finalColor = mix(waterColor, uFoam, foamPattern * 0.65);
      finalColor = mix(finalColor, uInk, clamp(waveEdge * 0.35, 0.0, 1.0));

      gl_FragColor = vec4(finalColor, 0.96);
    }
  `;

  return new THREE.ShaderMaterial({
    vertexShader,
    fragmentShader,
    uniforms: {
      uTime: { value: 0.0 },
      uJengar: { value: jengarColor },
      uLapis: { value: lapisColor },
      uFoam: { value: foamColor },
      uInk: { value: inkColor },
    },
    transparent: true,
    side: THREE.DoubleSide,
  });
}

/**
 * 3. Varak Altın ve Lâciverd VRP Rota Shader Malzemesi (Umdetü'l-Hisâb x 3L-CVRP)
 */
export function createGoldVrpRouteShaderMaterial(isOptimal = true, variance = 0.12) {
  const goldColor = new THREE.Color(MATRAKCI_PALETTE.CETVEL_GOLD);
  const lapisColor = new THREE.Color(MATRAKCI_PALETTE.CETVEL_LAPIS);
  const coralColor = new THREE.Color(MATRAKCI_PALETTE.STOCHASTIC_CORAL);
  const inkColor = new THREE.Color(MATRAKCI_PALETTE.TAHRIR_INK);

  const vertexShader = `
    varying vec2 vUv;
    varying vec3 vWorldPos;

    void main() {
      vUv = uv;
      vec4 worldPosition = modelMatrix * vec4(position, 1.0);
      vWorldPos = worldPosition.xyz;
      gl_Position = projectionMatrix * viewMatrix * worldPosition;
    }
  `;

  const fragmentShader = `
    precision highp float;

    uniform float uTime;
    uniform float uVariance;
    uniform float uIsOptimal;
    uniform vec3 uGold;
    uniform vec3 uLapis;
    uniform vec3 uCoral;
    uniform vec3 uInk;
    varying vec2 vUv;
    varying vec3 vWorldPos;

    void main() {
      float edgeDist = min(vUv.y, 1.0 - vUv.y);

      // 1. Çift sıra Lâciverd Cetvel (Dış Çerçeve Sınırları)
      if (edgeDist < 0.10) {
        gl_FragColor = vec4(uLapis, 1.0);
        return;
      }
      if (edgeDist < 0.13) {
        gl_FragColor = vec4(uInk, 1.0); // Tahrir ayrımı
        return;
      }

      // 2. Ezme Varak Altın İç Şerit
      float pulse = smoothstep(0.65, 0.95, fract(vUv.x * 0.05 - uTime * 1.5));
      vec3 brightGold = mix(uGold, vec3(1.0, 0.94, 0.65), pulse * 0.85);

      vec3 coreColor = uIsOptimal > 0.5 ? brightGold : mix(uGold, vec3(0.85, 0.80, 0.70), 0.5);

      // 3. Stokastik Varyans (sigma^2) Haleleri: Kaos anında mercan bulut/alev titreşimi
      if (uVariance > 0.35) {
        float flame = sin(vUv.x * 0.2 + uTime * 4.5) * cos(vUv.y * 12.0 - uTime * 2.5);
        if (edgeDist < 0.30 && flame > 0.12) {
          float coralFactor = smoothstep(0.35, 0.85, uVariance);
          coreColor = mix(coreColor, uCoral, coralFactor * 0.90);
        }
      }

      gl_FragColor = vec4(coreColor, 1.0);
    }
  `;

  return new THREE.ShaderMaterial({
    vertexShader,
    fragmentShader,
    uniforms: {
      uTime: { value: 0.0 },
      uVariance: { value: variance },
      uIsOptimal: { value: isOptimal ? 1.0 : 0.0 },
      uGold: { value: goldColor },
      uLapis: { value: lapisColor },
      uCoral: { value: coralColor },
      uInk: { value: inkColor },
    },
    side: THREE.DoubleSide,
  });
}
