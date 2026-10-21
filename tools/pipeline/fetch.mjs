// Downloads the raw data for an area into data/raw/<area>/. Cached files are skipped.
//   OpenStreetMap    roads, railways, buildings, land cover and named places (Overpass API)
//   Terrain          Mapzen Terrain Tiles (terrarium PNGs, AWS Open Data)
// Usage: node tools/pipeline/fetch.mjs [--area=koridor] [--force]
import fs from 'node:fs';
import path from 'node:path';
import { resolveArea } from './config.mjs';
import { demTileRange, DEM_SOURCES } from './terrain.mjs';

const area = resolveArea();
const FORCE = process.argv.includes('--force');
const UA = 'procedural-istanbul/0.1 (city compiler; https://github.com/aaasiroglu/procedural-istanbul)';
const OVERPASS = [
  'https://lz4.overpass-api.de/api/interpreter',
  'https://z.overpass-api.de/api/interpreter',
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
];

const t0 = Date.now();
const log = (...a) => console.log(((Date.now() - t0) / 1000).toFixed(1).padStart(6) + 's', ...a);
const exists = (f) => !FORCE && fs.existsSync(f) && fs.statSync(f).size > 0;

async function download(url, file, { retries = 3, ...init } = {}) {
  for (let attempt = 1; ; attempt++) {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(240000), ...init }); // (a server that never answers is given up on)
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const buf = Buffer.from(await res.arrayBuffer());
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file + '.part', buf);
      fs.renameSync(file + '.part', file);
      return buf;
    } catch (e) {
      if (attempt >= retries) throw new Error(`${url}: ${e.message}`);
      await new Promise((r) => setTimeout(r, 1500 * attempt));
    }
  }
}

// Runs `fn` over items with at most `n` in flight.
async function pool(items, n, fn) {
  const queue = [...items];
  await Promise.all(Array.from({ length: n }, async () => { while (queue.length) await fn(queue.shift()); }));
}

// Overpass queries, one cached file each. `{bb}` is replaced by the area bounding box.
const OSM_QUERIES = {
  // drivable roads and railways
  'osm.json': `(
  way["highway"~"^(motorway|motorway_link|trunk|trunk_link|primary|primary_link|secondary|secondary_link|tertiary|tertiary_link|unclassified|residential|living_street|service)$"]({bb});
  way["railway"~"^(rail|light_rail|subway|monorail|narrow_gauge)$"]({bb});
);`,
  // green space, water, mapped trees, pedestrian crossings and street objects
  'osm_land.json': `(
  way["leisure"~"^(park|garden|playground|pitch)$"]({bb});
  relation["leisure"~"^(park|garden)$"]({bb});
  way["landuse"~"^(grass|forest|cemetery|religious|recreation_ground|village_green|meadow)$"]({bb});
  relation["landuse"~"^(grass|forest|religious)$"]({bb});
  way["natural"~"^(wood|water|scrub|grassland)$"]({bb});
  relation["natural"~"^(wood|water)$"]({bb});
  way["natural"="tree_row"]({bb});
  node["natural"="tree"]({bb});
  node["highway"~"^(traffic_signals|crossing)$"]({bb});
  way["footway"="crossing"]({bb});
  node["amenity"="vending_machine"]({bb});
);`,
  // everything else that is drawn, with geometry: the pedestrian network, platforms, car parks, barriers,
  // waterways, canopies, gates and small mapped objects
  'osm_extra.json': `(
  way["highway"~"^(footway|path|pedestrian|steps|cycleway)$"]({bb});
  way["railway"="platform"]({bb});
  way["public_transport"="platform"]({bb});
  way["amenity"="parking"]({bb});
  way["barrier"~"^(fence|hedge|wall|retaining_wall|guard_rail)$"]({bb});
  way["waterway"~"^(river|stream|canal|ditch)$"]({bb});
  way["man_made"~"^(bridge|ceremonial_gate)$"]({bb});
  way["building"="roof"]({bb});
  way["leisure"="swimming_pool"]({bb});
  node["highway"="stop"]({bb});
  node["railway"="level_crossing"]({bb});
  node["man_made"="ceremonial_gate"]({bb});
  node["emergency"="fire_hydrant"]({bb});
  node["tourism"="information"]["information"~"^(map|board)$"]({bb});
  node["leisure"="picnic_table"]({bb});
  node["playground"]({bb});
  way["building"]({bb});
  way["building:part"]({bb});
);`,
  // (every building: these footprints are the buildings, compile.mjs extrudes them)
  // named places (shops, restaurants, offices, named buildings) and street furniture, as points:
  // "out center" gives ways and relations a single coordinate
  'osm_poi.json': `(
  nwr["name"]["shop"]({bb});
  nwr["name"]["amenity"]({bb});
  nwr["name"]["tourism"]({bb});
  nwr["name"]["office"]({bb});
  nwr["name"]["leisure"~"^(fitness_centre|sports_centre|amusement_arcade|adult_gaming_centre|dance|bowling_alley)$"]({bb});
  nwr["name"]["building"]({bb});
  node["railway"~"^(station|subway_entrance)$"]({bb});
  node["highway"="bus_stop"]({bb});
  node["amenity"~"^(bench|bicycle_parking|post_box|telephone|toilets|taxi|police)$"]({bb});
  node["historic"]({bb});
  node["man_made"~"^(flagpole|surveillance)$"]({bb});
  node["barrier"="bollard"]({bb});
);
out center tags;`,
};

