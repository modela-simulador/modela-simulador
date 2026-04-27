/**
 * Cortes de lotes — modelo de datos y aplicación.
 *
 * Mantenemos el GeoJSON original inmutable y un historial de cortes.
 * El estado mostrado se deriva aplicando los cortes en orden sobre el
 * original. Esto permite "deshacer" simplemente eliminando entradas
 * del historial sin perder información.
 *
 * Cada corte:
 *  - targetFid: el FID que existía al momento del corte (puede ser
 *    derivado de un corte anterior, p. ej. "144.1")
 *  - line: GeoJSON LineString con la polilínea que cortó
 *  - resultingFids: los FIDs nuevos generados (p. ej. ["144.1", "144.2"])
 *
 * Si al re-aplicar el historial el targetFid ya no existe (porque se
 * deshizo un corte intermedio), el corte se descarta silenciosamente.
 */

import polygonSplitter from "polygon-splitter";

export interface LotCut {
  id: string; // uuid o timestamp
  targetFid: string;
  line: GeoJSON.LineString;
  resultingFids: string[];
  // Áreas calculadas en el momento del corte (para el sidebar de historial)
  resultingAreas: number[];
}

export type LotFeature = GeoJSON.Feature<GeoJSON.Polygon | GeoJSON.MultiPolygon, {
  fid: string;
  Area: number;
  [key: string]: unknown;
}>;

export type LotCollection = GeoJSON.FeatureCollection<
  GeoJSON.Polygon | GeoJSON.MultiPolygon,
  { fid: string; Area: number;[key: string]: unknown }
>;

/**
 * Calcula el área en m² de un polígono geográfico (MultiPolygon o Polygon).
 * Usa fórmula esférica (haversine-like) — suficiente para lotes pequeños.
 * Adaptado del algoritmo de Turf.js area.
 */
const RADIUS = 6378137; // radio terrestre WGS84 en metros

function ringArea(coords: number[][]): number {
  let total = 0;
  const n = coords.length;
  if (n < 3) return 0;
  for (let i = 0; i < n; i++) {
    const lower = coords[i];
    const middle = coords[(i + 1) % n];
    const upper = coords[(i + 2) % n];
    total += (rad(upper[0]) - rad(lower[0])) * Math.sin(rad(middle[1]));
  }
  return Math.abs((total * RADIUS * RADIUS) / 2);
}

function rad(deg: number): number {
  return (deg * Math.PI) / 180;
}

export function geometryAreaM2(geom: GeoJSON.Polygon | GeoJSON.MultiPolygon): number {
  if (geom.type === "Polygon") {
    if (geom.coordinates.length === 0) return 0;
    let area = ringArea(geom.coordinates[0]);
    for (let i = 1; i < geom.coordinates.length; i++) {
      area -= ringArea(geom.coordinates[i]);
    }
    return area;
  }
  // MultiPolygon
  let total = 0;
  for (const poly of geom.coordinates) {
    if (poly.length === 0) continue;
    let a = ringArea(poly[0]);
    for (let i = 1; i < poly.length; i++) {
      a -= ringArea(poly[i]);
    }
    total += a;
  }
  return total;
}

/**
 * Aplica un solo corte: encuentra el feature por FID, lo divide con
 * la línea, y devuelve la lista de features actualizada (con los
 * polígonos hijos en lugar del padre).
 *
 * Devuelve null si el feature no existe o el corte falla.
 */
export function applySingleCut(
  features: LotFeature[],
  cut: LotCut
): LotFeature[] | null {
  const targetIdx = features.findIndex((f) => f.properties.fid === cut.targetFid);
  if (targetIdx === -1) return null;
  const target = features[targetIdx];

  let result: GeoJSON.FeatureCollection;
  try {
    result = polygonSplitter(target.geometry, cut.line) as GeoJSON.FeatureCollection;
  } catch (e) {
    console.warn(`[lot-cuts] split failed for fid=${cut.targetFid}`, e);
    return null;
  }

  if (!result?.features || result.features.length < 2) {
    // No produjo un corte válido (línea no atraviesa el polígono)
    return null;
  }

  const children: LotFeature[] = result.features.map((f, i) => {
    const fid = cut.resultingFids[i] ?? `${cut.targetFid}.${i + 1}`;
    const geom = f.geometry as GeoJSON.Polygon | GeoJSON.MultiPolygon;
    return {
      type: "Feature",
      geometry: geom,
      properties: {
        ...target.properties,
        fid,
        Area: Math.round(geometryAreaM2(geom)),
      },
    };
  });

  const next = [...features];
  next.splice(targetIdx, 1, ...children);
  return next;
}

/**
 * Aplica todos los cortes en orden sobre la colección original.
 * Cortes que ya no se pueden aplicar (target ausente) se ignoran.
 */
export function applyCuts(original: LotCollection, cuts: LotCut[]): LotCollection {
  let features: LotFeature[] = original.features.slice() as LotFeature[];
  for (const c of cuts) {
    const after = applySingleCut(features, c);
    if (after) features = after;
  }
  return { ...original, features };
}

/**
 * Genera FIDs hijos siguiendo el patrón "padre.1", "padre.2", ...
 * Si el padre ya tiene sufijos, anida más profundo.
 */
export function nextChildFids(parentFid: string, count: number): string[] {
  return Array.from({ length: count }, (_, i) => `${parentFid}.${i + 1}`);
}

/**
 * Ejecuta un corte sobre el estado actual (varios polígonos pueden ser
 * atravesados por la misma línea). Devuelve un array de cortes a registrar
 * en el historial — uno por cada lote afectado.
 */
export function executeCutOnCollection(
  current: LotCollection,
  line: GeoJSON.LineString
): LotCut[] {
  const newCuts: LotCut[] = [];
  // Iteramos sobre snapshot — los cortes se registran contra los FIDs
  // tal cual están en `current`.
  for (const feature of current.features) {
    let result: GeoJSON.FeatureCollection;
    try {
      result = polygonSplitter(feature.geometry, line) as GeoJSON.FeatureCollection;
    } catch {
      continue;
    }
    if (!result?.features || result.features.length < 2) continue;

    const childCount = result.features.length;
    const fids = nextChildFids(feature.properties.fid, childCount);
    const areas = result.features.map((f) =>
      Math.round(geometryAreaM2(f.geometry as GeoJSON.Polygon | GeoJSON.MultiPolygon))
    );
    newCuts.push({
      id: `${Date.now()}-${feature.properties.fid}`,
      targetFid: feature.properties.fid,
      line,
      resultingFids: fids,
      resultingAreas: areas,
    });
  }
  return newCuts;
}
