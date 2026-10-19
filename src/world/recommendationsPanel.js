// The recommendation panel: what the estimate, the counts and the shadow simulation say to do, each item with the
// numbers it rests on (public/data/od/<area>.json, written by tools/report/export_app_data.py). The loaded major
// roads are drawn on the city as red ribbons while the panel is open; a click on an item takes the camera there.

import * as THREE from 'three';

const ICON = { bottleneck: '⛔', incident: '🚧', data: '📍', level: '📊', driver: '🚗' };
const AUDIENCE = { authority: 'Kurum', analyst: 'Analist', driver: 'Sürücü' };
const SEVERITY = { high: '#f43f5e', medium: '#f59e0b', info: '#38bdf8' };

export class RecommendationsPanel {
  constructor({ data, scene, proj, streamer, onFocus }) {
    this.data = data;
    this.scene = scene;
    this.proj = proj;
    this.streamer = streamer;
    this.onFocus = onFocus;
    this.group = new THREE.Group();
    this.group.name = 'bottleneck-ribbons';
    this.group.visible = false;
    scene.add(this.group);
    this.built = false;
    this.el = this.render();
    document.body.appendChild(this.el);
  }

  // one ribbon per bottleneck, lifted a little over the ground so it reads over the road
  buildRibbons() {
    const mat = new THREE.MeshBasicMaterial({ color: 0xf43f5e, transparent: true, opacity: 0.85, depthWrite: false });
    for (const b of this.data.bottlenecks) {
      const pts = b.shape.map(([lon, lat]) => { const [x, z] = this.proj.project(lon, lat); return new THREE.Vector3(x, this.streamer.ground(x, z) + 6, z); });
      if (pts.length < 2) continue;
      const curve = new THREE.CatmullRomCurve3(pts);
      const tube = new THREE.Mesh(new THREE.TubeGeometry(curve, Math.max(8, pts.length * 4), 3.2 + 3 * Math.min(1.5, b.v_c - 1), 6, false), mat);
      this.group.add(tube);
    }
    this.built = true;
  }

