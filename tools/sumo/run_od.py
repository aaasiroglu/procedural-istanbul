"""Run an OD estimate in SUMO and compare the simulated speeds with İBB's.

  uv run --group sumo python tools/sumo/run_od.py --area=koridor                  # the newest estimate
  uv run --group sumo python tools/sumo/run_od.py --od-dir data/od/koridor/20261017-1712 --micro

The hourly matrix is spread evenly over --minutes (default 90) and turned into trips (od2trips); vehicles route
themselves at departure and re-route every 2 minutes on the travel times they meet (SUMO's rerouting device), a
one-run approximation of user equilibrium. Mesoscopic by default (queues per edge, signals as a capacity share);
--micro for the full car-following model. Speeds are measured after a warm-up (default 30 minutes) and compared,
segment by segment, with the snapshot the estimate was made from (speeds.csv in the estimate's folder).

How each segment entered the estimate is kept apart in the comparison: speeds used as bounds are in-sample (a
consistency check of the static estimate in a dynamic model); local streets were left out of the estimate, so
their comparison is the closest thing to out-of-sample this snapshot offers.

Writes <od-dir>/sim/: trips.xml, edgedata.xml, segments.csv (İBB vs simulated speed per segment) and
comparison.json, and prints the summary.
"""

from __future__ import annotations

import argparse
import csv
import json
import math
import subprocess
import xml.etree.ElementTree as ET
from collections import defaultdict
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[2]


def stats(sim, obs) -> dict:
    sim, obs = np.asarray(sim, float), np.asarray(obs, float)
    if not len(sim):
        return {"n": 0}
    d = sim - obs
    return {"n": int(len(d)), "mae_kph": round(float(np.abs(d).mean()), 1), "rmse_kph": round(float(np.sqrt((d ** 2).mean())), 1),
            "bias_kph": round(float(d.mean()), 1), "within_10_kph": round(float((np.abs(d) <= 10).mean()), 3),
            "pearson_r": round(float(np.corrcoef(sim, obs)[0, 1]), 3) if len(d) > 2 and sim.std() > 0 and obs.std() > 0 else None}


def main() -> None:
    import sumo
    import sumolib
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--area", default="koridor")
    parser.add_argument("--od-dir", type=Path, help="an estimate's folder (default: the newest for the area)")
    parser.add_argument("--minutes", type=int, default=90)
    parser.add_argument("--warmup", type=int, default=30)
    parser.add_argument("--micro", action="store_true", help="microscopic instead of mesoscopic")
    parser.add_argument("--seed", type=int, default=1)
    parser.add_argument("--compare-only", action="store_true", help="skip the run, compare an earlier one's edgedata.xml")
    args = parser.parse_args()

    od_dir = (args.od_dir or max((ROOT / "data" / "od" / args.area).glob("*/od.xml")).parent).resolve()
    sumo_dir = ROOT / "data" / "sumo" / args.area
    net_path = sumo_dir / f"{args.area}.net.xml.gz"
    out = od_dir / "sim"
    out.mkdir(exist_ok=True)
    home = Path(sumo.SUMO_HOME)
    end, begin = args.minutes * 60, args.warmup * 60
    print(f"estimate: {od_dir}")

    if not args.compare_only:
        simulate(args, od_dir, out, home, net_path, end, begin)
    compare(args, od_dir, out, sumo_dir, net_path)


def simulate(args, od_dir, out, home, net_path, end, begin):
    # the hourly matrix over the whole run
    tree = ET.parse(od_dir / "od.xml")
    interval = tree.getroot().find("interval")
    interval.set("end", str(end))
    interval.attrib.pop("id", None)  # (od2trips would take it for the vehicle type)
    for rel in interval.findall("tazRelation"):
        rel.set("count", f"{float(rel.get('count')) * end / 3600:.2f}")
    tree.write(out / "od_run.xml")
    subprocess.run([str(home / "bin" / "od2trips"), "--taz-files", str(od_dir / "taz.xml"), "--tazrelation-files", str(out / "od_run.xml"),
                    "-o", str(out / "trips.xml"), "--spread.uniform", "--different-source-sink", "--departlane", "best",
                    "--departspeed", "max", "--seed", str(args.seed), "--no-step-log"], check=True, capture_output=True)

    (out / "edgedata.add.xml").write_text(
        f'<additional>\n  <edgeData id="compare" file="edgedata.xml" begin="{begin}" end="{end}" excludeEmpty="true"/>\n</additional>\n')
    cmd = [str(home / "bin" / "sumo"), "-n", str(net_path), "-r", str(out / "trips.xml"), "-a", str(out / "edgedata.add.xml"),
           "--begin", "0", "--end", str(end), "--seed", str(args.seed),
           "--device.rerouting.probability", "1", "--device.rerouting.period", "120", "--device.rerouting.threads", "4",
           "--routing-algorithm", "astar", "--time-to-teleport", "300", "--ignore-route-errors",
           "--statistic-output", str(out / "stats.xml"), "--log", str(out / "sumo.log"), "--no-step-log"]
    if not args.micro:
        cmd += ["--mesosim", "--meso-junction-control.limited", "--meso-tls-flow-penalty", "1"]
    print(f"sumo ({'micro' if args.micro else 'meso'}), {args.minutes} min …")
    subprocess.run(cmd, check=True, cwd=out, capture_output=True)


