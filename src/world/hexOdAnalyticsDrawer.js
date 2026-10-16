/**
 * GLASSMORPHIC HEX OD ANALYTICS DRAWER (VANILLA JS DOM)
 * src/world/hexOdAnalyticsDrawer.js
 *
 * Implements:
 * 1. Slide-out Glassmorphic panel on the right side of the screen.
 * 2. Retrospective Time Controls: [⚡ Canlı] [📅 Son 24 Saat] [🗓️ Son 7 Gün] + 00:00-23:00 Slider.
 * 3. Direction Toggle: [📤 Giden Akışlar (O_i)] <-> [📥 Gelen Akışlar (A_j)].
 * 4. Top-10 OD Corridors Table with trips, 3-color modal split, travel time, and Z_Total cost.
 * 5. Interactive SVG Charts: 24h Diurnal Demand Curve & MFD Parabolic (q-k) Diagram.
 * 6. 10x What-If Shockwave Chaos Actuation Button.
 */

export class HexOdAnalyticsDrawer {
  constructor({
    onTimeFilterChange,
    onHourChange,
    onFlowDirectionChange,
    onCorridorClick,
    onTriggerChaos,
  }) {
    this.onTimeFilterChange = onTimeFilterChange;
    this.onHourChange = onHourChange;
    this.onFlowDirectionChange = onFlowDirectionChange;
    this.onCorridorClick = onCorridorClick;
    this.onTriggerChaos = onTriggerChaos;

    this.isOpen = false;
    this.selectedTaz = null;
    this.corridors = [];
    this.gehReport = null;
    this.timeFilterMode = 'live'; // 'live', '24h', '7d'
    this.selectedHour = 8;
    this.flowDirection = 'outflow'; // 'outflow', 'inflow'
    this.chaosActive = false;

    this.initDOM();
  }

