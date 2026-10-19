"""Match İBB UYM traffic segments to the edges of a SUMO network.

The estimator (tools/od) needs every speed observation on a link of the simulated network. İBB segments are
polylines drawn independently of OSM, so each is sampled every few metres and every sample is snapped to the nearest
car edge running the same way (heading within a tolerance); the edges a segment's samples land on are its edges.

  uv run --group sumo python tools/sumo/map_ibb.py --area=koridor

Reads data/sumo/<area>/<area>.net.xml.gz and the segment geometry (the newest day in data/archive/ibb/segments, or
straight from İBB if the archive has none). Writes data/sumo/<area>/ibb_edges.csv:

  segment_id, edge_id, samples, coverage_m, edge_length_m, mean_offset_m

and adds an "ibb" block to report.json: how many segments matched, and how much of the network they observe.
"""

from __future__ import annotations

import argparse
import csv
import json
import math
import sys
import urllib.request
from collections import Counter, defaultdict
from pathlib import Path

from build_net import area_bbox

ROOT = Path(__file__).resolve().parents[2]
SEGMENTS_URL = "https://tkmservices.ibb.gov.tr/web/api/TrafficData/v3/Segments/0"
STEP = 12.0         # metres between samples along a segment
RADIUS = 18.0       # how far from a sample an edge may be
MAX_TURN = 35.0     # degrees between the segment's and the edge's heading
MIN_MATCHED = 0.6   # share of a segment's samples that must find an edge for the segment to count as matched


def load_segments() -> list[tuple[int, list[tuple[float, float]]]]:
    """[(segment_id, [(lon, lat), ...])]"""
    days = sorted((ROOT / "data/archive/ibb/segments").glob("date=*.parquet"))
    if days:
        import pyarrow.parquet as pq
        rows = pq.read_table(days[-1]).to_pylist()
        print(f"segments: {days[-1].name} ({len(rows)})")
        def coords(wkt):
            inner = wkt[wkt.index("(") + 1: wkt.rindex(")")]
            return [tuple(map(float, p.split())) for p in inner.split(",")]
        return [(r["segment_id"], coords(r["wkt"])) for r in rows]
    request = urllib.request.Request(SEGMENTS_URL, headers={"User-Agent": "procedural-istanbul"})
    with urllib.request.urlopen(request, timeout=120) as response:
        rows = json.load(response)
    print(f"segments: from İBB ({len(rows)})")
    return [(r["S"], [(lon, lat) for lat, lon in json.loads(r["G"])]) for r in rows]


def heading(ax, ay, bx, by) -> float:
    return math.degrees(math.atan2(by - ay, bx - ax))


def turn(a: float, b: float) -> float:
    return abs((a - b + 180) % 360 - 180)


def samples(points: list[tuple[float, float]]):
    """Points every STEP metres along a polyline, each with the heading of the piece it lies on."""
    for (ax, ay), (bx, by) in zip(points, points[1:]):
        length = math.hypot(bx - ax, by - ay)
        if length < 0.5:
            continue
        h = heading(ax, ay, bx, by)
        n = max(1, round(length / STEP))
        for k in range(n):
            t = (k + 0.5) / n
            yield ax + (bx - ax) * t, ay + (by - ay) * t, h


def edge_heading_at(edge, x, y) -> float:
    shape = edge.getShape()
    best, h = math.inf, 0.0
    for (ax, ay), (bx, by) in zip(shape, shape[1:]):
        dx, dy = bx - ax, by - ay
        length2 = dx * dx + dy * dy or 1e-9
        t = max(0.0, min(1.0, ((x - ax) * dx + (y - ay) * dy) / length2))
        d = math.hypot(ax + t * dx - x, ay + t * dy - y)
        if d < best:
            best, h = d, heading(ax, ay, bx, by)
    return h


