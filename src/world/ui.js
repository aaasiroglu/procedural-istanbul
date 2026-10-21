// The twin's frame: the top bar (live status, the real-data panels, time of day, clean screen) and a small dock
// with what the twin actually offers: the analysis (recommendations, O-D zones), layers, camera views and
// performance. Styles are in index.html (#geotwin-topbar, #geotwin-sidebar).
import * as THREE from 'three';

// camera views over the corridor: [lon, lat, distance m, azimuth °, elevation °]
const VIEWS = {
  overview: { title: 'Koridorun tamamı', sub: 'Maslak\'tan Boğaz\'a kuşbakışı', icon: '🦅', at: [29.012, 41.072, 2600, 200, 55] },
  bridge: { title: '15 Temmuz Şehitler Köprüsü', sub: 'Avrupa yakası bağlantısı', icon: '🌉', at: [29.033, 41.046, 1100, 240, 22] },
  zincirlikuyu: { title: 'Zincirlikuyu', sub: 'Çok katlı kavşak, O-1 ve metrobüs', icon: '🔀', at: [29.016, 41.067, 520, 215, 40] },
  mecidiyekoy: { title: 'Mecidiyeköy', sub: 'Viyadük ve D100', icon: '🏬', at: [28.995, 41.066, 600, 230, 32] },
  levent: { title: 'Levent', sub: 'Büyükdere Caddesi ve kuleler', icon: '🏢', at: [29.011, 41.080, 750, 200, 26] },
  maslak: { title: 'Maslak', sub: 'İş merkezleri ve TEM bağlantısı', icon: '🏙️', at: [29.020, 41.108, 900, 200, 30] },
};

export class GeoTwinUI {
  constructor({ traffic, clockTime, controls, camera, streamer, proj, state, landmarksGroup,
    onToggleH3Taz, onOpenRecommendations, onSelectHexMetric, onToggleOdArcs }) {
    Object.assign(this, { traffic, clockTime, controls, camera, streamer, proj, state, landmarksGroup,
      onToggleH3Taz, onOpenRecommendations, onSelectHexMetric, onToggleOdArcs });
    this.zenMode = false;
    this.render();
    this.bind();
  }

