"use client";

import { useMemo } from "react";
import { INFRA_COSTS } from "@/lib/types";
import type { BusinessSelection } from "@/lib/types";

interface InfraCostPanelProps {
  selection: BusinessSelection;
  vialAreaMap: Record<number, number>;
  greenAreaMap: Record<number, number>;
  onClear: () => void;
}

function fmtK(v: number): string {
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1_000) return `${(v / 1_000).toFixed(0)}k`;
  return v.toFixed(0);
}

export default function InfraCostPanel({ selection, vialAreaMap, greenAreaMap, onClear }: InfraCostPanelProps) {
  const costs = useMemo(() => {
    const streetAreaM2 = selection.structuralStreetFids.reduce(
      (sum, fid) => sum + (vialAreaMap[fid] || 0), 0
    );
    const greenAreaM2 = selection.greenAreaFids.reduce(
      (sum, fid) => sum + (greenAreaMap[fid] || 0), 0
    );
    const totalAreaM2 = streetAreaM2 + greenAreaM2;

    const streetCostUF = streetAreaM2 * INFRA_COSTS.streetUFm2 * INFRA_COSTS.streetShareFactor;
    const greenCostUF = greenAreaM2 * INFRA_COSTS.greenUFm2;
    const landCostUF = totalAreaM2 * INFRA_COSTS.landUFm2;
    const totalCostUF = streetCostUF + greenCostUF + landCostUF;

    return {
      streetCount: selection.structuralStreetFids.length,
      greenCount: selection.greenAreaFids.length,
      streetAreaM2,
      greenAreaM2,
      streetCostUF,
      greenCostUF,
      landCostUF,
      totalCostUF,
    };
  }, [selection, vialAreaMap, greenAreaMap]);

  const hasStreets = costs.streetCount > 0;
  const hasGreens = costs.greenCount > 0;

  return (
    <div className="p-4 space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-zinc-300">Costo Infraestructura</h3>
        <button
          onClick={onClear}
          className="text-xs text-zinc-500 hover:text-zinc-300 transition-colors"
        >
          Limpiar
        </button>
      </div>

      <p className="text-xs text-zinc-500">
        Selecciona vialidades y áreas verdes en el mapa para estimar costos estructurales.
      </p>

      <div className="space-y-2">
        {hasStreets && (
          <div className="bg-zinc-800/50 rounded-lg p-3">
            <div className="flex justify-between items-center mb-1">
              <span className="text-xs text-zinc-400">
                Vialidades ({costs.streetCount})
              </span>
              <span className="text-xs font-mono text-zinc-300">
                {(costs.streetAreaM2 / 10000).toFixed(2)} ha
              </span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-xs text-zinc-500">Costo (50% cargo)</span>
              <span className="text-sm font-semibold text-amber-400">
                {fmtK(costs.streetCostUF)} UF
              </span>
            </div>
          </div>
        )}

        {hasGreens && (
          <div className="bg-zinc-800/50 rounded-lg p-3">
            <div className="flex justify-between items-center mb-1">
              <span className="text-xs text-zinc-400">
                Áreas Verdes ({costs.greenCount})
              </span>
              <span className="text-xs font-mono text-zinc-300">
                {(costs.greenAreaM2 / 10000).toFixed(2)} ha
              </span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-xs text-zinc-500">Costo</span>
              <span className="text-sm font-semibold text-emerald-400">
                {fmtK(costs.greenCostUF)} UF
              </span>
            </div>
          </div>
        )}

        {(hasStreets || hasGreens) && (
          <div className="bg-zinc-800/50 rounded-lg p-3">
            <div className="flex justify-between items-center mb-1">
              <span className="text-xs text-zinc-400">Terreno</span>
              <span className="text-sm font-semibold text-zinc-300">
                {fmtK(costs.landCostUF)} UF
              </span>
            </div>
            <div className="border-t border-zinc-700 mt-2 pt-2 flex justify-between items-center">
              <span className="text-xs font-medium text-zinc-300">Costo Total</span>
              <span className="text-sm font-bold text-red-400">
                {fmtK(costs.totalCostUF)} UF
              </span>
            </div>
          </div>
        )}

        {!hasStreets && !hasGreens && (
          <div className="text-center py-6 text-zinc-600 text-xs">
            Click en vialidades o áreas verdes del mapa
          </div>
        )}
      </div>
    </div>
  );
}
