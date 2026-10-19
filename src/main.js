// Procedural Istanbul client: streams the compiled city and renders it, under a free camera.
//
// URL parameters: ?area=tokyo  ?time=18.5 (Tokyo hour; default: now)  ?night=1  ?cam=x,z,distance,azimuthDeg,elevationDeg  ?radius=3000  ?whole=1 (every tile at once)  ?traffic=0  ?ortho=0  ?clouds=0.25 (on, with that cover)  ?birds=150  ?cars=600
import * as THREE from 'three';
import { MapControls } from 'three/addons/controls/MapControls.js';
import GUI from 'lil-gui';
import { makeProjection } from './shared/geo.js';
import { createMaterials, shared } from './world/materials.js';
import { loadTextures } from './world/textures.js';
import { Streamer } from './world/streamer.js';
import { Props } from './world/props.js';
import { Signs } from './world/signs.js';
import { buildRailways } from './world/rails.js';
import { buildFlyovers, JUNCTION_PARAMS } from './world/flyovers.js';
import { Traffic, MAX_CARS } from './world/traffic.js';
import { buildStructures } from './world/structures.js';
import { loadOrtho } from './world/ortho.js';
import { Environment } from './world/environment.js';
import { Atmosphere } from './world/atmosphere.js';
import { createBirds, MAX_BIRDS } from './world/birds.js';
import { loadBackdrop } from './world/backdrop.js';
import { WaterMirror } from './world/mirror.js';
import { LampLight, installLampLight } from './world/lamplight.js';
import { TransitSystem } from './world/transit.js';
import { LivingVRPManager } from './world/vrp.js';
import { AgenticOrchestrator } from './world/agentic.js';
import { NaturalIncidentEngine, findNearestLandmark } from './world/nlp_incident.js';
import { GeoTwinUI } from './world/ui.js';
import { H3UberGridLayer } from './world/h3UberGrid.js';
import { OdFlowArcsLayer } from './world/odFlowArcsLayer.js';
import { InverseOdSolver } from './world/inverseOdSolver.js';
import { initIstanbul36TazGrid } from './world/h3HexTazEngine.js';
import { RoadHeatmapLayer } from './world/roadHeatmapLayer.js';
import { TrafficAnalyticsDashboard } from './world/trafficAnalyticsDashboard.js';
import { HexOdAnalyticsDrawer } from './world/hexOdAnalyticsDrawer.js';

function createLandmarkTag(text, subtext) {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 128;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = 'rgba(11, 15, 24, 0.88)';
  if (ctx.roundRect) ctx.roundRect(10, 10, 492, 108, 18); else ctx.rect(10, 10, 492, 108);
  ctx.fill();
  ctx.strokeStyle = '#38bdf8';
  ctx.lineWidth = 4;
  ctx.stroke();
  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 36px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(text, 256, 56);
  ctx.fillStyle = '#94a3b8';
  ctx.font = '22px system-ui, sans-serif';
  ctx.fillText(subtext, 256, 94);
  const texture = new THREE.CanvasTexture(canvas);
  texture.magFilter = THREE.LinearFilter;
  const mat = new THREE.SpriteMaterial({ map: texture, transparent: true });
  const sprite = new THREE.Sprite(mat);
  sprite.scale.set(70, 17.5, 1);
  return sprite;
}

installLampLight(); // (before any material is compiled)

const params = new URLSearchParams(location.search);
// the area asked for, else the first one compiled (tiles/areas.json, which compile.mjs keeps): asking for an area that
// was never compiled would read the dev server's HTML fallback as the manifest
const AREA = params.get('area') || (await fetch('tiles/areas.json').then((r) => (r.ok ? r.json() : null)).catch(() => null))?.[0]?.id || 'koridor';

// The loading screen (index.html): the city's name, a bar and what is being done.
const loader = {
  el: document.getElementById('loader'),
  show(city, step = '') { this.el.classList.remove('done'); if (city) this.el.querySelector('.city').textContent = city; this.set(0, step); },
  set(fraction, step) { this.el.querySelector('.fill').style.width = `${Math.round(fraction * 100)}%`; if (step != null) this.el.querySelector('.step').textContent = step; },
  hide() { this.el.classList.add('done'); },
};
loader.show(null, 'textures'); // (index.html has already written the city's name)
let loading = true;
const USAGE = {
  401: 'office', 402: 'commercial', 403: 'hotel', 404: 'commercial complex', 411: 'house', 412: 'apartments',
  413: 'house + shop', 414: 'apartments + shop', 415: 'house + workshop', 421: 'government', 422: 'school / hospital / culture',
  431: 'transport / warehouse', 441: 'factory', 452: 'utility', 454: 'other', 461: 'unknown',
};

