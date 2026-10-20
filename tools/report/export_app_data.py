"""The browser twin's analytics, from the project's own outputs instead of hand-made constants.

  uv run --group sumo python tools/report/export_app_data.py --area=koridor              # newest estimate with counts
  uv run --group sumo python tools/report/export_app_data.py --run data/od/koridor/<run>

Reads one OD estimate (tools/od/corridor.py: summary.json, od.csv, zones.geojson, link_flows.csv, speeds.csv), the
sensor placement (counts_*.json), the SUMO network and, if there is one, the newest shadow simulation
(tools/sumo/shadow.py). Writes public/data/od/<area>.json, which the client loads at start:

  zones            the estimate's 75 H3 cells and 20 gateways: boundary, estimated and prior trips out and in, the
                   median İBB speed and congestion class of the segments inside (the snapshot the estimate saw)
  corridors        OD pairs with at least --min-trips trips/h: estimate, prior, standard error, data share, and
                   free-flow and loaded travel times on the assignment network
  sensors          each İBB count: place, count, held-out prediction and GEH
  bottlenecks      the most loaded major links (flow / capacity) with their road names and shapes
  level, validation, shadow
  recommendations  the first version of the recommendation engine: rules over the outputs above, each with the
                   numbers it rests on (bottleneck ranking, incident response, data to confirm, demand level)

Every derived quantity is labelled with where it comes from in `meta.sources`; nothing in the file is invented.
"""

from __future__ import annotations

import argparse
import csv
import json
import math
import statistics
import sys
from collections import defaultdict
from pathlib import Path

import h3
import numpy as np

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "tools" / "od"))
sys.path.insert(0, str(ROOT / "tools" / "sumo"))

MAJOR = {"motorway", "trunk", "primary", "secondary"}
STATE = {1: "FREE_FLOW", 2: "FREE_FLOW", 3: "CRITICAL", 4: "HYPERCONGESTED", 5: "HYPERCONGESTED"}


