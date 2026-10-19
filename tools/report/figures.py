"""Figures for the presentation (docs/sunum), drawn from the project's own outputs.

  uv run --with matplotlib python tools/report/figures.py

Reads the OD estimates in data/od/koridor/ (summary.json, zones.geojson, sim/segments.csv) and the sensor
placement (counts_*.json). The synthetic benchmark numbers are those printed by tools/od/test_odme.py
(npm run test:od), the road profile numbers those of the analysis recorded in commit abf40b6.
"""

from __future__ import annotations

import csv
import json
from pathlib import Path

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402

ROOT = Path(__file__).resolve().parents[2]
OD = ROOT / "data" / "od" / "koridor"
OUT = ROOT / "docs" / "sunum" / "img"
OUT.mkdir(parents=True, exist_ok=True)
plt.rcParams.update({"font.size": 12, "axes.spines.top": False, "axes.spines.right": False, "figure.dpi": 150})
BLUE, ORANGE, GREEN, GREY, RED = "#2f6db5", "#e07b22", "#2e8b57", "#8a8f98", "#c0392b"


def load(name):
    return json.loads((OD / name / "summary.json").read_text())


def heldout_scatter():
    s = load("20261017-1726-counts-v3")["validation"]["per_count"]
    fig, ax = plt.subplots(figsize=(6.4, 6))
    c = [p["count"] for p in s]; m = [p["held_out"] for p in s]
    top = max(c + m) * 1.1
    import numpy as np
    xs = np.linspace(1, top, 400)
    # the band where GEH < 5 around the diagonal: |M - C| < 5 sqrt((M + C) / 2), solved for M
    lo = [x + 12.5 - 5 * (x + 6.25) ** 0.5 for x in xs]; hi = [x + 12.5 + 5 * (x + 6.25) ** 0.5 for x in xs]
    ax.fill_between(xs, lo, hi, color=GREEN, alpha=0.15, label="GEH < 5")
    ax.plot([0, top], [0, top], color=GREY, lw=1)
    ax.scatter(c, m, color=ORANGE, zorder=3, label="dışarıda bırakılan tahmin")
    for p in s:
        if p["geh_held_out"] > 30:
            ax.annotate(p["source"].split(" ", 3)[-1].split(" (")[0][:22], (p["count"], p["held_out"]), fontsize=8, xytext=(4, 4), textcoords="offset points")
    ax.set_xlim(0, top); ax.set_ylim(0, top)
    ax.set_xlabel("İBB sayımı (araç/sa)"); ax.set_ylabel("Model, sayım görülmeden (araç/sa)")
    ax.set_title("Her sayım tek tek dışarıda bırakıldığında")
    ax.legend(frameon=False, loc="upper left")
    fig.tight_layout(); fig.savefig(OUT / "dislanan-sayimlar.png"); plt.close(fig)


def sumo_speeds():
    rows = [r for r in csv.DictReader(open(OD / "20261017-1726" / "sim" / "segments.csv")) if r["sim_kph"]]
    fig, ax = plt.subplots(figsize=(8, 4.2))
    bins = range(0, 100, 4)
    ax.hist([float(r["speed_kph"]) for r in rows], bins=bins, alpha=0.7, color=BLUE, label="İBB (17:26)")
    ax.hist([float(r["sim_kph"]) for r in rows], bins=bins, alpha=0.7, color=RED, label="SUMO (mezoskopik)")
    ax.set_xlabel("Segment hızı (km/sa)"); ax.set_ylabel("Segment sayısı")
    ax.set_title("İlk dinamik koşu: ağ kilitlendi (medyan 2.9 km/sa, İBB 24 km/sa)")
    ax.legend(frameon=False)
    fig.tight_layout(); fig.savefig(OUT / "sumo-hizlar.png"); plt.close(fig)


