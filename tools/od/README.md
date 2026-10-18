# Ters O-D tahmini

Canlı İBB hızlarından koridorun saatlik araç O-D matrisini tahmin eder. Yöntemin ayrıntıları `odme.py` başındaki açıklamada. Kısaca: hızlar sansürlü gözlem (alt/üst sınır) olarak girer, prior göreli belirsizlikle düzenlileştirilir, rota seçimi bilevel döngüyle güncellenir ve her O-D çifti için standart hata ile veri payı raporlanır.

```bash
npm run test:od                                   # sentetik şehirde 25 kontrol
npm run od:corridor -- --area=koridor             # canlı hızlarla gerçek koridor tahmini
npm run od:corridor -- --area=koridor --speeds data/archive/ibb/segment_speeds/date=…/HHMMSS.parquet --counts sayimlar.csv
```

`--counts` dosyasının sütunları `edge_id,value,sd,source`, değerler araç/sa cinsinden. Önce `npm run sumo:net` ve `npm run sumo:map-ibb` çalıştırılmış olmalı.

## Hat

| Adım | Ne yapılıyor |
|---|---|
| Zonlar | 75 H3 hücresi (çözünürlük 8, yaklaşık 0.74 km²) ve sınırı kesen ana yollardan 20 geçit zonu. Geçitler, köprü gibi transit trafiğin de bir başlangıcı ve varışı olmasını sağlar |
| Ağ | 21 bin SUMO kenarı BPR linki olarak kullanılır. Şerit kapasitesi yol tipine göre belirlenir; link sinyalle bitiyorsa yeşil payıyla (0.45) çarpılır |
| Prior | OSM bina taban alanı × kat sayısı (konut / konut dışı) ve POI'lerden üretim ve çekim; geçitler için kapasitenin bir payı; çift kısıtlı çekim modeli. Akşam saatlerinde yön çevrilir |
| Gözlem | Her İBB segmentinin hızı en iyi eşleşen kenara düşer. İBB'nin kendi sıkışıklık sınıfına göre: 1–2 ise akım ≤ kapasite (üst sınır), 3–5 ise akım ≥ temel diyagramın sıkışık dalındaki akım (alt sınır) |
| Tahmin | Bilevel (UE ataması ve tahmin, MSA ile sönümlü), log-uzayda L-BFGS, Woodbury ile standart hatalar |
| Çıktı | `data/od/<alan>/<zaman>/`: `od.csv`, `zones.geojson`, `link_flows.csv`, `summary.json`, ayrıca SUMO için `taz.xml` + `od.xml` (`od2trips --taz-files taz.xml --tazrelation-files od.xml`) |

## İlk tahmin: 17 Ekim 2026, 17:12, akşam zirvesi

