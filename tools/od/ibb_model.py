"""Read İBB's 2020 transport model (data.ibb.gov.tr, "Ulaşım Talep Tahmin Modeli Verisi") into usable tables.

  uv run python tools/od/ibb_model.py            # data/ibb-open/ag2020.kmz -> data/ibb-open/ag2020_links.parquet

The road network comes as a KMZ: one placemark per link, its attributes in an HTML table, its geometry a
LineString. This flattens it to one row per link: the attributes (ID, lanes, free-flow speed, capacity per
direction, BPR alpha and beta, functional class, ...) and the geometry as WKT (lon lat).
"""

from __future__ import annotations

import re
import sys
import zipfile
from pathlib import Path
from xml.etree.ElementTree import iterparse

ROOT = Path(__file__).resolve().parents[2]
KML = "{http://www.opengis.net/kml/2.2}"
CELL = re.compile(r"<td>([^<]*)</td>\s*<td>([^<]*)</td>")


def links(kmz: Path):
    with zipfile.ZipFile(kmz) as z:
        with z.open("doc.kml") as f:
            for _, el in iterparse(f, events=("end",)):
                if el.tag != KML + "Placemark":
                    continue
                desc = el.findtext(KML + "description") or ""
                row = {k.strip(): v.strip() for k, v in CELL.findall(desc)}
                coords = el.findtext(f".//{KML}LineString/{KML}coordinates") or ""
                pts = [c.split(",")[:2] for c in coords.split()]
                row["wkt"] = "LINESTRING (" + ", ".join(f"{x} {y}" for x, y in pts) + ")" if len(pts) >= 2 else None
                el.clear()
                yield row


def number(v):
    try:
        f = float(v)
        return int(f) if f.is_integer() else f
    except (TypeError, ValueError):
        return v


def main() -> None:
    import pyarrow as pa
    import pyarrow.parquet as pq
    src = ROOT / "data/ibb-open/ag2020.kmz"
    rows = [{k: number(v) for k, v in r.items()} for r in links(src)]
    keys = sorted({k for r in rows for k in r})
    table = pa.table({k: [r.get(k) if not isinstance(r.get(k), str) or k == "wkt" else None for r in rows] if k != "wkt" else [r.get(k) for r in rows] for k in keys})
    out = src.with_name("ag2020_links.parquet")
    pq.write_table(table, out)
    print(f"{len(rows)} links, {len(keys)} columns -> {out}")


if __name__ == "__main__":
    main()
