# /// script
# requires-python = ">=3.10"
# dependencies = ["pyarrow>=15"]
# ///
"""Archive İBB UYM live traffic every few minutes as Parquet.

The live feed (tkmservices.ibb.gov.tr) only ever shows the current minute; this keeps its history for calibration
and analysis. Every poll writes one file per dataset, partitioned by local (Istanbul) date:

  <out>/segment_speeds/date=YYYY-MM-DD/HHMMSS.parquet   all ~12,700 segments: speed (km/h) and congestion class
  <out>/traffic_index/date=YYYY-MM-DD/HHMMSS.parquet    city, Anatolian side and European side traffic index
  <out>/segments/date=YYYY-MM-DD.parquet                segment geometry and district, once a day

The whole city is kept; cut the study area out at analysis time by joining on segment_id.

  uv run tools/archive/ibb_speeds.py                 # every 5 minutes until stopped
  uv run tools/archive/ibb_speeds.py --once          # a single poll (cron, testing)
"""

from __future__ import annotations

import argparse
import json
import logging
import os
import signal
import threading
import time
import urllib.request
from datetime import datetime, timedelta, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

import pyarrow as pa
import pyarrow.parquet as pq

API = "https://tkmservices.ibb.gov.tr/web/api/TrafficData"
SEGMENT_DATA = f"{API}/v4/SegmentData"
TRAFFIC_INDEX = f"{API}/v1/TrafficIndex_Sc1_Cont"
SEGMENTS = f"{API}/v3/Segments/0"
ISTANBUL = ZoneInfo("Europe/Istanbul")
ROOT = Path(__file__).resolve().parents[2]
RETRIES = (5, 15, 45)  # seconds to wait before each retry of a failed request

log = logging.getLogger("ibb-archive")

UTC_TS = pa.timestamp("us", tz="UTC")
SPEED_SCHEMA = pa.schema([
    ("fetched_at", UTC_TS),      # when this poll ran
    ("source_time", UTC_TS),     # the feed's own timestamp (Date)
    ("measured_at", UTC_TS),     # the segment's measurement minute (D)
    ("type", pa.dictionary(pa.int8(), pa.string())),  # T: BM, FD, FE, ... (FE: closed, as traffic.js reads it)
    ("segment_id", pa.int32()),  # S
    ("speed_kph", pa.int16()),   # V
    ("congestion", pa.int8()),   # C: 1 free .. 5 jammed, 0 no data
])
INDEX_SCHEMA = pa.schema([
    ("fetched_at", UTC_TS),
    ("ti", pa.int16()),          # whole city
    ("ti_anatolian", pa.int16()),
    ("ti_european", pa.int16()),
])
SEGMENT_SCHEMA = pa.schema([
    ("segment_id", pa.int32()),
    ("district", pa.string()),
    ("wkt", pa.string()),        # LINESTRING in lon lat (WGS84)
])


def get_json(url: str, timeout: float):
    request = urllib.request.Request(url, headers={"Accept": "application/json", "User-Agent": "procedural-istanbul-archive"})
    for attempt, wait in enumerate((0, *RETRIES)):
        if wait:
            log.warning("retrying %s in %ss", url, wait)
            if STOP.wait(wait):
                raise InterruptedError
        try:
            with urllib.request.urlopen(request, timeout=timeout) as response:
                return json.load(response)
        except Exception as error:  # network, HTTP or JSON: all worth a retry
            if attempt == len(RETRIES):
                raise
            log.warning("%s failed: %s", url, error)


def write(table: pa.Table, path: Path) -> None:
    # (written beside and renamed, so a reader never sees half a file)
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(".parquet.tmp")
    pq.write_table(table, tmp, compression="zstd")
    os.replace(tmp, path)


def measured_at(minute: str, source: datetime) -> datetime:
    # D is a local "HH:MM" without a date: the feed's date, or the day before just after midnight
    h, m = map(int, minute.split(":"))
    t = source.replace(hour=h, minute=m, second=0, microsecond=0)
    return t - timedelta(days=1) if t > source + timedelta(minutes=5) else t


