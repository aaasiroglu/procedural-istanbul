// Geo-Twin Istanbul: Executive Command Center & Ergonomic Dashboard UI
// Unified, non-fatiguing, modern glassmorphic interface designed for presentations and operational decision making.
import * as THREE from 'three';

export class GeoTwinUI {
  constructor({
    transit,
    traffic,
    vrpManager,
    agentic,
    naturalIncident,
    clockTime,
    controls,
    camera,
    streamer,
    landmarksGroup,
    proj,
    state,
    gui,
    onTogglePinMode,
    onToggleH3Taz,
    onOpenOdDrawer,
    onSelectHexMetric,
    onOpenAnalyticsDashboard,
    onOpenRecommendations,
    onToggleRoadHeatmap,
    onToggleOdArcs,
    onToggleRouteRibbon,
  }) {
    this.transit = transit;
    this.traffic = traffic;
    this.vrpManager = vrpManager;
    this.agentic = agentic;
    this.naturalIncident = naturalIncident;
    this.clockTime = clockTime;
    this.controls = controls;
    this.camera = camera;
    this.streamer = streamer;
    this.landmarksGroup = landmarksGroup;
    this.proj = proj;
    this.state = state;
    this.gui = gui;
    this.onTogglePinMode = onTogglePinMode;
    this.onToggleH3Taz = onToggleH3Taz;
    this.onOpenOdDrawer = onOpenOdDrawer;
    this.onSelectHexMetric = onSelectHexMetric;
    this.onOpenAnalyticsDashboard = onOpenAnalyticsDashboard;
    this.onOpenRecommendations = onOpenRecommendations;
    this.onToggleRoadHeatmap = onToggleRoadHeatmap;
    this.onToggleOdArcs = onToggleOdArcs;
    this.onToggleRouteRibbon = onToggleRouteRibbon;

    this.activeTab = 'scenarios'; // 'scenarios', 'agentic', 'layers', 'camera', 'metrics', 'od'
    this.dockCollapsed = false;
    this.zenMode = false;
    this.pinModeActive = false;

    this.initHTML();
    this.bindEvents();
    this.updateGeminiBadge();
  }

