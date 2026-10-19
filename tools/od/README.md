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

- **Talep düzeyi.** Tüm matrisin düzeyi ayrı bir küresel çarpanla (log-normal, sd 0.5) taşınır. `summary.json` → `level_of_demand` bu çarpanı, %95 aralığını ve **veri payını** (profil eğriliği ile prior genişliğinin oranı) yazar. Veri payı 0.8'in altındaysa düzey sabitlenmiş sayılmaz. Sentetik testte tek bir köprü benzeri kesit sayımı, zon çarpanları yokken düzeyin %94'ünü belirliyor; zon çarpanları serbestken (koridor ayarı) yalnızca %53'ünü, çünkü sayım, kestiği zonların büyütülmesiyle de karşılanabiliyor. Düzeyi gerçekten sabitlemek için birbirinden bağımsız zonları kesen birden çok sayım gerekir (köprü iki yön ayrı, O-1 ve O-2 kesitleri).
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

### Talep düzeyi sayımlarla sabitlendi (19 Ekim 2026)

```bash
uv run --group sumo python tools/od/counts.py --area=koridor --month=2024-10 --weekday=0 --hour=11
uv run --group sumo python tools/od/corridor.py --area=koridor --counts data/od/koridor/counts_202410_d0_h11.csv --tag counts-level
```

Pazartesi 11:30 canlı İBB hızları, Ekim 2024 Pazartesi 11:00–12:00 sayımları (23 sensör, biri rotası olmadığı için ayrıldı). Tüm matrisin düzeyi ayrı bir küresel çarpanla tahmin edildi (`level_of_demand`).

| | |
|---|---|
| Düzey çarpanı | 0.30 (%95: 0.19–0.46); prior sd 0.5 |
| Düzeyin veri payı | 0.81: sayımlarla sabitlendi (eşik 0.8) |
| Toplam talep | Prior 117.9 bin, tahmin 61.6 bin araç/sa |
| GEH < 5 (ortalama) | Prior %4.3 (37.8), uyum %17.4 (12.2), dışarıda bırakılan %8.7 (22.9) |

Arazi kullanımı prior'ı talebi yaklaşık üç kat yüksek gösteriyor; daha önce SUMO'da görülen kilitlenmenin kaynağı bu. Düzey artık veriden geliyor, ancak dışarıda bırakılan GEH, talebin zonlar arasındaki dağılımının hâlâ zayıf olduğunu gösteriyor. Saatler farklı olduğu için bu sonuç Cumartesi 17:00 turlarıyla doğrudan karşılaştırılmamalı.

### Çok kaynaklı çapalar: İstanbulkart (19 Ekim 2026)

```bash
uv run python tools/od/anchors.py --area=koridor --month=2024-10 --hour=11
uv run --group sumo python tools/od/corridor.py --area=koridor --speeds data/od/koridor/20261019-1130-counts-level/speeds.csv \
  --counts data/od/koridor/counts_202410_d0_h11.csv --anchors data/od/koridor/anchors_202410_h11.csv --tag anchors
```

