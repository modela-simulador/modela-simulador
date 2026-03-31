"use client";

import { useState, useCallback, useMemo, useEffect } from "react";
import dynamic from "next/dynamic";
import MacrolotePanel from "@/components/sidebar/MacrolotePanel";
import ProductMixForm from "@/components/sidebar/ProductMixForm";
import MetricsPanel from "@/components/sidebar/MetricsPanel";
import LotEditPanel from "@/components/sidebar/LotEditPanel";
import BusinessReportPanel from "@/components/sidebar/BusinessReportPanel";
import ExportPanel from "@/components/sidebar/ExportPanel";
import InfraCostPanel from "@/components/sidebar/InfraCostPanel";
import CabidaLoader from "@/components/ui/CabidaLoader";
import StreetDrawPanel from "@/components/sidebar/StreetDrawPanel";
import { PRODUCTS, getDistrictsForFids } from "@/lib/constants";
import { createEmptyDrawState, nextStreetId, type DrawnStreet } from "@/lib/street-draw-state";
import type { MacroloteFeature, ProductAllocation, SubdivisionResult, CabidaEntry, BusinessSelection } from "@/lib/types";

const MasterplanMap = dynamic(() => import("@/components/map/MasterplanMap"), {
  ssr: false,
  loading: () => (
    <div className="w-full h-full flex items-center justify-center bg-zinc-900">
      <p className="text-zinc-400">Cargando mapa...</p>
    </div>
  ),
});

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

/** Build a stable key from an array of FIDs */
function makeCabidaId(fids: string[]): string {
  return [...fids].sort().join(",");
}

