"""Audit of the İBB count sensors: does each one count both directions of its road, or one?

  uv run --group sumo python tools/od/sensor_audit.py --area=koridor --counts data/od/koridor/counts_202410_d0_h11.json \
      --estimate data/od/koridor/<run>

İBB publishes a sensor's daily total but not which carriageways and lanes it covers. Three independent checks,
none of which needs the sensor's metadata:

1. Capacity. The hourly count against the capacity of one direction of the road under the sensor (lanes x the
   per-lane capacity of its class). A count well above one direction's capacity cannot be one direction.
2. Neighbours. The ratio of the sensor's daily counts to another sensor on the same road over a whole year (2024).
   Two sensors on one stretch without ramps between them should read alike every day; a steady ratio near 0.5 (or
   2) is what one direction against two looks like. Its spread over the year says how steady it is.
3. The estimate. The modelled flow in each direction under the sensor (link_flows.csv of an estimate) against the
   count: which reading, both directions or one, the network and the other data agree with.

Writes data/od/<area>/sensor_audit.json and prints a table with a verdict per sensor: "iki yön" (both),
"muhtemelen tek yön" (likely one direction, with which), or "belirsiz". A verdict is evidence for İBB to confirm,
not a confirmation.
"""

from __future__ import annotations

import argparse
import csv
import json
import math
import statistics
import sys
from collections import defaultdict
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "tools" / "sumo"))
from build_net import area_bbox  # noqa: E402

CAP_LANE = {"motorway": 2000, "trunk": 1900, "motorway_link": 1600, "trunk_link": 1600, "primary": 1700, "secondary": 1500, "tertiary": 1200}


