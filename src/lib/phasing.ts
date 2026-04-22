/**
 * Phasing engine — computes development wave order and financial timeline.
 *
 * Multi-cabida: merges lots/streets from all cabida entries with global indices.
 * BFS from user-selected streets: lots adjacent to selected streets form wave 0,
 * lots adjacent to wave 0 form wave 1, and so on.
 *
 * Per-district timing: AUDP starts 2029, PDUC starts 2033. Each district's waves
 * advance independently, then merge chronologically for the final timeline.
 *
 * Industrial lots (Ciudad Logística) valued at 4.5 UF/m².
 */
import * as turf from "@turf/turf";
import type { Geometry } from "geojson";
import type { SubdivisionResult, LotResult, StreetResult, ParkResult, CabidaEntry } from "@/lib/types";
import { PRODUCTS, DISTRICTS, getDistrictForFid, type DistrictDef } from "@/lib/constants";

// ── Types ────────────────────────────────────────────────────

export interface PhasingState {
  isActive: boolean;
  /** Global street indices (across all cabida entries) — internal cabida streets */
  selectedStreetIndices: number[];
  /** Structural road FIDs selected as starting points */
  selectedStructuralFids: number[];
  /** Structural road geometries (for BFS adjacency) */
  structuralGeometries: Geometry[];
  /** Computed waves: waves[i] = global lot indices in phase i */
  waves: number[][];
  /** Current visible wave (-1 = none, 0 = first wave, etc.) */
  currentWave: number;
  isPlaying: boolean;
  /** Playback speed multiplier */
  speed: number;
  /** Financial snapshot per wave (accumulated) */
  timeline: PhasingYearData[];
  /** Cached merged data for the current phasing session */
  mergedData: MergedCabidaData | null;
  /** Maps street globalIndex → wave number when it lights up */
  streetWaveMap: Record<number, number>;
  /** Maps park globalIndex → wave number when it lights up */
  parkWaveMap: Record<number, number>;
}

export interface PhasingYearData {
  wave: number;
  year: number;
  /** Global lot indices developed in this phase */
  lotIndices: number[];
  /** Income from this phase's lots (UF) */
  waveIncome: number;
  /** Cost from this phase's lots (UF) */
  waveCost: number;
  /** Accumulated income up to and including this phase */
  accIncome: number;
  /** Accumulated cost up to and including this phase */
  accCost: number;
  /** Accumulated net (income - cost) */
  accNet: number;
  /** Units developed in this phase */
  waveUnits: number;
  /** Accumulated units */
  accUnits: number;
}

/** A lot with global index and district info */
export interface MergedLot {
  globalIndex: number;
  cabidaId: string;
  localIndex: number;
  lot: LotResult;
  districtId: string;
  startYear: number; // district-based: AUDP=2029, PDUC=2033
  isIndustrial: boolean;
}

/** A street with global index */
export interface MergedStreet {
  globalIndex: number;
  cabidaId: string;
  localIndex: number;
  street: StreetResult;
}

/** A park with global index */
export interface MergedPark {
  globalIndex: number;
  cabidaId: string;
  localIndex: number;
  park: ParkResult;
}

/** Merged data from all cabida entries */
export interface MergedCabidaData {
  lots: MergedLot[];
  streets: MergedStreet[];
  parks: MergedPark[];
  cabidaResults: Map<string, SubdivisionResult>;
}

// ── Development duration per product family (years per phase) ──
const DEV_YEARS: Record<string, number> = {
  casas: 2,
  townhouses: 2,
  ds19: 3,
  edificios: 3,
  comercio: 2,
  equipamiento: 1,
};

/** Start year by district type */
const DISTRICT_START_YEAR: Record<string, number> = {
  // AUDP districts start 2029
  audp_batuco: 2029,
  audp_colina: 2029,
  // PDUC districts start 2033
  distrito_g: 2033,
  distrito_40: 2033,
  ciudad_logistica: 2033,
};

/** Industrial land value UF/m² */
const INDUSTRIAL_LAND_VALUE_UFM2 = 4.5;

// ── Helpers ──────────────────────────────────────────────────

/** Get the product family for a product ID */
function getFamily(productId: string): string {
  return PRODUCTS.find((p) => p.id === productId)?.family ?? "casas";
}

/** Calculate lot income in UF */
function lotIncome(lot: LotResult, districtId: string, isIndustrial: boolean): number {
  const prod = PRODUCTS.find((p) => p.id === lot.product);
  if (!prod) return 0;

  // Industrial lots (Ciudad Logística): 4.5 UF/m²
  if (isIndustrial) return lot.areaM2 * INDUSTRIAL_LAND_VALUE_UFM2;

  // Comercio: area-based value
  if (prod.landValueUFm2 > 0) return lot.areaM2 * prod.landValueUFm2;

  // Residential: units * price * incidencia
  if (prod.priceUF > 0) {
    const incidencia = prod.family === "ds19" ? 0.12 : prod.family === "edificios" ? 0.14 : 0.10;
    return lot.units * prod.priceUF * incidencia;
  }
  return 0;
}

