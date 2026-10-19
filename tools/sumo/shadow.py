"""Shadow simulation: at an incident, fork the running SUMO state and race several responses faster than real time.

  uv run --group sumo python tools/sumo/shadow.py --area=koridor                       # newest estimate, busiest motorway edge
  uv run --group sumo python tools/sumo/shadow.py --od-dir data/od/koridor/<run> --close 227609596 --at 20 --horizon 30

1. Warm-up. The estimate's demand (od.xml, as in run_od.py) runs mesoscopically from 0 to the incident time T, and
   SUMO saves its full state there (every vehicle, queue and route).
2. Fork. From that one state, each policy is simulated from T to T + horizon:
     no_incident   the reference: the road stays open
     unaware       the edge closes; drivers learn of it only on the edge just before it (a late, local detour)
     informed      the edge closes; every vehicle within --inform-hops edges upstream is told at once (variable
                   message signs / navigation apps), and all re-route every minute on current travel times
3. Verdict. Each branch's statistics (vehicles arrived, mean time loss, teleports, total delay against the
   reference) and the simulated-to-wall-clock speed-up. The decision is the simulation's; a language model, if one
   is used, only puts report.json into words (`--narrate` prints a plain template of it).

Writes <od-dir>/shadow/<edge>_t<T>/: state.xml, one folder per policy (stats.xml, sumo.log), report.json.
"""

from __future__ import annotations

import argparse
import csv
import json
import subprocess
import time
import xml.etree.ElementTree as ET
from collections import deque
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
POLICIES = ("no_incident", "unaware", "informed")


def busiest_expressway_edge(od_dir: Path) -> str:
    """The most loaded motorway/trunk edge of the estimate (link_flows.csv): a closure that matters."""
    best, flow = None, -1.0
    with open(od_dir / "link_flows.csv", encoding="utf-8") as f:
        for r in csv.DictReader(f):
            if r["type"] in ("motorway", "trunk") and float(r["flow"]) > flow:
                best, flow = r["edges"].split()[0], float(r["flow"])
    return best


def upstream(net, edge_id: str, hops: int) -> list[str]:
    """Edges from which the closed edge can be reached within `hops` edges (breadth first, against the flow)."""
    seen, queue = {edge_id}, deque([(net.getEdge(edge_id), 0)])
    while queue:
        e, d = queue.popleft()
        if d == hops:
            continue
        for p in e.getIncoming():
            if p.getID() not in seen and p.allows("passenger"):
                seen.add(p.getID()); queue.append((p, d + 1))
    seen.discard(edge_id)
    return sorted(seen)


def stats(path: Path) -> dict:
    root = ET.parse(path).getroot()
    v, t, tel = root.find("vehicles"), root.find("vehicleTripStatistics"), root.find("teleports")
    out = {"inserted": int(v.get("inserted")), "running": int(v.get("running")), "waiting_to_enter": int(v.get("waiting", 0)),
           "teleports": int(tel.get("total")) if tel is not None else 0,
           "real_time_factor": float(root.find("performance").get("realTimeFactor"))}
    if t is not None:  # (written with --duration-log.statistics)
        out.update({"arrived": int(t.get("count")), "mean_duration_s": float(t.get("duration")),
                    "mean_time_loss_s": float(t.get("timeLoss")), "mean_depart_delay_s": float(t.get("departDelay", 0))})
    return out