  initDOM() {
    const el = document.createElement('div');
    el.id = 'hex-od-drawer';
    el.className = 'hex-od-drawer-container';
    el.style.display = 'none';

    el.innerHTML = `
      <style>
        .hex-od-drawer-container {
          position: fixed;
          top: 56px;
          right: 0;
          bottom: 0;
          width: 460px;
          max-width: 95vw;
          z-index: 1000;
          background: rgba(10, 15, 30, 0.94);
          backdrop-filter: blur(16px);
          -webkit-backdrop-filter: blur(16px);
          border-left: 1px solid rgba(56, 189, 248, 0.25);
          box-shadow: -8px 0 32px rgba(0, 0, 0, 0.75);
          display: flex;
          flex-direction: column;
          font-family: system-ui, -apple-system, sans-serif;
          color: #f1f5f9;
          animation: slideInRight 0.25s cubic-bezier(0.16, 1, 0.3, 1);
        }
        @keyframes slideInRight {
          from { transform: translateX(100%); }
          to { transform: translateX(0); }
        }
        .hod-header {
          padding: 14px 18px;
          border-bottom: 1px solid rgba(255, 255, 255, 0.08);
          display: flex;
          justify-content: space-between;
          align-items: flex-start;
          background: rgba(15, 23, 42, 0.6);
        }
        .hod-title {
          font-size: 15px;
          font-weight: 700;
          color: #ffffff;
          display: flex;
          align-items: center;
          gap: 6px;
        }
        .hod-sub {
          font-size: 11px;
          color: #94a3b8;
          margin-top: 3px;
        }
        .hod-close-btn {
          background: transparent;
          border: none;
          color: #94a3b8;
          font-size: 18px;
          cursor: pointer;
          padding: 2px 6px;
          border-radius: 6px;
        }
        .hod-close-btn:hover {
          color: #ffffff;
          background: rgba(255, 255, 255, 0.1);
        }
        .hod-controls-bar {
          padding: 10px 18px;
          border-bottom: 1px solid rgba(255, 255, 255, 0.08);
          background: rgba(15, 23, 42, 0.4);
          display: flex;
          flex-direction: column;
          gap: 8px;
        }
        .hod-btn-group {
          display: flex;
          gap: 6px;
          align-items: center;
        }
        .hod-pill-btn {
          padding: 4px 10px;
          border-radius: 6px;
          font-size: 11px;
          font-weight: 600;
          border: 1px solid rgba(255, 255, 255, 0.12);
          background: rgba(30, 41, 59, 0.7);
          color: #cbd5e1;
          cursor: pointer;
          transition: all 0.15s ease;
        }
        .hod-pill-btn.active {
          background: rgba(56, 189, 248, 0.2);
          border-color: rgba(56, 189, 248, 0.5);
          color: #38bdf8;
        }
        .hod-pill-btn.active-amber {
          background: rgba(245, 158, 11, 0.2);
          border-color: rgba(245, 158, 11, 0.5);
          color: #f59e0b;
        }
        .hod-slider-row {
          display: flex;
          align-items: center;
          gap: 10px;
          font-size: 11px;
          color: #94a3b8;
        }
        .hod-slider {
          flex: 1;
          accent-color: #38bdf8;
          cursor: pointer;
        }
        .hod-body {
          flex: 1;
          overflow-y: auto;
          padding: 14px 18px;
          display: flex;
          flex-direction: column;
          gap: 14px;
        }
        .hod-kpi-row {
          display: grid;
          grid-template-columns: repeat(3, 1fr);
          gap: 8px;
        }
        .hod-kpi-card {
          background: rgba(15, 23, 42, 0.7);
          border: 1px solid rgba(255, 255, 255, 0.08);
          border-radius: 8px;
          padding: 8px;
          text-align: center;
        }
        .hod-kpi-title {
          font-size: 9px;
          text-transform: uppercase;
          color: #94a3b8;
          letter-spacing: 0.5px;
        }
        .hod-kpi-val {
          font-size: 14px;
          font-weight: 700;
          color: #f8fafc;
          font-family: monospace;
          margin-top: 2px;
        }
        .hod-kpi-sub {
          font-size: 9px;
          color: #64748b;
          margin-top: 1px;
        }
        .hod-table-card {
          background: rgba(15, 23, 42, 0.7);
          border: 1px solid rgba(255, 255, 255, 0.08);
          border-radius: 8px;
          overflow: hidden;
        }
        .hod-table-head {
          padding: 8px 12px;
          background: rgba(30, 41, 59, 0.5);
          border-bottom: 1px solid rgba(255, 255, 255, 0.06);
          font-size: 11px;
          font-weight: 600;
          color: #e2e8f0;
          display: flex;
          justify-content: space-between;
        }
        .hod-table {
          width: 100%;
          border-collapse: collapse;
          font-size: 11px;
        }
        .hod-table th {
          text-align: left;
          padding: 6px 8px;
          color: #94a3b8;
          font-size: 9px;
          border-bottom: 1px solid rgba(255, 255, 255, 0.06);
        }
        .hod-table td {
          padding: 6px 8px;
          border-bottom: 1px solid rgba(255, 255, 255, 0.04);
          color: #cbd5e1;
        }
        .hod-table tr:hover {
          background: rgba(56, 189, 248, 0.1);
          cursor: pointer;
        }
        .hod-chart-card {
          background: rgba(15, 23, 42, 0.7);
          border: 1px solid rgba(255, 255, 255, 0.08);
          border-radius: 8px;
          padding: 10px;
        }
        .hod-chart-title {
          font-size: 11px;
          font-weight: 600;
          color: #e2e8f0;
          display: flex;
          justify-content: space-between;
          margin-bottom: 8px;
        }
        .hod-chaos-btn {
          width: 100%;
          padding: 10px;
          border-radius: 8px;
          border: 1px solid rgba(244, 63, 94, 0.4);
          background: linear-gradient(135deg, rgba(225, 29, 72, 0.2), rgba(159, 18, 57, 0.3));
          color: #fda4af;
          font-weight: 700;
          font-size: 11px;
          text-transform: uppercase;
          letter-spacing: 0.5px;
          cursor: pointer;
          transition: all 0.2s ease;
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 6px;
        }
        .hod-chaos-btn.active {
          background: #e11d48;
          color: #ffffff;
          box-shadow: 0 0 16px rgba(225, 29, 72, 0.6);
        }
      </style>

      <div class="hod-header">
        <div>
          <div class="hod-title">
            <span>⬡</span>
            <span id="hod-taz-name">Kadıköy Rıhtım & İskele TAZ-01</span>
          </div>
          <div class="hod-sub" id="hod-taz-sub">
            Bölge: KADIKOY • H3: 881ec93621fffff • R=450m
          </div>
        </div>
        <button class="hod-close-btn" id="hod-btn-close" title="Kapat">✕</button>
      </div>

      <div class="hod-controls-bar">
        <div style="display: flex; justify-content: space-between; align-items: center;">
          <div class="hod-btn-group" id="hod-time-modes">
            <button class="hod-pill-btn active" data-mode="live">⚡ Canlı</button>
            <button class="hod-pill-btn" data-mode="24h">Son 24 Saat</button>
            <button class="hod-pill-btn" data-mode="7d">Son 7 Gün</button>
          </div>
          <div class="hod-btn-group" id="hod-dir-modes">
            <button class="hod-pill-btn active" data-dir="outflow">📤 Giden (O_i)</button>
            <button class="hod-pill-btn" data-dir="inflow">📥 Gelen (A_j)</button>
          </div>
        </div>

        <div class="hod-slider-row" id="hod-slider-box" style="display: none;">
          <span>Saat:</span>
          <input type="range" min="0" max="23" value="8" class="hod-slider" id="hod-hour-slider" />
          <span style="font-family: monospace; font-weight: bold; color: #38bdf8;" id="hod-hour-label">08:00</span>
        </div>
      </div>

      <div class="hod-body">
        <!-- KPI Cards -->
        <div class="hod-kpi-row">
          <div class="hod-kpi-card">
            <div class="hod-kpi-title">Toplam Akış</div>
            <div class="hod-kpi-val" id="hod-kpi-flow">1.840</div>
            <div class="hod-kpi-sub">araç/saat</div>
          </div>
          <div class="hod-kpi-card">
            <div class="hod-kpi-title">GEH Başarımı</div>
            <div class="hod-kpi-val" style="color: #34d399;" id="hod-kpi-geh">%96.2</div>
            <div class="hod-kpi-sub">GEH &lt; 5.0</div>
          </div>
          <div class="hod-kpi-card">
            <div class="hod-kpi-title">CO2 Oranı</div>
            <div class="hod-kpi-val" style="color: #38bdf8;" id="hod-kpi-co2">182.4</div>
            <div class="hod-kpi-sub">g/araç-km</div>
          </div>
        </div>

        <!-- Top-10 Table -->
        <div class="hod-table-card">
          <div class="hod-table-head">
            <span>Top-10 Arzu Koridoru</span>
            <span style="color: #38bdf8;">Tersine OD Matrisi D_ij</span>
          </div>
          <div style="max-height: 160px; overflow-y: auto;">
            <table class="hod-table">
              <thead>
                <tr>
                  <th>Hedef / Kaynak</th>
                  <th style="text-align: right;">Hacim</th>
                  <th>Mod Dağılımı</th>
                  <th style="text-align: right;">Süre</th>
                  <th style="text-align: right;">Maliyet</th>
                </tr>
              </thead>
              <tbody id="hod-table-body">
                <!-- Dynamically populated -->
              </tbody>
            </table>
          </div>
        </div>

        <!-- SVG Diurnal Curve -->
        <div class="hod-chart-card">
          <div class="hod-chart-title">
            <span>24 Saatlik Diurnal Talep D_ij(t)</span>
            <span style="font-family: monospace; color: #38bdf8;">Pik: 08:30 & 18:00</span>
          </div>
          <div style="width: 100%; height: 75px;">
            <svg viewBox="0 0 240 60" style="width: 100%; height: 100%; overflow: visible;">
              <line x1="0" y1="55" x2="240" y2="55" stroke="#334155" stroke-width="0.5" />
              <line x1="0" y1="30" x2="240" y2="30" stroke="#334155" stroke-width="0.5" stroke-dasharray="2" />
              <path d="M 0 52 Q 40 50, 60 45 T 80 12 T 100 24 T 140 28 T 180 10 T 210 35 T 240 50 L 240 55 L 0 55 Z" fill="rgba(56, 189, 248, 0.2)" />
              <path d="M 0 52 Q 40 50, 60 45 T 80 12 T 100 24 T 140 28 T 180 10 T 210 35 T 240 50" fill="none" stroke="#38bdf8" stroke-width="2" />
              <line id="hod-chart-hour-line" x1="80" y1="0" x2="80" y2="55" stroke="#f43f5e" stroke-width="1.5" stroke-dasharray="2" />
              <circle id="hod-chart-hour-dot" cx="80" cy="18" r="3" fill="#f43f5e" />
            </svg>
          </div>
          <div style="display: flex; justify-content: space-between; font-size: 8px; color: #64748b; font-family: monospace; margin-top: 2px;">
            <span>00:00</span><span>06:00</span><span>12:00</span><span>18:00</span><span>23:00</span>
          </div>
        </div>

        <!-- MFD q-k Diagram -->
        <div class="hod-chart-card">
          <div class="hod-chart-title">
            <span>Makroskopik Temel Diyagram (MFD)</span>
            <span style="color: #f59e0b;" id="hod-mfd-label">Serbest Akış</span>
          </div>
          <div style="width: 100%; height: 75px;">
            <svg viewBox="0 0 240 60" style="width: 100%; height: 100%; overflow: visible;">
              <line x1="10" y1="55" x2="230" y2="55" stroke="#334155" stroke-width="0.5" />
              <line x1="10" y1="5" x2="10" y2="55" stroke="#334155" stroke-width="0.5" />
              <path d="M 10 55 Q 120 5, 230 55" fill="none" stroke="#10b981" stroke-width="2" />
              <circle id="hod-mfd-dot" cx="75" cy="25" r="4" fill="#fbbf24" stroke="#ffffff" stroke-width="1" />
            </svg>
          </div>
          <div style="display: flex; justify-content: space-between; font-size: 8px; color: #64748b; font-family: monospace; margin-top: 2px;">
            <span>k=0</span><span style="color: #10b981;">k_c=45 (Kapasite)</span><span style="color: #ef4444;">k_j=140</span>
          </div>
        </div>

        <!-- 10x What-If Chaos Button -->
        <div>
          <button class="hod-chaos-btn" id="hod-btn-chaos">
            <span>💥</span>
            <span id="hod-chaos-text">10x Koridor Kaosu ve Şok Dalgası Tetikle</span>
          </button>
        </div>
      </div>
    `;

    document.body.appendChild(el);
    this.el = el;
    this.bindEvents();
  }

