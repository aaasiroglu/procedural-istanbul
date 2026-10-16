// Matrakçı-Twin Serlevha Kitâbesi HUD, Sekme Değiştirici ve İthaf Modalı
// 16. Yüzyıl Osmanlı El Yazması Serlevha / Tezhip Estetiği

import { twinStore } from './twinStore.js';
import { MATRAKCI_PALETTE } from './matrakciPalette.js';

export class MatrakciKitabeHUD {
  constructor() {
    this.container = null;
    this.initHTML();
    this.bindEvents();

    this.unsubscribe = twinStore.subscribe((state) => {
      this.renderState(state);
    });
  }

  initHTML() {
    this.container = document.createElement('div');
    this.container.id = 'matrakci-kitabe-hud';
    this.container.innerHTML = `
      <style>
        @import url('https://fonts.googleapis.com/css2?family=Cinzel:wght@600;800;900&family=Playfair+Display:ital,wght@0,600;0,800;1,600&display=swap');

        #matrakci-kitabe-hud {
          position: fixed;
          inset: 0;
          pointer-events: none;
          z-index: 10000;
          font-family: 'Cinzel', 'Playfair Display', Georgia, 'Times New Roman', serif;
          user-select: none;
        }

        /* 1. ÜST ORTA: DUAL VIEW MODE SWITCHER */
        .mode-switcher-deck {
          position: fixed;
          top: 14px;
          left: 50%;
          transform: translateX(-50%);
          display: flex;
          align-items: center;
          gap: 6px;
          background: #F6EFE2;
          padding: 5px 8px;
          border-radius: 30px;
          border: 2px solid #D4AF37;
          box-shadow: 0 8px 30px rgba(27, 59, 111, 0.25), inset 0 0 10px rgba(212, 175, 55, 0.2);
          pointer-events: auto;
          z-index: 10001;
          transition: all 0.3s cubic-bezier(0.16, 1, 0.3, 1);
        }

        .mode-switcher-deck.tactical-mode-deck {
          top: 60px;
          background: rgba(15, 23, 42, 0.92);
          border: 1px solid rgba(56, 189, 248, 0.45);
          box-shadow: 0 8px 25px rgba(0, 0, 0, 0.6), 0 0 15px rgba(56, 189, 248, 0.25);
          backdrop-filter: blur(14px);
        }

        .mode-tab-btn {
          background: transparent;
          border: 1px solid transparent;
          color: #2B241E;
          font-family: 'Cinzel', serif;
          font-size: 12px;
          font-weight: 700;
          letter-spacing: 0.05em;
          padding: 8px 18px;
          border-radius: 24px;
          cursor: pointer;
          transition: all 0.25s cubic-bezier(0.16, 1, 0.3, 1);
          display: flex;
          align-items: center;
          gap: 7px;
        }

        .mode-tab-btn:hover {
          color: #1B3B6F;
          background: rgba(212, 175, 55, 0.15);
        }

        .mode-tab-btn.active {
          background: linear-gradient(135deg, #1B3B6F 0%, #0F254A 100%);
          color: #F7F1E3;
          border-color: #D4AF37;
          box-shadow: 0 4px 14px rgba(27, 59, 111, 0.35);
        }

        .mode-tab-btn.tactical-btn.active {
          background: linear-gradient(135deg, #0f172a 0%, #1e293b 100%);
          border-color: #38bdf8;
          color: #38bdf8;
          box-shadow: 0 4px 14px rgba(56, 189, 248, 0.4);
        }

        /* 2. SOL SERLEVHA KİTÂBE PANELİ */
        .kitabe-panel {
          position: fixed;
          top: 76px;
          left: 18px;
          width: 360px;
          background: #F6EFE2;
          background-image: radial-gradient(#E8DCB9 1px, transparent 1px);
          background-size: 16px 16px;
          border: 3px double #D4AF37;
          border-radius: 8px;
          padding: 16px 18px;
          box-shadow: 0 12px 35px rgba(43, 36, 30, 0.3), inset 0 0 20px rgba(222, 203, 177, 0.5);
          pointer-events: auto;
          color: #2B241E;
          transition: transform 0.3s ease, opacity 0.3s ease;
        }

        .kitabe-panel.hidden-view {
          opacity: 0;
          transform: translateX(-400px);
          pointer-events: none;
        }

        .kitabe-header {
          text-align: center;
          border-bottom: 2px solid #D4AF37;
          padding-bottom: 10px;
          margin-bottom: 12px;
          position: relative;
        }

        .kitabe-crown {
          font-size: 11px;
          color: #D4AF37;
          letter-spacing: 0.3em;
          text-transform: uppercase;
          margin-bottom: 2px;
          font-weight: 800;
        }

        .kitabe-title {
          font-size: 16px;
          font-weight: 900;
          color: #1B3B6F;
          letter-spacing: 0.08em;
          margin: 0;
          text-shadow: 0 1px 0 rgba(255, 255, 255, 0.8);
        }

        .kitabe-sub {
          font-size: 10px;
          color: #8C3B61;
          font-style: italic;
          margin-top: 3px;
        }

        .kitabe-content {
          display: flex;
          flex-direction: column;
          gap: 12px;
        }

        .kitabe-section {
          background: rgba(255, 255, 255, 0.65);
          border: 1px solid #DECBB1;
          border-radius: 6px;
          padding: 10px 12px;
        }

        .section-label {
          font-size: 10.5px;
          font-weight: 800;
          color: #1B3B6F;
          letter-spacing: 0.06em;
          margin-bottom: 5px;
          display: flex;
          align-items: center;
          justify-content: space-between;
        }

        .section-value {
          font-size: 12px;
          font-weight: 600;
          color: #2B241E;
          line-height: 1.4;
        }

        .badge-gold {
          background: #D4AF37;
          color: #2B241E;
          padding: 2px 7px;
          border-radius: 12px;
          font-size: 10px;
          font-weight: 800;
        }

        .badge-green {
          background: #234F32;
          color: #F7F1E3;
          padding: 2px 7px;
          border-radius: 12px;
          font-size: 10px;
          font-weight: 700;
        }

        .badge-coral {
          background: #D94E34;
          color: #FFF;
          padding: 2px 7px;
          border-radius: 12px;
          font-size: 10px;
          font-weight: 700;
        }

        .kitabe-btn {
          width: 100%;
          padding: 9px 12px;
          background: linear-gradient(135deg, #1B3B6F 0%, #102447 100%);
          color: #F7F1E3;
          border: 1.5px solid #D4AF37;
          border-radius: 6px;
          font-family: 'Cinzel', serif;
          font-size: 11.5px;
          font-weight: 800;
          letter-spacing: 0.06em;
          cursor: pointer;
          transition: all 0.2s ease;
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 6px;
          box-shadow: 0 4px 12px rgba(27, 59, 111, 0.25);
        }

        .kitabe-btn:hover {
          background: #14305E;
          box-shadow: 0 6px 16px rgba(27, 59, 111, 0.35);
          transform: translateY(-1px);
        }

        .kitabe-btn.chaos-btn {
          background: linear-gradient(135deg, #9E3B2B 0%, #D1492F 100%);
          border-color: #F7F1E3;
          color: #FFF;
          margin-top: 4px;
        }

        .kitabe-btn.chaos-btn:hover {
          background: #B53620;
          box-shadow: 0 6px 16px rgba(209, 73, 47, 0.45);
        }

        .kitabe-btn.chaos-btn.active {
          background: #234F32;
          border-color: #D4AF37;
        }

        /* 3. SAĞ ALT: TÜRK HARİTACILARINA İTHAF MÜHÜRÜ */
        .tribute-seal-btn {
          position: fixed;
          right: 20px;
          bottom: 20px;
          width: 58px;
          height: 58px;
          border-radius: 50%;
          background: radial-gradient(circle, #D4AF37 0%, #B89040 70%, #8C6A24 100%);
          border: 3px double #1B3B6F;
          box-shadow: 0 6px 20px rgba(43, 36, 30, 0.4), inset 0 0 10px rgba(255, 255, 255, 0.5);
          cursor: pointer;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          pointer-events: auto;
          transition: transform 0.25s ease, box-shadow 0.25s ease;
          z-index: 10001;
        }

        .tribute-seal-btn:hover {
          transform: scale(1.08) rotate(5deg);
          box-shadow: 0 10px 28px rgba(212, 175, 55, 0.6);
        }

        .seal-symbol {
          font-size: 20px;
          line-height: 1;
        }

        .seal-text {
          font-size: 8px;
          font-weight: 900;
          color: #2B241E;
          letter-spacing: 0.1em;
          margin-top: 2px;
        }

        /* 4. TÜRK HARİTACILARINA İTHAF MODALI */
        .tribute-modal-backdrop {
          position: fixed;
          inset: 0;
          background: rgba(43, 36, 30, 0.72);
          backdrop-filter: blur(8px);
          display: flex;
          align-items: center;
          justify-content: center;
          z-index: 20000;
          pointer-events: auto;
          animation: fadeIn 0.3s ease;
        }

        .tribute-modal-card {
          width: 90%;
          max-width: 620px;
          background: #F6EFE2;
          background-image: radial-gradient(#E8DCB9 1.5px, transparent 1.5px);
          background-size: 20px 20px;
          border: 4px double #D4AF37;
          border-radius: 12px;
          padding: 32px 36px;
          box-shadow: 0 24px 60px rgba(0, 0, 0, 0.5), inset 0 0 30px rgba(222, 203, 177, 0.6);
          position: relative;
          color: #2B241E;
        }

        .tribute-close-btn {
          position: absolute;
          top: 14px;
          right: 18px;
          background: transparent;
          border: none;
          font-size: 20px;
          font-weight: 800;
          color: #8C3B61;
          cursor: pointer;
        }

        .tribute-header-ornament {
          text-align: center;
          color: #D4AF37;
          font-size: 24px;
          margin-bottom: 6px;
        }

        .tribute-title {
          font-size: 21px;
          font-weight: 900;
          text-align: center;
          color: #1B3B6F;
          letter-spacing: 0.08em;
          margin-bottom: 4px;
        }

        .tribute-subtitle {
          font-size: 12px;
          text-align: center;
          color: #8C3B61;
          font-style: italic;
          margin-bottom: 20px;
          border-bottom: 1.5px solid #D4AF37;
          padding-bottom: 10px;
        }

        .tribute-body {
          font-size: 14px;
          line-height: 1.75;
          text-align: justify;
          color: #2B241E;
          background: rgba(255, 255, 255, 0.5);
          padding: 16px 20px;
          border-radius: 8px;
          border: 1px solid #DECBB1;
        }

        .tribute-footer {
          margin-top: 20px;
          display: flex;
          justify-content: space-between;
          align-items: center;
          font-size: 11px;
          color: #1B3B6F;
          font-weight: 700;
        }

        /* 5. 3L-CVRP 3D KARGO KASASI KESİTİ MODALI */
        .cargo-modal {
          position: fixed;
          right: 20px;
          top: 76px;
          width: 330px;
          background: #F6EFE2;
          border: 3px double #D4AF37;
          border-radius: 8px;
          padding: 14px 16px;
          box-shadow: 0 14px 40px rgba(43, 36, 30, 0.35);
          pointer-events: auto;
          color: #2B241E;
          animation: slideInRight 0.3s ease;
        }

        .cargo-head {
          display: flex;
          justify-content: space-between;
          align-items: center;
          border-bottom: 2px solid #D4AF37;
          padding-bottom: 8px;
          margin-bottom: 10px;
        }

        .cargo-title {
          font-size: 13.5px;
          font-weight: 800;
          color: #1B3B6F;
        }

        .cargo-close {
          background: none;
          border: none;
          font-size: 16px;
          cursor: pointer;
          color: #8C3B61;
        }

        .cargo-grid {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 8px;
          margin-bottom: 10px;
        }

        .cargo-stat {
          background: #FFF;
          padding: 6px 8px;
          border-radius: 4px;
          border: 1px solid #DECBB1;
        }

        .cargo-stat-lbl {
          font-size: 9.5px;
          color: #1B3B6F;
          font-weight: 700;
        }

        .cargo-stat-val {
          font-size: 13px;
          font-weight: 900;
          color: #D4AF37;
        }

        .package-list {
          max-height: 150px;
          overflow-y: auto;
          display: flex;
          flex-direction: column;
          gap: 4px;
          padding-right: 4px;
        }

        .pkg-item {
          display: flex;
          justify-content: space-between;
          font-size: 10.5px;
          padding: 4px 6px;
          background: rgba(255, 255, 255, 0.7);
          border-radius: 4px;
          border: 1px solid #DECBB1;
        }

        .pkg-item.lifo-next {
          background: #FFF3DE;
          border-color: #D4AF37;
          font-weight: 700;
        }

        @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
        @keyframes slideInRight { from { transform: translateX(50px); opacity: 0; } to { transform: translateX(0); opacity: 1; } }
      </style>

      <!-- ÜST ORTA: DUAL VIEW MODE SWITCHER -->
      <nav class="mode-switcher-deck" aria-label="Görünüm Modu Seçimi">
        <button id="btn-mode-matrakci" class="mode-tab-btn active" title="1537 Matrakçı Nasuh Minyatür & Prosedürel Türk Mimarisi İkizi">
          <span>📜</span>
          <span>Matrakçı Prosedürel İkiz (1537 x 2026)</span>
        </button>
        <button id="btn-mode-tactical" class="mode-tab-btn tactical-btn" title="2026 Taktiksel Lite-HD Cyberpunk İkiz">
          <span>🛰️</span>
          <span>Taktiksel Lite-HD İkiz</span>
        </button>
      </nav>

      <!-- SOL KİTÂBE PANELİ: "Defter-i Menzil ve Şebeke-i İdrak" -->
      <aside id="matrakci-left-kitabe" class="kitabe-panel">
        <header class="kitabe-header">
          <div class="kitabe-crown">❖ 1537 BEYÂN-I MENÂZİL ❖</div>
          <h2 class="kitabe-title">Defter-i Menzil & Şebeke</h2>
          <div class="kitabe-sub">Umdetü'l-Hisâb GNN x 3L-CVRP Lojistiği</div>
        </header>

        <div class="kitabe-content">
          <!-- İBB Tersine OD Akışı -->
          <div class="kitabe-section">
            <div class="section-label">
              <span>Dersaadet Menzil Akışı (PI-STGNN)</span>
              <span class="badge-green">Aktif</span>
            </div>
            <div class="section-value" id="lbl-od-flow">
              Eulerian ➔ Lagrangian: <strong>28.450 araç/saat</strong><br/>
              LWR Kütle Korunumu: <strong>0.0076 (Dengeli)</strong>
            </div>
          </div>

          <!-- Umdetü'l-Hisâb Şebeke Budaması -->
          <div class="kitabe-section">
            <div class="section-label">
              <span>Umdetü'l-Hisâb Şebeke Seyreltmesi</span>
              <span class="badge-gold">%98.4 (k=15)</span>
            </div>
            <div class="section-value">
              GNN Learned Pruning: <strong>P(e_ij ∈ T*) ≥ 0.85</strong>
            </div>
            <button id="btn-toggle-sebeke" class="kitabe-btn" style="margin-top: 8px;">
              <span>❖</span>
              <span id="txt-sebeke-btn">Şebeke Kafesini Gizle</span>
            </button>
          </div>

          <!-- 3L-CVRP & Stokastik Vakit -->
          <div class="kitabe-section">
            <div class="section-label">
              <span>3L-CVRP Hamule & Stokastik Vakit</span>
              <span class="badge-gold">SLA %96.4</span>
            </div>
            <div class="section-value">
              3D Hacimsel Doluluk: <strong>%91.4</strong><br/>
              Ağırlık Doluluk: <strong>%86.0 (LIFO Kısıtlı)</strong><br/>
              Zaman Pencereleri: <strong>Log-Normal(μ, σ²)</strong>
            </div>
          </div>

          <!-- Agentic Kaos Tetikleyici -->
          <button id="btn-matrakci-chaos" class="kitabe-btn chaos-btn">
            <span>🔥</span>
            <span id="txt-chaos-btn">Vaka-i Nâgehânî: Kaza Simüle Et</span>
          </button>
        </div>
      </aside>

      <!-- SAĞ ALT MÜHÜR BUTONU -->
      <button id="btn-tribute-seal" class="tribute-seal-btn" title="Türk Haritacılarına İthaf (Matrakçı Nasuh, Pîrî Reis, Kâtip Çelebi)">
        <span class="seal-symbol">📜</span>
        <span class="seal-text">İTHAF</span>
      </button>

      <!-- TÜRK HARİTACILARINA İTHAF MODALI -->
      <div id="tribute-modal" class="tribute-modal-backdrop" style="display: none;">
        <div class="tribute-modal-card">
          <button id="btn-close-tribute" class="tribute-close-btn">✕</button>
          <div class="tribute-header-ornament">❖ ❖ ❖</div>
          <h2 class="tribute-title">TÜRK HARİTACILARINA VE POLİMATLARINA İTHAF</h2>
          <div class="tribute-subtitle">1537 Beyân-ı Menâzil-i Sefer-i Irâkeyn'den 2026 Mekânsal Yapay Zekasına</div>
          
          <div class="tribute-body">
            "Bu yaşayan dijital ikiz; 1517'de <em>'Cemâlü'l-Küttâb'</em> ve 1533'te <em>'Umdetü'l-Hisâb'</em> ile şebeke/matris matematiğini kuran, 
            1537'de <em>'Beyân-ı Menâzil-i Sefer-i Irâkeyn'</em> ile tarihin ilk topografik lojistik ve menzil atlasını resmeden büyük Türk polimatı 
            <strong>Matrakçı Nasuh</strong>'un (1480–1564) zihin dünyasından ilhamla kodlanmıştır. 
            Pîrî Reis'ten Ali Macar Reis'e, Kâtip Çelebi'den modern mekânsal yapay zeka mühendislerine uzanan Türk haritacılık geleneğine saygıyla."
          </div>

          <div class="tribute-footer">
            <span>📜 Matrakçı-Twin Engine v1.0</span>
            <span>📍 Dersaadet · 1537 x 2026</span>
          </div>
        </div>
      </div>

      <!-- 3B KARGO KASASI KESİTİ MODALI -->
      <div id="cargo-modal" class="cargo-modal" style="display: none;">
        <div class="cargo-head">
          <span class="cargo-title" id="cargo-veh-title">📦 VRP Kurye #1 Hamule Kesiti</span>
          <button id="btn-close-cargo" class="cargo-close">✕</button>
        </div>
        <div class="cargo-grid">
          <div class="cargo-stat">
            <div class="cargo-stat-lbl">HACİM DOLULUK</div>
            <div class="cargo-stat-val" id="cargo-vol">%91.4</div>
          </div>
          <div class="cargo-stat">
            <div class="cargo-stat-lbl">AĞIRLIK DOLULUK</div>
            <div class="cargo-stat-val" id="cargo-wt">%86.0</div>
          </div>
        </div>
        <div class="section-label">
          <span>3L-CVRP LIFO Yükleme Sırası</span>
          <span class="badge-green">Kurala Uygun</span>
        </div>
        <div class="package-list" id="cargo-pkg-list"></div>
      </div>
    `;

    document.body.appendChild(this.container);
  }

