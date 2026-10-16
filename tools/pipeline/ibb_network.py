import argparse
import json
from datetime import date, datetime
from pathlib import Path

import fiona
from pyproj import Transformer
from shapely.geometry import box, mapping, shape
from shapely.ops import transform


def source_bbox(bounds, project, steps=16):
    west, south, east, north = bounds
    boundary = []
    for i in range(steps + 1):
        t = i / steps
        boundary.extend(((west + (east - west) * t, south), (west + (east - west) * t, north)))
        boundary.extend(((west, south + (north - south) * t), (east, south + (north - south) * t)))
    points = [project.transform(lon, lat) for lon, lat in boundary]
    return (
        min(x for x, _ in points) - 100,
        min(y for _, y in points) - 100,
        max(x for x, _ in points) + 100,
        max(y for _, y in points) + 100,
    )


def json_value(value):
    if isinstance(value, (date, datetime)):
        return value.isoformat()
    return value


def main():
    parser = argparse.ArgumentParser(description="Export an area from the IBB File Geodatabase to WGS84 GeoJSON.")
    parser.add_argument("--gdb", required=True)
    parser.add_argument("--layer", default="networktraffic")
    parser.add_argument("--bbox", required=True, help="west,south,east,north in longitude/latitude")
    parser.add_argument("--output", required=True)
    args = parser.parse_args()

    bounds = tuple(float(value) for value in args.bbox.split(","))
    if len(bounds) != 4:
        parser.error("--bbox must contain west,south,east,north")
    area = box(bounds[0], bounds[1], bounds[2], bounds[3])
    features = []

    with fiona.open(args.gdb, layer=args.layer) as source:
        to_source = Transformer.from_crs("EPSG:4326", source.crs_wkt, always_xy=True)
        to_wgs84 = Transformer.from_crs(source.crs_wkt, "EPSG:4326", always_xy=True)
        query_bounds = source_bbox(bounds, to_source)

        for record in source.filter(bbox=query_bounds):
            if not record.geometry:
                continue
            geometry = transform(to_wgs84.transform, shape(record.geometry))
            if not geometry.intersects(area):
                continue
            properties = {
                name: json_value(value)
                for name, value in record.properties.items()
                if value is not None and name != "SE_ANNO_CAD_DATA"
            }
            features.append({
                "type": "Feature",
                "id": record.id,
                "geometry": mapping(geometry),
                "properties": properties,
            })

    output = Path(args.output)
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps({"type": "FeatureCollection", "features": features}, ensure_ascii=False), encoding="utf-8")
    print(f"IBB network: {len(features)} features -> {output}")


if __name__ == "__main__":
    main()