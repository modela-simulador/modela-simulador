"use client";

import { useState, useEffect } from "react";

interface LoaderPhase {
  label: string;
  delayMs: number; // time before this phase appears
}

const PHASES: LoaderPhase[] = [
  { label: "Conectando con el servidor...", delayMs: 0 },
  { label: "Analizando macrolotes seleccionados", delayMs: 1200 },
  { label: "Trazando calles internas", delayMs: 3000 },
  { label: "Generando la mejor cabida...", delayMs: 5500 },
  { label: "Ajustando productos al terreno", delayMs: 8500 },
  { label: "Optimizando distribución de lotes", delayMs: 11500 },
  { label: "Calculando métricas finales", delayMs: 14500 },
];

export default function CabidaLoader() {
  const [visiblePhases, setVisiblePhases] = useState(0);
  const [dots, setDots] = useState("");

  // Reveal phases progressively
  useEffect(() => {
    const timers = PHASES.map((phase, i) =>
      setTimeout(() => setVisiblePhases(i + 1), phase.delayMs)
    );
    return () => timers.forEach(clearTimeout);
  }, []);

  // Animated dots on the last visible phase
  useEffect(() => {
    const interval = setInterval(() => {
      setDots((prev) => (prev.length >= 3 ? "" : prev + "."));
    }, 400);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="absolute inset-0 z-50 flex items-center justify-center bg-zinc-950/80 backdrop-blur-sm">
      <div className="bg-zinc-900 border border-zinc-700 rounded-2xl shadow-2xl px-10 py-8 max-w-md w-full mx-4">
        {/* Spinner */}
        <div className="flex justify-center mb-6">
          <div className="relative w-14 h-14">
            {/* Outer ring */}
            <div className="absolute inset-0 rounded-full border-[3px] border-zinc-700" />
            {/* Spinning arc */}
            <div className="absolute inset-0 rounded-full border-[3px] border-transparent border-t-blue-500 animate-spin" />
            {/* Inner pulse */}
            <div className="absolute inset-3 rounded-full bg-blue-500/20 animate-pulse" />
          </div>
        </div>

        {/* Title */}
        <h2 className="text-center text-lg font-semibold text-white mb-5">
          Generando Cabida
        </h2>

        {/* Phases list */}
        <div className="flex flex-col gap-2.5">
          {PHASES.slice(0, visiblePhases).map((phase, i) => {
            const isLast = i === visiblePhases - 1;
            const isCompleted = i < visiblePhases - 1;

            return (
              <div
                key={i}
                className={`flex items-center gap-3 text-sm transition-all duration-500 ${
                  isLast
                    ? "animate-fade-in"
                    : ""
                }`}
              >
                {/* Status icon */}
                {isCompleted ? (
                  <div className="w-5 h-5 rounded-full bg-emerald-500/20 flex items-center justify-center flex-shrink-0">
                    <svg className="w-3 h-3 text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                    </svg>
                  </div>
                ) : (
                  <div className="w-5 h-5 rounded-full border-2 border-blue-500/50 flex items-center justify-center flex-shrink-0">
                    <div className="w-2 h-2 rounded-full bg-blue-400 animate-pulse" />
                  </div>
                )}

                {/* Label */}
                <span
                  className={
                    isCompleted
                      ? "text-zinc-500"
                      : "text-zinc-200"
                  }
                >
                  {phase.label}{isLast ? dots : ""}
                </span>
              </div>
            );
          })}
        </div>

        {/* Bottom hint */}
        <p className="text-center text-xs text-zinc-600 mt-6">
          Esto puede tomar unos segundos
        </p>
      </div>
    </div>
  );
}
