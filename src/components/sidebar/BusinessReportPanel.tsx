"use client";

import { useMemo } from "react";
import { PRODUCTS } from "@/lib/constants";
import { INFRA_COSTS } from "@/lib/types";
import type { SubdivisionResult, BusinessSelection } from "@/lib/types";

interface BusinessReportPanelProps {
  result: SubdivisionResult;
  fidsLabel: string;
  totalAreaHa: number;
  selection: BusinessSelection;
  vialAreaMap: Record<number, number>;
  greenAreaMap: Record<number, number>;
  onClear: () => void;
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

export default function BusinessReportPanel({
  result, fidsLabel, totalAreaHa, selection, vialAreaMap, greenAreaMap, onClear,
}: BusinessReportPanelProps) {
  const isFiltered = selection.lotIndices.length > 0 ||
    selection.structuralStreetFids.length > 0 ||
    selection.greenAreaFids.length > 0;

  const analysis = useMemo(() => {
    // If specific lots are selected, show only those; otherwise show all lots
    const hasLotFilter = selection.lotIndices.length > 0;
    const selectedLots = hasLotFilter
      ? selection.lotIndices.map((i) => result.lots[i]).filter(Boolean)
      : result.lots;

    // Structural infrastructure is always from selection (independent of lot filter)
    const selectedStreetFids = selection.structuralStreetFids;
    const selectedGreenFids = selection.greenAreaFids;

    const totalStructuralStreetArea = selectedStreetFids.reduce(
      (sum, fid) => sum + (vialAreaMap[fid] || 0), 0
    );
    const totalStructuralGreenArea = selectedGreenFids.reduce(
      (sum, fid) => sum + (greenAreaMap[fid] || 0), 0
    );

    // Group by product
    const byProduct: Record<string, {
      name: string; color: string; family: string;
      areaM2: number; units: number; income: number; lots: number;
      priceUF: number; landValueUFm2: number;
    }> = {};

    let totalIncome = 0;
    let totalLotArea = 0;

    for (const lot of selectedLots) {
      const product = PRODUCTS.find((p) => p.id === lot.product);
      if (!product) continue;
      const income = calcLotIncome(lot);
      totalIncome += income;
      totalLotArea += lot.areaM2;

      if (!byProduct[lot.product]) {
        byProduct[lot.product] = {
          name: product.name, color: product.color, family: product.family,
          areaM2: 0, units: 0, income: 0, lots: 0,
          priceUF: product.priceUF, landValueUFm2: product.landValueUFm2,
        };
      }
      byProduct[lot.product].areaM2 += lot.areaM2;
      byProduct[lot.product].units += lot.units;
      byProduct[lot.product].income += income;
      byProduct[lot.product].lots += 1;
    }

    // Costs — internal streets (from API) + structural infra (user-selected)
    const landCost = result.metrics.landCostUF || totalLotArea * INFRA_COSTS.landUFm2;
    const internalStreetCost = result.metrics.streetCostUF || 0;
    const structuralStreetCost = totalStructuralStreetArea * INFRA_COSTS.streetUFm2 * INFRA_COSTS.streetShareFactor;
    // Green cost is ONLY from user-selected structural green areas (not internal parks)
    const structuralGreenCost = totalStructuralGreenArea * INFRA_COSTS.greenUFm2;
    const streetCost = internalStreetCost + structuralStreetCost;
    const greenCost = structuralGreenCost;
    const totalCost = landCost + streetCost + greenCost;
    const margin = totalIncome - totalCost;
    const marginPct = totalIncome > 0 ? (margin / totalIncome) * 100 : 0;

    return {
      byProduct,
      totalIncome,
      totalLotArea,
      totalStructuralStreetArea,
      totalStructuralGreenArea,
      numStreets: selectedStreetFids.length,
      numGreens: selectedGreenFids.length,
      landCost,
      internalStreetCost,
      structuralStreetCost,
      streetCost,
      greenCost,
      totalCost,
      margin,
      marginPct,
      lotCount: selectedLots.length,
      totalUnits: selectedLots.reduce((s, l) => s + l.units, 0),
    };
  }, [result, selection, isFiltered, vialAreaMap, greenAreaMap]);

  const fmt = (v: number) => Math.round(v).toLocaleString();
  const fmtK = (v: number) => {
    if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`;
    if (v >= 1000) return `${(v / 1000).toFixed(1)}k`;
    return fmt(v);
  };

  return (
    <div className="flex flex-col h-full bg-zinc-950/95 backdrop-blur text-zinc-100 overflow-y-auto">
      {/* Header */}
      <div className="px-5 pt-5 pb-3 border-b border-zinc-800">
        <div className="flex items-center justify-between mb-1">
          <h2 className="text-xs font-semibold text-zinc-500 uppercase tracking-widest">
            Reporte de Negocio
          </h2>
          {isFiltered && (
            <button onClick={onClear} className="text-xs text-blue-400 hover:text-blue-300">
              Ver global
            </button>
          )}
        </div>
        <p className="text-lg font-bold text-white">
          {isFiltered ? "Selección parcial" : `Macrolotes ${fidsLabel}`}
        </p>
        <p className="text-xs text-zinc-500 mt-0.5">
          {totalAreaHa.toFixed(1)} ha brutas · {analysis.lotCount} lotes · {analysis.totalUnits.toLocaleString()} viv
        </p>
      </div>

      {/* Selection badges when filtered */}
      {isFiltered && (
        <div className="px-5 pt-3 flex gap-2 text-xs flex-wrap">
          {analysis.lotCount > 0 && (
            <span className="bg-amber-900/40 text-amber-300 px-2 py-0.5 rounded">
              {analysis.lotCount} lote{analysis.lotCount > 1 ? "s" : ""}
            </span>
          )}
          {analysis.numStreets > 0 && (
            <span className="bg-blue-900/40 text-blue-300 px-2 py-0.5 rounded">
              {analysis.numStreets} vialidad{analysis.numStreets > 1 ? "es" : ""}
            </span>
          )}
          {analysis.numGreens > 0 && (
            <span className="bg-emerald-900/40 text-emerald-300 px-2 py-0.5 rounded">
              {analysis.numGreens} AV
            </span>
          )}
        </div>
      )}

      {/* === INGRESOS === */}
      <div className="px-5 pt-4 pb-3">
        <h3 className="text-xs font-semibold text-zinc-500 uppercase tracking-widest mb-3">
          Ingresos
        </h3>

        {/* Product table */}
        <table className="w-full text-sm">
          <thead>
            <tr className="text-xs text-zinc-500 border-b border-zinc-800">
              <th className="text-left pb-2 font-medium">Producto</th>
              <th className="text-right pb-2 font-medium">Sup.</th>
              <th className="text-right pb-2 font-medium">Viv.</th>
              <th className="text-right pb-2 font-medium">UF/m²</th>
              <th className="text-right pb-2 font-medium">Total UF</th>
            </tr>
          </thead>
          <tbody>
            {Object.entries(analysis.byProduct).map(([pid, d]) => {
              const ufM2 = d.areaM2 > 0 ? d.income / d.areaM2 : 0;
              return (
                <tr key={pid} className="border-b border-zinc-800/50">
                  <td className="py-2">
                    <div className="flex items-center gap-2">
                      <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: d.color }} />
                      <span className="text-zinc-200">{d.name}</span>
                    </div>
                  </td>
                  <td className="py-2 text-right font-mono text-zinc-400">
                    {(d.areaM2 / 10000).toFixed(1)}
                  </td>
                  <td className="py-2 text-right font-mono text-zinc-300">
                    {d.units > 0 ? d.units.toLocaleString() : "—"}
                  </td>
                  <td className="py-2 text-right font-mono text-zinc-400">
                    {ufM2.toFixed(1)}
                  </td>
                  <td className="py-2 text-right font-mono text-emerald-400 font-medium">
                    {fmtK(d.income)}
                  </td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr className="border-t border-zinc-700">
              <td className="pt-3 font-semibold text-white" colSpan={2}>Total Ingresos</td>
              <td className="pt-3 text-right font-mono text-zinc-300">{analysis.totalUnits.toLocaleString()}</td>
              <td className="pt-3 text-right font-mono text-zinc-400">
                {analysis.totalLotArea > 0 ? (analysis.totalIncome / analysis.totalLotArea).toFixed(1) : "—"}
              </td>
              <td className="pt-3 text-right font-mono text-emerald-400 font-bold">{fmtK(analysis.totalIncome)}</td>
            </tr>
          </tfoot>
        </table>
      </div>

      {/* === COSTOS === */}
      <div className="px-5 pt-2 pb-3 border-t border-zinc-800">
        <h3 className="text-xs font-semibold text-zinc-500 uppercase tracking-widest mb-3">
          Costos
        </h3>

        <table className="w-full text-sm">
          <thead>
            <tr className="text-xs text-zinc-500 border-b border-zinc-800">
              <th className="text-left pb-2 font-medium">Concepto</th>
              <th className="text-right pb-2 font-medium">Sup. m²</th>
              <th className="text-right pb-2 font-medium">UF/m²</th>
              <th className="text-right pb-2 font-medium">Total UF</th>
            </tr>
          </thead>
          <tbody>
            <tr className="border-b border-zinc-800/50">
              <td className="py-2">
                <div className="flex items-center gap-2">
                  <div className="w-2 h-2 rounded bg-amber-800" />
                  <span className="text-zinc-200">Terreno</span>
                </div>
              </td>
              <td className="py-2 text-right font-mono text-zinc-400">{fmt(analysis.totalLotArea)}</td>
              <td className="py-2 text-right font-mono text-zinc-400">{INFRA_COSTS.landUFm2}</td>
              <td className="py-2 text-right font-mono text-red-400 font-medium">{fmtK(analysis.landCost)}</td>
            </tr>
            <tr className="border-b border-zinc-800/50">
              <td className="py-2">
                <div className="flex items-center gap-2">
                  <div className="w-2 h-2 rounded bg-slate-400" />
                  <span className="text-zinc-200">Calles internas</span>
                </div>
              </td>
              <td className="py-2 text-right font-mono text-zinc-400">
                {result.metrics.streetAreaM2 > 0 ? fmt(result.metrics.streetAreaM2) : "—"}
              </td>
              <td className="py-2 text-right font-mono text-zinc-400">{INFRA_COSTS.streetUFm2}</td>
              <td className="py-2 text-right font-mono text-red-400 font-medium">
                {analysis.internalStreetCost > 0 ? fmtK(analysis.internalStreetCost) : "—"}
              </td>
            </tr>
            <tr className="border-b border-zinc-800/50">
              <td className="py-2">
                <div className="flex items-center gap-2">
                  <div className="w-2 h-2 rounded bg-blue-500" />
                  <span className="text-zinc-200">Vialidad Estr.</span>
                  <span className="text-xs text-zinc-600">50%</span>
                </div>
              </td>
              <td className="py-2 text-right font-mono text-zinc-400">
                {analysis.totalStructuralStreetArea > 0 ? fmt(analysis.totalStructuralStreetArea) : "—"}
              </td>
              <td className="py-2 text-right font-mono text-zinc-400">{INFRA_COSTS.streetUFm2}</td>
              <td className="py-2 text-right font-mono text-red-400 font-medium">
                {analysis.structuralStreetCost > 0 ? fmtK(analysis.structuralStreetCost) : "—"}
              </td>
            </tr>
            <tr className="border-b border-zinc-800/50">
              <td className="py-2">
                <div className="flex items-center gap-2">
                  <div className="w-2 h-2 rounded bg-emerald-600" />
                  <span className="text-zinc-200">Área Verde</span>
                </div>
              </td>
              <td className="py-2 text-right font-mono text-zinc-400">
                {analysis.totalStructuralGreenArea > 0 ? fmt(analysis.totalStructuralGreenArea) : "—"}
              </td>
              <td className="py-2 text-right font-mono text-zinc-400">{INFRA_COSTS.greenUFm2}</td>
              <td className="py-2 text-right font-mono text-red-400 font-medium">
                {analysis.greenCost > 0 ? fmtK(analysis.greenCost) : "—"}
              </td>
            </tr>
          </tbody>
          <tfoot>
            <tr className="border-t border-zinc-700">
              <td className="pt-3 font-semibold text-white" colSpan={3}>Total Costos</td>
              <td className="pt-3 text-right font-mono text-red-400 font-bold">{fmtK(analysis.totalCost)}</td>
            </tr>
          </tfoot>
        </table>

        {analysis.numStreets === 0 && analysis.numGreens === 0 && (
          <p className="text-xs text-zinc-600 mt-2 italic">
            Selecciona vialidades y áreas verdes en el mapa para calcular costos de infraestructura
          </p>
        )}
      </div>

      {/* === MARGEN === */}
      <div className="px-5 pt-2 pb-5 border-t border-zinc-800">
        <h3 className="text-xs font-semibold text-zinc-500 uppercase tracking-widest mb-3">
          Resultado
        </h3>

        <div className="grid grid-cols-2 gap-3">
          <div className={`rounded-lg p-3 text-center ${
            analysis.margin >= 0 ? "bg-emerald-950/50 border border-emerald-800/40" : "bg-red-950/50 border border-red-800/40"
          }`}>
            <p className="text-xs text-zinc-500 mb-1">Margen</p>
            <p className={`text-xl font-bold font-mono ${analysis.margin >= 0 ? "text-emerald-400" : "text-red-400"}`}>
              {fmtK(analysis.margin)}
            </p>
            <p className="text-xs text-zinc-500">UF</p>
          </div>
          <div className={`rounded-lg p-3 text-center ${
            analysis.margin >= 0 ? "bg-emerald-950/50 border border-emerald-800/40" : "bg-red-950/50 border border-red-800/40"
          }`}>
            <p className="text-xs text-zinc-500 mb-1">% sobre ingreso</p>
            <p className={`text-xl font-bold font-mono ${analysis.margin >= 0 ? "text-emerald-400" : "text-red-400"}`}>
              {analysis.marginPct.toFixed(1)}%
            </p>
            <p className="text-xs text-zinc-500">margen</p>
          </div>
        </div>

        {/* Key ratios */}
        <div className="mt-3 grid grid-cols-3 gap-2 text-center">
          <div className="bg-zinc-900 rounded p-2">
            <p className="text-xs text-zinc-500">UF/m² ingreso</p>
            <p className="text-sm font-mono text-white font-medium">
              {analysis.totalLotArea > 0 ? (analysis.totalIncome / analysis.totalLotArea).toFixed(1) : "—"}
            </p>
          </div>
          <div className="bg-zinc-900 rounded p-2">
            <p className="text-xs text-zinc-500">UF/m² costo</p>
            <p className="text-sm font-mono text-white font-medium">
              {analysis.totalLotArea > 0 ? (analysis.totalCost / analysis.totalLotArea).toFixed(1) : "—"}
            </p>
          </div>
          <div className="bg-zinc-900 rounded p-2">
            <p className="text-xs text-zinc-500">viv/ha</p>
            <p className="text-sm font-mono text-white font-medium">
              {analysis.totalLotArea > 0 ? Math.round(analysis.totalUnits / (analysis.totalLotArea / 10000)) : "—"}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
