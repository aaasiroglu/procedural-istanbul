# Procedural Istanbul: konuşma metni / speaker script

Ders sunumuyla ([Procedural_Istanbul_class.pptx](Procedural_Istanbul_class.pptx)) slayt slayt eşleşir. 1. konuşmacı slayt 1–7, 2. konuşmacı slayt 8–14. İngilizce metin sunumun konuşmacı notlarında da var.

## English

### Speaker 1 (slides 1–7)

**[Slide 1 · Title]** Hello, and welcome to the final presentation of our project, Procedural Istanbul. We built a 3D digital twin of the Maslak – 15 July Bridge corridor from open data, with a traffic model underneath it. Our question: can we read a city's traffic from road speeds alone?

**[Slide 2 · The big question]** A traffic simulator like SUMO needs an origin–destination, or O-D, matrix: how many cars travel from each area to each other area every hour. Planning and accident response start from it too. But no sensor measures it directly.

**[Slide 3 · What we can measure]** What we do have: live speeds on about 1,000 road segments, only 23 counters that count actual cars, and İstanbulkart taps at 31 metro and Metrobüs stops. We added OpenStreetMap, elevation data, the 2012 household survey and İBB's 2020 transport model. All of it is open data.

**[Slide 4 · A speed is not a count]** Why is it hard? Roads A and B both move at 80 km/h, yet one has three cars and the other many more. A slow road means a queue. So a fast road tells us 'at most', a jammed road 'at least'. This censored observation is our first contribution: we never invent an exact number.

**[Slide 5 · Three steps]** Our method has three steps. Measure. Work backwards to the trips that best explain the measurements, reporting for every result how much comes from data and how much from assumptions: our second contribution. Then test only on counters the model has never seen, and play 'what if' in a simulator.

**[Slide 6 · Step 1: the 3D city]** Step one is the city. Our twin runs in a web browser: about 38,000 buildings and 1,170 km of roads from OpenStreetMap, cut from 19.4 to 4.2 million triangles so it runs smoothly. It has tiled roofs, real shop signs and realistic bridge profiles, and roads are coloured by live İBB speeds.

**[Slide 7 · Step 2: work backwards]** Step two. We split the corridor into 95 areas, so 9,025 possible area pairs: far more unknowns than measurements. A first guess from buildings is corrected by the data. Our third contribution: in a test city, one counting point was not enough to fix the total traffic; you need several. Now my teammate will show the real results.

### Speaker 2 (slides 8–14)

**[Slide 8 · Key finding]** Thank you. We tested the model with 23 İBB counters. Our key finding: the first guess, built only from buildings, put almost twice as many cars in the corridor as the counts allow, about 118 thousand an hour instead of 62 thousand. That is why our first simulation locked up. Now the total comes from measurements.

**[Slide 9 · Checking honestly]** To check the model, we hide one counter and predict it, like an exam you have not seen. The score is GEH; the target is below 5 on 85 percent of counters. Our error fell from about 36 to 23, but we are at about 9 percent. The total is right, the spread across areas is not yet. Some counters probably count one direction only; İBB must confirm.

**[Slide 10 · Shadow simulation]** A practical use: when a part of the TEM motorway closes, we take a snapshot of all traffic and play several futures from it, faster than real time. Warning drivers at once gets 735 more cars through in 20 minutes than not telling them. Honestly, part of that comes from drivers re-planning more often, and this is one run.

**[Slide 11 · From data to advice]** This turns into advice inside the twin. The recommendations panel shows roads where demand is above capacity, in red, what to do if a road closes, and which counters to check. Each item shows its numbers, and a click takes the camera there.

**[Slide 12 · What works, what not yet]** To sum up: the 3D twin, the total traffic level, honest checks, the what-if simulator and the advice work. İstanbulkart taps, as an independent check, agreed with the counters. Not yet: where exactly cars go, the sensor definitions, and a fast neural network; our main method audited its first version and rejected it.

**[Slide 13 · Try it yourself]** You can try it now. The left code opens the live 3D twin, best on a laptop. The right one opens the project site, with every term explained, the report and these slides.

**[Slide 14 · Thank you]** Next, we will confirm the sensors with İBB, add more days and hours, and give drivers advice on departure times and routes. One idea to remember: a speed tells you 'at most' or 'at least', never an exact number of cars. Thank you; we are happy to take questions.

## Türkçe

### 1. konuşmacı (slayt 1–7)

**[Slayt 1 · Title]** Merhaba, Procedural Istanbul projemizin final sunumuna hoş geldiniz. Maslak – 15 Temmuz Köprüsü koridorunun açık veriyle kurulmuş 3D dijital ikizini ve altında çalışan trafik modelini yaptık. Sorumuz şu: bir şehrin trafiğini yalnızca yollardaki hızdan okuyabilir miyiz?

**[Slayt 2 · The big question]** SUMO gibi bir trafik simülatörü bir başlangıç–varış, yani O-D matrisine ihtiyaç duyar: her bölgeden her bölgeye saatte kaç araç gidiyor. Planlama ve kaza müdahalesi de buradan başlar. Ama bunu doğrudan ölçen bir sensör yok.

