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
