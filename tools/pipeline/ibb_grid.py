#!/usr/bin/env python3
"""Make an occupied 10 km UTM cell list from the IBB network GDB."""
from __future__ import annotations

import argparse
import json
from pathlib import Path

try:
    import fiona
    from pyproj import Transformer
except ImportError as e:
    raise SystemExit(f"Eksik Python GIS kütüphanesi ({e}). Lütfen şu komutu çalıştırın: pip install fiona pyproj shapely")

ROOT = Path(__file__).resolve().parents[2]
GDB = ROOT / "data/ibb-local/network.gdb"
OUTPUT = ROOT / "data/ibb-local/areas.json"
CELL = 10_000


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--cell", type=float, default=CELL, help="cell size in metres")
    args = parser.parse_args()
    if not GDB.exists():
        raise SystemExit(f"GDB not found: {GDB}")
    areas = []
    with fiona.open(GDB, layer="networktraffic") as src:
        x0, y0, x1, y1 = src.bounds
        to_ll = Transformer.from_crs(src.crs_wkt, "EPSG:4326", always_xy=True)
        # The grid is expressed in the GDB's native CRS so clipping remains reliable.
        to_native = Transformer.from_crs("EPSG:4326", src.crs_wkt, always_xy=True)
        px0 = int((x0 // args.cell) * args.cell)
        py0 = int((y0 // args.cell) * args.cell)
        px1 = int((x1 // args.cell) * args.cell)
        py1 = int((y1 // args.cell) * args.cell)
        for ix in range(px0, px1 + 1, int(args.cell)):
            for iy in range(py0, py1 + 1, int(args.cell)):
                box = (ix, iy, ix + args.cell, iy + args.cell)
                if not any(True for _ in src.filter(bbox=box)):
                    continue
                lon0, lat0 = to_ll.transform(box[0], box[1])
                lon1, lat1 = to_ll.transform(box[2], box[3])
                lon = (lon0 + lon1) / 2
                lat = (lat0 + lat1) / 2
                areas.append({
                    "id": f"istanbul-{ix}-{iy}",
                    "name": f"İstanbul grid {ix / args.cell:g}_{iy / args.cell:g}",
                    "origin": [lon, lat],
                    "radius": 0.5,
                    "bbox": { "west": lon0, "south": lat0, "east": lon1, "north": lat1 },
                    "view": "0,0,500,220,28",
                    "source": "network.gdb",
                    "cell": args.cell,
                    "nativeBbox": [box[0], box[1], box[2], box[3]],
                    "ortho": False,
                })
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT.write_text(json.dumps(areas, indent=2, ensure_ascii=False), encoding="utf-8")
    print(f"wrote {len(areas)} grid cells to {OUTPUT}")


if __name__ == "__main__":
    main()