/** Calculate lot cost share (proportional to area within its cabida) */
function lotCostFromResult(lot: LotResult, result: SubdivisionResult): number {
  const m = result.metrics;
  const totalLotArea = result.lots.reduce((s, l) => s + l.areaM2, 0);
  if (totalLotArea <= 0) return 0;
  const share = lot.areaM2 / totalLotArea;
  return share * m.totalCostUF;
}

/**
 * Check if two GeoJSON geometries are adjacent (share boundary).
 * Uses turf buffer + intersect for robustness.
 */
function areAdjacent(geomA: Geometry, geomB: Geometry): boolean {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const featureA = turf.feature(geomA as any);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const featureB = turf.feature(geomB as any);
    const buffered = turf.buffer(featureA, 0.005, { units: "kilometers" }); // 5m buffer
    if (!buffered) return false;
    return turf.booleanIntersects(buffered, featureB);
  } catch {
    return false;
  }
}

// ── Merge cabida entries ────────────────────────────────────

/**
 * Determine start year for a district.
 * AUDP districts start 2029, PDUC/industrial start 2033.
 */
function getStartYear(district: DistrictDef | null): number {
  if (!district) return 2033;
  return DISTRICT_START_YEAR[district.id] ?? 2033;
}

/**
 * Merge lots and streets from all cabida entries into unified arrays
 * with global indices and district metadata.
 */
export function mergeCabidas(cabidaHistory: CabidaEntry[]): MergedCabidaData {
  const lots: MergedLot[] = [];
  const streets: MergedStreet[] = [];
  const parks: MergedPark[] = [];
  const cabidaResults = new Map<string, SubdivisionResult>();

  let globalLotIdx = 0;
  let globalStreetIdx = 0;
  let globalParkIdx = 0;

  for (const entry of cabidaHistory) {
    cabidaResults.set(entry.id, entry.result);

    // Determine district for this cabida's FIDs
    const firstFid = entry.fids[0];
    const district = firstFid ? getDistrictForFid(firstFid) : null;
    const startYear = getStartYear(district);
    const isIndustrial = district?.isIndustrial ?? false;

    for (let i = 0; i < entry.result.lots.length; i++) {
      lots.push({
        globalIndex: globalLotIdx++,
        cabidaId: entry.id,
        localIndex: i,
        lot: entry.result.lots[i],
        districtId: district?.id ?? "unknown",
        startYear,
        isIndustrial,
      });
    }

    for (let i = 0; i < entry.result.streets.length; i++) {
      streets.push({
        globalIndex: globalStreetIdx++,
        cabidaId: entry.id,
        localIndex: i,
        street: entry.result.streets[i],
      });
    }

    for (let i = 0; i < entry.result.parks.length; i++) {
      parks.push({
        globalIndex: globalParkIdx++,
        cabidaId: entry.id,
        localIndex: i,
        park: entry.result.parks[i],
      });
    }
  }

  return { lots, streets, parks, cabidaResults };
}

// ── Core algorithm ──────────────────────────────────────────

/** Max lots per wave — keeps the animation granular and progressive */
const MAX_LOTS_PER_WAVE = 8;

/** Get centroid coordinates of a geometry */
function getCentroid(geom: Geometry): [number, number] {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const c = turf.centroid(turf.feature(geom as any));
    return c.geometry.coordinates as [number, number];
  } catch {
    return [0, 0];
  }
}

/** Euclidean distance between two [lng, lat] points */
function dist2d(a: [number, number], b: [number, number]): number {
  const dx = a[0] - b[0];
  const dy = a[1] - b[1];
  return Math.sqrt(dx * dx + dy * dy);
}

/**
 * Compute development waves via BFS from selected streets.
 * Supports both internal cabida streets (by global index) and
 * structural roads (by raw geometry).
 *
 * Large BFS rings are split into sub-waves of MAX_LOTS_PER_WAVE,
 * ordered by distance from the starting streets (nearest first).
 * This creates a gradual "growing" animation even when a single
 * road touches many lots.
 *
 * Returns array of waves, each containing global lot indices.
 */