// ---------------------------------------------------------------- renderer, scene, camera
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
// (1.5 at most: on a Retina screen 2x quadruples the fragment work for little visible gain)
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
renderer.setSize(innerWidth, innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.shadowMap.enabled = true;
renderer.info.autoReset = false; // the composer renders several passes; count the whole frame
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(55, innerWidth / innerHeight, 1, 60000);
const controls = new MapControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.12;
controls.maxPolarAngle = THREE.MathUtils.degToRad(88);
controls.minDistance = 8;
controls.maxDistance = 3500;
controls.enableZoom = false; // the wheel is handled below, with inertia

const env = new Environment(scene, renderer);
// Time of day, as Istanbul's clock (UTC + 3 h): the real time, or an hour set by hand.
const clockTime = {
  live: params.get('time') == null && params.get('night') !== '1',
  hour: params.get('time') != null ? Number(params.get('time')) : params.get('night') === '1' ? 22 : 12,
  // the moment on today's Istanbul date at which its clock shows `hour`
  date() {
    const UTC3 = 3 * 3600e3, now = Date.now();
    if (this.live) { const t = new Date(now + UTC3); this.hour = t.getUTCHours() + t.getUTCMinutes() / 60 + t.getUTCSeconds() / 3600; return new Date(now); }
    const midnight = Math.floor((now + UTC3) / 864e5) * 864e5 - UTC3;
    return new Date(midnight + this.hour * 3600e3);
  },
  // the hour and the minute on their own, for the panel; setting either stops the live clock
  get h() { return Math.floor(this.hour) % 24; },
  set h(v) { this.live = false; this.hour = v + this.m / 60; },
  get m() { return Math.floor((this.hour % 1) * 60 + 1e-6); },
  set m(v) { this.live = false; this.hour = this.h + v / 60; },
  label() { const h = this.h, m = this.m; return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`; },
};

const materials = createMaterials(await loadTextures(renderer));
const props = new Props();
const signs = new Signs();
const defaultRadius = 900; // (metres around the point looked at; the panel can ask for more, or the whole city)
const streamer = new Streamer(scene, materials, props, signs, { base: `tiles/${AREA}`, radius: Number(params.get('radius')) || defaultRadius }); // (progressive by default: the control panel can ask for the whole city)
loader.set(0.08, 'terrain');
const manifest = await streamer.init();
loader.set(0.14, 'railways and roads');
const proj = makeProjection(manifest.origin.lon, manifest.origin.lat);
// Beyond the area: plain ground in the grey of the area's own unbuilt land, out to the haze of the horizon.
{
  const b = manifest.bounds, plain = new THREE.Mesh(new THREE.CircleGeometry(50000, 64).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0x8a8a86, roughness: 0.95, metalness: 0 }));
  plain.position.set((b.minX + b.maxX) / 2, manifest.terrain.min - 1, (b.minZ + b.maxZ) / 2); // just under the lowest ground
  plain.receiveShadow = true;
  plain.name = 'plain';
  scene.add(plain);
  // an area with the land around it (mountains on the horizon): the plain becomes the sea, at sea level
  if (manifest.backdrop) {
    plain.position.y = -0.5; plain.material.color.set(0x2c4a5e); plain.material.roughness = 0.35;
    loadBackdrop(`tiles/${AREA}`, `ortho/${AREA}/backdrop`, manifest, proj, renderer).then((mesh) => scene.add(mesh));
  }
}
const birds = createBirds();
birds.geometry.instanceCount = params.get('birds') != null ? Math.min(MAX_BIRDS, Number(params.get('birds')) || 0) : 0;
scene.add(birds);
const lampLight = new LampLight(renderer);
const waterMirror = new WaterMirror(renderer);
// post-processing: ambient occlusion, sky, aerial perspective, volumetric clouds, bloom, tone mapping
const atmosphere = new Atmosphere(renderer, scene, camera, manifest.origin, manifest.bounds);
env.sky.visible = false; // the atmosphere draws the sky (the environment map keeps its own)
const ao = atmosphere.ao;
if (params.get('reflect') === '0') atmosphere.reflect = false;
if (Number(params.get('clouds')) > 0) { atmosphere.coverage = Number(params.get('clouds')); atmosphere.cloudsOn = true; }
let orthoLoaded = false, orthoWanted = true; // (the photo fills in when the tiles arrive; the panel may have switched it off by then)
if (params.get('ortho') !== '0') loadOrtho(`ortho/${AREA}`, proj, manifest.bounds, renderer).then((ok) => { orthoLoaded = ok; shared.uOrthoOn.value = ok && orthoWanted ? 1 : 0; });
const railways = await buildRailways(`tiles/${AREA}/${manifest.rails}`, (x, z) => streamer.ground(x, z), streamer.cover);
scene.add(railways);
scene.add(await buildFlyovers(`tiles/${AREA}/${manifest.roads}`, (x, z) => streamer.ground(x, z)));
if (manifest.structures) scene.add(await buildStructures(`tiles/${AREA}/${manifest.structures}`, (x, z) => streamer.ground(x, z)));
const traffic = new Traffic(await (await fetch(`tiles/${AREA}/${manifest.roads}`)).json(), streamer.surface);
if (params.get('cars') != null) traffic.count = Math.min(MAX_CARS, Number(params.get('cars')) || 0);
if (params.get('traffic') !== '0') scene.add(traffic.group);
const transit = new TransitSystem(scene, proj, streamer.surface);
const vrpManager = new LivingVRPManager(scene, traffic, streamer.surface, proj);
const agentic = new AgenticOrchestrator(traffic, transit, vrpManager);
const naturalIncident = new NaturalIncidentEngine(scene, traffic, transit, vrpManager, agentic, proj, streamer.surface);

// Floating Holographic Landmark Tags for Istanbul Corridor
const landmarks = [
  { name: '🏢 Zorlu Center', sub: 'Zincirlikuyu Karma Yaşam & Kültür', lon: 29.0170, lat: 41.0665, h: 80 },
  { name: '🏢 Cevahir AVM', sub: 'Şişli - Mecidiyeköy', lon: 28.9930, lat: 41.0630, h: 65 },
  { name: '🏢 Kanyon & Özdilek', sub: 'Levent Finans Bölgesi', lon: 29.0115, lat: 41.0775, h: 85 },
  { name: '🏢 Torun Center', sub: 'Ali Sami Yen Meydanı', lon: 28.9995, lat: 41.0660, h: 95 },
  { name: '🌉 15 Temmuz Şehitler Köprüsü', sub: 'Boğaziçi Otoyol Bağlantısı', lon: 29.0250, lat: 41.0685, h: 55 },
];
const landmarksGroup = new THREE.Group();
landmarksGroup.name = 'landmarks';
for (const lm of landmarks) {
  const [x, z] = proj.project(lm.lon, lm.lat);
  const sprite = createLandmarkTag(lm.name, lm.sub);
  sprite.position.set(x, streamer.ground(x, z) + lm.h, z);
  landmarksGroup.add(sprite);
}
scene.add(landmarksGroup);
landmarksGroup.visible = false;
const incidentTicker = document.getElementById('incident-ticker');
let tickerTimer;
transit.onIncidentChange((msg, type) => {
  if (!incidentTicker) return;
  incidentTicker.textContent = msg;
  incidentTicker.className = type;
  incidentTicker.style.display = 'flex';
  clearTimeout(tickerTimer);
  tickerTimer = setTimeout(() => { incidentTicker.style.display = 'none'; }, 9000);
});
const liveTraffic = { enabled: params.get('liveTraffic') !== '0', status: 'connecting' };
const trafficLegend = document.getElementById('traffic-legend');
trafficLegend.hidden = !liveTraffic.enabled;
let trafficPoll, ibbSegments;
const refreshLiveTraffic = async () => {
  if (!liveTraffic.enabled) {
    traffic.clearLiveTrafficIndex(); traffic.clearLiveSegmentSpeeds(); liveTraffic.status = 'off'; return;
  }
  try {
    const [indexResponse, dataResponse] = await Promise.all([
      fetch('/api/ibb-traffic-index', { cache: 'no-store' }),
      fetch('/api/ibb-segment-data', { cache: 'no-store' }),
    ]);
    if (!indexResponse.ok || !dataResponse.ok) throw new Error(`HTTP ${indexResponse.status}/${dataResponse.status}`);
    const [index, segmentData] = await Promise.all([indexResponse.json(), dataResponse.json()]);
    if (!Number.isFinite(Number(index.TI)) || !Array.isArray(segmentData.Data)) throw new Error('invalid response');
    if (!ibbSegments) {
      const response = await fetch('/api/ibb-segments', { cache: 'force-cache' });
      if (!response.ok) throw new Error(`geometry HTTP ${response.status}`);
      ibbSegments = await response.json();
      traffic.attachLiveSegments(ibbSegments, proj.project, manifest.bounds);
    }
    traffic.setLiveTrafficIndex(Number(index.TI));
    const { matched, closed } = traffic.updateLiveSegmentSpeeds(segmentData.Data);
    const timestamp = new Date(segmentData.Date);
    const estimate = traffic.estimateLocalVehicleCount(controls.target);
    liveTraffic.status = `TI ${index.TI} · ${matched} roads · ${closed} closed · ≈${estimate} cars · ${timestamp.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' })}`;
    geoTwinUI?.updateLiveStatus(`TI ${index.TI} · ${matched} Yol · ${closed} Kapalı · ${timestamp.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' })}`);
  } catch (error) {
    // Robust offline fallback: calculate realistic diurnal traffic index for Istanbul based on time of day
    const h = clockTime.hour;
    const diurnalTI = Math.round(
      h >= 7 && h <= 9.5 ? 78 + 12 * Math.sin((h - 7) * Math.PI / 2.5) :
      h >= 16.5 && h <= 19.5 ? 84 + 10 * Math.sin((h - 16.5) * Math.PI / 3) :
      h >= 10 && h <= 16 ? 56 + 8 * Math.sin((h - 10) * Math.PI / 6) :
      h >= 22 || h <= 5 ? 18 + 6 * Math.sin(h) : 45
    );
    traffic.setLiveTrafficIndex(diurnalTI);
    liveTraffic.status = `OSM Simülasyonu · %${diurnalTI} İndeks (${clockTime.label()})`;
    geoTwinUI?.updateLiveStatus(`OSM Simülasyonu · %${diurnalTI} İndeks (${clockTime.label()})`);
  }
};
if (liveTraffic.enabled) {
  refreshLiveTraffic();
  trafficPoll = setInterval(refreshLiveTraffic, 60 * 1000);
}
document.getElementById('credits').textContent = manifest.attribution.map((a) => a.split(' (')[0]).join(' · ');

// initial view: the area's own, or over its origin looking north-west (Shibuya: across the Scramble Crossing to the station)
const [cx, cz, dist, az, el] = (params.get('cam') || manifest.view || '0,0,420,215,32').split(',').map(Number);
controls.target.set(cx, streamer.ground(cx, cz), cz);
camera.position.copy(controls.target).add(new THREE.Vector3().setFromSphericalCoords(
  dist, THREE.MathUtils.degToRad(90 - el), THREE.MathUtils.degToRad(az)));
controls.update();

// ---------------------------------------------------------------- control panel
let guiState, clockText, geoTwinUI, gui;
{
  // the compiled areas (tools/pipeline/compile.mjs keeps the list); another city is another page load
  const areas = await fetch('tiles/areas.json').then((r) => (r.ok ? r.json() : null)).catch(() => null) ?? [{ id: AREA, name: manifest.name }];
  const trains = railways.userData.trains.group, AO = ao.configuration.intensity;
  const state = {
    city: AREA,
    get info() { return document.getElementById('hud').style.display !== 'none'; }, set info(v) { document.getElementById('hud').style.display = v ? '' : 'none'; },

    get traffic() { return !!traffic.group.parent; }, set traffic(v) { if (v) scene.add(traffic.group); else scene.remove(traffic.group); },
    get trains() { return trains.visible; }, set trains(v) { trains.visible = v; },
    get photo() { return orthoWanted; }, set photo(v) { orthoWanted = v; shared.uOrthoOn.value = v && orthoLoaded ? 1 : 0; },
    get shadows() { return env.sun.castShadow; }, set shadows(v) { env.sun.castShadow = v; },
    get occlusion() { return ao.configuration.intensity > 0; }, set occlusion(v) { ao.configuration.intensity = v ? AO : 0; },
    bloom: true,
    // the whole city at once, or only what lies within the view radius of the point looked at (fewer tiles: more frames)
    wholeCity: params.get('whole') === '1', near: Number(params.get('radius')) || defaultRadius,
    get whole() { return this.wholeCity; }, set whole(v) { this.wholeCity = v; streamer.radius = v ? 1e5 : this.near; },
    get radius() { return this.near; }, set radius(v) { this.near = v; if (!this.wholeCity) streamer.radius = v; },
  };
  guiState = state;
  if (state.wholeCity) streamer.radius = 1e5;
  // the names of the cities, for the loading screen of the next visit (index.html reads them)
  try { for (const a of areas) localStorage.setItem(`procedural-istanbul:name:${a.id}`, a.name); } catch { /* storage unavailable */ }
  gui = new GUI({ title: 'Settings' });
  gui.close(); // (out of the way until it is asked for)
  gui.add(state, 'city', Object.fromEntries(areas.map((a) => [a.name, a.id]))).onChange((id) => {
    const url = new URL(location.href);
    url.search = '';
    url.searchParams.set('area', id);
    loader.show(areas.find((a) => a.id === id)?.name ?? id, 'leaving for the next city');
    setTimeout(() => { location.href = url.href; }, 60); // (let the screen appear first)
  });
  const time = gui.addFolder('Time (Istanbul)');
  time.add(clockTime, 'live').name('live clock').listen();
  // one slider over the day, with the clock time written beside it in place of the number box
  const slider = time.add(clockTime, 'hour', 0, 24, 1 / 60).name('time').listen().onChange(() => { clockTime.live = false; });
  slider.$input.style.display = 'none';
  clockText = document.createElement('span');
  clockText.style.cssText = 'min-width: 3.4em; padding-left: 8px; text-align: right; font-variant-numeric: tabular-nums;';
  slider.$widget.appendChild(clockText);
  gui.add(state, 'traffic');
  const liveFolder = gui.addFolder('Live traffic (IBB)');
  liveFolder.add(liveTraffic, 'enabled').name('live index').onChange((enabled) => {
    trafficLegend.hidden = !enabled;
    if (trafficPoll) clearInterval(trafficPoll);
    if (enabled) {
      refreshLiveTraffic();
      trafficPoll = setInterval(refreshLiveTraffic, 60 * 1000);
    } else refreshLiveTraffic();
  });
  liveFolder.add(liveTraffic, 'status').name('index · updated').listen().disable();

  const incidentFolder = gui.addFolder('Kriz & Olay Simülatörü');
  const incidentActions = {
    köprü_kaza: () => transit.triggerIncident('bridge-closure', traffic),
    metrobüs_arıza: () => transit.triggerIncident('metrobus-jam', traffic),
    gayrettepe_metro: () => transit.triggerIncident('metro-breakdown', traffic),
    levent_yol_çalışması: () => transit.triggerIncident('levent-work', traffic),
    sıfırla: () => {
      transit.resolveIncident('bridge-closure', traffic);
      transit.resolveIncident('metrobus-jam', traffic);
      transit.resolveIncident('metro-breakdown', traffic);
      transit.resolveIncident('levent-work', traffic);
    },
  };
  incidentFolder.add(incidentActions, 'köprü_kaza').name('🚨 Köprü Bağlantı Kazası');
  incidentFolder.add(incidentActions, 'metrobüs_arıza').name('🚌 Mecidiyeköy Metrobüs Arızası');
  incidentFolder.add(incidentActions, 'gayrettepe_metro').name('🚇 Gayrettepe Metro Arızası');
  incidentFolder.add(incidentActions, 'levent_yol_çalışması').name('🚧 Büyükdere Cad. Çalışması');
  incidentFolder.add(incidentActions, 'sıfırla').name('✅ Olayları Temizle / Aç');

  const agenticFolder = gui.addFolder('Geo-Twin Agentic AI & VRP');
  const agenticControls = {
    hud: true,
    vrpRoutes: true,
    landmarks: true,
    whatIfBenchmark: () => transit.triggerIncident('bridge-closure', traffic),
  };
  agenticFolder.add(agenticControls, 'hud').name('Agentic AI Komuta Paneli').onChange((v) => agentic.toggleVisibility(v));
  agenticFolder.add(agenticControls, 'vrpRoutes').name('VRP Neon Filo Rotaları').onChange((v) => vrpManager.setRoutesVisible(v));
  agenticFolder.add(agenticControls, 'landmarks').name('3B Şehir Etiketleri').onChange((v) => { landmarksGroup.visible = v; });
  agenticFolder.add(agenticControls, 'whatIfBenchmark').name('⚡ 10x What-If Kaza Testi');

  gui.add(traffic, 'count', 0, MAX_CARS, 10).name('vehicle cap');
  gui.add(traffic, 'highway', 0, 20, 0.5).name('highway traffic');
  gui.add(traffic, 'headlights', 0, 20, 0.5).name('car headlights');
  gui.add(props, 'streetLights', 0, 3, 0.05).name('street lights');
  gui.add(props, 'parkLights', 0, 3, 0.05).name('park lights');
  gui.add(state, 'trains');
  gui.add(state, 'photo').name('aerial photo').listen();
  gui.add(birds.geometry, 'instanceCount', 0, MAX_BIRDS, 10).name('birds');
  gui.add(state, 'info').name('info panel');
  const sky = gui.addFolder('Clouds');
  sky.add(atmosphere, 'cloudsOn').name('clouds');
  sky.add(atmosphere, 'coverage', 0, 1, 0.05);
  sky.add(atmosphere, 'base', 200, 2000, 50).name('base altitude (m)');
  sky.add(atmosphere, 'overCity').name('over the city only');
  sky.add(atmosphere, 'quality', ['low', 'medium', 'high', 'ultra']);
  sky.add(atmosphere.clouds.localWeatherVelocity, 'x', 0, 0.02, 0.0005).name('wind');
  const rooms = gui.addFolder('Night windows');
  rooms.add(shared.uWindowLife.value, 'x', 0, 1, 0.05).name('rooms that change');
  rooms.add(shared.uWindowLife.value, 'y', 0.2, 30, 0.1).name('pace');
  rooms.add(shared.uCityGlass, 'value', 0, 3, 0.05).name('city in tower glass');
  rooms.add(shared.uNightBlue, 'value', 0, 1, 0.05).name('blue lights');
  const walls = gui.addFolder('Wall photos');
  walls.add(shared.uPhotoMix, 'value', 0, 1, 0.05).name('amount');
  walls.add(shared.uPhotoRange.value, 'x', 0, 1000, 10).name('from (m)');
  walls.add(shared.uPhotoRange.value, 'y', 10, 2000, 10).name('full at (m)');
  const quality = gui.addFolder('Rendering');
  quality.add(state, 'whole').name('whole city');
  quality.add(state, 'radius', 300, 3000, 50).name('view radius (m), if not');
  quality.add(atmosphere, 'reflect').name('window and water reflections');
  quality.add(shared.uGlintOn, 'value', 0, 1, 1).name('sun in the windows');
  quality.add(state, 'shadows');
  quality.add(state, 'occlusion').name('ambient occlusion');
  quality.add(state, 'bloom');

  // The panel's settings are kept (in this browser) and are the same for every city: what is switched off in
  // one is off in the next. A URL that sets something itself (?time=, ?cars=, ...) is taken as it stands.
  const KEY = 'procedural-istanbul:settings:5'; // (a new number when the defaults change: what was kept before is left behind)
  const explicit = [...params.keys()].some((k) => k !== 'area');
  const strip = (saved) => { delete saved.controllers?.city; return saved; }; // (the city is the page's, not a setting)
  if (!explicit) {
    try {
      const saved = JSON.parse(localStorage.getItem(KEY) ?? 'null');
      if (saved) {
        gui.load(strip(saved));
        // (loading the time moved the slider, which stops the live clock: put the saved choice back)
        const live = saved.folders?.['Time (Istanbul)']?.controllers?.['live clock'];
        if (live != null) clockTime.live = live;
      }
    } catch (e) { console.warn('settings not restored:', e.message); }
  }
  const keep = () => { try { localStorage.setItem(KEY, JSON.stringify(strip(gui.save()))); } catch { /* storage unavailable: nothing is kept */ } };
  // (a page opened with settings in its URL is a one-off view: it does not overwrite what is kept)
  if (!explicit) { gui.onFinishChange(keep); addEventListener('pagehide', keep); }
}

// ---------------------------------------------------------------- H3 TAZ & Traffic Analytics Engine
let h3GridLayer;
let odFlowArcsLayer;
let roadHeatmapLayer;
let trafficAnalyticsDashboard;
let hexOdAnalyticsDrawer;

odFlowArcsLayer = new OdFlowArcsLayer({ scene, proj, streamer });
roadHeatmapLayer = new RoadHeatmapLayer({ scene, traffic, streamer });

h3GridLayer = new H3UberGridLayer({
  scene,
  proj,
  streamer,
  onSelectHex: (cell) => {
    if (cell && h3GridLayer.visible) {
      const dir = hexOdAnalyticsDrawer ? hexOdAnalyticsDrawer.flowDirection : 'outflow';
      odFlowArcsLayer.updateArcs(currentOdSolution.corridors, cell.id, dir, tazLookup);
      odFlowArcsLayer.setVisible(true);
      if (hexOdAnalyticsDrawer) {
        hexOdAnalyticsDrawer.open(cell, currentOdSolution.corridors, currentOdSolution.gehReport);
      }
    } else {
      odFlowArcsLayer.setVisible(false);
      if (hexOdAnalyticsDrawer) {
        hexOdAnalyticsDrawer.close();
      }
    }
  },
});

const odSolver = new InverseOdSolver(h3GridLayer.hexCells);
let currentOdSolution = odSolver.solveInverseOdMatrix(clockTime.hour);
const tazLookup = new Map(h3GridLayer.hexCells.map((c) => [c.id, c]));

hexOdAnalyticsDrawer = new HexOdAnalyticsDrawer({
  onTimeFilterChange: (mode) => {
    // Mode: 'live', '24h', '7d'
  },
  onHourChange: (hour) => {
    clockTime.live = false;
    clockTime.hour = hour;
    currentOdSolution = odSolver.solveInverseOdMatrix(hour, trafficAnalyticsDashboard?.scenario);
    if (h3GridLayer.selectedHexId) {
      odFlowArcsLayer.updateArcs(currentOdSolution.corridors, h3GridLayer.selectedHexId, hexOdAnalyticsDrawer.flowDirection, tazLookup);
    }
    hexOdAnalyticsDrawer.updateData(h3GridLayer.selectedHex, currentOdSolution.corridors, currentOdSolution.gehReport);
  },
  onFlowDirectionChange: (dir) => {
    if (h3GridLayer.selectedHexId) {
      odFlowArcsLayer.updateArcs(currentOdSolution.corridors, h3GridLayer.selectedHexId, dir, tazLookup);
    }
    hexOdAnalyticsDrawer.updateData(h3GridLayer.selectedHex, currentOdSolution.corridors, currentOdSolution.gehReport);
  },
  onCorridorClick: (corridor) => {
    const targetId = hexOdAnalyticsDrawer.flowDirection === 'outflow' ? corridor.destId : corridor.originId;
    const targetHex = tazLookup.get(targetId);
    if (targetHex && controls) {
      controls.target.set(targetHex.cx, streamer.ground(targetHex.cx, targetHex.cz), targetHex.cz);
      controls.update();
    }
  },
  onTriggerChaos: () => {
    transit.triggerIncident('bridge-closure', traffic);
    if (roadHeatmapLayer) roadHeatmapLayer.updateColors(true);
  },
});

let isRoutePinPicking = false;
let routePinStep = 0;
let tempRoutePointA = null;

trafficAnalyticsDashboard = new TrafficAnalyticsDashboard({
  h3GridLayer,
  roadHeatmapLayer,
  odArcsLayer: odFlowArcsLayer,
  traffic,
  controls,
  camera,
  streamer,
  proj,
  scene,
  onStartPinPicking: () => {
    isRoutePinPicking = true;
    routePinStep = 0;
    tempRoutePointA = null;
    const banner = document.getElementById('pin-instruction-banner');
    if (banner) {
      const pText = banner.querySelector('.p-text');
      if (pText) pText.textContent = '📍 [1/2] Başlangıç Noktası (A) için haritaya tıklayın...';
      banner.style.display = 'flex';
    }
  },
  onWeatherActuate: (weather, directives) => {
    if (weather === 'heavy_rain') {
      atmosphere.cloudsOn = true;
      atmosphere.coverage = 0.95;
      scene.fog = new THREE.FogExp2(0x1e293b, 0.0012);
    } else if (weather === 'heavy_snow') {
      atmosphere.cloudsOn = true;
      atmosphere.coverage = 0.98;
      scene.fog = new THREE.FogExp2(0xe2e8f0, 0.0016);
    } else if (weather === 'dense_fog') {
      atmosphere.cloudsOn = true;
      atmosphere.coverage = 0.85;
      scene.fog = new THREE.FogExp2(0x94a3b8, 0.0035);
    } else {
      scene.fog = null;
      atmosphere.coverage = 0.25;
    }
    currentOdSolution = odSolver.solveInverseOdMatrix(trafficAnalyticsDashboard.selectedHour, trafficAnalyticsDashboard.scenario);
    if (h3GridLayer.selectedHexId) {
      odFlowArcsLayer.updateArcs(currentOdSolution.corridors, h3GridLayer.selectedHexId, hexOdAnalyticsDrawer.flowDirection, tazLookup);
      hexOdAnalyticsDrawer.updateData(h3GridLayer.selectedHex, currentOdSolution.corridors, currentOdSolution.gehReport);
    }
  },
});

let isPinPicking = false;
geoTwinUI = new GeoTwinUI({
  transit,
  traffic,
  vrpManager,
  agentic,
  naturalIncident,
  clockTime,
  controls,
  camera,
  streamer,
  landmarksGroup,
  proj,
  state: guiState,
  gui,
  onTogglePinMode: (active) => {
    isPinPicking = active;
  },
  onToggleH3Taz: (forceVal) => {
    const vis = typeof forceVal === 'boolean' ? (h3GridLayer.setVisible(forceVal), forceVal) : h3GridLayer.toggleVisible();
    if (!vis) {
      odFlowArcsLayer.setVisible(false);
      if (hexOdAnalyticsDrawer) hexOdAnalyticsDrawer.close();
    }
    return vis;
  },
  onOpenOdDrawer: () => {
    const cell = h3GridLayer.selectedHex || h3GridLayer.hexCells[0];
    if (hexOdAnalyticsDrawer) {
      hexOdAnalyticsDrawer.toggle(cell, currentOdSolution.corridors, currentOdSolution.gehReport);
      if (hexOdAnalyticsDrawer.isOpen && !h3GridLayer.visible) {
        h3GridLayer.setVisible(true);
      }
    }
  },
  onSelectHexMetric: (metric) => {
    h3GridLayer.setMetric(metric);
  },
  onOpenAnalyticsDashboard: () => {
    trafficAnalyticsDashboard.toggle();
  },
  onToggleRoadHeatmap: (v) => {
    roadHeatmapLayer.setVisible(v);
  },
  onToggleOdArcs: (v) => {
    odFlowArcsLayer.setVisible(v);
  },
  onToggleRouteRibbon: (v) => {
    trafficAnalyticsDashboard.router.setVisible(v);
  },
});


// ---------------------------------------------------------------- input
const keys = new Set();
const MOVE_KEYS = new Set(['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']);
addEventListener('keydown', (e) => {
  const el = document.activeElement, typing = el?.tagName === 'INPUT' || el?.tagName === 'TEXTAREA';
  if (typing) return; // a number being typed into the panel
  // A panel control that was clicked keeps the keyboard: the arrow keys would then step its slider or its
  // city list instead of moving the view. Movement keys always belong to the scene.
  if (MOVE_KEYS.has(e.code)) { e.preventDefault(); if (el && el !== document.body) el.blur(); }
  if (e.code === 'KeyN') { clockTime.live = false; clockTime.hour = env.dark > 0.5 ? 12 : 22; } // noon <-> night
  keys.add(e.code);
}, { capture: true });
addEventListener('keyup', (e) => keys.delete(e.code));
addEventListener('blur', () => keys.clear());

// WASD / arrows move the focus point over the ground; speed scales with the camera distance.
function keyboardPan(dt) {
  const f = (keys.has('KeyW') || keys.has('ArrowUp') ? 1 : 0) - (keys.has('KeyS') || keys.has('ArrowDown') ? 1 : 0);
  const r = (keys.has('KeyD') || keys.has('ArrowRight') ? 1 : 0) - (keys.has('KeyA') || keys.has('ArrowLeft') ? 1 : 0);
  if (!f && !r) return;
  const fwd = new THREE.Vector3().subVectors(controls.target, camera.position).setY(0).normalize();
  const right = new THREE.Vector3().crossVectors(fwd, THREE.Object3D.DEFAULT_UP);
  const speed = Math.max(20, camera.position.distanceTo(controls.target)) * (keys.has('ShiftLeft') || keys.has('ShiftRight') ? 2.5 : 0.9);
  const move = fwd.multiplyScalar(f).addScaledVector(right, r).normalize().multiplyScalar(speed * dt);
  controls.target.add(move);
  camera.position.add(move);
}

// Wheel zoom with inertia: each notch adds to a pending amount that is paid out over the next frames,
// towards the point of the ground under the cursor.
const zoom = { pending: 0, pivot: new THREE.Vector3(), ray: new THREE.Raycaster(), plane: new THREE.Plane() };
renderer.domElement.addEventListener('wheel', (e) => {
  e.preventDefault();
  const notches = (e.deltaMode === 1 ? e.deltaY * 33 : e.deltaMode === 2 ? e.deltaY * 800 : e.deltaY) / 100;
  zoom.pending = THREE.MathUtils.clamp(zoom.pending + notches * 0.16, -1.6, 1.6);
  zoom.ray.setFromCamera(new THREE.Vector2((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1), camera);
  zoom.plane.set(THREE.Object3D.DEFAULT_UP, -controls.target.y);
  const hit = zoom.ray.ray.intersectPlane(zoom.plane, new THREE.Vector3());
  // looking at the sky, or at ground far beyond the view: zoom on the focus point instead
  zoom.pivot.copy(hit && hit.distanceTo(controls.target) < camera.position.distanceTo(controls.target) * 3 ? hit : controls.target);
}, { passive: false });
function wheelZoom(dt) {
  if (Math.abs(zoom.pending) < 1e-4) { zoom.pending = 0; return; }
  const step = zoom.pending * (1 - Math.exp(-dt * 9));
  zoom.pending -= step;
  const dist = camera.position.distanceTo(controls.target), scale = THREE.MathUtils.clamp(Math.exp(step), controls.minDistance / dist, controls.maxDistance / dist);
  camera.position.sub(zoom.pivot).multiplyScalar(scale).add(zoom.pivot);
  controls.target.sub(zoom.pivot).multiplyScalar(scale).add(zoom.pivot);
}

// Click a building to inspect it.
let picked = null;
const raycaster = new THREE.Raycaster();
let downAt = null;
renderer.domElement.addEventListener('pointerdown', (e) => { downAt = [e.clientX, e.clientY]; });
renderer.domElement.addEventListener('pointerup', (e) => {
  if (!downAt || Math.hypot(e.clientX - downAt[0], e.clientY - downAt[1]) > 4) return;
  raycaster.setFromCamera(new THREE.Vector2((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1), camera);

  // If in Route Pin Dropper Mode (A -> B Point Selection)
  if (isRoutePinPicking) {
    const hits = raycaster.intersectObjects(scene.children, true);
    const hit = hits.find((h) => h.point && h.object.type === 'Mesh' && h.object.name !== 'natural-incidents');
    if (hit) {
      const { x, y, z } = hit.point;
      const [lon, lat] = proj.unproject(x, z);
      const landmark = findNearestLandmark(lon, lat);
      const ptName = landmark ? landmark.name : `${lat.toFixed(4)}N, ${lon.toFixed(4)}E`;

      if (routePinStep === 0) {
        tempRoutePointA = { x, y, z, lon, lat, name: ptName };
        routePinStep = 1;
        const banner = document.getElementById('pin-instruction-banner');
        if (banner) {
          const pText = banner.querySelector('.p-text');
          if (pText) pText.textContent = `📍 [2/2] Varış Noktası (B) için haritaya tıklayın (A: ${ptName})...`;
        }
      } else {
        const tempRoutePointB = { x, y, z, lon, lat, name: ptName };
        isRoutePinPicking = false;
        routePinStep = 0;
        const banner = document.getElementById('pin-instruction-banner');
        if (banner) banner.style.display = 'none';
        trafficAnalyticsDashboard.setCustomRoute(tempRoutePointA, tempRoutePointB);
      }
      return;
    }
  }

  // If in Map Pin Dropper Mode
  if (isPinPicking) {
    const hits = raycaster.intersectObjects(scene.children, true);
    const hit = hits.find((h) => h.point && h.object.type === 'Mesh' && h.object.name !== 'natural-incidents');
    if (hit) {
      const { x, y, z } = hit.point;
      const [lon, lat] = proj.unproject(x, z);
      const landmark = findNearestLandmark(lon, lat);
      geoTwinUI.handleMapPinSelected({ x, y, z, lon, lat, name: landmark ? landmark.name : null });
      return;
    }
  }

  // Check H3 Hexagon TAZ Click
  const hitHexId = h3GridLayer ? h3GridLayer.raycast(raycaster) : null;
  if (hitHexId) {
    h3GridLayer.selectHex(hitHexId);
    return;
  }

  const hit = raycaster.intersectObjects(scene.children, true).find((h) => h.object.userData.facade);
  picked = hit ? streamer.buildingAt(hit) : null;
});

// Interactive Cursor Hover Tooltip for H3 TAZ (Kepler.gl / Deck.gl standard)
const hoverRaycaster = new THREE.Raycaster();
renderer.domElement.addEventListener('pointermove', (e) => {
  if (h3GridLayer && h3GridLayer.visible) {
    hoverRaycaster.setFromCamera(
      new THREE.Vector2((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1),
      camera
    );
    const hoveredHexId = h3GridLayer.raycast(hoverRaycaster);
    h3GridLayer.setHovered(hoveredHexId, e.clientX, e.clientY);
  }
});

function fitViewport() {
  if (!innerWidth || !innerHeight) return; // (a page opened in a hidden tab or frame has no size yet)
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
  atmosphere.setSize(innerWidth, innerHeight);
}
addEventListener('resize', fitViewport);
// a page loaded while hidden gets its size later, not always with a resize event: watch the page itself
new ResizeObserver(fitViewport).observe(document.documentElement);

// ---------------------------------------------------------------- loop
const hud = document.getElementById('hud');
const clock = new THREE.Clock();
let frames = 0, fpsTime = 0, fps = 0;

// one frame: everything that moves, then the picture
function tick() {
  const dt = Math.min(clock.getDelta(), 0.1);
  renderer.info.reset();
  keyboardPan(dt);
  wheelZoom(dt);
  controls.update();

  // keep the focus on the ground and the camera above it
  controls.target.y = Math.max(0, streamer.ground(controls.target.x, controls.target.z));
  const floor = Math.max(0, streamer.ground(camera.position.x, camera.position.z)) + 2;
  if (camera.position.y < floor) camera.position.y = floor;

  streamer.update(controls.target, camera.position);

  // the loading screen stays until the tiles around the view are in
  if (loading) {
    const size = manifest.tileSize, wanted = manifest.tiles.filter((t) => Math.hypot((t.x + 0.5) * size - controls.target.x, (t.z + 0.5) * size - controls.target.z) <= Math.min(streamer.radius, 900)).length || 1;
    const got = Math.min(1, streamer.stats.loaded / wanted);
    loader.set(0.2 + 0.8 * got, `city tiles ${streamer.stats.loaded} / ${manifest.tiles.length}`);
    if (got >= 1) { loading = false; loader.hide(); }
  }

  props.update(dt);
  if (birds.geometry.instanceCount) birds.userData.update(dt, controls.target, camera, streamer);
  signs.update();
  railways.userData.trains.update(dt, env.night);
  if (traffic.group.parent) traffic.update(dt, controls.target);
  transit.update(dt, shared.uTime.value);
  vrpManager.update(dt);
  naturalIncident.update(shared.uTime.value);
  if (odFlowArcsLayer) odFlowArcsLayer.update(dt);
  if (h3GridLayer) h3GridLayer.update(dt);
  if (roadHeatmapLayer) roadHeatmapLayer.update(dt, agentic?.whatIfActive);
  if (trafficAnalyticsDashboard?.router) trafficAnalyticsDashboard.router.update(dt);
  env.setSky(...Object.values(atmosphere.setDate(clockTime.date())));
  clockText.textContent = clockTime.label();
  env.update(dt);
  env.follow(controls.target, camera);
  lampLight.update(scene, controls.target, camera.position, env.night);
  atmosphere.bloom.intensity = guiState.bloom ? env.bloom * 3 : 0;
  waterMirror.enabled = atmosphere.reflect;
  waterMirror.update(scene, camera, streamer.tiles, controls.target, [traffic.group.parent ? null : traffic.group]);
  atmosphere.render(dt);

  frames++; fpsTime += dt;
  if (fpsTime >= 0.5) {
    fps = frames / fpsTime;
    frames = 0;
    fpsTime = 0;
    geoTwinUI?.updateMetrics(fps, renderer.info.render, streamer.stats.loaded, manifest.tiles.length);
  }
  const s = streamer.stats, info = renderer.info.render;
  const [lon, lat] = proj.unproject(controls.target.x, controls.target.z);
  hud.textContent =
    `${manifest.name}  ${lat.toFixed(5)}N ${lon.toFixed(5)}E  ${controls.target.y.toFixed(1)} m\n` +
    `Istanbul ${clockTime.label()}${clockTime.live ? ' (live)' : ''} · sun ${env.elevation.toFixed(0)}°\n` +
    `${fps.toFixed(0)} fps · ${info.calls} draws · ${(info.triangles / 1e6).toFixed(2)}M tris\n` +
    `tiles ${s.loaded}/${manifest.tiles.length}${streamer.pending ? ` (+${streamer.pending})` : ''} · ${s.buildings} buildings\n` +
    (picked ? `\n▸ ${USAGE[picked.usage] ?? 'usage ' + picked.usage}, ${picked.height.toFixed(1)} m` +
      `${picked.storeys ? `, ${picked.storeys} floors` : ''}, base ${picked.base.toFixed(1)} m\n` : '') +
    `\ndrag pan · right-drag rotate · wheel zoom\nWASD move (shift fast) · N day/night · click building`;
}
function frame() { tick(); requestAnimationFrame(frame); }
requestAnimationFrame(frame);

// (for the console and for tools: tick() draws a frame by hand, clockTime sets the hour)
window.__app = { scene, camera, controls, streamer, env, renderer, materials, ao, atmosphere, traffic, transit, vrpManager, agentic, naturalIncident, geoTwinUI, h3GridLayer, odFlowArcsLayer, odSolver, roadHeatmapLayer, trafficAnalyticsDashboard, hexOdAnalyticsDrawer, shared, tick, clockTime, JUNCTION_PARAMS };

