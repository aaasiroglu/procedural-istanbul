# Procedural Istanbul: konuşma metni / speaker script

Genel bir izleyici için sade dil: az rakam, teknik terim yok. Ders sunumuyla ([Procedural_Istanbul_class.pptx](Procedural_Istanbul_class.pptx)) slayt slayt eşleşir. 1. konuşmacı slayt 1–7, 2. konuşmacı slayt 8–14. İngilizce metin sunumun konuşmacı notlarında da var.

## English

### Speaker 1 (slides 1–7)

**[Slide 1 · Title]** Hello everyone, and welcome. Our project is called Procedural Istanbul. We built a 3D copy of one of Istanbul's busiest areas, from Maslak down to the Bosphorus Bridge. And we asked a simple question: can we understand a city's traffic just by watching how fast the cars move?

**[Slide 2 · The big question]** To plan a city, you need to know where people are going. How many cars go from one neighbourhood to another, every hour? This is what planners need, and what you need when there is an accident. But there is no sensor that measures it.

**[Slide 3 · What we can measure]** So what can we measure? The city tells us the speed on about a thousand roads, live. But only a handful of places actually count cars. We also have the metro card taps at the stations. And everything we used is free and open to anyone.

**[Slide 4 · A speed is not a count]** Here is the tricky part. Look at the first two roads. Both are fast. But one has three cars, and the other has many. The speed alone cannot tell the difference. The third road is slow, which means there is a queue. So we use speed carefully: a fast road means 'not too many cars', a slow road means 'at least this many'. We never pretend to know an exact number.

**[Slide 5 · Three steps]** We work in three steps. First, we measure. Second, we work backwards, like a detective: which trips could have caused this traffic? And we always say how sure we are. Third, we check our answer and try out 'what if' situations in a traffic simulator.

**[Slide 6 · Step 1: the 3D city]** This is the city we built. It runs in a normal web browser, and it is made entirely from open maps: tens of thousands of buildings, with real Istanbul details like tiled roofs and shop signs. The colours on the roads show the live traffic.

**[Slide 7 · Step 2: work backwards]** Next, we split the area into small hexagon-shaped zones. Between all these zones there are thousands of possible trips, far more than we can measure. So we start with a rough guess based on the buildings, and let the real data correct it. Now my teammate will show you what we found.

### Speaker 2 (slides 8–14)

**[Slide 8 · Key finding]** Thank you. Here is our main finding. Our first guess, based only on buildings, imagined almost twice as many cars as there really are. When we put that guess into the simulator, the whole city got stuck in traffic. Once we used the real counts, the numbers made sense.

**[Slide 9 · Checking honestly]** How do we know if our answer is good? We hide one counting point, make our estimate without it, and then check how close we were. Like an exam question you have never seen. We are honest: the total amount of traffic is right, but where exactly the cars go still needs work. Some of the counters may only count one direction.

**[Slide 10 · Shadow simulation]** Now a real use. Imagine the motorway closes after an accident. At that moment we take a snapshot of all the traffic and play the next twenty minutes on the computer, in different ways. The result: if we warn drivers right away, hundreds more cars get where they are going.

**[Slide 11 · From data to advice]** And all of this becomes simple advice inside the 3D city. It shows which roads are overloaded, in red, what to do if a road closes, and which counters should be checked. Click on one, and the camera flies there.

**[Slide 12 · What works, what not yet]** So, what works today? The 3D city, the total amount of traffic, the honest checks, and the 'what if' simulator. The metro card data also agreed with our counts. What is not ready yet? Knowing exactly where every car goes, and a faster AI version, which did not pass our own quality check, so we do not use it yet.

**[Slide 13 · Try it yourself]** You can try it yourself right now. Scan the left code to open the 3D city; it works best on a laptop. The right code opens our website, where every term is explained in simple words.

**[Slide 14 · Thank you]** If you remember one thing from today: speed tells you a lot about traffic, but never the exact number of cars, so use it honestly. Thank you for listening. We are happy to answer your questions.

## Türkçe

### 1. konuşmacı (slayt 1–7)

**[Slayt 1 · Title]** Herkese merhaba, hoş geldiniz. Projemizin adı Procedural Istanbul. İstanbul'un en yoğun bölgelerinden birinin, Maslak'tan Boğaz Köprüsü'ne kadar uzanan hattın 3D bir kopyasını yaptık. Ve basit bir soru sorduk: sadece arabaların ne kadar hızlı gittiğine bakarak bir şehrin trafiğini anlayabilir miyiz?

**[Slayt 2 · The big question]** Bir şehri planlamak için insanların nereye gittiğini bilmek gerekir. Her saat bir mahalleden diğerine kaç araba gidiyor? Planlamacıların da, bir kaza olduğunda müdahale edenlerin de buna ihtiyacı var. Ama bunu ölçen bir sensör yok.

