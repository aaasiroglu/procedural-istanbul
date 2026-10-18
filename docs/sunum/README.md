# Akademik sunum (ara sonuç, Ekim 2026)

- [SUNUM.md](SUNUM.md): Kaynak dosya (Marp Markdown, 18 slayt)
- [sunum.pdf](sunum.pdf), [sunum.html](sunum.html): Çıktılar
- `img/`: Grafikler ([tools/report/figures.py](../../tools/report/figures.py) ile gerçek çıktılardan üretilir) ve 3D istemcinin ekran görüntüleri

Yeniden üretmek için:

```bash
uv run --with matplotlib python tools/report/figures.py
npx @marp-team/marp-cli@3.4.0 docs/sunum/SUNUM.md --pdf --allow-local-files -o docs/sunum/sunum.pdf
npx @marp-team/marp-cli@3.4.0 docs/sunum/SUNUM.md --html --allow-local-files -o docs/sunum/sunum.html
```

Sunum olumsuz bulguları da içerir. Doğrulama ölçütü (dışarıda bırakılan sayımlarda GEH < 5, ≥ %85) henüz karşılanmıyor; nedenleri ve sonraki adımlar slaytlarda.