  render() {
    const d = this.data;
    const el = document.createElement('aside');
    el.id = 'recs-panel';
    el.hidden = true;
    const lv = d.level, ho = d.validation.held_out;
    const n = (v, k = 0) => Number(v).toLocaleString('tr-TR', { minimumFractionDigits: k, maximumFractionDigits: k });
    el.innerHTML = `
      <style>
        #recs-panel { position: fixed; top: 64px; left: 88px; z-index: 2400; width: min(420px, calc(100vw - 110px)); max-height: calc(100vh - 140px);
          display: flex; flex-direction: column; background: rgba(15, 23, 42, 0.94); color: #e2e8f0; border: 1px solid rgba(56, 189, 248, 0.3);
          border-radius: 14px; backdrop-filter: blur(14px); box-shadow: 0 16px 40px rgba(0, 0, 0, 0.45); font: 12px/1.45 "Segoe UI", system-ui, sans-serif; }
        #recs-panel[hidden] { display: none; }
        #recs-panel header { padding: 14px 16px 10px; border-bottom: 1px solid rgba(255, 255, 255, 0.07); }
        #recs-panel h2 { margin: 0; font-size: 15px; color: #f8fafc; display: flex; align-items: center; justify-content: space-between; }
        #recs-panel .x { background: none; border: 0; color: #94a3b8; font-size: 16px; cursor: pointer; }
        #recs-panel .sub { color: #94a3b8; font-size: 11px; margin-top: 3px; }
        #recs-panel .kpis { display: grid; grid-template-columns: repeat(3, 1fr); gap: 6px; margin-top: 10px; }
        #recs-panel .kpi { background: rgba(30, 41, 59, 0.8); border-radius: 8px; padding: 7px 8px; }
        #recs-panel .kpi b { display: block; font-size: 15px; color: #f8fafc; }
        #recs-panel .kpi span { color: #94a3b8; font-size: 10px; }
        #recs-panel .filters { display: flex; gap: 5px; padding: 10px 16px 4px; flex-wrap: wrap; }
        #recs-panel .filters button { border: 1px solid #334155; background: #0f172a; color: #cbd5e1; border-radius: 999px; padding: 4px 10px; font: 600 11px inherit; cursor: pointer; }
        #recs-panel .filters button[aria-pressed="true"] { background: #0284c7; border-color: #38bdf8; color: #fff; }
        #recs-panel ul { list-style: none; margin: 0; padding: 6px 10px 12px; overflow-y: auto; }
        #recs-panel li { padding: 10px; border-radius: 10px; margin: 4px 0; background: rgba(30, 41, 59, 0.55); border-left: 3px solid var(--sev); cursor: default; }
        #recs-panel li[data-where] { cursor: pointer; }
        #recs-panel li[data-where]:hover { background: rgba(51, 65, 85, 0.7); }
        #recs-panel li .t { font-weight: 700; color: #f8fafc; display: flex; gap: 6px; }
        #recs-panel li .d { color: #cbd5e1; margin-top: 3px; }
        #recs-panel li .b { color: #64748b; font-size: 10px; margin-top: 4px; }
        #recs-panel li .aud { margin-left: auto; font-size: 10px; font-weight: 600; color: #94a3b8; white-space: nowrap; }
        #recs-panel footer { padding: 8px 16px 12px; color: #64748b; font-size: 10px; border-top: 1px solid rgba(255, 255, 255, 0.07); }
      </style>
      <header>
        <h2><span>Öneriler · gerçek veri</span><button class="x" aria-label="Kapat">✕</button></h2>
        <div class="sub">İBB canlı hızları ${new Date(d.meta.speeds_at).toLocaleString('tr-TR', { dateStyle: 'medium', timeStyle: 'short' })} · sayımlarla sabitlenmiş O-D tahmini</div>
        <div class="kpis">
          <div class="kpi"><b>${n(d.trips.estimate / 1000, 1)} bin</b><span>araç/sa koridor talebi</span></div>
          <div class="kpi"><b>×${n(lv.factor, 2)}</b><span>düzey (veri payı ${n(lv.data_share, 2)})</span></div>
          <div class="kpi"><b>%${n(ho.under5_pct, 1)}</b><span>dışarıda bırakılan GEH &lt; 5</span></div>
        </div>
      </header>
      <div class="filters" role="group" aria-label="Kitle">
        <button data-f="all" aria-pressed="true">Tümü</button>
        <button data-f="authority">Kurum</button>
        <button data-f="driver">Sürücü</button>
        <button data-f="analyst">Analist</button>
      </div>
      <ul>${d.recommendations.map((r, i) => `
        <li data-i="${i}" data-aud="${r.audience}" ${r.where ? `data-where="${r.where.join(',')}"` : ''} style="--sev:${SEVERITY[r.severity] || '#38bdf8'}">
          <div class="t"><span>${ICON[r.kind] || '•'}</span><span>${r.title}</span><span class="aud">${AUDIENCE[r.audience] || ''}</span></div>
          <div class="d">${r.detail}</div>
          <div class="b">Dayanak: ${r.basis}</div>
        </li>`).join('')}</ul>
      <footer>Kural tabanlı öneri motoru v1. Kırmızı şeritler: talebin kapasiteyi aştığı ana yollar. Bir öneriye tıklayınca kamera oraya gider.</footer>`;
    el.querySelector('.x').onclick = () => this.setOpen(false);
    el.querySelectorAll('.filters button').forEach((b) => (b.onclick = () => {
      el.querySelectorAll('.filters button').forEach((o) => o.setAttribute('aria-pressed', String(o === b)));
      el.querySelectorAll('li').forEach((li) => { li.hidden = b.dataset.f !== 'all' && li.dataset.aud !== b.dataset.f; });
    }));
    el.querySelectorAll('li[data-where]').forEach((li) => (li.onclick = () => {
      const [lon, lat] = li.dataset.where.split(',').map(Number);
      const [x, z] = this.proj.project(lon, lat);
      this.onFocus?.(x, z);
    }));
    return el;
  }

  get isOpen() { return !this.el.hidden; }

  setOpen(open) {
    if (open && !this.built) this.buildRibbons();
    this.el.hidden = !open;
    this.group.visible = open;
  }

  toggle() { this.setOpen(!this.isOpen); return this.isOpen; }
}
