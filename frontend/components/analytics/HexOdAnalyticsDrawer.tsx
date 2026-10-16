import React, { useState } from 'react';
import { HexTazCell } from '../../utils/h3HexTazEngine';
import { OdCorridor, GehScreenlineReport } from '../../utils/inverseOdSolver';
import { TimeFilterMode, FlowDirection } from '../../store/useTwinStore';

interface HexOdAnalyticsDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  selectedTaz: HexTazCell | null;
  corridors: OdCorridor[];
  gehReport: GehScreenlineReport | null;
  timeFilterMode: TimeFilterMode;
  onTimeFilterChange: (mode: TimeFilterMode) => void;
  selectedHour: number;
  onHourChange: (hour: number) => void;
  flowDirection: FlowDirection;
  onFlowDirectionChange: (dir: FlowDirection) => void;
  onSelectCorridor?: (corridor: OdCorridor) => void;
  onTriggerChaos: () => void;
  chaosActive: boolean;
}

export const HexOdAnalyticsDrawer: React.FC<HexOdAnalyticsDrawerProps> = ({
  isOpen,
  onClose,
  selectedTaz,
  corridors,
  gehReport,
  timeFilterMode,
  onTimeFilterChange,
  selectedHour,
  onHourChange,
  flowDirection,
  onFlowDirectionChange,
  onSelectCorridor,
  onTriggerChaos,
  chaosActive,
}) => {
  if (!isOpen) return null;

  // Filter top 10 corridors based on flow direction and selected TAZ
  const activeCorridors = selectedTaz
    ? corridors
        .filter((c) =>
          flowDirection === 'outflow' ? c.originId === selectedTaz.id : c.destId === selectedTaz.id
        )
        .sort((a, b) => b.tripsPerHour - a.tripsPerHour)
        .slice(0, 10)
    : corridors.slice(0, 10);

  // MFD Status badge styling
  const getMfdBadge = (state?: string) => {
    switch (state) {
      case 'FREE_FLOW':
        return <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">Serbest Akış (Free-Flow)</span>;
      case 'CRITICAL':
        return <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-amber-500/20 text-amber-400 border border-amber-500/30">Kritik Kapasite</span>;
      case 'HYPERCONGESTED':
        return <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-rose-500/20 text-rose-400 border border-rose-500/30 animate-pulse">Aşırı Yoğun (Gridlock)</span>;
      default:
        return <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-slate-700 text-slate-300">Bilinmiyor</span>;
    }
  };

  return (
    <div className="fixed top-12 right-0 bottom-0 w-[480px] z-40 bg-slate-950/95 backdrop-blur-2xl border-l border-slate-800 shadow-2xl flex flex-col text-slate-100 font-sans transition-all duration-300 animate-slideLeft">
      {/* DRAWER HEADER */}
      <div className="p-4 border-b border-slate-800 flex items-start justify-between bg-slate-900/50">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className="text-sky-400 text-lg">⬡</span>
            <h2 className="text-base font-bold text-white tracking-wide">
              {selectedTaz ? selectedTaz.name : 'Tüm Şehir (Aggregated TAZ)'}
            </h2>
          </div>
          <div className="flex items-center gap-2 text-xs text-slate-400">
            <span>Bölge: <strong className="text-slate-200">{selectedTaz?.district || 'Metropol'}</strong></span>
            <span>•</span>
            <span>H3: <code className="text-sky-400 font-mono">{selectedTaz ? selectedTaz.id.slice(0, 12) : '36 TAZ Hubs'}</code></span>
          </div>
        </div>

        <button
          onClick={onClose}
          className="text-slate-400 hover:text-white p-1 rounded-lg hover:bg-slate-800 transition-colors"
          title="Kapat"
        >
          ✕
        </button>
      </div>

      {/* RETROSPECTIVE TIME CONTROLS & DIRECTION */}
      <div className="px-4 py-3 border-b border-slate-800 bg-slate-900/30 flex flex-col gap-2.5">
        <div className="flex items-center justify-between text-xs">
          <span className="text-slate-400 font-medium">Zaman Pencereleri:</span>
          <div className="flex items-center bg-slate-900 p-0.5 rounded-lg border border-slate-800">
            <button
              onClick={() => onTimeFilterChange('live')}
              className={`px-2 py-1 rounded text-xs transition-all ${
                timeFilterMode === 'live' ? 'bg-emerald-500/20 text-emerald-300 font-semibold' : 'text-slate-400 hover:text-white'
              }`}
            >
              ⚡ Canlı
            </button>
            <button
              onClick={() => onTimeFilterChange('24h')}
              className={`px-2 py-1 rounded text-xs transition-all ${
                timeFilterMode === '24h' ? 'bg-sky-500/20 text-sky-300 font-semibold' : 'text-slate-400 hover:text-white'
              }`}
            >
              Son 24 Saat
            </button>
            <button
              onClick={() => onTimeFilterChange('7d')}
              className={`px-2 py-1 rounded text-xs transition-all ${
                timeFilterMode === '7d' ? 'bg-purple-500/20 text-purple-300 font-semibold' : 'text-slate-400 hover:text-white'
              }`}
            >
              Son 7 Gün
            </button>
          </div>
        </div>

        {/* 24h Slider if 24h active */}
        {timeFilterMode === '24h' && (
          <div className="flex items-center gap-3 bg-slate-950/60 p-2 rounded-lg border border-slate-800/80">
            <span className="text-xs text-slate-400">Saat Dilimi:</span>
            <input
              type="range"
              min={0}
              max={23}
              value={selectedHour}
              onChange={(e) => onHourChange(Number(e.target.value))}
              className="flex-1 accent-sky-400 cursor-pointer"
            />
            <span className="font-mono text-xs font-bold text-sky-300 w-12 text-right">
              {String(selectedHour).padStart(2, '0')}:00
            </span>
          </div>
        )}

        {/* Flow Direction Toggle */}
        <div className="flex items-center justify-between pt-1">
          <div className="flex items-center gap-2">
            <button
              onClick={() => onFlowDirectionChange('outflow')}
              className={`px-3 py-1 rounded-lg text-xs font-medium transition-all ${
                flowDirection === 'outflow'
                  ? 'bg-sky-500/20 text-sky-300 border border-sky-500/40 shadow-sm'
                  : 'bg-slate-900 text-slate-400 hover:text-white'
              }`}
            >
              📤 Giden Akışlar (O_i)
            </button>
            <button
              onClick={() => onFlowDirectionChange('inflow')}
              className={`px-3 py-1 rounded-lg text-xs font-medium transition-all ${
                flowDirection === 'inflow'
                  ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40 shadow-sm'
                  : 'bg-slate-900 text-slate-400 hover:text-white'
              }`}
            >
              📥 Gelen Akışlar (A_j)
            </button>
          </div>

          {/* MFD Badge */}
          <div>{getMfdBadge(selectedTaz?.mfdState)}</div>
        </div>
      </div>

      {/* SCROLLABLE MAIN ANALYTICS BODY */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4 custom-scrollbar">
        {/* KPI OVERVIEW GRID */}
        <div className="grid grid-cols-3 gap-2">
          <div className="bg-slate-900/60 p-2.5 rounded-xl border border-slate-800">
            <span className="text-[10px] text-slate-400 uppercase tracking-wider block">Toplam Akış</span>
            <span className="text-base font-bold text-white font-mono">
              {selectedTaz
                ? (flowDirection === 'outflow' ? selectedTaz.productionO : selectedTaz.attractionA).toLocaleString()
                : '34.520'}
            </span>
            <span className="text-[10px] text-slate-400 block">araç/saat</span>
          </div>

          <div className="bg-slate-900/60 p-2.5 rounded-xl border border-slate-800">
            <span className="text-[10px] text-slate-400 uppercase tracking-wider block">GEH Uyumu</span>
            <span className="text-base font-bold text-emerald-400 font-mono">
              {gehReport ? `%${gehReport.screenlinesUnder5Pct}` : '%94.2'}
            </span>
            <span className="text-[10px] text-emerald-400 block">GEH &lt; 5.0 Onaylı</span>
          </div>

          <div className="bg-slate-900/60 p-2.5 rounded-xl border border-slate-800">
            <span className="text-[10px] text-slate-400 uppercase tracking-wider block">CO2 Emisyonu</span>
            <span className="text-base font-bold text-cyan-400 font-mono">
              {selectedTaz ? selectedTaz.co2GPerKm : 185.4}
            </span>
            <span className="text-[10px] text-slate-400 block">g/araç-km</span>
          </div>
        </div>

        {/* TOP-10 OD CORRIDORS TABLE */}
        <div className="bg-slate-900/70 rounded-xl border border-slate-800 overflow-hidden shadow-lg">
          <div className="px-3 py-2 border-b border-slate-800 bg-slate-900 flex items-center justify-between">
            <h3 className="text-xs font-semibold text-slate-200">
              Top-10 Arzu Koridoru ({flowDirection === 'outflow' ? 'Hedefler' : 'Kaynaklar'})
            </h3>
            <span className="text-[10px] text-slate-400">Hacim Sıralı</span>
          </div>

          <div className="overflow-x-auto max-h-56">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="border-b border-slate-800/80 text-[10px] text-slate-400 bg-slate-950/40">
                  <th className="py-1.5 px-2">Koridor</th>
                  <th className="py-1.5 px-2 text-right">Hacim</th>
                  <th className="py-1.5 px-2">Mod Dağılımı</th>
                  <th className="py-1.5 px-2 text-right">Süre (Dk)</th>
                  <th className="py-1.5 px-2 text-right">Maliyet (TL)</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/40 font-mono">
                {activeCorridors.map((corridor, idx) => {
                  const targetName =
                    flowDirection === 'outflow' ? corridor.destName : corridor.originName;
                  return (
                    <tr
                      key={idx}
                      onClick={() => onSelectCorridor && onSelectCorridor(corridor)}
                      className="hover:bg-sky-500/10 cursor-pointer transition-colors group"
                    >
                      <td className="py-2 px-2 font-sans font-medium text-slate-200 group-hover:text-sky-300 truncate max-w-[120px]">
                        {targetName.replace(' TAZ', '')}
                      </td>
                      <td className="py-2 px-2 text-right font-bold text-white">
                        {corridor.tripsPerHour}
                      </td>
                      <td className="py-2 px-2">
                        {/* 3-Color Modal Split Bar */}
                        <div className="w-16 h-2 bg-slate-800 rounded-full flex overflow-hidden">
                          <div
                            style={{ width: `${corridor.modalSplit.privateCarPct}%` }}
                            className="bg-sky-400 h-full"
                            title={`Özel Araç: %${corridor.modalSplit.privateCarPct}`}
                          />
                          <div
                            style={{ width: `${corridor.modalSplit.gtfsTransitPct}%` }}
                            className="bg-emerald-400 h-full"
                            title={`Toplu Taşıma: %${corridor.modalSplit.gtfsTransitPct}`}
                          />
                          <div
                            style={{ width: `${corridor.modalSplit.vrpFreightPct}%` }}
                            className="bg-amber-400 h-full"
                            title={`VRP Lojistik: %${corridor.modalSplit.vrpFreightPct}`}
                          />
                        </div>
                      </td>
                      <td className="py-2 px-2 text-right text-slate-300">
                        {corridor.congestedMinutes} dk
                      </td>
                      <td className="py-2 px-2 text-right text-cyan-300 font-semibold">
                        ₺{corridor.zTotalCostTL.toLocaleString()}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

        {/* 24-HOUR DIURNAL DEMAND CURVE (SVG) */}
        <div className="bg-slate-900/60 p-3 rounded-xl border border-slate-800 space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-200">24 Saatlik Diurnal Talep Profili D_ij(t)</span>
            <span className="text-[10px] text-sky-400 font-mono">Pik Saat: 08:30 & 18:00</span>
          </div>

          <div className="w-full h-24 bg-slate-950/80 rounded-lg p-1 border border-slate-800/80 relative">
            <svg viewBox="0 0 240 70" className="w-full h-full overflow-visible">
              {/* Grid Lines */}
              <line x1="0" y1="65" x2="240" y2="65" stroke="#334155" strokeWidth="0.5" />
              <line x1="0" y1="35" x2="240" y2="35" stroke="#334155" strokeWidth="0.5" strokeDasharray="2" />
              <line x1="0" y1="5" x2="240" y2="5" stroke="#334155" strokeWidth="0.5" strokeDasharray="2" />

              {/* Demand Area & Curve */}
              <path
                d="M 0 62 Q 40 60, 60 55 T 80 15 T 100 28 T 140 32 T 180 12 T 210 40 T 240 60 L 240 65 L 0 65 Z"
                fill="url(#demandGradient)"
              />
              <path
                d="M 0 62 Q 40 60, 60 55 T 80 15 T 100 28 T 140 32 T 180 12 T 210 40 T 240 60"
                fill="none"
                stroke="#38bdf8"
                strokeWidth="2"
              />

              {/* Current Hour Indicator Marker */}
              <line
                x1={selectedHour * 10}
                y1="0"
                x2={selectedHour * 10}
                y2="65"
                stroke="#f43f5e"
                strokeWidth="1.5"
                strokeDasharray="2"
              />
              <circle cx={selectedHour * 10} cy="20" r="3" fill="#f43f5e" />

              <defs>
                <linearGradient id="demandGradient" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#38bdf8" stopOpacity="0.4" />
                  <stop offset="100%" stopColor="#38bdf8" stopOpacity="0.0" />
                </linearGradient>
              </defs>
            </svg>
          </div>
          <div className="flex justify-between text-[9px] text-slate-500 font-mono px-1">
            <span>00:00</span>
            <span>06:00</span>
            <span>12:00</span>
            <span>18:00</span>
            <span>23:00</span>
          </div>
        </div>

        {/* MFD PARABOLIC DIAGRAM (q-k) */}
        <div className="bg-slate-900/60 p-3 rounded-xl border border-slate-800 space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-200">Makroskopik Temel Diyagram (MFD q-k)</span>
            <span className="text-[10px] text-amber-300 font-mono">Geroliminis & Daganzo</span>
          </div>

          <div className="w-full h-24 bg-slate-950/80 rounded-lg p-1 border border-slate-800/80 relative">
            <svg viewBox="0 0 240 70" className="w-full h-full overflow-visible">
              <line x1="15" y1="65" x2="235" y2="65" stroke="#334155" strokeWidth="0.5" />
              <line x1="15" y1="5" x2="15" y2="65" stroke="#334155" strokeWidth="0.5" />

              {/* Parabolic MFD Greenshields curve */}
              <path
                d="M 15 65 Q 110 5, 225 65"
                fill="none"
                stroke="#10b981"
                strokeWidth="2"
              />

              {/* Operating Point */}
              {(() => {
                const k = selectedTaz ? selectedTaz.densityVehKm : 45.0;
                const normK = Math.min(1.0, k / 140.0);
                const cx = 15 + normK * 210;
                const cy = 65 - 4.0 * normK * (1.0 - normK) * 55;
                return (
                  <g>
                    <circle cx={cx} cy={cy} r="4" fill="#fbbf24" stroke="#ffffff" strokeWidth="1" />
                    <text x={cx + 6} y={cy - 4} fill="#fbbf24" fontSize="8" fontFamily="monospace">
                      k={k.toFixed(0)}
                    </text>
                  </g>
                );
              })()}
            </svg>
          </div>
          <div className="flex justify-between text-[9px] text-slate-500 font-mono px-1">
            <span>k=0 (Serbest)</span>
            <span className="text-emerald-400">k_c=45 (Kapasite)</span>
            <span className="text-rose-400">k_j=140 (Tıkanma)</span>
          </div>
        </div>

        {/* 10x WHAT-IF SHOCKWAVE CHAOS ACTUATION */}
        <div className="pt-2">
          <button
            onClick={onTriggerChaos}
            className={`w-full py-3 rounded-xl font-bold text-xs uppercase tracking-wider flex items-center justify-center gap-2 transition-all shadow-xl ${
              chaosActive
                ? 'bg-rose-600 hover:bg-rose-500 text-white shadow-rose-600/50 animate-pulse'
                : 'bg-gradient-to-r from-rose-900/60 to-red-800/60 border border-rose-500/40 text-rose-300 hover:bg-rose-900/80'
            }`}
          >
            <span>💥</span>
            <span>
              {chaosActive
                ? 'Aktif Kaos Şok Dalgasını Sonlandır'
                : '10x Koridor Kaosu ve Şok Dalgası Tetikle (What-If)'}
            </span>
          </button>
          <p className="text-[10px] text-slate-400 text-center mt-1.5">
            LWR kinematik şok dalgası w_AB yayılımı, VRP LIFO rota onarımı ve dinamik maliyet patlamasını simüle eder.
          </p>
        </div>
      </div>
    </div>
  );
};
