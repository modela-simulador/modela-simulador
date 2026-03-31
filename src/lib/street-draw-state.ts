/**
 * Street drawing state management.
 * Stores drawn street lines as GeoJSON LineStrings in WGS84.
 * Each line will be buffered to 12m width on the backend to create street polygons.
 */

export interface DrawnStreet {
  id: string;
  /** WGS84 coordinates [[lng, lat], ...] */
  coordinates: [number, number][];
  /** Street width in meters (default 12m) */
  widthM: number;
}

export interface StreetDrawState {
  streets: DrawnStreet[];
  /** Currently being drawn (not finalized) */
  activeVertices: [number, number][];
  /** Is drawing mode active */
  isDrawing: boolean;
}

export function createEmptyDrawState(): StreetDrawState {
  return {
    streets: [],
    activeVertices: [],
    isDrawing: false,
  };
}

let _idCounter = 0;
export function nextStreetId(): string {
  return `street_${++_idCounter}_${Date.now()}`;
}

/** Convert drawn streets to GeoJSON FeatureCollection of LineStrings */
export function streetsToGeoJSON(streets: DrawnStreet[]): GeoJSON.FeatureCollection {
  return {
    type: "FeatureCollection",
    features: streets.map((s) => ({
      type: "Feature" as const,
      properties: { id: s.id, widthM: s.widthM },
      geometry: {
        type: "LineString" as const,
        coordinates: s.coordinates,
      },
    })),
  };
}

/** Convert active drawing vertices + cursor position to a preview line */
export function activeLineToGeoJSON(
  vertices: [number, number][],
  cursor?: [number, number]
): GeoJSON.FeatureCollection {
  const coords = cursor ? [...vertices, cursor] : vertices;
  if (coords.length < 2) {
    return { type: "FeatureCollection", features: [] };
  }
  return {
    type: "FeatureCollection",
    features: [
      {
        type: "Feature",
        properties: {},
        geometry: { type: "LineString", coordinates: coords },
      },
    ],
  };
}

/** Convert vertices to point features for rendering dots */
export function verticesToGeoJSON(
  vertices: [number, number][]
): GeoJSON.FeatureCollection {
  return {
    type: "FeatureCollection",
    features: vertices.map((coord, i) => ({
      type: "Feature" as const,
      properties: { index: i },
      geometry: { type: "Point" as const, coordinates: coord },
    })),
  };
}
