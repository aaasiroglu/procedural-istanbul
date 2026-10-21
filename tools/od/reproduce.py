"""Reproduce the reference corridor estimate from the committed data snapshot, and check it.

  npm run reproduce                      # = uv run --group sumo python tools/od/reproduce.py
  npm run reproduce -- --update          # after a deliberate change to the method: rewrite expected.json

The snapshot (data/snapshot/koridor/) holds every input the estimate needs, frozen on 19 October 2026 at 11:30:
the SUMO network, the İBB segment-to-edge matching, the land-use extract behind the prior, İBB's speeds at that
moment, the October 2024 sensor counts for 11:00 and the İstanbulkart anchor. Nothing is downloaded, so a fresh
clone gets the same numbers as the README and the report; expected.json holds them, with the tolerance each one is
checked to (the optimisation is not bit-identical across platforms and library versions).
"""

from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SNAP = ROOT / "data" / "snapshot" / "koridor"
OUT = ROOT / "data" / "od" / "koridor" / "reproduce"


def pick(summary: dict) -> dict:
    """The numbers the README reports, from an estimate's summary.json."""
    v, lvl = summary["validation"], summary["level_of_demand"]
    return {
        "prior_trips_per_hour": summary["car_trips_per_hour"]["prior"],
        "estimate_trips_per_hour": summary["car_trips_per_hour"]["estimate"],
        "level_factor": lvl["factor"],
        "level_ci95_low": lvl["ci95"][0],
        "level_ci95_high": lvl["ci95"][1],
        "level_data_share": lvl["data_share"],
        "data_share_trip_weighted": summary["data_share"]["trip_weighted_mean"],
        "held_out_geh_under5_pct": v["held_out"]["under5_pct"],
        "held_out_geh_mean": v["held_out"]["mean"],
        "prior_geh_mean": v["prior"]["mean"],
        "counts_used": summary["observations"].get("count", 0),
    }


# how far each number may move: ("rel", fraction) or ("abs", amount)
TOLERANCE = {
    "prior_trips_per_hour": ("rel", 0.01),
    "estimate_trips_per_hour": ("rel", 0.03),
    "level_factor": ("abs", 0.03),
    "level_ci95_low": ("abs", 0.04),
    "level_ci95_high": ("abs", 0.06),
    "level_data_share": ("abs", 0.03),
    "data_share_trip_weighted": ("abs", 0.03),
    "held_out_geh_under5_pct": ("abs", 9.0),  # (one count of the held-out set either side of GEH 5)
    "held_out_geh_mean": ("rel", 0.06),
    "prior_geh_mean": ("rel", 0.02),
    "counts_used": ("abs", 0),
}


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--update", action="store_true", help="write this run's numbers to expected.json")
    args = parser.parse_args()
    sys.stdout.reconfigure(encoding="utf-8")  # (Windows consoles default to a code page without →)

    cmd = [sys.executable, str(ROOT / "tools" / "od" / "corridor.py"), "--area=koridor", "--sumo-dir", str(SNAP),
           "--speeds", str(SNAP / "20261019-1130" / "speeds.csv"), "--counts", str(SNAP / "counts_202410_d0_h11.csv"),
           "--anchors", str(SNAP / "anchors_202410_h11.csv"), "--out", str(OUT)]
    t0 = time.time()
    print("running:", " ".join(Path(c).name if c.startswith(str(ROOT)) else c for c in cmd[1:]), flush=True)
    subprocess.run(cmd, cwd=ROOT, check=True, env={**os.environ, "PYTHONIOENCODING": "utf-8"})
    got = pick(json.loads((OUT / "summary.json").read_text(encoding="utf-8")))
    print(f"\nestimate made in {time.time() - t0:.0f} s → {OUT.relative_to(ROOT)}")

    expected_file = SNAP / "expected.json"
    if args.update:
        expected_file.write_text(json.dumps({k: round(v, 4) for k, v in got.items()}, indent=2) + "\n", encoding="utf-8")
        print(f"wrote {expected_file.relative_to(ROOT)}")
        return

    expected = json.loads(expected_file.read_text(encoding="utf-8"))
    failed = 0
    print(f"\n{'':28}{'expected':>12}{'got':>12}  tolerance")
    for key, want in expected.items():
        kind, tol = TOLERANCE[key]
        have = got[key]
        ok = abs(have - want) <= (tol * abs(want) if kind == "rel" else tol) + 1e-9
        failed += not ok
        print(f"{key:28}{want:12.3f}{have:12.3f}  {'±' + (f'{tol:.0%}' if kind == 'rel' else f'{tol:g}'):>6}  {'ok' if ok else 'DIFFERENT'}")
    if failed:
        sys.exit(f"\n{failed} number(s) outside tolerance: the method or a dependency changed the result")
    print("\nreproduced: every number within tolerance")


if __name__ == "__main__":
    main()