  bindEvents() {
    this.el.querySelector('#hod-btn-close').addEventListener('click', () => {
      this.close();
    });

    // Time filter mode buttons
    const timeBtns = this.el.querySelectorAll('#hod-time-modes button');
    timeBtns.forEach((btn) => {
      btn.addEventListener('click', () => {
        timeBtns.forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');
        const mode = btn.dataset.mode;
        this.timeFilterMode = mode;
        const sliderBox = this.el.querySelector('#hod-slider-box');
        sliderBox.style.display = mode === '24h' ? 'flex' : 'none';
        if (this.onTimeFilterChange) this.onTimeFilterChange(mode);
      });
    });

    // Direction buttons
    const dirBtns = this.el.querySelectorAll('#hod-dir-modes button');
    dirBtns.forEach((btn) => {
      btn.addEventListener('click', () => {
        dirBtns.forEach((b) => b.classList.remove('active', 'active-amber'));
        const dir = btn.dataset.dir;
        this.flowDirection = dir;
        btn.classList.add(dir === 'outflow' ? 'active' : 'active-amber');
        if (this.onFlowDirectionChange) this.onFlowDirectionChange(dir);
        this.renderCorridors();
      });
    });

    // Hour slider
    const slider = this.el.querySelector('#hod-hour-slider');
    const label = this.el.querySelector('#hod-hour-label');
    slider.addEventListener('input', (e) => {
      const h = Number(e.target.value);
      this.selectedHour = h;
      label.textContent = `${String(h).padStart(2, '0')}:00`;
      this.updateChartHour(h);
      if (this.onHourChange) this.onHourChange(h);
    });

    // Chaos button
    const chaosBtn = this.el.querySelector('#hod-btn-chaos');
    chaosBtn.addEventListener('click', () => {
      this.chaosActive = !this.chaosActive;
      chaosBtn.classList.toggle('active', this.chaosActive);
      this.el.querySelector('#hod-chaos-text').textContent = this.chaosActive
        ? 'Aktif Kaos Şok Dalgasını Sonlandır'
        : '10x Koridor Kaosu ve Şok Dalgası Tetikle';
      if (this.onTriggerChaos) this.onTriggerChaos(this.chaosActive);
    });
  }

