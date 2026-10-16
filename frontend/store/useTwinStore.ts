// Matrakçı-Twin Veri Sözleşmeleri ve Global Store (TypeScript Definitions)
// 1537 Beyân-ı Menâzil x 2026 Spatial AI

import { HexTazCell } from '../utils/h3HexTazEngine';
import { OdCorridor, GehScreenlineReport } from '../utils/inverseOdSolver';

export type ViewMode = 'matrakci' | 'tactical';
export type SemanticLOD = 'macro' | 'meso' | 'micro';
export type HexMetric = 'total_outflow' | 'total_inflow' | 'mfd_density' | 'geh_error' | 'co2';
export type TimeFilterMode = 'live' | '24h' | '7d';
export type FlowDirection = 'outflow' | 'inflow';

export interface CameraState {
  longitude: number; // Default: 29.0150 (Üsküdar - Kadıköy - Tarihi Yarımada - Galata aksı)
  latitude: number;  // Default: 41.0082
  zoom: number;      // Default: 14.2
  pitch: number;     // Default: 50
  bearing: number;   // Default: -20
}

export interface SumoVehicleTelemetry {
  id: string;
  type: 'vrp_van' | 'iett_bus' | 'civil_car' | 'bosphorus_ferry';
  edgeId: string;
  laneIndex: number;
  lanePos: number;        // Şerit başlangıcından itibaren metre (0..edgeLength)
  edgeLength: number;     // Toplam şerit uzunluğu (m)
  speed: number;          // m/s
  slopeAngle: number;     // Radyan (Copernicus DEM eğimi)
  batterySoc?: number;    // % (EV Rejeneratif frenleme takibi)
  cargo3D?: {
    volumeFillPct: number; // % (ör. 91.4)
    weightFillPct: number; // % (ör. 86.0)
    lifoCompliant: boolean;
    packages: Array<{ id: string; dims: [number, number, number]; pos: [number, number, number]; seqOrder: number }>;
  };
  slaConfidence?: number; // % (Fenton-Wilkinson şans kısıtı başarımı, ör. 96.4)
}

export interface RoadEdgeData {
  edgeId: string;
  name: string;
  numLanes: number;
  rawCoords: Array<[number, number, number]>; // [x, y, elevation]
  muTravelTime: number;      // ST-GNN beklenen süre (sn)
  sigmaVariance: number;     // ST-GNN belirsizlik/kaos varyansı
  gnnKeepProb: number;       // Umdetü'l-Hisâb Şebeke budama olasılığı [0..1]
  isOptimalVrpRoute: boolean;
  isBlockedByAccident: boolean;
}

export interface TwinStoreState {
  viewMode: ViewMode;
  semanticLod: SemanticLOD;
  camera: CameraState;
  showSebekeGrid: boolean;       // Umdetü'l-Hisâb GNN budama kafesi görünürlüğü
  polyfocalBendStrength: number; // 0.0 (Düz) .. 1.0 (Matrakçı Polifokal Minyatür Eğimi, Default: 0.75)
  chaosScenarioActive: boolean;  // Agentic "What-If" kaza simülasyonu durumu
  selectedVehicleId: string | null;
  tributeModalOpen: boolean;
  vehicles: SumoVehicleTelemetry[];
  roads: RoadEdgeData[];

  // H3 TAZ & Inverse OD Analytics
  hexGridVisible: boolean;
  hexMetric: HexMetric;
  selectedHexId: string | null;
  timeFilterMode: TimeFilterMode;
  selectedHour: number;          // 0..23
  flowDirection: FlowDirection;
  activeTazCells: HexTazCell[];
  activeCorridors: OdCorridor[];
  gehValidation: GehScreenlineReport | null;
  drawerOpen: boolean;

  // Actions
  setViewMode: (mode: ViewMode) => void;
  setCamera: (cam: Partial<CameraState>) => void;
  toggleSebekeGrid: () => void;
  triggerChaosScenario: () => void;
  selectVehicle: (id: string | null) => void;
  setTributeModalOpen: (open: boolean) => void;
  selectHexCell: (hexId: string | null) => void;
  setHexMetric: (metric: HexMetric) => void;
  setTimeFilterMode: (mode: TimeFilterMode) => void;
  setSelectedHour: (hour: number) => void;
  setFlowDirection: (dir: FlowDirection) => void;
  toggleDrawer: (open?: boolean) => void;
}

export { twinStore } from '../../src/matrakci/twinStore.js';