def corridor_map():
    zones = json.loads((OD / "20261017-1726-counts-v3" / "zones.geojson").read_text())["features"]
    s = {p["source"].split()[2]: p for p in load("20261017-1726-counts-v3")["validation"]["per_count"]}
    sensors = json.loads((OD / "counts_202410_d5_h17.json").read_text())
    fig, ax = plt.subplots(figsize=(7.2, 8))
    for f in zones:
        if f["geometry"]["type"] == "Polygon":
            xs, ys = zip(*f["geometry"]["coordinates"][0])
            ax.fill(xs, ys, color=BLUE, alpha=0.08 + 0.5 * min(1, f["properties"]["production"] / 1500), lw=0.4, ec="white")
        else:
            x, y = f["geometry"]["coordinates"]
            ax.scatter([x], [y], marker="s", color=GREY, s=30)
    for e in sensors:
        p = s.get(e["sensor"])
        if p:
            g = p["geh_held_out"]
            ax.scatter([e["lon"]], [e["lat"]], color=GREEN if g < 5 else ORANGE if g < 15 else RED, s=60, ec="black", lw=0.5, zorder=3)
        else:
            ax.scatter([e["lon"]], [e["lat"]], marker="x", color="black", s=40, zorder=3)
    ax.plot([28.975, 29.048, 29.048, 28.975, 28.975], [41.038, 41.038, 41.118, 41.118, 41.038], color="black", lw=1)
    ax.set_aspect(1 / 0.754)
    ax.set_title("Koridor: 75 H3 zonu (koyu = çok üretim), 20 geçit (■)\nsensörler: dışarıda bırakılan GEH <5 / <15 / ≥15, × kullanılmadı", fontsize=11)
    ax.set_xlabel("boylam"); ax.set_ylabel("enlem")
    fig.tight_layout(); fig.savefig(OUT / "koridor-harita.png"); plt.close(fig)


# ---------------------------------------------------------------- bilingual figures (no data/od needed)
# Each one is drawn in Turkish (name.png) and English (name-en.png) from the same numbers.
def _save(fig, name, lang):
    fig.tight_layout(); fig.savefig(OUT / (name + ("-en" if lang == "en" else "") + ".png")); plt.close(fig)


def _t(lang):
    return lambda tr, en: en if lang == "en" else tr


def synthetic(lang="tr"):
    # tools/od/test_odme.py, seed 7: 6x6 grid, 10 zones, 30 % of links counted, speeds elsewhere
    T = _t(lang)
    labels = ["Prior", T("Tahmin\n(rotalar bilinir)", "Estimate\n(routes known)"), T("Bilevel\n(rotalar da\ntahmin)", "Bilevel\n(routes also\nestimated)"),
              T("Rotalar prior'a\nsabit (kısa yol)", "Routes frozen\nat prior (shortcut)")]
    vals = [5.60, 2.23, 3.76, 8.00]
    fig, (a, b) = plt.subplots(1, 2, figsize=(12, 4.4), gridspec_kw={"width_ratios": [2, 1]})
    a.bar(labels, vals, color=[GREY, BLUE, BLUE, RED])
    for i, v in enumerate(vals):
        a.text(i, v + 0.1, f"{v:.2f}", ha="center")
    a.set_ylabel(T("Sayılmayan linklerde ortalama GEH", "Mean GEH on uncounted links"))
    a.set_title(T("Sentetik şehir: gerçek O-D bilinir", "Synthetic city: true OD known"))
    b.bar([T("Bağımsız\nçift hataları", "Independent\npair errors"), T("Zon\nçarpanları", "Zone\nfactors")], [4.08, 2.65], color=[GREY, GREEN])
    for i, v in enumerate([4.08, 2.65]):
        b.text(i, v + 0.06, f"{v:.2f}", ha="center")
    b.set_title(T("Zon bazında hatalı prior", "Prior wrong by zone")); b.set_ylabel(T("Ortalama GEH", "Mean GEH"))
    _save(fig, "sentetik", lang)


# validation rounds as recorded in tools/od/README.md (prior / fit / held-out: mean GEH, % under 5)
ROUNDS = [
    (("İlk tur", "First run"), (37.6, 4.3), (27.3, 13.0), (35.6, 13.0)),
    (("Eşleme +\nkesintisiz akış", "Mapping +\nuninterrupted"), (32.1, 8.3), (16.5, 8.3), (23.8, 8.3)),
    (("+ zon\nçarpanları", "+ zone\nfactors"), (32.1, 8.3), (13.1, 20.8), (23.4, 4.2)),
    (("+ İBB kapasite\nve BPR", "+ İBB capacity\nand BPR"), None, (12.2, 20.8), (24.0, 0.0)),
    (("+ 2012 anket\npayları", "+ 2012 survey\nshares"), None, (11.8, 25.0), (23.2, 4.2)),
]


