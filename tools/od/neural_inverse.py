"""Simulation-to-reality inverse solver: a neural network trained on simulated (OD -> speeds) pairs that reads the
corridor's demand straight from a speed snapshot, checked against the MAP estimator (tools/od/odme.py).

  uv run --group sumo --group ml python tools/od/neural_inverse.py --area=koridor --samples 400
  uv run --group sumo --group ml python tools/od/neural_inverse.py --area=koridor --speeds data/od/koridor/<run>/speeds.csv

1. Simulator. The corridor's assignment network (tools/od/corridor.py) under user equilibrium. Each training sample
   draws a matrix x = x0 exp(g + a_i + b_j + u_ij) around the land-use prior x0: a level g (uniform, x0.15 .. x1.5:
   the counts put the real level near x0.3, tools/od/README.md), zone factors a_i, b_j and pair noise u_ij
   (normal, sd 0.5 and 0.3), assigns it and reads the speed ratio (free-flow time / loaded time) on every link İBB
   observes. This first version uses the static assignment as the simulator, so thousands of samples cost minutes;
   SUMO-generated samples (tools/sumo/run_od.py) are the next step and plug in through the same arrays.
2. Targets. What the speeds can identify, not the 9 025 cells: the log of total demand and of each zone's
   production and attraction (1 + 2Z numbers).
3. Network. A multilayer perceptron (scikit-learn), inputs and outputs standardised; scored on held-out samples.
4. Reality. The live snapshot's speeds on the same links (İBB speed / the edge's free-flow speed) go through the
   network. Its total is compared with the MAP estimate's (summary.json of the newest count-anchored run): the
   estimator acts as the network's reference and auditor. A static model saturates differently from real streets,
   so the gap between simulated and real speed ratios (the sim-to-real gap) is measured and reported too.

Writes data/od/<area>/neural/: samples.npz, report.json.
"""

from __future__ import annotations

import argparse
import csv
import json
import sys
import time
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent))
import corridor as C  # noqa: E402
from assignment import assign  # noqa: E402

ROOT = Path(__file__).resolve().parents[2]


def observed_links(net, rows, mapping_csv, edge_link, links):
    """The links İBB observes (major roads, as in the estimator) and, for a snapshot, their speed ratio."""
    best = {}
    with open(mapping_csv, encoding="utf-8") as f:
        for r in csv.DictReader(f):
            s, cov = int(r["segment_id"]), float(r["coverage_m"])
            if s not in best or cov > best[s][1]:
                best[s] = (r["edge_id"], cov)
    ratio = {}
    for r in rows:
        s = int(r["S"])
        if s not in best or best[s][0] not in edge_link or not r["V"] or r["T"] == "FE":
            continue
        link = edge_link[best[s][0]]
        if links[link]["kind"] in C.ASSUMPTIONS["observed_road_types_excluded"]:
            continue
        vf = net.getEdge(best[s][0]).getSpeed() * 3.6
        ratio.setdefault(link, []).append(min(float(r["V"]) / max(vf, 1), 1.5))
    keep = sorted(ratio)
    return np.array(keep), np.array([np.median(ratio[k]) for k in keep])


def targets(x, Z):
    X = x.reshape(Z, Z)
    return np.concatenate([[np.log(X.sum())], np.log(X.sum(1) + 1), np.log(X.sum(0) + 1)])


def simulate(network, x0, Z, obs, n, rng, log_every=25):
    feats, ys, levels = [], [], []
    t0 = time.time()
    for k in range(n):
        g = rng.uniform(np.log(0.15), np.log(1.5))
        a, b = rng.normal(0, 0.5, Z), rng.normal(0, 0.5, Z)
        x = x0 * np.exp(g + np.repeat(a, Z) + np.tile(b, Z) + rng.normal(0, 0.3, Z * Z))
        flow, _, _ = assign(network, x, max_iter=15, gap=1e-3)
        cost = network.cost(flow)
        feats.append((network.t0 / cost)[obs]); ys.append(targets(x, Z)); levels.append(g)
        if (k + 1) % log_every == 0:
            print(f"  {k + 1}/{n} samples, {(time.time() - t0) / (k + 1):.1f} s each")
    return np.array(feats), np.array(ys), np.array(levels)


def draw_matrix(x0, Z, rng):
    g = rng.uniform(np.log(0.15), np.log(1.5))
    a, b = rng.normal(0, 0.5, Z), rng.normal(0, 0.5, Z)
    return x0 * np.exp(g + np.repeat(a, Z) + np.tile(b, Z) + rng.normal(0, 0.3, Z * Z)), g