  updateChartHour(h) {
    const line = this.el.querySelector('#hod-chart-hour-line');
    const dot = this.el.querySelector('#hod-chart-hour-dot');
    const x = (h / 23.0) * 240.0;
    if (line) {
      line.setAttribute('x1', x);
      line.setAttribute('x2', x);
    }
    if (dot) {
      dot.setAttribute('cx', x);
    }
  }

  open(selectedTaz, corridors = [], gehReport = null) {
    this.selectedTaz = selectedTaz;
    this.corridors = corridors;
    this.gehReport = gehReport;
    this.isOpen = true;
    this.el.style.display = 'flex';
    this.updateHeader();
    this.renderCorridors();
    this.updateKpis();
  }

  close() {
    this.isOpen = false;
    this.el.style.display = 'none';
  }

  toggle(selectedTaz, corridors, gehReport) {
    if (this.isOpen) this.close();
    else this.open(selectedTaz, corridors, gehReport);
  }

  updateData(selectedTaz, corridors, gehReport) {
    this.selectedTaz = selectedTaz;
    this.corridors = corridors;
    this.gehReport = gehReport;
    if (this.isOpen) {
      this.updateHeader();
      this.renderCorridors();
      this.updateKpis();
    }
  }

  updateHeader() {
    if (!this.selectedTaz) {
      this.el.querySelector('#hod-taz-name').textContent = 'Metropol Geneli (36 TAZ Hubs)';
      this.el.querySelector('#hod-taz-sub').textContent = 'Bölge: İstanbul Koridoru • H3 Res 8 • Dinamik OD Matrisi';
      return;
    }
    this.el.querySelector('#hod-taz-name').textContent = this.selectedTaz.name;
    this.el.querySelector('#hod-taz-sub').textContent = `Bölge: ${this.selectedTaz.district} • H3: ${this.selectedTaz.id.slice(0, 14)} • Pop: ${this.selectedTaz.population.toLocaleString()}`;

    // Update MFD operating point on SVG
    const k = this.selectedTaz.densityVehKm || 35;
    const mfdDot = this.el.querySelector('#hod-mfd-dot');
    const mfdLabel = this.el.querySelector('#hod-mfd-label');
    const normK = Math.min(1.0, k / 140.0);
    const cx = 10 + normK * 220;
    const cy = 55 - 4.0 * normK * (1.0 - normK) * 50;
    if (mfdDot) {
      mfdDot.setAttribute('cx', cx);
      mfdDot.setAttribute('cy', cy);
    }
    if (mfdLabel) {
      mfdLabel.textContent = this.selectedTaz.mfdState || 'Serbest Akış';
    }
  }

