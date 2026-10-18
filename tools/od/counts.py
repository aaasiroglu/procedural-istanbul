"""İBB's daily sensor counts, turned into hourly counts on the SUMO network, for the OD estimator.

  uv run --group sumo python tools/od/counts.py --area=koridor --month=2024-10 --weekday=5 --hour=17

Inputs (data.ibb.gov.tr, in data/ibb-open/): the daily vehicle counts per sensor ("Günlük Araç Sayımı", e.g.
2024_gunluk_arac_sayim.csv) and the hourly traffic density of the same month ("Saatlik Trafik Yoğunluk",
traffic_density_YYYYMM.csv). Writes data/od/<area>/counts_<month>_d<weekday>_h<hour>.csv, which
tools/od/corridor.py --counts reads, and a .json beside it with how each sensor was placed.

1. Placement. A sensor is a point. Its count is taken as the traffic across the road there, both directions:
   a screenline through the point, square to the nearest road of a counting class, crossing every carriageway of
   that road (same name, running parallel). The 15 Temmuz bridge sensor reads ~187 000 vehicles a day, both
   directions together, which is the bridge's known daily total.
2. Daily to hourly. The share of the day's traffic in the hour comes from the probe vehicles of the density data
   in the sensor's geohash cell, that same day: count(hour) = count(day) x probes(hour) / probes(day).
3. One value per sensor: the median over the month's days of the given weekday, with a standard deviation from
   their spread plus 10 % for the share's own error (probe vehicles are a sample of the traffic).
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

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "sumo"))
from build_net import area_bbox  # noqa: E402

ROOT = Path(__file__).resolve().parents[2]
COUNTING = {"motorway", "trunk", "primary", "secondary", "tertiary", "motorway_link", "trunk_link", "primary_link", "secondary_link"}
SNAP = 45.0          # metres: how far from the point the counted road may be
HALF_SCREEN = 40.0   # metres each side of the point the screenline reaches across the road
BASE32 = "0123456789bcdefghjkmnpqrstuvwxyz"


def geohash(lat: float, lon: float, precision: int = 6) -> str:
    lat_r, lon_r, bits, even, out = [-90.0, 90.0], [-180.0, 180.0], [], True, ""
    while len(out) < precision:
        r, v = (lon_r, lon) if even else (lat_r, lat)
        mid = (r[0] + r[1]) / 2
        bits.append(1 if v >= mid else 0)
        r[0 if v >= mid else 1] = mid
        even = not even
        if len(bits) == 5:
            out += BASE32[int("".join(map(str, bits)), 2)]
            bits = []
    return out


def kind(e) -> str:
    return (e.getType() or "").replace("highway.", "")


def screenline(net, x, y, half=HALF_SCREEN):
    """The car edges a sensor at (x, y) counts (both directions of its road), and the nearest road."""
    near = [(e, d) for e, d in net.getNeighboringEdges(x, y, SNAP) if e.allows("passenger") and kind(e) in COUNTING]
    if not near:
        return None, None
    # the road itself rather than a ramp beside it: a link wins only when clearly nearer
    road, _ = min(near, key=lambda ed: ed[1] + (20 if kind(ed[0]).endswith("_link") else 0))
    # its heading where the point projects onto it
    shape = road.getShape()
    best = min(zip(shape, shape[1:]), key=lambda ab: point_segment(x, y, *ab[0], *ab[1]))
    (ax, ay), (bx, by) = best
    L = math.hypot(bx - ax, by - ay) or 1
    tx, ty = (bx - ax) / L, (by - ay) / L
    nx, ny = -ty, tx
    p0, p1 = (x - nx * half, y - ny * half), (x + nx * half, y + ny * half)
    name = road.getName()
    counted = []
    for e, _ in net.getNeighboringEdges(x, y, half + 5):
        if not e.allows("passenger") or kind(e) not in COUNTING or e.getFunction():
            continue
        if kind(e) != kind(road) and not (name and e.getName() == name):
            continue  # (a parallel street or a ramp beside the road is not what the sensor sees; the same road
            # may change its name along the way, a viaduct for instance, but not its class)
        s = e.getShape()
        for (cx, cy), (dx, dy) in zip(s, s[1:]):
            if crosses(p0, p1, (cx, cy), (dx, dy)):
                l = math.hypot(dx - cx, dy - cy) or 1
                cos = (dx - cx) / l * tx + (dy - cy) / l * ty
                if abs(cos) > 0.8:
                    counted.append((e, cos > 0))
                break
    # a divided road whose other carriageway lies further off: look wider before settling for one direction
    if counted and len({way for _, way in counted}) == 1 and half < 3 * HALF_SCREEN and not all(e.getFromNode() in (o.getToNode() for o, _ in counted) for e, _ in counted):
        wider, _ = screenline(net, x, y, half * 1.8)
        if wider and len(wider) > len(counted):
            return wider, road
    return [e for e, _ in counted], road


def point_segment(px, py, ax, ay, bx, by):
    dx, dy = bx - ax, by - ay
    t = max(0, min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy or 1)))
    return math.hypot(ax + t * dx - px, ay + t * dy - py)


def crosses(p, q, r, s):
    def orient(a, b, c):
        return (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])
    return orient(p, q, r) * orient(p, q, s) < 0 and orient(r, s, p) * orient(r, s, q) < 0


def main() -> None:
    import sumolib
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--area", default="koridor")
    parser.add_argument("--month", default="2024-10", help="YYYY-MM of the counts and the density data")
    parser.add_argument("--weekday", type=int, default=5, help="0 Monday .. 6 Sunday (default 5, Saturday)")
    parser.add_argument("--hour", type=int, default=17, help="hour starting (default 17: 17:00-18:00)")
    args = parser.parse_args()
    year, month = map(int, args.month.split("-"))
    src = ROOT / "data" / "ibb-open"
    bbox = area_bbox(args.area)

    # daily counts of the sensors in the area, on the month's days of that weekday
    daily = defaultdict(dict)
    sensors = {}
    with open(src / f"{year}_gunluk_arac_sayim.csv", encoding="utf-8-sig") as f:
        for r in csv.DictReader(f, delimiter=";"):
            lon, lat = float(r["X Koordinati"]), float(r["Y Koordinati"])
            if not (bbox["west"] <= lon <= bbox["east"] and bbox["south"] <= lat <= bbox["north"]):
                continue
            d, m, y = map(int, r["Tarih"].split("."))
            day = date(y, m, d)
            if (y, m) != (year, month) or day.weekday() != args.weekday:
                continue
            no = r["Sensor No"]
            sensors[no] = {"name": r["Sensor Adi"].strip(), "lon": lon, "lat": lat, "cell": geohash(lat, lon)}
            daily[no][day] = int(r["ARAC TOPLAM"])

    # the hour's share of each day's probe vehicles in each sensor's cell
    cells = {s["cell"] for s in sensors.values()}
    probes = defaultdict(lambda: defaultdict(float))  # (cell, day) -> hour -> vehicles
    with open(src / f"traffic_density_{year}{month:02d}.csv") as f:
        for r in csv.DictReader(f):
            if r["GEOHASH"] not in cells:
                continue
            t = r["DATE_TIME"]
            probes[(r["GEOHASH"], date.fromisoformat(t[:10]))][int(t[11:13])] += float(r["NUMBER_OF_VEHICLES"])

    net = sumolib.net.readNet(str(ROOT / "data" / "sumo" / args.area / f"{args.area}.net.xml.gz"), withInternal=False)
    rows, report = [], []
    for no, s in sorted(sensors.items(), key=lambda kv: kv[1]["name"]):
        hourly = []
        for day, total in daily[no].items():
            hours = probes.get((s["cell"], day))
            if not hours or len(hours) < 20 or not hours.get(args.hour):
                continue
            hourly.append(total * hours[args.hour] / sum(hours.values()))
        x, y = net.convertLonLat2XY(s["lon"], s["lat"])
        edges, road = screenline(net, x, y)
        entry = {"sensor": no, "name": s["name"], "lon": s["lon"], "lat": s["lat"], "days": len(hourly),
                 "road": road.getName() if road else None, "edges": [e.getID() for e in edges or []]}
        if len(hourly) < 2 or not edges:
            entry["skipped"] = "fewer than 2 days with counts and density" if len(hourly) < 2 else "no counting road within reach"
            report.append(entry)
            continue
        value = statistics.median(hourly)
        spread = 1.4826 * statistics.median(abs(h - value) for h in hourly)  # (MAD, as a standard deviation)
        sd = math.hypot(spread, 0.1 * value)
        entry.update(value=round(value), sd=round(sd), share_of_day=round(value / statistics.median(daily[no].values()), 4))
        report.append(entry)
        rows.append({"sensor": no, "name": s["name"], "edge_id": " ".join(entry["edges"]), "value": round(value, 1),
                     "sd": round(sd, 1), "source": f"İBB sensor {no} {s['name']} ({len(hourly)} days)"})

    out = ROOT / "data" / "od" / args.area
    out.mkdir(parents=True, exist_ok=True)
    stem = f"counts_{year}{month:02d}_d{args.weekday}_h{args.hour}"
    with open(out / f"{stem}.csv", "w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=["sensor", "name", "edge_id", "value", "sd", "source"])
        w.writeheader(); w.writerows(rows)
    (out / f"{stem}.json").write_text(json.dumps(report, ensure_ascii=False, indent=2))
    print(f"{len(rows)} of {len(sensors)} sensors -> {out / (stem + '.csv')}")
    for e in report:
        print(f"  {e['sensor']:>4} {e['name'][:42]:42} " + (f"{e['value']:>6} ±{e['sd']:<5} veh/h  {len(e['edges'])} edges  ({e['days']} days, {e['share_of_day']:.1%} of the day)" if "value" in e else f"skipped: {e['skipped']}"))


if __name__ == "__main__":
    main()