  bindEvents() {
    // 1. Mod Geçiş Butonları
    const btnMatrakci = document.getElementById('btn-mode-matrakci');
    const btnTactical = document.getElementById('btn-mode-tactical');

    if (btnMatrakci) {
      btnMatrakci.addEventListener('click', () => {
        twinStore.setViewMode('matrakci');
      });
    }

    if (btnTactical) {
      btnTactical.addEventListener('click', () => {
        twinStore.setViewMode('tactical');
      });
    }

    // 2. Umdetü'l-Hisâb Şebeke Kafesi Toggle
    const btnToggleSebeke = document.getElementById('btn-toggle-sebeke');
    if (btnToggleSebeke) {
      btnToggleSebeke.addEventListener('click', () => {
        twinStore.toggleSebekeGrid();
      });
    }

    // 3. Kaos Tetikleyici: Vaka-i Nâgehânî
    const btnChaos = document.getElementById('btn-matrakci-chaos');
    if (btnChaos) {
      btnChaos.addEventListener('click', () => {
        twinStore.triggerChaosScenario();
      });
    }

    // 4. İthaf Modalı Butonları
    const btnSeal = document.getElementById('btn-tribute-seal');
    const btnCloseTribute = document.getElementById('btn-close-tribute');
    const modalBackdrop = document.getElementById('tribute-modal');

    if (btnSeal) {
      btnSeal.addEventListener('click', () => {
        twinStore.setTributeModalOpen(true);
      });
    }

    if (btnCloseTribute) {
      btnCloseTribute.addEventListener('click', () => {
        twinStore.setTributeModalOpen(false);
      });
    }

    if (modalBackdrop) {
      modalBackdrop.addEventListener('click', (e) => {
        if (e.target === modalBackdrop) {
          twinStore.setTributeModalOpen(false);
        }
      });
    }

    // 5. Kargo Modalını Kapat
    const btnCloseCargo = document.getElementById('btn-close-cargo');
    if (btnCloseCargo) {
      btnCloseCargo.addEventListener('click', () => {
        twinStore.selectVehicle(null);
      });
    }
  }

