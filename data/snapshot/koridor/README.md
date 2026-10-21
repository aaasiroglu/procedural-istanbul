# Reference snapshot: Maslak – 15 July Bridge corridor, 19 October 2026, 11:30

Every input of the reference O-D estimate, frozen so that `npm run reproduce` gives the same numbers on any machine without downloading anything.

| File | What it is | Made by |
|---|---|---|
| `koridor.net.xml.gz` | SUMO network of the corridor | `npm run sumo:net -- --area=koridor` |
| `ibb_edges.csv` | İBB speed segments matched to SUMO edges | `npm run sumo:map-ibb -- --area=koridor` |
| `ibb_model_edges.csv` | İBB 2020 model links (capacity, BPR) matched to SUMO edges | `tools/sumo/map_ibb_model.py` |
| `landuse.osm.json.gz` | OSM buildings and points of interest behind the land-use prior | `tools/od/corridor.py` (Overpass, cached) |
| `20261019-1130/speeds.csv` | İBB's live segment speeds at 11:30 on Monday 19 October 2026 | `tools/od/corridor.py` (saved with each estimate) |
| `counts_202410_d0_h11.csv` (+ `.json`) | İBB sensor counts, Mondays of October 2024, 11:00–12:00 | `tools/od/counts.py` |
| `anchors_202410_h11.csv` | İstanbulkart boardings as a rough plausibility anchor | `tools/od/anchors.py` |
| `expected.json` | the numbers `npm run reproduce` checks against, with tolerances in `tools/od/reproduce.py` | `npm run reproduce -- --update` |

## Expected result

| | |
|---|---|
| Car trips per hour | prior 117.9 k → estimate 63.6 k (÷1.85) |
| Level factor | 0.30 (95 %: 0.20–0.45), data share 0.81: the counts pin the level down |
| Held-out GEH (23 counters, leave-one-out) | 8.7 % under 5, mean 23.5 (prior: mean 38.3) |

The technical report and the app's data quote 61.6 k trips and a held-out mean of 22.9: that estimate was made from the same inputs by the earlier version of `corridor.py`, which connected each zone to the network at one node instead of eight. The level factor, the data share and the GEH < 5 share are the same in both.

Data: © OpenStreetMap contributors (ODbL), © İBB Açık Veri / UYM.
