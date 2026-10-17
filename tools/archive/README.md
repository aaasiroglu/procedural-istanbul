# İBB canlı trafik arşivi

İBB UYM'nin canlı akışı yalnızca o anı gösterir. `ibb_speeds.py` 5 dakikada bir (saat başına hizalı: :00, :05, …) bu akışı Parquet'e yazar. Bu arşiv, kalibrasyon ve darboğaz analizinin ham verisidir.

```bash
npm run archive:ibb                                   # durdurulana kadar
uv run tools/archive/ibb_speeds.py --once             # tek çağrı (cron, test)
uv run tools/archive/ibb_speeds.py --out /yol --interval 300
```

## Çıktı (`data/archive/ibb`)

| Veri kümesi | İçerik |
|---|---|
| `segment_speeds/date=YYYY-MM-DD/HHMMSS.parquet` | Tüm şehir, yaklaşık 12.700 kesim: `segment_id`, `type` (T), `speed_kph` (V), `congestion` (C: 1 akıcı … 5 kilit, 0 veri yok), `measured_at`, `source_time`, `fetched_at` (UTC) |
| `traffic_index/date=…/HHMMSS.parquet` | Şehir, Anadolu ve Avrupa trafik indeksi |
| `segments/date=YYYY-MM-DD.parquet` | Kesim geometrisi (WKT, lon lat) ve ilçe; günde bir kez |

- Akış değişmediyse (aynı `source_time`) hız dosyası yazılmaz.
- Dosyalar önce geçici adla yazılıp yeniden adlandırılır, okuyan taraf yarım dosya görmez.
- Hatalı istekler 5, 15 ve 45 sn arayla yeniden denenir.
- Arşiv büyüklüğü günde yaklaşık 20 MB.

Geometri uç noktası (8.801 kesim), hız akışından (yaklaşık 12.700 kesim) daha az kesim döndürüyor. Bu yüzden bazı hız kayıtlarının geometrisi yok.

## Sorgu örneği (DuckDB)

```sql
-- Koridordaki kesimlerin 15 dakikalık ortalama hızı
WITH seg AS (
  SELECT segment_id, ST_GeomFromText(wkt) AS g
  FROM read_parquet('data/archive/ibb/segments/*.parquet', filename = true)
  QUALIFY row_number() OVER (PARTITION BY segment_id ORDER BY filename DESC) = 1
)
SELECT time_bucket(INTERVAL 15 MINUTE, measured_at) AS t, segment_id, avg(speed_kph) AS v
FROM read_parquet('data/archive/ibb/segment_speeds/*/*.parquet', hive_partitioning = true)
JOIN seg USING (segment_id)
WHERE ST_Intersects(g, ST_MakeEnvelope(28.975, 41.038, 29.048, 41.118))
GROUP BY ALL ORDER BY t;
```

Bu sorgu `INSTALL spatial; LOAD spatial;` gerektirir.

## Sürekli çalıştırma (macOS)

Bilgisayar açıkken arşivlemeye devam etmek için ayrı bir terminalde `npm run archive:ibb` çalıştırmak yeterli. Kesintisiz arşiv için launchd ajanı veya her zaman açık bir sunucu tercih edilmelidir. Uykuda geçen süreler arşivde boşluk olarak kalır.