  render() {
    const root = document.createElement('div');
    root.id = 'geotwin-deck';
    const views = Object.entries(VIEWS).map(([key, v]) => `
              <button class="cam-card" data-cam="${key}">
                <span class="cam-icon">${v.icon}</span>
                <div class="cam-text"><span class="cam-title">${v.title}</span><span class="cam-sub">${v.sub}</span></div>
              </button>`).join('');
    const toggle = (id, label, checked = true) => `
              <label class="toggle-row"><span class="toggle-label">${label}</span><input type="checkbox" id="${id}" ${checked ? 'checked' : ''} /><span class="slider"></span></label>`;
    root.innerHTML = `
      <header id="geotwin-topbar">
        <div class="topbar-left">
          <div class="brand-pill">
            <span class="brand-logo"><svg viewBox="0 0 32 32" width="22" height="22" aria-hidden="true"><rect width="32" height="32" rx="7" fill="#0b5cad"/><path d="M6 22 L13 12 L19 18 L26 9" stroke="#fff" stroke-width="3" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg></span>
            <div class="brand-text">
              <span class="brand-title">PROCEDURAL İSTANBUL</span>
              <span class="brand-sub">Maslak – 15 Temmuz Köprüsü koridoru</span>
            </div>
          </div>
        </div>
        <div class="topbar-center">
          <div class="telemetry-pill"><span class="dot online"></span><span class="t-label">Canlı Trafik:</span><span class="t-val" id="top-live-traffic">bağlanıyor…</span></div>
        </div>
        <div class="topbar-right">
          <button id="btn-open-recommendations" class="time-btn" style="border: 1px solid rgba(52, 211, 153, 0.7); background: rgba(16, 185, 129, 0.22); color: #6ee7b7; font-weight: 700;" title="Sayımlarla sabitlenmiş O-D tahmininden öneriler: darboğazlar, kaza müdahalesi, teyit edilecek sensörler">✅ Öneriler · gerçek veri</button>
          <button id="btn-toggle-h3-taz" class="time-btn" style="border: 1px solid rgba(56, 189, 248, 0.5); background: rgba(56, 189, 248, 0.15); color: #38bdf8; font-weight: 600;" title="Tahminin 95 zonu: üzerine gelince üretim, çekim ve İBB hızı; tıklayınca o zonun O-D akışları">⬡ O-D zonları</button>
          <div class="time-switcher">
            <button class="time-btn active" data-time="live" title="Canlı saat">⏱️ Canlı</button>
            <button class="time-btn" data-time="12" title="Öğle">☀️ Gündüz</button>
            <button class="time-btn" data-time="19.5" title="Gün batımı">🌅 Gün Batımı</button>
            <button class="time-btn" data-time="22.5" title="Gece">🌙 Gece</button>
          </div>
          <button id="zen-btn" class="zen-toggle-btn" title="Arayüzü gizle"><span class="zen-icon">👁️</span><span class="zen-label">Temiz Ekran</span></button>
        </div>
      </header>

      <aside id="geotwin-sidebar" class="dock-panel collapsed">
        <nav class="dock-nav">
          <button class="dock-tab active" data-tab="od" title="Analiz: gerçek veri"><span class="tab-icon">⬡</span><span class="tab-label">Analiz</span></button>
          <button class="dock-tab" data-tab="layers" title="Katmanlar"><span class="tab-icon">🗺️</span><span class="tab-label">Katmanlar</span></button>
          <button class="dock-tab" data-tab="camera" title="Kamera"><span class="tab-icon">📍</span><span class="tab-label">Kamera</span></button>
          <button class="dock-tab" data-tab="metrics" title="Performans"><span class="tab-icon">📊</span><span class="tab-label">Performans</span></button>
          <div style="flex: 1"></div>
          <button id="dock-collapse-btn" class="dock-tab collapse-btn" title="Paneli aç / kapat"><span class="tab-icon">▶</span></button>
        </nav>
        <div class="dock-content">
          <div class="tab-pane active" id="pane-od">
            <div class="pane-header"><h3>⬡ Analiz · gerçek veri</h3><p>İBB hızları ve sayımlarıyla sabitlenmiş O-D tahmini (tools/od).</p></div>
            <div style="display: flex; flex-direction: column; gap: 12px; padding: 12px 0;">
              <button id="sidebar-btn-recs" class="action-btn" style="background: rgba(16, 185, 129, 0.22); border: 1px solid #34d399; color: #6ee7b7; padding: 12px; border-radius: 8px; font-weight: 700; cursor: pointer;">✅ Öneriler panelini aç</button>
              <button id="sidebar-btn-zones" class="action-btn" style="background: rgba(56, 189, 248, 0.2); border: 1px solid #38bdf8; color: #38bdf8; padding: 12px; border-radius: 8px; font-weight: 700; cursor: pointer;">⬡ O-D zonlarını göster / gizle</button>
              <div style="background: rgba(15, 23, 42, 0.7); padding: 12px; border-radius: 8px; border: 1px solid rgba(255,255,255,0.08);">
                <div style="font-size: 11px; font-weight: 600; color: #94a3b8; margin-bottom: 8px;">Zonların yüksekliği ve rengi:</div>
                <select id="sidebar-select-hex-metric" style="width: 100%; background: #0f172a; color: #e2e8f0; border: 1px solid #334155; padding: 8px; border-radius: 6px; font-size: 11px;">
                  <option value="total_outflow">Üretim: zondan çıkan araç/sa (tahmin)</option>
                  <option value="total_inflow">Çekim: zona gelen araç/sa (tahmin)</option>
                  <option value="speed">İBB medyan hızı</option>
                  <option value="co2">CO2 (hıza bağlı eğri)</option>
                </select>
              </div>
              <div style="background: rgba(15, 23, 42, 0.5); padding: 10px; border-radius: 8px; border: 1px solid rgba(255,255,255,0.06); font-size: 11px; color: #94a3b8; line-height: 1.5;">
                Bir zona tıklayınca o zonun en büyük 10 O-D akışı haritada çizilir ve sağda ayrıntıları açılır. Yöntem ve sınırlar: proje sitesindeki sözlük ve teknik rapor.
              </div>
            </div>
          </div>
          <div class="tab-pane" id="pane-layers">
            <div class="pane-header"><h3>🗺️ Katmanlar</h3><p>Görünenleri aç ya da kapat.</p></div>
            <div class="toggle-list">${toggle('chk-traffic', '🚗 Araçlar')}${toggle('chk-props', '🌳 Ağaçlar ve sokak donatıları')}${toggle('chk-landmarks', '🏷️ Yer adları', false)}${toggle('chk-legend', '🚥 Canlı İBB renk lejantı')}${toggle('chk-od-arcs', '🏹 Seçili zonun O-D akışları')}
            </div>
          </div>
          <div class="tab-pane" id="pane-camera">
            <div class="pane-header"><h3>📍 Kamera</h3><p>Koridordaki noktalara tek tıkla gidin.</p></div>
            <div class="camera-grid">${views}
            </div>
          </div>
          <div class="tab-pane" id="pane-metrics">
            <div class="pane-header"><h3>📊 Performans</h3><p>Çizim ve yükleme durumu.</p></div>
            <div class="metrics-grid">
              <div class="m-card"><span class="m-label">Kare hızı</span><span class="m-val" id="met-fps">–</span></div>
              <div class="m-card"><span class="m-label">Çizim çağrısı</span><span class="m-val" id="met-draws">–</span></div>
              <div class="m-card"><span class="m-label">Üçgen</span><span class="m-val" id="met-tris">–</span></div>
              <div class="m-card"><span class="m-label">Yüklenen karo</span><span class="m-val" id="met-tiles">–</span></div>
            </div>
          </div>
        </div>
      </aside>`;
    document.body.appendChild(root);
  }

