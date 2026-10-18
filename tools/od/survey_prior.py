"""An observed car OD for the corridor from İBB's 2012 household travel survey (Ulaşım Ana Planı).

  uv run python tools/od/survey_prior.py --area=koridor --hour=17

Inputs (data/ibb-open/): hh2012.csv (the survey's answers), muhtarlik.geojson (one point per neighbourhood: its
muhtarlık office) and ag2020_links.parquet (İBB's 2020 road network, from tools/od/ibb_model.py).

1. Trips starting in the hour by car (driving alone, shared, or by taxi), expanded by the person weight and turned
   into vehicles (a shared ride counts 1 / occupants).
2. Each trip's neighbourhoods placed at their muhtarlık (names matched after normalising Turkish letters).
3. Each trip routed on İBB's network (free-flow time, one-way rules) from origin to destination: where the route
   first enters the study area and where it last leaves it. A trip inside the area keeps its own ends; one from
   outside enters at a boundary point (a gateway later); one passing through gets both. Routes that never touch
   the area are dropped.

Writes data/od/<area>/survey_trips_h<hour>.csv: o_lon, o_lat, o_kind (zone | gate), d_lon, d_lat, d_kind, vehicles.
tools/od/corridor.py --prior survey turns it into the prior matrix on its zones. The survey is from 2012 and a
weekday: it shapes the prior, the counts and the zone factors set its level.
"""

from __future__ import annotations

import argparse
import csv
import json
import math
import re
import sys
from collections import Counter, defaultdict
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "sumo"))
from build_net import area_bbox  # noqa: E402

ROOT = Path(__file__).resolve().parents[2]
CAR = {"ÖZEL OTO YALNIZ SÜRÜŞ": None, "ÖZEL OTO PAYLAŞILAN SÜRÜŞ": 2.0, "TAKSİ": None}  # default occupancy if unknown
TR = str.maketrans("İIŞĞÜÖÇÂ", "IISGUOCA")
DISTRICT_ALIASES = {"EYUP": "EYUPSULTAN"}


def norm(s: str) -> str:
    s = s.upper().replace("i̇", "I").translate(TR)
    s = re.sub(r"\b(MAHALLESI|MAHALLE|MAH)\b\.?", "", s)
    return re.sub(r"[^A-Z0-9]", "", s)


def hour_of(t: str) -> int | None:
    m = re.match(r"\s*(\d{1,2}):(\d{2})", t or "")
    if not m:
        return None
    h = int(m.group(1)) % 12
    return h + 12 if "ÖS" in t else h


