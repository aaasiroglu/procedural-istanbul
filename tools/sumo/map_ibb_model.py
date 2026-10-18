"""Carry İBB's calibrated 2020 road model onto the SUMO network: capacity, free-flow speed and BPR coefficients.

  uv run python tools/od/ibb_model.py                                   # KMZ -> data/ibb-open/ag2020_links.parquet
  uv run --group sumo python tools/sumo/map_ibb_model.py --area=koridor  # -> data/sumo/<area>/ibb_model_edges.csv

İBB's links are drawn independently of OSM. Each SUMO car edge is sampled every 10 m; each sample takes the
nearest İBB link within 25 m that runs the same line (|cos| > 0.85) in a direction İBB lets traffic use: İBB
draws each carriageway of a divided road as its own one-way link, a few metres off OSM's, so the nearest link is
often the opposite carriageway. The edge gets the link most of its samples
found, if at least half found one, and the link's direction is read from whether the edge runs with the link's
drawing (AB) or against it (BA): İBB's DIR is 1 for AB only, -1 for BA only, 0 for both.

Columns: edge_id, ibb_id, direction, capacity (veh/h, the direction's), free_kph, alpha, beta, lanes, share.
"""

from __future__ import annotations

import argparse
import csv
import math
import sys
from collections import Counter, defaultdict
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent))
from build_net import area_bbox  # noqa: E402

ROOT = Path(__file__).resolve().parents[2]
STEP, REACH, PARALLEL = 10.0, 25.0, 0.85


def main() -> None:
    import pyarrow.parquet as pq
    import sumolib
    from scipy.spatial import cKDTree
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--area", default="koridor")
    args = parser.parse_args()
    bbox = area_bbox(args.area)
    net = sumolib.net.readNet(str(ROOT / "data" / "sumo" / args.area / f"{args.area}.net.xml.gz"), withInternal=False)
    links = pq.read_table(ROOT / "data/ibb-open/ag2020_links.parquet").to_pylist()

    # İBB road links near the area, sampled along their drawing, with the drawing's heading at each sample
    m = 0.01
    pts, owner, head = [], [], []
    for k, l in enumerate(links):
        if not l["wkt"] or l.get("FONKSIYONE") in (3000, 3002, 101, 2000):  # (zone connectors, ferries, walking)
            continue
        coords = [tuple(map(float, p.split())) for p in l["wkt"][12:-1].split(", ")]
        if not any(bbox["west"] - m <= x <= bbox["east"] + m and bbox["south"] - m <= y <= bbox["north"] + m for x, y in coords):
            continue
        xy = [net.convertLonLat2XY(x, y) for x, y in coords]
        for (ax, ay), (bx, by) in zip(xy, xy[1:]):
            L = math.hypot(bx - ax, by - ay)
            if L < 0.5:
                continue
            for i in range(max(1, int(L // STEP))):
                t = (i + 0.5) / max(1, int(L // STEP))
                pts.append((ax + (bx - ax) * t, ay + (by - ay) * t)); owner.append(k); head.append(((bx - ax) / L, (by - ay) / L))
    tree, head = cKDTree(np.array(pts)), np.array(head)
    print(f"İBB links near the area sampled: {len(set(owner))} links, {len(pts)} samples")

    rows, stats = [], Counter()
    for e in net.getEdges():
        if not e.allows("passenger") or e.getFunction():
            continue
        stats["edges"] += 1
        votes, total = defaultdict(int), 0
        s = e.getShape()
        for (ax, ay), (bx, by) in zip(s, s[1:]):
            L = math.hypot(bx - ax, by - ay)
            if L < 0.5:
                continue
            tx, ty = (bx - ax) / L, (by - ay) / L
            for i in range(max(1, int(L // STEP))):
                t = (i + 0.5) / max(1, int(L // STEP))
                total += 1
                px, py = ax + (bx - ax) * t, ay + (by - ay) * t
                near = sorted(tree.query_ball_point((px, py), REACH), key=lambda j: (pts[j][0] - px) ** 2 + (pts[j][1] - py) ** 2)
                for j in near:
                    c = head[j][0] * tx + head[j][1] * ty
                    d = links[owner[j]]["DIR"]
                    if abs(c) > PARALLEL and (d == 0 or (d == 1 and c > 0) or (d == -1 and c < 0)):
                        votes[(owner[j], "AB" if c > 0 else "BA")] += 1
                        break
        if not votes or sum(votes.values()) < 0.5 * total:
            continue
        (k, d), n = max(votes.items(), key=lambda kv: kv[1])
        l = links[k]
        dir_ok = l["DIR"] == 0 or (l["DIR"] == 1 and d == "AB") or (l["DIR"] == -1 and d == "BA")
        cap = l[f"{d}_CAPACIT"]
        if not dir_ok or not cap:
            stats["direction_mismatch"] += 1
            continue
        stats["matched"] += 1
        rows.append({"edge_id": e.getID(), "ibb_id": l["ID"], "direction": d, "capacity": cap, "free_kph": l["FREEFLOW_H"],
                     "alpha": l["ALPHA"], "beta": l["BETA"], "lanes": l[f"SERIT_{d}"], "share": round(n / total, 2),
                     "type": (e.getType() or "").replace("highway.", "")})
    out = ROOT / "data" / "sumo" / args.area / "ibb_model_edges.csv"
    with open(out, "w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=list(rows[0]))
        w.writeheader(); w.writerows(rows)
    by_type = Counter(r["type"] for r in rows)
    all_types = Counter((e.getType() or "").replace("highway.", "") for e in net.getEdges() if e.allows("passenger") and not e.getFunction())
    print(f"{stats['matched']} of {stats['edges']} car edges matched ({stats['direction_mismatch']} against İBB's one-way direction) -> {out}")
    for t in ("motorway", "trunk", "primary", "secondary", "tertiary", "motorway_link", "trunk_link", "primary_link", "residential"):
        if all_types[t]:
            print(f"  {t:14} {by_type[t]:5} / {all_types[t]:5}  ({by_type[t] / all_types[t]:.0%})")


if __name__ == "__main__":
    main()