  initHTML() {
    // 1. Master Container
    const root = document.createElement('div');
    root.id = 'geotwin-deck';
    this.deck = root;
    root.innerHTML = `
      <!-- TOP NAVIGATION & TELEMETRY BAR -->
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
          <div class="telemetry-pill">
            <span class="dot online"></span>
            <span class="t-label">Canlı Trafik:</span>
            <span class="t-val" id="top-live-traffic">bağlanıyor…</span>
          </div>
        </div>

        <div class="topbar-right">
          <!-- The recommendation panel: what the real estimate says (the first thing to show) -->
          <button id="btn-open-recommendations" class="time-btn" style="border: 1px solid rgba(52, 211, 153, 0.7); background: rgba(16, 185, 129, 0.22); color: #6ee7b7; font-weight: 700; display: flex; align-items: center; gap: 6px; box-shadow: 0 0 14px rgba(16, 185, 129, 0.2);" title="Sayımlarla sabitlenmiş O-D tahmininden öneriler: darboğazlar, kaza müdahalesi, teyit edilecek sensörler">
            <span>✅</span>
            <span>Öneriler · gerçek veri</span>
          </button>

          <!-- Scenario dashboard: illustrative values, labelled as such -->
          <button id="btn-open-analytics-dashboard" class="time-btn" style="border: 1px solid rgba(148, 163, 184, 0.45); background: rgba(51, 65, 85, 0.35); color: #cbd5e1; font-weight: 600; display: flex; align-items: center; gap: 6px;" title="Senaryo ve tahminleme paneli. Değerleri gösterim amaçlıdır; gerçek sonuçlar Öneriler panelinde">
            <span>📊</span>
            <span>Senaryo paneli</span>
            <span style="font-size: 9px; font-weight: 700; color: #fbbf24; border: 1px solid rgba(251, 191, 36, 0.5); border-radius: 4px; padding: 0 4px;">gösterim</span>
          </button>

          <!-- H3 TAZ & OD Analytics Quick Toggle -->
          <button id="btn-toggle-h3-taz" class="time-btn" style="border: 1px solid rgba(56, 189, 248, 0.5); background: rgba(56, 189, 248, 0.15); color: #38bdf8; font-weight: 600;" title="Tahminin 95 zonu (H3 altıgenleri ve geçitler): üzerine gelince üretim, çekim ve İBB hızı; tıklayınca o zonun O-D akışları">
            ⬡ O-D zonları
          </button>

          <!-- Time of Day Quick Switcher -->
          <div class="time-switcher">
            <button class="time-btn active" data-time="live" title="Canlı Saat">⏱️ Canlı</button>
            <button class="time-btn" data-time="12" title="Gündüz">☀️ Gündüz</button>
            <button class="time-btn" data-time="19.5" title="Gün Batımı">🌅 Gün Batımı</button>
            <button class="time-btn" data-time="22.5" title="Gece">🌙 Gece</button>
          </div>

          <!-- Zen Mode Button -->
          <button id="zen-btn" class="zen-toggle-btn" title="Arayüzü Gizle / Tam Ekran (Zen Modu)">
            <span class="zen-icon">👁️</span>
            <span class="zen-label">Temiz Ekran</span>
          </button>
        </div>
      </header>

      <!-- PIN MODE FLOATING INSTRUCTION BANNER -->
      <div id="pin-instruction-banner" class="pin-banner" style="display: none;">
        <span class="p-icon">📍</span>
        <span class="p-text">Haritada veya binaların üzerinde bir noktaya tıklayın...</span>
        <button id="btn-cancel-pin" class="p-cancel">Vazgeç (ESC)</button>
      </div>

      <!-- LEFT COMMAND DOCK -->
      <aside id="geotwin-sidebar" class="dock-panel collapsed">
        <!-- Navigation Tabs -->
        <nav class="dock-nav">
          <button class="dock-tab active" data-tab="scenarios" title="Kriz & Olay Simülasyonu">
            <span class="tab-icon">🚨</span>
            <span class="tab-label">Krizler</span>
          </button>
          <button class="dock-tab" data-tab="agentic" title="Agentic AI & What-If">
            <span class="tab-icon">🤖</span>
            <span class="tab-label">Ajanlar</span>
          </button>
          <button class="dock-tab" data-tab="od" title="H3 TAZ & Tersine OD Analitiği">
            <span class="tab-icon">⬡</span>
            <span class="tab-label">Tersine OD</span>
          </button>
          <button class="dock-tab" data-tab="layers" title="Görsel Katmanlar">
            <span class="tab-icon">🗺️</span>
            <span class="tab-label">Katmanlar</span>
          </button>
          <button class="dock-tab" data-tab="camera" title="Kamera Bakışları">
            <span class="tab-icon">📍</span>
            <span class="tab-label">Kameralar</span>
          </button>
          <button class="dock-tab" data-tab="metrics" title="Sistem Metrikleri">
            <span class="tab-icon">📊</span>
            <span class="tab-label">Metrikler</span>
          </button>
          <button id="dock-collapse-btn" class="dock-tab collapse-btn" title="Paneli Genişlet / Küçült">
            <span class="tab-icon">▶</span>
          </button>
        </nav>

        <!-- Tab Contents Container -->
        <div class="dock-content">
          <!-- TAB 1: SCENARIOS & AI INCIDENT INGESTION -->
          <div class="tab-pane active" id="pane-scenarios">
            <div class="pane-header">
              <h3>🚨 Kriz & Olay Simülasyonu</h3>
              <p>Doğal dil, harita pini veya senaryolarla kriz simülasyonu başlatın.</p>
            </div>

            <!-- NATURAL LANGUAGE & AI INCIDENT ENGINE -->
            <div class="nlp-box">
              <div class="nlp-box-header">
                <span class="nlp-title">⚡ Akıllı Olay Bildirimi (AI / NLP)</span>
                <span class="gemini-badge" id="gemini-status-badge">🟢 Yerel NLP</span>
              </div>
              <p class="nlp-hint">Şehirdeki olayları Türkçe doğal dille yazın; trafik, toplu taşıma ve filo anında adapte olsun.</p>

              <div class="nlp-input-row">
                <input type="text" id="nlp-incident-input" class="nlp-input" placeholder="Örn: Özdilek AVM'de yangın çıktı..." autocomplete="off" />
                <button id="nlp-submit-btn" class="nlp-submit-btn" title="Simülasyonu Başlat">
                  <span class="btn-icon">⚡</span>
                  <span class="btn-text">Simüle Et</span>
                </button>
              </div>

              <!-- Quick Prompt Chips -->
              <div class="nlp-chips">
                <button class="nlp-chip" data-prompt="Özdilek AVM'de yangın çıktı, dumanlar yükseliyor">🔥 Özdilek Yangın</button>
                <button class="nlp-chip" data-prompt="Mecidiyeköy viyadüğünde 3 araç karışan zincirleme kaza">💥 Mecidiyeköy Kaza</button>
                <button class="nlp-chip" data-prompt="Zorlu Center önünde şiddetli su baskını ve göllenme">🌊 Zorlu Su Baskını</button>
                <button class="nlp-chip" data-prompt="Zincirlikuyu Metrobüs peronunda teknik arıza ve sefer duruşu">🚌 Zincirlikuyu Arıza</button>
              </div>

              <!-- Action Buttons: Pin Dropper & Gemini Key -->
              <div class="nlp-actions-row">
                <button id="btn-pin-mode" class="nlp-action-btn pin-btn" title="Haritadan veya binalardan nokta seçerek olay bildir">
                  <span class="pin-icon">📍</span>
                  <span class="pin-label">Haritadan Nokta Seç</span>
                </button>
                <button id="btn-toggle-gemini-key" class="nlp-action-btn key-btn" title="Gemini API Anahtarını Ayarla">
                  <span>🔑</span>
                  <span>Gemini Key</span>
                </button>
              </div>

              <!-- Collapsible Gemini Key Drawer -->
              <div id="gemini-key-drawer" class="gemini-drawer" style="display: none;">
                <label class="gemini-drawer-label">Google Gemini API Key (Opsiyonel / Flash 2.5):</label>
                <div class="gemini-key-input-row">
                  <input type="password" id="gemini-key-input" class="gemini-key-input" placeholder="AIzaSy..." />
                  <button id="btn-save-gemini-key" class="gemini-save-btn">Kaydet</button>
                </div>
                <span class="gemini-drawer-sub">Boş bırakılırsa yerel akıllı koridor NLP motoru (0ms gecikme) devrededir.</span>
              </div>

              <!-- Active Dynamic Incidents List -->
              <div id="active-incidents-list" class="active-incidents-list" style="display: none;">
                <div class="act-head">
                  <span>Aktif Kriz Bildirimleri (<span id="act-count">0</span>)</span>
                  <button id="btn-clear-all-nlp" class="act-clear-all" title="Tüm bildirimleri temizle">Tümünü Kaldır</button>
                </div>
                <div id="act-items" class="act-items"></div>
              </div>
            </div>

            <div class="pane-divider"></div>
            <div class="pane-subhead">📋 Hızlı Koridor Test Senaryoları</div>
            <div class="scenario-grid">
              <button class="scenario-card danger" id="btn-scen-bridge">
                <div class="card-icon">💥</div>
                <div class="card-info">
                  <span class="c-title">Köprü Katılım Kazası</span>
                  <span class="c-desc">15 Temmuz Şehitler Köprüsü girişinde zincirleme kaza</span>
                </div>
              </button>

              <button class="scenario-card warning" id="btn-scen-metrobus">
                <div class="card-icon">🚌</div>
                <div class="card-info">
                  <span class="c-title">Mecidiyeköy Metrobüs Arızası</span>
                  <span class="c-desc">Peronda arıza; kontrollü seferler & yolcu birikimi</span>
                </div>
              </button>

              <button class="scenario-card danger" id="btn-scen-metro">
                <div class="card-icon">🚇</div>
                <div class="card-info">
                  <span class="c-title">Gayrettepe Metro Arızası</span>
                  <span class="c-desc">M11 Havalimanı & M2 entegrasyonu teknik duruş</span>
                </div>
              </button>

              <button class="scenario-card warning" id="btn-scen-levent">
                <div class="card-icon">🚧</div>
                <div class="card-info">
                  <span class="c-title">Büyükdere Cad. Çalışması</span>
                  <span class="c-desc">Plazalar bölgesinde şerit daraltma ve çalışma</span>
                </div>
              </button>

              <button class="scenario-card success" id="btn-scen-reset">
                <div class="card-icon">✅</div>
                <div class="card-info">
                  <span class="c-title">Tüm Olayları Sıfırla / Yolları Aç</span>
                  <span class="c-desc">Şehir trafiğini ve toplu taşımayı normale döndür</span>
                </div>
              </button>
            </div>
          </div>

          <!-- TAB 2: AGENTIC AI & WHAT-IF -->
          <div class="tab-pane" id="pane-agentic">
            <div class="pane-header">
              <h3>🤖 Agentic AI Komuta Merkezi</h3>
              <p>Otonom karar ajanları ve 10x hızlı gölge simülasyonu.</p>
            </div>
            <div class="agentic-summary">
              <div class="od-card">
                <div class="od-row">
                  <span class="od-title">Eulerian ➔ Lagrangian OD:</span>
                  <span class="od-badge">28.450 araç/saat</span>
                </div>
                <div class="od-row">
                  <span class="od-title">LWR Kütle Korunumu (L_LWR):</span>
                  <span class="od-badge success">0.0076 (Dengeli)</span>
                </div>
              </div>

              <div class="agent-pills">
                <div class="a-pill"><span class="a-dot online"></span> 1. Anomaly Agent</div>
                <div class="a-pill"><span class="a-dot online"></span> 2. Shadow Sim (10x)</div>
                <div class="a-pill"><span class="a-dot online"></span> 3. Control Agent</div>
                <div class="a-pill"><span class="a-dot online"></span> 4. VRP Dispatcher</div>
              </div>

              <div class="whatif-box" id="side-whatif-box">
                <span class="w-head">⚡ 10x What-If Karşılaştırma Sonuçları</span>
                <div class="w-item">
                  <span>A: Müdahalesiz</span>
                  <div class="w-bar-bg"><div class="w-bar r-90 red"></div></div>
                  <span>+46 dk</span>
                </div>
                <div class="w-item">
                  <span>B: Otobüs Şeridi</span>
                  <div class="w-bar-bg"><div class="w-bar r-50 orange"></div></div>
                  <span>-32%</span>
                </div>
                <div class="w-item best">
                  <span>C: GFlowNet (SEÇİLDİ)</span>
                  <div class="w-bar-bg"><div class="w-bar r-20 green"></div></div>
                  <span>-%54 (Optimal)</span>
                </div>
              </div>
            </div>
          </div>

          <!-- TAB 3: LAYERS -->
          <div class="tab-pane" id="pane-layers">
            <div class="pane-header">
              <h3>🗺️ Görsel Katmanlar & Unsurlar</h3>
              <p>Dijital ikiz bileşenlerini kolayca açıp kapatın.</p>
            </div>
            <div class="layer-toggles">
              <label class="toggle-row">
                <span class="toggle-label">🚗 Canlı Araç Trafiği</span>
                <input type="checkbox" id="chk-traffic" checked />
                <span class="slider"></span>
              </label>

              <label class="toggle-row">
                <span class="toggle-label">🚌 Metrobüs Filosu (Körüklü)</span>
                <input type="checkbox" id="chk-metrobus" checked />
                <span class="slider"></span>
              </label>

              <label class="toggle-row">
                <span class="toggle-label">📦 VRP Kurye Neon Rotaları</span>
                <input type="checkbox" id="chk-vrp" checked />
                <span class="slider"></span>
              </label>

              <label class="toggle-row">
                <span class="toggle-label">🏢 3B Şehir Binaları</span>
                <input type="checkbox" id="chk-buildings" checked />
                <span class="slider"></span>
              </label>

              <label class="toggle-row">
                <span class="toggle-label">🌉 Viyadükler ve Köprü Ayakları</span>
                <input type="checkbox" id="chk-flyovers" checked />
                <span class="slider"></span>
              </label>

              <label class="toggle-row">
                <span class="toggle-label">🌳 Ağaçlar & Yeşillendirme</span>
                <input type="checkbox" id="chk-props" checked />
                <span class="slider"></span>
              </label>

              <label class="toggle-row">
                <span class="toggle-label">🏷️ 3B Holografik Şehir Etiketleri</span>
                <input type="checkbox" id="chk-landmarks" checked />
                <span class="slider"></span>
              </label>

              <label class="toggle-row">
                <span class="toggle-label">🚥 Canlı İBB Renk Lejantı</span>
                <input type="checkbox" id="chk-legend" checked />
                <span class="slider"></span>
              </label>

              <label class="toggle-row">
                <span class="toggle-label">⬡ H3 Altıgen TAZ Petekleri</span>
                <input type="checkbox" id="chk-h3-taz" checked />
                <span class="slider"></span>
              </label>

              <label class="toggle-row">
                <span class="toggle-label">🌈 Yol Trafik Akış Damarları (Heatmap)</span>
                <input type="checkbox" id="chk-road-heatmap" />
                <span class="slider"></span>
              </label>

              <label class="toggle-row">
                <span class="toggle-label">🏹 OD Arzu Yayları (Desire Arcs)</span>
                <input type="checkbox" id="chk-od-arcs" checked />
                <span class="slider"></span>
              </label>

              <label class="toggle-row">
                <span class="toggle-label">📍 A ➔ B Rota Şeridi</span>
                <input type="checkbox" id="chk-route-ribbon" checked />
                <span class="slider"></span>
              </label>

              <div class="perf-notice-row">
                <span class="p-notice-icon">⚡</span>
                <div class="p-notice-content">
                  <span class="p-notice-title">Yüksek FPS / Saf Simülasyon Modu</span>
                  <span class="p-notice-sub">Elektrik direkleri, teller, kuşlar ve ağır sokak donatıları kaldırıldı. 3B modeller ve simülasyon akıcı çalışır.</span>
                </div>
              </div>
            </div>
          </div>

          <!-- TAB 4: CAMERA PRESETS -->
          <div class="tab-pane" id="pane-camera">
            <div class="pane-header">
              <h3>📍 Hızlı Kamera Odakları</h3>
              <p>Stratejik kavşak ve koridorlara tek tıkla uçun.</p>
            </div>
            <div class="camera-grid">
              <button class="cam-card" data-cam="zincirlikuyu">
                <span class="cam-icon">🔀</span>
                <div class="cam-text">
                  <span class="cam-title">Zincirlikuyu Kavşağı</span>
                  <span class="cam-sub">Viyadükler, Metrobüs & Zorlu Center</span>
                </div>
              </button>

              <button class="cam-card" data-cam="bridge">
                <span class="cam-icon">🌉</span>
                <div class="cam-text">
                  <span class="cam-title">15 Temmuz Şehitler Köprüsü</span>
                  <span class="cam-sub">Boğaziçi Otoyol Katılımı & Trafik</span>
                </div>
              </button>

              <button class="cam-card" data-cam="mecidiyekoy">
                <span class="cam-icon">🏬</span>
                <div class="cam-text">
                  <span class="cam-title">Mecidiyeköy Meydanı</span>
                  <span class="cam-sub">Viyadük, Cevahir & Metro Aktarma</span>
                </div>
              </button>

              <button class="cam-card" data-cam="levent">
                <span class="cam-icon">🏢</span>
                <div class="cam-text">
                  <span class="cam-title">Levent Plazalar Bölgesi</span>
                  <span class="cam-sub">Büyükdere Caddesi, Kanyon & Sapphire</span>
                </div>
              </button>

              <button class="cam-card" data-cam="overview">
                <span class="cam-icon">🦅</span>
                <div class="cam-text">
                  <span class="cam-title">Kuşbakışı Genel Görünüm</span>
                  <span class="cam-sub">Tüm Koridorun Yüksek Açılı Perspektifi</span>
                </div>
              </button>
            </div>
          </div>

          <!-- TAB 3: H3 TAZ & REVERSE OD -->
          <div class="tab-pane" id="pane-od">
            <div class="pane-header">
              <h3>⬡ H3 TAZ & Tersine OD Analitiği</h3>
              <p>36 Altıgen TAZ, MFD Yoğunlukları, GEH Doğrulama ve Arzu Çizgileri.</p>
            </div>
            <div style="display: flex; flex-direction: column; gap: 12px; padding: 12px 0;">
              <button id="sidebar-btn-open-forecast-dashboard" class="action-btn" style="background: linear-gradient(135deg, #0284c7 0%, #0369a1 100%); border: 1px solid #38bdf8; color: #ffffff; padding: 12px; border-radius: 8px; font-weight: 700; cursor: pointer; display: flex; align-items: center; justify-content: center; gap: 8px; box-shadow: 0 4px 12px rgba(2, 132, 199, 0.4); transition: all 0.2s;">
                <span>📈</span>
                <span>Trafik Tahminleme & OD Matris Dashboard'u</span>
              </button>

              <button id="sidebar-btn-open-od-drawer" class="action-btn" style="background: rgba(56, 189, 248, 0.2); border: 1px solid #38bdf8; color: #38bdf8; padding: 12px; border-radius: 8px; font-weight: 700; cursor: pointer; display: flex; align-items: center; justify-content: center; gap: 8px; transition: all 0.2s;">
                <span>📊</span>
                <span>"Nereden Nereye?" Çekmecesini Aç</span>
              </button>

              <div style="background: rgba(15, 23, 42, 0.7); padding: 12px; border-radius: 8px; border: 1px solid rgba(255,255,255,0.08);">
                <div style="font-size: 11px; font-weight: 600; color: #94a3b8; margin-bottom: 8px;">Görselleştirilen 3B TAZ Metriği:</div>
                <select id="sidebar-select-hex-metric" style="width: 100%; background: #0f172a; color: #e2e8f0; border: 1px solid #334155; padding: 8px; border-radius: 6px; font-size: 11px; outline: none; cursor: pointer;">
                  <option value="total_outflow">📤 Üretim (Giden Akış O_i)</option>
                  <option value="total_inflow">📥 Çekim (Gelen Akış A_j)</option>
                  <option value="mfd_density">🚦 MFD Trafik Yoğunluğu (k_i)</option>
                  <option value="geh_error">🎯 GEH Kalibrasyon Skoru</option>
                  <option value="co2">🌱 COPERT 5.9 CO2 Emisyonu</option>
                </select>
              </div>

              <div style="background: rgba(15, 23, 42, 0.5); padding: 10px; border-radius: 8px; border: 1px solid rgba(255,255,255,0.06); font-size: 11px; color: #94a3b8; line-height: 1.5;">
                <strong style="color: #38bdf8;">İpucu:</strong> Haritadaki herhangi bir 3B altıgen hücreye tıklayarak o bölgenin Top-10 arzu eğrilerini (desire lines), modal paylarını ve maliyet analizlerini görüntüleyebilirsiniz.
              </div>
            </div>
          </div>

          <!-- TAB 5: METRICS -->
          <div class="tab-pane" id="pane-metrics">
            <div class="pane-header">
              <h3>📊 Sistem & Render Metrikleri</h3>
              <p>Gerçek zamanlı Three.js ve donanım performans verileri.</p>
            </div>
            <div class="metrics-grid">
              <div class="m-card">
                <span class="m-label">Kare Hızı (FPS)</span>
                <span class="m-val" id="met-fps">60 FPS</span>
              </div>
              <div class="m-card">
                <span class="m-label">Draw Calls</span>
                <span class="m-val" id="met-draws">-</span>
              </div>
              <div class="m-card">
                <span class="m-label">Poligon Sayısı</span>
                <span class="m-val" id="met-tris">- M tris</span>
              </div>
              <div class="m-card">
                <span class="m-label">Yüklenen Tile</span>
                <span class="m-val" id="met-tiles">169 / 169</span>
              </div>
            </div>
          </div>
        </div>
      </aside>
    `;

    document.body.appendChild(root);

    // Hide the legacy developer #agentic-hud and #hud to prevent visual clutter
    const oldAgentic = document.getElementById('agentic-hud');
    if (oldAgentic) oldAgentic.style.display = 'none';

    const oldHud = document.getElementById('hud');
    if (oldHud) oldHud.style.display = 'none';

    // Move incident ticker styling into modern position if needed
    const legend = document.getElementById('traffic-legend');
    if (legend) legend.style.display = 'grid';
  }