Çapa, bağlantı akımı yerine doğrudan matristeki bir O-D toplamını kısıtlar (`odme` gözlem türü `od_sum`; sentetik testte karşılanıyor ve adı geçmeyen çiftler prior'da kalıyor). İBB "Saatlik Toplu Ulaşım" verisinde koridordaki 31 raylı sistem ve metrobüs durağında, hafta içi 11:00–12:00 saatinde 11.764 biniş var (eksiksiz 5 günün medyanı). Bunun koridor zonlarının ürettiği otomobil yolculuğuna oranı bir varsayım (1.0, log-sd 0.7) olduğu için çapa bilerek zayıf tutuldu. Otobüs satırları dışarıda bırakıldı, çünkü otobüslerde `town` alanı biniş yerini değil hattın ilçesini gösteriyor.

| | Yalnızca sayımlar | Sayımlar ve İstanbulkart |
|---|---|---|
| Koridor zonlarının ürettiği yolculuk | 15.6 bin (prior 57.4 bin) | 15.6 bin (çapa 11.8 ± 11.9 bin) |
| Düzeyin veri payı | 0.807 | 0.815 |
| Dışarıda bırakılan GEH (ortalama) | 22.86 | 22.71 |

Sayımlardan bağımsız bir kaynak, sayımların koridor içi talep için söylediğini doğruluyor. Oran hanehalkı anketinin zon bazındaki mod payından alınırsa çapa güçlenir. Köprünün yön bazlı sayımı (KGM) `--bridge-eu-as` ve `--bridge-as-eu` ile aynı yoldan girer; bu veri henüz elimizde yok.

### Simülasyondan gerçeğe ters çözücü: ilk deneme (19 Ekim 2026)

```bash
uv run --group sumo --group ml python tools/od/neural_inverse.py --area=koridor --samples 300
```

Koridorun atama ağında 300 örnek üretildi. Her örnekte talep düzeyi ×0.15 ile ×1.5 arasında, zon çarpanları ve çift gürültüsü rastgele seçildi ve İBB'nin gözlediği 712 linkteki hız oranları okundu. Örnek başına süre 8.7 sn. Ağ, toplam talebin ve zon üretim/çekimlerinin logaritmasını tahmin eden bir MLP (256-128).

| | |
|---|---|
| Dışarıda bırakılan örneklerde R² | Toplam 0.15, üretimler −0.41, çekimler −0.54 (toplam için medyan hata %7.9) |
| Canlı görüntü (Pazartesi 11:30) | Ağ 295 bin araç/sa (eğitim aralığının tavanı), MAP tahmini 61.6 bin: oran 4.8 |
| Simülasyon-gerçek farkı | Gerçek hız oranının medyanı 0.32, simülasyonunki 0.99. Linklerin %45'i simüle edilen %1–99 aralığının dışında |

**Sonuç: ağ henüz kullanılamaz ve denetçi bunu yakalıyor.** Statik BPR ataması gerçek trafiğin yavaşlamasını üretmiyor: sinyaller, kuyruk ve hız sınırının altındaki serbest akış hızı modelde yok. Bu yüzden ağ hem az şey öğreniyor hem de gerçek veride eğitim aralığının dışına düşüyor. MAP tahmincisi referans olarak bu çıktıyı reddediyor (`report.json` → `trustworthy: false`). Sıradaki adım, örnekleri mezoskopik SUMO koşularından üretmek (`tools/sumo/run_od.py`, aynı diziler) ve hız oranını hız sınırına göre değil, gözlenen gece serbest akış hızına göre tanımlamak.

### Sensör denetimi: tek yön mü, iki yön mü? (19 Ekim 2026)

```bash
uv run --group sumo python tools/od/sensor_audit.py --counts data/od/koridor/counts_202410_d0_h11.json --variant
uv run --group sumo python tools/od/corridor.py --area=koridor --speeds data/od/koridor/20261019-1130-counts-level/speeds.csv \
  --counts data/od/koridor/counts_202410_d0_h11_onedir.csv --anchors data/od/koridor/anchors_202410_h11.csv --tag onedir
```

İBB, sensörlerin hangi taşıt yollarını saydığını yayımlamıyor. Bu yüzden üç bağımsız kontrol yapıldı:

1. Sayım, tek yön kapasitesini aşıyor mu?
2. Aynı yoldaki komşu sensörlerle 2024 boyunca günlük sayım oranı ne?
3. Tahmin hangi okumayla uyumlu?

10 sensör, komşusunun yıl boyu (150–320 gün) sürekli yaklaşık yarısını okuyor. Örneğin TEM Karanfilköy, FSM Avrupa Girişi'nin 0.48'i; 4. Levent, Büyükdere 1. Levent'in 0.42'si. Bu sensörler tek yön sayılıp (değer ×2, belirsizlik ×2.5) yeniden tahmin yapıldı. Değerlendirme, **dokunulmayan 14 sensörün** dışarıda bırakılan GEH'iyle yapıldı; böylece test kendi kendini doğrulamıyor.

| | Ortalama GEH | Medyan | GEH < 5 |
|---|---|---|---|
| İki yön (temel) | 27.0 | 25.5 | 1/14 |
| 10 sensör tek yön | 21.2 | 20.5 | 2/14 |

Etki gruba göre ayrışıyor. TEM (O-2) ve Büyükdere sensörlerinde hipotez güçlü destek alıyor: TEM Levent 31.8 → 10.2, TEM Harp Akademileri 46.4 → 27.6, FSM Avrupa Girişi 46.2 → 23.9, Harp Akademisi 19.6 → 1.5. Köprü ve D100 (O-1) sensörlerinde ise kötüleşiyor: köprü Yıldız katılımı 17.6 → 30.4, köprü Avrupa girişi 8.9 → 17.2. Bu da D100 üzerindeki dört sensörün tek yön olmadığını düşündürüyor. Kesin teyit İBB'den gelmeli; denetim, hangi sensörlerin sorulması gerektiğini sıralıyor (`data/od/koridor/sensor_audit.json`).
