# Geo-Twin: Açık Veri, Tersine Mühendislik OD Tahmini, Çok Modlu Toplu Taşıma ve Ajan Tabanlı (Agentic) Kentsel Mobilite Dijital İkiz Mimarisi

Kentsel lojistik ve filo rotalama (VRP) sistemlerini şehirdeki genel trafik akışından, toplu taşıma dinamiklerinden ve anlık kaos/kaza senaryolarından bağımsız düşünmek, gerçek dünya operasyonlarında planlanan rotaların çökmesine neden olmaktadır.

Bu rapor; **OpenStreetMap (OSM)** şerit topolojisini, **canlı İBB Açık Veri** sensör akışlarını ve **GTFS toplu taşıma** verilerini birleştirerek **tersine mühendislikle (Reverse Engineering) Başlangıç-Varış (OD) matrislerini** tahmin eden, **SUMO** üzerinde mikroskobik düzeyde koşturan, bir kaza veya kaos anında **Agentic AI (Çoklu Ajan)** mimarisiyle "What-If" senaryolarını gerçek zamandan hızlı simüle eden ve **VRP modülünü** bu yaşayan ekosistemin içinde dinamik olarak optimize eden uçtan uca bir **Mobilite Dijital İkiz** mimarisini sunmaktadır.

---

## 1. Bütüncül Sistem Mimarisi (Uçtan Uca Veri ve Karar Akışı)

Sistem; ham açık verilerin alımından şerit bazlı mikro-simülasyona, derin öğrenme tabanlı tersine mühendislikten otonom kriz ajanlarına kadar 5 entegre katmandan oluşur:

```
[1. AÇIK VERİ & TOPOLOJİ KATMANI]
 ├─ OSM (.osm.pbf) + Copernicus DEM ──► netconvert ──► Lite HD Şerit Grafı (.net.xml)
 ├─ İBB Açık Veri (Canlı Hız/Yoğunluk Sensörleri, Kavşak Kameraları, Kaza/Bakım API)
 └─ İBB GTFS (İETT, Metrobüs, Metro, Deniz Hatları Tarifeleri & Durak Koordinatları)
        │
        ▼
[2. TERSİNE MÜHENDİSLİK (INVERSE OD & MİKRO-AKIŞ MOTORU)]
 ├─ Bilevel PI-STGNN (Sensör Hız/Akım Verisinden Dinamik OD Matrisi D_od(t) Çıkarımı)
 └─ SUMO routeSampler & dfrouter (Makroskobik Akımların Tekil Araç Yörüngelerine Dönüşümü)
        │
        ▼
[3. ÇOK MODLU MİKROSKOBİK SİMÜLASYON ÇEKİRDEĞİ (SUMO / libsumo)]
 ├─ Sivil Araçlar (IDM Takip + LC2013 Şerit Değiştirme)
 ├─ Toplu Taşıma (Otobüs Şeritleri, Duraklama/Dwell Sürtünmesi, Yolcu Transferleri)
 └─ Canlı Durum Senkronizasyonu (Digital Twin State Estimator - Kalman / GNN)
        │
        ├──────────────────────────────────────────────────────┐
        ▼                                                      ▼
[4. AGENTIC KAOS & KRİZ ORKESTRATÖRÜ]                 [5. YAŞAYAN VRP & FİLO MODÜLÜ]
 ├─ Anomaly Agent: Şok dalgası ve kaza tespiti         ├─ CADO Difüzyon + SE(2) GNN Budama
 ├─ Shadow Sim Agent: Paralel "What-If" (10x Hız)      ├─ Log-Normal(μ, σ²) Şans Kısıtları
 └─ Control Agent: Sinyalizasyon, Toplu Taşıma         └─ Dynamic Guided-LNS: Kaza anında
    ek sefer ve GFlowNet trafik dağıtımı                  etkilenen kurye/kamyonların anlık onarımı
```

---

## 2. Tersine Mühendislik: Canlı İBB Verisinden Dinamik OD Matrisi ve Mikro-Akış Çıkarımı

**Temel Problem:** İBB Açık Veri Portalı'ndan veya trafik API'lerinden alınan veriler **Eulerian (noktasal/kesitsel)** niteliktedir; yani belirli yol segmentlerindeki ortalama hızı ($v_e^t$) veya geçen araç sayısını ($q_e^t$) verir. Oysa SUMO gibi mikroskobik bir simülatörün çalışması için **Lagrangian (yörüngesel)** veriye, yani hangi mahalleden/bölgeden (Origin $i$) hangi bölgeye (Destination $j$) saat kaçta kaç aracın gittiğini gösteren **Dinamik OD Matrisine ($\mathbf{D}_t \in \mathbb{R}^{|\mathcal{Z}| \times |\mathcal{Z}|}$)** ihtiyacı vardır.

### A. İki Seviyeli (Bi-Level) Tersine Mühendislik Formülasyonu

Noktasal sensör gözlemlerinden tüm şehrin şerit düzeyindeki trafik akışını yeniden inşa etmek, tersine bir problem (ill-posed inverse problem) olarak kurgulanır:

