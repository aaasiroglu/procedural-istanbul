// Natural Language & Map Pin Incident Ingestion Engine for Istanbul Geo-Twin
// Supports Gemini API (Flash/Pro) + Offline Local NLP fallback + 3D Map Pinning
import * as THREE from 'three';

// Key Corridor Landmark Coordinates for Grounding & Geocoding
export const KNOWN_LOCATIONS = {
  'özdilek': { name: 'ÖzdilekPark AVM', lon: 29.0115, lat: 41.0775, type: 'mall' },
  'ozdilek': { name: 'ÖzdilekPark AVM', lon: 29.0115, lat: 41.0775, type: 'mall' },
  'kanyon': { name: 'Kanyon AVM', lon: 29.0105, lat: 41.0782, type: 'mall' },
  'zorlu': { name: 'Zorlu Center', lon: 29.0170, lat: 41.0665, type: 'mall' },
  'cevahir': { name: 'Cevahir AVM', lon: 28.9930, lat: 41.0630, type: 'mall' },
  'torun': { name: 'Torun Center', lon: 28.9995, lat: 41.0660, type: 'plaza' },
  'sapphire': { name: 'Istanbul Sapphire', lon: 29.0068, lat: 41.0850, type: 'tower' },
  'zincirlikuyu': { name: 'Zincirlikuyu Kavşağı & Metrobüs', lon: 29.0175, lat: 41.0683, type: 'junction' },
  'mecidiyeköy': { name: 'Mecidiyeköy Meydanı & Viyadüğü', lon: 28.9950, lat: 41.0664, type: 'viaduct' },
  'mecidiyekoy': { name: 'Mecidiyeköy Meydanı & Viyadüğü', lon: 28.9950, lat: 41.0664, type: 'viaduct' },
  'gayrettepe': { name: 'Gayrettepe Metro İstasyonu', lon: 29.0118, lat: 41.0694, type: 'metro' },
  'levent': { name: 'Levent Büyükdere Caddesi', lon: 29.0135, lat: 41.0772, type: 'arterial' },
  'köprü': { name: '15 Temmuz Şehitler Köprüsü Katılımı', lon: 29.0270, lat: 41.0686, type: 'highway' },
  'kopru': { name: '15 Temmuz Şehitler Köprüsü Katılımı', lon: 29.0270, lat: 41.0686, type: 'highway' },
  'büyükdere': { name: 'Büyükdere Caddesi', lon: 29.0080, lat: 41.0730, type: 'arterial' },
  'buyukdere': { name: 'Büyükdere Caddesi', lon: 29.0080, lat: 41.0730, type: 'arterial' },
  'şişli': { name: 'Şişli Halaskargazi', lon: 28.9890, lat: 41.0600, type: 'district' },
  'sisli': { name: 'Şişli Halaskargazi', lon: 28.9890, lat: 41.0600, type: 'district' },
};

export function findNearestLandmark(lon, lat) {
  let closest = null;
  let minDist = Infinity;
  for (const [key, data] of Object.entries(KNOWN_LOCATIONS)) {
    const d = Math.hypot(data.lon - lon, data.lat - lat);
    if (d < minDist) {
      minDist = d;
      closest = data;
    }
  }
  if (minDist <= 0.008) {
    return closest;
  }
  return null;
}

export class NaturalIncidentEngine {
  constructor(scene, traffic, transit, vrpManager, agentic, proj, surface) {
    this.scene = scene;
    this.traffic = traffic;
    this.transit = transit;
    this.vrpManager = vrpManager;
    this.agentic = agentic;
    this.proj = proj;
    this.surface = surface;

    this.group = new THREE.Group();
    this.group.name = 'natural-incidents';
    this.scene.add(this.group);

    this.activeIncidents = [];
    this.apiKey = localStorage.getItem('geotwin:gemini_key') || '';

    this.onIncidentAdded = null;
    this.onIncidentRemoved = null;
    this.onIncidentCleared = null;
  }

  setApiKey(key) {
    this.apiKey = (key || '').trim();
    localStorage.setItem('geotwin:gemini_key', this.apiKey);
  }