export default function Home() {
  const [selectedMacrolotes, setSelectedMacrolotes] = useState<MacroloteFeature[]>([]);
  const [isGenerating, setIsGenerating] = useState(false);
  const [generateError, setGenerateError] = useState<string | null>(null);

  // Persistent cabida results — each iteration stored independently
  const [cabidaHistory, setCabidaHistory] = useState<CabidaEntry[]>([]);
  // Which cabida entry is "active" for editing (the latest generated for current selection)
  const [activeCabidaId, setActiveCabidaId] = useState<string | null>(null);
  const [selectedLotIndex, setSelectedLotIndex] = useState<number | null>(null);

  // Multi-element selection for business analysis
  const [businessSelection, setBusinessSelection] = useState<BusinessSelection>({
    lotIndices: [],
    structuralStreetFids: [],
    greenAreaFids: [],
  });

  // Street drawing state
  const [drawState, setDrawState] = useState(createEmptyDrawState);

  // Pre-fetch infrastructure area data at app level so it's ready for all panels
  const [vialAreaMap, setVialAreaMap] = useState<Record<number, number>>({});
  const [greenAreaMap, setGreenAreaMap] = useState<Record<number, number>>({});
  useEffect(() => {
    fetch("/data/vial-nuevo.geojson").then(r => r.json()).then(data => {
      const m: Record<number, number> = {};
      for (const f of data.features) m[f.properties.fid] = f.properties.Area || 0;
      setVialAreaMap(m);
    });
    fetch("/data/areas-verdes.geojson").then(r => r.json()).then(data => {
      const m: Record<number, number> = {};
      for (const f of data.features) m[f.properties.fid] = f.properties.Arae || f.properties.Area || 0;
      setGreenAreaMap(m);
    });
  }, []);

  const activeEntry = useMemo(
    () => cabidaHistory.find((e) => e.id === activeCabidaId) ?? null,
    [cabidaHistory, activeCabidaId],
  );

  const totalAreaHa = useMemo(() => {
    return selectedMacrolotes.reduce((sum, m) => sum + (m.properties.Area || 0), 0) / 10000;
  }, [selectedMacrolotes]);

  // Determine which district(s) the selected macrolotes belong to
  const activeDistricts = useMemo(() => {
    const fids = selectedMacrolotes.map((m) => m.properties.fid);
    return getDistrictsForFids(fids);
  }, [selectedMacrolotes]);

  // Check if anything is selected for business analysis
  const hasBusinessSelection = useMemo(() => {
    return businessSelection.lotIndices.length > 0 ||
           businessSelection.structuralStreetFids.length > 0 ||
           businessSelection.greenAreaFids.length > 0;
  }, [businessSelection]);

  // Infrastructure selected without an active cabida — show cost panel
  const hasInfraOnly = useMemo(() => {
    return !activeEntry && (
      businessSelection.structuralStreetFids.length > 0 ||
      businessSelection.greenAreaFids.length > 0
    );
  }, [activeEntry, businessSelection]);

  // Accumulated metrics across all cabida iterations
  const accumulatedMetrics = useMemo(() => {
    if (cabidaHistory.length === 0) return null;
    let totalLots = 0;
    let totalUnits = 0;
    let totalValueUF = 0;
    const unitsByProduct: Record<string, number> = {};
    const valueByProduct: Record<string, number> = {};

    for (const entry of cabidaHistory) {
      const m = entry.result.metrics;
      totalLots += m.totalLots;
      totalUnits += m.totalUnits;
      totalValueUF += m.totalValueUF;
      for (const [pid, units] of Object.entries(m.unitsByProduct)) {
        unitsByProduct[pid] = (unitsByProduct[pid] || 0) + units;
      }
      for (const [pid, val] of Object.entries(m.valueByProduct)) {
        valueByProduct[pid] = (valueByProduct[pid] || 0) + val;
      }
    }
    return { totalLots, totalUnits, totalValueUF, unitsByProduct, valueByProduct, iterations: cabidaHistory.length };
  }, [cabidaHistory]);

  /** Select macrolotes — supports Shift+Click for multi-select */
  const handleSelect = useCallback((feature: MacroloteFeature | null, shiftKey?: boolean) => {
    if (!feature) {
      if (!shiftKey) {
        setSelectedMacrolotes([]);
        setSelectedLotIndex(null);
        setBusinessSelection({ lotIndices: [], structuralStreetFids: [], greenAreaFids: [] });
      }
      return;
    }

    if (shiftKey) {
      // Shift+click: toggle this macrolote in/out — only clear lot indices, preserve infra selection
      setSelectedLotIndex(null);
      setBusinessSelection((prev) => ({ ...prev, lotIndices: [] }));
      setSelectedMacrolotes((prev) => {
        const exists = prev.find((m) => m.properties.fid === feature.properties.fid);
        if (exists) return prev.filter((m) => m.properties.fid !== feature.properties.fid);
        return [...prev, feature];
      });
    } else {
      // Normal click: select only this macrolote — only clear lot indices, preserve infra selection
      setSelectedLotIndex(null);
      setBusinessSelection((prev) => ({ ...prev, lotIndices: [] }));
      setSelectedMacrolotes([feature]);
    }
  }, []);

  // Update activeCabidaId when selection changes
  const currentSelectionId = useMemo(
    () => makeCabidaId(selectedMacrolotes.map((m) => m.properties.fid)),
    [selectedMacrolotes],
  );
  const hasExistingCabida = useMemo(
    () => cabidaHistory.some((e) => e.id === currentSelectionId),
    [cabidaHistory, currentSelectionId],
  );

  /** Click on a lot — toggle in business selection */
  const handleLotClick = useCallback((lotIndex: number, cabidaId?: string) => {
    if (cabidaId) setActiveCabidaId(cabidaId);
    setSelectedLotIndex(lotIndex);

    // Also add/toggle in business selection
    setBusinessSelection((prev) => {
      const exists = prev.lotIndices.includes(lotIndex);
      return {
        ...prev,
        lotIndices: exists
          ? prev.lotIndices.filter((i) => i !== lotIndex)
          : [...prev.lotIndices, lotIndex],
      };
    });
  }, []);

  /** Click on a structural road — toggle fid in business selection */
  const handleStructuralStreetClick = useCallback((fid: number, areaM2: number) => {
    setBusinessSelection((prev) => {
      const exists = prev.structuralStreetFids.includes(fid);
      return {
        ...prev,
        structuralStreetFids: exists
          ? prev.structuralStreetFids.filter((f) => f !== fid)
          : [...prev.structuralStreetFids, fid],
      };
    });
  }, []);

  /** Click on a central green area — toggle fid in business selection */
  const handleGreenAreaClick = useCallback((fid: number, areaM2: number) => {
    setBusinessSelection((prev) => {
      const exists = prev.greenAreaFids.includes(fid);
      return {
        ...prev,
        greenAreaFids: exists
          ? prev.greenAreaFids.filter((f) => f !== fid)
          : [...prev.greenAreaFids, fid],
      };
    });
  }, []);

  /** Clear business selection */
  const handleClearBusinessSelection = useCallback(() => {
    setBusinessSelection({ lotIndices: [], structuralStreetFids: [], greenAreaFids: [] });
    setSelectedLotIndex(null);
  }, []);

  const handleChangeProduct = useCallback((lotIndex: number, newProductId: string) => {
    if (!activeCabidaId) return;
    const product = PRODUCTS.find((p) => p.id === newProductId);
    if (!product) return;

    setCabidaHistory((prev) =>
      prev.map((entry) => {
        if (entry.id !== activeCabidaId) return entry;

        const updatedLots = entry.result.lots.map((lot, i) => {
          if (i !== lotIndex) return lot;
          const newUnits = product.efficiency > 0 ? Math.round((lot.areaM2 / 10000) * product.efficiency) : 0;
          return { ...lot, product: newProductId, units: newUnits };
        });

        const totalLots = updatedLots.length;
        const totalUnits = updatedLots.reduce((s, l) => s + l.units, 0);
        const unitsByProduct: Record<string, number> = {};
        updatedLots.forEach((l) => {
          unitsByProduct[l.product] = (unitsByProduct[l.product] || 0) + l.units;
        });
        const totalLotArea = updatedLots.reduce((s, l) => s + l.areaM2, 0);
        const totalArea = totalLotArea + entry.result.metrics.streetAreaM2 + entry.result.metrics.parkAreaM2;
        const efficiencyPct = Math.round((totalLotArea / totalArea) * 100);
        const densityPerHa = Math.round(totalUnits / (totalArea / 10000));

        return {
          ...entry,
          result: {
            ...entry.result,
            lots: updatedLots,
            metrics: { ...entry.result.metrics, totalLots, totalUnits, unitsByProduct, efficiencyPct, densityPerHa },
          },
        };
      }),
    );
  }, [activeCabidaId]);

  // ── Street drawing handlers ──────────────────────────────────
  const handleToggleDraw = useCallback(() => {
    setDrawState((prev) => ({
      ...prev,
      isDrawing: !prev.isDrawing,
      activeVertices: [], // reset active line when toggling
    }));
  }, []);

  const handleDrawClick = useCallback((lngLat: [number, number]) => {
    setDrawState((prev) => ({
      ...prev,
      activeVertices: [...prev.activeVertices, lngLat],
    }));
  }, []);

  const handleFinishLine = useCallback(() => {
    setDrawState((prev) => {
      if (prev.activeVertices.length < 2) return prev;
      const newStreet: DrawnStreet = {
        id: nextStreetId(),
        coordinates: prev.activeVertices,
        widthM: 12,
      };
      return {
        ...prev,
        streets: [...prev.streets, newStreet],
        activeVertices: [],
        // Stay in drawing mode so user can draw more streets
      };
    });
  }, []);

  const handleDrawDoubleClick = useCallback(() => {
    // Double-click adds a point AND finishes — we need to finish with current vertices
    setDrawState((prev) => {
      if (prev.activeVertices.length < 2) return prev;
      const newStreet: DrawnStreet = {
        id: nextStreetId(),
        coordinates: prev.activeVertices,
        widthM: 12,
      };
      return {
        ...prev,
        streets: [...prev.streets, newStreet],
        activeVertices: [],
      };
    });
  }, []);

  const handleUndoVertex = useCallback(() => {
    setDrawState((prev) => ({
      ...prev,
      activeVertices: prev.activeVertices.slice(0, -1),
    }));
  }, []);

  const handleDeleteStreet = useCallback((id: string) => {
    setDrawState((prev) => ({
      ...prev,
      streets: prev.streets.filter((s) => s.id !== id),
    }));
  }, []);

  const handleClearAllStreets = useCallback(() => {
    setDrawState((prev) => ({
      ...prev,
      streets: [],
      activeVertices: [],
    }));
  }, []);

  // Keyboard shortcuts for draw mode
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (!drawState.isDrawing) return;
      if (e.key === "Enter") {
        handleFinishLine();
      } else if (e.key === "Escape") {
        setDrawState((prev) => ({ ...prev, activeVertices: [], isDrawing: false }));
      } else if ((e.key === "z" || e.key === "Z") && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        handleUndoVertex();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [drawState.isDrawing, handleFinishLine, handleUndoVertex]);

  const handleGenerate = useCallback(async (allocations: ProductAllocation[]) => {
    if (selectedMacrolotes.length === 0) return;
    setIsGenerating(true);
    setGenerateError(null);

    try {
      const fids = selectedMacrolotes.map((m) => m.properties.fid);
      const cabidaId = makeCabidaId(fids);

      // Calculate max housing units from district constraints
      const maxViv = activeDistricts.length > 0
        ? activeDistricts.reduce((sum, d) => sum + d.maxViviendas, 0)
        : null;

      console.log("[Cabida] Generating with", drawState.streets.length, "custom streets",
        drawState.streets.map(s => ({ pts: s.coordinates.length, w: s.widthM })));

      const res = await fetch(`${API_URL}/subdivide`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          macrolote_fids: fids,
          product_allocations: allocations.map((a) => ({
            family_id: a.familyId,
            product_id: a.productId,
            percentage: a.percentage,
            ...(a.lotSizeM2 ? { lot_size_m2: a.lotSizeM2 } : {}),
          })),
          ...(maxViv !== null ? { max_viviendas: maxViv } : {}),
          ...(drawState.streets.length > 0 ? {
            custom_streets: drawState.streets.map((s) => ({
              coordinates: s.coordinates,
              width_m: s.widthM,
            })),
          } : {}),
        }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({ detail: "Error desconocido del servidor" }));
        console.error("Subdivision error:", err);
        setGenerateError(err.detail || "Error al generar cabida");
        return;
      }

      const data = await res.json();
      const result: SubdivisionResult = {
        streets: data.streets.map((s: Record<string, unknown>) => ({
          geometry: s.geometry,
          areaM2: s.area_m2 as number,
        })),
        lots: data.lots.map((l: Record<string, unknown>) => ({
          geometry: l.geometry,
          product: l.product,
          areaM2: l.area_m2,
          units: l.units,
          frontageM: l.frontage_m,
        })),
        parks: data.parks.map((p: Record<string, unknown>) => ({
          geometry: p.geometry,
          areaM2: p.area_m2 as number,
        })),
        metrics: {
          totalLots: data.metrics.total_lots,
          totalUnits: data.metrics.total_units,
          unitsByProduct: data.metrics.units_by_product,
          streetAreaM2: data.metrics.street_area_m2,
          parkAreaM2: data.metrics.park_area_m2,
          efficiencyPct: data.metrics.efficiency_pct,
          densityPerHa: data.metrics.density_per_ha,
          totalValueUF: data.metrics.total_value_uf || 0,
          valueByProduct: data.metrics.value_by_product || {},
          streetCostUF: data.metrics.street_cost_uf || 0,
          greenCostUF: data.metrics.green_cost_uf || 0,
          landCostUF: data.metrics.land_cost_uf || 0,
          totalCostUF: data.metrics.total_cost_uf || 0,
          netValueUF: data.metrics.net_value_uf || 0,
          macroAreaM2: data.metrics.macro_area_m2 || 0,
        },
      };

      const newEntry: CabidaEntry = { id: cabidaId, fids, result };

      // Append or replace: keep cabidas for OTHER macrolotes, only
      // replace the one for the same FIDs. This way iterating across
      // different lots accumulates results in the history.
      setCabidaHistory((prev) => {
        const filtered = prev.filter((e) => e.id !== cabidaId);
        return [...filtered, newEntry];
      });
      setActiveCabidaId(cabidaId);
      setSelectedLotIndex(null);
      // Keep structural infra selections — only clear lot indices
      setBusinessSelection((prev) => ({ ...prev, lotIndices: [] }));
      // Clear drawn streets after generation — they're now part of the cabida result (gray)
      if (drawState.streets.length > 0) {
        setDrawState(createEmptyDrawState());
      }
    } catch (err) {
      console.error("Failed to call subdivision API:", err);
      setGenerateError("No se pudo conectar al servidor");
    } finally {
      setIsGenerating(false);
    }
  }, [selectedMacrolotes, drawState.streets, activeDistricts]);

  const handleRemoveCabida = useCallback((cabidaId: string) => {
    setCabidaHistory((prev) => prev.filter((e) => e.id !== cabidaId));
    if (activeCabidaId === cabidaId) {
      setActiveCabidaId(null);
      setSelectedLotIndex(null);
      setBusinessSelection({ lotIndices: [], structuralStreetFids: [], greenAreaFids: [] });
    }
  }, [activeCabidaId]);

  const handleClearAll = useCallback(() => {
    setCabidaHistory([]);
    setActiveCabidaId(null);
    setSelectedLotIndex(null);
    setBusinessSelection({ lotIndices: [], structuralStreetFids: [], greenAreaFids: [] });
  }, []);

  /** Save current cabida and free the panel for a new macrolote selection */
  const handleSaveCabida = useCallback(() => {
    // The cabida is already in history — just deselect macrolotes to free the panel
    setSelectedMacrolotes([]);
    setActiveCabidaId(null);
    setSelectedLotIndex(null);
    setBusinessSelection({ lotIndices: [], structuralStreetFids: [], greenAreaFids: [] });
  }, []);

  const fidsLabel = selectedMacrolotes.map((m) => m.properties.fid).join(", ");

  return (
    <div className="flex h-screen bg-zinc-950">
      {/* Left panel — Business Report (when cabida exists) OR Infra Cost (when only infra selected) */}
      {activeEntry ? (
        <div className="w-80 border-r border-zinc-800 flex-shrink-0">
          <BusinessReportPanel
            result={activeEntry.result}
            fidsLabel={fidsLabel}
            totalAreaHa={totalAreaHa}
            selection={businessSelection}
            vialAreaMap={vialAreaMap}
            greenAreaMap={greenAreaMap}
            onClear={handleClearBusinessSelection}
          />
        </div>
      ) : hasInfraOnly ? (
        <div className="w-72 border-r border-zinc-800 flex-shrink-0">
          <InfraCostPanel
            selection={businessSelection}
            vialAreaMap={vialAreaMap}
            greenAreaMap={greenAreaMap}
            onClear={handleClearBusinessSelection}
          />
        </div>
      ) : null}

      {/* Map */}
      <div className="flex-1 relative">
        {isGenerating && <CabidaLoader />}
        {generateError && (
          <div className="absolute top-4 left-1/2 -translate-x-1/2 z-50 bg-red-900/90 border border-red-500 text-red-100 px-4 py-3 rounded-lg shadow-lg max-w-md text-sm flex items-center gap-3">
            <span className="text-red-400 text-lg">⚠</span>
            <span className="flex-1">{generateError}</span>
            <button
              onClick={() => setGenerateError(null)}
              className="text-red-400 hover:text-red-200 font-bold"
            >
              ✕
            </button>
          </div>
        )}
        <MasterplanMap
          onMacroloteSelect={handleSelect}
          selectedMacrolotes={selectedMacrolotes}
          cabidaHistory={cabidaHistory}
          activeCabidaId={activeCabidaId}
          onLotClick={handleLotClick}
          onStructuralStreetClick={handleStructuralStreetClick}
          onGreenAreaClick={handleGreenAreaClick}
          selectedLotIndex={selectedLotIndex}
          businessSelection={businessSelection}
          drawMode={drawState.isDrawing}
          drawnStreets={drawState.streets}
          activeVertices={drawState.activeVertices}
          onDrawClick={handleDrawClick}
          onDrawDoubleClick={handleDrawDoubleClick}
        />
        <div className="absolute top-4 left-4 z-10">
          <h1 className="text-xl font-bold text-white tracking-tight">
            BatucoTerra — Generador de Cabidas
          </h1>
          <p className="text-sm text-zinc-400 mt-0.5">
            {selectedMacrolotes.length > 0
              ? `Lotes ${fidsLabel} — ${totalAreaHa.toFixed(1)} ha`
              : "Click en un macrolote · Shift+Click para multi-selección"}
          </p>
        </div>

        {/* Accumulated badge */}
        {accumulatedMetrics && accumulatedMetrics.iterations > 0 && (
          <div className="absolute bottom-8 left-4 z-10 bg-zinc-900/90 backdrop-blur border border-zinc-700 rounded-lg px-4 py-3 text-sm">
            <div className="text-zinc-400 font-medium mb-1">
              {accumulatedMetrics.iterations} iteracion{accumulatedMetrics.iterations > 1 ? "es" : ""}
            </div>
            <div className="text-white font-bold">
              {accumulatedMetrics.totalLots} lotes · {accumulatedMetrics.totalUnits.toLocaleString()} viv
            </div>
            <div className="text-emerald-400 text-xs">
              {Math.round(accumulatedMetrics.totalValueUF).toLocaleString()} UF total
            </div>
            {accumulatedMetrics.iterations > 1 && (
              <button
                onClick={handleClearAll}
                className="mt-2 text-xs text-red-400 hover:text-red-300 transition-colors"
              >
                Limpiar todo
              </button>
            )}
          </div>
        )}
      </div>

      {/* Right sidebar — config & metrics */}
      {selectedMacrolotes.length > 0 && (
        <div className="w-96 bg-zinc-900 border-l border-zinc-800 p-4 overflow-y-auto flex flex-col gap-6">
          <MacrolotePanel
            macrolotes={selectedMacrolotes}
            onClose={() => { setSelectedMacrolotes([]); setSelectedLotIndex(null); setBusinessSelection({ lotIndices: [], structuralStreetFids: [], greenAreaFids: [] }); }}
          />

          {/* Street drawing tool — always visible when macrolotes selected */}
          <StreetDrawPanel
            isDrawing={drawState.isDrawing}
            streets={drawState.streets}
            activeVertexCount={drawState.activeVertices.length}
            onToggleDraw={handleToggleDraw}
            onFinishLine={handleFinishLine}
            onDeleteStreet={handleDeleteStreet}
            onClearAll={handleClearAllStreets}
            onUndo={handleUndoVertex}
          />

          {activeEntry ? (
            <>
              <MetricsPanel
                result={activeEntry.result}
                label={`Cabida: Lotes ${activeEntry.fids.join(", ")}`}
                onReset={() => handleRemoveCabida(activeEntry.id)}
              />

              {/* Save button — frees panel for next macrolote */}
              <button
                onClick={handleSaveCabida}
                className="w-full py-2.5 px-4 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-semibold text-sm transition-colors flex items-center justify-center gap-2"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
                Guardar Cabida
              </button>

              {selectedLotIndex !== null && activeEntry.result.lots[selectedLotIndex] && (
                <LotEditPanel
                  lot={activeEntry.result.lots[selectedLotIndex]}
                  lotIndex={selectedLotIndex}
                  onChangeProduct={handleChangeProduct}
                  onDeselect={() => setSelectedLotIndex(null)}
                />
              )}

              <details className="group border-t border-zinc-800 pt-2">
                <summary className="flex items-center justify-between cursor-pointer text-sm font-semibold text-zinc-400 hover:text-zinc-200 transition-colors py-2">
                  <span>Modificar Mix de Productos</span>
                  <svg className="w-4 h-4 transition-transform group-open:rotate-180" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                  </svg>
                </summary>
                <ProductMixForm
                  areaHa={totalAreaHa}
                  onGenerate={handleGenerate}
                  isGenerating={isGenerating}
                  districts={activeDistricts}
                />
              </details>

              <ExportPanel
                subdivision={activeEntry.result}
                macroloteFid={activeEntry.fids.join(", ")}
              />
            </>
          ) : (
            <ProductMixForm
              areaHa={totalAreaHa}
              onGenerate={handleGenerate}
              isGenerating={isGenerating}
            />
          )}

          {cabidaHistory.length > 1 && (
            <div className="border-t border-zinc-800 pt-4">
              <h3 className="text-sm font-semibold text-zinc-300 mb-3">Historial de Cabidas</h3>
              <div className="flex flex-col gap-2">
                {cabidaHistory.map((entry) => (
                  <button
                    key={entry.id}
                    onClick={() => { setActiveCabidaId(entry.id); setSelectedLotIndex(null); }}
                    className={`flex items-center justify-between px-3 py-2 rounded-lg text-left text-sm transition-colors ${
                      entry.id === activeCabidaId
                        ? "bg-blue-600/20 border border-blue-500/50 text-white"
                        : "bg-zinc-800 hover:bg-zinc-700 text-zinc-300 border border-transparent"
                    }`}
                  >
                    <div>
                      <div className="font-medium">Lotes {entry.fids.join(", ")}</div>
                      <div className="text-xs text-zinc-400">
                        {entry.result.metrics.totalLots} lotes · {entry.result.metrics.totalUnits} viv · {Math.round(entry.result.metrics.totalValueUF).toLocaleString()} UF
                      </div>
                    </div>
                    <span
                      onClick={(e) => { e.stopPropagation(); handleRemoveCabida(entry.id); }}
                      className="text-zinc-500 hover:text-red-400 ml-2 cursor-pointer"
                    >
                      ✕
                    </span>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
