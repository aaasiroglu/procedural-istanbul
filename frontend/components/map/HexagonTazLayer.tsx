import React, { useMemo } from 'react';
import * as THREE from 'three';
import { HexTazCell } from '../../utils/h3HexTazEngine';
import { HexMetric } from '../../store/useTwinStore';

interface HexagonTazLayerProps {
  tazCells: HexTazCell[];
  activeMetric: HexMetric;
  selectedHexId: string | null;
  onSelectHex: (hexId: string) => void;
  projectCoords: (lon: number, lat: number) => [number, number]; // [x, z] in Three scene
}

export const HexagonTazLayer: React.FC<HexagonTazLayerProps> = ({
  tazCells,
  activeMetric,
  selectedHexId,
  onSelectHex,
  projectCoords,
}) => {
  // Color palette interpolation based on value
  const getHexColor = (valNorm: number, metric: HexMetric): THREE.Color => {
    const clamped = Math.max(0, Math.min(1, valNorm));
    if (metric === 'mfd_density' || metric === 'geh_error') {
      // Green (optimal) -> Amber (warning) -> Crimson (hypercongested/error)
      if (clamped < 0.5) {
        return new THREE.Color().lerpColors(
          new THREE.Color(0x10b981), // Emerald
          new THREE.Color(0xf59e0b), // Amber
          clamped * 2.0
        );
      } else {
        return new THREE.Color().lerpColors(
          new THREE.Color(0xf59e0b), // Amber
          new THREE.Color(0xef4444), // Red
          (clamped - 0.5) * 2.0
        );
      }
    } else if (metric === 'co2') {
      // Cyan -> Orange -> Purple
      return new THREE.Color().lerpColors(
        new THREE.Color(0x06b6d4),
        new THREE.Color(0xec4899),
        clamped
      );
    } else {
      // Flow metrics: Blue -> Sky -> Neon Cyan
      return new THREE.Color().lerpColors(
        new THREE.Color(0x1e3a8a),
        new THREE.Color(0x38bdf8),
        clamped
      );
    }
  };

  const hexMeshes = useMemo(() => {
    // Determine metric min/max bounds for normalization
    let maxVal = 1;
    tazCells.forEach((c) => {
      let v = 0;
      if (activeMetric === 'total_outflow') v = c.productionO;
      else if (activeMetric === 'total_inflow') v = c.attractionA;
      else if (activeMetric === 'mfd_density') v = c.densityVehKm;
      else if (activeMetric === 'geh_error') v = c.gehError;
      else if (activeMetric === 'co2') v = c.co2GPerKm;
      if (v > maxVal) maxVal = v;
    });

    return tazCells.map((cell) => {
      const [cx, cz] = projectCoords(cell.lon, cell.lat);
      let metricVal = 0;
      if (activeMetric === 'total_outflow') metricVal = cell.productionO;
      else if (activeMetric === 'total_inflow') metricVal = cell.attractionA;
      else if (activeMetric === 'mfd_density') metricVal = cell.densityVehKm;
      else if (activeMetric === 'geh_error') metricVal = cell.gehError;
      else if (activeMetric === 'co2') metricVal = cell.co2GPerKm;

      const norm = metricVal / maxVal;
      const height = Math.max(12, norm * 140);
      const isSelected = cell.id === selectedHexId;
      const color = getHexColor(norm, activeMetric);

      return {
        cell,
        cx,
        cz,
        height,
        isSelected,
        colorHex: isSelected ? '#38bdf8' : '#' + color.getHexString(),
      };
    });
  }, [tazCells, activeMetric, selectedHexId, projectCoords]);

  return (
    <div className="pointer-events-none absolute inset-0 z-10">
      {/* 2D/3D Label overlay for selected TAZ */}
      {selectedHexId && (
        <div className="absolute top-16 left-6 pointer-events-auto bg-slate-900/90 backdrop-blur-md p-3 rounded-xl border border-sky-500/40 shadow-xl max-w-xs text-xs text-slate-200 animate-fadeIn">
          <div className="flex items-center justify-between pb-2 mb-2 border-b border-slate-800">
            <span className="font-semibold text-sky-400">Seçili H3 TAZ</span>
            <span className="px-1.5 py-0.5 rounded bg-sky-950 text-sky-300 font-mono text-[10px]">
              {selectedHexId.slice(0, 10)}...
            </span>
          </div>
          {(() => {
            const current = tazCells.find((c) => c.id === selectedHexId);
            if (!current) return null;
            return (
              <div className="space-y-1">
                <p className="font-medium text-white">{current.name}</p>
                <div className="grid grid-cols-2 gap-1 pt-1 text-[11px]">
                  <div>Nüfus: <span className="font-mono text-slate-300">{current.population.toLocaleString()}</span></div>
                  <div>Oto Sahipliği: <span className="font-mono text-slate-300">%{Math.round(current.autoOwnershipRate * 100)}</span></div>
                  <div>Üretim (O_i): <span className="font-mono text-emerald-400">{current.productionO} yolculuk/sa</span></div>
                  <div>Çekim (A_j): <span className="font-mono text-sky-400">{current.attractionA} yolculuk/sa</span></div>
                  <div>MFD Durumu: <span className="font-mono text-amber-300">{current.mfdState}</span></div>
                  <div>GEH Skoru: <span className="font-mono text-cyan-300">{current.gehError}</span></div>
                </div>
              </div>
            );
          })()}
        </div>
      )}
    </div>
  );
};