def main() -> None:
    import sumo
    import sumolib
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--area", default="koridor")
    parser.add_argument("--od-dir", type=Path, help="an estimate's folder (default: the newest with od.xml)")
    parser.add_argument("--close", help="edge id to close (default: the estimate's busiest motorway/trunk edge)")
    parser.add_argument("--at", type=int, default=20, help="incident time, minutes after the start (default 20)")
    parser.add_argument("--horizon", type=int, default=30, help="minutes simulated after the incident (default 30)")
    parser.add_argument("--inform-hops", type=int, default=30, help="edges upstream told at once in 'informed'")
    parser.add_argument("--seed", type=int, default=1)
    parser.add_argument("--narrate", action="store_true", help="print the verdict as a short text")
    args = parser.parse_args()

    od_dir = (args.od_dir or max((ROOT / "data" / "od" / args.area).glob("*/od.xml")).parent).resolve()
    net_path = ROOT / "data" / "sumo" / args.area / f"{args.area}.net.xml.gz"
    home = Path(sumo.SUMO_HOME)
    net = sumolib.net.readNet(str(net_path), withInternal=False)
    edge = args.close or busiest_expressway_edge(od_dir)
    T, H = args.at * 60, (args.at + args.horizon) * 60
    out = od_dir / "shadow" / f"{edge}_t{args.at}"
    out.mkdir(parents=True, exist_ok=True)
    e = net.getEdge(edge)
    print(f"incident: close {edge} ({e.getName() or 'unnamed'}, {e.getLaneNumber()} lanes) at minute {args.at}, horizon {args.horizon} min")

    # demand over the whole run, as run_od.py does
    tree = ET.parse(od_dir / "od.xml")
    interval = tree.getroot().find("interval")
    interval.set("end", str(H))
    for rel in interval.findall("tazRelation"):
        rel.set("count", f"{float(rel.get('count')) * H / 3600:.2f}")
    tree.write(out / "od_run.xml")
    subprocess.run([str(home / "bin" / "od2trips"), "--taz-files", str(od_dir / "taz.xml"), "--tazrelation-files", str(out / "od_run.xml"),
                    "-o", str(out / "trips.xml"), "--spread.uniform", "--different-source-sink", "--departlane", "best",
                    "--departspeed", "max", "--seed", str(args.seed), "--no-step-log"], check=True, capture_output=True)
    base = [str(home / "bin" / "sumo"), "-n", str(net_path), "-r", str(out / "trips.xml"), "--seed", str(args.seed),
            "--routing-algorithm", "astar", "--time-to-teleport", "300", "--ignore-route-errors", "--no-step-log",
            "--mesosim", "--meso-junction-control.limited", "--meso-tls-flow-penalty", "1", "--device.rerouting.threads", "4"]

    # 1: warm-up to the incident, state saved
    t0 = time.time()
    subprocess.run(base + ["--begin", "0", "--end", str(T + 1),  # (state is written at the end of step T)
                           "--device.rerouting.probability", "1", "--device.rerouting.period", "120",
                           "--save-state.times", str(T), "--save-state.files", str(out / "state.xml"),
                           "--log", str(out / "warmup.log")], check=True, cwd=out, capture_output=True)
    print(f"  warm-up {args.at} min simulated in {time.time() - t0:.0f} s; state saved")

    # 2: the branches, each from the same state
    report = {"edge": edge, "edge_name": e.getName(), "lanes": e.getLaneNumber(), "incident_minute": args.at,
              "horizon_minutes": args.horizon, "estimate": od_dir.name, "policies": {}}
    for policy in POLICIES:
        d = out / policy
        d.mkdir(exist_ok=True)
        extra = ["--device.rerouting.probability", "1", "--device.rerouting.period", "120"]
        if policy != "no_incident":
            told = upstream(net, edge, 1 if policy == "unaware" else args.inform_hops)
            (d / "closure.add.xml").write_text(
                f'<additional>\n  <rerouter id="incident" edges="{" ".join(told)}" probability="1">\n'
                f'    <interval begin="{T}" end="{H}"><closingReroute id="{edge}"/></interval>\n  </rerouter>\n</additional>\n',
                encoding="utf-8")
            extra = ["-a", str(d / "closure.add.xml")]
            if policy == "informed":
                extra += ["--device.rerouting.probability", "1", "--device.rerouting.period", "60"]
            else:  # (unaware drivers keep the route they planned until the last edge)
                extra += ["--device.rerouting.probability", "0"]
        t1 = time.time()
        subprocess.run(base + extra + ["--load-state", str(out / "state.xml"), "--begin", str(T), "--end", str(H),
                                       "--statistic-output", str(d / "stats.xml"), "--duration-log.statistics", "--log", str(d / "sumo.log")],
                       check=True, cwd=d, capture_output=True)
        wall = time.time() - t1
        s = stats(d / "stats.xml")
        s["wall_s"] = round(wall, 1)
        s["speedup_vs_real_time"] = round((H - T) / max(wall, 1e-3), 1)
        report["policies"][policy] = s
        s["backlog"] = s["running"] + s["waiting_to_enter"]  # still in the network or queued to enter at the end
        print(f"  {policy:12} arrived {s.get('arrived', 0):6d}, backlog {s['backlog']:6d}, mean time loss {s.get('mean_time_loss_s', 0):6.0f} s, "
              f"teleports {s['teleports']:4d}, {s['speedup_vs_real_time']:.1f}x real time")

    # 3: the verdict. The mean time loss covers only the vehicles that arrived (those stuck behind the closure are
    # not in it), so the policies are ranked first on vehicles served and the backlog left, then on time loss.
    ref = report["policies"]["no_incident"]
    for p in ("unaware", "informed"):
        s = report["policies"][p]
        s["served_vs_open_road"] = s.get("arrived", 0) - ref.get("arrived", 0)
        s["backlog_vs_open_road"] = s["backlog"] - ref["backlog"]
    best = max(("unaware", "informed"), key=lambda p: (report["policies"][p].get("arrived", 0) - report["policies"][p]["backlog"],
                                                      -report["policies"][p].get("mean_time_loss_s", 0)))
    report["recommended"] = best
    (out / "report.json").write_text(json.dumps(report, indent=2, ensure_ascii=False), encoding="utf-8")
    if args.narrate:
        u, i = report["policies"]["unaware"], report["policies"]["informed"]
        print(f"\nClosing {report['edge_name'] or edge} at minute {args.at} for {args.horizon} minutes: against the open road, "
              f"unaware drivers leave {u['backlog_vs_open_road']:+d} vehicles of backlog and informed drivers {i['backlog_vs_open_road']:+d}; "
              f"informing gets {i.get('arrived', 0) - u.get('arrived', 0):+d} more vehicles through. Recommended: {best}.")
    print(f"→ {out / 'report.json'}")


if __name__ == "__main__":
    main()