1. **Bölgeleme (Spatial Tesselation):** İstanbul haritası H3 altıgen hücrelerine (ör. Çözünürlük 7-8) veya mahalle bazlı Trafik Analiz Bölgelerine (TAZ) bölünür.
2. **Üst Seviye (GNN Inverse OD Estimator):** Gözlemlenen İBB sensör akımları ($q_e^{\text{İBB}}$) ve hızları ($v_e^{\text{İBB}}$) bir Graf Sinir Ağı'na verilerek bölgeler arası gizli talep matrisi $\hat{\mathbf{D}}_t$ tahmin edilir.
3. **Alt Seviye (Fizik Bilgili Atama & LWR Korunumu):** Tahmin edilen $\hat{\mathbf{D}}_t$ matrisi, rota seçim olasılıkları (Atama Matrisi $\mathbf{P}$) üzerinden şerit akımlarına ($\hat{q}_e$) izdüşürülür. Lighthill-Whitham-Richards (LWR) kütle korunum denklemi ve sensör hatası birlikte minimize edilir:

$$\min_{\mathbf{D}_t} \sum_{e \in \mathcal{E}_{\text{sensör}}} \left\| q_e^{\text{İBB}}(t) - \sum_{r \in \mathcal{R}} P_{e,r}(t) \cdot \mathbf{D}_{o(r), d(r)}(t) \right\|^2 + \lambda_{\text{fizik}} \mathcal{L}_{\text{LWR}}(\hat{\rho}, \hat{v}) + \lambda_{\text{ent}} H(\mathbf{D}_t)$$

Burada $\mathcal{L}_{\text{LWR}}$, sensör bulunmayan ara sokaklarda dahi giren ve çıkan araç sayısının fiziksel olarak dengede kalmasını zorunlu kılar.

---

## 3. Çok Modlu Toplu Taşıma (GTFS) ve Mikro-Trafik Etkileşimi

İstanbul gibi bir metropolde sivil trafik ve lojistik filoları toplu taşımadan izole edilemez:
1. **Otomatik Hat Eşleme (`gtfs2pt.py`):** İBB Açık Veri GTFS paketleri (`stops.txt`, `routes.txt`, `stop_times.txt`, `shapes.txt`) şerit grafına entegre edilir.
2. **Stokastik Dwell Modeli:** $T_{\text{dwell}} = t_{\text{kapı}} + \alpha_{\text{biniş}} N_{\text{biniş}} + \beta_{\text{iniş}} N_{\text{iniş}}$.
3. **Metrobüs ve Ayrılmış Şeritler:** Fiziksel koridorlar (`allow="bus"`) sivil şeritlerden izole edilir; durak cepleri olmayan arterlerdeki sürtünmeler mikro-şok dalgası üretir.

---

## 4. Kaos ve Kaza Anı İçin Agentic AI Mimarisi (Otonom Kriz Orkestrasyonu)

| Ajan Adı | Görevi ve Algılama Mekanizması | Kullandığı Araçlar (Tools) |
| --- | --- | --- |
| **1. Anomaly & Chaos Detector Agent** | Sensörlerdeki ani hız düşüşlerini ve PI-GNN kütle korunum hatasını izleyerek kazanın şeridini tespit eder. | `ibb_live_stream_tool`, `pignn_shockwave_detector` |
| **2. Shadow Simulation ("What-If") Agent** | Mevcut durumu snapshot alır (`saveState`) ve 10x hızda 3 farklı kriz politikasını 30 dk ileri koşturur. | `sumo_fork_state`, `inject_lane_closure`, `run_fast_rollout` |
| **3. Mobility & Transit Control Agent** | Yeşil dalga sinyalizasyonunu ayarlar, ek İETT yönlendirir ve GFlowNet ile trafiği tahliye eder. | `set_tls_phase_tool`, `reroute_gtfs_bus`, `gflownet_traffic_split` |
| **4. Dynamic VRP Dispatch Agent** | SLA riski oluşan kuryeleri tespit edip Guided-LNS kısmi rota onarımını tetikler. | `check_chance_constraints`, `trigger_partial_lns` |

---

## 5. Mobilite İkizi İçinde Yaşayan VRP Modülü

Filo optimizasyonu şehir trafiğiyle aynı grafı ($\mathcal{G} = (\mathcal{V}_{\text{lane}}, \mathcal{E}_{\text{turn}})$) paylaşır:
* **Fenton-Wilkinson Şans Kısıtı:**
  $$\sum_{e \in \mathcal{P}_k} \mu_e(t) + \Phi^{-1}(1 - \alpha) \sqrt{\sum_{e \in \mathcal{P}_k} \sigma_e^2(t) + 2 \sum_{e < e'} \text{Cov}(T_e, T_{e'})} \le L_k$$
* Kaza anında kural ihlali oluştuğunda **Learned Destroy & Repair** ile sadece etkilenen segmentler 100 ms içinde onarılır.

---

## 6. Mevcut Procedural WebGL İkizi ile Entegrasyon Köprüsü

Mevcut **Procedural Three.js İstanbul İkizi**, bu Geo-Twin mimarisinin **gerçek zamanlı 3B WebGL Operasyonel Görselleştirme ve Dijital İkiz Komuta Merkezi (Frontend)** rolünü üstlenir:
1. **Şerit ve Viyadük Geometrisi:** Hazırlanan 3B viyadük, rampa ve şerit gabarileri SUMO Lite-HD ağının 3B görsel karşılığıdır.
2. **Kriz Simülatörü Paneli:** Web arayüzündeki olay tetikleyiciler (Köprü Kazası, Metrobüs Arızası), arka plandaki `ShadowSimulationAgent` için kullanıcı tetikleme arayüzüdür.
3. **Canlı İBB Akışı:** `src/main.js` içindeki sensör eşleme motoru Eulerian akışların istemci tarafında görsel yansımasını yönetir.