def simulate_sumo(net_path, taz, zones, links, obs, x0, Z, n, rng, cache_dir, minutes=25, warmup=10):
    """Samples from mesoscopic SUMO: the matrix spread over `minutes`, routed and re-routed by the vehicles
    themselves, and the speed on each observed link's edge after `warmup`, as a share of the edge's speed limit
    (the same reading as İBB speed / speed limit for the live snapshot). Each sample is kept in cache_dir, so a long
    run can be stopped and resumed."""
    import subprocess
    import xml.etree.ElementTree as ET
    import sumo
    home = Path(sumo.SUMO_HOME)
    cache_dir.mkdir(parents=True, exist_ok=True)
    ids = [z["id"] for z in zones]
    edge_of = [links[k]["edges"][0] for k in obs]
    import sumolib
    net = sumolib.net.readNet(str(net_path), withInternal=False)
    limit = np.array([net.getEdge(e).getSpeed() * 3.6 for e in edge_of])
    feats, ys, levels = [], [], []
    t0 = time.time()
    for k in range(n):
        x, g = draw_matrix(x0, Z, rng)  # (drawn every time, so sample k is the same matrix with or without the cache)
        f = cache_dir / f"sample_{k:04d}.npz"
        if f.exists():
            d = np.load(f); feats.append(d["x"]); ys.append(d["y"]); levels.append(float(d["g"])); continue
        work = cache_dir / "work"; work.mkdir(exist_ok=True)
        end = minutes * 60
        rel = ['<data>', f'  <interval begin="0" end="{end}">']
        for w in np.flatnonzero(x * minutes / 60 >= 0.5):
            i, j = divmod(int(w), Z)
            rel.append(f'    <tazRelation from="{ids[i]}" to="{ids[j]}" count="{x[w] * minutes / 60:.1f}"/>')
        rel += ["  </interval>", "</data>"]
        (work / "od.xml").write_text("\n".join(rel) + "\n", encoding="utf-8")
        subprocess.run([str(home / "bin" / "od2trips"), "--taz-files", str(taz), "--tazrelation-files", str(work / "od.xml"),
                        "-o", str(work / "trips.xml"), "--spread.uniform", "--different-source-sink", "--departlane", "best",
                        "--departspeed", "max", "--seed", str(k), "--no-step-log"], check=True, capture_output=True)
        (work / "edgedata.add.xml").write_text(
            f'<additional>\n  <edgeData id="s" file="edgedata.xml" begin="{warmup * 60}" end="{end}" excludeEmpty="true"/>\n</additional>\n', encoding="utf-8")
        subprocess.run([str(home / "bin" / "sumo"), "-n", str(net_path), "-r", str(work / "trips.xml"), "-a", str(work / "edgedata.add.xml"),
                        "--begin", "0", "--end", str(end), "--seed", str(k), "--device.rerouting.probability", "1",
                        "--device.rerouting.period", "120", "--device.rerouting.threads", "4", "--routing-algorithm", "astar",
                        "--time-to-teleport", "300", "--ignore-route-errors", "--no-step-log", "--mesosim",
                        "--meso-junction-control.limited", "--meso-tls-flow-penalty", "1"], check=True, cwd=work, capture_output=True)
        speed = {e.get("id"): float(e.get("speed")) * 3.6 for e in ET.parse(work / "edgedata.xml").getroot().iter("edge") if e.get("speed")}
        # (an edge no vehicle used in the window is at free flow)
        fx = np.array([min(speed.get(e, lim) / max(lim, 1), 1.5) for e, lim in zip(edge_of, limit)])
        fy = targets(x, Z)
        np.savez_compressed(f, x=fx, y=fy, g=g)
        feats.append(fx); ys.append(fy); levels.append(g)
        done = k + 1
        print(f"  SUMO sample {done}/{n}: {time.time() - t0:.0f} s so far, median speed ratio {np.median(fx):.2f}", flush=True)
    return np.array(feats), np.array(ys), np.array(levels)