def speeds_table(payload: dict, fetched: datetime) -> tuple[pa.Table, datetime]:
    source = datetime.fromisoformat(payload["Date"]).astimezone(ISTANBUL)
    rows = payload["Data"]
    minutes = {d: measured_at(d, source).astimezone(timezone.utc) for d in {r["D"] for r in rows}}
    table = pa.table({
        "fetched_at": [fetched] * len(rows),
        "source_time": [source.astimezone(timezone.utc)] * len(rows),
        "measured_at": [minutes[r["D"]] for r in rows],
        "type": [r["T"] for r in rows],
        "segment_id": [r["S"] for r in rows],
        "speed_kph": [r["V"] for r in rows],
        "congestion": [r["C"] for r in rows],
    }, schema=SPEED_SCHEMA)
    return table, source


def segments_table(payload: list) -> pa.Table:
    def wkt(g: str) -> str:
        return "LINESTRING (" + ", ".join(f"{lon} {lat}" for lat, lon in json.loads(g)) + ")"
    return pa.table({
        "segment_id": [s["S"] for s in payload],
        "district": [s.get("Z") for s in payload],
        "wkt": [wkt(s["G"]) for s in payload],
    }, schema=SEGMENT_SCHEMA)


class Archiver:
    def __init__(self, out: Path, timeout: float):
        self.out, self.timeout, self.last_source = out, timeout, None

    def poll(self) -> None:
        fetched = datetime.now(timezone.utc)
        local = fetched.astimezone(ISTANBUL)
        day, stamp = local.strftime("%Y-%m-%d"), local.strftime("%H%M%S")

        index = get_json(TRAFFIC_INDEX, self.timeout)
        write(pa.table({
            "fetched_at": [fetched], "ti": [index.get("TI")], "ti_anatolian": [index.get("TI_An")], "ti_european": [index.get("TI_Av")],
        }, schema=INDEX_SCHEMA), self.out / "traffic_index" / f"date={day}" / f"{stamp}.parquet")

        table, source = speeds_table(get_json(SEGMENT_DATA, self.timeout), fetched)
        if source == self.last_source:
            log.info("feed unchanged since %s, speeds not written", source.strftime("%H:%M:%S"))
        else:
            write(table, self.out / "segment_speeds" / f"date={day}" / f"{stamp}.parquet")
            self.last_source = source
            log.info("TI %s · %d segments · feed %s", index.get("TI"), table.num_rows, source.strftime("%H:%M:%S"))

        geometry = self.out / "segments" / f"date={day}.parquet"
        if not geometry.exists():
            segments = segments_table(get_json(SEGMENTS, self.timeout * 4))
            write(segments, geometry)
            log.info("segment geometry: %d segments", segments.num_rows)


STOP = threading.Event()


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--out", type=Path, default=ROOT / "data/archive/ibb", help="archive root (default: data/archive/ibb)")
    parser.add_argument("--interval", type=int, default=300, help="seconds between polls, on the clock (default: 300)")
    parser.add_argument("--timeout", type=float, default=30, help="seconds per request (default: 30)")
    parser.add_argument("--once", action="store_true", help="poll once and exit")
    args = parser.parse_args()
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    for sig in (signal.SIGINT, signal.SIGTERM):
        signal.signal(sig, lambda *_: STOP.set())

    archiver = Archiver(args.out, args.timeout)
    log.info("archiving to %s every %ss", args.out, args.interval)
    while not STOP.is_set():
        try:
            archiver.poll()
        except InterruptedError:
            break
        except Exception:
            log.exception("poll failed; trying again at the next interval")
        if args.once:
            break
        # wait for the next multiple of the interval (00:00, 00:05, ...), so polls line up across days
        STOP.wait(args.interval - time.time() % args.interval)
    log.info("stopped")


if __name__ == "__main__":
    main()
