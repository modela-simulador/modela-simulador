"use client";

import { useEffect, useRef, useState, useMemo } from "react";
import mapboxgl from "mapbox-gl";
import { MAP_CENTER, MAP_ZOOM, LAYER_COLORS, PRODUCTS } from "@/lib/constants";
import type { MacroloteFeature, CabidaEntry, BusinessSelection } from "@/lib/types";

interface MasterplanMapProps {
  onMacroloteSelect: (feature: MacroloteFeature | null, shiftKey?: boolean) => void;
  selectedMacrolotes: MacroloteFeature[];
  cabidaHistory: CabidaEntry[];
  activeCabidaId: string | null;
  onLotClick?: (lotIndex: number, cabidaId?: string) => void;
  onStructuralStreetClick?: (fid: number, areaM2: number) => void;
  onGreenAreaClick?: (fid: number, areaM2: number) => void;
  selectedLotIndex?: number | null;
  businessSelection?: BusinessSelection;
}

// Build a color map for products
const PRODUCT_COLOR_MAP: Record<string, string> = {};
PRODUCTS.forEach((p) => { PRODUCT_COLOR_MAP[p.id] = p.color; });

export default function MasterplanMap({
  onMacroloteSelect, selectedMacrolotes, cabidaHistory, activeCabidaId,
  onLotClick, onStructuralStreetClick, onGreenAreaClick, selectedLotIndex, businessSelection,
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

  // Track selected macrolote fids so click handler knows if a macrolote is already selected
  const selectedMacroloteFidsRef = useRef<Set<string>>(new Set());
  selectedMacroloteFidsRef.current = new Set(selectedMacrolotes.map((m) => m.properties.fid));

  // Build combined GeoJSON from all cabida entries
  const combinedLots = useMemo(() => {
    const features: GeoJSON.Feature[] = [];
    for (const entry of cabidaHistory) {
      entry.result.lots.forEach((lot, i) => {
        const product = PRODUCTS.find((p) => p.id === lot.product);
        const isSelected = businessSelection?.lotIndices.includes(i) ? 1 : 0;
        features.push({
          type: "Feature",
          properties: {
            id: i,
            cabidaId: entry.id,
            product: lot.product,
            productName: product?.name || lot.product,
            color: product?.color || "#666",
            areaM2: lot.areaM2,
            units: lot.units,
            frontageM: lot.frontageM,
            isActive: entry.id === activeCabidaId ? 1 : 0,
            isSelected,
          },
          geometry: lot.geometry,
        });
      });
    }
    return { type: "FeatureCollection" as const, features };
  }, [cabidaHistory, activeCabidaId, businessSelection]);

  const combinedStreets = useMemo(() => {
    const features: GeoJSON.Feature[] = [];
    for (const entry of cabidaHistory) {
      entry.result.streets.forEach((street, i) => {
        features.push({
          type: "Feature",
          properties: { id: i, cabidaId: entry.id, areaM2: street.areaM2 },
          geometry: street.geometry,
        });
      });
    }
    return { type: "FeatureCollection" as const, features };
  }, [cabidaHistory]);

  const combinedParks = useMemo(() => {
    const features: GeoJSON.Feature[] = [];
    for (const entry of cabidaHistory) {
      entry.result.parks.forEach((park, i) => {
        features.push({
          type: "Feature",
          properties: { id: i, cabidaId: entry.id, areaM2: park.areaM2 },
          geometry: park.geometry,
        });
      });
    }
    return { type: "FeatureCollection" as const, features };
  }, [cabidaHistory]);

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
    });

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

      m.addLayer({
        id: "vial-fill", type: "fill", source: "vial-nuevo",
        paint: {
          "fill-color": ["case", ["boolean", ["feature-state", "selected"], false], "#60a5fa", LAYER_COLORS.vialNuevo],
          "fill-opacity": ["case", ["boolean", ["feature-state", "selected"], false], 0.7, 0.4],
        },
      });
      m.addLayer({
        id: "vial-outline", type: "line", source: "vial-nuevo",
        paint: {
          "line-color": ["case", ["boolean", ["feature-state", "selected"], false], "#93c5fd", LAYER_COLORS.vialNuevo],
          "line-width": ["case", ["boolean", ["feature-state", "selected"], false], 3, 0.5],
          "line-opacity": ["case", ["boolean", ["feature-state", "selected"], false], 1, 0.6],
        },
      });

      m.addLayer({
        id: "av-fill", type: "fill", source: "areas-verdes",
        paint: {
          "fill-color": ["case", ["boolean", ["feature-state", "selected"], false], "#4ade80", LAYER_COLORS.areasVerdes],
          "fill-opacity": ["case", ["boolean", ["feature-state", "selected"], false], 0.7, 0.35],
        },
      });
      m.addLayer({
        id: "av-outline", type: "line", source: "areas-verdes",
        paint: {
          "line-color": ["case", ["boolean", ["feature-state", "selected"], false], "#86efac", LAYER_COLORS.areasVerdes],
          "line-width": ["case", ["boolean", ["feature-state", "selected"], false], 3, 1],
          "line-opacity": ["case", ["boolean", ["feature-state", "selected"], false], 1, 0.7],
        },
      });

      m.addLayer({
        id: "lotes-fill", type: "fill", source: "lotes",
        paint: {
          "fill-color": ["case", ["boolean", ["feature-state", "selected"], false], LAYER_COLORS.lotesSelected, LAYER_COLORS.lotes],
          "fill-opacity": ["case", ["boolean", ["feature-state", "hover"], false], 0.5, ["boolean", ["feature-state", "selected"], false], 0.4, 0.15],
        },
      });
      m.addLayer({
        id: "lotes-outline", type: "line", source: "lotes",
        paint: {
          "line-color": ["case", ["boolean", ["feature-state", "selected"], false], "#60a5fa", "#cbd5e1"],
          "line-width": ["case", ["boolean", ["feature-state", "selected"], false], 4, 1],
          "line-opacity": ["case", ["boolean", ["feature-state", "selected"], false], 1, 0.8],
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
      m.addLayer({
        id: "cabida-lots-fill", type: "fill", source: "cabida-lots",
        paint: {
          "fill-color": ["get", "color"],
          "fill-opacity": [
            "case",
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
            ["==", ["get", "isSelected"], 1], "#fbbf24",
            ["==", ["get", "isActive"], 1], "#ffffff",
            "#94a3b8",
          ],
          "line-width": [
            "case",
            ["==", ["get", "isSelected"], 1], 3,
            ["==", ["get", "isActive"], 1], 2,
            1,
          ],
          "line-opacity": 0.9,
        },
      });

      // Internal streets — rendered ON TOP of lots so they're always visible.
      // Streets visually separate lots; rendering below lots made them transparent.
      m.addLayer({
        id: "cabida-streets-fill", type: "fill", source: "cabida-streets",
        paint: { "fill-color": "#475569", "fill-opacity": 0.95 },
      });
      m.addLayer({
        id: "cabida-streets-outline", type: "line", source: "cabida-streets",
        paint: { "line-color": "#94a3b8", "line-width": 1.5 },
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
        paint: { "text-color": "#ffffff", "text-halo-color": "#000000", "text-halo-width": 2 },
      });

      // Selected lot highlight (legacy single selection)
      m.addSource("cabida-selected-lot", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
      m.addLayer({
        id: "cabida-selected-lot-outline", type: "line", source: "cabida-selected-lot",
        paint: { "line-color": "#fbbf24", "line-width": 4, "line-opacity": 1 },
      });

      // Internal parks/green adjustments (not selectable — just visual)
      m.addLayer({
        id: "cabida-parks-fill", type: "fill", source: "cabida-parks",
        paint: { "fill-color": "#22c55e", "fill-opacity": 0.7 },
      });
      m.addLayer({
        id: "cabida-parks-outline", type: "line", source: "cabida-parks",
        paint: { "line-color": "transparent", "line-width": 1 },
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

      // Unified click handler — query ALL rendered features at click point
      m.on("click", (e) => {
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
      m.fitBounds(bounds, { padding: 120, maxZoom: 14.8, duration: 800 });
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

  return (
    <div ref={mapContainer} className="w-full h-full" />
  );
}