def geh_rounds(lang="tr"):
    T = _t(lang)
    fig, (a, b) = plt.subplots(1, 2, figsize=(13, 4.8))
    w = 0.26
    for k, (colour, name) in enumerate([(GREY, "Prior"), (BLUE, T("Uyum (sayımlar görüldü)", "Fit (counts seen)")),
                                        (ORANGE, T("Dışarıda bırakılan", "Held out"))]):
        xs = [i + (k - 1) * w for i, r in enumerate(ROUNDS) if r[1 + k]]
        vals = [r[1 + k] for r in ROUNDS if r[1 + k]]
        a.bar(xs, [v[0] for v in vals], w, color=colour, label=name)
        b.bar(xs, [v[1] for v in vals], w, color=colour, label=name)
    for ax in (a, b):
        ax.set_xticks(range(len(ROUNDS)), [r[0][lang == "en"] for r in ROUNDS], fontsize=9.5)
    a.set_ylabel(T("Ortalama GEH", "Mean GEH")); a.set_title(T("Ortalama GEH (düşük iyi)", "Mean GEH (lower is better)"))
    b.axhline(85, color=RED, ls="--", lw=1.5)
    b.text(len(ROUNDS) - 0.55, 86, T("hedef %85", "target 85 %"), color=RED, ha="right", va="bottom")
    b.set_ylabel(T("GEH < 5 olan sayım (%)", "Counts with GEH < 5 (%)"))
    b.set_title(T("GEH < 5 oranı (yüksek iyi)", "Share with GEH < 5 (higher is better)")); b.set_ylim(0, 100)
    a.legend(frameon=False, fontsize=10)
    fig.suptitle(T("İBB sayımlarıyla doğrulama: 24 sensör, Cumartesi 17:00–18:00",
                   "Validation against İBB counts: 24 sensors, Saturday 17:00–18:00"), fontsize=13)
    _save(fig, "geh-turlar", lang)


def road_profile(lang="tr"):
    T = _t(lang)
    fig, ax = plt.subplots(figsize=(8, 4))
    labels = [T("Ana arter\nen dik eğim", "Arterial\nsteepest grade"), T("Otoyol eğimi\n%95'lik", "Motorway grade\n95th percentile"),
              T("Köprü tabliyesi\nzemin + sabit", "Bridge deck\nground + offset")]
    before, after = [246, 13.0, 6.5], [28, 7.7, 0]
    x = range(len(labels))
    ax.bar([i - 0.2 for i in x], before, 0.4, color=RED, label=T("İstanbul ilk sürüm", "First Istanbul build"))
    ax.bar([i + 0.2 for i in x], after, 0.4, color=GREEN, label=T("Yeni profil", "New profile"))
    ax.set_xticks(list(x), labels); ax.set_yscale("symlog", linthresh=10)
    ax.set_ylabel(T("% eğim  /  m (son sütun)", "% grade  /  m (last group)"))
    for i, (b, a) in enumerate(zip(before, after)):
        ax.text(i - 0.2, b * 1.08 + 0.3, f"{b:g}", ha="center", fontsize=10)
        ax.text(i + 0.2, a * 1.08 + 0.3, f"{a:g}" if a else T("yok", "none"), ha="center", fontsize=10)
    ax.set_title(T("Yol profili: köprüler zemini kopyalamıyor, sıçrama yok", "Road profile: bridges no longer copy the ground, no jumps"))
    ax.legend(frameon=False)
    _save(fig, "yol-profili", lang)


