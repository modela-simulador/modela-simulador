"use client";

import type { DrawnStreet } from "@/lib/street-draw-state";

interface StreetDrawPanelProps {
  isDrawing: boolean;
  streets: DrawnStreet[];
  activeVertexCount: number;
  onToggleDraw: () => void;
  onFinishLine: () => void;
  onDeleteStreet: (id: string) => void;
  onClearAll: () => void;
  onUndo: () => void;
}

export default function StreetDrawPanel({
  isDrawing,
  streets,
  activeVertexCount,
  onToggleDraw,
  onFinishLine,
  onDeleteStreet,
  onClearAll,
  onUndo,
}: StreetDrawPanelProps) {
  return (
    <div className="flex flex-col gap-3">
      <h3 className="text-sm font-semibold text-zinc-300 uppercase tracking-wider">
        Trazado de Calles
      </h3>

      <p className="text-xs text-zinc-500">
        Dibuja las calles internas sobre el macrolote. Cada línea se convertirá en una calle de 12m de ancho.
      </p>

      {/* Draw mode toggle */}
      <button
        onClick={onToggleDraw}
        className={`w-full py-2.5 px-4 rounded-lg font-medium text-sm transition-all flex items-center justify-center gap-2 ${
          isDrawing
            ? "bg-amber-500 hover:bg-amber-400 text-black ring-2 ring-amber-300/50"
            : "bg-blue-600 hover:bg-blue-500 text-white"
        }`}
      >
        {isDrawing ? (
          <>
            <svg className="w-4 h-4 animate-pulse" fill="currentColor" viewBox="0 0 24 24">
              <circle cx="12" cy="12" r="5" />
            </svg>
            Dibujando... (Click para trazar)
          </>
        ) : (
          <>
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
            </svg>
            Dibujar Calle
          </>
        )}
      </button>

      {/* Active drawing info */}
      {isDrawing && activeVertexCount > 0 && (
        <div className="bg-amber-500/10 border border-amber-500/30 rounded-lg px-3 py-2 text-xs">
          <div className="text-amber-300 font-medium mb-1">
            Línea activa: {activeVertexCount} punto{activeVertexCount > 1 ? "s" : ""}
          </div>
          <div className="flex gap-2">
            <button
              onClick={onFinishLine}
              disabled={activeVertexCount < 2}
              className="px-2 py-1 bg-emerald-600 hover:bg-emerald-500 disabled:bg-zinc-700 disabled:text-zinc-500 text-white rounded text-xs transition-colors"
            >
              Terminar línea
            </button>
            <button
              onClick={onUndo}
              className="px-2 py-1 bg-zinc-700 hover:bg-zinc-600 text-zinc-300 rounded text-xs transition-colors"
            >
              Deshacer punto
            </button>
          </div>
          <p className="text-zinc-500 mt-1">
            Doble-click o Enter para terminar · Esc para cancelar
          </p>
        </div>
      )}

      {/* Street list */}
      {streets.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center justify-between">
            <span className="text-xs text-zinc-400 font-medium">
              {streets.length} calle{streets.length > 1 ? "s" : ""} dibujada{streets.length > 1 ? "s" : ""}
            </span>
            <button
              onClick={onClearAll}
              className="text-xs text-red-400 hover:text-red-300 transition-colors"
            >
              Borrar todas
            </button>
          </div>
          {streets.map((street, i) => (
            <div
              key={street.id}
              className="flex items-center justify-between bg-zinc-800/50 rounded px-3 py-2"
            >
              <div className="flex items-center gap-2">
                <div className="w-6 h-0.5 bg-amber-400 rounded-full" />
                <span className="text-xs text-zinc-300">
                  Calle {i + 1} ({street.coordinates.length} puntos)
                </span>
              </div>
              <button
                onClick={() => onDeleteStreet(street.id)}
                className="text-zinc-500 hover:text-red-400 transition-colors text-xs"
              >
                ✕
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