**[Slayt 3 · What we can measure]** Peki neyi ölçebiliyoruz? Belediye bize yaklaşık bin yoldaki hızı canlı olarak veriyor. Ama gerçekten araba sayan yer sadece birkaç tane. Bir de istasyonlardaki İstanbulkart basışları var. Kullandığımız her şey ücretsiz ve herkese açık.

**[Slayt 4 · A speed is not a count]** İşin zor kısmı şu. İlk iki yola bakın. İkisi de hızlı. Ama birinde üç araba var, diğerinde çok daha fazla. Hız tek başına bu farkı söyleyemez. Üçüncü yol yavaş; bu da bir kuyruk olduğu anlamına gelir. Bu yüzden hızı dikkatli kullanıyoruz: hızlı yol 'çok fazla araba yok' der, yavaş yol 'en az şu kadar araba var' der. Kesin bir sayıyı biliyormuş gibi yapmıyoruz.

**[Slayt 5 · Three steps]** Üç adımda çalışıyoruz. Önce ölçüyoruz. Sonra bir dedektif gibi geriye doğru gidiyoruz: bu trafiği hangi yolculuklar oluşturmuş olabilir? Ve ne kadar emin olduğumuzu her zaman söylüyoruz. Son olarak cevabımızı kontrol ediyor ve bir trafik simülatöründe 'ya şöyle olursa' durumlarını deniyoruz.

**[Slayt 6 · Step 1: the 3D city]** Kurduğumuz şehir bu. Normal bir internet tarayıcısında çalışıyor ve tamamen açık haritalardan yapıldı: on binlerce bina, kiremit çatılar ve dükkân tabelaları gibi gerçek İstanbul detaylarıyla. Yollardaki renkler canlı trafiği gösteriyor.

**[Slayt 7 · Step 2: work backwards]** Sonra bölgeyi küçük altıgen parçalara böldük. Bu parçalar arasında binlerce olası yolculuk var; ölçebildiğimizden çok daha fazla. Bu yüzden binalara bakarak kaba bir tahminle başlıyor ve gerçek verinin bunu düzeltmesine izin veriyoruz. Ne bulduğumuzu şimdi ekip arkadaşım anlatacak.

### 2. konuşmacı (slayt 8–14)

**[Slayt 8 · Key finding]** Teşekkürler. Ana bulgumuz şu. Sadece binalara dayanan ilk tahminimiz, gerçekte olanın neredeyse iki katı araba hayal ediyordu. Bu tahmini simülatöre koyduğumuzda bütün şehir trafikte kilitlendi. Gerçek sayımları kullandığımızda ise sayılar anlamlı hale geldi.

**[Slayt 9 · Checking honestly]** Cevabımızın iyi olup olmadığını nasıl anlıyoruz? Bir sayım noktasını saklıyor, tahminimizi onsuz yapıyor ve sonra ne kadar yaklaştığımıza bakıyoruz. Hiç görmediğin bir sınav sorusu gibi. Dürüst olalım: toplam trafik miktarı doğru, ama arabaların tam olarak nereye gittiği konusunda daha yol var. Bazı sayaçlar sadece tek yönü sayıyor olabilir.

**[Slayt 10 · Shadow simulation]** Şimdi gerçek bir kullanım. Bir kazadan sonra otoyolun kapandığını düşünün. O anda tüm trafiğin bir fotoğrafını çekiyor ve sonraki yirmi dakikayı bilgisayarda farklı şekillerde oynatıyoruz. Sonuç: sürücüleri hemen uyarırsak yüzlerce araba daha gideceği yere ulaşıyor.

**[Slayt 11 · From data to advice]** Ve bütün bunlar 3D şehrin içinde basit önerilere dönüşüyor. Hangi yolların aşırı yüklü olduğunu kırmızıyla, bir yol kapanırsa ne yapılacağını ve hangi sayaçların kontrol edilmesi gerektiğini gösteriyor. Birine tıklayınca kamera oraya uçuyor.

**[Slayt 12 · What works, what not yet]** Peki bugün ne çalışıyor? 3D şehir, toplam trafik miktarı, dürüst kontroller ve 'ya şöyle olursa' simülatörü. İstanbulkart verisi de sayımlarımızla uyuştu. Henüz hazır olmayan ne? Her arabanın tam olarak nereye gittiğini bilmek ve daha hızlı bir yapay zekâ sürümü; bu sürüm kendi kalite kontrolümüzden geçemedi, o yüzden henüz kullanmıyoruz.

**[Slayt 13 · Try it yourself]** Şimdi kendiniz deneyebilirsiniz. Soldaki karekodu okutursanız 3D şehir açılır; dizüstü bilgisayarda daha iyi çalışır. Sağdaki karekod ise her terimin sade bir dille anlatıldığı web sitemizi açar.

**[Slayt 14 · Thank you]** Bugünden tek bir şey hatırlayacaksanız şu olsun: hız trafik hakkında çok şey söyler ama asla kesin araba sayısını söylemez; bu yüzden onu dürüstçe kullanmak gerekir. Dinlediğiniz için teşekkürler. Sorularınızı memnuniyetle yanıtlarız.