def fundamental_diagram(lang="tr"):
    """Why a speed is a one-sided bound: the triangular fundamental diagram and the flow each speed allows."""
    import numpy as np
    T = _t(lang)
    vf, cap, kj = 90.0, 2000.0, 140.0
    kc = cap / vf; w = cap / (kj - kc)
    k = np.linspace(0, kj, 400); q = np.minimum(vf * k, w * (kj - k))
    fig, ax = plt.subplots(figsize=(9, 4.8))
    ax.plot(k, q, color="black", lw=2)
    ax.fill_between(k[k <= kc], 0, vf * k[k <= kc], color=GREEN, alpha=0.12)
    ax.annotate(T("serbest akış: hız ≈ v$_f$\nakım 0 ile kapasite arası\n→ yalnızca ÜST sınır",
                              "free flow: speed ≈ v$_f$\nflow anywhere from 0 to capacity\n→ an UPPER bound only"),
                (14, 700), xytext=(62, 280), fontsize=10.5, color=GREEN, arrowprops=dict(arrowstyle="->", color=GREEN))
    v = 30.0; kv = w * kj / (v + w); qv = v * kv
    ax.plot([0, kv], [0, qv], color=ORANGE, ls="--", lw=1.3)
    ax.scatter([kv], [qv], color=ORANGE, zorder=3, s=50)
    ax.text(kv + 4, qv + 80, T(f"sıkışık dal, v = {v:.0f} km/sa:\nq = w·k$_j$·v / (v + w) ≈ {qv:.0f} araç/sa\nkuyruk var → talep ≥ q: ALT sınır",
                              f"congested branch, v = {v:.0f} km/h:\nq = w·k$_j$·v / (v + w) ≈ {qv:.0f} veh/h\nqueue → demand ≥ q: a LOWER bound"),
            fontsize=10.5, color=ORANGE)
    ax.axhline(cap, color=GREY, lw=0.8, ls=":"); ax.text(kj * 0.86, cap + 25, T("kapasite", "capacity"), color=GREY, fontsize=10)
    ax.set_xlim(0, kj * 1.02); ax.set_ylim(0, cap * 1.12)
    ax.set_xlabel(T("yoğunluk k (araç/km/şerit)", "density k (veh/km/lane)")); ax.set_ylabel(T("akım q (araç/sa/şerit)", "flow q (veh/h/lane)"))
    ax.set_title(T("Üçgen temel diyagram: hız, akımı yalnızca bir yönden sınırlar", "Triangular fundamental diagram: a speed bounds the flow from one side only"))
    _save(fig, "temel-diyagram", lang)


def pipeline(lang="tr"):
    """The data and model pipeline as boxes and arrows."""
    from matplotlib.patches import FancyBboxPatch
    T = _t(lang)
    fig, ax = plt.subplots(figsize=(13, 5.2)); ax.set_axis_off(); ax.set_xlim(0, 13); ax.set_ylim(0, 5.3)

    def box(x, y, text, colour, wd=2.6, ht=0.8):
        ax.add_patch(FancyBboxPatch((x, y), wd, ht, boxstyle="round,pad=0.04,rounding_size=0.12", fc=colour, ec="none"))
        ax.text(x + wd / 2, y + ht / 2, text, ha="center", va="center", color="white", fontsize=10.5, weight="bold")
        return (x, y, wd, ht)

    def arrow(a, b):
        ax.annotate("", (b[0] - 0.05, b[1] + b[3] / 2), (a[0] + a[2] + 0.05, a[1] + a[3] / 2),
                    arrowprops=dict(arrowstyle="->", color="#444", lw=1.4))

    src = [box(0.1, 4.0, T("OpenStreetMap\nyol, bina, POI", "OpenStreetMap\nroads, buildings, POIs"), GREY),
           box(0.1, 2.9, T("İBB canlı hız\n≈ 12.700 segment", "İBB live speeds\n≈ 12,700 segments"), GREY),
           box(0.1, 1.8, T("İBB sensör sayımları\n27 sensör", "İBB sensor counts\n27 sensors"), GREY),
           box(0.1, 0.7, T("İBB 2020 modeli\n2012 hanehalkı anketi", "İBB 2020 model\n2012 household survey"), GREY)]
    mid = [box(3.4, 4.0, T("SUMO ağı\n(netconvert)", "SUMO network\n(netconvert)"), BLUE),
           box(3.4, 2.9, T("Sansürlü gözlemler\n(alt / üst sınır)", "Censored observations\n(lower / upper bounds)"), BLUE),
           box(3.4, 1.8, T("Sayım kesitleri\n(yola dik)", "Count screenlines\n(across the road)"), BLUE),
           box(3.4, 0.7, T("Zon prior'ı\n75 H3 + 20 geçit", "Zone prior\n75 H3 + 20 gateways"), BLUE)]
    for a, b in zip(src, mid):
        arrow(a, b)
    est = box(6.8, 2.0, T("Ters O-D tahmini\nbilevel MAP + UE\nveri payı, SE, talep düzeyi", "Inverse OD estimation\nbilevel MAP + UE\ndata share, SE, demand level"),
              ORANGE, wd=2.9, ht=1.4)
    for m in mid:
        arrow(m, est)
    out = [box(10.3, 3.6, T("od2trips → SUMO\ndinamik sınama", "od2trips → SUMO\ndynamic test"), GREEN),
           box(10.3, 2.3, T("Dışarıda bırakılan\nGEH doğrulaması", "Held-out\nGEH validation"), GREEN),
           box(10.3, 1.0, T("3D dijital ikiz\n(Three.js)", "3D digital twin\n(Three.js)"), GREEN)]
    for o in out:
        arrow(est, o)
    for x, t in ((1.4, T("Açık veri", "Open data")), (4.7, T("Ön işleme", "Pre-processing")),
                 (8.25, T("Tahmin", "Estimation")), (11.6, T("Sınama ve kullanım", "Testing and use"))):
        ax.text(x, 5.05, t, ha="center", fontsize=12.5, color="#333", weight="bold")
    _save(fig, "mimari", lang)


