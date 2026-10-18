---
marp: true
theme: default
paginate: true
size: 16:9
title: Procedural Istanbul — Hızdan Talep Tahmini ve Koridor Dijital İkizi
style: |
  section { font-size: 24px; }
  h1 { font-size: 40px; color: #1d3f72; }
  h2 { font-size: 32px; color: #1d3f72; }
  table { font-size: 19px; }
  .small { font-size: 17px; }
  .cols { display: grid; grid-template-columns: 1fr 1fr; gap: 24px; }
---

<!-- _paginate: false -->

# Procedural Istanbul

## Sansürlü hız gözlemleriyle O-D tahmini ve Maslak–15 Temmuz koridorunun açık dijital ikizi

Abdurrahim Arif Aşıroğlu
Ekim 2026 · ara sonuç sunumu

<span class="small">Kod ve veri hattı: github.com/aaasiroglu/procedural-istanbul (MIT) · 3D motor Yong Su'nun "Tokyo" projesinden türetilmiştir</span>

---

## Problem

- **Simülatör yolculuk ister, sensör hız verir.** SUMO gibi mikroskobik bir simülatörün başlangıç–varış (O-D) matrisine, yani "kim nereden nereye gidiyor" bilgisine ihtiyacı var. İBB'nin canlı akışı ise her yol kesimi için yalnızca **hız** ve **sıkışıklık sınıfı** veriyor.
- **Sayım az, sorun belirsiz.** Gerçek sayım verisi seyrek. O-D çifti sayısı (9.025), gözlem sayısını yüzlerce kat aşıyor; ters problem kötü konumlanmış (ill-posed).
- **Mevcut yaklaşımların zaafı:** Hızı sahte sayıma çevirmek, verinin taşımadığı bir kesinliği modele sokar. Tahminin ne kadarının veriden, ne kadarının varsayımdan geldiği genellikle raporlanmaz.

**Amaç:** Koridorun saatlik O-D'sini açık veriden tahmin etmek, belirsizliği dürüstçe raporlamak ve dışarıda bırakılan sayımlarla doğrulamak.

---

## Çalışma alanı ve veri

<div class="cols">
<div>

![w:520](img/koridor-harita.png)

</div>
<div>

**Koridor:** Beşiktaş – Maslak, Çağlayan – 15 Temmuz Köprüsü (≈ 5.9 × 8.9 km)

| Veri | Kaynak |
|---|---|
| Yol ağı, binalar, POI | OpenStreetMap |
| Canlı segment hızı (≈ 12.700) | İBB UYM |
| Günlük sensör sayımları (27 sensör) | İBB Açık Veri |
| Saatlik prob araç yoğunluğu | İBB Açık Veri |
| Kalibre ulaşım modeli (2020) | İBB Açık Veri |
| Arazi | Mapzen / SRTM |

</div>
</div>

---

## Mimari

```
OSM ──► SUMO ağı (netconvert) ──► İBB segment eşlemesi (%95.5)
                │
İBB canlı hız ──┼──► sansürlü gözlemler ─┐
İBB sayımları ──┼──► sayım kesitleri ────┼──► Ters O-D (bilevel MAP) ──► od2trips ──► SUMO
OSM bina/POI ───┴──► zon prior'ı ────────┘          │
                                                    └──► veri payı, standart hata, GEH
3D istemci (Three.js): OSM'den prosedürel İstanbul, canlı trafik katmanı
```

- Her adım tek komutla yeniden üretilebilir (`npm run sumo:net`, `sumo:map-ibb`, `od:corridor` …).
- Testler: 3D veri hattı ve ters O-D için 28 kontrol.

---

## Katkı 1 — Hız, sansürlü gözlem olarak

Üçgen temel diyagramda (Newell 1993; Daganzo 1994):

- **Serbest akış hızı akımı belirlemez.** Akım 0 ile kapasite arasında herhangi bir değer olabilir; hız yalnızca **üst sınır** verir.
- **Sıkışık dal** q = w·k<sub>j</sub>·v / (v + w), kuyruk var demektir, bu da **talep ≥ geçen akım** anlamına gelir; hız **alt sınır** verir.

$$\min_{x \ge 0}\ \sum_{\text{sayım}} \frac{((Px)_e - y_e)^2}{s_e^2} + \sum_{\text{alt}} \frac{\max(0,\, y_e - (Px)_e)^2}{s_e^2} + \sum_{\text{üst}} \frac{\max(0,\, (Px)_e - y_e)^2}{s_e^2} + \mathrm{KL}_\lambda(x \,\|\, x_0)$$

**Sıkışık mı serbest mi kararını** kendi tahminimiz değil, operatörün (İBB) segment bazındaki tarihsel bilgisini içeren sıkışıklık sınıfı veriyor.

**Bulgu (gerçek veri):** Kural yalnızca kesintisiz akışta geçerli. Sinyalli arterlerde düşük hız kırmızı ışıktan da gelir; alt sınırlar talebi %33 şişirdi. Kural otoyol ve trunk yollarla sınırlandı.

---

## Katkı 2 — Belirsizlik ve dürüst doğrulama

- **Veri payı:** Her O-D çifti için tahminin verilerden gelen kısmı hesaplanıyor: 1 − σ²<sub>sonsal</sub> / σ²<sub>prior</sub> (Laplace yaklaşımı; Woodbury ile n × n yerine m × m çözüm). Veriyle belirlenemeyen talep açıkça işaretleniyor.
- **İlişkili prior hataları:** x<sub>ij</sub> = x<sub>0,ij</sub> · e<sup>a<sub>i</sub> + b<sub>j</sub> + u<sub>ij</sub></sup>. Bağımsız çift hataları, bir kesitin toplam akışını neredeyse kesin sanıyor. Zon üretim ve çekim çarpanları, bir zonun tüm trafiğini tek bir sayıyla düzeltmeye izin veriyor.
- **Doğrulama:** GEH, modelin uydurulduğu sayımlarda değil, **her sayım tek tek dışarıda bırakıldığında** ölçülüyor.
- **Bilevel tahmin:** UE ataması ile tahmin dönüşümlü çalışıyor; salınım ardışık ortalamalarla sönümleniyor (Spiess 1990; Yang ve ark. 1992).
- **Sayısal koşullanma:** Log-uzayda optimizasyon (z = x<sub>0</sub>·e<sup>u</sup>) ile, 12 mertebeye yayılan prior değerlerinde de L-BFGS yakınsıyor.

---

## Sentetik doğrulama: gerçek O-D'si bilinen şehir

![w:1050](img/sentetik.png)

- Sayılmayan linklerin akımı prior'a göre **GEH 5.6 → 2.2** (rotalar biliniyorken) ve **3.8** (rotalar da tahmin edilirken). Rotaları prior'a sabitleyen kısa yol 8.0 veriyor; bilevel gerekli.
- Gerçek değerlerin **%96'sı 2.5 standart hata içinde**; belirsizlik aşırı iyimser değil.
- Tek tek O-D hücrelerindeki kazanç küçük (36 sayım, 90 çift): **akımlar belirlenebiliyor, hücreler belirlenemiyor.** Bunu açıkça raporlamak katkının parçası.

---

## Gerçek veri: sayım hattı

- 27 İBB sensöründen 25'i SUMO ağında yola dik sayım kesitlerine eşlendi; iki yön ve tüm şeritler.
- **Günlükten saatliğe çevirme:** Aynı gün ve aynı geohash hücresindeki prob araçların saatlik payıyla. Cumartesi 17–18 için günün %3.6–5.1'i.
- **Denetimle düzeltilen eşleme hataları:**

| Sensör | Günlük | İlk eşleme | Düzeltme |
|---|---|---|---|
| Mecidiyeköy | 110 bin | yan cadde (rota yok) | O-1 |
| Çağlayan Kavşağı | 103 bin | tek şeritli sokak | O-1 |
| TEM Karanfilköy | 103 bin | Uğur Mumcu Cd. | O-2 |
| FSM Gişeler | 81 bin | köprü girişiyle aynı kenarlar | çıkarıldı (yalnızca gişe şeritleri) |
| TEM FSM Gişe Öncesi | 98 bin | iki yön | tek yön |

---

## Gerçek veri: GEH sonuçları

![w:1100](img/geh-turlar.png)

**Ortalama GEH belirgin biçimde düştü (dışarıda bırakılan 35.6 → 23.4), ancak GEH < 5 ölçütü (%85) karşılanmıyor.**

---

## Kalan hata nereden geliyor

<div class="cols">
<div>

![w:520](img/dislanan-sayimlar.png)

</div>
<div>

1. **Sayım tanımları çelişiyor.** Üç O-2 sensörü modelde aynı akıma oturuyor, sayımları ise 4.291 / 7.108 / 8.171. Aralarında rampa yoksa bu mümkün değil: yön ya da şerit kapsamı farklı olmalı. İBB'den teyit gerekiyor.
2. **Geçitler ve ağ.** FSM'de model sayımın yarısını taşıyabiliyor; geçit prior'ı kapasiteye dayalı kaba bir varsayım.
3. **Prior.** OSM bina alanından üretilen çekim modeli. İBB'nin kalibre 540 zonlu matrisinin zon sırası yayımlanan dosyalardan çıkarılamıyor (istatistik testi: r = −0.08, rastgele sıralamadan farksız).

</div>
</div>

---

## Dinamik sınama: SUMO

![w:820](img/sumo-hizlar.png)

- 128.6 bin araç/sa (sayımlardan önceki tahmin), 90 dk, mezoskopik model, dinamik yeniden rotalama.
- **Ağ kilitlendi:** 192.551 aracın 102.735'i girebildi; medyan hız 2.9 km/sa (İBB: 24).
- Sonuç, sayımla sabitlenmemiş talep düzeyinin aşırı yüksek olduğunu doğruluyor: sayımlar köprüde 8.5 bin araç/sa gösteriyor, tahmin 13.9 bin yüklemişti. Sayımlı tahmin 74 bin araç/sa.

---

## 3D dijital ikiz

<div class="cols">
<div>

![w:520](img/kopru-ortakoy.jpg)
<span class="small">15 Temmuz asma köprüsü (kuleler, kablolar, askılar) ve Ortaköy Camii</span>

</div>
<div>

![w:520](img/levent-kuleler.jpg)
<span class="small">Levent: OSM building:part'tan kuleler</span>

</div>
</div>

---

## 3D: İstanbul'a özgü prosedürel üretim

<div class="cols">
<div>

![w:520](img/apartmanlar.jpg)
<span class="small">Kiremit kırma çatılar, bacalar, teras su depoları, krem/bej cepheler</span>

</div>
<div>

![w:520](img/vitrin-tabela.jpg)
<span class="small">OSM POI'si zemin kattaysa vitrin; tabela gerçek dükkan adı, ofisler kendi katında</span>

</div>
</div>

---

## 3D: yol geometrisi

<div class="cols">
<div>

![w:520](img/yol-profili.png)

</div>
<div>

- **Yer seviyesi köprüler:** Vadi ya da su geçen köprüler kıyıdan kıyıya düz tabliye.
- **Viyadükler:** Altındaki en yüksek zemin artı katmana göre serbest yükseklik, dikey kurplarla yumuşatılmış; zemindeki uçtan izin verilen eğimle sınırlı.
- **Diğer:** Tüneller ağızdan %12 ile derinleşiyor; yükseltilmiş yollar Chaikin yöntemiyle yuvarlatılıyor; layer<0 alt geçitler görünür (32 yol).
- **Performans:** 19.4 → 4.2 milyon üçgen, 4.599 → 780 çizim çağrısı.

</div>
</div>

---

## Sınırlar

- **Doğrulama ölçütü karşılanmıyor:** Dışarıda bırakılan GEH < 5 oranı %4.2 (hedef %85).
- **Tek zaman dilimi:** Tek bir Cumartesi 17:00 görüntüsü; gün tipi ve saat varyasyonu henüz modellenmedi.
- **Statik atama:** Dönüş yasakları ve kuyruk yayılımı yok; dinamik model henüz talep düzeyiyle tutarlı değil.
- **Elle seçilmiş varsayımlar:** Prior parametreleri (kat sayısı, hane başına yolculuk, geçit payları) elle seçildi; hepsi `summary.json` içinde listeleniyor.
- **Bina yükseklikleri:** OSM'de kat bilgisi olmayan binalarda kat sayısı (4–8) atandı.
- **Literatür taraması:** "Hız = sansürlü gözlem" ve "veri payı" katkılarının özgünlüğü sistematik literatür taramasıyla teyit edilmeli.

---

## Sonraki adımlar

1. **Sensör tanımları:** Yön, şerit kapsamı ve gişe/rampa ayrımı İBB'den teyit edilecek (çelişen O-2 sensörleri).
2. **İBB 2020 modeli:**
   - Zon tablosu bulunacak. Ulaşım Ana Planı hanehalkı anketi CSV'leri aday.
   - 540 zonlu O-D prior olarak kullanılacak.
   - Kalibre kapasite ve BPR değerleri aktarılacak (α = 0.924 / β = 3.464 ve α = 0.158 / β = 3.483).
3. **Zaman:**
   - Saatlik yoğunluk arşivi (2020'den beri) ile gün tipi ve saat profilleri.
   - Canlı hız arşivinin sürekli çalışması.
4. **Dinamik tutarlılık:** Sayımlı talep SUMO'da ölçekli koşularla sınanacak (%25 / %50 / %75 / %100).
5. **Öneri motoru:**
   - Sürücüye kalkış saati, mod ve köprü seçimi.
   - Kuruma darboğaz sıralaması ve senaryo karşılaştırması.
   - Geçmiş veriyle geriye dönük test.

**Hedef yayın yolu:** TRB Annual Meeting / hEART (yöntem ve vaka), ardından Transportation Research Part C (çok haftalık doğrulama) ve açık veri seti makalesi.

---

## Yeniden üretilebilirlik

```bash
npm run sumo:net -- --area=koridor          # OSM → SUMO ağı, rapor
npm run sumo:map-ibb -- --area=koridor      # İBB segmentleri → kenarlar
uv run --group sumo python tools/od/counts.py --area=koridor --month=2024-10 --weekday=5 --hour=17
uv run --group sumo python tools/od/corridor.py --area=koridor \
    --speeds data/od/koridor/20261017-1726/speeds.csv \
    --counts data/od/koridor/counts_202410_d5_h17.csv --tag counts
npm run test:od                             # sentetik doğrulama (28 kontrol)
uv run --with matplotlib python tools/report/figures.py   # bu sunumun grafikleri
npm run dev                                 # 3D istemci: http://localhost:5280
```

Tüm varsayımlar, ara sonuçlar ve olumsuz bulgular `tools/*/README.md` dosyalarında, tarih ve sayılarla kayıtlı.

---

## Kaynaklar

<div class="small">

- Cascetta, E. (1984). Estimation of trip matrices from traffic counts and survey data: a generalized least squares estimator. *Transportation Research Part B*, 18(4–5).
- Chaikin, G. M. (1974). An algorithm for high-speed curve generation. *Computer Graphics and Image Processing*, 3(4).
- Daganzo, C. F. (1994). The cell transmission model. *Transportation Research Part B*, 28(4).
- Frederix, R., Viti, F., Corthout, R., Tampère, C. M. J. (2011). New gradient approximation method for dynamic origin–destination matrix estimation on congested networks. *Transportation Research Record*, 2263.
- Lopez, P. A. ve ark. (2018). Microscopic traffic simulation using SUMO. *IEEE ITSC*.
- Newell, G. F. (1993). A simplified theory of kinematic waves in highway traffic. *Transportation Research Part B*, 27(4).
- Spiess, H. (1990). A gradient approach for the O-D matrix adjustment problem. CRT, Université de Montréal.
- Van Zuylen, H. J., Willumsen, L. G. (1980). The most likely trip matrix estimated from traffic counts. *Transportation Research Part B*, 14(3).
- Yang, H., Sasaki, T., Iida, Y., Asakura, Y. (1992). Estimation of origin–destination matrices from link traffic counts on congested networks. *Transportation Research Part B*, 26(6).
- UK Department for Transport. TAG Unit M3.1, Highway Assignment Modelling (GEH ölçütü).
- İBB Açık Veri Portalı (data.ibb.gov.tr): Günlük Araç Sayımı, Saatlik Trafik Yoğunluk, Ulaşım Talep Tahmin Modeli Verisi.

</div>
