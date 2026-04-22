"use client";

import type { PhasingYearData } from "@/lib/phasing";

interface PhasingTimelineProps {
  timeline: PhasingYearData[];
  currentWave: number;
  onSetWave: (wave: number) => void;
}

/** Format UF with thousands separator */
function fmtUF(v: number): string {
  if (Math.abs(v) >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`;
  if (Math.abs(v) >= 1_000) return `${(v / 1_000).toFixed(0)}K`;
  return Math.round(v).toLocaleString("es-CL");
}

export default function PhasingTimeline({ timeline, currentWave, onSetWave }: PhasingTimelineProps) {
  if (timeline.length === 0) return null;

  // Calculate chart dimensions
  const maxAcc = Math.max(...timeline.map((t) => Math.max(t.accIncome, t.accCost, Math.abs(t.accNet))), 1);
  const chartH = 80;

  return (
    <div className="absolute bottom-0 left-0 right-0 z-20 bg-zinc-900/95 backdrop-blur border-t border-zinc-700">
      <div className="flex items-stretch h-28">
        {/* Left: current phase summary */}
        <div className="w-48 flex-shrink-0 border-r border-zinc-700 px-4 py-2 flex flex-col justify-center">
          {currentWave >= 0 && timeline[currentWave] ? (
            <>
              <div className="text-indigo-400 text-xs font-bold mb-1">
                Fase {currentWave + 1} / {timeline.length}
              </div>
              <div className="text-white text-lg font-bold font-mono">
                {timeline[currentWave].year}
              </div>
              <div className="text-emerald-400 text-xs mt-0.5">
                +{fmtUF(timeline[currentWave].waveIncome)} UF
              </div>
              <div className="text-zinc-400 text-xs">
                {timeline[currentWave].waveUnits} viv
              </div>
            </>
          ) : (
            <div className="text-zinc-500 text-xs">
              Arrastra el control o presiona Play
            </div>
          )}
        </div>

        {/* Center: bar chart */}
        <div className="flex-1 px-4 py-2 flex items-end gap-1 overflow-x-auto">
          {timeline.map((data, i) => {
            const incH = (data.accIncome / maxAcc) * chartH;
            const costH = (data.accCost / maxAcc) * chartH;
            const isActive = i <= currentWave;
            const isCurrent = i === currentWave;

            return (
              <button
                key={i}
                onClick={() => onSetWave(i)}
                className={`flex-1 min-w-[40px] max-w-[80px] flex flex-col items-center gap-0.5 group cursor-pointer transition-opacity ${
                  isActive ? "opacity-100" : "opacity-40"
                }`}
              >
                {/* Bars */}
                <div className="w-full flex items-end justify-center gap-[2px]" style={{ height: chartH }}>
                  {/* Income bar */}
                  <div
                    className={`w-[40%] rounded-t transition-all duration-300 ${
                      isCurrent ? "bg-emerald-400" : isActive ? "bg-emerald-600" : "bg-emerald-900"
                    }`}
                    style={{ height: Math.max(2, incH) }}
                  />
                  {/* Cost bar */}
                  <div
                    className={`w-[40%] rounded-t transition-all duration-300 ${
                      isCurrent ? "bg-red-400" : isActive ? "bg-red-600" : "bg-red-900"
                    }`}
                    style={{ height: Math.max(2, costH) }}
                  />
                </div>
                {/* Year label */}
                <span className={`text-[10px] font-mono transition-colors ${
                  isCurrent ? "text-white font-bold" : "text-zinc-500"
                }`}>
                  {data.year}
                </span>
              </button>
            );
          })}
        </div>

        {/* Right: accumulated totals */}
        <div className="w-52 flex-shrink-0 border-l border-zinc-700 px-4 py-2 flex flex-col justify-center text-xs">
          {currentWave >= 0 && timeline[currentWave] ? (
            <>
              <div className="text-zinc-400 font-medium mb-1">Acumulado</div>
              <div className="flex justify-between">
                <span className="text-zinc-500">Ingreso:</span>
                <span className="text-emerald-400 font-mono">{fmtUF(timeline[currentWave].accIncome)} UF</span>
              </div>
              <div className="flex justify-between">
                <span className="text-zinc-500">Costo:</span>
                <span className="text-red-400 font-mono">{fmtUF(timeline[currentWave].accCost)} UF</span>
              </div>
              <div className="flex justify-between border-t border-zinc-700 mt-1 pt-1">
                <span className="text-zinc-400 font-medium">Neto:</span>
                <span className={`font-mono font-bold ${
                  timeline[currentWave].accNet >= 0 ? "text-emerald-300" : "text-red-300"
                }`}>
                  {fmtUF(timeline[currentWave].accNet)} UF
                </span>
              </div>
              <div className="flex justify-between mt-1">
                <span className="text-zinc-500">Viviendas:</span>
                <span className="text-white font-mono">{timeline[currentWave].accUnits.toLocaleString()}</span>
              </div>
            </>
          ) : (
            <>
              <div className="text-zinc-400 font-medium mb-1">Resumen Final</div>
              <div className="flex justify-between">
                <span className="text-zinc-500">Ingreso total:</span>
                <span className="text-emerald-400 font-mono">
                  {fmtUF(timeline[timeline.length - 1].accIncome)} UF
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-zinc-500">Costo total:</span>
                <span className="text-red-400 font-mono">
                  {fmtUF(timeline[timeline.length - 1].accCost)} UF
                </span>
              </div>
            </>
          )}

          {/* Legend */}
          <div className="flex items-center gap-3 mt-2 pt-1 border-t border-zinc-800">
            <div className="flex items-center gap-1">
              <div className="w-2 h-2 rounded-sm bg-emerald-500" />
              <span className="text-zinc-500 text-[10px]">Ingreso</span>
            </div>
            <div className="flex items-center gap-1">
              <div className="w-2 h-2 rounded-sm bg-red-500" />
              <span className="text-zinc-500 text-[10px]">Costo</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