def level_identification(lang="tr"):
    # tools/od/test_odme.py, "level of demand" checks: prior 40 % low everywhere, free-flow upper bounds on every link
    T = _t(lang)
    fig, (a, b) = plt.subplots(1, 2, figsize=(12, 4.5), gridspec_kw={"width_ratios": [1.3, 1]})
    labels = [T("Yalnızca hız\nsınırları", "Speed bounds\nonly"), T("+ bir kesit sayımı\n(zon çarpanı yok)", "+ one screenline\n(no zone factors)"),
              T("+ bir kesit sayımı\n(zon çarpanları serbest)", "+ one screenline\n(free zone factors)")]
    share = [0.00, 0.94, 0.53]
    a.bar(labels, share, color=[GREY, GREEN, ORANGE])
    a.axhline(0.8, color=RED, ls="--", lw=1.3)
    a.text(2.45, 0.83, T("sabitlenme eşiği 0.8", "anchoring threshold 0.8"), color=RED, ha="right", fontsize=10)
    for i, v in enumerate(share):
        a.text(i, v + 0.02, f"{v:.2f}", ha="center")
    a.set_ylim(0, 1.05); a.set_ylabel(T("talep düzeyinin veri payı", "data share of the demand level"))
    a.set_title(T("Sayımlar talep düzeyini ne kadar sabitliyor?", "How far do counts pin down the demand level?"))
    tot = [18049, 26081, 30081]
    b.bar(["Prior", T("Tahmin\n(bir sayım)", "Estimate\n(one count)"), T("Gerçek", "Truth")], tot, color=[GREY, BLUE, "black"])
    for i, v in enumerate(tot):
        b.text(i, v + 400, f"{v:,}".replace(",", "." if lang == "tr" else ","), ha="center")
    b.set_ylabel(T("toplam yolculuk (araç/sa)", "total trips (veh/h)")); b.set_title(T("Toplam talep", "Total demand"))
    _save(fig, "talep-duzeyi", lang)


if __name__ == "__main__":
    import sys
    for f in (synthetic, geh_rounds, road_profile, fundamental_diagram, pipeline, level_identification):
        for lang in ("tr", "en"):
            f(lang)
        print("ok", f.__name__, "(tr, en)")
    if (OD / "20261017-1726-counts-v3").exists():  # (the rest needs the OD outputs of tools/od/corridor.py)
        for f in (heldout_scatter, sumo_speeds, corridor_map):
            f(); print("ok", f.__name__)
    else:
        print(f"skipped heldout_scatter, sumo_speeds, corridor_map: no {OD.relative_to(ROOT)}", file=sys.stderr)