| | |
|---|---|
| Gözlem | 907 segment ağda. 189'u yerel sokakta olduğu için dışarıda bırakıldı. Kalanlar 448 alt sınır (sıkışık) ve 246 üst sınır (akıcı) |
| Toplam talep | Prior 101.9 bin, tahmin 126.8 bin araç/sa (+%24; alt sınırlar talebi yukarı itiyor) |
| Sınır ihlali (2 sd'den fazla) | Prior 243, tahmin 177 (toplam 694). İhlallerin 67'si hiçbir rotanın kullanmadığı linklerde, yani statik modelle açıklanamıyor |
| Veri payı | Yolculuk ağırlıklı ortalama %15.7. 19 O-D çiftinde %50'nin üstünde |
| 15 Temmuz Köprüsü | Avrupa→Asya yönünde 7.6 bin, Asya→Avrupa yönünde 6.3 bin araç/sa |
| En büyük çiftler | Cumhuriyet Caddesi → köprü (2.9 bin, veri payı 0.84); O-2 batı (TEM) → O-2 doğu (FSM yönü) (2.7 bin, 0.89) |
| od2trips | 126.490 yolculuk üretildi |

## Sınırlar

Bu tahmin bir başlangıç noktasıdır ve aşağıdaki sınırlar sonuçlarla birlikte okunmalıdır.

- **Talep düzeyi belirlenemiyor.** Hiç sayım verilmediği için toplam, prior ve hız sınırlarının izin verdiği yerde kalıyor. Talep düzeyini sabitlemek için en az bir gerçek sayım gerekir (KGM köprü geçişleri, `--counts`). Bunu `summary.json` → `level_of_demand` açıkça yazar.
- **Hold-out GEH yok.** Sayım olmadan çapraz doğrulama yapılamaz. Doğrulama, sayımlar eklendiğinde `cross_validate` ile yapılacak.
- **Köprü akımları kontrol edilmedi.** Mertebe makul, ancak KGM saatlik sayımlarıyla karşılaştırılmadı.
- **Statik atamanın sınırı.** Dönüş yasakları ve kuyruk yayılımı yok. Bunları SUMO rotalama ve simülasyonu ele alacak.
- **Bilevel döngü tam yakınsamadı.** 8 turdan sonra O-D değişimi hâlâ %1. `--rounds` artırılabilir.
- **Prior varsayımları elle seçildi.** Kat sayısı, hane başına yolculuk, geçit kullanım payları, yeşil payı gibi değerlerin hepsi `summary.json` → `assumptions` alanında listelenir.
- **Sıkışıklık sınıfı yorumu bir varsayım.** İBB sınıfı 3–5'i "kuyruk var" olarak okumak, İBB'nin sınıf tanımıyla doğrulanmalı.

## Sayımlarla ilk doğrulama: 17 Ekim 2026, Cumartesi, 17:00–18:00

```bash
uv run --group sumo python tools/od/counts.py --area=koridor --month=2024-10 --weekday=5 --hour=17
uv run --group sumo python tools/od/corridor.py --area=koridor --speeds data/od/koridor/20261017-1726/speeds.csv \
  --counts data/od/koridor/counts_202410_d5_h17.csv --tag counts
```

**Veri:** İBB "Günlük Araç Sayımı" (2024), koridordaki 27 sensörden 23'ü. Her sensörde yola dik bir sayım kesiti, iki yönün tüm şeritleri. Günlük toplam, aynı gün ve aynı geohash hücresindeki prob araç sayısının saatlik payıyla saatliğe çevrildi ("Saatlik Trafik Yoğunluk", Ekim 2024). Sensör başına değer, Ekim 2024 Cumartesilerinin medyanı. Saatin günlük trafikteki payı %3.6–5.1 aralığında. Köprü (Avrupa girişi) iki yön toplam 8.494 araç/sa.

**Sonuç: ölçüt karşılanmıyor.**

| GEH < 5 oranı | Prior | Uyum | Dışarıda bırakılan (her sayım tek tek) |
|---|---|---|---|
| Sayımlar ve tüm hız sınırları (hattın şu anki hali) | %4.3 | %13.0 | %13.0 |
| Aynı rotalarla, yalnızca sayımlar | | %22.7 | %18.2 |
| Aynı rotalarla, sayımlar ve üst sınırlar | | %22.7 | %18.2 |
| Aynı rotalarla, sayımlar ve tüm hız sınırları | | %4.5 | %0 |

**Bulgular:**

1. **Sinyalli arterlerde hız alt sınırları yanlış.** Talebi şişiriyor (88 bin → 117 bin) ve uyumu bozuyor. Üç sensörde alt sınırlar sayımın iki katını aşıyor. Sansürlü gözlem kuralı temel diyagrama dayanır ve bu yalnızca kesintisiz akışta geçerlidir. Sinyalli yolda düşük hız kırmızı ışık beklemesinden de gelir. Kural yalnızca otoyol ve trunk yollara uygulanmalı.
2. **Yalnızca sayımlarla bile uyum düşük.** Sayımlar mevcut rota yapısıyla birbiriyle çelişiyor. Örnekler: FSM Avrupa Girişi 10.613 ile FSM Gişeler 3.759 aynı kenarlara eşlenmiş (gişe sensörü muhtemelen tek yön ölçüyor); Mecidiyeköy sensörü rotaların geçmediği kenara düşmüş (prior 89); Üsküdar Sahil Yolu'nun modelde rotası yok.

**Düzeltme sırası:**

1. Hız alt sınırlarını kesintisiz akış yollarıyla sınırlamak.
2. Sensör eşlemelerini tek tek denetlemek: yön, gişe ve rampa sensörleri, aynı kenara düşen sensörler (`counts_*.json`).
3. Atama ağına İBB 2020 modelinin kalibre kapasite ve BPR α/β değerlerini aktarmak; zon bağlantılarını gözden geçirmek.
4. İBB'nin 540 zonlu O-D matrisini prior olarak kullanmak.

### Düzeltmelerden sonra (18 Ekim 2026)

Yapılan düzeltmeler: sensör eşlemesi denetlendi (25/27 sensör), hız alt sınırları yalnızca kesintisiz akış yollarında kullanılıyor, prior'a zon bazında üretim/çekim çarpanları eklendi.

| GEH < 5 (ortalama GEH) | Prior | Uyum | Dışarıda bırakılan |
|---|---|---|---|
| İlk tur | %4.3 (37.6) | %13.0 (27.3) | %13.0 (35.6) |
| Eşleme ve kesintisiz akış kuralı | %8.3 (32.1) | %8.3 (16.5) | %8.3 (23.8) |
| Ek olarak zon çarpanları | %8.3 (32.1) | %20.8 (13.1) | %4.2 (23.4) |

Ortalama hatalar belirgin biçimde düştü, ancak ölçüt (%85) hâlâ çok uzakta. Kalan hatanın iki ana kaynağı var:

1. **Sayım tanımları birbiriyle çelişiyor.** Üç O-2 sensörü (TEM Harp Akademileri 8.171, TEM Levent 7.108, TEM Karanfilköy 4.291 araç/sa) modelde aynı akıma oturuyor (6.348). Aralarında rampa yoksa bu kadar farklı olamazlar. Karanfilköy muhtemelen tek yön sayıyor ya da ağda bu kesimin rampaları eksik. Sensörlerin yön ve şerit kapsamı İBB'den teyit edilmeli.
2. **Geçitler ve ağ yapısı.** FSM Avrupa Girişi'nde model sayımın yarısını taşıyabiliyor (10.613'e karşı 5.249). Geçit prior'ı kapasiteye dayalı kaba bir varsayım.

