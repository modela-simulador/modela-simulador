"use client";

import { useEffect, useRef, useState, useMemo } from "react";
import mapboxgl from "mapbox-gl";
import { MAP_CENTER, MAP_ZOOM, LAYER_COLORS, PRODUCTS } from "@/lib/constants";
import type { MacroloteFeature, CabidaEntry, BusinessSelection } from "@/lib/types";
import type { DrawnStreet } from "@/lib/street-draw-state";
import {
  streetsToGeoJSON,
  activeLineToGeoJSON,
  verticesToGeoJSON,
} from "@/lib/street-draw-state";

interface MasterplanMapProps {
  onMacroloteSelect: (feature: MacroloteFeature | null, shiftKey?: boolean) => void;
  /** Box-select: multiple elements selected at once via drag rectangle */
  onBoxSelect?: (macrolotes: MacroloteFeature[], streetFids: number[], greenFids: number[], shiftKey: boolean) => void;
  selectedMacrolotes: MacroloteFeature[];
  cabidaHistory: CabidaEntry[];
  activeCabidaId: string | null;
  onLotClick?: (lotIndex: number, cabidaId?: string) => void;
  onStructuralStreetClick?: (fid: number, areaM2: number) => void;
  onGreenAreaClick?: (fid: number, areaM2: number) => void;
  selectedLotIndex?: number | null;
  businessSelection?: BusinessSelection;
  /** Street drawing mode */
  drawMode?: boolean;
  drawnStreets?: DrawnStreet[];
  activeVertices?: [number, number][];
  onDrawClick?: (lngLat: [number, number]) => void;
  onDrawDoubleClick?: () => void;
  /** Phasing animation */
  phasingMode?: boolean;
  phasingVisibleLots?: Set<number> | null;
  phasingCurrentWaveLots?: Set<number> | null;
  phasingVisibleStreets?: Set<number> | null;
  phasingVisibleParks?: Set<number> | null;
  phasingSelectedStreets?: number[] | null;
  phasingSelectedStructuralFids?: number[] | null;
  /** True when user is in street-selection phase (before animation starts) */
  phasingSelectingStreets?: boolean;
  onPhasingStreetToggle?: (streetIndex: number) => void;
  onPhasingStructuralToggle?: (fid: number, geometry: GeoJSON.Geometry) => void;
}

// Build a color map for products
const PRODUCT_COLOR_MAP: Record<string, string> = {};
PRODUCTS.forEach((p) => { PRODUCT_COLOR_MAP[p.id] = p.color; });