def compare(args, od_dir, out, sumo_dir, net_path):
    import sumolib
    # simulated speed per edge (m/s), weighted by the time vehicles spent on it
    sim_speed = {}
    for e in ET.parse(out / "edgedata.xml").getroot().iter("edge"):
        if e.get("speed") and float(e.get("sampledSeconds", 0)) > 0:
            sim_speed[e.get("id")] = float(e.get("speed")) * 3.6

    net = sumolib.net.readNet(str(net_path), withInternal=False)
    edges_of = defaultdict(list)
    with open(sumo_dir / "ibb_edges.csv") as f:
        for r in csv.DictReader(f):
            edges_of[int(r["segment_id"])].append((r["edge_id"], float(r["coverage_m"])))

    rows, groups = [], defaultdict(lambda: ([], []))
    with open(od_dir / "speeds.csv") as f:
        for r in csv.DictReader(f):
            role, s = r["role"], int(r["segment_id"])
            if role in ("off_network", "closed_or_no_data") or s not in edges_of:
                continue
            # a segment's simulated speed: harmonic mean over its edges, weighted by how much of each it covers
            covered = [(e, c) for e, c in edges_of[s] if e in sim_speed and sim_speed[e] > 0]
            if not covered:
                rows.append({**r, "sim_kph": "", "note": "no simulated traffic"})
                groups[("no_sim_traffic", "")][0].append(0)
                continue
            v = sum(c for _, c in covered) / sum(c / sim_speed[e] for e, c in covered)
            kind = (net.getEdge(max(covered, key=lambda ec: ec[1])[0]).getType() or "").replace("highway.", "")
            rows.append({**r, "sim_kph": round(v, 1), "note": kind})
            sample = "in_sample" if role in ("lower", "upper") or role.startswith("redundant") else "not_used"
            for key in ((sample, "all"), (sample, kind), (sample, "congested" if int(r["congestion"]) >= 3 else "free")):
                groups[key][0].append(v); groups[key][1].append(float(r["speed_kph"]))

    with open(out / "segments.csv", "w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=["segment_id", "type", "speed_kph", "congestion", "role", "sim_kph", "note"])
        w.writeheader(); w.writerows(rows)

    s = ET.parse(out / "stats.xml").getroot()
    veh, tele = s.find("vehicles").attrib, s.find("teleports").attrib
    # (trip statistics only exist for vehicles that arrived; in a gridlocked run there may be none to report)
    trips = s.find("vehicleTripStatistics")
    trips = trips.attrib if trips is not None else {}
    result = {
        "estimate": str(od_dir.relative_to(ROOT)), "model": "micro" if args.micro else "meso",
        "minutes": args.minutes, "warmup_minutes": args.warmup,
        "vehicles": {k: int(veh[k]) for k in ("loaded", "inserted", "running", "waiting")},
        "teleports": int(tele["total"]),
        "arrived": int(veh["loaded"]) - int(veh["running"]) - int(veh["waiting"]),
        "mean_trip_s": float(trips["duration"]) if trips else None, "mean_time_loss_s": float(trips["timeLoss"]) if trips else None,
        "segments_without_simulated_traffic": len(groups[("no_sim_traffic", "")][0]),
        "speed_comparison": {f"{a}/{b}": stats(*v) for (a, b), v in sorted(groups.items()) if a != "no_sim_traffic" and len(v[0]) >= 5},
    }
    (out / "comparison.json").write_text(json.dumps(result, ensure_ascii=False, indent=2))
    print(json.dumps(result, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