def match(net, points_xy, inside, reverse=False):
    """Snaps the samples that lie inside the area. Returns (hits per edge, samples inside, why the rest missed)."""
    pts = list(reversed(points_xy)) if reverse else points_xy
    hits, total, missed = defaultdict(list), 0, Counter()
    for x, y, h in samples(pts):
        if not inside(x, y):
            continue  # (the part of a segment beyond the area has no network to land on)
        total += 1
        best, near = None, False
        for edge, dist in net.getNeighboringEdges(x, y, RADIUS):
            if not edge.allows("passenger") or edge.getFunction():
                continue
            near = True
            if turn(h, edge_heading_at(edge, x, y)) <= MAX_TURN and (best is None or dist < best[1]):
                best = (edge, dist)
        if best:
            hits[best[0]].append(best[1])
        else:
            missed["no_edge_nearby" if not near else "heading"] += 1
    return hits, total, missed


def main() -> None:
    import sumolib
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--area", default="koridor")
    args = parser.parse_args()
    out = ROOT / "data" / "sumo" / args.area
    net_path = out / f"{args.area}.net.xml.gz"
    if not net_path.exists():
        sys.exit(f"no network at {net_path}: run tools/sumo/build_net.py --area={args.area} first")
    net = sumolib.net.readNet(str(net_path), withInternal=False)
    # the study area itself, not the network's extent: edges crossing the boundary are kept whole, so the network
    # reaches beyond it, but whatever İBB measures out there is outside the model
    bbox = area_bbox(args.area)

    def inside(x, y):
        lon, lat = net.convertXY2LonLat(x, y)
        return bbox["west"] <= lon <= bbox["east"] and bbox["south"] <= lat <= bbox["north"]

    rows, stats, missed = [], Counter(), Counter()
    observed = set()
    for segment_id, lonlat in load_segments():
        xy = [net.convertLonLat2XY(lon, lat) for lon, lat in lonlat]
        hits, total, why = match(net, xy, inside)
        if total == 0:
            continue
        stats["in_area"] += 1
        matched = sum(len(v) for v in hits.values())
        # İBB draws a segment in its direction of travel; a segment that only matches when reversed is counted
        # (and reported) so a systematic reversal would show up rather than silently halve the matches
        rev_hits, _, _ = match(net, xy, inside, reverse=True)
        if sum(len(v) for v in rev_hits.values()) > 1.5 * max(matched, 1):
            stats["reversed_better"] += 1
        if matched / total < MIN_MATCHED:
            stats["unmatched"] += 1
            missed.update(why)
            continue
        stats["matched"] += 1
        for edge, dists in hits.items():
            coverage = len(dists) * STEP
            if len(dists) < 2 and coverage < 0.5 * edge.getLength():
                continue  # a sample or two clipping a cross street at a junction
            observed.add(edge)
            rows.append({"segment_id": segment_id, "edge_id": edge.getID(), "samples": len(dists),
                         "coverage_m": round(coverage, 1), "edge_length_m": round(edge.getLength(), 1),
                         "mean_offset_m": round(sum(dists) / len(dists), 2)})

    with open(out / "ibb_edges.csv", "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=["segment_id", "edge_id", "samples", "coverage_m", "edge_length_m", "mean_offset_m"])
        writer.writeheader()
        writer.writerows(rows)

    cars = [e for e in net.getEdges() if e.allows("passenger") and not e.getFunction()]
    by_type = defaultdict(lambda: [0.0, 0.0])
    for e in cars:
        kind = (e.getType() or "other").replace("highway.", "")
        by_type[kind][0] += e.getLength()
        if e in observed:
            by_type[kind][1] += e.getLength()
    summary = {
        "segments_in_area": stats["in_area"], "segments_matched": stats["matched"],
        "match_rate": round(stats["matched"] / max(stats["in_area"], 1), 3),
        "segments_better_reversed": stats["reversed_better"],
        "unmatched_samples": dict(missed),  # no_edge_nearby: road missing from the net; heading: none ran that way
        "edges_observed": len(observed),
        "observed_km_share_by_type": {k: round(v[1] / v[0], 3) for k, v in sorted(by_type.items(), key=lambda kv: -kv[1][0]) if v[0] > 1000},
    }
    report_path = out / "report.json"
    report = json.loads(report_path.read_text()) if report_path.exists() else {}
    report["ibb"] = summary
    report_path.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(summary, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