def main() -> None:
    import sumolib
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--area", default="koridor")
    parser.add_argument("--counts", type=Path, required=True, help="counts_*.json of tools/od/counts.py (placement and hourly values)")
    parser.add_argument("--estimate", type=Path, help="an estimate's folder, for the modelled flow per direction")
    parser.add_argument("--year", type=int, default=2024)
    parser.add_argument("--variant", action="store_true", help="also write the counts with the one-direction hypothesis applied")
    args = parser.parse_args()

    placed = [s for s in json.loads(args.counts.read_text(encoding="utf-8")) if s.get("edges")]
    net = sumolib.net.readNet(str(ROOT / "data" / "sumo" / args.area / f"{args.area}.net.xml.gz"), withInternal=False)
    flow = {}
    if args.estimate:
        with open(args.estimate / "link_flows.csv", encoding="utf-8") as f:
            for r in csv.DictReader(f):
                for e in r["edges"].split():
                    flow[e] = float(r["flow"])

    # a year of daily totals for every sensor in the area
    bbox = area_bbox(args.area)
    daily = defaultdict(dict)
    with open(ROOT / "data" / "ibb-open" / f"{args.year}_gunluk_arac_sayim.csv", encoding="utf-8-sig") as f:
        for r in csv.DictReader(f, delimiter=";"):
            lon, lat = float(r["X Koordinati"]), float(r["Y Koordinati"])
            if bbox["west"] <= lon <= bbox["east"] and bbox["south"] <= lat <= bbox["north"]:
                d, m, y = map(int, r["Tarih"].split("."))
                daily[r["Sensor No"]][date(y, m, d)] = int(r["ARAC TOPLAM"])

    out = []
    for s in placed:
        edges = [net.getEdge(e) for e in s["edges"]]
        # the two directions: edges grouped by heading against the first one
        def heading(e):
            (x0, y0), (x1, y1) = e.getShape()[0], e.getShape()[-1]
            return math.atan2(y1 - y0, x1 - x0)
        h0 = heading(edges[0])
        dirs = {"A": [], "B": []}
        for e in edges:
            dirs["A" if math.cos(heading(e) - h0) > 0 else "B"].append(e)
        kind = (edges[0].getType() or "").replace("highway.", "")
        cap = {k: sum(e.getLaneNumber() for e in v) * CAP_LANE.get(kind, 1500) for k, v in dirs.items() if v}
        value = s.get("value")
        entry = {"sensor": s["sensor"], "name": s["name"], "road": s.get("road"), "road_type": kind, "count": value,
                 "lanes": {k: sum(e.getLaneNumber() for e in v) for k, v in dirs.items() if v}, "capacity_one_direction": cap}
        evidence = []
        if value and cap:
            one = max(cap.values())
            entry["count_over_one_direction_capacity"] = round(value / one, 2)
            if value > 1.1 * one:
                evidence.append(("both", f"sayım tek yön kapasitesinin {value / one:.1f} katı"))
        # neighbours on the same road: the year-long ratio and how steady it is
        ratios = []
        for t in placed:
            if t is s or not t.get("road") or t.get("road") != s.get("road"):
                continue
            common = sorted(set(daily[s["sensor"]]) & set(daily[t["sensor"]]))
            r = [daily[s["sensor"]][d] / daily[t["sensor"]][d] for d in common if daily[t["sensor"]][d] > 0]
            if len(r) >= 30:
                med = statistics.median(r)
                q = statistics.quantiles(r, n=4)
                ratios.append({"with": t["name"], "days": len(r), "median_ratio": round(med, 2), "iqr": [round(q[0], 2), round(q[2], 2)]})
                if 0.4 <= med <= 0.65 and q[2] < 0.8:
                    evidence.append(("one", f"{t['name']} sensörünün sürekli yaklaşık yarısı ({med:.2f}, {len(r)} gün)"))
                elif 1.55 <= med <= 2.5 and q[0] > 1.25:
                    evidence.append(("both", f"{t['name']} sensörünün sürekli yaklaşık iki katı ({med:.2f})"))
        entry["neighbours"] = ratios
        # the estimate: which reading agrees with the modelled flows
        if flow and value:
            fa = sum(flow.get(e.getID(), 0) for e in dirs["A"]); fb = sum(flow.get(e.getID(), 0) for e in dirs["B"])
            entry["modelled"] = {"A": round(fa), "B": round(fb), "both": round(fa + fb)}
            err = {k: abs(math.log(max(v, 1) / value)) for k, v in (("both", fa + fb), ("A", fa), ("B", fb)) if v > 0}
            if err:
                best = min(err, key=err.get)
                entry["closest_reading"] = best
                if best != "both" and err[best] < 0.5 * err.get("both", 9):
                    evidence.append(("one", f"model akımı tek yönle ({best}: {round(fa if best == 'A' else fb)}) iki yönden ({round(fa + fb)}) çok daha uyumlu"))
        votes = [v for v, _ in evidence]
        entry["evidence"] = [w for _, w in evidence]
        entry["verdict"] = ("iki yön" if votes.count("both") > votes.count("one") else
                            "muhtemelen tek yön" if votes.count("one") > votes.count("both") else "belirsiz")
        out.append(entry)

    # the hypothesis as a counts file to test: sensors judged one-directional count half of what crosses both
    # carriageways (a symmetric split, the midday case; wider sd for not knowing which direction). Whether this
    # helps is judged on the sensors left unchanged (their held-out GEH), so the test does not grade itself.
    if args.variant:
        one = {e["sensor"] for e in out if e["verdict"] == "muhtemelen tek yön"}
        src = args.counts.with_suffix(".csv")
        rows = list(csv.DictReader(open(src, encoding="utf-8")))
        for r in rows:
            if r["sensor"] in one:
                r["value"], r["sd"] = f"{2 * float(r['value']):.1f}", f"{2.5 * float(r['sd']):.1f}"
                r["source"] += " [tek yön varsayımı: x2]"
        dst_v = src.with_name(src.stem + "_onedir.csv")
        with open(dst_v, "w", newline="", encoding="utf-8") as f:
            w = csv.DictWriter(f, fieldnames=list(rows[0].keys())); w.writeheader(); w.writerows(rows)
        print(f"{len(one)} sensors as one direction → {dst_v}")

    dst = ROOT / "data" / "od" / args.area / "sensor_audit.json"
    dst.write_text(json.dumps(out, ensure_ascii=False, indent=2), encoding="utf-8")
    for e in sorted(out, key=lambda e: e["verdict"]):
        print(f"{e['sensor']:>4} {e['name'][:34]:34} {e['verdict']:20} " + "; ".join(e["evidence"])[:140])
    print(f"→ {dst.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