  renderState(state) {
    const isMatrakci = state.viewMode === 'matrakci';

    // Üst buton aktiflikleri ve switcher tema modu
    const btnMatrakci = document.getElementById('btn-mode-matrakci');
    const btnTactical = document.getElementById('btn-mode-tactical');
    const switcherDeck = document.querySelector('.mode-switcher-deck');
    if (btnMatrakci) btnMatrakci.classList.toggle('active', isMatrakci);
    if (btnTactical) btnTactical.classList.toggle('active', !isMatrakci);
    if (switcherDeck) switcherDeck.classList.toggle('tactical-mode-deck', !isMatrakci);

    // Sol Kitâbe Panelinin gösterilip gizlenmesi
    const kitabe = document.getElementById('matrakci-left-kitabe');
    if (kitabe) {
      kitabe.classList.toggle('hidden-view', !isMatrakci);
    }

    // Şebeke butonu metni
    const txtSebeke = document.getElementById('txt-sebeke-btn');
    if (txtSebeke) {
      txtSebeke.textContent = state.showSebekeGrid ? 'Şebeke Kafesini Gizle' : 'Şebeke Kafesini Göster';
    }

    // Kaos butonu durumu
    const btnChaos = document.getElementById('btn-matrakci-chaos');
    const txtChaos = document.getElementById('txt-chaos-btn');
    if (btnChaos && txtChaos) {
      btnChaos.classList.toggle('active', state.chaosScenarioActive);
      txtChaos.textContent = state.chaosScenarioActive
        ? '✅ Yolu Aç / Normale Dön'
        : '🔥 Vaka-i Nâgehânî: Kaza Simüle Et';
    }

    // İthaf modalı görünürlüğü
    const tributeModal = document.getElementById('tribute-modal');
    if (tributeModal) {
      tributeModal.style.display = state.tributeModalOpen ? 'flex' : 'none';
    }

    // Seçili VRP Kargo Kesiti Modalı
    const cargoModal = document.getElementById('cargo-modal');
    if (cargoModal) {
      if (state.selectedVehicleId && isMatrakci) {
        const veh = state.vehicles.find((v) => v.id === state.selectedVehicleId);
        if (veh && veh.cargo3D) {
          cargoModal.style.display = 'block';
          const titleEl = document.getElementById('cargo-veh-title');
          const volEl = document.getElementById('cargo-vol');
          const wtEl = document.getElementById('cargo-wt');
          const listEl = document.getElementById('cargo-pkg-list');

          if (titleEl) titleEl.textContent = `📦 ${veh.id.toUpperCase()} Hamule Kesiti`;
          if (volEl) volEl.textContent = `%${veh.cargo3D.volumeFillPct.toFixed(1)}`;
          if (wtEl) wtEl.textContent = `%${veh.cargo3D.weightFillPct.toFixed(1)}`;

          if (listEl) {
            listEl.innerHTML = '';
            veh.cargo3D.packages.forEach((pkg, idx) => {
              const item = document.createElement('div');
              item.className = `pkg-item ${idx === 0 ? 'lifo-next' : ''}`;
              item.innerHTML = `
                <span><strong>#${pkg.seqOrder}</strong> ${pkg.id}</span>
                <span>${pkg.dims.join('x')} m (${idx === 0 ? 'İlk Teslim' : 'Sırada'})</span>
              `;
              listEl.appendChild(item);
            });
          }
        } else {
          cargoModal.style.display = 'none';
        }
      } else {
        cargoModal.style.display = 'none';
      }
    }

    // Taktiksel görünümle senkronizasyon:
    // Taktiksel görünümdeyken #geotwin-deck'i göster, Matrakçı'dayken gizle
    const tacticalDeck = document.getElementById('geotwin-deck');
    if (tacticalDeck) {
      tacticalDeck.style.display = isMatrakci ? 'none' : '';
    }
  }

  dispose() {
    if (this.unsubscribe) this.unsubscribe();
    if (this.container && this.container.parentNode) {
      this.container.parentNode.removeChild(this.container);
    }
  }
}