  bind() {
    const $ = (id) => document.getElementById(id);
    const sidebar = $('geotwin-sidebar'), collapse = $('dock-collapse-btn');
    const tabs = document.querySelectorAll('.dock-tab:not(.collapse-btn)'), panes = document.querySelectorAll('.tab-pane');
    tabs.forEach((tab) => tab.addEventListener('click', () => {
      tabs.forEach((t) => t.classList.toggle('active', t === tab));
      panes.forEach((p) => p.classList.toggle('active', p.id === `pane-${tab.dataset.tab}`));
      sidebar.classList.remove('collapsed');
      collapse.querySelector('.tab-icon').textContent = '◀';
    }));
    collapse.addEventListener('click', () => {
      sidebar.classList.toggle('collapsed');
      collapse.querySelector('.tab-icon').textContent = sidebar.classList.contains('collapsed') ? '▶' : '◀';
    });
    $('zen-btn').addEventListener('click', () => {
      this.zenMode = !this.zenMode;
      document.body.classList.toggle('zen-mode', this.zenMode);
      $('zen-btn').classList.toggle('active', this.zenMode);
    });
    document.querySelectorAll('.time-switcher .time-btn').forEach((b) => b.addEventListener('click', () => {
      document.querySelectorAll('.time-switcher .time-btn').forEach((o) => o.classList.toggle('active', o === b));
      if (b.dataset.time === 'live') this.clockTime.live = true;
      else { this.clockTime.live = false; this.clockTime.hour = parseFloat(b.dataset.time); }
    }));

    // the real-data panels
    const recs = () => this.onOpenRecommendations?.();
    const zones = () => {
      const visible = this.onToggleH3Taz?.();
      $('btn-toggle-h3-taz').style.background = visible ? 'rgba(56, 189, 248, 0.35)' : 'rgba(56, 189, 248, 0.15)';
    };
    if (!this.onOpenRecommendations) { $('btn-open-recommendations').style.display = 'none'; $('sidebar-btn-recs').style.display = 'none'; }
    $('btn-open-recommendations').addEventListener('click', recs);
    $('sidebar-btn-recs').addEventListener('click', recs);
    $('btn-toggle-h3-taz').addEventListener('click', zones);
    $('sidebar-btn-zones').addEventListener('click', zones);
    $('sidebar-select-hex-metric').addEventListener('change', (e) => this.onSelectHexMetric?.(e.target.value));

    // layers
    $('chk-traffic').addEventListener('change', (e) => { this.state.traffic = e.target.checked; });
    $('chk-props').addEventListener('change', (e) => this.streamer.setPropsVisible?.(e.target.checked));
    $('chk-landmarks').addEventListener('change', (e) => { if (this.landmarksGroup) this.landmarksGroup.visible = e.target.checked; });
    $('chk-legend').addEventListener('change', (e) => { const l = $('traffic-legend'); if (l) l.style.display = e.target.checked ? 'grid' : 'none'; });
    $('chk-od-arcs').addEventListener('change', (e) => this.onToggleOdArcs?.(e.target.checked));

    document.querySelectorAll('.cam-card').forEach((card) => card.addEventListener('click', () => this.flyCameraTo(card.dataset.cam)));
  }

  flyCameraTo(name) {
    const view = VIEWS[name];
    if (!view) return;
    const [lon, lat, dist, az, el] = view.at;
    const [x, z] = this.proj.project(lon, lat);
    this.controls.target.set(x, this.streamer.ground(x, z), z);
    this.camera.position.copy(this.controls.target).add(new THREE.Vector3().setFromSphericalCoords(dist, THREE.MathUtils.degToRad(90 - el), THREE.MathUtils.degToRad(az)));
    this.controls.update();
  }

  updateMetrics(fps, info, tiles, maxTiles) {
    const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
    set('met-fps', `${Math.round(fps)} FPS`);
    set('met-draws', `${info.calls}`);
    set('met-tris', `${(info.triangles / 1e6).toFixed(2)} M`);
    set('met-tiles', `${tiles} / ${maxTiles}`);
  }

  updateLiveStatus(text) {
    const el = document.getElementById('top-live-traffic');
    if (el) el.textContent = text;
  }
}
