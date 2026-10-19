"""First OD estimate for a real study area: SUMO network + İBB live speeds + a land-use prior.

  uv run --group sumo python tools/od/corridor.py --area=koridor                  # live speeds, now
  uv run --group sumo python tools/od/corridor.py --area=koridor --speeds f.parquet --counts counts.csv

Needs data/sumo/<area>/<area>.net.xml.gz and ibb_edges.csv (tools/sumo). Steps:

1. Zones. Interior zones are H3 cells (resolution 8, ~0.74 km²) with local-road nodes to connect to; gateway zones
   are the major roads crossing the area boundary (motorway .. secondary), clustered, so traffic passing through,
   e.g. over the bridge, has an origin and a destination too.
2. Assignment network. Car edges of the SUMO network as BPR links; capacity per lane by road type, times a green
   share where a signal ends the link. Turn restrictions are not modelled at this static level (SUMO routes them).
3. Prior. Trips produced and attracted per zone from OSM building floor area and points of interest, gateway flows
   from the capacity of the roads entering and leaving, joined by a doubly constrained gravity model. Every number
   in it is an assumption, listed in summary.json; the estimate's data share says where the data overrode it.
4. Observations. Each İBB segment's speed on its best matching edge, read as a bound (odme.TriangularFD) using İBB's
   own congestion class to tell free flow (1-2: at most capacity) from queueing (3-5: at least the congested-branch
   flow). Counts, if given, are exact observations: without any, the level of demand rests on the prior and the
   bounds only, and summary.json says so.
5. Bilevel estimate (UE assignment and estimation alternated), then outputs in data/od/<area>/<time>/:
   od.csv, zones.geojson, link_flows.csv, summary.json, and taz.xml + od.xml for SUMO's od2trips.
"""

from __future__ import annotations

import argparse
import csv
import json
import math
import sys
import time
import urllib.parse
import urllib.request
from collections import Counter, defaultdict
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

import h3
import numpy as np
from scipy.sparse import csr_matrix
from scipy.sparse.csgraph import dijkstra

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "sumo"))
from assignment import Network  # noqa: E402
from build_net import MIRRORS, USER_AGENT, area_bbox  # noqa: E402
from odme import (Observation, TriangularFD, estimate_bilevel, geh, geh_summary, level_identification, links_of, observed,  # noqa: E402
                  prior_weights)

ROOT = Path(__file__).resolve().parents[2]
ISTANBUL = ZoneInfo("Europe/Istanbul")
SEGMENT_DATA = "https://tkmservices.ibb.gov.tr/web/api/TrafficData/v4/SegmentData"
H3_RES = 8

# ---------------------------------------------------------------- assumptions (all of them, in one place)
ASSUMPTIONS = {
    "capacity_veh_h_lane": {"motorway": 2000, "trunk": 1900, "motorway_link": 1600, "trunk_link": 1600, "primary": 1700,
                            "primary_link": 1400, "secondary": 1500, "secondary_link": 1300, "tertiary": 1200,
                            "tertiary_link": 1100, "unclassified": 900, "residential": 700, "living_street": 400},
    "green_share_at_signal": 0.45,
    "jam_density_veh_km_lane": 140,
    "default_storeys": 4,
    "m2_per_dwelling": 110,
    "car_trips_per_dwelling_peak_hour": 0.30,
    "untyped_building_residential_share": 0.6,  # OSM building=yes: most of the stock in Istanbul
    "poi_m2_equivalent": 60,                    # a shop, office or amenity node counts as this much floor area
    "gateway_inbound_use_of_capacity": 0.55,    # peak direction
    "gateway_outbound_use_of_capacity": 0.35,
    "gravity_beta_per_min": 0.08,
    "link_parameters": "İBB 2020 model (capacity, free-flow speed, BPR) on matched edges; else class capacity and İBB's BPR by class",
    "prior_cv": 1.0,                            # prior uncertainty of every OD pair: +-100 % of its value
    "zone_connectors": 8,                       # local-road nodes a zone's trips enter and leave by, spread over the cell
    "zone_factor_sd": 1.0,                      # each zone's production / attraction factor: log-normal, sd 1 (x2.7)
    "demand_level_sd": 0.5,                     # the whole matrix's level: log-normal, sd 0.5 (x0.6 .. x1.6)
    "level_identified_above": 0.8,              # data share of the level needed to call it anchored
    "observed_road_types_excluded": ["residential", "living_street", "unclassified"],
}
UNINTERRUPTED = {"motorway", "trunk", "motorway_link", "trunk_link"}  # roads the fundamental diagram describes
MAJOR = {"motorway", "trunk", "primary", "secondary", "motorway_link", "trunk_link", "primary_link", "secondary_link"}
LOCAL = {"residential", "living_street", "unclassified", "tertiary", "tertiary_link"}
RESIDENTIAL = {"apartments", "residential", "house", "detached", "terrace", "dormitory", "semidetached_house"}