**[Slayt 3 · What we can measure]** Elimizde olanlar şunlar: yaklaşık 1.000 yol kesiminde canlı hız, gerçekten araç sayan yalnızca 23 sayaç ve 31 metro ve metrobüs durağında İstanbulkart binişleri. Bunlara OpenStreetMap'i, yükseklik verisini, 2012 hanehalkı anketini ve İBB'nin 2020 ulaşım modelini ekledik. Hepsi açık veri.

**[Slayt 4 · A speed is not a count]** Neden zor? A ve B yolları 80 km/sa hızla akıyor, ama birinde üç araç var, diğerinde çok daha fazla. Yavaş bir yol ise kuyruk demek. Yani hızlı bir yol bize 'en fazla', sıkışık bir yol 'en az' der. Bu 'sansürlü gözlem' ilk katkımız: kesin bir sayı uydurmuyoruz.

**[Slayt 5 · Three steps]** Yöntemimiz üç adım. Ölçüyoruz. Ölçümleri en iyi açıklayan yolculuklara geriye doğru ulaşıyoruz ve her sonucun ne kadarının veriden, ne kadarının varsayımdan geldiğini raporluyoruz: bu ikinci katkımız. Sonra modeli yalnızca hiç görmediği sayaçlarda sınıyor ve simülatörde 'ya şöyle olursa' senaryolarını oynatıyoruz.

**[Slayt 6 · Step 1: the 3D city]** Birinci adım şehir. İkizimiz tarayıcıda çalışıyor: OpenStreetMap'ten yaklaşık 38.000 bina ve 1.170 km yol; akıcı çalışsın diye 19,4 milyon üçgenden 4,2 milyona indirdik. Kiremit çatılar, gerçek dükkân tabelaları ve gerçekçi köprü profilleri var; yollar İBB'nin canlı hızlarıyla renkleniyor.

**[Slayt 7 · Step 2: work backwards]** İkinci adım. Koridoru 95 bölgeye ayırdık; bu da 9.025 olası bölge çifti demek, yani ölçümden çok daha fazla bilinmeyen. Binalardan kurulan ilk tahmini veri düzeltiyor. Üçüncü katkımız: bir test şehrinde tek bir sayım noktası toplam trafiği sabitlemeye yetmedi; birden çok sayım gerekiyor. Gerçek sonuçları ekip arkadaşım anlatacak.

### 2. konuşmacı (slayt 8–14)

**[Slayt 8 · Key finding]** Teşekkürler. Modeli 23 İBB sayacıyla test ettik. En önemli bulgumuz: yalnızca binalardan kurulan ilk tahmin, koridora sayımların izin verdiğinin neredeyse iki katı araç koyuyordu; saatte 62 bin yerine yaklaşık 118 bin. İlk simülasyonumuzun kilitlenmesinin nedeni buydu. Artık toplamı ölçümler belirliyor.

**[Slayt 9 · Checking honestly]** Modeli sınamak için bir sayacı saklayıp onu tahmin ettiriyoruz; görmediğin bir sınav sorusu gibi. Ölçüt GEH; hedef, sayaçların yüzde 85'inde 5'in altı. Hatamız 36'dan 23'e indi, ama yüzde 9 civarındayız. Toplam doğru, bölgelere dağılım henüz değil. Bazı sayaçlar muhtemelen tek yön sayıyor; bunu İBB teyit etmeli.

**[Slayt 10 · Shadow simulation]** Pratik bir kullanım: TEM otoyolunun bir kısmı kapandığında tüm trafiğin anlık görüntüsünü alıp birkaç olası geleceği gerçek zamandan hızlı oynatıyoruz. Sürücüleri hemen bilgilendirmek, haber vermemeye göre 20 dakikada 735 araç daha geçiriyor. Dürüst olmak gerekirse bunun bir kısmı sürücülerin daha sık rota değiştirmesinden geliyor ve bu tek bir koşu.

**[Slayt 11 · From data to advice]** Bu, ikizin içinde öneriye dönüşüyor. Öneriler paneli talebin kapasiteyi aştığı yolları kırmızıyla, bir yol kapanırsa ne yapılacağını ve hangi sayaçların kontrol edilmesi gerektiğini gösteriyor. Her öneri dayandığı sayıları gösteriyor; tıklayınca kamera oraya gidiyor.

**[Slayt 12 · What works, what not yet]** Özetle: 3D ikiz, toplam trafik düzeyi, dürüst sınama, simülatör ve öneriler çalışıyor. Bağımsız bir sağlama olarak İstanbulkart binişleri sayaçlarla tutarlı çıktı. Henüz olmayanlar: araçların tam olarak nereye gittiği, sensör tanımları ve hızlı bir sinir ağı; ana yöntemimiz ilk sürümünü denetleyip reddetti.

**[Slayt 13 · Try it yourself]** Şimdi deneyebilirsiniz. Soldaki karekod canlı 3D ikizi açıyor; dizüstü bilgisayarda daha iyi çalışır. Sağdaki ise her terimin açıklandığı proje sitesini, raporu ve bu sunumu açıyor.

**[Slayt 14 · Thank you]** Sırada sensörleri İBB ile teyit etmek, daha fazla gün ve saat eklemek ve sürücülere kalkış saati ve rota önerisi vermek var. Akılda kalması gereken tek fikir: hız size 'en fazla' ya da 'en az' der, asla kesin bir araç sayısı vermez. Teşekkür ederiz; sorularınızı alabiliriz.