export function computeWaves(
  merged: MergedCabidaData,
  selectedStreetGlobalIndices: number[],
  structuralGeometries: Geometry[] = [],
): number[][] {
  const { lots, streets } = merged;
  const hasInternalStreets = selectedStreetGlobalIndices.length > 0;
  const hasStructural = structuralGeometries.length > 0;
  if ((!hasInternalStreets && !hasStructural) || lots.length === 0) return [];

  const selectedStreets = selectedStreetGlobalIndices
    .map((gi) => streets.find((s) => s.globalIndex === gi))
    .filter((s): s is MergedStreet => s != null);

  // Compute origin point (average centroid of all selected streets/roads)
  const originPoints: [number, number][] = [];
  for (const ms of selectedStreets) originPoints.push(getCentroid(ms.street.geometry));
  for (const sg of structuralGeometries) originPoints.push(getCentroid(sg));
  const origin: [number, number] = originPoints.length > 0
    ? [
        originPoints.reduce((s, p) => s + p[0], 0) / originPoints.length,
        originPoints.reduce((s, p) => s + p[1], 0) / originPoints.length,
      ]
    : [0, 0];

  // Pre-compute lot centroids and distances from origin
  const lotCentroids = new Map<number, [number, number]>();
  const lotDistances = new Map<number, number>();
  for (const ml of lots) {
    const c = getCentroid(ml.lot.geometry);
    lotCentroids.set(ml.globalIndex, c);
    lotDistances.set(ml.globalIndex, dist2d(c, origin));
  }

  const assigned = new Set<number>();
  const bfsRings: number[][] = []; // raw BFS rings (may be large)

  // Ring 0: lots adjacent to selected streets (internal + structural)
  const ring0: number[] = [];
  for (const ml of lots) {
    for (const ms of selectedStreets) {
      if (areAdjacent(ml.lot.geometry, ms.street.geometry)) {
        ring0.push(ml.globalIndex);
        assigned.add(ml.globalIndex);
        break;
      }
    }
    if (assigned.has(ml.globalIndex)) continue;
    for (const sg of structuralGeometries) {
      if (areAdjacent(ml.lot.geometry, sg)) {
        ring0.push(ml.globalIndex);
        assigned.add(ml.globalIndex);
        break;
      }
    }
  }

  if (ring0.length > 0) bfsRings.push(ring0);

  // Subsequent rings: lots adjacent to any lot in previous ring
  let prevRing = ring0;
  let safety = 0;
  while (assigned.size < lots.length && safety < 50) {
    safety++;
    const nextRing: number[] = [];
    for (const ml of lots) {
      if (assigned.has(ml.globalIndex)) continue;
      for (const pi of prevRing) {
        const prevLot = lots.find((l) => l.globalIndex === pi);
        if (prevLot && areAdjacent(ml.lot.geometry, prevLot.lot.geometry)) {
          nextRing.push(ml.globalIndex);
          assigned.add(ml.globalIndex);
          break;
        }
      }
    }

    // Check via streets if no direct adjacency found
    if (nextRing.length === 0 && assigned.size < lots.length) {
      for (const ml of lots) {
        if (assigned.has(ml.globalIndex)) continue;
        for (const ms of streets) {
          const touchesAssigned = [...assigned].some((ai) => {
            const al = lots.find((l) => l.globalIndex === ai);
            return al ? areAdjacent(ms.street.geometry, al.lot.geometry) : false;
          });
          if (touchesAssigned && areAdjacent(ms.street.geometry, ml.lot.geometry)) {
            nextRing.push(ml.globalIndex);
            assigned.add(ml.globalIndex);
            break;
          }
        }
      }
    }

    if (nextRing.length === 0) {
      const remaining = lots
        .filter((l) => !assigned.has(l.globalIndex))
        .map((l) => l.globalIndex);
      if (remaining.length > 0) bfsRings.push(remaining);
      break;
    }

    bfsRings.push(nextRing);
    prevRing = nextRing;
  }

  // Split large BFS rings into sub-waves of MAX_LOTS_PER_WAVE,
  // sorted by distance from origin (nearest lots first)
  const waves: number[][] = [];
  for (const ring of bfsRings) {
    // Sort by distance from starting streets
    const sorted = [...ring].sort((a, b) => (lotDistances.get(a) ?? 0) - (lotDistances.get(b) ?? 0));
    for (let i = 0; i < sorted.length; i += MAX_LOTS_PER_WAVE) {
      waves.push(sorted.slice(i, i + MAX_LOTS_PER_WAVE));
    }
  }

  return waves;
}

/**
 * Build financial timeline from computed waves, split by district start year.
 *
 * Each BFS wave is split by its lots' district start years. AUDP waves start
 * developing from 2029, PDUC from 2033. The final timeline is sorted
 * chronologically, producing a realistic cross-district animation.
 */
