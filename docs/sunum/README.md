# Akademik sunum (ara sonuç, Ekim 2026)

Aynı sunumun birebir Türkçe ve İngilizce hali (24 slayt, aynı yapı ve aynı grafikler):

| | Kaynak (Marp) | Çıktılar |
|---|---|---|
| Türkçe | [SUNUM.md](SUNUM.md) | [sunum.pdf](sunum.pdf), [sunum.html](sunum.html) |
| English | [SUNUM_EN.md](SUNUM_EN.md) | [sunum_en.pdf](sunum_en.pdf), [sunum_en.html](sunum_en.html) |

Ayrıca: [Procedural_Istanbul_class.pptx](Procedural_Istanbul_class.pptx), genel izleyici için sade İngilizce ders sunumu (14 slayt); konuşma metni [konusma_metni.md](konusma_metni.md).

`img/`: Grafikler [tools/report/figures.py](../../tools/report/figures.py) ile üretilir; veri gerektirmeyenler iki dilde (`ad.png` Türkçe, `ad-en.png` İngilizce). `koridor-harita`, `dislanan-sayimlar` ve `sumo-hizlar` `data/od/koridor` çıktılarından üretilir ve şimdilik yalnızca Türkçe etiketlidir. Diğerleri 3D istemcinin ekran görüntüleridir.

Yeniden üretmek için:

```bash
uv run --with matplotlib python tools/report/figures.py
npx --offline @marp-team/marp-cli@3.4.0 docs/sunum/SUNUM.md --html --pdf --allow-local-files -o docs/sunum/sunum.pdf
npx --offline @marp-team/marp-cli@3.4.0 docs/sunum/SUNUM.md --html -o docs/sunum/sunum.html
npx --offline @marp-team/marp-cli@3.4.0 docs/sunum/SUNUM_EN.md --html --pdf --allow-local-files -o docs/sunum/sunum_en.pdf
npx --offline @marp-team/marp-cli@3.4.0 docs/sunum/SUNUM_EN.md --html -o docs/sunum/sunum_en.html
```

`--html` gereklidir: slaytlar iki ve üç sütunlu düzen için satır içi HTML kullanır.

Sunum olumsuz bulguları da içerir. Doğrulama ölçütü (dışarıda bırakılan sayımlarda GEH < 5, ≥ %85) henüz karşılanmıyor; nedenleri ve sonraki adımlar slaytlarda.
