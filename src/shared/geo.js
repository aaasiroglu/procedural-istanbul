// Geographic helpers shared by the compiler (Node) and the client (browser).
//
// World frame (three.js convention): metres, x = east, y = up, z = SOUTH (so north is -z).
// Elevations are orthometric metres above sea level, as in PLATEAU and GSI data.

export const TILE = 256; // streaming tile size, metres

// Local equirectangular projection around an origin. Over a few kilometres the
// distortion is far below a centimetre per metre, which is plenty for a game.
export function makeProjection(lon0, lat0) {
  const phi = (lat0 * Math.PI) / 180;
  const mLat = 111132.954 - 559.822 * Math.cos(2 * phi) + 1.175 * Math.cos(4 * phi);
  const mLon = 111412.84 * Math.cos(phi) - 93.5 * Math.cos(3 * phi);
  return {
    lon0, lat0,
    project: (lon, lat) => [(lon - lon0) * mLon, -(lat - lat0) * mLat],
    unproject: (x, z) => [x / mLon + lon0, -z / mLat + lat0],
  };
}

export const tileOf = (x, z) => [Math.floor(x / TILE), Math.floor(z / TILE)];
export const tileKey = (tx, tz) => `${tx}_${tz}`;

// Generic geodesic box around a lon/lat origin. This is the format used by the
// Istanbul / OpenStreetMap data pipeline and avoids assumptions from the Japanese
// JIS mesh system.
export function bboxAround(lon0, lat0, radiusKm) {
  const dLat = radiusKm / 111.32;
  const dLon = radiusKm / (111.32 * Math.cos((lat0 * Math.PI) / 180));
  return { south: lat0 - dLat, west: lon0 - dLon, north: lat0 + dLat, east: lon0 + dLon };
}

// ---------------------------------------------------------------- Japanese standard grid squares
// JIS X 0410 mesh codes. PLATEAU distributes CityGML per 3rd-level mesh (8 digits, ~1 km).
// 1st level: 40' lat x 1° lon; 2nd: 1/8 of that; 3rd: 1/10 of the 2nd (30" x 45").
// TODO: The mesh code functions below are for the Japanese grid system (JIS X 0410).
// For Istanbul, replace with an appropriate tile/grid scheme or use simple lat/lon bounding boxes.
export function meshCode3(lon, lat) {
  const p = Math.floor((lat * 60) / 40), u = Math.floor(lon - 100);
  const latR = lat * 60 - p * 40, lonR = (lon - 100 - u) * 60;
  const q = Math.floor(latR / 5), v = Math.floor(lonR / 7.5);
  const r = Math.floor((latR - q * 5) / 0.5), w = Math.floor((lonR - v * 7.5) / 0.75);
  return `${p}${u}${q}${v}${r}${w}`;
}

// Bounds of a 3rd-level mesh: { south, west, north, east } in degrees.
export function meshBounds3(code) {
  const p = +code.slice(0, 2), u = +code.slice(2, 4), q = +code[4], v = +code[5], r = +code[6], w = +code[7];
  const south = (p * 40 + q * 5 + r * 0.5) / 60;
  const west = 100 + u + (v * 7.5 + w * 0.75) / 60;
  return { south, west, north: south + 0.5 / 60, east: west + 0.75 / 60 };
}

// The (2k+1) x (2k+1) block of 3rd-level meshes centred on the mesh containing (lon, lat).
export function meshBlock(lon, lat, k) {
  const c = meshBounds3(meshCode3(lon, lat));
  const dLat = 0.5 / 60, dLon = 0.75 / 60, out = [];
  for (let i = -k; i <= k; i++)
    for (let j = -k; j <= k; j++)
      out.push(meshCode3(c.west + (j + 0.5) * dLon, c.south + (i + 0.5) * dLat));
  return out;
}
