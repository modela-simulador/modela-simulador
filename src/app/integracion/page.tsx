"use client";

import { Fragment, useMemo, useState } from "react";
import { BASE_PATH } from "@/lib/base-path";
import {
  computeFlujo,
  CONTEXTO,
  LAYERS,
  LAYERS_BASE,
  LAYERS_TERCEROS,
  LAYERS_VERTICAL,
  PARIDAD_PPTX,
  SEM,
  type FlujoResult,
  type LayerId,
  type LayerState,
} from "@/lib/integracion-model";

// ── formato ──────────────────────────────────────────────────
const nf = (n: number) => Math.round(Math.abs(n)).toLocaleString("es-CL");
const sg = (n: number) => (n < -0.5 ? "−" : "") + nf(n);
const uf = (n: number) => `${sg(n)} UF`;

export default function IntegracionPage() {
  const [layers, setLayers] = useState<LayerState>(LAYERS_TERCEROS);
  const [share, setShare] = useState(0.5);
  const [detalle, setDetalle] = useState<LayerId | null>(null);

  const r = useMemo(() => computeFlujo({ layers, share }), [layers, share]);

  /** Cuánto movería el resultado neto encender (o apagar) cada capa desde el estado actual. */
  const deltas = useMemo(() => {
    const out = {} as Record<LayerId, number>;
    for (const l of LAYERS) {
      if (l.base) {
        out[l.id] = 0;
        continue;
      }
      const alt = computeFlujo({ layers: { ...layers, [l.id]: !layers[l.id] }, share });
      out[l.id] = layers[l.id] ? r.neto - alt.neto : alt.neto - r.neto;
    }
    return out;
  }, [layers, share, r.neto]);

  const vertical = layers.inmobiliario;
  const activas = LAYERS.filter((l) => layers[l.id]).length;
  const esTerceros = LAYERS.every((l) => layers[l.id] === LAYERS_TERCEROS[l.id]);
  const esVertical = LAYERS.every((l) => layers[l.id] === LAYERS_VERTICAL[l.id]) && share === 0.5;

  const toggle = (id: LayerId) => setLayers((s) => ({ ...s, [id]: !s[id] }));

  return (
    <div className="min-h-screen bg-zinc-950 text-white">
      {/* ── header ── */}
      <header className="sticky top-0 z-20 bg-zinc-950/90 backdrop-blur border-b border-zinc-800 px-5 py-3 flex items-center gap-4">
        <a
          href={`${BASE_PATH}/`}
          className="text-zinc-500 hover:text-white text-sm transition-colors shrink-0"
        >
          ← Inicio
        </a>
        <div className="h-5 w-px bg-zinc-800" />
        <div className="min-w-0">
          <h1 className="text-base font-bold leading-tight">Integración Vertical</h1>
          <p className="text-[11px] text-zinc-500 truncate">
            AUDP Batuco + Colina · flujo semestral en UF · S1&nbsp;&apos;30 – S2&nbsp;&apos;36
          </p>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <Preset label="Base" active={activas === 1} onClick={() => setLayers(LAYERS_BASE)} />
          <Preset label="Venta a terceros" active={esTerceros} onClick={() => setLayers(LAYERS_TERCEROS)} />
          <Preset
            label="Vertical integrado"
            active={esVertical}
            onClick={() => {
              setLayers(LAYERS_VERTICAL);
              setShare(0.5);
            }}
          />
        </div>
      </header>

      <div className="flex flex-col lg:flex-row">
        {/* ── panel de capas ── */}
        <aside className="lg:w-[340px] lg:shrink-0 border-b lg:border-b-0 lg:border-r border-zinc-800 p-4 space-y-2">
          <div className="flex items-baseline justify-between mb-1">
            <h2 className="text-[11px] uppercase tracking-wider font-semibold text-zinc-400">
              Capas del negocio
            </h2>
            <span className="text-[10px] text-zinc-600">{activas} de {LAYERS.length}</span>
          </div>
          <p className="text-[11px] text-zinc-500 leading-relaxed pb-2">
            Enciende las capas en orden. Cada una suma su parte del negocio hasta llegar a la
            integración vertical completa.
          </p>

          {LAYERS.map((l) => (
            <LayerToggle
              key={l.id}
              layer={l}
              on={layers[l.id]}
              delta={deltas[l.id]}
              open={detalle === l.id}
              onToggle={() => toggle(l.id)}
              onInfo={() => setDetalle(detalle === l.id ? null : l.id)}
            />
          ))}

          {/* participación en el negocio inmobiliario */}
          {vertical && (
            <div className="mt-3 rounded-lg border border-blue-900/60 bg-blue-950/20 p-3">
              <div className="flex items-baseline justify-between mb-1.5">
                <span className="text-[11px] uppercase tracking-wider font-semibold text-blue-400">
                  Nuestra participación
                </span>
                <span className="text-sm font-bold text-blue-300 tabular-nums">
                  {Math.round(share * 100)}%
                </span>
              </div>
              <input
                type="range"
                min={0.1}
                max={1}
                step={0.05}
                value={share}
                onChange={(e) => setShare(Number(e.target.value))}
                className="w-full accent-blue-500"
              />
              <p className="text-[10.5px] text-zinc-500 leading-relaxed mt-1.5">
                Aportando el terreno tomamos el 50% del negocio inmobiliario; el socio aporta la
                otra mitad del capital de trabajo. La tierra queda siempre al 100%.
              </p>
            </div>
          )}

          <div className="pt-3 mt-3 border-t border-zinc-800 grid grid-cols-2 gap-2">
            <Mini label="Ventas brutas" value={`${nf(CONTEXTO.pxq)} UF`} />
            <Mini label="Unidades" value={nf(CONTEXTO.unidades)} />
            <Mini label="Valor del suelo" value={`${nf(CONTEXTO.suelo)} UF`} />
            <Mini label="Capital de trabajo" value={`${nf(CONTEXTO.capitalTrabajo)} UF`} />
          </div>
        </aside>

        {/* ── resultados ── */}
        <main className="flex-1 min-w-0 p-4 space-y-4">
          <KPIs r={r} vertical={vertical} />
          <FlujoChart r={r} vertical={vertical} />
          <FlujoTable r={r} />
          <Paridad r={r} esTerceros={esTerceros} esVertical={esVertical} />
        </main>
      </div>
    </div>
  );
}