  getApiKey() {
    return this.apiKey;
  }

  // Parse an incident using Gemini API if available, else local intelligent fuzzy parser
  async processIncidentInput(userText, overrideCoords = null) {
    let parsed = null;

    if (this.apiKey) {
      try {
        parsed = await this.queryGemini(userText, overrideCoords);
      } catch (err) {
        console.warn('Gemini API call failed, falling back to local NLP engine:', err.message);
        parsed = this.localNLPParser(userText, overrideCoords);
      }
    } else {
      parsed = this.localNLPParser(userText, overrideCoords);
    }

    if (parsed) {
      this.applyIncidentToDigitalTwin(parsed);
    }
    return parsed;
  }

  async queryGemini(text, overrideCoords) {
    const prompt = `Kullanıcı bildirimi: "${text}".
Koordinat biliniyorsa: ${overrideCoords ? JSON.stringify(overrideCoords) : 'Bilinmiyor, metinden çıkar'}.
İstanbul Maslak - Levent - Mecidiyeköy - Çağlayan - Beşiktaş - 15 Temmuz Şehitler Köprüsü koridoru sınırlarında (Lon: 28.975..29.048, Lat: 41.038..41.118) bir akıllı şehir olayı olarak analiz et ve SADECE aşağıdaki JSON şemasına uygun yanıt ver:
{
  "locationName": "string",
  "incidentType": "fire" | "accident" | "flood" | "breakdown" | "roadwork" | "hazard",
  "severity": "critical" | "high" | "medium",
  "coordinates": { "lon": float, "lat": float },
  "radiusMeters": integer,
  "vehiclesInvolved": integer,
  "lanesBlocked": integer,
  "publicAnnouncement": "string",
  "actionRecommended": "string",
  "estimatedDelayMinutes": integer
}`;

    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${this.apiKey}`;
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0.1,
          responseMimeType: 'application/json',
        },
      }),
    });

    if (!response.ok) {
      throw new Error(`Gemini HTTP ${response.status}`);
    }

    const data = await response.json();
    const candidate = data.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!candidate) throw new Error('Empty Gemini response');

    const result = JSON.parse(candidate);
    if (overrideCoords) {
      result.coordinates = overrideCoords;
    }
    return result;
  }

  localNLPParser(text, overrideCoords) {
    const lower = text.toLowerCase();

    // 1. Detect Incident Type
    let incidentType = 'accident';
    if (lower.includes('yangın') || lower.includes('ateş') || lower.includes('duman') || lower.includes('patlama')) {
      incidentType = 'fire';
    } else if (lower.includes('sel') || lower.includes('su') || lower.includes('baskın') || lower.includes('yağmur') || lower.includes('mazgal')) {
      incidentType = 'flood';
    } else if (lower.includes('arıza') || lower.includes('bozuldu') || lower.includes('kaldı') || lower.includes('elektrik')) {
      incidentType = 'breakdown';
    } else if (lower.includes('çalışma') || lower.includes('asfalt') || lower.includes('kazı') || lower.includes('tadilat')) {
      incidentType = 'roadwork';
    } else {
      incidentType = 'accident';
    }

    // 2. Detect Severity & Vehicles
    const vehiclesMatch = lower.match(/(\d+)\s*(araç|araba|kamyon|kaza)/);
    const vehiclesInvolved = vehiclesMatch ? parseInt(vehiclesMatch[1], 10) : (incidentType === 'accident' ? 2 : 0);
    const severity = incidentType === 'fire' || vehiclesInvolved >= 3 ? 'critical' : 'high';

    // 3. Detect Location
    let loc = null;
    let locationName = 'İstanbul Koridoru';
    if (overrideCoords) {
      loc = overrideCoords;
      locationName = overrideCoords.name || `${loc.lat.toFixed(4)}N, ${loc.lon.toFixed(4)}E`;
    } else {
      for (const [key, data] of Object.entries(KNOWN_LOCATIONS)) {
        if (lower.includes(key)) {
          loc = { lon: data.lon, lat: data.lat };
          locationName = data.name;
          break;
        }
      }
    }

    if (!loc) {
      // Default to Mecidiyeköy junction if no location detected
      loc = { lon: 28.9950, lat: 41.0664 };
      locationName = 'Mecidiyeköy Koridoru';
    }

    const titles = {
      fire: 'Yangın Alarmı',
      accident: 'Trafik Kazası',
      flood: 'Su Baskını & Göllenme',
      breakdown: 'Toplu Taşıma / Araç Arızası',
      roadwork: 'Altyapı & Şerit Çalışması',
      hazard: 'Acil Durum Bildirimi',
    };

    return {
      locationName,
      incidentType,
      severity,
      coordinates: loc,
      radiusMeters: incidentType === 'fire' ? 220 : 160,
      vehiclesInvolved,
      lanesBlocked: incidentType === 'fire' ? 3 : Math.min(2, Math.max(1, vehiclesInvolved)),
      publicAnnouncement: `🚨 TKM Acil: ${locationName} mevkiinde ${titles[incidentType] || 'olay'}! Ekipler sevk edildi, çevre şeritlerde yoğunluk oluştu.`,
      actionRecommended: 'GFlowNet tahliye rotaları aktif, alternatif arterlere yönlendirme yapıldı.',
      estimatedDelayMinutes: incidentType === 'fire' ? 35 : 22,
    };
  }

  applyIncidentToDigitalTwin(incident) {
    const { coordinates, incidentType, radiusMeters, publicAnnouncement, locationName } = incident;
    const [x, z] = this.proj.project(coordinates.lon, coordinates.lat);
    const y = this.surface(x, z);

    // 1. Create Dramatic 3D Emergency Beacon in the Scene
    const beacon = this.createIncident3DVisual(x, y, z, incidentType, radiusMeters, locationName);
    this.group.add(beacon);

    // 2. Choke & Adapt Local Traffic Within Radius
    let affectedLanes = 0;
    for (const lane of this.traffic.graph.lanes) {
      const mid = lane.pts[lane.pts.length >> 1];
      const dist = Math.hypot(mid.x - x, mid.z - z);
      if (dist <= radiusMeters) {
        lane.edge.closed = true;
        lane.edge.liveClass = 5; // Burgundy/Dark Red Jam
        lane.edge.liveSpeedKph = 3;
        lane.liveSpeed = 3 / 3.6;
        affectedLanes++;
      } else if (dist <= radiusMeters * 2.2) {
        lane.edge.liveClass = 4; // Red Slowdown
        lane.edge.liveSpeedKph = 12;
        lane.liveSpeed = 12 / 3.6;
      }
    }
    this.traffic.updateTrafficOverlay();

    // 3. Notify Transit & Agentic AI
    this.transit.notify(publicAnnouncement, incident.severity === 'critical' ? 'danger' : 'warning');
    if (this.agentic) {
      this.agentic.runIncidentPipeline(publicAnnouncement);
    }

    // 4. Trigger VRP Dynamic Rerouting
    if (this.vrpManager) {
      this.vrpManager.checkAndRepairRoutes();
    }

    const item = { incident, beacon, affectedLanes, timestamp: Date.now() };
    this.activeIncidents.push(item);
    if (this.onIncidentAdded) {
      this.onIncidentAdded(item);
    }
    return item;
  }

  createIncident3DVisual(x, y, z, type, radius, labelText) {
    const root = new THREE.Group();
    root.position.set(x, y, z);

    // Color by incident type
    const colors = {
      fire: 0xff3b30,
      accident: 0xff9500,
      flood: 0x007aff,
      breakdown: 0xaf52de,
      roadwork: 0xffcc00,
    };
    const col = colors[type] || 0xff3b30;

    // 1. Pulsing Ground Hazard Zone Ring
    const zoneGeo = new THREE.RingGeometry(radius * 0.85, radius, 48);
    zoneGeo.rotateX(-Math.PI / 2);
    const zoneMat = new THREE.MeshBasicMaterial({
      color: col,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.65,
    });
    const zone = new THREE.Mesh(zoneGeo, zoneMat);
    zone.position.y = 0.5;
    root.add(zone);

    // 2. Vertical Emergency Column / Light Beam
    const beamGeo = new THREE.CylinderGeometry(1.8, 4.5, 90, 16);
    const beamMat = new THREE.MeshBasicMaterial({
      color: col,
      transparent: true,
      opacity: 0.45,
      blending: THREE.AdditiveBlending,
    });
    const beam = new THREE.Mesh(beamGeo, beamMat);
    beam.position.y = 45;
    root.add(beam);

    // 3. Floating 3D Emergency Badge Sprite
    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 160;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = 'rgba(15, 23, 42, 0.92)';
    if (ctx.roundRect) ctx.roundRect(10, 10, 492, 140, 24); else ctx.rect(10, 10, 492, 140);
    ctx.fill();
    ctx.strokeStyle = '#ef4444';
    ctx.lineWidth = 6;
    ctx.stroke();

    const icon = type === 'fire' ? '🔥' : type === 'accident' ? '💥' : type === 'flood' ? '🌊' : '⚠️';
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 36px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(`${icon} ACİL DURUM BİLDİRİMİ`, 256, 62);

    ctx.fillStyle = '#fca5a5';
    ctx.font = '24px system-ui, sans-serif';
    ctx.fillText(labelText.slice(0, 32), 256, 110);

    const texture = new THREE.CanvasTexture(canvas);
    const spriteMat = new THREE.SpriteMaterial({ map: texture, transparent: true });
    const sprite = new THREE.Sprite(spriteMat);
    sprite.scale.set(75, 23.4, 1);
    sprite.position.y = 75;
    root.add(sprite);

    root.userData = { zone, zoneMat, beam, beamMat, col };
    return root;
  }

  removeIncident(item) {
    const idx = this.activeIncidents.indexOf(item);
    if (idx !== -1) {
      this.group.remove(item.beacon);
      this.activeIncidents.splice(idx, 1);
      if (this.activeIncidents.length === 0) {
        this.clearAllIncidents();
      } else {
        // Reset and re-apply closures for remaining incidents
        for (const lane of this.traffic.graph.lanes) {
          lane.edge.closed = false;
          lane.edge.liveClass = null;
          lane.edge.liveSpeedKph = null;
          lane.liveSpeed = null;
        }
        for (const rem of this.activeIncidents) {
          const [rx, rz] = this.proj.project(rem.incident.coordinates.lon, rem.incident.coordinates.lat);
          for (const lane of this.traffic.graph.lanes) {
            const mid = lane.pts[lane.pts.length >> 1];
            const dist = Math.hypot(mid.x - rx, mid.z - rz);
            if (dist <= rem.incident.radiusMeters) {
              lane.edge.closed = true;
              lane.edge.liveClass = 5;
              lane.edge.liveSpeedKph = 3;
              lane.liveSpeed = 3 / 3.6;
            }
          }
        }
        this.traffic.updateTrafficOverlay();
      }
      if (this.onIncidentRemoved) this.onIncidentRemoved(item);
    }
  }

  clearAllIncidents() {
    for (const item of this.activeIncidents) {
      this.group.remove(item.beacon);
    }
    this.activeIncidents = [];

    // Reset traffic closures
    for (const lane of this.traffic.graph.lanes) {
      lane.edge.closed = false;
      lane.edge.liveClass = null;
      lane.edge.liveSpeedKph = null;
      lane.liveSpeed = null;
    }
    this.traffic.updateTrafficOverlay();

    if (this.agentic) {
      this.agentic.resolveIncidentPipeline();
    }
    if (this.onIncidentCleared) {
      this.onIncidentCleared();
    }
    this.transit.notify('✅ Tüm acil durum bildirimleri temizlendi, trafik normale döndü.', 'success');
  }

  update(time) {
    for (const item of this.activeIncidents) {
      const { zoneMat, beamMat } = item.beacon.userData;
      if (zoneMat) {
        zoneMat.opacity = 0.4 + Math.sin(time * 4) * 0.3;
      }
      if (beamMat) {
        beamMat.opacity = 0.3 + Math.sin(time * 3) * 0.2;
      }
    }
  }
}