def road_type(edge) -> str:
    return (edge.getType() or "highway.unclassified").replace("highway.", "")


def lonlat_inside(bbox, lon, lat) -> bool:
    return bbox["west"] <= lon <= bbox["east"] and bbox["south"] <= lat <= bbox["north"]


# ---------------------------------------------------------------- 1-2: zones and the assignment network
# İBB's calibrated BPR coefficients (2020 model): expressways and their ramps, and every other road; used as
# they are where an edge matched an İBB link (tools/sumo/map_ibb_model.py), by class where it did not
BPR_EXPRESS, BPR_STREET = (0.158, 3.483), (0.924, 3.464)


def build(net, bbox, params_csv: Path | None = None):
    cap_lane, green = ASSUMPTIONS["capacity_veh_h_lane"], ASSUMPTIONS["green_share_at_signal"]
    params = {}
    if params_csv and params_csv.exists():
        with open(params_csv, encoding="utf-8") as f:
            params = {r["edge_id"]: r for r in csv.DictReader(f)}
    cars = [e for e in net.getEdges() if e.allows("passenger") and not e.getFunction()]
    node_ids = sorted({n.getID() for e in cars for n in (e.getFromNode(), e.getToNode())})
    nid = {n: i for i, n in enumerate(node_ids)}
    lonlat = {n: net.convertXY2LonLat(*net.getNode(n).getCoord()) for n in node_ids}

    # links, parallel edges merged (capacity added, the faster time kept)
    link_of_pair, links, edge_link = {}, [], {}
    for e in cars:
        kind = road_type(e)
        p = params.get(e.getID())
        if p:  # İBB's own capacity (veh/h, this direction), free-flow speed and BPR coefficients
            cap = float(p["capacity"])
            t0 = e.getLength() / (float(p["free_kph"]) / 3.6 if float(p["free_kph"]) > 5 else max(e.getSpeed(), 1)) / 60
            a, b = float(p["alpha"]), float(p["beta"])
        else:
            cap = e.getLaneNumber() * cap_lane.get(kind, 900) * (green if e.getToNode().getType() == "traffic_light" else 1)
            t0 = e.getLength() / max(e.getSpeed(), 1) / 60
            a, b = BPR_EXPRESS if kind in UNINTERRUPTED else BPR_STREET
        pair = (nid[e.getFromNode().getID()], nid[e.getToNode().getID()])
        if pair in link_of_pair:
            k = link_of_pair[pair]
            links[k]["cap"] += cap
            links[k]["t0"] = min(links[k]["t0"], t0)
            links[k]["edges"].append(e.getID())
        else:
            link_of_pair[pair] = len(links)
            links.append({"tail": pair[0], "head": pair[1], "t0": t0, "cap": cap, "edges": [e.getID()], "kind": kind,
                          "alpha": a, "beta": b, "ibb": bool(p)})
        edge_link[e.getID()] = link_of_pair[pair]

    # zones connect only to the largest strongly connected part of the road graph: from there every other zone
    # can be reached and left (one-way stubs cut by the boundary cannot)
    from scipy.sparse.csgraph import connected_components
    g = csr_matrix((np.ones(len(links)), ([l["tail"] for l in links], [l["head"] for l in links])), shape=(len(node_ids),) * 2)
    _, label = connected_components(g, directed=True, connection="strong")
    core = label == np.bincount(label).argmax()
    in_core = lambda n: bool(core[nid[n]])
    # a gateway's edges are often stubs the boundary cut (the bridge's Asian end): an entering edge only has to
    # lead into the core, a leaving one only has to be reachable from it
    from scipy.sparse.csgraph import breadth_first_order
    seed = int(np.flatnonzero(core)[0])
    from_core = np.zeros(len(node_ids), bool); from_core[breadth_first_order(g, seed, directed=True, return_predecessors=False)] = True
    to_core = np.zeros(len(node_ids), bool); to_core[breadth_first_order(g.T.tocsr(), seed, directed=True, return_predecessors=False)] = True

    # interior zones: H3 cells, connected at up to 3 local-road nodes near the cell centre
    local_nodes = defaultdict(list)
    for n in node_ids:
        lon, lat = lonlat[n]
        if not lonlat_inside(bbox, lon, lat) or not in_core(n):
            continue
        node = net.getNode(n)
        kinds = {road_type(e) for e in node.getIncoming() + node.getOutgoing() if e.allows("passenger")}
        if kinds and kinds <= LOCAL:
            local_nodes[h3.latlng_to_cell(lat, lon, H3_RES)].append(n)
    zones = []
    for cell, nodes in sorted(local_nodes.items()):
        clat, clon = h3.cell_to_latlng(cell)
        cx, cy = net.convertLonLat2XY(clon, clat)
        nodes.sort(key=lambda n: math.dist(net.getNode(n).getCoord(), (cx, cy)))
        # Spread the connectors over the cell (farthest-point sampling from the node nearest its centre): a zone's
        # traffic then enters and leaves the network at several places, as it does from its streets, instead of
        # queueing at one corner (the cause of local gridlock in SUMO, tools/sumo/README.md)
        pick = nodes[:1]
        while len(pick) < min(ASSUMPTIONS["zone_connectors"], len(nodes)):
            pick.append(max((n for n in nodes if n not in pick), key=lambda n: min(math.dist(net.getNode(n).getCoord(), net.getNode(m).getCoord()) for m in pick)))
        zones.append({"id": cell, "kind": "h3", "lon": clon, "lat": clat, "connect": pick})

    # gateway zones: major edges crossing the boundary, clustered within 500 m
    crossings = []
    for e in cars:
        if road_type(e) not in MAJOR:
            continue
        a, b = e.getFromNode().getID(), e.getToNode().getID()
        a_in, b_in = lonlat_inside(bbox, *lonlat[a]), lonlat_inside(bbox, *lonlat[b])
        if a_in != b_in and (to_core[nid[b]] if b_in else from_core[nid[a]]):
            mid = e.getShape()[len(e.getShape()) // 2]
            crossings.append({"edge": e, "entering": b_in, "xy": mid})
    clusters = []
    for c in sorted(crossings, key=lambda c: -c["edge"].getLaneNumber()):
        for cl in clusters:
            if math.dist(cl["xy"], c["xy"]) < 500:
                cl["members"].append(c)
                break
        else:
            clusters.append({"xy": c["xy"], "members": [c]})
    for k, cl in enumerate(clusters):
        names = Counter(m["edge"].getName() for m in cl["members"] if m["edge"].getName())
        lon, lat = net.convertXY2LonLat(*cl["xy"])
        ent = [m["edge"] for m in cl["members"] if m["entering"]]
        ext = [m["edge"] for m in cl["members"] if not m["entering"]]
        zones.append({"id": f"G{k:02d}", "kind": "gateway", "name": names.most_common(1)[0][0] if names else "", "lon": lon, "lat": lat,
                      "entering": [e.getID() for e in ent], "exiting": [e.getID() for e in ext],
                      "cap_in": sum(links[edge_link[e.getID()]]["cap"] for e in ent),
                      "cap_out": sum(links[edge_link[e.getID()]]["cap"] for e in ext)})

    # network: road nodes, then a source and a sink node per zone, joined by connectors
    n_road = len(node_ids)
    tail = [l["tail"] for l in links]; head = [l["head"] for l in links]
    t0 = [l["t0"] for l in links]; cap = [l["cap"] for l in links]
    sources, sinks = [], []
    for z_index, z in enumerate(zones):
        src, snk = n_road + 2 * z_index, n_road + 2 * z_index + 1
        sources.append(src); sinks.append(snk)
        if z["kind"] == "h3":
            outs = ins = [nid[n] for n in z["connect"]]
        else:
            outs = sorted({nid[net.getEdge(e).getFromNode().getID()] for e in z["entering"]})
            ins = sorted({nid[net.getEdge(e).getToNode().getID()] for e in z["exiting"]})
        for n in outs:
            tail.append(src); head.append(n); t0.append(0.5); cap.append(1e5)
        for n in ins:
            tail.append(n); head.append(snk); t0.append(0.5); cap.append(1e5)
    n_conn = len(tail) - len(links)  # (connectors: free flowing, alpha 0)
    alpha = [l["alpha"] for l in links] + [0.0] * n_conn
    beta = [l["beta"] for l in links] + [1.0] * n_conn
    network = Network(n_road + 2 * len(zones), tail, head, t0, cap, sources, sinks=sinks, alpha=alpha, beta=beta)
    return network, zones, links, edge_link


# ---------------------------------------------------------------- 3: the prior
def overpass_json(query: str, path: Path) -> dict:
    if path.exists():
        return json.loads(path.read_text(encoding="utf-8"))
    data = urllib.parse.urlencode({"data": query}).encode()
    for attempt in range(3):
        for url in MIRRORS:
            try:
                req = urllib.request.Request(url, data=data, headers={"User-Agent": USER_AGENT})
                with urllib.request.urlopen(req, timeout=400) as r:
                    body = json.load(r)
                path.write_text(json.dumps(body), encoding="utf-8")
                return body
            except Exception as error:
                print(f"  {url}: {error}")
        time.sleep(30 * (attempt + 1))
    sys.exit("Overpass: no mirror answered")


def land_use(net, bbox, cache: Path) -> dict:
    """Floor area (m²), residential and not, and points of interest per H3 cell."""
    b = f"{bbox['south']},{bbox['west']},{bbox['north']},{bbox['east']}"
    osm = overpass_json(f"""[out:json][timeout:400];
(way["building"]({b}); node["shop"]({b}); node["office"]({b}); node["amenity"]({b}););
out geom;""", cache)
    a = ASSUMPTIONS
    cells = defaultdict(lambda: {"res_m2": 0.0, "nonres_m2": 0.0, "poi": 0})
    for el in osm["elements"]:
        tags = el.get("tags", {})
        if el["type"] == "node":
            cells[h3.latlng_to_cell(el["lat"], el["lon"], H3_RES)]["poi"] += 1
            continue
        geom = el.get("geometry") or []
        if len(geom) < 3:
            continue
        xy = [net.convertLonLat2XY(p["lon"], p["lat"]) for p in geom]
        area = abs(sum(x0 * y1 - x1 * y0 for (x0, y0), (x1, y1) in zip(xy, xy[1:] + xy[:1]))) / 2
        try:
            storeys = float(tags["building:levels"])
        except (KeyError, ValueError):
            try:
                storeys = max(1.0, float(tags["height"].split()[0]) / 3.2)
            except (KeyError, ValueError, IndexError):
                storeys = a["default_storeys"]
        floor = area * storeys
        kind = tags.get("building", "yes")
        res_share = 1.0 if kind in RESIDENTIAL else a["untyped_building_residential_share"] if kind == "yes" else 0.0
        lat = sum(p["lat"] for p in geom) / len(geom); lon = sum(p["lon"] for p in geom) / len(geom)
        cell = cells[h3.latlng_to_cell(lat, lon, H3_RES)]
        cell["res_m2"] += floor * res_share
        cell["nonres_m2"] += floor * (1 - res_share)
    return cells


def gravity_prior(network: Network, zones, cells, pm: bool):
    a = ASSUMPTIONS
    Z = len(zones)
    gate = np.array([z["kind"] == "gateway" for z in zones])
    home, work = np.zeros(Z), np.zeros(Z)  # interior: trips from homes (veh/h), and the weight of work and errands
    for k, z in enumerate(zones):
        if z["kind"] == "h3":
            c = cells.get(z["id"], {"res_m2": 0, "nonres_m2": 0, "poi": 0})
            home[k] = c["res_m2"] / a["m2_per_dwelling"] * a["car_trips_per_dwelling_peak_hour"]
            work[k] = c["nonres_m2"] + a["poi_m2_equivalent"] * c["poi"]
    # Morning: homes produce, work attracts, the peak direction is into the area. Evening: the reverse. Gateways
    # keep each direction tied to its own capacity (only the peak share swaps), so a road that only leaves the area
    # never produces trips.
    use_in, use_out = a["gateway_inbound_use_of_capacity"], a["gateway_outbound_use_of_capacity"]
    if pm:
        use_in, use_out = use_out, use_in
    cap_in = np.array([z.get("cap_in", 0) for z in zones]); cap_out = np.array([z.get("cap_out", 0) for z in zones])
    interior_trips = home.sum()
    from_w, to_w = (work, home) if pm else (home, work)
    prod = np.where(gate, use_in * cap_in, from_w / max(from_w.sum(), 1e-9) * interior_trips)
    gate_attr = np.where(gate, use_out * cap_out, 0)
    rest = max(prod.sum() - gate_attr.sum(), 0)
    attr = np.where(gate, gate_attr, to_w / max(to_w.sum(), 1e-9) * rest)
    attr *= prod.sum() / max(attr.sum(), 1e-9)

    # free-flow zone-to-zone times, then the doubly constrained gravity model (Furness)
    graph = csr_matrix((network.t0, (network.tail, network.head)), shape=(network.n_nodes, network.n_nodes))
    t = dijkstra(graph, directed=True, indices=network.zones)[:, network.sinks]
    # (no trips where no route exists, e.g. into a gateway that only lets traffic in; through traffic between two
    # gateways, the bridge to the ring road, is allowed like any other pair)
    f = np.where(np.isfinite(t), np.exp(-a["gravity_beta_per_min"] * np.where(np.isfinite(t), t, 0)), 0.0)
    np.fill_diagonal(f, 0)
    x = prod[:, None] * attr[None, :] * f
    for _ in range(100):
        x *= (prod / np.maximum(x.sum(1), 1e-12))[:, None]
        x *= (attr / np.maximum(x.sum(0), 1e-12))[None, :]
    x = np.maximum(x, 1e-6 * (f > 0))  # every connected pair possible, however unlikely
    np.fill_diagonal(x, 0)
    return x.ravel(), prod, attr, t


def survey_blocks(x0, zones, path):
    """Rescale the prior's four trip types (inside the area, out of it, into it, through it) to the shares the
    household survey observed. Its sample touching the area is small (77 trip records for Istanbul's 17:00 hour in
    2012), too small for single cells but enough for these shares; the total stays the prior's, the counts set it."""
    Z = len(zones)
    gate = np.array([z["kind"] == "gateway" for z in zones])
    share = defaultdict(float)
    with open(path, encoding="utf-8") as f:
        for r in csv.DictReader(f):
            share[(r["o_kind"] == "gate", r["d_kind"] == "gate")] += float(r["vehicles"])
    total = sum(share.values())
    X = x0.reshape(Z, Z).copy()
    T = X.sum()
    for (og, dg), v in share.items():
        block = np.ix_(gate == og, gate == dg)
        if X[block].sum() > 0:
            X[block] *= (v / total) * T / X[block].sum()
    print("  survey trip types: " + ", ".join(f"{'gate' if og else 'zone'}→{'gate' if dg else 'zone'} {v / total:.0%}" for (og, dg), v in sorted(share.items())))
    ASSUMPTIONS["prior_trip_type_shares"] = {f"{'gate' if og else 'zone'}->{'gate' if dg else 'zone'}": round(v / total, 3) for (og, dg), v in share.items()}
    return X.ravel()


# ---------------------------------------------------------------- 4: observations
def live_speeds(path: str | None):
    if path and path.endswith(".csv"):  # (the snapshot an earlier estimate saved: speeds.csv in its folder)
        with open(path, encoding="utf-8") as f:
            rows = [{"T": r["type"], "S": int(r["segment_id"]), "V": int(r["speed_kph"]), "C": int(r["congestion"])} for r in csv.DictReader(f)]
        stamp = Path(path).parent.name[:13]  # YYYYMMDD-HHMM
        return rows, datetime.strptime(stamp, "%Y%m%d-%H%M").replace(tzinfo=ISTANBUL)
    if path:
        import pyarrow.parquet as pq
        rows = pq.read_table(path).to_pylist()
        when = rows[0]["source_time"].astimezone(ISTANBUL)
        return [{"T": r["type"], "S": r["segment_id"], "V": r["speed_kph"], "C": r["congestion"]} for r in rows], when
    req = urllib.request.Request(SEGMENT_DATA, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(req, timeout=60) as r:
        payload = json.load(r)
    return payload["Data"], datetime.fromisoformat(payload["Date"]).astimezone(ISTANBUL)


def observations(net, rows, mapping_csv: Path, edge_link, links, counts_csv: str | None):
    a = ASSUMPTIONS
    best = {}  # segment -> its edge with the longest coverage
    with open(mapping_csv, encoding="utf-8") as f:
        for r in csv.DictReader(f):
            s, cov = int(r["segment_id"]), float(r["coverage_m"])
            if s not in best or cov > best[s][1]:
                best[s] = (r["edge_id"], cov)
    stats, per_link = Counter(), defaultdict(list)
    role = {}  # segment -> how it entered the estimate (saved with it, so later checks can tell in-sample apart)
    for r in rows:
        s = int(r["S"])
        if s not in best:
            continue
        stats["segments_on_network"] += 1
        if r["T"] == "FE" or not r["C"] or not r["V"]:
            stats["skipped_closed_or_no_data"] += 1
            role[s] = "closed_or_no_data"
            continue
        edge = net.getEdge(best[s][0])
        if best[s][0] not in edge_link:
            continue
        link = edge_link[best[s][0]]
        if links[link]["kind"] in a["observed_road_types_excluded"]:
            # (local streets: their speed reflects parking and access more than through demand, and a static
            # model sends next to no route along them, so their bounds would only be violated, never informative)
            stats["skipped_local_street"] += 1
            role[s] = "local_street"
            continue
        lanes = edge.getLaneNumber()
        cap_lane = links[link]["cap"] / max(sum(net.getEdge(e).getLaneNumber() for e in links[link]["edges"]), 1)
        vf = max(edge.getSpeed() * 3.6, float(r["V"]) + 5)
        fd = TriangularFD(vf=vf, capacity=cap_lane, kj=a["jam_density_veh_km_lane"], lanes=lanes)
        if int(r["C"]) <= 2:
            obs = Observation(link, fd.capacity * lanes, fd.rel_sd * fd.capacity * lanes, "upper", f"İBB {s} C{r['C']}")
        elif links[link]["kind"] not in UNINTERRUPTED:
            # The fundamental diagram describes uninterrupted flow. On a signalised street a low speed is as much
            # the red phase as a queue, so it says nothing sure about demand: no bound (validated against İBB's
            # counts: these bounds inflated demand by a third and broke the fit, tools/od/README.md).
            stats["lower_skipped_interrupted_flow"] += 1
            role[s] = "congested_street_unused"
            continue
        else:
            obs = fd.observe(link, float(r["V"]), free_ratio=10)  # (C >= 3: İBB says queueing, take the congested branch)
            obs.source = f"İBB {s} C{r['C']} {r['V']} km/h"
        obs.segment = s
        per_link[(link, obs.kind)].append(obs)
    out = []
    for (link, kind), group in per_link.items():
        # several segments on one link: the tightest bound of each kind (they are not independent observations)
        chosen = max(group, key=lambda o: o.value) if kind == "lower" else min(group, key=lambda o: o.value)
        out.append(chosen)
        stats[kind] += 1
        for o in group:
            role[o.segment] = kind if o is chosen else f"redundant_{kind}"
    if counts_csv:
        # (edge_id may list several edges, e.g. both carriageways under a sensor: the count is their flows' sum)
        with open(counts_csv, encoding="utf-8") as f:
            for r in csv.DictReader(f):
                ids = sorted({edge_link[e] for e in r["edge_id"].split() if e in edge_link})
                if ids:
                    out.append(Observation(tuple(ids), float(r["value"]), float(r["sd"]), "count", r.get("source", "count")))
                    stats["count"] += 1
    return out, dict(stats), role


def read_anchors(path, zones):
    """OD-sum anchors (tools/od/anchors.py): each row's from/to selectors become the OD pairs it adds up."""
    Z = len(zones)

    def select(sel):
        if sel == "*":
            return set(range(Z))
        if sel == "h3":
            return {k for k, z in enumerate(zones) if z["kind"] == "h3"}
        ids = set(sel.split("|"))
        return {k for k, z in enumerate(zones) if z["id"] in ids}

    out = []
    with open(path, encoding="utf-8") as f:
        for r in csv.DictReader(f):
            pairs = tuple(sorted(i * Z + j for i in select(r["from"]) for j in select(r["to"]) if i != j))
            if pairs:
                out.append(Observation(pairs, float(r["value"]), float(r["sd"]), "od_sum", r.get("source", "anchor")))
                print(f"  anchor: {r['source'][:70]}  {float(r['value']):.0f} ± {float(r['sd']):.0f} over {len(pairs)} pairs")
    return out


# ---------------------------------------------------------------- 5: outputs
def write_outputs(out: Path, net, network, zones, links, est, x0, prod, attr, obs, meta, rows, role):
    out.mkdir(parents=True, exist_ok=True)
    # the speed snapshot the estimate saw, and what each segment was to it
    with open(out / "speeds.csv", "w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(["segment_id", "type", "speed_kph", "congestion", "role"])
        for r in rows:
            w.writerow([r["S"], r["T"], r["V"], r["C"], role.get(int(r["S"]), "off_network")])
    Z = len(zones)
    ids = [z["id"] for z in zones]
    with open(out / "od.csv", "w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(["origin", "destination", "prior", "trips", "se", "data_share"])
        for k in np.flatnonzero(est.x > 0.5):
            i, j = divmod(int(k), Z)
            w.writerow([ids[i], ids[j], round(x0[k], 2), round(est.x[k], 2),
                        round(est.se[k], 2) if est.se is not None else "", round(est.data_share[k], 3) if est.data_share is not None else ""])
    features = []
    for k, z in enumerate(zones):
        props = {"id": z["id"], "kind": z["kind"], "name": z.get("name", ""), "production": round(prod[k], 1), "attraction": round(attr[k], 1),
                 "estimated_out": round(est.x.reshape(Z, Z)[k].sum(), 1), "estimated_in": round(est.x.reshape(Z, Z)[:, k].sum(), 1)}
        if z["kind"] == "h3":
            ring = [[lon, lat] for lat, lon in h3.cell_to_boundary(z["id"])]
            features.append({"type": "Feature", "properties": props, "geometry": {"type": "Polygon", "coordinates": [ring + ring[:1]]}})
        else:
            features.append({"type": "Feature", "properties": props, "geometry": {"type": "Point", "coordinates": [z["lon"], z["lat"]]}})
    (out / "zones.geojson").write_text(json.dumps({"type": "FeatureCollection", "features": features}, ensure_ascii=False), encoding="utf-8")

    obs_by_link = defaultdict(list)
    for o in obs:
        if o.kind == "od_sum":  # (an anchor on the matrix, not on any link)
            continue
        for l in links_of(o):
            obs_by_link[l].append(f"{o.kind}:{o.value:.0f}")
    with open(out / "link_flows.csv", "w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(["edges", "type", "flow", "capacity", "v_c", "observations"])
        for k, l in enumerate(links):
            flow = est.flows[k]
            if flow > 1 or k in obs_by_link:
                w.writerow([" ".join(l["edges"]), l["kind"], round(flow, 1), round(l["cap"]), round(flow / l["cap"], 3), " ".join(obs_by_link[k])])

    # SUMO: districts (taz.xml) and the matrix as tazRelations (od.xml), for od2trips --tazrelation-files
    lines = ["<tazs>"]
    for z in zones:
        if z["kind"] == "h3":
            edges = sorted({e.getID() for n in z["connect"] for e in net.getNode(n).getOutgoing() + net.getNode(n).getIncoming() if e.allows("passenger")})
            lines.append(f'  <taz id="{z["id"]}" edges="{" ".join(edges)}"/>')
        else:
            lines.append(f'  <taz id="{z["id"]}">')
            lines += [f'    <tazSource id="{e}" weight="1"/>' for e in z["entering"]]
            lines += [f'    <tazSink id="{e}" weight="1"/>' for e in z["exiting"]]
            lines.append("  </taz>")
    lines.append("</tazs>")
    (out / "taz.xml").write_text("\n".join(lines) + "\n", encoding="utf-8")
    rel = ['<data>', '  <interval begin="0" end="3600">']  # (no id: od2trips would take it for the vehicle type)
    for k in np.flatnonzero(est.x >= 0.5):
        i, j = divmod(int(k), Z)
        rel.append(f'    <tazRelation from="{ids[i]}" to="{ids[j]}" count="{est.x[k]:.1f}"/>')
    rel += ["  </interval>", "</data>"]
    (out / "od.xml").write_text("\n".join(rel) + "\n", encoding="utf-8")
    (out / "summary.json").write_text(json.dumps(meta, ensure_ascii=False, indent=2, default=float), encoding="utf-8")


def main() -> None:
    import sumolib
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--area", default="koridor")
    parser.add_argument("--speeds", help="a segment_speeds Parquet file from the archive (default: live)")
    parser.add_argument("--counts", help="CSV of counts: edge_id,value,sd[,source] (veh/h)")
    parser.add_argument("--anchors", help="CSV of OD-sum anchors: from,to,value,sd,source (tools/od/anchors.py)")
    parser.add_argument("--rounds", type=int, default=8, help="bilevel rounds (default 8)")
    parser.add_argument("--tag", default="", help="appended to the output folder's name (e.g. counts)")
    parser.add_argument("--survey", help="survey_trips_h<hour>.csv (tools/od/survey_prior.py): rescale the prior's trip types to it")
    args = parser.parse_args()

    sumo_dir = ROOT / "data" / "sumo" / args.area
    bbox = area_bbox(args.area)
    print("network …")
    net = sumolib.net.readNet(str(sumo_dir / f"{args.area}.net.xml.gz"), withInternal=False)
    network, zones, links, edge_link = build(net, bbox, sumo_dir / "ibb_model_edges.csv")
    n_gate = sum(z["kind"] == "gateway" for z in zones)
    print(f"  {len(links)} links ({sum(l['ibb'] for l in links)} with İBB 2020 capacity and BPR), {len(zones) - n_gate} H3 zones, {n_gate} gateways, {len(zones) ** 2} OD pairs")

    rows, when = live_speeds(args.speeds)
    pm = when.hour >= 12
    print(f"speeds: {len(rows)} segments at {when:%Y-%m-%d %H:%M} ({'evening' if pm else 'morning'} prior)")

    print("land use …")
    cells = land_use(net, bbox, sumo_dir / "landuse.osm.json")
    x0, prod, attr, t = gravity_prior(network, zones, cells, pm)
    if args.survey:
        x0 = survey_blocks(x0, zones, args.survey)
    obs, obs_stats, role = observations(net, rows, sumo_dir / "ibb_edges.csv", edge_link, links, args.counts)
    if args.anchors:
        obs += read_anchors(args.anchors, zones)
        obs_stats["od_sum"] = sum(o.kind == "od_sum" for o in obs)
    print(f"  prior: {x0.sum():.0f} car trips/h; observations: {obs_stats}")

    lam = prior_weights(x0, ASSUMPTIONS["prior_cv"])
    from assignment import assign
    flow0, P0, _ = assign(network, x0, max_iter=40, gap=1e-3)
    # a count on links no route of the model can use (a road outside its zones' reach) cannot be explained by any
    # matrix: set aside and reported, rather than left to pull on the rest
    unusable = [o for o in obs if o.kind == "count" and all(P0[l].nnz == 0 for l in links_of(o))]
    obs = [o for o in obs if o not in unusable]
    for o in unusable:
        print(f"  count without any route through it, set aside: {o.source}")
    obs_stats["count"] = obs_stats.get("count", 0) - len(unusable)
    obs_stats["count_set_aside_no_route"] = len(unusable)
    viol_prior = sum(1 for o in obs if (o.kind == "lower" and o.value - observed(o, flow0) > 2 * o.sd) or (o.kind == "upper" and observed(o, flow0) - o.value > 2 * o.sd))

    print("bilevel estimate …")
    factors = {"zones": len(zones), "factor_sd": ASSUMPTIONS["zone_factor_sd"], "level_sd": ASSUMPTIONS["demand_level_sd"]}
    est = estimate_bilevel(network, x0, obs, lam, iters=args.rounds, assign_iter=40, assign_gap=1e-3, **factors,
                           log=lambda h: print(f"  round {h['iteration']}: OD change {h['od_change']:.4f}, gap {h['assignment_gap']:.1e}, bound violations {h['bound_violations']}"))

    # how far the counts pinned the level of demand down (a count can also be met by the zones it crosses alone)
    print("level of demand …")
    level = level_identification(est.info["P"], x0, obs, lam, **factors)
    level["identified"] = level["data_share"] >= ASSUMPTIONS["level_identified_above"]
    print(f"  factor {level['factor']:.2f} (95 % {level['ci95'][0]:.2f}–{level['ci95'][1]:.2f}), data share {level['data_share']:.2f}")

    Z = len(zones)
    ids = [z["id"] for z in zones]
    top = sorted(range(Z * Z), key=lambda k: -est.x[k])[:20]
    has_counts = obs_stats.get("count", 0) > 0
    validation = None
    if has_counts:
        # GEH three ways: the prior, the estimate on the counts it was fitted to (a fit, not a test), and each
        # count left out in turn and predicted by an estimate made without it (leave-one-out: the test)
        counts = [o for o in obs if o.kind == "count"]
        P = est.info["P"]
        held = {}
        for i, o in enumerate(counts):
            from odme import estimate as fit_once
            rest = [q for q in obs if q is not o]
            held[i] = observed(o, fit_once(P, x0, rest, lam, uncertainty=False, **factors).flows)
            print(f"  held out {i + 1}/{len(counts)}: {o.source[:48]} count {o.value:.0f}, predicted {held[i]:.0f}")
        prior_m = [observed(o, flow0) for o in counts]
        fit_m = [observed(o, est.flows) for o in counts]
        validation = {
            "prior": geh_summary(prior_m, [o.value for o in counts]),
            "fit": geh_summary(fit_m, [o.value for o in counts]),
            "held_out": geh_summary([held[i] for i in range(len(counts))], [o.value for o in counts]),
            "per_count": [{"source": o.source, "count": o.value, "sd": o.sd, "prior": round(prior_m[i]), "fit": round(fit_m[i]),
                           "held_out": round(held[i]), "geh_held_out": round(float(geh(held[i], o.value)), 2)} for i, o in enumerate(counts)],
        }
    meta = {
        "area": args.area, "speeds_at": when.isoformat(), "period": "evening" if pm else "morning",
        "zones": {"h3": Z - n_gate, "gateways": n_gate, "od_pairs": Z * Z},
        "observations": obs_stats,
        "car_trips_per_hour": {"prior": float(x0.sum()), "estimate": float(est.x.sum())},
        "bound_violations": {"prior": viol_prior, "estimate": est.bound_violations, "of": len(obs),
                             "on_links_no_route_uses": int(sum(1 for o in obs if all(est.info["P"][l].nnz == 0 for l in links_of(o))))},
        "validation": validation,
        "data_share": None if est.data_share is None else {
            "trip_weighted_mean": float((est.data_share * est.x).sum() / max(est.x.sum(), 1e-9)),
            "pairs_over_half": int((est.data_share > 0.5).sum())},
        "anchors": [{"source": o.source, "value": o.value, "sd": o.sd, "prior": float(x0[list(o.link)].sum()),
                     "estimate": float(est.x[list(o.link)].sum())} for o in obs if o.kind == "od_sum"],
        "level_of_demand": {**level, "verdict":
            "anchored by counts" if level["identified"] else
            "partly identified: the counts are also met by changing the zones they cross, so the total still leans on the prior" if has_counts else
            "NOT identified: no counts were given, so the total rests on the prior and only moves where speed bounds push it"},
        "bilevel": est.info.get("bilevel"),
        "top_pairs": [{"from": ids[k // Z], "to": ids[k % Z], "trips": round(float(est.x[k]), 1), "prior": round(float(x0[k]), 1),
                       "se": None if est.se is None else round(float(est.se[k]), 1),
                       "data_share": None if est.data_share is None else round(float(est.data_share[k]), 3)} for k in top],
        "gateways": [{"id": z["id"], "name": z["name"], "cap_in": round(z["cap_in"]), "cap_out": round(z["cap_out"]),
                      "lon": round(z["lon"], 5), "lat": round(z["lat"], 5)} for z in zones if z["kind"] == "gateway"],
        "assumptions": ASSUMPTIONS,
    }
    out = ROOT / "data" / "od" / args.area / (when.strftime("%Y%m%d-%H%M") + (f"-{args.tag}" if args.tag else ""))
    write_outputs(out, net, network, zones, links, est, x0, prod, attr, obs, meta, rows, role)
    print(json.dumps({k: meta[k] for k in ("zones", "observations", "car_trips_per_hour", "bound_violations", "data_share", "level_of_demand")}, ensure_ascii=False, indent=2))
    if validation:
        for k in ("prior", "fit", "held_out"):
            v = validation[k]
            print(f"  GEH {k:9}: {v['under5_pct']:5.1f} % under 5, mean {v['mean']:.2f}, max {v['max']:.2f}  (n {v['n']})")
    print(f"→ {out}")


if __name__ == "__main__":
    main()
