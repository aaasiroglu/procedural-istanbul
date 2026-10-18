---
marp: true
paginate: true
size: 16:9
title: Procedural Istanbul — Demand from Speeds and an Open Corridor Digital Twin in SUMO
footer: "Procedural Istanbul · SUMO & Traffic Modelling · UPC"
style: |
  :root { --ink: #1b2430; --muted: #5d6b7a; --accent: #0b5cad; --accent2: #e07b22; --line: #dde3ea; }
  section {
    font-family: "Inter", "Helvetica Neue", Arial, sans-serif;
    color: var(--ink); background: #ffffff;
    padding: 64px 72px 72px 72px;
    font-size: 23px; line-height: 1.45;
    display: flex; flex-direction: column; justify-content: flex-start;
  }
  section::after { right: 72px; bottom: 26px; color: var(--muted); font-size: 15px; }
  footer { left: 72px; bottom: 26px; color: var(--muted); font-size: 15px; }
  h1 { font-size: 46px; color: var(--accent); margin: 0 0 12px 0; letter-spacing: -0.5px; }
  h2 { font-size: 34px; color: var(--ink); margin: 0 0 22px 0; padding-bottom: 10px; border-bottom: 3px solid var(--accent); }
  h3 { font-size: 24px; color: var(--accent); margin: 10px 0 6px 0; }
  strong { color: var(--accent); }
  ul { margin: 6px 0 0 0; padding-left: 26px; } li { margin: 4px 0; }
  table { font-size: 18px; border-collapse: collapse; margin-top: 6px; }
  th { background: #eef3f9; color: var(--ink); } th, td { padding: 6px 12px; border-bottom: 1px solid var(--line); }
  code { background: #f3f5f8; padding: 1px 5px; border-radius: 4px; font-size: 0.88em; }
  pre { background: #f6f8fa; border: 1px solid var(--line); border-radius: 8px; padding: 14px 18px; font-size: 16px; }
  img { border-radius: 6px; }
  .cols { display: grid; grid-template-columns: 1fr 1fr; gap: 36px; align-items: start; }
  .small { font-size: 16px; color: var(--muted); }
  .note { border-left: 4px solid var(--accent2); background: #fff7ef; padding: 10px 16px; margin-top: 14px; font-size: 20px; }
  section.title { justify-content: center; background: linear-gradient(135deg, #0b5cad 0%, #083d73 100%); color: #fff; }
  section.title h1 { color: #fff; font-size: 54px; } section.title h3 { color: #cfe2f7; font-weight: 400; }
  section.title footer, section.title::after { color: #cfe2f7; }
  section.section { justify-content: center; background: #f4f7fb; }
  section.section h1 { font-size: 50px; }
---

<!-- _class: title -->
<!-- _paginate: false -->

# Procedural Istanbul

### Estimating corridor demand from live speeds, and an open SUMO digital twin of the Maslak – 15 July Bridge corridor

<br>

Abdurrahim Arif Aşıroğlu · October 2026
<span class="small" style="color:#cfe2f7">github.com/aaasiroglu/procedural-istanbul · MIT</span>

---

## Motivation

- A simulator needs **demand**: who travels from where to where (an OD matrix).
- Istanbul's traffic centre (İBB UYM) publishes **speeds** for ~12,700 road segments every minute, but **no flows**.
- Real counts are sparse: 27 sensors in a 52 km² corridor; 9,025 OD pairs to estimate. The inverse problem is **ill-posed**.
- Common practice turns speeds into pseudo-counts, injecting a certainty the data does not have, and rarely reports which part of the estimate comes from data and which from assumption.

<div class="note"><strong>Goal:</strong> an open, reproducible pipeline from public data to a calibrated SUMO scenario of the corridor, with honest uncertainty and validation on held-out counts.</div>

---

## Study area and data

<div class="cols">
<div>

![w:500](img/koridor-harita.png)

</div>
<div>

Beşiktaş – Maslak, Çağlayan – 15 July Bridge (≈ 5.9 × 8.9 km)

| Data | Source |
|---|---|
| Road network, buildings, POIs | OpenStreetMap |
| Live segment speeds | İBB UYM API |
| Daily sensor counts (2016 →) | İBB Open Data |
| Hourly probe-vehicle density | İBB Open Data |
| Calibrated 2020 model (network, VDF) | İBB Open Data |
| 2012 household travel survey | İBB Open Data |

</div>
</div>

---

<!-- _class: section -->

# 1 · Building the SUMO network

---

## OSM → SUMO with `netconvert`

```bash
netconvert --osm-files koridor.osm.xml --type-files osmNetconvert.typ.xml \
  --keep-edges.by-vclass passenger,bus --keep-edges.components 1 --remove-edges.isolated \
  --geometry.remove --edges.join --roundabouts.guess --junctions.join \
  --osm.turn-lanes --osm.lane-access \
  --tls.guess-signals --tls.join --tls.default-type static --tls.cycle.time 90 --proj.utm
```

| Result | |
|---|---|
| Edges / junctions | 21,174 / 8,963 |
| Signalised junctions / programs | 293 / 179 |
| Car edges mutually reachable (SCC) | 98.3 % |
| Metrobüs (bus-only carriageway) | 11.8 km |
| 15 July Bridge | 3 lanes per direction |

<div class="note"><strong>Lesson:</strong> <code>--tls.discard-simple</code> removed ~2/3 of the corridor's signals (mid-block pedestrian lights, split junctions of divided roads), overstating arterial capacity. Left out on purpose.</div>

---

## Network checks before any demand

<div class="cols">
<div>

### Smoke test (`randomTrips.py` + `sumo`)

| Load | Collisions | Teleports |
|---|---|---|
| 3,000 veh/h | 0 | 1.7 % |
| 6,000 veh/h | 0 | 2.7 % |

Teleports concentrate at two unsignalised junction clusters (yield deadlocks): Harbiye and Dikilitaş–Fulya.

</div>
<div>

### Live data on the network

- İBB segments matched to SUMO edges by heading-aware sampling: **95.5 %** of the corridor's segments.
- Segment geometry from `Segments/0` (13,534); `Segments/1` silently omits motorways.
- Observed share of road length: motorway 99 %, trunk 100 %, primary 94 %, secondary 92 %, residential 8 %.

</div>
</div>

---

## İBB's calibrated 2020 model on the SUMO network

- İBB's 29,663 road links (KMZ) mapped onto SUMO edges, **direction-aware**: İBB draws each carriageway of a divided road as its own one-way link, a few metres off OSM, so the nearest link is often the opposite one.
- Matched: motorway 92 %, trunk 80 %, primary/secondary 77–78 %.
- Carried over: capacity per direction, free-flow speed, **calibrated BPR**:

$$t = t_0 \left(1 + \alpha \left(\frac{v}{c}\right)^{\beta}\right) \qquad \text{expressways: } \alpha = 0.158,\ \beta = 3.483 \qquad \text{streets: } \alpha = 0.924,\ \beta = 3.464$$

- 540-zone OD matrix: its zone order cannot be recovered from the published files. A distance–flow correlation test gave r = −0.08 for the candidate order, no better than random orders, so the matrix is **not used**.

---

<!-- _class: section -->

# 2 · Demand from speeds

---

## Speeds as censored observations

On the triangular fundamental diagram (Newell 1993; Daganzo 1994):

- **Free-flow speed says nothing about flow** (anything from 0 to capacity): an **upper bound**.
- **Congested branch:** q = w·k<sub>j</sub>·v / (v + w). A queue means demand ≥ throughput: a **lower bound**.
- **Branch selection:** decided by İBB's own congestion class, which carries the operator's knowledge of each segment.

$$\min_{x \ge 0} \sum_{\text{counts}} \frac{((Px)_e - y_e)^2}{s_e^2} + \sum_{\text{lower}} \frac{[y_e - (Px)_e]_+^2}{s_e^2} + \sum_{\text{upper}} \frac{[(Px)_e - y_e]_+^2}{s_e^2} + \mathrm{KL}_\lambda(x \,\|\, x_0)$$

<div class="note"><strong>Validated on real counts:</strong> the rule holds only for uninterrupted flow. On signalised streets low speed is also red time; those bounds inflated demand by a third. Lower bounds are now kept for motorways and trunk roads only.</div>

---

## Estimator design

- **Bilevel:** UE assignment (Frank–Wolfe, BPR) and estimation alternate; the route choice is averaged over rounds (MSA) to damp oscillation (Spiess 1990; Yang et al. 1992).
- **Correlated prior errors:** x<sub>ij</sub> = x<sub>0,ij</sub> · exp(a<sub>i</sub> + b<sub>j</sub> + u<sub>ij</sub>). With independent per-pair errors, the prior is near certain about any link flow, which sums many pairs; zone production/attraction factors let a count correct a zone's whole traffic.
- **Uncertainty:** Laplace standard errors via Woodbury (an m × m solve rather than n × n), and a **data share** per OD pair, 1 − σ²<sub>post</sub> / σ²<sub>prior</sub>.
- **Numerics:** optimisation in log space (z = x<sub>0</sub>·e<sup>u</sup>) keeps L-BFGS well conditioned when prior values span 12 orders of magnitude.
- **Validation:** GEH on each count **left out in turn**, never only on the counts that were fitted.

---

## Synthetic benchmark (true OD known)

![w:1020](img/sentetik.png)

- Flows on uncounted links: GEH 5.6 → **2.2** (known routes), **3.8** (routes estimated too); freezing routes at the prior gives 8.0.
- 96 % of true values lie within 2.5 standard errors.
- Individual OD cells barely improve (36 counts, 90 pairs): **flows are identifiable, cells are not**, and the data share reports exactly that.

---

<!-- _class: section -->

# 3 · Validation and the SUMO run

---

## Counts on the SUMO network

- 25 of 27 İBB sensors placed as **screenlines** square to the road: both directions, all lanes.
- **Daily → hourly:** probe-vehicle share of the hour in the sensor's geohash cell, the same day (Saturdays of Oct 2024, 17:00–18:00; 3.6–5.1 % of the day).
- **The audit mattered.** Expressway sensors had snapped to side streets:

| Sensor | Daily | First placement | Fixed |
|---|---|---|---|
| Mecidiyeköy | 110 k | parallel street (no route) | O-1 |
| Çağlayan junction | 103 k | one-lane street | O-1 |
| TEM Karanfilköy | 103 k | Uğur Mumcu Cd. | O-2 |
| FSM toll plaza | 81 k | same edges as bridge entrance (224 k) | dropped |

---

## Held-out GEH: progress, not yet success

![w:1080](img/geh-turlar.png)

Mean held-out GEH 35.6 → 23.4. With İBB's calibrated capacities and BPR: fit 12.2, held-out 24.0, unchanged. **The GEH < 5 target (85 %) is not met.**

---

## Where the remaining error comes from

<div class="cols">
<div>

![w:500](img/dislanan-sayimlar.png)

</div>
<div>

1. **Count definitions conflict.** Three O-2 sensors sit on the same modelled flow, yet read 4,291 / 7,108 / 8,171 veh/h. Without ramps in between that is impossible: direction or lane coverage differs, and needs confirming with İBB.
2. **Gateways.** At the FSM bridge the model carries half the count; the gateway prior is a crude capacity share.
3. **Prior structure.** Land use from OSM building floor area. Next: an observed car OD from the 2012 household survey.

</div>
</div>

---

## Dynamic test in SUMO

<div class="cols">
<div>

![w:520](img/sumo-hizlar.png)

</div>
<div>

```bash
od2trips --taz-files taz.xml \
  --tazrelation-files od.xml --spread.uniform
sumo --mesosim --meso-junction-control.limited \
  --meso-tls-flow-penalty 1 \
  --device.rerouting.probability 1 \
  --device.rerouting.period 120
```

- 128.6 k veh/h (estimate before counts), 90 min.
- **Gridlock:** only 102,735 of 192,551 vehicles entered; median speed 2.9 km/h (İBB: 24).
- The counts confirm the cause: 8.5 k veh/h on the bridge against 13.9 k loaded. The count-anchored estimate is 74 k veh/h.

</div>
</div>

---

<!-- _class: section -->

# 4 · The 3D twin

---

## Procedural Istanbul in the browser

<div class="cols">
<div>

![h:330](img/kopru-ortakoy.jpg)
<span class="small">Suspension bridge (towers, cables, hangers) and Ortaköy Mosque</span>

</div>
<div>

![h:330](img/apartmanlar.jpg)
<span class="small">Hipped clay-tile roofs, chimneys, rooftop tanks, plastered façades</span>

</div>
</div>

<span class="small">From OSM: 38 k buildings with building:part towers, mosques with domes and minarets, real shop signs at street level and offices on their floor. Road profiles keep bridges straight bank to bank, viaducts above a clearance with vertical curves, and smooth tunnel portals.</span>

---

## Limitations

- Held-out validation target not met yet (GEH < 5 for 4 % of counts against a target of 85 %).
- One time slice (a Saturday, 17:00); day types and hours not yet modelled.
- Static assignment inside the estimator: no turn bans and no spillback; the dynamic run is not yet consistent with the estimated demand.
- Prior parameters chosen by hand (storeys, trip rates, gateway shares); all listed with every estimate.
- The novelty of "speeds as censored observations" and "data share" still has to be confirmed by a systematic literature review.

---

## Next steps

1. **Counts:** confirm sensor direction and lane coverage with İBB; resolve the conflicting O-2 sensors.
2. **Prior:** an observed PM-peak car OD from the 2012 household survey. Neighbourhoods are placed by their muhtarlık offices (963 points); external origins go to gateways by shortest path on İBB's 2020 network.
3. **SUMO:** scaled runs (25 / 50 / 75 / 100 %) of the count-anchored demand, junction fixes, and microscopic runs for the bridge approaches.
4. **Time:** hourly density archive since 2020 for day-type and hour profiles; continuous archiving of live speeds.
5. **Applications:** departure-time, mode and bridge advice for drivers; bottleneck ranking and scenario comparison for the city, back-tested on archived data.

---

## Reproducibility

```bash
npm run sumo:net -- --area=koridor          # OSM → SUMO network + report
npm run sumo:map-ibb -- --area=koridor      # İBB live segments → edges
npm run sumo:smoke -- --area=koridor        # random-traffic network test
uv run --group sumo python tools/sumo/map_ibb_model.py --area=koridor   # İBB 2020 capacity & BPR
uv run --group sumo python tools/od/counts.py --area=koridor --month=2024-10 --weekday=5 --hour=17
uv run --group sumo python tools/od/corridor.py --area=koridor --speeds … --counts … --tag counts
uv run --group sumo python tools/sumo/run_od.py --od-dir data/od/koridor/<run>   # od2trips + SUMO
npm run test:od                             # synthetic benchmark, 28 checks
```

Every assumption, intermediate result and negative finding is recorded with dates and numbers in `tools/*/README.md`.

---

## References

<div class="small">

- Cascetta, E. (1984). Estimation of trip matrices from traffic counts and survey data: a generalized least squares estimator. *Transportation Research B* 18(4–5).
- Daganzo, C. F. (1994). The cell transmission model. *Transportation Research B* 28(4).
- Frederix, R., Viti, F., Corthout, R., Tampère, C. M. J. (2011). New gradient approximation method for dynamic origin–destination matrix estimation on congested networks. *Transportation Research Record* 2263.
- Lopez, P. A. et al. (2018). Microscopic traffic simulation using SUMO. *IEEE ITSC*.
- Newell, G. F. (1993). A simplified theory of kinematic waves in highway traffic. *Transportation Research B* 27(4).
- Spiess, H. (1990). A gradient approach for the O-D matrix adjustment problem. CRT, Université de Montréal.
- Van Zuylen, H. J., Willumsen, L. G. (1980). The most likely trip matrix estimated from traffic counts. *Transportation Research B* 14(3).
- Yang, H., Sasaki, T., Iida, Y., Asakura, Y. (1992). Estimation of origin–destination matrices from link traffic counts on congested networks. *Transportation Research B* 26(6).
- UK Department for Transport. TAG Unit M3.1, Highway Assignment Modelling (GEH criterion).
- İBB Open Data Portal (data.ibb.gov.tr).

</div>

---

<!-- _class: title -->
<!-- _paginate: false -->

# Thank you

### Questions and feedback welcome

<br>

github.com/aaasiroglu/procedural-istanbul
