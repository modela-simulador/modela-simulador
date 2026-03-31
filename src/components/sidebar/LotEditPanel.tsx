"use client";

import { PRODUCTS, PRODUCT_FAMILIES } from "@/lib/constants";
import type { LotResult } from "@/lib/types";

interface LotEditPanelProps {
  lot: LotResult;
  lotIndex: number;
  onChangeProduct: (lotIndex: number, newProductId: string) => void;
  onDeselect: () => void;
}

export default function LotEditPanel({ lot, lotIndex, onChangeProduct, onDeselect }: LotEditPanelProps) {
  const currentProduct = PRODUCTS.find((p) => p.id === lot.product);
  const currentFamily = PRODUCT_FAMILIES.find((f) => f.id === currentProduct?.family);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-zinc-300 uppercase tracking-wider">
          Editar Lote #{lotIndex + 1}
        </h3>
        <button
          onClick={onDeselect}
          className="text-xs text-zinc-400 hover:text-white transition-colors"
        >
          Cerrar
        </button>
      </div>

      {/* Current info */}
      <div className="bg-zinc-800/50 rounded-lg p-3">
        <div className="grid grid-cols-2 gap-2 text-xs">
          <div>
            <p className="text-zinc-400">Superficie</p>
            <p className="text-white font-mono">{(lot.areaM2 / 10000).toFixed(2)} ha</p>
          </div>
          <div>
            <p className="text-zinc-400">Viviendas</p>
            <p className="text-white font-mono">{lot.units}</p>
          </div>
          <div>
            <p className="text-zinc-400">Frente</p>
            <p className="text-white font-mono">{lot.frontageM?.toFixed(0) || "—"} m</p>
          </div>
          <div>
            <p className="text-zinc-400">Familia</p>
            <p className="text-white">{currentFamily?.name}</p>
          </div>
        </div>
      </div>

      {/* Product selector */}
      <div className="bg-zinc-800/50 rounded-lg p-3">
        <p className="text-xs text-zinc-400 mb-2">Producto asignado</p>
        <div className="space-y-1.5">
          {PRODUCTS.map((p) => {
            const isSelected = p.id === lot.product;
            const estimatedUnits = Math.round((lot.areaM2 / 10000) * p.efficiency);
            const meetsMin = estimatedUnits >= p.minUnits;
            const meetsLot = (lot.areaM2 / 10000) >= p.minLotHa;
            const isViable = meetsMin && meetsLot;

            return (
              <button
                key={p.id}
                onClick={() => onChangeProduct(lotIndex, p.id)}
                className={`w-full flex items-center gap-2 px-2.5 py-2 rounded-md text-left transition-colors ${
                  isSelected
                    ? "bg-zinc-600/60 ring-1 ring-zinc-500"
                    : isViable
                    ? "hover:bg-zinc-700/50"
                    : "opacity-40 hover:opacity-60"
                }`}
              >
                <div
                  className="w-2.5 h-2.5 rounded-full flex-shrink-0"
                  style={{ backgroundColor: p.color }}
                />
                <span className="text-xs text-zinc-200 flex-1">{p.name}</span>
                <span className={`text-xs font-mono ${isViable ? "text-zinc-400" : "text-red-400"}`}>
                  ~{estimatedUnits} viv
                </span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
