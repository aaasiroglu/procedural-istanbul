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


def geh_rounds():
    runs = [("İlk tur", "20261017-1726-counts"), ("Eşleme +\nkesintisiz akış", "20261017-1726-counts-v2"), ("+ zon\nçarpanları", "20261017-1726-counts-v3")]
    fig, (a, b) = plt.subplots(1, 2, figsize=(12, 4.6))
    w = 0.26
    for k, (label, colour) in enumerate([("prior", GREY), ("fit", BLUE), ("held_out", ORANGE)]):
        vals = [load(r)["validation"][label] for _, r in runs]
        xs = [i + (k - 1) * w for i in range(len(runs))]
        name = {"prior": "Prior", "fit": "Uyum (sayımlar görüldü)", "held_out": "Dışarıda bırakılan"}[label]
        a.bar(xs, [v["mean"] for v in vals], w, color=colour, label=name)
        b.bar(xs, [v["under5_pct"] for v in vals], w, color=colour, label=name)
    for ax in (a, b):
        ax.set_xticks(range(len(runs)), [r for r, _ in runs])
    a.set_ylabel("Ortalama GEH"); a.set_title("Ortalama GEH (düşük iyi)")
    b.axhline(85, color=RED, ls="--", lw=1.5); b.text(2.45, 86, "hedef %85", color=RED, ha="right", va="bottom")
    b.set_ylabel("GEH < 5 olan sayım (%)"); b.set_title("GEH < 5 oranı (yüksek iyi)"); b.set_ylim(0, 100)
    a.legend(frameon=False, fontsize=10)
    fig.suptitle("İBB sayımlarıyla doğrulama — 24 sensör, Cumartesi 17:00–18:00", fontsize=13)
    fig.tight_layout(); fig.savefig(OUT / "geh-turlar.png"); plt.close(fig)


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


def synthetic():
    # tools/od/test_odme.py, seed 7: 6x6 grid, 10 zones, 30 % of links counted, speeds elsewhere
    labels = ["Prior", "Tahmin\n(rotalar bilinir)", "Bilevel\n(rotalar da\ntahmin)", "Rotalar prior'a\nsabit (kısa yol)"]
    vals = [5.60, 2.23, 3.76, 8.00]
    fig, (a, b) = plt.subplots(1, 2, figsize=(12, 4.4), gridspec_kw={"width_ratios": [2, 1]})
    a.bar(labels, vals, color=[GREY, BLUE, BLUE, RED])
    for i, v in enumerate(vals):
        a.text(i, v + 0.1, f"{v:.2f}", ha="center")
    a.set_ylabel("Sayılmayan linklerde ortalama GEH"); a.set_title("Sentetik şehir: gerçek O-D bilinir")
    b.bar(["Bağımsız\nçift hataları", "Zon\nçarpanları"], [4.08, 2.65], color=[GREY, GREEN])
    for i, v in enumerate([4.08, 2.65]):
        b.text(i, v + 0.06, f"{v:.2f}", ha="center")
    b.set_title("Zon bazında hatalı prior"); b.set_ylabel("Ortalama GEH")
    fig.tight_layout(); fig.savefig(OUT / "sentetik.png"); plt.close(fig)


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


def road_profile():
    fig, ax = plt.subplots(figsize=(8, 4))
    labels = ["Ana arter\nen dik eğim", "Otoyol eğimi\n%95'lik", "Köprü tabliyesi\nzemin + sabit"]
    before, after = [246, 13.0, 6.5], [28, 7.7, 0]
    x = range(len(labels))
    ax.bar([i - 0.2 for i in x], before, 0.4, color=RED, label="İstanbul ilk sürüm")
    ax.bar([i + 0.2 for i in x], after, 0.4, color=GREEN, label="Yeni profil")
    ax.set_xticks(list(x), labels); ax.set_yscale("symlog", linthresh=10)
    ax.set_ylabel("% eğim  /  m (son sütun)")
    for i, (b, a) in enumerate(zip(before, after)):
        ax.text(i - 0.2, b * 1.08 + 0.3, f"{b:g}", ha="center", fontsize=10); ax.text(i + 0.2, a * 1.08 + 0.3, f"{a:g}" if a else "yok", ha="center", fontsize=10)
    ax.set_title("Yol profili: köprüler zemini kopyalamıyor, sıçramalar yok")
    ax.legend(frameon=False)
    fig.tight_layout(); fig.savefig(OUT / "yol-profili.png"); plt.close(fig)


if __name__ == "__main__":
    for f in (geh_rounds, heldout_scatter, synthetic, sumo_speeds, corridor_map, road_profile):
        f(); print("ok", f.__name__)
