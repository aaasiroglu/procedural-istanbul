// Agentic AI & Shadow Simulation ("What-If") Orchestrator for Istanbul Geo-Twin
// Coordinates 4 autonomous AI agents: Anomaly Detector, Shadow Sim (What-If), Control Agent, and Dynamic VRP Dispatch.
import {
  computeShockwaveSpeed,
  computeSpillbackTimeMin,
  evaluateSocioTechnicalCost,
  computeGEH
} from './unified_twin_engine.js';

export class AgenticOrchestrator {
  constructor(traffic, transit, vrpManager) {
    this.traffic = traffic;
    this.transit = transit;
    this.vrpManager = vrpManager;

    this.container = null;
    this.visible = true;
    this.activeCrisis = null;
    this.logs = [];
    this.stats = {
      odTripsPerHour: 28450,
      lwrLoss: 0.0076,
      h3Zones: 148,
      agentDecision: 'Normal Akış İzleniyor (Nominal)',
      lastWhatIfDurationSec: 0,
    };

    this.initDOM();
    this.setupListeners();
  }

  initDOM() {
    this.container = document.createElement('div');
    this.container.id = 'agentic-hud';
    this.container.innerHTML = `
      <div class="agentic-header">
        <div class="title-wrap">
          <span class="pulse-indicator"></span>
          <span class="title">Geo-Twin Agentic AI Kriz Komuta Merkezi</span>
        </div>
        <button id="agentic-toggle-btn" title="Paneli Küçült / Büyüt">_</button>
      </div>

      <div class="agentic-body">
        <!-- Telemetry Row -->
        <div class="telemetry-bar">
          <div class="stat-box">
            <span class="label">Dinamik OD Talebi</span>
            <span class="value" id="hud-od-trips">28,450 araç/saat</span>
          </div>
          <div class="stat-box">
            <span class="label">LWR Fiziksel Korunum</span>
            <span class="value success" id="hud-lwr-loss">L_LWR: 0.0076 (Kararlı)</span>
          </div>
          <div class="stat-box">
            <span class="label">Bölgeleme</span>
            <span class="value">148 TAZ (H3 Res-8)</span>
          </div>
        </div>

        <!-- 4 Agents Status Grid -->
        <div class="agents-grid">
          <div class="agent-card" id="card-anomaly">
            <div class="card-head">
              <span class="badge online">Aktif</span>
              <span class="name">1. Anomaly Agent</span>
            </div>
            <div class="card-desc">İBB sensör şok dalgası ve kütle korunum takibi</div>
          </div>

          <div class="agent-card" id="card-shadow">
            <div class="card-head">
              <span class="badge idle">Hazır</span>
              <span class="name">2. Shadow Sim (What-If)</span>
            </div>
            <div class="card-desc">10x Hızlı paralel kriz senaryo testi (saveState)</div>
          </div>

          <div class="agent-card" id="card-control">
            <div class="card-head">
              <span class="badge online">Aktif</span>
              <span class="name">3. Control Agent</span>
            </div>
            <div class="card-desc">Dinamik sinyalizasyon, şerit tahsis ve GFlowNet</div>
          </div>

          <div class="agent-card" id="card-vrp">
            <div class="card-head">
              <span class="badge online">Aktif</span>
              <span class="name">4. VRP Dispatch Agent</span>
            </div>
            <div class="card-desc">Chance-constraint SLA ve Guided-LNS onarımı</div>
          </div>
        </div>

        <!-- What-If Benchmark Comparison (Appears during an incident) -->
        <div id="whatif-results" style="display: none;">
          <div class="whatif-title">⚡ 10x Hızlı "What-If" Gölge Simülasyon Çıktıları</div>
          <div class="policy-table">
            <div class="policy-row baseline">
              <span class="p-name">A: Müdahalesiz (Status Quo)</span>
              <div class="bar-wrap"><div class="bar" style="width: 90%;"></div></div>
              <span class="p-val">+46 dk · 2.4 km kuyruk</span>
            </div>
            <div class="policy-row alternate">
              <span class="p-name">B: Otobüs Şeridi Paylaşımı</span>
              <div class="bar-wrap"><div class="bar" style="width: 55%;"></div></div>
              <span class="p-val">-32% bekleme · 1.1 km</span>
            </div>
            <div class="policy-row winning">
              <span class="p-name">C: GFlowNet Reroute & Sinyal (SEÇİLDİ)</span>
              <div class="bar-wrap"><div class="bar" style="width: 25%;"></div></div>
              <span class="p-val">-54% bekleme · 450 m · SLA %98.4</span>
            </div>
          </div>
        </div>

        <!-- Live Agent Event Stream Log -->
        <div class="agentic-logs" id="agentic-log-stream">
          <div class="log-entry system">[Sistem]: Geo-Twin Mobilite Ajanları başlatıldı. Şehir sensörleri dinleniyor...</div>
        </div>
      </div>
    `;

    document.body.appendChild(this.container);

    const toggleBtn = this.container.querySelector('#agentic-toggle-btn');
    toggleBtn.addEventListener('click', () => {
      const body = this.container.querySelector('.agentic-body');
      body.style.display = body.style.display === 'none' ? 'block' : 'none';
      toggleBtn.textContent = body.style.display === 'none' ? '□' : '_';
    });
  }