export function buildTimeline(
  merged: MergedCabidaData,
  waves: number[][],
): PhasingYearData[] {
  if (waves.length === 0) return [];

  // Build a quick lookup from globalIndex → MergedLot
  const lotByGlobal = new Map<number, MergedLot>();
  for (const ml of merged.lots) lotByGlobal.set(ml.globalIndex, ml);

  // Collect all distinct start years
  const startYears = new Set<number>();
  for (const ml of merged.lots) startYears.add(ml.startYear);

  // For each start year, build an independent track of phases
  interface PhaseEntry {
    year: number;
    bfsWave: number;
    lots: MergedLot[];
  }
  const allPhases: PhaseEntry[] = [];

  for (const sy of startYears) {
    let currentYear = sy;

    for (let w = 0; w < waves.length; w++) {
      const lotsInWave = waves[w]
        .map((gi) => lotByGlobal.get(gi)!)
        .filter((ml) => ml && ml.startYear === sy);

      if (lotsInWave.length === 0) continue;

      allPhases.push({ year: currentYear, bfsWave: w, lots: lotsInWave });

      // Advance year by dominant product family duration
      const familyCounts: Record<string, number> = {};
      for (const ml of lotsInWave) {
        const fam = getFamily(ml.lot.product);
        familyCounts[fam] = (familyCounts[fam] || 0) + 1;
      }
      const dominant = Object.entries(familyCounts).sort((a, b) => b[1] - a[1])[0];
      const duration = dominant ? (DEV_YEARS[dominant[0]] || 2) : 2;
      currentYear += duration;
    }
  }

  // Sort chronologically, then by BFS wave order within same year
  allPhases.sort((a, b) => a.year - b.year || a.bfsWave - b.bfsWave);

  // Build PhasingYearData entries with accumulated financials
  let accIncome = 0;
  let accCost = 0;
  let accUnits = 0;

  return allPhases.map((phase, i) => {
    let waveIncome = 0;
    let waveCost = 0;
    let waveUnits = 0;
    const lotIndices = phase.lots.map((ml) => ml.globalIndex);

    for (const ml of phase.lots) {
      waveIncome += lotIncome(ml.lot, ml.districtId, ml.isIndustrial);
      const result = merged.cabidaResults.get(ml.cabidaId);
      if (result) waveCost += lotCostFromResult(ml.lot, result);
      waveUnits += ml.lot.units;
    }

    accIncome += waveIncome;
    accCost += waveCost;
    accUnits += waveUnits;

    return {
      wave: i,
      year: phase.year,
      lotIndices,
      waveIncome: Math.round(waveIncome),
      waveCost: Math.round(waveCost),
      accIncome: Math.round(accIncome),
      accCost: Math.round(accCost),
      accNet: Math.round(accIncome - accCost),
      waveUnits,
      accUnits,
    };
  });
}

/**
 * Compute wave assignments for streets and parks.
 * Streets light up at the earliest wave containing a lot from the same cabida.
 * Parks light up at the latest wave containing a lot from the same cabida
 * (green spaces are developed last).
 */
export function computeElementWaveAssignments(
  merged: MergedCabidaData,
  waves: number[][],
): { streetWaves: Record<number, number>; parkWaves: Record<number, number> } {
  const streetWaves: Record<number, number> = {};
  const parkWaves: Record<number, number> = {};

  if (waves.length === 0) return { streetWaves, parkWaves };

  // Build lookup: lot globalIndex → wave number
  const lotToWave = new Map<number, number>();
  for (let w = 0; w < waves.length; w++) {
    for (const gi of waves[w]) lotToWave.set(gi, w);
  }

  // Build lookup: cabidaId → { earliestWave, latestWave }
  const cabidaWaveRange = new Map<string, { earliest: number; latest: number }>();
  for (const ml of merged.lots) {
    const w = lotToWave.get(ml.globalIndex);
    if (w == null) continue;
    const existing = cabidaWaveRange.get(ml.cabidaId);
    if (!existing) {
      cabidaWaveRange.set(ml.cabidaId, { earliest: w, latest: w });
    } else {
      existing.earliest = Math.min(existing.earliest, w);
      existing.latest = Math.max(existing.latest, w);
    }
  }

  // Streets: light up at earliest wave of their cabida (infrastructure first)
  for (const ms of merged.streets) {
    const range = cabidaWaveRange.get(ms.cabidaId);
    streetWaves[ms.globalIndex] = range ? range.earliest : 0;
  }

  // Parks: light up at latest wave of their cabida (green spaces last)
  for (const mp of merged.parks) {
    const range = cabidaWaveRange.get(mp.cabidaId);
    parkWaves[mp.globalIndex] = range ? range.latest : waves.length - 1;
  }

  return { streetWaves, parkWaves };
}

/**
 * Create empty phasing state.
 */
export function createEmptyPhasingState(): PhasingState {
  return {
    isActive: false,
    selectedStreetIndices: [],
    selectedStructuralFids: [],
    structuralGeometries: [],
    waves: [],
    currentWave: -1,
    isPlaying: false,
    speed: 1,
    timeline: [],
    mergedData: null,
    streetWaveMap: {},
    parkWaveMap: {},
  };
}
