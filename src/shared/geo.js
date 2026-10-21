// Geographic helpers shared by the compiler (Node) and the client (browser).
//
// World frame (three.js convention): metres, x = east, y = up, z = SOUTH (so north is -z).
// Elevations are metres above sea level.

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
