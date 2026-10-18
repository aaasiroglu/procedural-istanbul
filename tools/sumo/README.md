# SUMO ağı

Çalışma alanının (bbox: `tools/pipeline/config.mjs`) OSM'den SUMO ağı, İBB segmentleriyle eşlemesi ve ağ sağlığı testi.

```bash
npm run sumo:net -- --area=koridor        # OSM (önbellekli) → netconvert → report.json
npm run sumo:map-ibb -- --area=koridor    # İBB segmentleri → SUMO kenarları (ibb_edges.csv)
npm run sumo:smoke -- --area=koridor      # rastgele trafikle kilitlenme/teleport testi
```

İlk çalıştırmada `uv`, SUMO 1.27.1'i (`eclipse-sumo`) projenin sanal ortamına kurar. Çıktılar `data/sumo/<alan>/` altına yazılır ve repoya girmez.

## Koridor ağı (17 Ekim 2026)

| | |
|---|---|
| Kenar / kavşak | 21.174 / 8.963 (kenar uzunlukları her yön ayrı sayılır; sınırı kesen kenarlar bütün olarak tutulur) |
| Sinyalli kavşak / program | 293 / 179 |
| Karşılıklı erişilebilir araç kenarı | %98.3 |
| 15 Temmuz Köprüsü | Yön başına 3 şerit, 1.56 km |
| Metrobüs | 11.8 km, ayrık şerit, yalnızca otobüs |
| İBB segment eşlemesi | Alandaki 1.083 segmentin %95.5'i eşlendi, 5.543 kenar gözleniyor |
| İBB gözlem kapsamı (yol uzunluğu) | Otoyol %99, trunk %100, ana arter %94, tali arter %92, toplayıcı %72, konut sokağı %8 |
| Duman testi, 3.000 araç/sa | Çarpışma 0, teleport %1.7 |
| Duman testi, 6.000 araç/sa | Çarpışma 0, teleport %2.7 |

### Modelleme kararları

Bunlar kalibrasyonla sınanacak varsayımlardır.

- **Ağ kapsamı:** Otoyoldan `living_street`'e kadar tüm yol tipleri ve bağlantı yolları alınır. Servis yolları (otopark, site içi) alınmaz.
- **Metrobüs:** OSM'de ayrı taşıt yolu (`highway=busway`) olarak çizili. Ağda yalnızca otobüse açıktır, araç şeridinden kapasite almaz.
- **Sinyaller:** OSM `traffic_signals` düğümlerinden alınır. Sabit zamanlı, varsayılan devre 90 sn; İBB sinyal planları bilinmiyor.
- **`--tls.discard-simple` bilinçli olarak kullanılmıyor.** Bu seçenek koridordaki sinyallerin yaklaşık üçte ikisini (orta-blok yaya ışıkları, bölünmüş yollardaki ayrık kavşaklar) siliyor ve arterlerin kapasitesini olduğundan yüksek gösteriyordu.

### İBB eşlemesi

- **Uç nokta:** İBB geometrisi `v3/Segments/0`'dan alınır. `Segments/1` otoyolları içermeyen bir alt kümedir; kullanıldığında otoyol kapsamı %7'de kalıyordu.
- **Yöntem:** Her segment 12 m aralıkla örneklenir. Her örnek, 18 m içindeki ve aynı yöne (±35°) giden en yakın araç kenarına bağlanır.
- **Ters yönlü segmentler:** 44 segment ters çevrildiğinde daha iyi eşleşiyor. Bunlar OSM'deki tek yön hataları ya da İBB çizim yönü olabilir ve inceleme listesindedir.
- **Konut sokakları:** İBB bu yolları ölçmüyor (%8 kapsam). Buralardaki talep, ters O-D tahmininde prior'a dayanır ve `data_share` bunu gösterir.

### Bilinen sorunlu noktalar

Duman testinde teleportların çoğu, ışıksız kavşaklardaki "yield" kilitlenmeleri. İki küme öne çıkıyor:

- Harbiye çevresi (28.981 D, 41.0425 K), adsız ana ve tali arter kenarları
- Dikilitaş–Fulya: Hakkı Yeten Caddesi / Emirhan Caddesi kavşakları (29.002 D, 41.051 K)

Bu noktalar netedit ile şerit bağlantıları ve öncelik açısından incelenecek. Güncel liste her duman testinde `report.json` → `smoke.teleport_hotspots` alanına yazılır.

## O-D tahmininin SUMO'da koşturulması

```bash
uv run --group sumo python tools/sumo/run_od.py --area=koridor          # en yeni tahmin, 90 dk, mezoskopik
uv run --group sumo python tools/sumo/run_od.py --od-dir … --compare-only # koşmadan, önceki çıktıyla karşılaştır
```

### İlk koşu: 17 Ekim 2026, 17:26 tahmini

Sonuç olumsuz: ağ kilitlendi.

| | |
|---|---|
| Talep | 128.6 bin araç/sa, 90 dakikaya yayıldı: 192.551 araç |
| Ağa girebilen | 102.735 araç. 89.813 araç giriş kuyruğunda kaldı, 79.851 araç sonunda hâlâ yoldaydı, yalnızca 22.887 araç varabildi |
| Teleport | 4.954, hepsi sıkışma kaynaklı |
| Hız | İBB medyanı 24 km/sa, simülasyon medyanı 2.9 km/sa. 10 km/sa altında kalan segmentler: İBB'de %3.7, simülasyonda %84 |
| Hata | Tahminde kullanılan segmentlerde MAE 23.5 km/sa (simülasyon 20 km/sa yavaş), r = 0.37. Kullanılmayan yerel sokaklarda MAE 15.2 km/sa |
| Süre | M1'de 3 saat 10 dakika, işlemci süresinin çoğu yeniden rotalama sorgularında |

Muhtemel nedenler, kontrol sırasına göre:

1. **Talep düzeyi sayımla sabitlenmemiş.** Statik atama BPR ile kapasite aşımına izin veriyor, dinamik model izin vermiyor.
2. **İç zonların araçları dar noktadan giriyor.** Her zon, 3 bağlantı düğümünün çevresindeki birkaç yerel kenardan araç sokuyor; bu da giriş kuyruğunu açıklayabilir.
3. **Ağ kusurları.** Duman testindeki kavşak kilitlenmeleri ile mezoskopik kavşak ayarları (`--meso-junction-control.limited`, `--meso-tls-flow-penalty`).

Önerilen sonraki adımlar:

- Talebi ölçekleyerek (ör. %25, %50, %75) ağın hangi düzeyde aktığını bulmak.
- Zon girişlerini daha çok kenara yaymak.
- Talep düzeyini köprü sayımıyla sabitlemek.
- Daha kısa koşular (30 dk, tek rotalama iş parçacığı).
