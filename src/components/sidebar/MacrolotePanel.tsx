"use client";

import type { MacroloteFeature } from "@/lib/types";

interface MacrolotePanelProps {
  macrolotes: MacroloteFeature[];
  onClose: () => void;
}

export default function MacrolotePanel({ macrolotes, onClose }: MacrolotePanelProps) {
  const totalAreaM2 = macrolotes.reduce((sum, m) => sum + (m.properties.Area || 0), 0);
  const totalAreaHa = totalAreaM2 / 10000;
  const fids = macrolotes.map((m) => m.properties.fid).join(", ");
  const count = macrolotes.length;

  return (
    <div className="flex flex-col gap-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-white">
          {count === 1 ? `Macrolote ${fids}` : `${count} Macrolotes Seleccionados`}
        </h2>
        <button
          onClick={onClose}
          className="text-zinc-400 hover:text-white transition-colors text-xl leading-none"
          aria-label="Cerrar panel"
        >
          &times;
        </button>
      </div>

      {/* Info */}
      <div className="grid grid-cols-2 gap-3">
        <div className="bg-zinc-800/50 rounded-lg p-3">
          <p className="text-xs text-zinc-400 mb-1">Superficie total</p>
          <p className="text-lg font-medium text-white">{totalAreaHa.toFixed(1)} ha</p>
          <p className="text-xs text-zinc-500">{(totalAreaM2 / 1000).toFixed(0)}k m2</p>
        </div>
        <div className="bg-zinc-800/50 rounded-lg p-3">
          <p className="text-xs text-zinc-400 mb-1">Lote ID</p>
          <p className="text-lg font-medium text-white">{fids}</p>
        </div>
      </div>

      {/* Size indicator */}
      <div className="bg-zinc-800/50 rounded-lg p-3">
        <p className="text-xs text-zinc-400 mb-2">Potencial de subdivision</p>
        <div className="w-full bg-zinc-700 rounded-full h-2">
          <div
            className="bg-blue-500 h-2 rounded-full transition-all"
            style={{ width: `${Math.min(100, (totalAreaHa / 25) * 100)}%` }}
          />
        </div>
        <p className="text-xs text-zinc-500 mt-1">
          {totalAreaHa >= 10 ? "Supermanzana completa" : totalAreaHa >= 5 ? "Alta capacidad" : totalAreaHa >= 2 ? "Capacidad media" : "Lote pequeno"}
        </p>
      </div>
    </div>
  );
}
