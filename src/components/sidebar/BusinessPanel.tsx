"use client";

import { useMemo, useEffect, useState } from "react";
import { PRODUCTS } from "@/lib/constants";
import { INFRA_COSTS } from "@/lib/types";
import { BASE_PATH } from "@/lib/base-path";
import type { SubdivisionResult, BusinessSelection } from "@/lib/types";

interface BusinessPanelProps {
  result: SubdivisionResult;
  /** If null, shows global analysis of entire cabida */
  selection: BusinessSelection | null;
  onClear: () => void;
}

/** Cached GeoJSON feature areas indexed by fid */
interface FeatureAreaMap {
  [fid: number]: number; // fid → area in m²
}

function calcLotIncome(lot: { product: string; areaM2: number; units: number }): number {
  const product = PRODUCTS.find((p) => p.id === lot.product);
  if (!product) return 0;
  if (product.landValueUFm2 > 0) return lot.areaM2 * product.landValueUFm2;
  const incidencia =
    product.family === "casas" || product.family === "townhouses"
      ? 0.10
      : product.family === "ds19"
        ? 0.12
        : 0.14;
  return lot.units * product.priceUF * incidencia;
}

export default function BusinessPanel({ result, selection, onClear }: BusinessPanelProps) {
  const isFiltered = selection !== null;

  // Load structural feature areas from GeoJSON (cached once)
  const [vialAreas, setVialAreas] = useState<FeatureAreaMap>({});
  const [greenAreas, setGreenAreas] = useState<FeatureAreaMap>({});

  useEffect(() => {
    fetch(`${BASE_PATH}/data/vial-nuevo.geojson`)
      .then((r) => r.json())
      .then((data) => {
        const map: FeatureAreaMap = {};
        for (const f of data.features) {
          map[f.properties.fid] = f.properties.Area || 0;
        }
        setVialAreas(map);
      });
    fetch(`${BASE_PATH}/data/areas-verdes.geojson`)
      .then((r) => r.json())
      .then((data) => {
        const map: FeatureAreaMap = {};
        for (const f of data.features) {
          map[f.properties.fid] = f.properties.Arae || f.properties.Area || 0;
        }
        setGreenAreas(map);
      });
  }, []);

  const analysis = useMemo(() => {
    // Lots: if filtered, use selected; otherwise all
    const selectedLots = isFiltered
      ? selection!.lotIndices.map((i) => result.lots[i]).filter(Boolean)
      : result.lots;

    // Structural infrastructure areas from GeoJSON by fid
    const selectedStreetFids = isFiltered ? selection!.structuralStreetFids : [];
    const selectedGreenFids = isFiltered ? selection!.greenAreaFids : [];

    const totalStructuralStreetArea = selectedStreetFids.reduce(
      (sum, fid) => sum + (vialAreas[fid] || 0), 0
    );
    const totalStructuralGreenArea = selectedGreenFids.reduce(
      (sum, fid) => sum + (greenAreas[fid] || 0), 0
    );

    // === INGRESOS ===
    const incomeByProduct: Record<string, { productName: string; color: string; units: number; income: number; areaM2: number }> = {};
    let totalIncome = 0;

    for (const lot of selectedLots) {
      const product = PRODUCTS.find((p) => p.id === lot.product);
      const income = calcLotIncome(lot);
      totalIncome += income;

      if (!incomeByProduct[lot.product]) {
        incomeByProduct[lot.product] = {
          productName: product?.name || lot.product,
          color: product?.color || "#666",
          units: 0,
          income: 0,
          areaM2: 0,
        };
      }
      incomeByProduct[lot.product].units += lot.units;
      incomeByProduct[lot.product].income += income;
      incomeByProduct[lot.product].areaM2 += lot.areaM2;
    }

    // === COSTOS ===
    const totalLotArea = selectedLots.reduce((s, l) => s + l.areaM2, 0);
    const landCost = totalLotArea * INFRA_COSTS.landUFm2;
    const streetCost = totalStructuralStreetArea * INFRA_COSTS.streetUFm2 * INFRA_COSTS.streetShareFactor;
    const greenCost = totalStructuralGreenArea * INFRA_COSTS.greenUFm2;
    const totalCost = landCost + streetCost + greenCost;
    const margin = totalIncome - totalCost;
    const marginPct = totalIncome > 0 ? (margin / totalIncome) * 100 : 0;

    return {
      selectedLots,
      numStreets: selectedStreetFids.length,
      numGreens: selectedGreenFids.length,
      incomeByProduct,
      totalIncome,
      totalLotArea,
      totalStructuralStreetArea,
      totalStructuralGreenArea,
      landCost,
      streetCost,
      greenCost,
      totalCost,
      margin,
      marginPct,
    };
  }, [result, selection, isFiltered, vialAreas, greenAreas]);

  const fmt = (v: number) => Math.round(v).toLocaleString();
  const fmtK = (v: number) => v >= 1000 ? `${(v / 1000).toFixed(1)}k` : fmt(v);

  // If not filtered, show a prompt to select infrastructure
  if (!isFiltered) {
    return (
      <div className="flex flex-col gap-3 bg-zinc-800/70 rounded-xl p-4 border border-zinc-700">
        <h3 className="text-sm font-bold text-white uppercase tracking-wider">
          Análisis de Negocio
        </h3>
        <p className="text-xs text-zinc-400">
          Selecciona lotes, vialidades estructurantes y áreas verdes centrales en el mapa para calcular ingresos, costos y margen.
        </p>

        {/* Quick global summary */}
        <div className="border-t border-zinc-700 pt-3">
          <p className="text-xs text-zinc-400 font-semibold mb-2 uppercase">Resumen Global</p>
          {Object.entries(analysis.incomeByProduct).map(([pid, data]) => (
            <div key={pid} className="flex items-center justify-between py-1">
              <div className="flex items-center gap-2 min-w-0">
                <div className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: data.color }} />
                <span className="text-sm text-zinc-200 truncate">{data.productName}</span>
              </div>
              <div className="flex items-center gap-2 flex-shrink-0">
                <span className="text-xs font-mono text-zinc-500">{(data.areaM2 / 10000).toFixed(1)}ha</span>
                {data.units > 0 && (
                  <span className="text-xs font-mono text-zinc-400">{data.units}viv</span>
                )}
                <span className="text-sm font-mono text-emerald-400">{fmtK(data.income)}</span>
              </div>
            </div>
          ))}
          <div className="flex justify-between pt-2 mt-1 border-t border-zinc-600">
            <span className="text-sm font-semibold text-white">Ingreso Total</span>
            <span className="text-sm font-mono font-bold text-emerald-400">{fmtK(analysis.totalIncome)} UF</span>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3 bg-zinc-800/70 rounded-xl p-4 border border-zinc-700">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-bold text-white uppercase tracking-wider">
          Análisis Selección
        </h3>
        <button
          onClick={onClear}
          className="text-xs text-zinc-400 hover:text-white transition-colors"
        >
          Ver todo
        </button>
      </div>

      {/* Selection summary */}
      <div className="flex gap-2 text-xs flex-wrap">
        {analysis.selectedLots.length > 0 && (
          <span className="bg-amber-500/20 text-amber-300 px-2 py-0.5 rounded">
            {analysis.selectedLots.length} lote{analysis.selectedLots.length > 1 ? "s" : ""}
          </span>
        )}
        {analysis.numStreets > 0 && (
          <span className="bg-blue-500/20 text-blue-300 px-2 py-0.5 rounded">
            {analysis.numStreets} vialidad{analysis.numStreets > 1 ? "es" : ""}
          </span>
        )}
        {analysis.numGreens > 0 && (
          <span className="bg-emerald-500/20 text-emerald-300 px-2 py-0.5 rounded">
            {analysis.numGreens} área{analysis.numGreens > 1 ? "s verdes" : " verde"}
          </span>
        )}
      </div>

      {/* INGRESOS */}
      <div className="border-t border-zinc-700 pt-3">
        <p className="text-xs text-zinc-400 font-semibold mb-2 uppercase">Ingresos por Producto</p>
        {Object.entries(analysis.incomeByProduct).map(([pid, data]) => (
          <div key={pid} className="flex items-center justify-between py-1">
            <div className="flex items-center gap-2 min-w-0">
              <div className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: data.color }} />
              <span className="text-sm text-zinc-200 truncate">{data.productName}</span>
            </div>
            <div className="flex items-center gap-2 flex-shrink-0">
              <span className="text-xs font-mono text-zinc-500">{(data.areaM2 / 10000).toFixed(1)}ha</span>
              {data.units > 0 && (
                <span className="text-xs font-mono text-zinc-400">{data.units}viv</span>
              )}
              <span className="text-sm font-mono text-emerald-400">{fmtK(data.income)}</span>
            </div>
          </div>
        ))}
        <div className="flex justify-between pt-2 mt-1 border-t border-zinc-600">
          <span className="text-sm font-semibold text-white">Total Ingresos</span>
          <span className="text-sm font-mono font-bold text-emerald-400">{fmtK(analysis.totalIncome)} UF</span>
        </div>
      </div>

      {/* COSTOS */}
      <div className="border-t border-zinc-700 pt-3">
        <p className="text-xs text-zinc-400 font-semibold mb-2 uppercase">Costos</p>

        <div className="flex items-center justify-between py-1">
          <div className="flex items-center gap-2">
            <div className="w-2.5 h-2.5 rounded bg-amber-800" />
            <span className="text-sm text-zinc-200">Terreno</span>
          </div>
          <div className="text-right">
            <span className="text-sm font-mono text-red-400">{fmtK(analysis.landCost)} UF</span>
            <span className="text-xs text-zinc-500 ml-1">({fmt(analysis.totalLotArea)}m² × {INFRA_COSTS.landUFm2})</span>
          </div>
        </div>

        <div className="flex items-center justify-between py-1">
          <div className="flex items-center gap-2">
            <div className="w-2.5 h-2.5 rounded bg-blue-500" />
            <span className="text-sm text-zinc-200">Vialidad Estr.</span>
          </div>
          <div className="text-right">
            <span className="text-sm font-mono text-red-400">{fmtK(analysis.streetCost)} UF</span>
            <span className="text-xs text-zinc-500 ml-1">({fmt(analysis.totalStructuralStreetArea)}m² × {INFRA_COSTS.streetUFm2} × 50%)</span>
          </div>
        </div>

        <div className="flex items-center justify-between py-1">
          <div className="flex items-center gap-2">
            <div className="w-2.5 h-2.5 rounded bg-emerald-600" />
            <span className="text-sm text-zinc-200">Área Verde</span>
          </div>
          <div className="text-right">
            <span className="text-sm font-mono text-red-400">{fmtK(analysis.greenCost)} UF</span>
            <span className="text-xs text-zinc-500 ml-1">({fmt(analysis.totalStructuralGreenArea)}m² × {INFRA_COSTS.greenUFm2})</span>
          </div>
        </div>

        <div className="flex justify-between pt-2 mt-1 border-t border-zinc-600">
          <span className="text-sm font-semibold text-white">Total Costos</span>
          <span className="text-sm font-mono font-bold text-red-400">{fmtK(analysis.totalCost)} UF</span>
        </div>
      </div>

      {/* MARGEN */}
      <div className={`rounded-lg p-3 text-center ${analysis.margin >= 0 ? "bg-emerald-900/30 border border-emerald-700/50" : "bg-red-900/30 border border-red-700/50"}`}>
        <p className="text-xs text-zinc-400 mb-1">Margen</p>
        <p className={`text-2xl font-bold font-mono ${analysis.margin >= 0 ? "text-emerald-400" : "text-red-400"}`}>
          {fmtK(analysis.margin)} UF
        </p>
        <p className={`text-sm font-mono ${analysis.margin >= 0 ? "text-emerald-500" : "text-red-500"}`}>
          {analysis.marginPct.toFixed(1)}% sobre ingresos
        </p>
      </div>
    </div>
  );
}