async function fetchOsm() {
  for (const [name, body] of Object.entries(OSM_QUERIES)) await fetchOverpass(name, body);
}

async function fetchOverpass(name, body) {
  const file = path.join(area.rawDir, name);
  if (exists(file)) return log(`osm ${name}: cached`);
  const { south, west, north, east } = area.bbox;
  // queries end with their own "out" statement, or get the default: the elements with all their nodes
  const filled = body.replaceAll('{bb}', `${south},${west},${north},${east}`);
  const query = `[out:json][timeout:180][maxsize:1073741824];\n${filled}${/\bout\b/.test(filled) ? '' : '\n(._;>;);\nout body;'}`;
  // every server in turn, and round again after a pause: they answer 429 or 504 when busy
  for (const url of [...OVERPASS, ...OVERPASS]) {
    try {
      log(`osm ${name}: querying ${new URL(url).host}`);
      const buf = await download(url, file, {
        retries: 2, method: 'POST',
        headers: { 'User-Agent': UA, 'Content-Type': 'application/x-www-form-urlencoded' },
        body: 'data=' + encodeURIComponent(query),
      });
      const n = JSON.parse(buf).elements.length;
      return log(`osm ${name}: ${n} elements, ${(buf.length / 1e6).toFixed(1)} MB`);
    } catch (e) {
      log(`osm ${name}: ${e.message}`);
      await new Promise((r) => setTimeout(r, 4000));
    }
  }
  if (name !== 'osm.json') {
    log(`osm ${name}: Overpass failed, writing empty fallback`);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify({ elements: [] }));
    return;
  }
  throw new Error(`osm ${name}: every Overpass endpoint failed`);
}

async function fetchDem() {
  for (const src of DEM_SOURCES) {
    const { z, x0, x1, y0, y1 } = demTileRange(area.bbox, src.zoom);
    const jobs = [];
    for (let x = x0; x <= x1; x++)
      for (let y = y0; y <= y1; y++)
        jobs.push({ url: src.url(z, x, y), file: path.join(area.rawDir, 'dem', src.id, `${z}_${x}_${y}.png`) });
    const todo = jobs.filter((j) => !exists(j.file));
    log(`dem ${src.id}: ${jobs.length} tiles, ${todo.length} to download`);
    await pool(todo, 4, async (j) => {
      try { await download(j.url, j.file); } catch (e) { log(`  ${e.message} (left as a gap)`); }
    });
  }
}

log(`area ${area.id}`);
log(`bbox lat ${area.bbox.south.toFixed(5)}..${area.bbox.north.toFixed(5)} lon ${area.bbox.west.toFixed(5)}..${area.bbox.east.toFixed(5)}`);
// (OpenStreetMap last: its servers are the ones that keep one waiting, and the rest is the bulk of the download)
await fetchDem();
await fetchOsm();
log('done');