  updateKpis() {
    const flowVal = this.selectedTaz
      ? (this.flowDirection === 'outflow' ? this.selectedTaz.productionO : this.selectedTaz.attractionA)
      : 34500;
    this.el.querySelector('#hod-kpi-flow').textContent = flowVal.toLocaleString();

    const gehVal = this.gehReport ? `%${this.gehReport.screenlinesUnder5Pct}` : '%94.8';
    this.el.querySelector('#hod-kpi-geh').textContent = gehVal;

    const co2Val = this.selectedTaz ? this.selectedTaz.co2GPerKm : 185.0;
    this.el.querySelector('#hod-kpi-co2').textContent = co2Val;
  }

  renderCorridors() {
    const tbody = this.el.querySelector('#hod-table-body');
    tbody.innerHTML = '';

    if (!this.selectedTaz) return;

    const filtered = this.corridors
      .filter((c) => (this.flowDirection === 'outflow' ? c.originId === this.selectedTaz.id : c.destId === this.selectedTaz.id))
      .sort((a, b) => b.tripsPerHour - a.tripsPerHour)
      .slice(0, 10);

    for (const c of filtered) {
      const tr = document.createElement('tr');
      const targetName = this.flowDirection === 'outflow' ? c.destName : c.originName;

      tr.innerHTML = `
        <td style="font-weight: 600; color: #f8fafc; max-width: 130px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
          ${targetName.split(' TAZ')[0]}
        </td>
        <td style="text-align: right; font-weight: 700; color: #ffffff; font-family: monospace;">
          ${c.tripsPerHour}
        </td>
        <td>
          <div style="width: 55px; height: 6px; background: #1e293b; border-radius: 4px; display: flex; overflow: hidden;" title="Özel Araç: %${c.modalSplit.privateCarPct} | Metro/Otobüs: %${c.modalSplit.gtfsTransitPct} | VRP: %${c.modalSplit.vrpFreightPct}">
            <div style="width: ${c.modalSplit.privateCarPct}%; background: #38bdf8;"></div>
            <div style="width: ${c.modalSplit.gtfsTransitPct}%; background: #34d399;"></div>
            <div style="width: ${c.modalSplit.vrpFreightPct}%; background: #fbbf24;"></div>
          </div>
        </td>
        <td style="text-align: right; font-family: monospace; color: #94a3b8;">
          ${c.congestedMinutes}m
        </td>
        <td style="text-align: right; font-family: monospace; color: #38bdf8; font-weight: 600;">
          ₺${c.zTotalCostTL.toLocaleString()}
        </td>
      `;

      tr.addEventListener('click', () => {
        if (this.onCorridorClick) this.onCorridorClick(c);
      });

      tbody.appendChild(tr);
    }
  }
}
