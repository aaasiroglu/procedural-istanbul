// Areas the pipeline can build: a bounding box (`bbox`, or `radius` km around `origin`); the world origin
// (0, 0, 0) sits on `origin`. `view` is the initial camera (x, z, distance, azimuth, elevation).
import path from 'node:path';
import fs from 'node:fs';
import { bboxAround } from '../../src/shared/geo.js';

export const AREAS = {
  // (in the order of the city switch; the first is the one the site opens with)
  istanbul: {
    name: 'Istanbul (Sultanahmet / Eminönü)',
    origin: [28.9784, 41.0082], // Eminönü / Sultanahmet area
    radius: 1,
    view: '0,0,500,220,28',
  },
  taksim: {
    name: 'Taksim / Beyoğlu',
    origin: [28.9850, 41.0370], // Taksim Square & İstiklal Street
    radius: 1,
  },
  besiktas: {
    name: 'Beşiktaş / Dolmabahçe',
    origin: [29.0060, 41.0420], // Beşiktaş waterfront & Dolmabahçe
    radius: 1,
  },
  kadikoy: {
    name: 'Kadıköy / Moda',
    origin: [29.0250, 40.9900], // Kadıköy harbour & Moda
    radius: 1,
  },
  uskudar: {
    name: 'Üsküdar (Kız Kulesi)',
    origin: [29.0150, 41.0250], // Üsküdar & Maiden's Tower
    radius: 1,
  },
  levent: {
    name: 'Levent / Maslak (Financial District)',
    origin: [29.0120, 41.0780], // Skyscraper district
    radius: 1,
  },
  koridor: {
    name: 'Maslak · Levent · Mecidiyeköy · Çağlayan · Beşiktaş · 15 Temmuz Köprüsü',
    origin: [29.0080, 41.0680], // Zincirlikuyu / Gayrettepe intersection hub
    // Study area, about 5.9 x 8.9 km: Beşiktaş (S), Maslak / İTÜ (N), Çağlayan / Kağıthane (W) and the bridge with
    // its Asian approach to Beylerbeyi (E). Six times the old corridor: compile may need more than 4 GB of heap.
    bbox: { south: 41.038, north: 41.118, west: 28.975, east: 29.048 },
    view: '0,0,600,210,32',
  },
};

export const ROOT = path.resolve(import.meta.dirname, '../..');
export const RAW = path.join(ROOT, 'data/raw');
const IBB_GRID_FILE = path.join(ROOT, 'data/ibb-local/areas.json');
const IBB_GRID_AREAS = fs.existsSync(IBB_GRID_FILE)
  ? Object.fromEntries(JSON.parse(fs.readFileSync(IBB_GRID_FILE, 'utf8')).map((area) => [area.id, area]))
  : {};

export function resolveArea(argv = process.argv) {
  const arg = argv.find((a) => a.startsWith('--area='));
  const id = arg ? arg.split('=')[1] : 'koridor';
  const area = AREAS[id] ?? IBB_GRID_AREAS[id];
  if (!area) throw new Error(`unknown area "${id}" (known: ${Object.keys(AREAS).join(', ')})`);
  const bbox = area.bbox ?? bboxAround(area.origin[0], area.origin[1], area.radius);
  return { id, ...area, meshes: [], bbox, rawDir: path.join(RAW, id), outDir: path.join(ROOT, 'public/tiles', id) };
}
