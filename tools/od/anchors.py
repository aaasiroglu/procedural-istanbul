"""Anchors on the OD matrix itself, from sources other than link counts, for tools/od/corridor.py --anchors.

  uv run python tools/od/anchors.py --area=koridor --month=2024-10 --hour=11
  uv run python tools/od/anchors.py --area=koridor --month=2024-10 --hour=11 --bridge-eu-as 6100 --bridge-as-eu 5900

An anchor says "these OD pairs add up to v ± sd" (odme kind od_sum). Two kinds are written:

1. Transit (İstanbulkart). İBB's hourly boardings ("Saatlik Toplu Ulaşım", hourly_transportation_YYYYMM.csv) at the
   corridor's rail stations (M2, M6, M7, F4, Gayrettepe–Kağıthane) and metrobüs stops (Mecidiyeköy, Zincirlikuyu),
   median over the month's complete weekdays. The car trips the corridor's own zones produce in the hour are taken
   as car_per_transit_boarding times those boardings. That ratio is an assumption with a wide log-normal error
   (ASSUMPTIONS), so the anchor is weak by design: it says which order of magnitude the corridor's own car demand
   has, and its weight in the estimate shows in the level's data share. A ratio from the household survey's mode
   split, by zone, would make it stronger.
   (The file's "town" is the district of the boarding only for rail; for buses it is the line's, so buses are left out.)
2. Bridge by direction (KGM). The 15 Temmuz bridge's hourly crossings per direction, when known (--bridge-eu-as,
   --bridge-as-eu: veh/h), as trips leaving through / entering from the bridge's gateways. İBB's sensor on the
   bridge counts both directions together; a directional count separates them.

Writes data/od/<area>/anchors_<month>_h<hour>.csv: from, to, value, sd, source. Selectors in from/to: "h3" (every
interior zone), "*" (every zone), or zone ids joined by "|" (gateways are G00, G01, ...; see summary.json).
"""

from __future__ import annotations

import argparse
import csv
import math
import statistics
from collections import defaultdict
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
ASSUMPTIONS = {
    "car_per_transit_boarding": 1.0,      # car trips produced in the corridor per transit boarding there, same hour
    "car_per_transit_log_sd": 0.7,        # x2 either way: weak on purpose
    "bridge_rel_sd": 0.05,                # a toll-plaza count is close to exact
    "bridge_gateways": {"eu_as": "G01|G02", "as_eu": "G01|G02"},  # 1. Çevre Yolu gateways at the bridge (koridor)
}
RAIL_TOWNS = {"SISLI", "BESIKTAS", "SARIYER", "KAGITHANE"}
RAIL_LINES = {"M2", "M6", "M7", "F4", "TCDD-GH"}
RAIL_OUTSIDE = {"SISLI 2 KUZEY", "SISLI GUNEY", "OSMANBEY 2 GUNEY", "OSMANBEY KUZEY", "MACKA"}  # south of the area
METROBUS = {"MECIDIYEKOY", "ZINCIRLIKUYU 1", "ZINCIRLIKUYU 2"}


def transit_boardings(path: Path, hour: int) -> tuple[float, int, dict]:
    """Median weekday boardings in the hour at the corridor's stations, over the days the file has in full."""
    per_day, rows_per_day, per_station = defaultdict(float), defaultdict(int), defaultdict(float)
    with open(path, encoding="utf-8-sig", errors="replace") as f:
        for r in csv.DictReader(f):
            rows_per_day[r["transition_date"]] += 1
            if int(r["transition_hour"]) != hour:
                continue
            rail = r["road_type"] == "RAYLI" and r["town"] in RAIL_TOWNS and r["line_name"] in RAIL_LINES \
                and r["station_poi_desc_cd"] not in RAIL_OUTSIDE
            brt = r["line_name"] == "34" and r["station_poi_desc_cd"] in METROBUS
            if rail or brt:
                n = float(r["number_of_passage"] or 0)
                per_day[r["transition_date"]] += n
                per_station[r["station_poi_desc_cd"]] += n
    # (the published month has some days with a few hundred rows only: incomplete, left out)
    full = [d for d, n in rows_per_day.items() if n > 0.5 * max(rows_per_day.values()) and date.fromisoformat(d).weekday() < 5]
    values = [per_day[d] for d in full]
    return statistics.median(values), len(values), {k: v / max(len(full), 1) for k, v in per_station.items()}


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--area", default="koridor")
    parser.add_argument("--month", default="2024-10")
    parser.add_argument("--hour", type=int, default=11)
    parser.add_argument("--bridge-eu-as", type=float, help="15 Temmuz crossings Europe -> Asia (veh/h), e.g. from KGM")
    parser.add_argument("--bridge-as-eu", type=float, help="15 Temmuz crossings Asia -> Europe (veh/h)")
    args = parser.parse_args()

    a = ASSUMPTIONS
    year, month = args.month.split("-")
    rows = []
    src = ROOT / "data" / "ibb-open" / f"hourly_transportation_{year}{month}.csv"
    if src.exists():
        boardings, days, stations = transit_boardings(src, args.hour)
        car = a["car_per_transit_boarding"] * boardings
        sd = car * (math.exp(a["car_per_transit_log_sd"]) - 1)
        rows.append({"from": "h3", "to": "*", "value": round(car, 1), "sd": round(sd, 1),
                     "source": f"İstanbulkart {args.month} h{args.hour}: {boardings:.0f} boardings at {len(stations)} stations ({days} weekdays) x {a['car_per_transit_boarding']}"})
        print(f"transit: {boardings:.0f} boardings/h at {len(stations)} corridor stations, median of {days} weekdays -> car production {car:.0f} ± {sd:.0f}")
        for name, v in sorted(stations.items(), key=lambda kv: -kv[1])[:8]:
            print(f"  {name:28} {v:7.0f}")
    else:
        print(f"no {src.relative_to(ROOT)}: transit anchor skipped")
    gates = a["bridge_gateways"]
    if args.bridge_eu_as:
        rows.append({"from": "*", "to": gates["eu_as"], "value": args.bridge_eu_as, "sd": round(a["bridge_rel_sd"] * args.bridge_eu_as, 1),
                     "source": "15 Temmuz Europe -> Asia (directional count)"})
    if args.bridge_as_eu:
        rows.append({"from": gates["as_eu"], "to": "*", "value": args.bridge_as_eu, "sd": round(a["bridge_rel_sd"] * args.bridge_as_eu, 1),
                     "source": "15 Temmuz Asia -> Europe (directional count)"})

    out = ROOT / "data" / "od" / args.area / f"anchors_{year}{month}_h{args.hour}.csv"
    out.parent.mkdir(parents=True, exist_ok=True)
    with open(out, "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, ["from", "to", "value", "sd", "source"])
        w.writeheader(); w.writerows(rows)
    print(f"→ {out} ({len(rows)} anchors)")


if __name__ == "__main__":
    main()