def haversine_km(lon1, lat1, lon2, lat2):
    p1, p2 = math.radians(lat1), math.radians(lat2)
    a = math.sin((p2 - p1) / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(math.radians(lon2 - lon1) / 2) ** 2
    return 2 * 6371 * math.asin(math.sqrt(a))


def tr(x, d=0):
    """A number in Turkish style: 12.345,6"""
    t = f"{x:,.{d}f}"
    return t.replace(",", "X").replace(".", ",").replace("X", ".")


def co2_g_per_km(v):
    """Passenger-car CO2 by average speed: the U-shaped curve of the COPERT 5 petrol Euro 6 class (approximate fit)."""
    v = max(v, 5.0)
    return round(0.0136 * v * v - 1.98 * v + 252.0 + 900.0 / v, 1)


def main() -> None:
    import sumolib
    import corridor as C
    from assignment import Network

    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--area", default="koridor")
    parser.add_argument("--run", type=Path, help="an estimate's folder (default: the newest with a validation block)")
    parser.add_argument("--min-trips", type=float, default=5.0)
    args = parser.parse_args()

    od_dir = ROOT / "data" / "od" / args.area
    if args.run:
        run = args.run.resolve()
    else:
        runs = [p for p in sorted(od_dir.glob("2*")) if (p / "summary.json").exists()
                and json.loads((p / "summary.json").read_text(encoding="utf-8")).get("validation")]
        run = runs[-1]
    summary = json.loads((run / "summary.json").read_text(encoding="utf-8"))
    print(f"estimate: {run.name}")

    # ---------------------------------------------------------------- network: link costs at the estimated flows
    sumo_dir = ROOT / "data" / "sumo" / args.area
    net = sumolib.net.readNet(str(sumo_dir / f"{args.area}.net.xml.gz"), withInternal=False)
    network, zones_net, links, edge_link = C.build(net, C.area_bbox(args.area), sumo_dir / "ibb_model_edges.csv")
    flow = np.zeros(network.n_links)
    with open(run / "link_flows.csv", encoding="utf-8") as f:
        for r in csv.DictReader(f):
            e = r["edges"].split()[0]
            if e in edge_link:
                flow[edge_link[e]] = float(r["flow"])
    cost_free = network.t0
    cost_load = network.cost(flow)
    from scipy.sparse import csr_matrix
    from scipy.sparse.csgraph import dijkstra
    shape = (network.n_nodes, network.n_nodes)
    t_free = dijkstra(csr_matrix((cost_free, (network.tail, network.head)), shape=shape), indices=network.zones)[:, network.sinks]
    t_load = dijkstra(csr_matrix((cost_load, (network.tail, network.head)), shape=shape), indices=network.zones)[:, network.sinks]
    zid = [z["id"] for z in zones_net]
    zindex = {z: k for k, z in enumerate(zid)}

    # ---------------------------------------------------------------- İBB speeds per zone (the snapshot the estimate saw)
    best = {}
    with open(sumo_dir / "ibb_edges.csv", encoding="utf-8") as f:
        for r in csv.DictReader(f):
            s, cov = int(r["segment_id"]), float(r["coverage_m"])
            if s not in best or cov > best[s][1]:
                best[s] = (r["edge_id"], cov)
    speeds, classes = defaultdict(list), defaultdict(list)
    with open(run / "speeds.csv", encoding="utf-8") as f:
        for r in csv.DictReader(f):
            s = int(r["segment_id"])
            if s not in best or r["type"] == "FE" or not r["speed_kph"] or r["speed_kph"] == "0":
                continue
            shape_xy = net.getEdge(best[s][0]).getShape()
            x, y = shape_xy[len(shape_xy) // 2]
            lon, lat = net.convertXY2LonLat(x, y)
            cell = h3.latlng_to_cell(lat, lon, C.H3_RES)
            speeds[cell].append(float(r["speed_kph"]))
            classes[cell].append(int(r["congestion"]))

    # ---------------------------------------------------------------- zones
    geo = json.loads((run / "zones.geojson").read_text(encoding="utf-8"))["features"]
    zones = []
    for f in geo:
        p = f["properties"]
        z = {"id": p["id"], "kind": p["kind"], "name": p.get("name") or "", "prior_out": p["production"], "prior_in": p["attraction"],
             "out": p["estimated_out"], "in": p["estimated_in"]}
        if p["kind"] == "h3":
            lat, lon = h3.cell_to_latlng(p["id"])
            z["boundary"] = [[round(lo, 6), round(la, 6)] for la, lo in h3.cell_to_boundary(p["id"])]
        else:
            lon, lat = f["geometry"]["coordinates"]
        z["lon"], z["lat"] = round(lon, 6), round(lat, 6)
        v = speeds.get(p["id"])
        if v:
            z["speed_kph"] = round(statistics.median(v), 1)
            z["congestion"] = int(round(statistics.median(classes[p["id"]])))
            z["state"] = STATE[z["congestion"]]
            z["segments"] = len(v)
            z["co2_g_km"] = co2_g_per_km(z["speed_kph"])
        zones.append(z)
    name_of = {z["id"]: z["name"] for z in zones}

    # ---------------------------------------------------------------- corridors
    corridors = []
    with open(run / "od.csv", encoding="utf-8") as f:
        for r in csv.DictReader(f):
            trips = float(r["trips"])
            if trips < args.min_trips:
                continue
            i, j = zindex[r["origin"]], zindex[r["destination"]]
            zi, zj = zones_net[i], zones_net[j]
            corridors.append({
                "o": r["origin"], "d": r["destination"], "trips": round(trips, 1), "prior": round(float(r["prior"]), 1),
                "se": round(float(r["se"]), 1) if r["se"] else None, "share": float(r["data_share"]) if r["data_share"] else None,
                "km": round(haversine_km(zi["lon"], zi["lat"], zj["lon"], zj["lat"]), 2),
                "free_min": round(float(t_free[i, j]), 1) if np.isfinite(t_free[i, j]) else None,
                "load_min": round(float(t_load[i, j]), 1) if np.isfinite(t_load[i, j]) else None,
            })
    corridors.sort(key=lambda c: -c["trips"])

    # ---------------------------------------------------------------- sensors and validation
    placement = {}
    for path in od_dir.glob("counts_*.json"):
        for s in json.loads(path.read_text(encoding="utf-8")):
            placement.setdefault(str(s["sensor"]), s)
    sensors = []
    for p in summary["validation"]["per_count"]:
        no = p["source"].split()[2]
        s = placement.get(no)
        if not s:
            continue
        sensors.append({"id": no, "name": s["name"], "lon": s["lon"], "lat": s["lat"], "road": s.get("road", ""), "count": p["count"],
                        "fit": p["fit"], "held_out": p["held_out"], "geh_held_out": p["geh_held_out"]})

    # ---------------------------------------------------------------- bottlenecks: loaded major links
    bottlenecks = []
    for k, l in enumerate(links):
        if l["kind"] not in MAJOR or flow[k] < 300:
            continue
        e = net.getEdge(l["edges"][0])
        if not e.getName():  # (a recommendation has to say where: unnamed stretches are left out)
            continue
        vc = flow[k] / l["cap"]
        bottlenecks.append({"name": e.getName() or l["kind"], "kind": l["kind"], "flow": round(float(flow[k])), "capacity": round(l["cap"]),
                            "v_c": round(float(vc), 2), "delay_ratio": round(float(cost_load[k] / cost_free[k]), 2),
                            "shape": [[round(c, 6) for c in net.convertXY2LonLat(x, y)] for x, y in e.getShape()]})
    bottlenecks.sort(key=lambda b: -b["v_c"])
    seen, top = set(), []
    for b in bottlenecks:  # (one entry per road name: the most loaded stretch)
        if b["name"] in seen:
            continue
        seen.add(b["name"]); top.append(b)
        if len(top) == 12:
            break

    # ---------------------------------------------------------------- shadow simulation (newest, if any)
    shadow = None
    reports = sorted((run / "shadow").glob("*/report.json")) if (run / "shadow").exists() else []
    if reports:
        shadow = json.loads(reports[-1].read_text(encoding="utf-8"))

    # ---------------------------------------------------------------- recommendations (engine v1: rules over the outputs)
    lv = summary["level_of_demand"]
    recs = []
    for b in top[:5]:
        recs.append({"kind": "bottleneck", "audience": "authority", "severity": "high" if b["v_c"] >= 1 else "medium",
                     "title": f"{b['name']}: modelde talep kapasitenin %{round(b['v_c'] * 100)} düzeyinde",
                     "detail": f"Tahmini akım {tr(b['flow'])} araç/sa, kapasite {tr(b['capacity'])} araç/sa; seyahat süresi serbest akışın {tr(b['delay_ratio'], 1)} katı. Statik modelin sayısı abartabilir; yönü güvenilir: sinyal süreleri, şerit düzeni ya da paralel güzergâha yönlendirme ilk incelenecek yer.",
                     "basis": "link_flows.csv (bilevel tahmin, UE ataması, İBB 2020 BPR)", "where": b["shape"][len(b["shape"]) // 2]})
    if shadow:
        u, i = shadow["policies"]["unaware"], shadow["policies"]["informed"]
        recs.append({"kind": "incident", "audience": "authority", "severity": "high",
                     "title": f"{shadow['edge_name'] or shadow['edge']} kapanırsa: sürücüleri anında bilgilendirin",
                     "detail": f"Gölge simülasyonda anında bilgilendirme, habersiz duruma göre {shadow['horizon_minutes']} dakikada {i['arrived'] - u['arrived']:+d} araç daha geçirdi; ışınlanma {u['teleports']} → {i['teleports']}. Not: kazancın bir kısmı daha sık yeniden rota seçiminden geliyor.",
                     "basis": "tools/sumo/shadow.py (mezoskopik SUMO, durum çatallama, tek tohum)"})
    for s in sorted(sensors, key=lambda s: -s["geh_held_out"])[:3]:
        recs.append({"kind": "data", "audience": "analyst", "severity": "medium",
                     "title": f"Sensörü teyit edin: {s['name']}",
                     "detail": f"Sayım {tr(s['count'])} araç/sa, sayım görülmeden tahmin {tr(s['held_out'])} (GEH {tr(s['geh_held_out'], 1)}). Yön ve şerit kapsamı İBB'den doğrulanmalı.",
                     "basis": "dışarıda bırakılan GEH (summary.json → validation)", "where": [s["lon"], s["lat"]]})
    recs.append({"kind": "level", "audience": "analyst", "severity": "info",
                 "title": "Talep düzeyi sayımlarla sabitlendi" if lv.get("identified") else "Talep düzeyi henüz sabit değil",
                 "detail": f"Düzey çarpanı ×{tr(lv['factor'], 2)} (%95: {tr(lv['ci95'][0], 2)}–{tr(lv['ci95'][1], 2)}), veri payı {tr(lv['data_share'], 2)}. Zonlar arası dağılım zayıf: dışarıda bırakılan GEH < 5 oranı %{tr(summary['validation']['held_out']['under5_pct'], 1)}.",
                 "basis": "odme.level_identification (profil eğriliği)"})
    # trips through the bridge's gateways: the share of the corridor's demand that crosses
    bridge = {"G01", "G02"}
    cross = sum(c["trips"] for c in corridors if c["o"] in bridge or c["d"] in bridge)
    total = sum(c["trips"] for c in corridors)
    recs.append({"kind": "driver", "audience": "driver", "severity": "info",
                 "title": "Köprü yönü: koridor talebinin önemli bir kısmı 15 Temmuz Köprüsü'nden geçiyor",
                 "detail": f"Tahminde 1. Çevre Yolu köprü geçitlerine bağlı yolculuklar {tr(cross)} araç/sa, koridor talebinin yüzde {100 * cross / max(total, 1):.0f}'i. Köprüye bağlanan yollardaki darboğazlar bu yüzden tüm koridoru etkiler.",
                 "basis": "od.csv (G01, G02 geçit zonları)"})

    out = {
        "meta": {"area": args.area, "estimate": run.name, "speeds_at": summary["speeds_at"], "period": summary["period"],
                 "sources": {
                     "zones.out/in": "tahmin (od.csv toplamları), prior_out/prior_in: arazi kullanımı prior'ı",
                     "zones.speed_kph/congestion": "İBB canlı hız görüntüsü (tahminin kullandığı), hücredeki segmentlerin medyanı",
                     "zones.co2_g_km": "hıza bağlı binek araç CO2 eğrisi (COPERT 5 benzeri, yaklaşık)",
                     "corridors.free_min/load_min": "atama ağında serbest akış ve tahmini yükte en kısa süre",
                     "bottlenecks": "link_flows.csv, ana yollar",
                     "recommendations": "kural tabanlı öneri motoru v1 (tools/report/export_app_data.py)"}},
        "level": {k: lv[k] for k in ("factor", "ci95", "data_share", "identified", "verdict", "trips")},
        "trips": summary["car_trips_per_hour"],
        "validation": {k: summary["validation"][k] for k in ("prior", "fit", "held_out")},
        "anchors": summary.get("anchors", []),
        "zones": zones, "corridors": corridors, "sensors": sensors, "bottlenecks": top, "shadow": shadow, "recommendations": recs,
    }
    dst = ROOT / "public" / "data" / "od" / f"{args.area}.json"
    dst.parent.mkdir(parents=True, exist_ok=True)
    dst.write_text(json.dumps(out, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"{len(zones)} zones ({sum('speed_kph' in z for z in zones)} with İBB speeds), {len(corridors)} corridors, "
          f"{len(sensors)} sensors, {len(top)} bottlenecks, {len(recs)} recommendations → {dst.relative_to(ROOT)} ({dst.stat().st_size / 1024:.0f} KB)")


if __name__ == "__main__":
    main()
