"use client";

import type { PhasingState, PhasingYearData } from "@/lib/phasing";

interface PhasingPanelProps {
  phasing: PhasingState;
  onTogglePhasing: () => void;
  onCompute: () => void;
  onPlay: () => void;
  onPause: () => void;
  onReset: () => void;
  onSetSpeed: (speed: number) => void;
  onSetWave: (wave: number) => void;
}

function fmtUF(v: number): string {
  return Math.round(v).toLocaleString("es-CL");
}

export default function PhasingPanel({
  phasing,
  onTogglePhasing,
  onCompute,
  onPlay,
  onPause,
  onReset,
  onSetSpeed,
  onSetWave,
}: PhasingPanelProps) {
  const { isActive, selectedStreetIndices, selectedStructuralFids, waves, currentWave, isPlaying, speed, timeline } = phasing;
  const totalSelectedStreets = selectedStreetIndices.length + (selectedStructuralFids?.length ?? 0);
  const firstYear = timeline.length > 0 ? timeline[0].year : null;
  const lastYear = timeline.length > 0 ? timeline[timeline.length - 1].year : null;

  // ── Not active: show activation button ──
  if (!isActive) {
    return (
      <button
        onClick={onTogglePhasing}
        className="w-full py-2.5 px-4 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white font-semibold text-sm transition-colors flex items-center justify-center gap-2"
      >
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
        Etapamiento
      </button>
    );
  }

  const hasWaves = waves.length > 0;
  const currentData: PhasingYearData | null = hasWaves && currentWave >= 0 ? timeline[currentWave] ?? null : null;
  const isComplete = hasWaves && currentWave === waves.length - 1;

  // ── Selecting streets ──
  if (!hasWaves) {
    const hasStreets = totalSelectedStreets > 0;
    return (
      <div className="border-2 border-yellow-500 rounded-lg overflow-hidden">
        <div className="bg-yellow-600 px-4 py-2 flex items-center justify-between">
          <h3 className="text-sm font-bold text-white flex items-center gap-2">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 15l-2 5L9 9l11 4-5 2zm0 0l5 5M7.188 2.239l.777 2.897M5.136 7.965l-2.898-.777M13.95 4.05l-2.122 2.122m-5.657 5.656l-2.12 2.122" />
            </svg>
            Etapamiento — Seleccionar calles
          </h3>
          <button onClick={onTogglePhasing} className="text-yellow-200 hover:text-white text-xs">Cancelar</button>
        </div>

        <div className="p-4 bg-yellow-950/20 space-y-3">
          {!hasStreets ? (
            <div className="text-center py-3 space-y-2">
              <p className="text-sm text-yellow-200/90">
                Click en las <strong>calles grises</strong> del mapa
              </p>
              <p className="text-xs text-yellow-400">
                Se iluminan en amarillo al seleccionarlas
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              <div className="text-center text-sm font-medium text-yellow-300">
                ✓ {totalSelectedStreets} calle{totalSelectedStreets > 1 ? "s" : ""} seleccionada{totalSelectedStreets > 1 ? "s" : ""}
              </div>
              <button
                onClick={onCompute}
                className="w-full py-5 px-4 rounded-xl bg-gradient-to-r from-indigo-600 to-indigo-500 hover:from-indigo-500 hover:to-indigo-400 text-white text-xl font-black transition-all shadow-xl shadow-indigo-600/50 flex items-center justify-center gap-3 border-2 border-indigo-400"
              >
                <svg className="w-7 h-7" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM9.555 7.168A1 1 0 008 8.132v3.736a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664l-3.197-2.132z" clipRule="evenodd" />
                </svg>
                ▶ INICIAR
              </button>
            </div>
          )}
          <div className="text-[10px] text-zinc-500 text-center">
            AUDP 2029 · PDUC 2033
          </div>
        </div>
      </div>
    );
  }

  // ── Playback ──
  return (
    <div className="border-2 border-indigo-500 rounded-lg overflow-hidden">
      <div className="bg-indigo-600 px-4 py-2 flex items-center justify-between">
        <h3 className="text-sm font-bold text-white">
          {currentData ? `Fase ${currentData.wave + 1} — ${currentData.year}` : "Etapamiento"}
        </h3>
        <button onClick={onTogglePhasing} className="text-indigo-200 hover:text-white text-xs">Salir</button>
      </div>

      <div className="p-4 bg-indigo-950/30 space-y-3">
        {/* Progress */}
        <div className="space-y-1">
          <div className="flex items-center justify-between text-[11px]">
            <span className="text-zinc-400">Fase {Math.max(0, currentWave + 1)} de {waves.length}</span>
            <span className="text-zinc-500 font-mono">
              {currentData ? `${currentData.lotIndices.length} lotes · ${currentData.waveUnits} viv` : ""}
            </span>
          </div>
          <div className="w-full h-2 bg-zinc-800 rounded-full overflow-hidden">
            <div
              className="h-full bg-gradient-to-r from-indigo-600 to-indigo-400 rounded-full transition-all duration-700 ease-out"
              style={{ width: `${((currentWave + 1) / waves.length) * 100}%` }}
            />
          </div>
        </div>

        {/* Controls */}
        <div className="flex items-center gap-2">
          {isPlaying ? (
            <button
              onClick={onPause}
              className="flex-1 py-2.5 rounded-lg bg-amber-600 hover:bg-amber-500 text-white text-sm font-bold transition-colors flex items-center justify-center gap-2"
            >
              <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zM7 8a1 1 0 012 0v4a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v4a1 1 0 102 0V8a1 1 0 00-1-1z" clipRule="evenodd" />
              </svg>
              Pausar
            </button>
          ) : (
            <button
              onClick={onPlay}
              disabled={isComplete}
              className={`flex-1 py-2.5 rounded-lg text-sm font-bold transition-colors flex items-center justify-center gap-2 ${
                isComplete ? "bg-emerald-700 text-emerald-200" : "bg-indigo-600 hover:bg-indigo-500 text-white"
              }`}
            >
              <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
                {isComplete ? (
                  <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                ) : (
                  <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM9.555 7.168A1 1 0 008 8.132v3.736a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664l-3.197-2.132z" clipRule="evenodd" />
                )}
              </svg>
              {isComplete ? "Completo" : currentWave < 0 ? "Reproducir" : "Continuar"}
            </button>
          )}
          <button
            onClick={onReset}
            className="py-2.5 px-3 rounded-lg bg-zinc-700 hover:bg-zinc-600 text-zinc-300 text-sm transition-colors"
            title="Volver a seleccionar calles"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
          </button>
        </div>

        {/* Speed + scrubber */}
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1 flex-shrink-0">
            {[1, 2, 4].map((s) => (
              <button
                key={s}
                onClick={() => onSetSpeed(s)}
                className={`w-7 h-6 rounded text-[10px] font-bold transition-colors ${
                  speed === s ? "bg-indigo-600 text-white" : "bg-zinc-800 text-zinc-500 hover:bg-zinc-700"
                }`}
              >
                {s}x
              </button>
            ))}
          </div>
          <input
            type="range"
            min={-1}
            max={waves.length - 1}
            value={currentWave}
            onChange={(e) => onSetWave(parseInt(e.target.value))}
            className="flex-1 h-1 bg-zinc-700 rounded-lg appearance-none cursor-pointer accent-indigo-500"
          />
        </div>

        {/* Financial summary */}
        {currentData && (
          <div className="bg-zinc-900/80 rounded-lg p-3 space-y-2 border border-zinc-700/50">
            <div className="grid grid-cols-2 gap-x-3 gap-y-0.5 text-xs">
              <span className="text-zinc-500">Fase:</span>
              <span className="text-right">
                <span className="text-white">{currentData.lotIndices.length} lotes</span>
                <span className="text-zinc-500 ml-1">· {currentData.waveUnits} viv</span>
              </span>
              <span className="text-zinc-500">Ingreso fase:</span>
              <span className="text-emerald-400 text-right">{fmtUF(currentData.waveIncome)} UF</span>
              <span className="text-zinc-500">Costo fase:</span>
              <span className="text-red-400 text-right">{fmtUF(currentData.waveCost)} UF</span>
            </div>
            <div className="border-t border-zinc-700 pt-2 grid grid-cols-2 gap-x-3 gap-y-0.5 text-xs">
              <span className="text-zinc-400 font-semibold col-span-2 mb-0.5">Acumulado al {currentData.year}</span>
              <span className="text-zinc-500">Viviendas:</span>
              <span className="text-white text-right font-medium">{currentData.accUnits.toLocaleString()}</span>
              <span className="text-zinc-500">Ingreso:</span>
              <span className="text-emerald-400 text-right font-medium">{fmtUF(currentData.accIncome)} UF</span>
              <span className="text-zinc-500">Costo:</span>
              <span className="text-red-400 text-right font-medium">{fmtUF(currentData.accCost)} UF</span>
              <span className="text-zinc-400 font-semibold">Neto:</span>
              <span className={`text-right font-bold ${currentData.accNet >= 0 ? "text-emerald-300" : "text-red-300"}`}>
                {fmtUF(currentData.accNet)} UF
              </span>
            </div>
          </div>
        )}

        {/* Completion */}
        {isComplete && currentData && (
          <div className="bg-emerald-950/40 border border-emerald-600/50 rounded-lg p-3 text-center">
            <div className="text-emerald-300 text-xs font-bold mb-1">Proyecto completo</div>
            <div className="text-white text-lg font-bold font-mono">{fmtUF(currentData.accNet)} UF</div>
            <div className="text-zinc-400 text-[10px]">
              {currentData.accUnits.toLocaleString()} viviendas · {waves.length} fases · {firstYear}–{currentData.year}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