**Sıradaki adımlar:** İBB 2020 modelinin kalibre kapasite, BPR katsayıları ve 540 zonlu O-D'si (geçitler dahil) ile sensörlerin yön ve şerit tanımlarının teyidi.

### İBB 2020 modelinin kapasite ve BPR değerleriyle (18 Ekim 2026)

`tools/sumo/map_ibb_model.py`, İBB linklerini yön kontrolüyle SUMO kenarlarına eşliyor. İBB bölünmüş yolların her taşıt yolunu ayrı tek yönlü link olarak çiziyor; bu yüzden en yakın link çoğu zaman karşı yön oluyor ve eşleme yönü dikkate alıyor. Eşleşme oranları: otoyol %92, trunk %80, ana ve tali arter %77–78, konut sokağı %10 (İBB modelinde yerel sokak yok).

Eşleşen kenarlarda İBB'nin kapasitesi, serbest akış hızı ve BPR katsayıları kullanılıyor. Eşleşmeyenler İBB'nin sınıf bazlı BPR değerini alıyor: otoyol/trunk α = 0.158 / β = 3.483, diğer yollar α = 0.924 / β = 3.464.

| | Uyum (ortalama GEH, GEH < 5) | Dışarıda bırakılan |
|---|---|---|
| Zon çarpanları | 13.1, %20.8 | 23.4, %4.2 |
| Ek olarak İBB kapasite ve BPR | 12.2, %20.8 | 24.0, %0 |

**Sonuç:** Link parametreleri darboğaz değil. Dışarıda bırakılan hata, prior'ın yapısından ve sensör tanımlarındaki çelişkiden kaynaklanıyor. Sıradaki adım 2012 hanehalkı anketinden gözleme dayalı bir otomobil O-D prior'ı kurmak.

### 2012 hanehalkı anketi ile prior (18 Ekim 2026)

`tools/od/survey_prior.py` şu adımları izliyor:

1. 17:00'de başlayan otomobil ve taksi yolculuklarını, kişi ağırlığı ve otomobildeki kişi sayısıyla araç yolculuğuna çevirir.
2. Mahalleleri muhtarlık konumlarıyla eşler (963 nokta).
3. Her yolculuğu İBB 2020 ağında, yön kurallarına uyarak en kısa yoldan geçirip koridora giriş ve çıkış noktasını bulur.

Şehir genelinde 735 yolculuk kaydı var; 532'si konumlandırılabildi, ancak koridora değen yalnızca 77. Genişletilmiş toplam 24.618 araç/sa. Bu örneklem hücre bazında bir matris için çok küçük, bu yüzden yalnızca yolculuk tipi paylarını kullanıyoruz:

| Tip | Pay |
|---|---|
| İç–iç | %15 |
| İçeriden dışarı | %39 |
| Dışarıdan içeri | %20 |
| Transit | %26 |

Çekim modeli prior'ının dört bloğu bu paylara ölçekleniyor (`--survey`).

| | Uyum (ortalama GEH, GEH < 5) | Dışarıda bırakılan |
|---|---|---|
| İBB kapasite ve BPR | 12.2, %20.8 | 24.0, %0 |
| Ek olarak anket payları | 11.8, %25.0 | 23.2, %4.2 |

Küçük bir iyileşme var, ancak dışarıda bırakılan hatanın baskın kaynağı hâlâ sensör tanımlarındaki çelişki (O-2 sensörleri, FSM).