def main() -> None:
    import pyarrow.parquet as pq
    from scipy.sparse import csr_matrix
    from scipy.sparse.csgraph import dijkstra
    from scipy.spatial import cKDTree
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--area", default="koridor")
    parser.add_argument("--hour", type=int, default=17)
    args = parser.parse_args()
    bbox = area_bbox(args.area)
    inside = lambda lon, lat: bbox["west"] <= lon <= bbox["east"] and bbox["south"] <= lat <= bbox["north"]
    src = ROOT / "data" / "ibb-open"

    # neighbourhoods: district + name -> point
    where = {}
    for f in json.loads((src / "muhtarlik.geojson").read_text())["features"]:
        p = f["properties"]
        where[(norm(p["İlçe Adı"]), norm(p["Mahalle Adı"]))] = tuple(f["geometry"]["coordinates"])

    def locate(code: str):
        if not code or "-" not in code:
            return None
        d, m = code.split("-", 1)
        d = DISTRICT_ALIASES.get(norm(d), norm(d))
        return where.get((d, norm(m)))

    # car trips starting in the hour
    trips, stats = defaultdict(float), Counter()
    with open(src / "hh2012.csv", encoding="utf-8-sig", errors="replace") as f:
        for row in csv.DictReader(f, delimiter=";"):
            w = float(row["yol_agirlik"] or 0)
            for k in range(1, 12):
                mode = row.get(f"aractur_1.{k}")
                if mode not in CAR or hour_of(row.get(f"baslangicSaati.{k}")) != args.hour:
                    continue
                stats["car trips in hour"] += 1
                o, d = locate(row.get(f"baslangicMahalleKodu.{k}")), locate(row.get(f"varisMahalleKodu.{k}"))
                if not o or not d:
                    stats["unplaced"] += 1
                    continue
                try:
                    occ = float(row.get(f"otoinsansay_1.{k}") or 0)
                except ValueError:  # ("CEVAP YOK": no answer)
                    occ = 0.0
                occ = occ or (CAR[mode] or 1.0)
                trips[(o, d)] += w / (occ if mode == "ÖZEL OTO PAYLAŞILAN SÜRÜŞ" else 1.0)

    # İBB 2020 road network as a directed graph on its links' end points
    links = pq.read_table(src / "ag2020_links.parquet").to_pylist()
    key = lambda x, y: (round(x, 5), round(y, 5))
    nodes, tails, heads, cost = {}, [], [], []
    def nid(p):
        return nodes.setdefault(p, len(nodes))
    for l in links:
        if not l["wkt"] or l.get("FONKSIYONE") in (3000, 3002, 101, 2000):
            continue
        c = [tuple(map(float, q.split())) for q in l["wkt"][12:-1].split(", ")]
        a, b = nid(key(*c[0])), nid(key(*c[-1]))
        t = (l["LENGTH"] or 0.01) / max(l["FREEFLOW_H"] or 30, 5) * 60
        if l["DIR"] in (0, 1):
            tails.append(a); heads.append(b); cost.append(t)
        if l["DIR"] in (0, -1):
            tails.append(b); heads.append(a); cost.append(t)
    pts = np.array(list(nodes.keys()))
    n = len(pts)
    G = csr_matrix((cost, (tails, heads)), shape=(n, n))
    tree = cKDTree(pts * [84, 111])  # (roughly metres per degree here)
    snap = lambda p: int(tree.query(np.array(p) * [84, 111])[1])
    in_area = np.array([inside(x, y) for x, y in pts])

    out, by_origin = [], defaultdict(list)
    for (o, d), v in trips.items():
        by_origin[o].append((d, v))
    for o, dests in by_origin.items():
        so = snap(o)
        _, pred = dijkstra(G, indices=so, return_predecessors=True)
        for d, v in dests:
            if inside(*o) and inside(*d):
                out.append((o, "zone", d, "zone", v)); stats["inside"] += v; continue
            path, node = [], snap(d)
            while node != so and node >= 0:
                path.append(node); node = pred[node]
            if node < 0:
                stats["no route"] += v; continue
            path.append(so); path.reverse()
            hit = [i for i, p in enumerate(path) if in_area[p]]
            if not hit and not (inside(*o) or inside(*d)):
                continue  # (never comes near the area)
            enter = o if inside(*o) else (tuple(pts[path[hit[0]]]) if hit else None)
            leave = d if inside(*d) else (tuple(pts[path[hit[-1]]]) if hit else None)
            if enter is None or leave is None:
                stats["route misses the area"] += v; continue
            out.append((enter, "zone" if inside(*o) else "gate", leave, "zone" if inside(*d) else "gate", v))
            stats["from outside" if not inside(*o) and inside(*d) else "to outside" if inside(*o) and not inside(*d) else "through"] += v

    dst = ROOT / "data" / "od" / args.area / f"survey_trips_h{args.hour}.csv"
    with open(dst, "w", newline="") as f:
        w = csv.writer(f)
        w.writerow(["o_lon", "o_lat", "o_kind", "d_lon", "d_lat", "d_kind", "vehicles"])
        for o, ok, d, dk, v in out:
            w.writerow([round(o[0], 6), round(o[1], 6), ok, round(d[0], 6), round(d[1], 6), dk, round(v, 2)])
    print(f"{len(out)} trip records, {sum(r[4] for r in out):.0f} vehicles/h touching the area -> {dst}")
    print({k: round(v) for k, v in stats.items()})


if __name__ == "__main__":
    main()
