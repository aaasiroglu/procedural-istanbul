"""Drive random traffic through a built network and count what goes wrong: a check of the network, not of demand.

  uv run --group sumo python tools/sumo/smoke_test.py --area=koridor [--vph 3000] [--minutes 20]

Vehicles that SUMO has to teleport (stuck for 300 s), collide or never get to start point at broken junctions,
missing connections or impossible turn restrictions. Results go to the "smoke" block of report.json, with the edges
where teleports happened most, which are the places to look at first in sumo-gui / netedit.
"""

from __future__ import annotations

import argparse
import json
import re
import subprocess
import sys
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]


def main() -> None:
    import sumo
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--area", default="koridor")
    parser.add_argument("--vph", type=int, default=3000, help="random trips per hour (default 3000)")
    parser.add_argument("--minutes", type=int, default=20)
    parser.add_argument("--seed", type=int, default=1)
    args = parser.parse_args()
    out = ROOT / "data" / "sumo" / args.area
    net = out / f"{args.area}.net.xml.gz"
    work = out / "smoke"
    work.mkdir(parents=True, exist_ok=True)
    home = Path(sumo.SUMO_HOME)
    end = args.minutes * 60

    # trips between the network's fringe and interior, at least 1 km long: through and local traffic alike
    subprocess.run([sys.executable, str(home / "tools" / "randomTrips.py"), "-n", str(net), "-o", str(work / "trips.xml"),
                    "-r", str(work / "routes.rou.xml"), "-b", "0", "-e", str(end), "-p", str(3600 / args.vph),
                    "--fringe-factor", "5", "--min-distance", "1000", "--seed", str(args.seed),
                    "--vehicle-class", "passenger", "--validate"], check=True, capture_output=True)
    log = work / "sumo.log"
    stats = work / "stats.xml"
    subprocess.run([str(home / "bin" / "sumo"), "-n", str(net), "-r", str(work / "routes.rou.xml"), "--end", str(end + 600),
                    "--time-to-teleport", "300", "--collision.action", "warn", "--no-step-log", "--duration-log.statistics",
                    "--statistic-output", str(stats), "--log", str(log), "--seed", str(args.seed)], check=True, capture_output=True)

    import xml.etree.ElementTree as ET
    s = ET.parse(stats).getroot()
    vehicles, tele, safety, trips = (s.find(tag).attrib for tag in ("vehicles", "teleports", "safety", "vehicleTripStatistics"))
    # where they were stuck: from the log lines, e.g. "Teleporting vehicle '54'; waited too long (yield), lane='…_0'"
    lanes = re.findall(r"Teleporting vehicle '[^']+';[^,]*, lane='([^']+)'", log.read_text(errors="replace"))
    result = {
        "trips_per_hour": args.vph, "minutes": args.minutes,
        **{k: int(vehicles[k]) for k in ("loaded", "inserted", "running", "waiting")},
        "teleports": int(tele["total"]), "teleport_reasons": {k: int(v) for k, v in tele.items() if k != "total" and int(v)},
        "teleport_share": round(int(tele["total"]) / max(int(vehicles["inserted"]), 1), 4),
        "teleport_hotspots": dict(Counter(lane.rsplit("_", 1)[0] for lane in lanes).most_common(10)),
        "collisions": int(safety["collisions"]),
        "mean_trip_s": float(trips["duration"]), "mean_time_loss_s": float(trips["timeLoss"]),
    }

    report_path = out / "report.json"
    report = json.loads(report_path.read_text()) if report_path.exists() else {}
    report["smoke"] = result
    report_path.write_text(json.dumps(report, ensure_ascii=False, indent=2))
    print(json.dumps(result, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
