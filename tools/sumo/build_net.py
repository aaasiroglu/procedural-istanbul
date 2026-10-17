"""Build the SUMO road network of a study area from OpenStreetMap, and check it.

  uv run --group sumo python tools/sumo/build_net.py --area=koridor             # fetch (cached) + netconvert + report
  uv run --group sumo python tools/sumo/build_net.py --area=koridor --refetch

The area's bbox comes from tools/pipeline/config.mjs, the one place it is defined. Output in data/sumo/<area>/:

  <area>.osm.xml        roads, signals and turn restrictions from Overpass (cached)
  <area>.net.xml.gz     the SUMO network (UTM projection)
  netconvert.log        netconvert's warnings
  report.json           size, connectivity and the corridor's landmark roads, as checked below

Modelling choices (to be calibrated, not truths):
  - car network: motorway .. living_street and their links; service roads (car parks, driveways) left out
  - Metrobüs: OSM maps it as its own carriageway (highway=busway); kept, buses only, so it takes no car lane
  - signals from OSM traffic_signals nodes; fixed-time, 90 s cycle by default until İBB timings are known
"""

from __future__ import annotations

import argparse
import gzip
import json
import re
import shutil
import subprocess
import sys
import time
import urllib.parse
import urllib.request
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
MIRRORS = (
    "https://z.overpass-api.de/api/interpreter",
    "https://lz4.overpass-api.de/api/interpreter",
    "https://overpass-api.de/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter",
)
USER_AGENT = "procedural-istanbul (https://github.com/aaasiroglu/procedural-istanbul)"
ROADS = ("motorway|trunk|primary|secondary|tertiary|unclassified|residential|living_street|"
         "motorway_link|trunk_link|primary_link|secondary_link|tertiary_link|busway")
# Roads the corridor model cannot do without: (what, how to find it in the net, at least how many lanes per direction)
LANDMARKS = (
    ("15 Temmuz Şehitler Köprüsü", lambda e: e.getName() == "15 Temmuz Şehitler Köprüsü", 3),
    ("Büyükdere Caddesi", lambda e: e.getName() == "Büyükdere Caddesi", 2),
    ("Barbaros Bulvarı", lambda e: e.getName() == "Barbaros Bulvarı", 2),
    ("Metrobüs (bus only)", lambda e: e.getName() == "Metrobüs", 1),
)


def area_bbox(area: str) -> dict:
    script = f"import('./tools/pipeline/config.mjs').then(m => console.log(JSON.stringify(m.AREAS[{json.dumps(area)}] ?? null)))"
    out = subprocess.run(["node", "-e", script], cwd=ROOT, capture_output=True, text=True, check=True).stdout
    spec = json.loads(out)
    if not spec or "bbox" not in spec:
        sys.exit(f'area "{area}" has no bbox in tools/pipeline/config.mjs')
    return spec["bbox"]


def fetch_osm(bbox: dict, path: Path) -> None:
    b = f"{bbox['south']},{bbox['west']},{bbox['north']},{bbox['east']}"
    query = f"""[out:xml][timeout:300];
(
  way["highway"~"^({ROADS})$"]({b});
  node["highway"="traffic_signals"]({b});
);
(._;>;);
out body;
relation(bw)["type"="restriction"];
out body;"""
    data = urllib.parse.urlencode({"data": query}).encode()
    for attempt in range(3):
        for url in MIRRORS:
            try:
                request = urllib.request.Request(url, data=data, headers={"User-Agent": USER_AGENT})
                with urllib.request.urlopen(request, timeout=360) as response:
                    body = response.read()
                if b"<osm" not in body[:500] or b"runtime error" in body[-2000:]:
                    raise RuntimeError("incomplete Overpass answer")
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_bytes(body)
                print(f"OSM: {len(body) / 1e6:.1f} MB from {url}")
                return
            except Exception as error:
                print(f"  {url}: {error}")
        time.sleep(30 * (attempt + 1))  # (the public servers are busy at times: be patient rather than hammer them)
    sys.exit("Overpass: no mirror answered")


def netconvert(osm: Path, net: Path, log: Path, bbox: dict) -> None:
    import sumo
    exe = shutil.which("netconvert") or str(Path(sumo.SUMO_HOME) / "bin" / "netconvert")
    typemap = Path(sumo.SUMO_HOME) / "data" / "typemap" / "osmNetconvert.typ.xml"
    cmd = [
        exe, "--osm-files", str(osm), "--type-files", str(typemap), "--output-file", str(net),
        "--keep-edges.in-geo-boundary", f"{bbox['west']},{bbox['south']},{bbox['east']},{bbox['north']}",
        "--keep-edges.by-vclass", "passenger,bus",
        "--remove-edges.isolated", "--keep-edges.components", "1",
        "--geometry.remove", "--edges.join", "--roundabouts.guess", "--junctions.join",
        "--osm.turn-lanes", "--osm.lane-access",
        # (no --tls.discard-simple: it drops ~2/3 of the corridor's signals, the mid-block pedestrian lights and the
        # halves of split junctions on divided roads, which cost an arterial like Büyükdere real capacity)
        "--tls.guess-signals", "--tls.join", "--tls.default-type", "static", "--tls.cycle.time", "90",
        "--default.lanewidth", "3.2",
        "--output.street-names", "--output.original-names", "--proj.utm",
        "--log", str(log),
    ]
    print("netconvert …")
    result = subprocess.run(cmd, capture_output=True, text=True)
    if result.returncode:
        sys.exit(f"netconvert failed:\n{result.stderr[-3000:]}")