export default function MasterplanMap({
  onMacroloteSelect, onBoxSelect, selectedMacrolotes, cabidaHistory, activeCabidaId,
  onLotClick, onStructuralStreetClick, onGreenAreaClick, selectedLotIndex, businessSelection,
  drawMode, drawnStreets, activeVertices, onDrawClick, onDrawDoubleClick,
  phasingMode, phasingVisibleLots, phasingCurrentWaveLots, phasingVisibleStreets,
  phasingVisibleParks, phasingSelectedStreets,
  phasingSelectedStructuralFids, phasingSelectingStreets, onPhasingStreetToggle,
  onPhasingStructuralToggle,
}: MasterplanMapProps) {
  const mapContainer = useRef<HTMLDivElement>(null);
  const map = useRef<mapboxgl.Map | null>(null);
  const [loaded, setLoaded] = useState(false);
  const popupRef = useRef<mapboxgl.Popup | null>(null);
  const onLotClickRef = useRef(onLotClick);
  const onStructuralStreetClickRef = useRef(onStructuralStreetClick);
  const onGreenAreaClickRef = useRef(onGreenAreaClick);
  onLotClickRef.current = onLotClick;
  onStructuralStreetClickRef.current = onStructuralStreetClick;
  onGreenAreaClickRef.current = onGreenAreaClick;

  // Keep cabidaHistory accessible inside map event closures
  const cabidaHistoryRef = useRef(cabidaHistory);
  cabidaHistoryRef.current = cabidaHistory;

  // Draw mode refs
  const drawModeRef = useRef(drawMode);
  drawModeRef.current = drawMode;
  const onDrawClickRef = useRef(onDrawClick);
  onDrawClickRef.current = onDrawClick;

  // Phasing refs
  const phasingModeRef = useRef(phasingMode);
  phasingModeRef.current = phasingMode;
  const phasingSelectingRef = useRef(phasingSelectingStreets);
  phasingSelectingRef.current = phasingSelectingStreets;
  const onPhasingStreetToggleRef = useRef(onPhasingStreetToggle);
  onPhasingStreetToggleRef.current = onPhasingStreetToggle;
  const onPhasingStructuralToggleRef = useRef(onPhasingStructuralToggle);
  onPhasingStructuralToggleRef.current = onPhasingStructuralToggle;
  const onDrawDoubleClickRef = useRef(onDrawDoubleClick);
  onDrawDoubleClickRef.current = onDrawDoubleClick;
  const cursorPosRef = useRef<[number, number] | null>(null);

  // Track previous selection FIDs to avoid unnecessary fitBounds
  const prevSelectedFidsRef = useRef<Set<string>>(new Set());

  // Box selection state
  const onBoxSelectRef = useRef(onBoxSelect);
  onBoxSelectRef.current = onBoxSelect;
  const [boxSelect, setBoxSelect] = useState<{ startX: number; startY: number; endX: number; endY: number } | null>(null);
  const boxSelectRef = useRef<{ startX: number; startY: number; shiftKey: boolean } | null>(null);
  const isDraggingBoxRef = useRef(false);
  const justBoxSelectedRef = useRef(false); // suppress click after box select
  // Track previewed feature IDs so we can clear them on next frame
  const previewedRef = useRef<{ lotes: Set<string>; vial: Set<number>; av: Set<number> }>({ lotes: new Set(), vial: new Set(), av: new Set() });

  // Track selected macrolote fids so click handler knows if a macrolote is already selected
  const selectedMacroloteFidsRef = useRef<Set<string>>(new Set());
  selectedMacroloteFidsRef.current = new Set(selectedMacrolotes.map((m) => m.properties.fid));

  // Build combined GeoJSON from all cabida entries (global indices for phasing)
  const combinedLots = useMemo(() => {
    const features: GeoJSON.Feature[] = [];
    let globalIdx = 0;
    for (const entry of cabidaHistory) {
      entry.result.lots.forEach((lot, i) => {
        const gIdx = globalIdx++;
        const product = PRODUCTS.find((p) => p.id === lot.product);
        const isSelected = businessSelection?.lotIndices.includes(i) ? 1 : 0;
        // Phasing: use global index for visibility and current-wave highlight
        const pVisible = phasingVisibleLots ? (phasingVisibleLots.has(gIdx) ? 1 : 0) : 1;
        const pCurrent = phasingCurrentWaveLots ? (phasingCurrentWaveLots.has(gIdx) ? 1 : 0) : 0;
        features.push({
          type: "Feature",
          properties: {
            id: i,
            globalIndex: gIdx,
            cabidaId: entry.id,
            product: lot.product,
            productName: product?.name || lot.product,
            color: product?.color || "#666",
            areaM2: lot.areaM2,
            units: lot.units,
            frontageM: lot.frontageM,
            isActive: entry.id === activeCabidaId ? 1 : 0,
            isSelected,
            phasingVisible: pVisible,
            phasingCurrent: pCurrent,
          },
          geometry: lot.geometry,
        });
      });
    }
    return { type: "FeatureCollection" as const, features };
  }, [cabidaHistory, activeCabidaId, businessSelection, phasingVisibleLots, phasingCurrentWaveLots]);

  const combinedStreets = useMemo(() => {
    const features: GeoJSON.Feature[] = [];
    let globalIdx = 0;
    for (const entry of cabidaHistory) {
      entry.result.streets.forEach((street, i) => {
        const gIdx = globalIdx++;
        const pSelected = phasingSelectedStreets ? (phasingSelectedStreets.includes(gIdx) ? 1 : 0) : 0;
        const pVisible = phasingVisibleStreets ? (phasingVisibleStreets.has(gIdx) ? 1 : 0) : 1;
        features.push({
          type: "Feature",
          properties: { id: i, globalIndex: gIdx, cabidaId: entry.id, areaM2: street.areaM2, phasingSelected: pSelected, phasingVisible: pVisible },
          geometry: street.geometry,
        });
      });
    }
    return { type: "FeatureCollection" as const, features };
  }, [cabidaHistory, phasingSelectedStreets, phasingVisibleStreets]);

  const combinedParks = useMemo(() => {
    const features: GeoJSON.Feature[] = [];
    let globalIdx = 0;
    for (const entry of cabidaHistory) {
      entry.result.parks.forEach((park, i) => {
        const gIdx = globalIdx++;
        const pVisible = phasingVisibleParks ? (phasingVisibleParks.has(gIdx) ? 1 : 0) : 1;
        features.push({
          type: "Feature",
          properties: { id: i, globalIndex: gIdx, cabidaId: entry.id, areaM2: park.areaM2, phasingVisible: pVisible },
          geometry: park.geometry,
        });
      });
    }
    return { type: "FeatureCollection" as const, features };
  }, [cabidaHistory, phasingVisibleParks]);

  useEffect(() => {
    if (map.current || !mapContainer.current) return;

    mapboxgl.accessToken = process.env.NEXT_PUBLIC_MAPBOX_TOKEN || "";

    map.current = new mapboxgl.Map({
      container: mapContainer.current,
      style: "mapbox://styles/mapbox/dark-v11",
      center: MAP_CENTER,
      zoom: MAP_ZOOM,
      pitch: 0,
      bearing: 0,
      boxZoom: false, // Disable so Shift+Click works for multi-select
      dragPan: false, // Disable left-drag pan — left-drag is for box selection; middle-click pans
    });

    // Tame scroll zoom: slow rate + no double-click zoom (less surprise zooming)
    map.current.scrollZoom.setWheelZoomRate(1 / 450);
    map.current.scrollZoom.setZoomRate(1 / 450);
    map.current.doubleClickZoom.disable();

    map.current.addControl(new mapboxgl.NavigationControl(), "top-right");
    map.current.addControl(new mapboxgl.ScaleControl({ unit: "metric" }), "bottom-right");

    map.current.on("load", () => {
      const m = map.current!;

      // Load all GeoJSON sources
      const sources = [
        { id: "cerco", url: "/data/cercos.geojson" },
        { id: "vial-nuevo", url: "/data/vial-nuevo.geojson" },
        { id: "areas-verdes", url: "/data/areas-verdes.geojson" },
        { id: "lotes", url: "/data/lotes.geojson" },
        { id: "div-calles", url: "/data/div-calles.geojson" },
      ];

      sources.forEach(({ id, url }) => {
        const opts: mapboxgl.GeoJSONSourceSpecification = { type: "geojson", data: url };
        if (id === "lotes" || id === "vial-nuevo" || id === "areas-verdes") opts.promoteId = "fid";
        m.addSource(id, opts);
      });

      // Empty sources for subdivision results
      m.addSource("cabida-lots", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
      m.addSource("cabida-streets", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
      m.addSource("cabida-parks", { type: "geojson", data: { type: "FeatureCollection", features: [] } });

      // --- Base layers ---

      m.addLayer({
        id: "cerco-outline", type: "line", source: "cerco",
        paint: { "line-color": LAYER_COLORS.cerco, "line-width": 2, "line-dasharray": [4, 3], "line-opacity": 0.6 },
      });

      // Paint expressions: "selected" = actively selected, "previewed" = within box drag rectangle
      const selOrPrev = (sel: string, prev: string, def: string) => [
        "case",
        ["boolean", ["feature-state", "selected"], false], sel,
        ["boolean", ["feature-state", "previewed"], false], prev,
        def,
      ];

      m.addLayer({
        id: "vial-fill", type: "fill", source: "vial-nuevo",
        paint: {
          "fill-color": ["case",
            ["boolean", ["feature-state", "phasingSelected"], false], "#eab308",
            ["boolean", ["feature-state", "selected"], false], "#60a5fa",
            ["boolean", ["feature-state", "previewed"], false], "#818cf8",
            LAYER_COLORS.vialNuevo,
          ] as mapboxgl.ExpressionSpecification,
          "fill-opacity": ["case",
            ["boolean", ["feature-state", "phasingSelected"], false], 1,
            ["boolean", ["feature-state", "selected"], false], 0.7,
            ["boolean", ["feature-state", "previewed"], false], 0.6,
            0.4,
          ] as mapboxgl.ExpressionSpecification,
        },
      });
      m.addLayer({
        id: "vial-outline", type: "line", source: "vial-nuevo",
        paint: {
          "line-color": ["case",
            ["boolean", ["feature-state", "phasingSelected"], false], "#fde047",
            ["boolean", ["feature-state", "selected"], false], "#93c5fd",
            ["boolean", ["feature-state", "previewed"], false], "#a5b4fc",
            LAYER_COLORS.vialNuevo,
          ] as mapboxgl.ExpressionSpecification,
          "line-width": ["case",
            ["boolean", ["feature-state", "phasingSelected"], false], 4,
            ["boolean", ["feature-state", "selected"], false], 3,
            ["boolean", ["feature-state", "previewed"], false], 2.5,
            0.5,
          ] as mapboxgl.ExpressionSpecification,
          "line-opacity": ["case",
            ["boolean", ["feature-state", "selected"], false], 1,
            ["boolean", ["feature-state", "previewed"], false], 0.9,
            0.6,
          ] as mapboxgl.ExpressionSpecification,
        },
      });

      m.addLayer({
        id: "av-fill", type: "fill", source: "areas-verdes",
        paint: {
          "fill-color": selOrPrev("#4ade80", "#86efac", LAYER_COLORS.areasVerdes) as mapboxgl.ExpressionSpecification,
          "fill-opacity": ["case",
            ["boolean", ["feature-state", "selected"], false], 0.7,
            ["boolean", ["feature-state", "previewed"], false], 0.6,
            0.35,
          ] as mapboxgl.ExpressionSpecification,
        },
      });
      m.addLayer({
        id: "av-outline", type: "line", source: "areas-verdes",
        paint: {
          "line-color": selOrPrev("#86efac", "#bbf7d0", LAYER_COLORS.areasVerdes) as mapboxgl.ExpressionSpecification,
          "line-width": ["case",
            ["boolean", ["feature-state", "selected"], false], 3,
            ["boolean", ["feature-state", "previewed"], false], 2.5,
            1,
          ] as mapboxgl.ExpressionSpecification,
          "line-opacity": ["case",
            ["boolean", ["feature-state", "selected"], false], 1,
            ["boolean", ["feature-state", "previewed"], false], 0.9,
            0.7,
          ] as mapboxgl.ExpressionSpecification,
        },
      });

      m.addLayer({
        id: "lotes-fill", type: "fill", source: "lotes",
        paint: {
          "fill-color": selOrPrev(LAYER_COLORS.lotesSelected, "#818cf8", LAYER_COLORS.lotes) as mapboxgl.ExpressionSpecification,
          "fill-opacity": ["case",
            ["boolean", ["feature-state", "hover"], false], 0.5,
            ["boolean", ["feature-state", "selected"], false], 0.4,
            ["boolean", ["feature-state", "previewed"], false], 0.35,
            0.15,
          ] as mapboxgl.ExpressionSpecification,
        },
      });
      m.addLayer({
        id: "lotes-outline", type: "line", source: "lotes",
        paint: {
          "line-color": selOrPrev("#60a5fa", "#a5b4fc", "#cbd5e1") as mapboxgl.ExpressionSpecification,
          "line-width": ["case",
            ["boolean", ["feature-state", "selected"], false], 4,
            ["boolean", ["feature-state", "previewed"], false], 3,
            1,
          ] as mapboxgl.ExpressionSpecification,
          "line-opacity": ["case",
            ["boolean", ["feature-state", "selected"], false], 1,
            ["boolean", ["feature-state", "previewed"], false], 0.9,
            0.8,
          ] as mapboxgl.ExpressionSpecification,
        },
      });

      // Glow effect for selected macrolote
      m.addLayer({
        id: "lotes-glow", type: "line", source: "lotes",
        paint: {
          "line-color": "#3b82f6",
          "line-width": 8,
          "line-opacity": ["case", ["boolean", ["feature-state", "selected"], false], 0.4, 0],
          "line-blur": 4,
        },
      });

      m.addLayer({
        id: "lotes-labels", type: "symbol", source: "lotes",
        layout: {
          "text-field": ["get", "fid"],
          "text-size": 11,
          "text-font": ["DIN Pro Medium", "Arial Unicode MS Bold"],
          "text-allow-overlap": false,
          "symbol-avoid-edges": true,
        },
        paint: { "text-color": "#e2e8f0", "text-halo-color": "#0f172a", "text-halo-width": 1.5 },
        minzoom: 14,
      });

      m.addLayer({
        id: "div-calles-outline", type: "line", source: "div-calles",
        paint: { "line-color": LAYER_COLORS.divCalles, "line-width": 1.5, "line-dasharray": [6, 4], "line-opacity": 0.4 },
      });

      // --- Cabida overlay layers ---

      // Lots (colored by product, highlight when selected for business)
      // phasingVisible: 1=visible, 0=hidden (dim); phasingCurrent: 1=current wave (bright)
      m.addLayer({
        id: "cabida-lots-fill", type: "fill", source: "cabida-lots",
        paint: {
          "fill-color": ["get", "color"],
          "fill-opacity": [
            "case",
            // Phasing: current wave lots glow bright
            ["==", ["get", "phasingCurrent"], 1], 0.9,
            // Phasing: visible (past waves) = normal opacity
            ["==", ["get", "phasingVisible"], 1], 0.6,
            // Phasing: not yet developed = very dim
            ["==", ["get", "phasingVisible"], 0], 0.08,
            // Non-phasing modes
            ["==", ["get", "isSelected"], 1], 0.85,
            ["==", ["get", "isActive"], 1], 0.6,
            0.35,
          ],
        },
      });
      m.addLayer({
        id: "cabida-lots-outline", type: "line", source: "cabida-lots",
        paint: {
          "line-color": [
            "case",
            ["==", ["get", "phasingCurrent"], 1], "#a5b4fc", // indigo-300 for current wave
            ["==", ["get", "phasingVisible"], 0], "#1e1e2e",  // nearly invisible outline
            ["==", ["get", "isSelected"], 1], "#fbbf24",
            ["==", ["get", "isActive"], 1], "#ffffff",
            "#94a3b8",
          ],
          "line-width": [
            "case",
            ["==", ["get", "phasingCurrent"], 1], 3,
            ["==", ["get", "phasingVisible"], 0], 0.5,
            ["==", ["get", "isSelected"], 1], 3,
            ["==", ["get", "isActive"], 1], 2,
            1,
          ],
          "line-opacity": 0.9,
        },
      });

      // Internal streets — rendered ON TOP of lots so they're always visible.
      // Streets visually separate lots; rendering below lots made them transparent.
      // phasingSelected: 1 = user selected this street as starting point (indigo glow)
      m.addLayer({
        id: "cabida-streets-fill", type: "fill", source: "cabida-streets",
        paint: {
          "fill-color": [
            "case",
            ["==", ["get", "phasingSelected"], 1], "#eab308",  // yellow-500 — selection mode
            "#475569",
          ],
          "fill-opacity": [
            "case",
            ["==", ["get", "phasingSelected"], 1], 1,
            ["==", ["get", "phasingVisible"], 1], 0.95,  // lit up
            ["==", ["get", "phasingVisible"], 0], 0.08,   // not yet built — very dim
            0.95,
          ],
        },
      });
      m.addLayer({
        id: "cabida-streets-outline", type: "line", source: "cabida-streets",
        paint: {
          "line-color": [
            "case",
            ["==", ["get", "phasingSelected"], 1], "#fde047",
            ["==", ["get", "phasingVisible"], 0], "#1e1e2e",   // nearly invisible
            "#94a3b8",
          ],
          "line-width": [
            "case",
            ["==", ["get", "phasingSelected"], 1], 4,
            ["==", ["get", "phasingVisible"], 0], 0.5,
            1.5,
          ],
        },
      });

      m.addLayer({
        id: "cabida-lots-labels", type: "symbol", source: "cabida-lots",
        layout: {
          "text-field": [
            "case",
            [">", ["get", "units"], 0],
            ["concat", ["get", "productName"], "\n", ["to-string", ["get", "units"]], " viv"],
            ["get", "productName"],
          ],
          "text-size": [
            "interpolate", ["linear"], ["get", "areaM2"],
            2000, 9,
            8000, 11,
            20000, 13,
          ],
          "text-font": ["DIN Pro Bold", "Arial Unicode MS Bold"],
          "text-allow-overlap": false,
          "text-ignore-placement": false,
          "text-optional": true,
          "text-padding": 4,
          "symbol-sort-key": ["*", -1, ["get", "areaM2"]],
        },
        paint: {
          "text-color": "#ffffff",
          "text-halo-color": "#000000",
          "text-halo-width": 2,
          "text-opacity": [
            "case",
            ["==", ["get", "phasingVisible"], 0], 0,  // hide labels on unbuilt lots
            1,
          ],
        },
      });

      // Selected lot highlight (legacy single selection)
      m.addSource("cabida-selected-lot", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
      m.addLayer({
        id: "cabida-selected-lot-outline", type: "line", source: "cabida-selected-lot",
        paint: { "line-color": "#fbbf24", "line-width": 4, "line-opacity": 1 },
      });

      // Internal parks/green areas — dim during phasing until their wave
      m.addLayer({
        id: "cabida-parks-fill", type: "fill", source: "cabida-parks",
        paint: {
          "fill-color": "#22c55e",
          "fill-opacity": [
            "case",
            ["==", ["get", "phasingVisible"], 1], 0.7,
            ["==", ["get", "phasingVisible"], 0], 0.06,
            0.7,
          ],
        },
      });
      m.addLayer({
        id: "cabida-parks-outline", type: "line", source: "cabida-parks",
        paint: {
          "line-color": [
            "case",
            ["==", ["get", "phasingVisible"], 0], "#1e1e2e",
            "transparent",
          ],
          "line-width": 1,
        },
      });

      // --- Universal hover highlight layer ---
      m.addSource("hover-highlight", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
      m.addLayer({
        id: "hover-highlight-outline", type: "line", source: "hover-highlight",
        paint: { "line-color": "#ffffff", "line-width": 3, "line-opacity": 0.9 },
      });
      m.addLayer({
        id: "hover-highlight-glow", type: "line", source: "hover-highlight",
        paint: { "line-color": "#60a5fa", "line-width": 8, "line-opacity": 0.35, "line-blur": 4 },
      });

      // --- Street drawing layers ---
      m.addSource("draw-streets", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
      m.addSource("draw-active-line", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
      m.addSource("draw-vertices", { type: "geojson", data: { type: "FeatureCollection", features: [] } });

      // Finalized drawn streets (solid orange)
      m.addLayer({
        id: "draw-streets-line", type: "line", source: "draw-streets",
        paint: { "line-color": "#f59e0b", "line-width": 4, "line-opacity": 0.9 },
      });
      m.addLayer({
        id: "draw-streets-glow", type: "line", source: "draw-streets",
        paint: { "line-color": "#f59e0b", "line-width": 12, "line-opacity": 0.15, "line-blur": 4 },
      });

      // Active line being drawn (dashed)
      m.addLayer({
        id: "draw-active-line", type: "line", source: "draw-active-line",
        paint: { "line-color": "#fbbf24", "line-width": 3, "line-dasharray": [3, 2], "line-opacity": 0.8 },
      });

      // Vertices (dots)
      m.addLayer({
        id: "draw-vertices-circle", type: "circle", source: "draw-vertices",
        paint: {
          "circle-radius": 5,
          "circle-color": "#fbbf24",
          "circle-stroke-color": "#000",
          "circle-stroke-width": 2,
        },
      });

      // --- Interactions ---

      const hoverLayers = ["cabida-lots-fill", "cabida-parks-fill", "cabida-streets-fill", "lotes-fill", "av-fill", "vial-fill"];

      let hoveredLoteId: string | number | null = null;

      m.on("mousemove", (e) => {
        const features = m.queryRenderedFeatures(e.point, { layers: hoverLayers });
        const hoverSource = m.getSource("hover-highlight") as mapboxgl.GeoJSONSource;

        if (features && features.length > 0) {
          m.getCanvas().style.cursor = "pointer";
          const topFeature = features[0];

          if (hoverSource && topFeature.geometry) {
            hoverSource.setData({
              type: "FeatureCollection",
              features: [{ type: "Feature", properties: {}, geometry: topFeature.geometry }],
            });
          }

          const loteFeature = features.find((f) => f.layer?.id === "lotes-fill");
          if (loteFeature) {
            if (hoveredLoteId !== null && hoveredLoteId !== loteFeature.id) {
              m.setFeatureState({ source: "lotes", id: hoveredLoteId }, { hover: false });
            }
            if (loteFeature.id != null) {
              hoveredLoteId = loteFeature.id;
              m.setFeatureState({ source: "lotes", id: hoveredLoteId }, { hover: true });
            }
          } else if (hoveredLoteId !== null) {
            m.setFeatureState({ source: "lotes", id: hoveredLoteId }, { hover: false });
            hoveredLoteId = null;
          }

          // Tooltip for cabida and structural elements
          const cabidaLot = features.find((f) => f.layer?.id === "cabida-lots-fill");
          const vialFeature = features.find((f) => f.layer?.id === "vial-fill");
          const avFeature = features.find((f) => f.layer?.id === "av-fill");

          if (cabidaLot) {
            const props = cabidaLot.properties!;
            if (popupRef.current) popupRef.current.remove();
            popupRef.current = new mapboxgl.Popup({ closeButton: false, offset: 10 })
              .setLngLat(e.lngLat)
              .setHTML(`
                <div style="font-family:system-ui;font-size:12px;color:#fff;background:#1e293b;padding:8px 12px;border-radius:6px;">
                  <strong>${props.productName}</strong><br/>
                  ${(props.areaM2 / 10000).toFixed(2)} ha${props.units > 0 ? ` · ${props.units} viv` : ""}<br/>
                  <span style="color:#94a3b8">Frente: ${Math.round(props.frontageM) || "—"}m</span><br/>
                  <span style="color:#fbbf24;font-size:11px">Click para seleccionar</span>
                </div>
              `)
              .addTo(m);
          } else if (vialFeature) {
            const props = vialFeature.properties!;
            const areaM2 = Math.round(props.Area as number || 0);
            if (popupRef.current) popupRef.current.remove();
            popupRef.current = new mapboxgl.Popup({ closeButton: false, offset: 10 })
              .setLngLat(e.lngLat)
              .setHTML(`
                <div style="font-family:system-ui;font-size:12px;color:#fff;background:#1e293b;padding:8px 12px;border-radius:6px;">
                  <strong>Vialidad Estructurante</strong><br/>
                  ${areaM2.toLocaleString()} m²<br/>
                  <span style="color:#60a5fa;font-size:11px">Click para seleccionar</span>
                </div>
              `)
              .addTo(m);
          } else if (avFeature) {
            const props = avFeature.properties!;
            const areaM2 = Math.round((props.Arae || props.Area || 0) as number);
            if (popupRef.current) popupRef.current.remove();
            popupRef.current = new mapboxgl.Popup({ closeButton: false, offset: 10 })
              .setLngLat(e.lngLat)
              .setHTML(`
                <div style="font-family:system-ui;font-size:12px;color:#fff;background:#1e293b;padding:8px 12px;border-radius:6px;">
                  <strong>Área Verde Central</strong><br/>
                  ${areaM2.toLocaleString()} m²<br/>
                  <span style="color:#4ade80;font-size:11px">Click para seleccionar</span>
                </div>
              `)
              .addTo(m);
          } else {
            // Check if hovering a macrolote with a saved cabida
            const loteFeatureForPopup = features.find((f) => f.layer?.id === "lotes-fill");
            if (loteFeatureForPopup) {
              const fid = String(loteFeatureForPopup.properties?.fid || loteFeatureForPopup.id || "");
              // Find cabida entry that includes this FID
              const cabidaForLote = cabidaHistoryRef.current.find((e) => e.fids.includes(fid));
              if (cabidaForLote) {
                const m2 = cabidaForLote.result.metrics;
                if (popupRef.current) popupRef.current.remove();
                popupRef.current = new mapboxgl.Popup({ closeButton: false, offset: 10 })
                  .setLngLat(e.lngLat)
                  .setHTML(`
                    <div style="font-family:system-ui;font-size:12px;color:#fff;background:#1e293b;padding:8px 12px;border-radius:6px;">
                      <strong>Lote ${fid}</strong> — Cabida guardada<br/>
                      ${m2.totalLots} lotes · ${m2.totalUnits.toLocaleString()} viv<br/>
                      <span style="color:#4ade80">${Math.round(m2.totalValueUF).toLocaleString()} UF ingreso</span><br/>
                      <span style="color:#f87171">${Math.round(m2.totalCostUF).toLocaleString()} UF costo</span><br/>
                      <span style="color:#fbbf24">${Math.round(m2.netValueUF).toLocaleString()} UF margen</span>
                    </div>
                  `)
                  .addTo(m);
              } else {
                const areaHa = ((loteFeatureForPopup.properties?.Area || 0) / 10000).toFixed(1);
                if (popupRef.current) popupRef.current.remove();
                popupRef.current = new mapboxgl.Popup({ closeButton: false, offset: 10 })
                  .setLngLat(e.lngLat)
                  .setHTML(`
                    <div style="font-family:system-ui;font-size:12px;color:#fff;background:#1e293b;padding:8px 12px;border-radius:6px;">
                      <strong>Lote ${fid}</strong><br/>
                      ${areaHa} ha<br/>
                      <span style="color:#94a3b8;font-size:11px">Click para seleccionar</span>
                    </div>
                  `)
                  .addTo(m);
              }
            } else {
              if (popupRef.current) { popupRef.current.remove(); popupRef.current = null; }
            }
          }
        } else {
          m.getCanvas().style.cursor = "";
          if (hoverSource) {
            hoverSource.setData({ type: "FeatureCollection", features: [] });
          }
          if (hoveredLoteId !== null) {
            m.setFeatureState({ source: "lotes", id: hoveredLoteId }, { hover: false });
            hoveredLoteId = null;
          }
          if (popupRef.current) { popupRef.current.remove(); popupRef.current = null; }
        }
      });

      // Track cursor for draw mode preview line
      m.on("mousemove", "lotes-fill", (e) => {
        if (drawModeRef.current && e.lngLat) {
          cursorPosRef.current = [e.lngLat.lng, e.lngLat.lat];
        }
      });

      // Double-click finishes a street line
      m.on("dblclick", (e) => {
        if (drawModeRef.current && onDrawDoubleClickRef.current) {
          e.preventDefault();
          onDrawDoubleClickRef.current();
          return;
        }
      });

      // Unified click handler — query ALL rendered features at click point
      m.on("click", (e) => {
        // Skip click if a box selection just completed (drag produces click too)
        if (justBoxSelectedRef.current) return;

        // In draw mode, clicks add vertices
        if (drawModeRef.current && onDrawClickRef.current) {
          onDrawClickRef.current([e.lngLat.lng, e.lngLat.lat]);
          return;
        }

        // In phasing street selection: click toggles street (internal OR structural)
        // BLOCK all other click handling — only streets matter in this mode
        if (phasingSelectingRef.current) {
          // Use a 12px box around click point for easier targeting of thin streets
          const px = e.point;
          const pad = 12;
          const bbox: [mapboxgl.PointLike, mapboxgl.PointLike] = [
            [px.x - pad, px.y - pad],
            [px.x + pad, px.y + pad],
          ];

          // Try internal cabida streets first
          const streetHits = m.queryRenderedFeatures(bbox, { layers: ["cabida-streets-fill"] });
          if (streetHits.length > 0 && onPhasingStreetToggleRef.current) {
            const globalIdx = streetHits[0].properties?.globalIndex;
            if (globalIdx != null) {
              onPhasingStreetToggleRef.current(globalIdx);
              return;
            }
          }

          // Try structural vialidad
          const vialHits = m.queryRenderedFeatures(bbox, { layers: ["vial-fill"] });
          if (vialHits.length > 0 && onPhasingStructuralToggleRef.current) {
            const feat = vialHits[0];
            const fid = feat.properties?.fid;
            if (fid != null) {
              // Get the full feature geometry from source for BFS adjacency
              const sourceFeats = m.querySourceFeatures("vial", { filter: ["==", ["get", "fid"], fid] });
              const geom = sourceFeats.length > 0 ? sourceFeats[0].geometry : feat.geometry;
              onPhasingStructuralToggleRef.current(Number(fid), geom);
              return;
            }
          }

          // Always return — in phasing mode, clicks ONLY toggle streets
          return;
        }

        const allHits = m.queryRenderedFeatures(e.point);
        const shiftKey = e.originalEvent?.shiftKey ?? false;

        // Find features by layer
        const vial = allHits.find((f) => f.layer?.id === "vial-fill");
        const av = allHits.find((f) => f.layer?.id === "av-fill");
        const cabidaLot = allHits.find((f) => f.layer?.id === "cabida-lots-fill");
        const cabidaStreet = allHits.find((f) => f.layer?.id === "cabida-streets-fill");
        const cabidaPark = allHits.find((f) => f.layer?.id === "cabida-parks-fill");
        const lote = allHits.find((f) => f.layer?.id === "lotes-fill");

        // Infrastructure selection: toggle ALL road AND green area features at click point
        if (vial || av) {
          if (vial && onStructuralStreetClickRef.current) {
            onStructuralStreetClickRef.current(Number(vial.properties!.fid), Number(vial.properties!.Area || 0));
          }
          if (av && onGreenAreaClickRef.current) {
            onGreenAreaClickRef.current(Number(av.properties!.fid), Number(av.properties!.Arae || av.properties!.Area || 0));
          }
          return;
        }

        // Cabida lot click
        if (cabidaLot && onLotClickRef.current) {
          const props = cabidaLot.properties!;
          if (props.id != null) onLotClickRef.current(Number(props.id), props.cabidaId);
          return;
        }

        // Absorb clicks on cabida infrastructure (streets/parks) — don't reset selection
        if (cabidaStreet || cabidaPark) {
          return;
        }

        // Macrolote click — only if it's a NEW macrolote (not already selected)
        if (lote) {
          const clickedFid = String(lote.properties?.fid);
          const alreadySelected = selectedMacroloteFidsRef.current.has(clickedFid);
          if (alreadySelected && !shiftKey) {
            return;
          }
          onMacroloteSelect(lote as unknown as MacroloteFeature, shiftKey);
          return;
        }

        // Empty area — deselect
        onMacroloteSelect(null, shiftKey);
      });

      setLoaded(true);
    });

    return () => { map.current?.remove(); map.current = null; };
  }, [onMacroloteSelect]);

  // ── Box selection (left-drag) + middle-click panning ──
  useEffect(() => {
    const container = mapContainer.current;
    if (!container) return;

    const MIN_DRAG_PX = 8;
    let middlePanning = false;
    let middleLastX = 0;
    let middleLastY = 0;

    const onMouseDown = (e: MouseEvent) => {
      // Middle button (scroll click) → start panning
      if (e.button === 1) {
        e.preventDefault();
        middlePanning = true;
        middleLastX = e.clientX;
        middleLastY = e.clientY;
        container.style.cursor = "grabbing";
        return;
      }

      // Left button → box selection (skip if in draw mode or phasing street select)
      if (e.button !== 0 || drawModeRef.current || phasingSelectingRef.current) return;
      if ((e.target as HTMLElement).closest(".mapboxgl-ctrl")) return;
      boxSelectRef.current = { startX: e.clientX, startY: e.clientY, shiftKey: e.shiftKey };
      isDraggingBoxRef.current = false;
    };

    /** Clear all previewed feature states */
    const clearPreview = () => {
      const m = map.current;
      if (!m) return;
      const prev = previewedRef.current;
      for (const fid of prev.lotes) m.setFeatureState({ source: "lotes", id: fid }, { previewed: false });
      for (const fid of prev.vial) m.setFeatureState({ source: "vial-nuevo", id: fid }, { previewed: false });
      for (const fid of prev.av) m.setFeatureState({ source: "areas-verdes", id: fid }, { previewed: false });
      prev.lotes.clear();
      prev.vial.clear();
      prev.av.clear();
    };

    /** Query features inside current box and apply/remove preview highlight */
    const updatePreview = (sx: number, sy: number, ex: number, ey: number) => {
      const m = map.current;
      if (!m) return;
      const rect = container.getBoundingClientRect();
      const sw: [number, number] = [Math.min(sx, ex) - rect.left, Math.max(sy, ey) - rect.top];
      const ne: [number, number] = [Math.max(sx, ex) - rect.left, Math.min(sy, ey) - rect.top];

      const hits = m.queryRenderedFeatures([sw, ne], { layers: ["lotes-fill", "vial-fill", "av-fill"] });

      const newLotes = new Set<string>();
      const newVial = new Set<number>();
      const newAv = new Set<number>();

      for (const f of hits) {
        const layer = f.layer?.id;
        const fid = f.properties?.fid;
        if (fid == null) continue;
        if (layer === "lotes-fill") newLotes.add(String(fid));
        else if (layer === "vial-fill") newVial.add(Number(fid));
        else if (layer === "av-fill") newAv.add(Number(fid));
      }

      const prev = previewedRef.current;
      // Remove preview from features that left the box
      for (const fid of prev.lotes) { if (!newLotes.has(fid)) m.setFeatureState({ source: "lotes", id: fid }, { previewed: false }); }
      for (const fid of prev.vial) { if (!newVial.has(fid)) m.setFeatureState({ source: "vial-nuevo", id: fid }, { previewed: false }); }
      for (const fid of prev.av) { if (!newAv.has(fid)) m.setFeatureState({ source: "areas-verdes", id: fid }, { previewed: false }); }
      // Add preview to features that entered the box
      for (const fid of newLotes) { if (!prev.lotes.has(fid)) m.setFeatureState({ source: "lotes", id: fid }, { previewed: true }); }
      for (const fid of newVial) { if (!prev.vial.has(fid)) m.setFeatureState({ source: "vial-nuevo", id: fid }, { previewed: true }); }
      for (const fid of newAv) { if (!prev.av.has(fid)) m.setFeatureState({ source: "areas-verdes", id: fid }, { previewed: true }); }

      prev.lotes = newLotes;
      prev.vial = newVial;
      prev.av = newAv;
    };

    const onMouseMove = (e: MouseEvent) => {
      // Middle-click panning
      if (middlePanning && map.current) {
        const dx = middleLastX - e.clientX;
        const dy = middleLastY - e.clientY;
        map.current.panBy([dx, dy], { animate: false });
        middleLastX = e.clientX;
        middleLastY = e.clientY;
        return;
      }

      // Box selection drag
      if (!boxSelectRef.current) return;
      const dx = e.clientX - boxSelectRef.current.startX;
      const dy = e.clientY - boxSelectRef.current.startY;

      if (!isDraggingBoxRef.current) {
        if (Math.abs(dx) < MIN_DRAG_PX && Math.abs(dy) < MIN_DRAG_PX) return;
        isDraggingBoxRef.current = true;
      }

      const rect = container.getBoundingClientRect();
      setBoxSelect({
        startX: boxSelectRef.current.startX - rect.left,
        startY: boxSelectRef.current.startY - rect.top,
        endX: e.clientX - rect.left,
        endY: e.clientY - rect.top,
      });

      // Live preview: highlight features as box covers them
      updatePreview(boxSelectRef.current.startX, boxSelectRef.current.startY, e.clientX, e.clientY);
    };

    const onMouseUp = (e: MouseEvent) => {
      // End middle-click panning
      if (e.button === 1 && middlePanning) {
        middlePanning = false;
        container.style.cursor = "";
        return;
      }

      if (!boxSelectRef.current) return;
      const wasBoxDrag = isDraggingBoxRef.current;
      const shiftKey = boxSelectRef.current.shiftKey || e.shiftKey;
      const startX = boxSelectRef.current.startX;
      const startY = boxSelectRef.current.startY;

      // Capture final previewed sets before clearing
      const finalVial = [...previewedRef.current.vial];
      const finalAv = [...previewedRef.current.av];

      boxSelectRef.current = null;
      isDraggingBoxRef.current = false;
      setBoxSelect(null);
      clearPreview();

      if (!wasBoxDrag || !map.current || !onBoxSelectRef.current) return;

      justBoxSelectedRef.current = true;
      setTimeout(() => { justBoxSelectedRef.current = false; }, 50);

      // Query macrolote features in the final box (need full feature objects)
      const rect = container.getBoundingClientRect();
      const sw: [number, number] = [Math.min(startX, e.clientX) - rect.left, Math.max(startY, e.clientY) - rect.top];
      const ne: [number, number] = [Math.max(startX, e.clientX) - rect.left, Math.min(startY, e.clientY) - rect.top];
      const loteHits = map.current.queryRenderedFeatures([sw, ne], { layers: ["lotes-fill"] });

      const seenMacro = new Set<string>();
      const macrolotes: MacroloteFeature[] = [];
      for (const f of loteHits) {
        const fid = String(f.properties?.fid);
        if (!seenMacro.has(fid)) { seenMacro.add(fid); macrolotes.push(f as unknown as MacroloteFeature); }
      }

      if (macrolotes.length > 0 || finalVial.length > 0 || finalAv.length > 0) {
        onBoxSelectRef.current(macrolotes, finalVial, finalAv, shiftKey);
      }
    };

    const onAuxClick = (e: MouseEvent) => { if (e.button === 1) e.preventDefault(); };

    container.addEventListener("mousedown", onMouseDown);
    container.addEventListener("auxclick", onAuxClick);
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);

    return () => {
      container.removeEventListener("mousedown", onMouseDown);
      container.removeEventListener("auxclick", onAuxClick);
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
    };
  }, []);

  // Handle selection changes
  useEffect(() => {
    if (!map.current || !loaded) return;
    const m = map.current;

    const features = m.querySourceFeatures("lotes");
    const seenFids = new Set<string>();
    features.forEach((f) => {
      const fid = f.properties?.fid;
      if (fid != null && !seenFids.has(fid)) {
        seenFids.add(fid);
        m.setFeatureState({ source: "lotes", id: fid }, { selected: false });
      }
    });

    if (selectedMacrolotes.length > 0) {
      const currentFids = new Set(selectedMacrolotes.map((m2) => String(m2.properties.fid)));
      const prevFids = prevSelectedFidsRef.current;

      // Determine if the selection actually changed (new FIDs added)
      const hasNewFids = [...currentFids].some((fid) => !prevFids.has(fid));
      const selectionGrew = currentFids.size > prevFids.size || hasNewFids;

      const bounds = new mapboxgl.LngLatBounds();
      for (const macro of selectedMacrolotes) {
        const fid = macro.properties.fid;
        if (fid != null) {
          m.setFeatureState({ source: "lotes", id: fid }, { selected: true });
        }
        const coords = macro.geometry.type === "MultiPolygon"
          ? macro.geometry.coordinates.flat(2)
          : (macro.geometry as GeoJSON.Polygon).coordinates.flat();
        coords.forEach((c: number[]) => bounds.extend([c[0], c[1]] as [number, number]));
      }

      // No auto-zoom — user controls the map with scroll only

      prevSelectedFidsRef.current = currentFids;
    } else {
      prevSelectedFidsRef.current = new Set();
    }
  }, [selectedMacrolotes, loaded]);

  // Update cabida overlay — render ALL iterations at once
  useEffect(() => {
    if (!map.current || !loaded) return;
    const m = map.current;

    (m.getSource("cabida-lots") as mapboxgl.GeoJSONSource)?.setData(combinedLots);
    (m.getSource("cabida-streets") as mapboxgl.GeoJSONSource)?.setData(combinedStreets);
    (m.getSource("cabida-parks") as mapboxgl.GeoJSONSource)?.setData(combinedParks);
  }, [combinedLots, combinedStreets, combinedParks, loaded]);

  // Highlight structural roads selected for phasing (yellow)
  useEffect(() => {
    if (!map.current || !loaded) return;
    const m = map.current;
    const selectedFids = new Set(phasingSelectedStructuralFids ?? []);

    // Clear all vial phasingSelected states, then set new ones
    const vialFeats = m.querySourceFeatures("vial-nuevo");
    const seenVial = new Set<number>();
    for (const f of vialFeats) {
      const fid = f.properties?.fid != null ? Number(f.properties.fid) : null;
      if (fid == null || seenVial.has(fid)) continue;
      seenVial.add(fid);
      m.setFeatureState(
        { source: "vial-nuevo", id: fid },
        { phasingSelected: selectedFids.has(fid) },
      );
    }
  }, [phasingSelectedStructuralFids, loaded]);

  // Highlight selected lot
  useEffect(() => {
    if (!map.current || !loaded) return;
    const m = map.current;
    const source = m.getSource("cabida-selected-lot") as mapboxgl.GeoJSONSource;
    if (!source) return;

    if (selectedLotIndex == null || !activeCabidaId) {
      source.setData({ type: "FeatureCollection", features: [] });
      return;
    }

    const entry = cabidaHistory.find((e) => e.id === activeCabidaId);
    if (!entry || !entry.result.lots[selectedLotIndex]) {
      source.setData({ type: "FeatureCollection", features: [] });
      return;
    }

    source.setData({
      type: "FeatureCollection",
      features: [{
        type: "Feature",
        properties: {},
        geometry: entry.result.lots[selectedLotIndex].geometry as GeoJSON.Geometry,
      }],
    });
  }, [selectedLotIndex, activeCabidaId, cabidaHistory, loaded]);

  // Update feature-state for selected structural roads and green areas
  useEffect(() => {
    if (!map.current || !loaded) return;
    const m = map.current;

    // Reset all vial-nuevo feature states
    const vialFeatures = m.querySourceFeatures("vial-nuevo");
    const seenVialFids = new Set<number>();
    vialFeatures.forEach((f) => {
      const fid = f.properties?.fid;
      if (fid != null && !seenVialFids.has(fid)) {
        seenVialFids.add(fid);
        m.setFeatureState({ source: "vial-nuevo", id: fid }, { selected: false });
      }
    });
    // Set selected
    if (businessSelection) {
      for (const fid of businessSelection.structuralStreetFids) {
        m.setFeatureState({ source: "vial-nuevo", id: fid }, { selected: true });
      }
    }

    // Reset all areas-verdes feature states
    const avFeatures = m.querySourceFeatures("areas-verdes");
    const seenAvFids = new Set<number>();
    avFeatures.forEach((f) => {
      const fid = f.properties?.fid;
      if (fid != null && !seenAvFids.has(fid)) {
        seenAvFids.add(fid);
        m.setFeatureState({ source: "areas-verdes", id: fid }, { selected: false });
      }
    });
    if (businessSelection) {
      for (const fid of businessSelection.greenAreaFids) {
        m.setFeatureState({ source: "areas-verdes", id: fid }, { selected: true });
      }
    }
  }, [businessSelection, loaded]);

  // Update draw layers when streets or active vertices change
  useEffect(() => {
    if (!map.current || !loaded) return;
    const m = map.current;

    // Finalized streets
    const streetsSrc = m.getSource("draw-streets") as mapboxgl.GeoJSONSource;
    if (streetsSrc) {
      streetsSrc.setData(streetsToGeoJSON(drawnStreets || []));
    }

    // Active line (with cursor preview)
    const activeSrc = m.getSource("draw-active-line") as mapboxgl.GeoJSONSource;
    if (activeSrc) {
      const verts = activeVertices || [];
      activeSrc.setData(
        activeLineToGeoJSON(verts, cursorPosRef.current || undefined)
      );
    }

    // Vertices (dots)
    const vertsSrc = m.getSource("draw-vertices") as mapboxgl.GeoJSONSource;
    if (vertsSrc) {
      const allVerts: [number, number][] = [
        ...(drawnStreets || []).flatMap((s) => s.coordinates),
        ...(activeVertices || []),
      ];
      vertsSrc.setData(verticesToGeoJSON(allVerts));
    }
  }, [drawnStreets, activeVertices, loaded]);

  // Change cursor in draw mode
  useEffect(() => {
    if (!map.current || !loaded) return;
    const canvas = map.current.getCanvas();
    if (drawMode) {
      canvas.style.cursor = "crosshair";
    } else {
      canvas.style.cursor = "";
    }
  }, [drawMode, loaded]);

  // Animate active line with cursor position (requestAnimationFrame loop)
  useEffect(() => {
    if (!map.current || !loaded || !drawMode) return;
    const m = map.current;
    let rafId: number;

    const animate = () => {
      const activeSrc = m.getSource("draw-active-line") as mapboxgl.GeoJSONSource;
      if (activeSrc && activeVertices && activeVertices.length > 0) {
        activeSrc.setData(
          activeLineToGeoJSON(activeVertices, cursorPosRef.current || undefined)
        );
      }
      rafId = requestAnimationFrame(animate);
    };
    rafId = requestAnimationFrame(animate);

    return () => cancelAnimationFrame(rafId);
  }, [drawMode, activeVertices, loaded]);

  return (
    <div className="relative w-full h-full">
      <div ref={mapContainer} className="w-full h-full" />
      {/* Box selection rectangle overlay */}
      {boxSelect && (
        <div
          className="absolute border-2 border-blue-400 bg-blue-400/15 pointer-events-none z-50"
          style={{
            left: Math.min(boxSelect.startX, boxSelect.endX),
            top: Math.min(boxSelect.startY, boxSelect.endY),
            width: Math.abs(boxSelect.endX - boxSelect.startX),
            height: Math.abs(boxSelect.endY - boxSelect.startY),
          }}
        />
      )}
    </div>
  );
}
