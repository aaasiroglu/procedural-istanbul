import React from 'react';
import { OdCorridor } from '../../utils/inverseOdSolver';

interface OdFlowArcsLayerProps {
  corridors: OdCorridor[];
  selectedHexId: string | null;
  flowDirection: 'outflow' | 'inflow';
  maxArcs?: number;
}

export const OdFlowArcsLayer: React.FC<OdFlowArcsLayerProps> = ({
  corridors,
  selectedHexId,
  flowDirection,
  maxArcs = 10,
}) => {
  if (!selectedHexId) return null;

  // Filter corridors connected to the selected hex
  const activeCorridors = corridors
    .filter((c) => (flowDirection === 'outflow' ? c.originId === selectedHexId : c.destId === selectedHexId))
    .sort((a, b) => b.tripsPerHour - a.tripsPerHour)
    .slice(0, maxArcs);

  return (
    <div className="pointer-events-none absolute bottom-4 left-6 z-10 bg-slate-950/85 backdrop-blur-md px-3 py-2 rounded-xl border border-slate-800 text-xs text-slate-300 shadow-xl">
      <div className="flex items-center gap-2">
        <span className="w-2.5 h-2.5 rounded-full bg-cyan-400 animate-ping" />
        <span className="font-semibold text-white">
          Aktif 3B Arzu Eğrileri ({flowDirection === 'outflow' ? 'Giden Akışlar' : 'Gelen Akışlar'}):
        </span>
        <span className="font-mono text-cyan-400 font-bold">{activeCorridors.length} Koridor</span>
      </div>
    </div>
  );
};