  bindEvents() {
    // 1. Tab Switching
    const tabs = document.querySelectorAll('.dock-tab:not(.collapse-btn)');
    const panes = document.querySelectorAll('.tab-pane');

    tabs.forEach((tab) => {
      tab.addEventListener('click', () => {
        tabs.forEach((t) => t.classList.remove('active'));
        panes.forEach((p) => p.classList.remove('active'));

        tab.classList.add('active');
        const tabKey = tab.dataset.tab;
        const targetPane = document.getElementById(`pane-${tabKey}`);
        if (targetPane) targetPane.classList.add('active');

        // If dock was collapsed, open it
        const sidebar = document.getElementById('geotwin-sidebar');
        if (sidebar && sidebar.classList.contains('collapsed')) {
          sidebar.classList.remove('collapsed');
        }
      });
    });

    // 2. Collapse Sidebar
    const collapseBtn = document.getElementById('dock-collapse-btn');
    const sidebar = document.getElementById('geotwin-sidebar');
    if (collapseBtn && sidebar) {
      collapseBtn.addEventListener('click', () => {
        sidebar.classList.toggle('collapsed');
        collapseBtn.querySelector('.tab-icon').textContent = sidebar.classList.contains('collapsed') ? '▶' : '◀';
      });
    }

    // 3. Zen Mode (Clean screen toggle)
    const zenBtn = document.getElementById('zen-btn');
    if (zenBtn) {
      zenBtn.addEventListener('click', () => {
        this.zenMode = !this.zenMode;
        document.body.classList.toggle('zen-mode', this.zenMode);
        zenBtn.classList.toggle('active', this.zenMode);
      });
    }

    // 4. AI Natural Language & Map Pin Incident Engine
    const nlpInput = document.getElementById('nlp-incident-input');
    const nlpSubmitBtn = document.getElementById('nlp-submit-btn');
    if (nlpSubmitBtn && nlpInput) {
      const runSubmit = () => {
        const text = nlpInput.value.trim();
        if (text) {
          this.submitNLPIncident(text);
        }
      };
      nlpSubmitBtn.addEventListener('click', runSubmit);
      nlpInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          runSubmit();
        }
      });
    }

    // Quick Prompt Chips
    document.querySelectorAll('.nlp-chip').forEach((chip) => {
      chip.addEventListener('click', () => {
        const prompt = chip.dataset.prompt;
        if (nlpInput) nlpInput.value = prompt;
        this.submitNLPIncident(prompt);
      });
    });

    // Pin Mode Button
    const pinBtn = document.getElementById('btn-pin-mode');
    if (pinBtn) {
      pinBtn.addEventListener('click', () => {
        this.setPinModeActive(!this.pinModeActive);
      });
    }
    const cancelPinBtn = document.getElementById('btn-cancel-pin');
    if (cancelPinBtn) {
      cancelPinBtn.addEventListener('click', () => {
        this.setPinModeActive(false);
      });
    }
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this.pinModeActive) {
        this.setPinModeActive(false);
      }
    });

    // Gemini API Key Drawer & Save
    const toggleKeyBtn = document.getElementById('btn-toggle-gemini-key');
    const keyDrawer = document.getElementById('gemini-key-drawer');
    const keyInput = document.getElementById('gemini-key-input');
    const saveKeyBtn = document.getElementById('btn-save-gemini-key');

    if (toggleKeyBtn && keyDrawer) {
      toggleKeyBtn.addEventListener('click', () => {
        const isHidden = keyDrawer.style.display === 'none';
        keyDrawer.style.display = isHidden ? 'flex' : 'none';
        if (isHidden && keyInput && this.naturalIncident) {
          keyInput.value = this.naturalIncident.getApiKey();
          keyInput.focus();
        }
      });
    }

    if (saveKeyBtn && keyInput) {
      saveKeyBtn.addEventListener('click', () => {
        if (this.naturalIncident) {
          this.naturalIncident.setApiKey(keyInput.value.trim());
          this.updateGeminiBadge();
        }
        if (keyDrawer) keyDrawer.style.display = 'none';
      });
    }

    // Clear All NLP Incidents
    const clearAllNlpBtn = document.getElementById('btn-clear-all-nlp');
    if (clearAllNlpBtn) {
      clearAllNlpBtn.addEventListener('click', () => {
        if (this.naturalIncident) {
          this.naturalIncident.clearAllIncidents();
        }
      });
    }

    if (this.naturalIncident) {
      this.naturalIncident.onIncidentAdded = () => this.renderActiveIncidents();
      this.naturalIncident.onIncidentRemoved = () => this.renderActiveIncidents();
      this.naturalIncident.onIncidentCleared = () => this.renderActiveIncidents();
    }

    // Standard Quick Scenarios
    document.getElementById('btn-scen-bridge')?.addEventListener('click', () => {
      this.transit.triggerIncident('bridge-closure', this.traffic);
    });
    document.getElementById('btn-scen-metrobus')?.addEventListener('click', () => {
      this.transit.triggerIncident('metrobus-jam', this.traffic);
    });
    document.getElementById('btn-scen-metro')?.addEventListener('click', () => {
      this.transit.triggerIncident('metro-breakdown', this.traffic);
    });
    document.getElementById('btn-scen-levent')?.addEventListener('click', () => {
      this.transit.triggerIncident('levent-work', this.traffic);
    });
    document.getElementById('btn-scen-reset')?.addEventListener('click', () => {
      this.transit.resolveIncident('bridge-closure', this.traffic);
      this.transit.resolveIncident('metrobus-jam', this.traffic);
      this.transit.resolveIncident('metro-breakdown', this.traffic);
      this.transit.resolveIncident('levent-work', this.traffic);
      if (this.naturalIncident) {
        this.naturalIncident.clearAllIncidents();
      }
    });

    // 5. Time of Day Switching
    document.querySelectorAll('.time-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.time-btn').forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');

        const val = btn.dataset.time;
        if (val === 'live') {
          this.clockTime.live = true;
        } else {
          this.clockTime.live = false;
          this.clockTime.hour = parseFloat(val);
        }
      });
    });

    // 6. Layer Toggles
    const trafficChk = document.getElementById('chk-traffic');
    if (trafficChk) trafficChk.addEventListener('change', (e) => { this.state.traffic = e.target.checked; });

    const metrobusChk = document.getElementById('chk-metrobus');
    if (metrobusChk) metrobusChk.addEventListener('change', (e) => { this.transit.group.visible = e.target.checked; });

    const vrpChk = document.getElementById('chk-vrp');
    if (vrpChk) vrpChk.addEventListener('change', (e) => {
      this.vrpManager.group.visible = e.target.checked;
      this.vrpManager.setRoutesVisible(e.target.checked);
    });

    const bldgChk = document.getElementById('chk-buildings');
    if (bldgChk) bldgChk.addEventListener('change', (e) => {
      // Toggle buildings in streamer tiles
      for (const tile of this.streamer.tiles.values()) {
        const grp = tile.group || tile.mesh;
        if (grp?.children) {
          grp.children.forEach((c) => { if (c.userData?.facade || c.name?.includes('building')) c.visible = e.target.checked; });
        }
      }
    });

    const landmarksChk = document.getElementById('chk-landmarks');
    if (landmarksChk) landmarksChk.addEventListener('change', (e) => {
      if (this.landmarksGroup) this.landmarksGroup.visible = e.target.checked;
    });

    const legendChk = document.getElementById('chk-legend');
    if (legendChk) legendChk.addEventListener('change', (e) => {
      const leg = document.getElementById('traffic-legend');
      if (leg) leg.style.display = e.target.checked ? 'grid' : 'none';
    });

    const propsChk = document.getElementById('chk-props');
    if (propsChk) propsChk.addEventListener('change', (e) => {
      this.streamer.setPropsVisible(e.target.checked);
    });

    const h3Chk = document.getElementById('chk-h3-taz');
    if (h3Chk) h3Chk.addEventListener('change', (e) => {
      if (this.onToggleH3Taz) this.onToggleH3Taz(e.target.checked);
    });

    const roadHeatmapChk = document.getElementById('chk-road-heatmap');
    if (roadHeatmapChk) roadHeatmapChk.addEventListener('change', (e) => {
      if (this.onToggleRoadHeatmap) this.onToggleRoadHeatmap(e.target.checked);
    });

    const odArcsChk = document.getElementById('chk-od-arcs');
    if (odArcsChk) odArcsChk.addEventListener('change', (e) => {
      if (this.onToggleOdArcs) this.onToggleOdArcs(e.target.checked);
    });

    const routeRibbonChk = document.getElementById('chk-route-ribbon');
    if (routeRibbonChk) routeRibbonChk.addEventListener('change', (e) => {
      if (this.onToggleRouteRibbon) this.onToggleRouteRibbon(e.target.checked);
    });

    // 7. Camera Focus Presets
    document.querySelectorAll('.cam-card').forEach((card) => {
      card.addEventListener('click', () => {
        const target = card.dataset.cam;
        this.flyCameraTo(target);
      });
    });

    // 8. H3 TAZ & Reverse OD Controls
    const recsBtn = document.getElementById('btn-open-recommendations');
    if (recsBtn) {
      if (this.onOpenRecommendations) recsBtn.addEventListener('click', () => this.onOpenRecommendations());
      else recsBtn.style.display = 'none'; // (no estimate exported for this area)
    }
    const topbarForecastBtn = document.getElementById('btn-open-analytics-dashboard');
    if (topbarForecastBtn) {
      topbarForecastBtn.addEventListener('click', () => {
        if (this.onOpenAnalyticsDashboard) this.onOpenAnalyticsDashboard();
      });
    }

    const sidebarForecastBtn = document.getElementById('sidebar-btn-open-forecast-dashboard');
    if (sidebarForecastBtn) {
      sidebarForecastBtn.addEventListener('click', () => {
        if (this.onOpenAnalyticsDashboard) this.onOpenAnalyticsDashboard();
      });
    }

    const toggleH3Btn = document.getElementById('btn-toggle-h3-taz');
    if (toggleH3Btn) {
      toggleH3Btn.addEventListener('click', () => {
        if (this.onToggleH3Taz) {
          const visible = this.onToggleH3Taz();
          toggleH3Btn.style.background = visible ? 'rgba(56, 189, 248, 0.35)' : 'rgba(56, 189, 248, 0.15)';
        }
      });
    }

    const openDrawerBtn = document.getElementById('sidebar-btn-open-od-drawer');
    if (openDrawerBtn) {
      openDrawerBtn.addEventListener('click', () => {
        if (this.onOpenOdDrawer) this.onOpenOdDrawer();
      });
    }

    const metricSelect = document.getElementById('sidebar-select-hex-metric');
    if (metricSelect) {
      metricSelect.addEventListener('change', (e) => {
        if (this.onSelectHexMetric) this.onSelectHexMetric(e.target.value);
      });
    }
  }

  flyCameraTo(presetName) {
    let targetX = 0, targetZ = 0, dist = 420, az = 215, el = 32;

    if (presetName === 'zincirlikuyu') {
      targetX = 490; targetZ = -200; dist = 360; az = 210; el = 28;
    } else if (presetName === 'bridge') {
      targetX = 750; targetZ = 0; dist = 520; az = 195; el = 25;
    } else if (presetName === 'mecidiyekoy') {
      targetX = -220; targetZ = 80; dist = 400; az = 230; el = 30;
    } else if (presetName === 'levent') {
      targetX = 350; targetZ = -850; dist = 480; az = 200; el = 32;
    } else if (presetName === 'overview') {
      targetX = 250; targetZ = -200; dist = 1750; az = 180; el = 65;
    }

    const groundY = this.streamer.ground(targetX, targetZ);
    this.controls.target.set(targetX, groundY, targetZ);
    this.camera.position.copy(this.controls.target).add(
      new THREE.Vector3().setFromSphericalCoords(
        dist,
        THREE.MathUtils.degToRad(90 - el),
        THREE.MathUtils.degToRad(az)
      )
    );
    this.controls.update();
  }

  updateMetrics(fps, rendererInfo, tilesCount, maxTiles) {
    const fpsEl = document.getElementById('met-fps');
    if (fpsEl) fpsEl.textContent = `${Math.round(fps)} FPS`;

    const drawsEl = document.getElementById('met-draws');
    if (drawsEl) drawsEl.textContent = `${rendererInfo.calls} calls`;

    const trisEl = document.getElementById('met-tris');
    if (trisEl) trisEl.textContent = `${(rendererInfo.triangles / 1e6).toFixed(2)} M tris`;

    const tilesEl = document.getElementById('met-tiles');
    if (tilesEl) tilesEl.textContent = `${tilesCount} / ${maxTiles}`;
  }

  updateLiveStatus(statusText) {
    const el = document.getElementById('top-live-traffic');
    if (el) el.textContent = statusText;
  }

  updateGeminiBadge() {
    const badge = document.getElementById('gemini-status-badge');
    const input = document.getElementById('gemini-key-input');
    const key = this.naturalIncident ? this.naturalIncident.getApiKey() : '';
    if (input) input.value = key;
    if (badge) {
      if (key) {
        badge.textContent = '✨ Gemini 2.5 Flash';
        badge.className = 'gemini-badge active';
      } else {
        badge.textContent = '🟢 Yerel NLP';
        badge.className = 'gemini-badge local';
      }
    }
  }

  setPinModeActive(active) {
    this.pinModeActive = active;
    const pinBtn = document.getElementById('btn-pin-mode');
    const banner = document.getElementById('pin-instruction-banner');
    if (pinBtn) pinBtn.classList.toggle('active', active);
    if (banner) banner.style.display = active ? 'flex' : 'none';
    document.body.classList.toggle('pin-picking-active', active);
    if (this.onTogglePinMode) {
      this.onTogglePinMode(active);
    }
  }

  handleMapPinSelected({ x, y, z, lon, lat, name }) {
    this.setPinModeActive(false);
    const input = document.getElementById('nlp-incident-input');
    const promptText = input?.value.trim() || `${name || 'Bu konumda'} 3 araçlı zincirleme kaza ve yangın`;
    this.submitNLPIncident(promptText, { lon, lat, name });
  }

  async submitNLPIncident(text, coords = null) {
    if (!text && !coords) return;
    const submitBtn = document.getElementById('nlp-submit-btn');
    if (submitBtn) {
      submitBtn.classList.add('loading');
      submitBtn.disabled = true;
      const btnText = submitBtn.querySelector('.btn-text');
      if (btnText) btnText.textContent = 'İşleniyor...';
    }

    try {
      if (this.naturalIncident) {
        await this.naturalIncident.processIncidentInput(text, coords);
        const input = document.getElementById('nlp-incident-input');
        if (input) input.value = '';
      }
    } catch (err) {
      console.error('Incident execution failed:', err);
    } finally {
      if (submitBtn) {
        submitBtn.classList.remove('loading');
        submitBtn.disabled = false;
        const btnText = submitBtn.querySelector('.btn-text');
        if (btnText) btnText.textContent = 'Simüle Et';
      }
    }
  }

  renderActiveIncidents() {
    const container = document.getElementById('active-incidents-list');
    const countEl = document.getElementById('act-count');
    const itemsEl = document.getElementById('act-items');
    if (!container || !this.naturalIncident) return;

    const list = this.naturalIncident.activeIncidents;
    if (list.length === 0) {
      container.style.display = 'none';
      return;
    }

    container.style.display = 'flex';
    if (countEl) countEl.textContent = list.length;
    if (itemsEl) {
      itemsEl.innerHTML = '';
      list.forEach((item) => {
        const inc = item.incident;
        const icon = inc.incidentType === 'fire' ? '🔥' : inc.incidentType === 'accident' ? '💥' : inc.incidentType === 'flood' ? '🌊' : '⚠️';
        const card = document.createElement('div');
        card.className = 'act-card';
        card.innerHTML = `
          <div class="act-card-left">
            <span class="act-icon">${icon}</span>
            <div class="act-meta">
              <span class="act-name">${inc.locationName}</span>
              <span class="act-detail">${inc.lanesBlocked} şerit kapalı · +${inc.estimatedDelayMinutes} dk</span>
            </div>
          </div>
          <button class="act-del-btn" title="Bu bildirimi kaldır">✕</button>
        `;
        card.querySelector('.act-del-btn').addEventListener('click', () => {
          this.naturalIncident.removeIncident(item);
        });
        itemsEl.appendChild(card);
      });
    }
  }
}
