// A short guide on the first visit: what the screen shows, where the real results are, how to move around.
// Shown once per browser (localStorage), and again from the "?" button it leaves in the corner.

const KEY = 'procedural-istanbul:guide:1';

export function installWelcomeGuide({ onOpenRecommendations, onShowZones, hasData }) {
  const el = document.createElement('div');
  el.id = 'welcome-guide';
  el.innerHTML = `
    <style>
      #welcome-guide .card { position: fixed; left: 50%; bottom: 28px; transform: translateX(-50%); z-index: 3000; width: min(640px, calc(100vw - 32px));
        background: rgba(15, 23, 42, 0.95); color: #e2e8f0; border: 1px solid rgba(56, 189, 248, 0.35); border-radius: 16px; padding: 18px 20px 16px;
        box-shadow: 0 20px 50px rgba(0, 0, 0, 0.5); backdrop-filter: blur(14px); font: 13px/1.5 "Segoe UI", system-ui, sans-serif; }
      #welcome-guide .card[hidden] { display: none; }
      #welcome-guide h3 { margin: 0 0 4px; font-size: 16px; color: #f8fafc; }
      #welcome-guide p { margin: 0 0 12px; color: #94a3b8; }
      #welcome-guide ol { margin: 0 0 14px; padding: 0; list-style: none; display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; }
      #welcome-guide li { background: rgba(30, 41, 59, 0.8); border-radius: 10px; padding: 10px 12px; }
      #welcome-guide li b { display: block; color: #f8fafc; margin-bottom: 2px; }
      #welcome-guide .row { display: flex; gap: 8px; justify-content: flex-end; flex-wrap: wrap; }
      #welcome-guide button { border-radius: 9px; padding: 8px 14px; font: 600 12.5px inherit; cursor: pointer; border: 1px solid #334155; background: #1e293b; color: #e2e8f0; }
      #welcome-guide button.primary { background: #059669; border-color: #34d399; color: #fff; }
      #welcome-guide .help { position: fixed; right: 14px; bottom: 182px; z-index: 6; width: 32px; height: 32px; border-radius: 50%; border: 1px solid rgba(56, 189, 248, 0.4);
        background: rgba(15, 23, 42, 0.8); color: #7dd3fc; font: 700 15px inherit; cursor: pointer; }
      body.zen-mode #welcome-guide { display: none; }
      @media (max-width: 640px) { #welcome-guide ol { grid-template-columns: 1fr; } }
    </style>
    <div class="card" role="dialog" aria-label="Kısa rehber" hidden>
      <h3>Procedural İstanbul'a hoş geldiniz</h3>
      <p>Maslak'tan 15 Temmuz Köprüsü'ne uzanan koridorun açık veriyle kurulmuş 3D modeli. Yollar İBB'nin canlı yoğunluk renkleriyle boyanır.</p>
      <ol>
        <li><b>✅ Öneriler</b>Sayımlarla doğrulanmış tahminden çıkan sonuçlar: darboğazlar, kaza anında ne yapılmalı, hangi sensör kontrol edilmeli.</li>
        <li><b>⬡ O-D zonları</b>Altıgenlerin üzerine gelin: bölgenin ürettiği ve çektiği trafik. Tıklayın: o bölgeden nereye gidildiği.</li>
        <li><b>🖱️ Gezinme</b>Sürükleyerek kaydırın, sağ tuşla döndürün, tekerlekle yaklaşın. Sağ üstteki Ayarlar'dan saat ve görünüm.</li>
      </ol>
      <div class="row">
        <button data-a="close">Kapat</button>
        ${hasData ? '<button data-a="zones">Zonları göster</button><button class="primary" data-a="recs">Önerileri aç</button>' : ''}
      </div>
    </div>
    <button class="help" title="Kısa rehber" aria-label="Kısa rehber">?</button>`;
  document.body.appendChild(el);
  const card = el.querySelector('.card');
  const close = () => { card.hidden = true; try { localStorage.setItem(KEY, '1'); } catch { /* storage unavailable */ } };
  el.querySelector('[data-a="close"]').onclick = close;
  el.querySelector('[data-a="recs"]')?.addEventListener('click', () => { close(); onOpenRecommendations?.(); });
  el.querySelector('[data-a="zones"]')?.addEventListener('click', () => { close(); onShowZones?.(); });
  el.querySelector('.help').onclick = () => { card.hidden = !card.hidden; };
  let seen = false;
  try { seen = localStorage.getItem(KEY) === '1'; } catch { /* storage unavailable: show it */ }
  // (?guide=0: a clean view for screenshots and talks)
  if (!seen && new URLSearchParams(location.search).get('guide') !== '0') card.hidden = false;
}