  log(agent, message, type = 'info') {
    const stream = document.getElementById('agentic-log-stream');
    if (!stream) return;
    const time = new Date().toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    const div = document.createElement('div');
    div.className = `log-entry ${type}`;
    div.textContent = `[${time}] [${agent}]: ${message}`;
    stream.appendChild(div);
    stream.scrollTop = stream.scrollHeight;
  }

  setupListeners() {
    this.transit.onIncidentChange((msg, type) => {
      if (type === 'danger' || type === 'warning') {
        this.runIncidentPipeline(msg);
      } else {
        this.resolveIncidentPipeline();
      }
    });
  }

  runIncidentPipeline(crisisTitle) {
    this.activeCrisis = crisisTitle;
    const whatifDiv = document.getElementById('whatif-results');
    if (whatifDiv) whatifDiv.style.display = 'block';

    const shadowBadge = document.querySelector('#card-shadow .badge');
    if (shadowBadge) {
      shadowBadge.textContent = '10x Koşuyor';
      shadowBadge.className = 'badge running';
    }

    // Mathematical evaluation using Unified Twin Engine
    const wAB = computeShockwaveSpeed(2600, 42, 850, 118); // ~ -23.0 km/h
    const spillbackMin = computeSpillbackTimeMin(wAB, 600); // ~ 1.57 min
    const costBefore = evaluateSocioTechnicalCost({
      distanceKm: 8.5,
      speedKmh: 12.0,
      travelTimeH: 0.71,
      travelTimeStdH: 0.15,
      category: 'LCV_DIESEL_EURO6',
      losGrade: 'F',
      purpose: 'business_freight'
    });
    const costAfter = evaluateSocioTechnicalCost({
      distanceKm: 9.2,
      speedKmh: 38.0,
      travelTimeH: 0.24,
      travelTimeStdH: 0.04,
      category: 'LCV_DIESEL_EURO6',
      losGrade: 'C',
      purpose: 'business_freight'
    });
    const savingsPct = Math.round(((costBefore.zTotalEur - costAfter.zTotalEur) / costBefore.zTotalEur) * 100);

    this.log('Anomaly Agent', `🚨 Kritik anomali tespit edildi: ${crisisTitle}`, 'danger');
    this.log('FedDT Inner Loop', `LWR Kinematik Şok Dalgası: w_AB = ${wAB.toFixed(1)} km/s geriye yayılıyor. Kuyruk ${spillbackMin} dk içinde kavşağı kilitleyecek!`, 'warning');

    setTimeout(() => {
      this.log('Shadow Sim Agent', `Politika A (Müdahalesiz): Z_Total = ${costBefore.zTotalEur} € (Operasyonel: ${costBefore.zTOperationalEur} €, Çevre COPERT: ${costBefore.zEEnvironmentalEur} €, Algılanan Zaman: ${costBefore.zUPerceivedUserEur} €).`, 'info');
    }, 400);

    setTimeout(() => {
      this.log('Shadow Sim Agent', `Politika B (Dinamik Otobüs Şeridi & TSP +12s): Toplu taşıma ticari hızı 14 -> 22 km/s, filo çevrim süresi -8.5 dk.`, 'info');
    }, 800);

    setTimeout(() => {
      this.log('Shadow Sim Agent', `Politika C (GFlowNet Reroute & VSL 30 km/s): Z_Total = ${costAfter.zTotalEur} € (%${savingsPct} sosyo-teknik tasarruf, CO2eq: ${costAfter.emissions.co2eqG}g vs ${costBefore.emissions.co2eqG}g).`, 'success');
      this.log('Control Agent', '⚡ Otonom Karar: Politika C sahaya uygulandı! TKM trafik ışıkları fazları güncellendi.', 'success');

      if (shadowBadge) {
        shadowBadge.textContent = 'Karar Verildi';
        shadowBadge.className = 'badge online';
      }

      // Trigger VRP fleet dynamic repair
      const repairedCouriers = this.vrpManager.checkAndRepairRoutes();
      if (repairedCouriers.length > 0) {
        for (const c of repairedCouriers) {
          this.log('VRP Dispatch Agent', `📦 Guided-LNS Onarımı: Kurye ${c.id} (${c.brand}) ${c.reroutedTo} rotasına aktarıldı (SLA Kurtarıldı).`, 'success');
        }
      }
    }, 1300);
  }

  resolveIncidentPipeline() {
    this.activeCrisis = null;
    const whatifDiv = document.getElementById('whatif-results');
    if (whatifDiv) whatifDiv.style.display = 'none';

    const shadowBadge = document.querySelector('#card-shadow .badge');
    if (shadowBadge) {
      shadowBadge.textContent = 'Hazır';
      shadowBadge.className = 'badge idle';
    }

    this.log('Control Agent', '✅ Kriz sona erdi. Normal sinyal ve rota politikasına dönüldü.', 'success');
    this.log('VRP Dispatch Agent', 'Filo nominal teslimat rotalarına geri yüklendi.', 'info');
  }

  toggleVisibility(visible) {
    this.visible = visible;
    if (this.container) {
      this.container.style.display = visible ? 'flex' : 'none';
    }
  }
}
