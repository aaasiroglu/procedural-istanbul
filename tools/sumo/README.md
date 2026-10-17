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
