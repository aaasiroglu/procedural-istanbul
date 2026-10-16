/**
 * ROAD GENERALIZER & TRANSIT-STYLE SCHEMATIC ROAD FILTER
 * frontend/utils/roadGeneralizer.ts
 *
 * Implements:
 * 1. Douglas-Peucker Polyline Simplification (epsilon tolerance).
 * 2. 45-Degree Octilinear Schematic Angle Snapping (Metro / Transit Map Cartography).
 * 3. Chaikin Algorithm for Corner Smoothing / Spline Curvature.
 */

export interface Point2D {
  x: number;
  y: number;
}

/**
 * Perpendicular distance from a point to a line segment AB.
 */
function perpendicularDistance(p: Point2D, a: Point2D, b: Point2D): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lenSq = dx * dx + dy * dy;

  if (lenSq === 0) {
    return Math.hypot(p.x - a.x, p.y - a.y);
  }

  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / lenSq));
  const projX = a.x + t * dx;
  const projY = a.y + t * dy;

  return Math.hypot(p.x - projX, p.y - projY);
}

/**
 * 1. Douglas-Peucker Polyline Simplification
 */
export function simplifyDouglasPeucker(points: Point2D[], tolerance: number = 8.0): Point2D[] {
  if (points.length <= 2) return points;

  let maxDist = 0;
  let index = 0;

  for (let i = 1; i < points.length - 1; i++) {
    const dist = perpendicularDistance(points[i], points[0], points[points.length - 1]);
    if (dist > maxDist) {
      maxDist = dist;
      index = i;
    }
  }

  if (maxDist > tolerance) {
    const recResults1 = simplifyDouglasPeucker(points.slice(0, index + 1), tolerance);
    const recResults2 = simplifyDouglasPeucker(points.slice(index), tolerance);
    return recResults1.slice(0, -1).concat(recResults2);
  } else {
    return [points[0], points[points.length - 1]];
  }
}

/**
 * 2. Octilinear 45-Degree Angle Snapping
 * Snaps angles to multiples of 45° (0°, 45°, 90°, 135°, 180°, etc.)
 */
export function snapToOctilinear(points: Point2D[]): Point2D[] {
  if (points.length <= 1) return points;

  const result: Point2D[] = [{ x: points[0].x, y: points[0].y }];

  for (let i = 1; i < points.length; i++) {
    const prev = result[i - 1];
    const curr = points[i];

    const dx = curr.x - prev.x;
    const dy = curr.y - prev.y;
    const dist = Math.hypot(dx, dy);

    if (dist < 1e-4) continue;

    // Angle in radians [-PI, PI]
    const angle = Math.atan2(dy, dx);
    const snapAngle = Math.round(angle / (Math.PI / 4.0)) * (Math.PI / 4.0);

    const snappedX = prev.x + dist * Math.cos(snapAngle);
    const snappedY = prev.y + dist * Math.sin(snapAngle);

    result.push({ x: Number(snappedX.toFixed(2)), y: Number(snappedY.toFixed(2)) });
  }

  return result;
}

/**
 * 3. Chaikin Corner Smoothing Algorithm
 * Subdivides each segment at 25% and 75% to produce smooth aerodynamic curves.
 */
export function smoothChaikin(points: Point2D[], iterations: number = 2): Point2D[] {
  if (points.length <= 2) return points;

  let current = points;

  for (let it = 0; it < iterations; it++) {
    const next: Point2D[] = [current[0]];

    for (let i = 0; i < current.length - 1; i++) {
      const p0 = current[i];
      const p1 = current[i + 1];

      const q: Point2D = {
        x: 0.75 * p0.x + 0.25 * p1.x,
        y: 0.75 * p0.y + 0.25 * p1.y,
      };

      const r: Point2D = {
        x: 0.25 * p0.x + 0.75 * p1.x,
        y: 0.25 * p0.y + 0.75 * p1.y,
      };

      next.push(q);
      next.push(r);
    }

    next.push(current[current.length - 1]);
    current = next;
  }

  return current;
}

/**
 * Full Pipeline: Simplifies, snaps to 45°, and applies Chaikin curvature.
 */
export function generalizeRoadToMetroStyle(points: Point2D[], tolerance: number = 10.0, iterations: number = 2): Point2D[] {
  const simplified = simplifyDouglasPeucker(points, tolerance);
  const octilinear = snapToOctilinear(simplified);
  return smoothChaikin(octilinear, iterations);
}
