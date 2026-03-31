"use client";

import { useMemo } from "react";
import { PRODUCTS } from "@/lib/constants";
import { INFRA_COSTS } from "@/lib/types";
import type { SubdivisionResult } from "@/lib/types";

interface MetricsPanelProps {
  result: SubdivisionResult;
  label?: string;
  onReset: () => void;
}

function calcLotValue(lot: { product: string; areaM2: number; units: number }): number {
  const product = PRODUCTS.find((p) => p.id === lot.product);
  if (!product) return 0;
  if (product.landValueUFm2 > 0) return lot.areaM2 * product.landValueUFm2;
  const incidencia = (product.family === "casas" || product.family === "townhouses") ? 0.10 : product.family === "ds19" ? 0.12 : 0.14;
  return lot.units * product.priceUF * incidencia;
}

export default function MetricsPanel({ result, label, onReset }: MetricsPanelProps) {
  const { metrics, lots } = result;

  const analysis = useMemo(() => {
    const totalValueUF = lots.reduce((sum, lot) => sum + calcLotValue(lot), 0);
    const valueByProduct: Record<string, number> = {};
    const areaByProduct: Record<string, number> = {};
    lots.forEach((lot) => {
      valueByProduct[lot.product] = (valueByProduct[lot.product] || 0) + calcLotValue(lot);
      areaByProduct[lot.product] = (areaByProduct[lot.product] || 0) + lot.areaM2;
    });
    const totalLotArea = lots.reduce((s, l) => s + l.areaM2, 0);

    // Infrastructure costs
    const streetCost = metrics.streetAreaM2 * INFRA_COSTS.streetUFm2;
    const parkCost = metrics.parkAreaM2 * INFRA_COSTS.greenUFm2;

    return { totalValueUF, valueByProduct, areaByProduct, totalLotArea, streetCost, parkCost };
  }, [lots, metrics]);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-zinc-300 uppercase tracking-wider">
          {label || "Resultados"}
        </h3>
        <button
          onClick={onReset}
          className="text-xs text-zinc-400 hover:text-white transition-colors"
        >
          Reiniciar
        </button>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 gap-2">
        <div className="bg-zinc-800/50 rounded-lg p-3 text-center">
          <p className="text-2xl font-bold text-white">{metrics.totalLots}</p>
          <p className="text-xs text-zinc-400">Lotes</p>
        </div>
        <div className="bg-zinc-800/50 rounded-lg p-3 text-center">
          <p className="text-2xl font-bold text-blue-400">{metrics.totalUnits.toLocaleString()}</p>
          <p className="text-xs text-zinc-400">Viviendas</p>
        </div>
        <div className="bg-zinc-800/50 rounded-lg p-3 text-center">
          <p className="text-2xl font-bold text-green-400">{metrics.efficiencyPct}%</p>
          <p className="text-xs text-zinc-400">Eficiencia</p>
        </div>
        <div className="bg-zinc-800/50 rounded-lg p-3 text-center">
          <p className="text-2xl font-bold text-amber-400">{(analysis.totalValueUF / 1000).toFixed(0)}k</p>
          <p className="text-xs text-zinc-400">Valor UF</p>
        </div>
      </div>

      {/* By product — with area % compliance */}
      <div className="bg-zinc-800/50 rounded-lg p-3">
        <p className="text-xs text-zinc-400 mb-2">Por producto — superficie & viviendas</p>
        {Object.entries(metrics.unitsByProduct).map(([productId, units]) => {
          const product = PRODUCTS.find((p) => p.id === productId);
          const value = analysis.valueByProduct[productId] || 0;
          const area = analysis.areaByProduct[productId] || 0;
          const areaPct = analysis.totalLotArea > 0 ? (area / analysis.totalLotArea * 100) : 0;
          return (
            <div key={productId} className="flex items-center justify-between py-1">
              <div className="flex items-center gap-2">
                <div
                  className="w-2.5 h-2.5 rounded-full"
                  style={{ backgroundColor: product?.color || "#666" }}
                />
                <span className="text-sm text-zinc-200">{product?.name || productId}</span>
                <span className="text-xs text-zinc-500">{areaPct.toFixed(0)}%</span>
              </div>
              <div className="flex gap-3">
                <span className="text-xs font-mono text-zinc-400">{(area / 10000).toFixed(1)}ha</span>
                {(units as number) > 0 && (
                  <span className="text-sm font-mono text-zinc-300">{(units as number).toLocaleString()} viv</span>
                )}
                {value > 0 && (
                  <span className="text-xs font-mono text-amber-400">{(value / 1000).toFixed(0)}k UF</span>
                )}
              </div>
            </div>
          );
        })}
        {/* Comercio/equipamiento with 0 units but has area */}
        {lots.filter((l) => {
          const p = PRODUCTS.find((pr) => pr.id === l.product);
          return p && (p.family === "comercio" || p.family === "equipamiento") && !metrics.unitsByProduct[l.product];
        }).length > 0 && (() => {
          // Group by product
          const specialProducts = new Map<string, { area: number; value: number }>();
          lots.forEach((lot) => {
            const p = PRODUCTS.find((pr) => pr.id === lot.product);
            if (!p || (p.family !== "comercio" && p.family !== "equipamiento")) return;
            if (metrics.unitsByProduct[lot.product]) return; // already shown above
            const existing = specialProducts.get(lot.product) || { area: 0, value: 0 };
            existing.area += lot.areaM2;
            existing.value += calcLotValue(lot);
            specialProducts.set(lot.product, existing);
          });
          return Array.from(specialProducts.entries()).map(([pid, data]) => {
            const product = PRODUCTS.find((p) => p.id === pid);
            if (!product) return null;
            const areaPct = analysis.totalLotArea > 0 ? (data.area / analysis.totalLotArea * 100) : 0;
            return (
              <div key={`special-${pid}`} className="flex items-center justify-between py-1">
                <div className="flex items-center gap-2">
                  <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: product.color }} />
                  <span className="text-sm text-zinc-200">{product.name}</span>
                  <span className="text-xs text-zinc-500">{areaPct.toFixed(0)}%</span>
                </div>
                <div className="flex gap-3">
                  <span className="text-xs font-mono text-zinc-400">{(data.area / 10000).toFixed(2)} ha</span>
                  {data.value > 0 && <span className="text-xs font-mono text-amber-400">{(data.value / 1000).toFixed(0)}k UF</span>}
                </div>
              </div>
            );
          });
        })()}
      </div>

      {/* Infrastructure with costs */}
      <div className="bg-zinc-800/50 rounded-lg p-3">
        <p className="text-xs text-zinc-400 mb-1">Infraestructura</p>
        <div className="flex justify-between text-xs">
          <span className="text-zinc-300">Calles</span>
          <div className="flex gap-2">
            <span className="text-zinc-400 font-mono">{(metrics.streetAreaM2 / 10000).toFixed(2)} ha</span>
            <span className="text-zinc-500 font-mono">{(analysis.streetCost / 1000).toFixed(0)}k UF</span>
          </div>
        </div>
        <div className="flex justify-between text-xs">
          <span className="text-zinc-300">Áreas verdes</span>
          <div className="flex gap-2">
            <span className="text-zinc-400 font-mono">{(metrics.parkAreaM2 / 10000).toFixed(2)} ha</span>
            <span className="text-zinc-500 font-mono">{(analysis.parkCost / 1000).toFixed(0)}k UF</span>
          </div>
        </div>
        <div className="flex justify-between text-xs mt-1 pt-1 border-t border-zinc-700">
          <span className="text-amber-400 font-medium">Valor total terreno</span>
          <span className="text-amber-400 font-mono font-medium">{(analysis.totalValueUF / 1000).toFixed(0)}k UF</span>
        </div>
      </div>
    </div>
  );
}
