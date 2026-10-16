import React from 'react';
import { ViewMode, HexMetric, TimeFilterMode } from '../../store/useTwinStore';

interface TopCommandBarProps {
  viewMode: ViewMode;
  onViewModeChange: (mode: ViewMode) => void;
  hexGridVisible: boolean;
  onToggleHexGrid: () => void;
  activeMetric: HexMetric;
  onMetricChange: (metric: HexMetric) => void;
  timeFilterMode: TimeFilterMode;
  onTimeFilterChange: (mode: TimeFilterMode) => void;
  selectedHour: number;
  onHourChange: (hour: number) => void;
  onOpenDrawer: () => void;
  onTriggerChaos: () => void;
  chaosActive: boolean;
}

export const TopCommandBar: React.FC<TopCommandBarProps> = ({
  viewMode,
  onViewModeChange,
  hexGridVisible,
  onToggleHexGrid,
  activeMetric,
  onMetricChange,
  timeFilterMode,
  onTimeFilterChange,
  selectedHour,
  onHourChange,
  onOpenDrawer,
  onTriggerChaos,
  chaosActive,
}) => {
  return (
    <header className="fixed top-0 left-0 right-0 z-50 flex items-center justify-between px-4 py-2.5 bg-slate-950/90 backdrop-blur-md border-b border-slate-800 text-white font-sans shadow-2xl">
      {/* Brand & Project Identity */}
      <div className="flex items-center gap-3">
        <div className="flex items-center justify-center w-9 h-9 rounded-lg bg-sky-500/20 border border-sky-400/40 text-sky-400 font-bold text-lg shadow-inner">
          ⬡
        </div>
        <div>
          <h1 className="text-sm font-semibold tracking-wider text-slate-100 uppercase">
            Geo-Twin İstanbul <span className="text-sky-400">Tactical HD</span>
          </h1>
          <p className="text-xs text-slate-400">H3 TAZ & Bilevel Tersine OD Akış Analitiği</p>
        </div>
      </div>

      {/* Dual View Toggle & TAZ Metric Controls */}
      <div className="flex items-center gap-2 bg-slate-900/80 p-1 rounded-xl border border-slate-800">
        <button
          onClick={() => onViewModeChange('matrakci')}
          className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
            viewMode === 'matrakci'
              ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40 shadow-sm'
              : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          🎨 Matrakçı & Metro
        </button>
        <button
          onClick={() => onViewModeChange('tactical')}
          className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
            viewMode === 'tactical'
              ? 'bg-sky-500/20 text-sky-300 border border-sky-500/40 shadow-sm'
              : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          🛰️ Taktiksel HD
        </button>

        <div className="w-px h-5 bg-slate-700 mx-1" />

        {/* Hex Grid Toggle */}
        <button
          onClick={onToggleHexGrid}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
            hexGridVisible
              ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/40'
              : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          <span>⬢</span>
          <span>{hexGridVisible ? 'TAZ Izgarası: Açık' : 'TAZ Izgarası: Kapalı'}</span>
        </button>

        {/* Metric Selector */}
        {hexGridVisible && (
          <select
            value={activeMetric}
            onChange={(e) => onMetricChange(e.target.value as HexMetric)}
            className="bg-slate-800 text-xs text-slate-200 px-2 py-1.5 rounded-lg border border-slate-700 focus:outline-none focus:border-sky-500"
          >
            <option value="total_outflow">📤 Üretim (Giden Akış O_i)</option>
            <option value="total_inflow">📥 Çekim (Gelen Akış A_j)</option>
            <option value="mfd_density">🚦 MFD Trafik Yoğunluğu (k_i)</option>
            <option value="geh_error">🎯 GEH Kalibrasyon Skoru</option>
            <option value="co2">🌱 COPERT 5.9 CO2 Emisyonu</option>
          </select>
        )}
      </div>

      {/* Retrospective Time Controls & Actions */}
      <div className="flex items-center gap-3">
        {/* Time Mode Chips */}
        <div className="flex items-center bg-slate-900/80 rounded-lg p-0.5 border border-slate-800 text-xs">
          <button
            onClick={() => onTimeFilterChange('live')}
            className={`px-2.5 py-1 rounded-md transition-all ${
              timeFilterMode === 'live' ? 'bg-emerald-500/20 text-emerald-300 font-medium' : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            ⚡ Canlı
          </button>
          <button
            onClick={() => onTimeFilterChange('24h')}
            className={`px-2.5 py-1 rounded-md transition-all ${
              timeFilterMode === '24h' ? 'bg-sky-500/20 text-sky-300 font-medium' : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            Son 24 Saat
          </button>
          <button
            onClick={() => onTimeFilterChange('7d')}
            className={`px-2.5 py-1 rounded-md transition-all ${
              timeFilterMode === '7d' ? 'bg-purple-500/20 text-purple-300 font-medium' : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            Son 7 Gün
          </button>
        </div>

        {/* 24-Hour Slider */}
        {timeFilterMode === '24h' && (
          <div className="flex items-center gap-2 bg-slate-900/80 px-2 py-1 rounded-lg border border-slate-800 text-xs">
            <span className="text-slate-400">Saat:</span>
            <input
              type="range"
              min={0}
              max={23}
              value={selectedHour}
              onChange={(e) => onHourChange(Number(e.target.value))}
              className="w-20 accent-sky-400 cursor-pointer"
            />
            <span className="text-sky-300 font-mono font-medium">{String(selectedHour).padStart(2, '0')}:00</span>
          </div>
        )}

        {/* What-If Chaos Button */}
        <button
          onClick={onTriggerChaos}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold tracking-wide transition-all ${
            chaosActive
              ? 'bg-rose-500 text-white shadow-lg shadow-rose-500/40 animate-pulse'
              : 'bg-rose-500/10 text-rose-400 border border-rose-500/30 hover:bg-rose-500/20'
          }`}
        >
          <span>💥</span>
          <span>{chaosActive ? 'Kaos Aktif' : '10x Kaos Testi'}</span>
        </button>

        {/* Analytics Drawer Toggle */}
        <button
          onClick={onOpenDrawer}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-sky-600 hover:bg-sky-500 text-white text-xs font-medium shadow-md transition-all"
        >
          <span>📊</span>
          <span>OD Analitiği</span>
        </button>
      </div>
    </header>
  );
};