def strongly_connected_share(edges) -> float:
    # share of edges inside the largest strongly connected component (Tarjan, iterative): a car can reach and
    # leave every one of them, the condition for routing demand between any two zones
    index, low, on, stack, comp, n = {}, {}, set(), [], [], 0
    for root in edges:
        if root in index:
            continue
        work = [(root, iter(root.getOutgoing()))]
        index[root] = low[root] = n; n += 1; stack.append(root); on.add(root)
        while work:
            v, it = work[-1]
            for w in it:
                if w not in edges:
                    continue
                if w not in index:
                    index[w] = low[w] = n; n += 1; stack.append(w); on.add(w)
                    work.append((w, iter(w.getOutgoing())))
                    break
                if w in on:
                    low[v] = min(low[v], index[w])
            else:
                work.pop()
                if work:
                    low[work[-1][0]] = min(low[work[-1][0]], low[v])
                if low[v] == index[v]:
                    size = 0
                    while True:
                        w = stack.pop(); on.discard(w); size += 1
                        if w is v:
                            break
                    comp.append(size)
    return max(comp) / len(edges) if edges else 0.0


def report(net_path: Path, log: Path) -> dict:
    import sumolib
    net = sumolib.net.readNet(str(net_path), withInternal=False)
    edges = [e for e in net.getEdges() if e.getFunction() == ""]
    cars = {e for e in edges if e.allows("passenger")}
    buses_only = [e for e in edges if e.allows("bus") and not e.allows("passenger")]
    out = {
        "edges": len(edges), "car_edges": len(cars), "lane_km": round(sum(e.getLength() * e.getLaneNumber() for e in edges) / 1000, 1),
        "road_km": round(sum(e.getLength() for e in edges) / 1000, 1), "junctions": len(net.getNodes()),
        "signal_programs": len(net.getTrafficLights()),
        "signalised_junctions": sum(1 for n in net.getNodes() if n.getType() == "traffic_light"), "car_edges_in_largest_scc": round(strongly_connected_share(cars), 4),
        "bus_only_km": round(sum(e.getLength() for e in buses_only) / 1000, 1),
        "landmarks": {}, "warnings": {},
    }
    for name, match, lanes in LANDMARKS:
        found = [e for e in edges if match(e)]
        out["landmarks"][name] = {
            "edges": len(found), "km": round(sum(e.getLength() for e in found) / 1000, 2),
            "max_lanes": max((e.getLaneNumber() for e in found), default=0),
            "speed_kph": sorted({round(e.getSpeed() * 3.6) for e in found}),
            "ok": bool(found) and max(e.getLaneNumber() for e in found) >= lanes,
        }
    if log.exists():
        # (grouped by message with ids and numbers blanked, so the counts say which kind of problem is common)
        kinds = Counter(re.sub(r"'[^']*'|\d+", "…", line[len("Warning: "):])[:90]
                        for line in log.read_text(errors="replace").splitlines() if line.startswith("Warning:"))
        out["warnings"] = dict(kinds.most_common(10))
    return out


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--area", default="koridor")
    parser.add_argument("--refetch", action="store_true", help="download OSM again even if cached")
    args = parser.parse_args()

    bbox = area_bbox(args.area)
    out = ROOT / "data" / "sumo" / args.area
    osm, net, log = out / f"{args.area}.osm.xml", out / f"{args.area}.net.xml.gz", out / "netconvert.log"
    if args.refetch or not osm.exists():
        fetch_osm(bbox, osm)
    netconvert(osm, net, log, bbox)
    result = report(net, log)
    result["bbox"] = bbox
    (out / "report.json").write_text(json.dumps(result, ensure_ascii=False, indent=2))
    print(json.dumps(result, ensure_ascii=False, indent=2))
    missing = [k for k, v in result["landmarks"].items() if not v["ok"]]
    if missing:
        print(f"\nmissing or under-laned: {', '.join(missing)}")
    if result["car_edges_in_largest_scc"] < 0.95:
        print("\nless than 95 % of car edges are mutually reachable: check one-ways and turn restrictions at the edges")


if __name__ == "__main__":
    main()