// ── capa encendible ──────────────────────────────────────────
function LayerToggle({
  layer,
  on,
  delta,
  open,
  onToggle,
  onInfo,
}: {
  layer: (typeof LAYERS)[number];
  on: boolean;
  delta: number;
  open: boolean;
  onToggle: () => void;
  onInfo: () => void;
}) {
  return (
    <div
      className={`rounded-lg border transition-all ${
        on ? "bg-zinc-800/60 border-zinc-600" : "bg-zinc-900/40 border-zinc-800 hover:border-zinc-700"
      }`}
      style={on ? { borderLeftColor: layer.color, borderLeftWidth: 3 } : { borderLeftWidth: 3 }}
    >
      <div className="flex items-start gap-2.5 p-2.5">
        <button
          onClick={layer.base ? undefined : onToggle}
          disabled={layer.base}
          aria-pressed={on}
          className={`mt-0.5 w-9 h-5 rounded-full shrink-0 relative transition-colors ${
            layer.base ? "cursor-default" : "cursor-pointer"
          }`}
          style={{ backgroundColor: on ? layer.color : "#3f3f46" }}
        >
          <span
            className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-all ${
              on ? "left-[18px]" : "left-0.5"
            }`}
          />
        </button>

        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-1.5">
            <span className="text-[10px] font-mono text-zinc-600">{layer.n}</span>
            <span className={`text-[13px] font-semibold ${on ? "text-white" : "text-zinc-500"}`}>
              {layer.nombre}
            </span>
            {layer.base && (
              <span className="text-[9px] uppercase tracking-wider text-zinc-600 border border-zinc-700 rounded px-1">
                base
              </span>
            )}
            <button
              onClick={onInfo}
              className="ml-auto text-zinc-600 hover:text-zinc-300 text-[11px] shrink-0"
              aria-label="Ver detalle"
            >
              {open ? "▾" : "?"}
            </button>
          </div>
          <p className={`text-[11px] leading-snug mt-0.5 ${on ? "text-zinc-400" : "text-zinc-600"}`}>
            {layer.desc}
          </p>
          {!layer.base && Math.abs(delta) > 0.5 && (
            <p className="text-[10.5px] mt-1 tabular-nums">
              <span className="text-zinc-600">{on ? "aporta" : "aportaría"} </span>
              <span className={delta >= 0 ? "text-green-400" : "text-red-400"}>
                {delta >= 0 ? "+" : "−"}
                {nf(delta)} UF
              </span>
              <span className="text-zinc-600"> al resultado</span>
            </p>
          )}
          {open && (
            <p className="text-[10.5px] text-zinc-500 leading-relaxed mt-1.5 pt-1.5 border-t border-zinc-800">
              {layer.detalle}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

function Preset({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={`px-2.5 py-1 rounded-md text-[11px] font-medium border transition-colors ${
        active
          ? "bg-white text-zinc-900 border-white"
          : "border-zinc-700 text-zinc-400 hover:text-white hover:border-zinc-500"
      }`}
    >
      {label}
    </button>
  );
}

function Mini({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-zinc-900/60 rounded px-2 py-1.5 border border-zinc-800">
      <div className="text-[9.5px] text-zinc-600 uppercase tracking-wide">{label}</div>
      <div className="text-[11.5px] font-semibold tabular-nums">{value}</div>
    </div>
  );
}

// ── KPIs ─────────────────────────────────────────────────────
function KPIs({ r, vertical }: { r: FlujoResult; vertical: boolean }) {
  return (
    <div className={`grid gap-3 ${vertical ? "grid-cols-2 lg:grid-cols-5" : "grid-cols-2 lg:grid-cols-4"}`}>
      <KPI label="Ingresos" value={uf(r.ingresos)} color="text-zinc-100" />
      <KPI label="Costos" value={uf(r.costos)} color="text-red-400" />
      <KPI
        label="Resultado neto"
        value={uf(r.neto)}
        color={r.neto >= 0 ? "text-green-400" : "text-red-400"}
        big
      />
      {vertical ? (
        <>
          <KPI label="Caja máx. macroloteador" value={uf(r.valleMacro)} color="text-red-400" />
          <KPI label="Máx. fin. capital de trabajo" value={uf(r.valleInmob)} color="text-orange-400" />
        </>
      ) : (
        <KPI
          label={`Máx. financiamiento · ${SEM(r.valleIdx)}`}
          value={uf(r.valle)}
          color="text-red-400"
        />
      )}
    </div>
  );
}

function KPI({ label, value, color, big }: { label: string; value: string; color: string; big?: boolean }) {
  return (
    <div className="bg-zinc-900/60 border border-zinc-800 rounded-lg px-3 py-2.5">
      <div className="text-[9.5px] text-zinc-500 uppercase tracking-wider leading-tight">{label}</div>
      <div className={`${big ? "text-2xl" : "text-lg"} font-bold tabular-nums mt-0.5 ${color}`}>
        {value}
      </div>
    </div>
  );
}

// ── gráfico: barras del flujo neto + línea de caja acumulada ──
function FlujoChart({ r, vertical }: { r: FlujoResult; vertical: boolean }) {
  const n = r.nfv;
  const W = 1000;
  const H = 300;
  const PADL = 62;
  const PADR = 14;
  const PADT = 14;
  const PADB = 30;
  const plotW = W - PADL - PADR;
  const plotH = H - PADT - PADB;

  const vals = [...r.net, ...r.caja, 0];
  const maxV = Math.max(...vals);
  const minV = Math.min(...vals);
  const span = maxV - minV || 1;
  const y = (v: number) => PADT + ((maxV - v) / span) * plotH;
  const step = plotW / n;
  const bw = Math.min(38, step * 0.62);

  // ticks "redondos" cada 50k
  const tickStep = span > 600000 ? 200000 : span > 300000 ? 100000 : 50000;
  const ticks: number[] = [];
  for (let t = Math.ceil(minV / tickStep) * tickStep; t <= maxV; t += tickStep) ticks.push(t);

  const line = r.caja
    .map((v, i) => `${i === 0 ? "M" : "L"} ${PADL + step * (i + 0.5)} ${y(v)}`)
    .join(" ");

  return (
    <div className="bg-zinc-900/40 border border-zinc-800 rounded-lg p-3">
      <div className="flex items-center gap-4 mb-1 flex-wrap">
        <h3 className="text-[11px] uppercase tracking-wider font-semibold text-zinc-400">
          Flujo de caja semestral
        </h3>
        <div className="flex items-center gap-3 text-[10px] text-zinc-500">
          <Legend color="#15803D" label="Flujo positivo" />
          <Legend color="#B91C1C" label="Flujo negativo" />
          {vertical && <Legend color="#E27A5F" label="Capital de trabajo" />}
          <span className="flex items-center gap-1">
            <svg width="14" height="8">
              <line x1="0" y1="4" x2="14" y2="4" stroke="#e4e4e7" strokeWidth="1.5" />
            </svg>
            Caja acumulada
          </span>
        </div>
      </div>

      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ height: "clamp(220px, 32vh, 320px)" }}>
        {/* grilla */}
        {ticks.map((t) => (
          <g key={t}>
            <line
              x1={PADL}
              y1={y(t)}
              x2={W - PADR}
              y2={y(t)}
              stroke={Math.abs(t) < 1 ? "#52525b" : "#27272a"}
              strokeWidth={Math.abs(t) < 1 ? 1 : 0.5}
            />
            <text x={PADL - 6} y={y(t) + 3} textAnchor="end" fontSize="9" fill="#71717a" className="tabular-nums">
              {t === 0 ? "0" : `${t < 0 ? "−" : ""}${Math.abs(t) / 1000}k`}
            </text>
          </g>
        ))}

        {/* barras: macro y (si aplica) capa inmobiliaria apiladas por signo */}
        {r.net.map((v, i) => {
          const cx = PADL + step * (i + 0.5);
          const m = vertical ? r.macroNet[i] : v;
          const i2 = vertical ? r.inmobNet[i] : 0;
          const zero = y(0);
          // apilado: positivos hacia arriba, negativos hacia abajo, en orden macro → inmob
          let up = zero;
          let dn = zero;
          const segs: Array<{ y: number; h: number; fill: string }> = [];
          for (const [val, cPos, cNeg] of [
            [m, "#15803D", "#B91C1C"],
            [i2, "#6BCB95", "#E27A5F"],
          ] as Array<[number, string, string]>) {
            if (Math.abs(val) < 0.5) continue;
            const h = Math.abs(y(val) - zero);
            if (val > 0) {
              up -= h;
              segs.push({ y: up, h, fill: cPos });
            } else {
              segs.push({ y: dn, h, fill: cNeg });
              dn += h;
            }
          }
          return (
            <g key={i}>
              {segs.map((s, k) => (
                <rect key={k} x={cx - bw / 2} y={s.y} width={bw} height={s.h} fill={s.fill} opacity={0.92} />
              ))}
              <title>{`${SEM(i)} · flujo ${uf(v)} · caja ${uf(r.caja[i])}`}</title>
            </g>
          );
        })}

        {/* caja acumulada */}
        <path d={line} fill="none" stroke="#e4e4e7" strokeWidth="1.8" />
        {r.caja.map((v, i) => (
          <circle key={i} cx={PADL + step * (i + 0.5)} cy={y(v)} r="2.4" fill="#e4e4e7" />
        ))}

        {/* eje de semestres */}
        {r.net.map((_, i) => (
          <text
            key={i}
            x={PADL + step * (i + 0.5)}
            y={H - 10}
            textAnchor="middle"
            fontSize="9"
            fill="#71717a"
          >
            {SEM(i)}
          </text>
        ))}
      </svg>
    </div>
  );
}

function Legend({ color, label }: { color: string; label: string }) {
  return (
    <span className="flex items-center gap-1">
      <span className="w-2.5 h-2.5 rounded-sm" style={{ backgroundColor: color }} />
      {label}
    </span>
  );
}

// ── tabla consolidada ────────────────────────────────────────
function FlujoTable({ r }: { r: FlujoResult }) {
  const cols = Array.from({ length: r.nfv }, (_, i) => i);
  const cell = (v: number) =>
    Math.abs(v) > 0.5 ? (
      <span className={v < -0.5 ? "text-red-400" : "text-zinc-300"}>{sg(v)}</span>
    ) : (
      <span className="text-zinc-700">·</span>
    );

  let curSec = "";
  return (
    <div className="bg-zinc-900/40 border border-zinc-800 rounded-lg overflow-hidden">
      <div className="px-3 py-2 border-b border-zinc-800">
        <h3 className="text-[11px] uppercase tracking-wider font-semibold text-zinc-400">
          Flujo consolidado por concepto · UF
        </h3>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-[11px] tabular-nums whitespace-nowrap">
          <thead>
            <tr className="bg-[#2C4A3B] text-white">
              <th className="text-left font-semibold px-3 py-1.5 sticky left-0 bg-[#2C4A3B] z-10">
                Concepto
              </th>
              {cols.map((i) => (
                <th key={i} className="text-right font-semibold px-2 py-1.5 text-[10px]">
                  {SEM(i)}
                </th>
              ))}
              <th className="text-right font-semibold px-3 py-1.5">Total</th>
            </tr>
          </thead>
          <tbody>
            {r.groups.map((g) => {
              const head = g.sec !== curSec;
              curSec = g.sec;
              return (
                <Fragment key={`${g.sec}·${g.name}`}>
                  {head && (
                    <tr className="bg-[#D9E5DD]">
                      <td
                        colSpan={cols.length + 2}
                        className="px-3 py-1 text-[10px] font-bold text-[#2C4A3B] uppercase tracking-wide sticky left-0 bg-[#D9E5DD]"
                      >
                        {g.sec}
                      </td>
                    </tr>
                  )}
                  <tr className="border-b border-zinc-800/70 hover:bg-zinc-800/30">
                    <td className="px-3 py-1 text-left text-zinc-300 sticky left-0 bg-zinc-950/95">
                      {g.name}
                    </td>
                    {cols.map((i) => (
                      <td key={i} className="px-2 py-1 text-right">
                        {cell(g.arr[i])}
                      </td>
                    ))}
                    <td
                      className={`px-3 py-1 text-right font-semibold ${
                        g.total < -0.5 ? "text-red-400" : "text-zinc-200"
                      }`}
                    >
                      {sg(g.total)}
                    </td>
                  </tr>
                </Fragment>
              );
            })}
            <tr className="bg-zinc-800/60 border-t border-zinc-700">
              <td className="px-3 py-1.5 text-left font-bold sticky left-0 bg-zinc-800">FLUJO NETO</td>
              {cols.map((i) => (
                <td
                  key={i}
                  className={`px-2 py-1.5 text-right font-bold ${
                    r.net[i] < -0.5 ? "text-red-400" : "text-green-400"
                  }`}
                >
                  {sg(r.net[i])}
                </td>
              ))}
              <td className="px-3 py-1.5 text-right font-bold">{sg(r.neto)}</td>
            </tr>
            <tr className="bg-zinc-900">
              <td className="px-3 py-1.5 text-left italic text-zinc-400 sticky left-0 bg-zinc-900">
                Caja acumulada
              </td>
              {cols.map((i) => (
                <td
                  key={i}
                  className={`px-2 py-1.5 text-right ${
                    r.caja[i] < -0.5 ? "text-red-400" : "text-zinc-400"
                  }`}
                >
                  {sg(r.caja[i])}
                </td>
              ))}
              <td className="px-3 py-1.5 text-right font-bold">{sg(r.caja[r.nfv - 1])}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── indicador de paridad con el deck del Directorio ──────────
function Paridad({
  r,
  esTerceros,
  esVertical,
}: {
  r: FlujoResult;
  esTerceros: boolean;
  esVertical: boolean;
}) {
  const ref = esVertical ? PARIDAD_PPTX.vertical : esTerceros ? PARIDAD_PPTX.terceros : null;
  if (!ref) {
    return (
      <p className="text-[10.5px] text-zinc-600 px-1">
        Configuración exploratoria. Activa un preset para contrastar contra las láminas del deck del
        Directorio.
      </p>
    );
  }
  const filas: Array<[string, number, number]> = [
    ["Ingresos", r.ingresos, ref.ingresos],
    ["Costos", r.costos, ref.costos],
    ["Resultado neto", r.neto, ref.neto],
    ["Máx. financiamiento", r.valle, ref.valle],
  ];
  const ok = filas.every(([, a, b]) => Math.abs(a - b) <= 1);

  return (
    <div
      className={`rounded-lg border p-3 ${
        ok ? "border-green-900/60 bg-green-950/20" : "border-red-900/60 bg-red-950/20"
      }`}
    >
      <div className="flex items-center gap-2 mb-1.5">
        <span className={`text-sm ${ok ? "text-green-400" : "text-red-400"}`}>{ok ? "✓" : "✗"}</span>
        <span className={`text-[11px] font-semibold ${ok ? "text-green-300" : "text-red-300"}`}>
          {ok ? "Cuadra con el deck del Directorio" : "No cuadra con el deck del Directorio"}
        </span>
        <span className="text-[10px] text-zinc-500">
          Presentacion_Directorio.pptx · láminas {ref.slide} · valle en {ref.valleSem}
        </span>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        {filas.map(([label, a, b]) => (
          <div key={label} className="text-[10px]">
            <div className="text-zinc-500">{label}</div>
            <div className="tabular-nums text-zinc-300">{uf(a)}</div>
            <div className={`tabular-nums ${Math.abs(a - b) <= 1 ? "text-zinc-600" : "text-red-400"}`}>
              deck {uf(b)}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