def main() -> None:
    import sumolib
    from sklearn.metrics import r2_score
    from sklearn.neural_network import MLPRegressor
    from sklearn.preprocessing import StandardScaler

    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--area", default="koridor")
    parser.add_argument("--speeds", help="speeds.csv of an estimate (default: the newest count-anchored run's)")
    parser.add_argument("--samples", type=int, default=400)
    parser.add_argument("--seed", type=int, default=0)
    parser.add_argument("--simulator", choices=["static", "sumo"], default="static",
                        help="static: UE assignment (fast); sumo: mesoscopic SUMO runs (slow, resumable)")
    args = parser.parse_args()

    od_dir = ROOT / "data" / "od" / args.area
    runs = sorted(p for p in od_dir.glob("2*") if (p / "summary.json").exists()
                  and isinstance(json.loads((p / "summary.json").read_text(encoding="utf-8")).get("level_of_demand"), dict))
    ref = runs[-1] if runs else None
    speeds = args.speeds or (str(ref / "speeds.csv") if ref else None)
    sumo_dir = ROOT / "data" / "sumo" / args.area
    print("network …")
    net = sumolib.net.readNet(str(sumo_dir / f"{args.area}.net.xml.gz"), withInternal=False)
    network, zones, links, edge_link = C.build(net, C.area_bbox(args.area), sumo_dir / "ibb_model_edges.csv")
    Z = len(zones)
    rows, when = C.live_speeds(speeds)
    cells = C.land_use(net, C.area_bbox(args.area), sumo_dir / "landuse.osm.json")
    x0, *_ = C.gravity_prior(network, zones, cells, when.hour >= 12)
    obs, real = observed_links(net, rows, sumo_dir / "ibb_edges.csv", edge_link, links)
    print(f"  {Z} zones, {len(obs)} observed links, snapshot {when:%Y-%m-%d %H:%M}")

    out = od_dir / "neural"
    out.mkdir(parents=True, exist_ok=True)
    cache = out / ("samples.npz" if args.simulator == "static" else "samples_sumo.npz")
    rng = np.random.default_rng(args.seed)
    if args.simulator == "sumo":
        taz = (ref / "taz.xml") if ref else None
        print(f"simulating {args.samples} SUMO samples (cached in {out / 'sumo'}) …")
        X, Y, G = simulate_sumo(sumo_dir / f"{args.area}.net.xml.gz", taz, zones, links, obs, x0, Z, args.samples, rng, out / "sumo")
        np.savez_compressed(cache, X=X, Y=Y, G=G, links=obs)
    elif cache.exists() and np.load(cache)["X"].shape == (args.samples, len(obs)):
        d = np.load(cache); X, Y, G = d["X"], d["Y"], d["G"]
        print(f"samples: {len(X)} from {cache.name}")
    else:
        print(f"simulating {args.samples} samples …")
        X, Y, G = simulate(network, x0, Z, obs, args.samples, rng)
        np.savez_compressed(cache, X=X, Y=Y, G=G, links=obs)

    n_test = max(len(X) // 5, 1)
    order = rng.permutation(len(X)); test, train = order[:n_test], order[n_test:]
    sx, sy = StandardScaler().fit(X[train]), StandardScaler().fit(Y[train])
    mlp = MLPRegressor(hidden_layer_sizes=(256, 128), alpha=1e-3, max_iter=2000, early_stopping=True, random_state=args.seed)
    mlp.fit(sx.transform(X[train]), sy.transform(Y[train]))
    pred = sy.inverse_transform(mlp.predict(sx.transform(X[test])))
    r2 = {"total": float(r2_score(Y[test, 0], pred[:, 0])),
          "productions": float(r2_score(Y[test, 1:1 + Z], pred[:, 1:1 + Z])),
          "attractions": float(r2_score(Y[test, 1 + Z:], pred[:, 1 + Z:]))}
    total_err = np.exp(np.abs(pred[:, 0] - Y[test, 0])) - 1
    print(f"held-out samples (n {n_test}): R² total {r2['total']:.3f}, productions {r2['productions']:.3f}, attractions {r2['attractions']:.3f}; "
          f"median total error {np.median(total_err):.1%}")

    # the sim-to-real gap: where the real speed ratios sit against what the simulator ever produced. A network
    # only interpolates, so the real input is clipped to the simulated range (and the result flagged by `outside`)
    lo, hi = np.percentile(X, 1, axis=0), np.percentile(X, 99, axis=0)
    outside = float(np.mean((real < lo) | (real > hi)))
    live = sy.inverse_transform(mlp.predict(sx.transform(np.clip(real, X.min(0), X.max(0))[None, :])))[0]
    live[0] = np.clip(live[0], Y[:, 0].min(), Y[:, 0].max())
    report = {
        "snapshot": when.isoformat(), "samples": int(len(X)), "observed_links": int(len(obs)),
        "held_out_r2": r2, "held_out_median_total_error": float(np.median(total_err)),
        "live": {"total_trips": float(np.exp(live[0])), "prior_total": float(x0.sum())},
        "trustworthy": outside < 0.2,
        "sim_to_real": {"real_ratio_median": float(np.median(real)), "sim_ratio_median": float(np.median(X)),
                        "share_of_links_outside_simulated_1_99_pct": outside},
    }
    if ref:
        s = json.loads((ref / "summary.json").read_text(encoding="utf-8"))
        report["reference_map_estimate"] = {"run": ref.name, "total_trips": s["car_trips_per_hour"]["estimate"],
                                            "level_ci95": s["level_of_demand"]["ci95"], "level_factor": s["level_of_demand"]["factor"]}
        mf = s["car_trips_per_hour"]["estimate"]
        report["live"]["vs_map"] = float(np.exp(live[0]) / mf)
        print(f"live snapshot: network {np.exp(live[0]):.0f} trips/h, MAP estimate {mf:.0f} (ratio {np.exp(live[0]) / mf:.2f}), prior {x0.sum():.0f}")
    print(f"sim-to-real: real speed ratio median {np.median(real):.2f}, simulated {np.median(X):.2f}; {outside:.0%} of links outside the simulated 1–99 % range")
    report["simulator"] = args.simulator
    (out / ("report.json" if args.simulator == "static" else "report_sumo.json")).write_text(json.dumps(report, indent=2), encoding="utf-8")
    print(f"→ {out / 'report.json'}")


if __name__ == "__main__":
    main()
