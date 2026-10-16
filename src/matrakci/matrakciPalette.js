// Nakkaşhane Doğal Pigment Paleti (16. Yüzyıl Osmanlı Minyatür ve Tezhip Renkleri)
// Doğal mineral, bitkisel ve metalik pigmentlerin birebir hekzadesimal karşılıkları.

export const MATRAKCI_PALETTE = {
  AHAR_PAPER_BG: '#F2E8D5',       // Yumurta akı ve nişasta ile cilalanmış aharlı kağıt
  AHAR_PAPER_DARK: '#DECBB1',     // Parşömen kenar gölgesi
  TAHRIR_INK: '#2B241E',          // İs mürekkebi dış kontur (Tahrir çizgisi)
  CETVEL_GOLD: '#D4AF37',         // Varak altın çerçeve ve optimal VRP kervan yolu
  CETVEL_LAPIS: '#1B3B6F',        // Lâciverd (Lapis Lazuli) ana cetvel ve deniz derinliği
  JENGAR_TURQUOISE: '#1D6F7A',    // Bakır çalığı turkuazı (Haliç ve Boğaz)
  FOAM_CREAM: '#F7F1E3',          // Helezonik dalga ve kıyı köpüğü
  ZIRNIK_TERRACE_1: '#E8DCB9',    // Zırnık sarısı alt topoğrafya sekisi
  ZIRNIK_TERRACE_2: '#DCE0B9',    // Orta bahçe sekisi
  ZIRNIK_TERRACE_3: '#C8D1A7',    // Üst tepe sekisi
  KUFEKI_STONE: '#E6D7C3',        // Küfeki taşı zemin kat ve surlar
  TIMBER_CUMBA: '#C89D7C',        // Ahşap cumbalı konut cephesi
  ASI_BOYASI_YALI: '#9E3B2B',     // Boğaz yalıları ve konakları (Aşı boyası kırmızısı)
  ZENCEFRE_ROOF: '#D1492F',       // Sülügen / Zencefre alaturka kiremit çatı
  LEAD_DOME: '#5C6B73',           // Kurşun kubbe ve Galata külahı
  CYPRESS_GREEN: '#234F32',       // Selvi ağacı zümrüdü
  ERGUVAN_PURPLE: '#8C3B61',      // Boğaz erguvanı
  STOCHASTIC_CORAL: '#D94E34',    // Yüksek varyans (sigma^2) Osmanlı bulut/ateş halesi
  SEBEKE_LATTICE: '#B89040',      // Umdetü'l-Hisâb GNN seyreltme kafesi
};

// Sayısal Three.js Color / Hex yardımcıları
export const MATRAKCI_HEX = Object.fromEntries(
  Object.entries(MATRAKCI_PALETTE).map(([key, val]) => [key, parseInt(val.replace('#', '0x'), 16)])
);
