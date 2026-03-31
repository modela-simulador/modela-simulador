import type { Feature, Polygon, MultiPolygon, FeatureCollection, Geometry } from "geojson";

export interface MacroloteProperties {
  fid: string;
  Area: number; // m2
  [key: string]: unknown;
}

export type MacroloteFeature = Feature<Polygon | MultiPolygon, MacroloteProperties>;

export interface ProductAllocation {
  familyId: string;
  productId: string;
  percentage: number;
  lotSizeM2?: number; // for comercio/equipamiento
}

export interface SubdivisionRequest {
  macroloteGeometry: object;
  greenAreas: object[];
  perimeterRoads: object[];
  productAllocations: ProductAllocation[];
}

export interface LotResult {
  geometry: Geometry;
  product: string;
  areaM2: number;
  units: number;
  frontageM: number;
}

export interface StreetResult {
  geometry: Geometry;
  areaM2: number;
}

export interface ParkResult {
  geometry: Geometry;
  areaM2: number;
}

export interface SubdivisionResult {
  streets: StreetResult[];
  lots: LotResult[];
  parks: ParkResult[];
  metrics: {
    totalLots: number;
    totalUnits: number;
    unitsByProduct: Record<string, number>;
    streetAreaM2: number;
    parkAreaM2: number;
    efficiencyPct: number;
    densityPerHa: number;
    totalValueUF: number;
    valueByProduct: Record<string, number>;
    // Infrastructure costs from API (internal streets + parks from subdivision)
    streetCostUF: number;
    greenCostUF: number;
    landCostUF: number;
    totalCostUF: number;
    netValueUF: number;
    macroAreaM2: number;
  };
}

/** A single cabida iteration — keyed by the FIDs that were used */
export interface CabidaEntry {
  id: string; // comma-joined sorted FIDs
  fids: string[];
  result: SubdivisionResult;
}

/** Multi-element selection for business analysis */
export interface BusinessSelection {
  lotIndices: number[];
  /** Structural road fids from vial-nuevo.geojson */
  structuralStreetFids: number[];
  /** Central green area fids from areas-verdes.geojson */
  greenAreaFids: number[];
}

/** A structural infrastructure element (road or green area from base GeoJSON) */
export interface StructuralFeature {
  fid: number;
  areaM2: number;
}

/** Infrastructure cost constants */
export const INFRA_COSTS = {
  landUFm2: 0.19,        // costo de la tierra
  streetUFm2: 4.5,       // costo vialidad
  greenUFm2: 1.5,        // costo área verde
  streetShareFactor: 0.5, // cada negocio carga mitad del frente
} as const;

export interface AppState {
  selectedMacrolote: MacroloteFeature | null;
  productMix: ProductAllocation[];
  subdivision: SubdivisionResult | null;
  isGenerating: boolean;
  editMode: boolean;
}
