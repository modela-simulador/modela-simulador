// Descarga del flujo de /integracion como libro de Excel.
// Tres hojas: el resumen del escenario, el flujo consolidado tal como se ve en
// pantalla, y el desglose partida por partida. Los importes van como NÚMEROS
// (no texto) para que el que reciba el archivo pueda sumarlos y pivotearlos.

import * as XLSX from "xlsx";
import {
  CONTEXTO,
  LAYERS,
  PARIDAD_PPTX,
  SEM,
  trunc,
  type FlujoResult,
  type LayerState,
} from "./integracion-model";

type Cell = string | number;
type Row = Cell[];

/** UF enteras; las celdas nulas quedan en blanco, como el "·" de la tabla. */
const n0 = (v: number): Cell => (Math.abs(v) > 0.5 ? Math.round(v) : "");

export interface ExportFlujosConfig {
  r: FlujoResult;
  layers: LayerState;
  share: number;
  /** Nombre legible del escenario: "Venta a terceros", "Vertical integrado" o "Personalizado". */
  escenario: string;
  /** Escenario del deck contra el que contrastar, si el actual es uno de los dos. */
  paridad: keyof typeof PARIDAD_PPTX | null;
}

export function descargarFlujos({ r, layers, share, escenario, paridad }: ExportFlujosConfig) {
  const sems = Array.from({ length: r.nfv }, (_, i) => SEM(i));
  const vertical = layers.inmobiliario;
  const wb = XLSX.utils.book_new();

  // ── hoja 1 · Resumen ───────────────────────────────────────
  const resumen: Row[] = [
    ["Integración Vertical — AUDP Batuco + Colina"],
    [`Flujo semestral en UF · ${sems[0]} – ${sems[r.nfv - 1]}`],
    ["Escenario", escenario],
    [],
    ["CAPAS DEL NEGOCIO"],
    ...LAYERS.map((l): Row => [`${l.n}. ${l.nombre}`, layers[l.id] ? "Encendida" : "Apagada"]),
  ];
  let filaShare = -1;
  if (vertical) {
    filaShare = resumen.length;
    resumen.push(["Participación en el negocio inmobiliario", share]);
  }
  resumen.push(
    [],
    ["RESULTADO"],
    ["Ingresos", Math.round(r.ingresos)],
    ["Costos", Math.round(r.costos)],
    ["Resultado neto", Math.round(r.neto)],
  );
  if (vertical) {
    resumen.push(
      ["Utilidad inmobiliaria", Math.round(r.utilidadInmob)],
      ["Caja máxima del macroloteador", Math.round(r.valleMacro)],
      ["Máximo financiamiento de capital de trabajo", Math.round(r.valleInmob)],
    );
  } else {
    resumen.push([`Máximo financiamiento · ${SEM(r.valleIdx)}`, Math.round(r.valle)]);
  }
  resumen.push(
    [],
    ["CONTEXTO DEL PROYECTO"],
    ["Ventas brutas", Math.round(CONTEXTO.pxq)],
    ["Unidades", Math.round(CONTEXTO.unidades)],
    ["Valor del suelo", Math.round(CONTEXTO.suelo)],
    ["Capital de trabajo", Math.round(CONTEXTO.capitalTrabajo)],
  );

  if (paridad) {
    const p = PARIDAD_PPTX[paridad];
    const fila = (label: string, vivo: number, deck: number): Row => [
      label,
      Math.round(vivo),
      deck,
      Math.round(vivo - deck),
    ];
    resumen.push(
      [],
      [`PARIDAD CON EL DECK DEL DIRECTORIO · láminas ${p.slide}`],
      ["Concepto", "Modelo en vivo", "Presentacion_Directorio.pptx", "Diferencia"],
      fila("Ingresos", r.ingresos, p.ingresos),
      fila("Costos", r.costos, p.costos),
      fila("Resultado neto", r.neto, p.neto),
      fila("Valle de caja", r.valle, p.valle),
    );
    if (paridad === "vertical") {
      const pv = PARIDAD_PPTX.vertical;
      resumen.push(
        fila("Valle del macroloteador", r.valleMacro, pv.valleMacro),
        fila("Valle de capital de trabajo", r.valleInmob, pv.valleInmob),
      );
    }
  }

  const wsResumen = XLSX.utils.aoa_to_sheet(resumen);
  wsResumen["!cols"] = [{ wch: 42 }, { wch: 16 }, { wch: 28 }, { wch: 13 }];
  formatoMiles(wsResumen);
  if (filaShare >= 0) {
    const c = wsResumen[XLSX.utils.encode_cell({ r: filaShare, c: 1 })];
    if (c) c.z = "0%";
  }
  XLSX.utils.book_append_sheet(wb, wsResumen, "Resumen");

  // ── hoja 2 · Flujo consolidado ─────────────────────────────
  const flujo: Row[] = [["Concepto", ...sems, "Total"]];
  let sec = "";
  for (const g of r.groups) {
    if (g.sec !== sec) {
      sec = g.sec;
      flujo.push([sec]);
    }
    flujo.push([g.name, ...g.arr.map(n0), Math.round(g.total)]);
  }
  flujo.push(
    ["FLUJO NETO", ...r.net.map(n0), Math.round(r.neto)],
    ["Caja acumulada", ...r.caja.map(n0), Math.round(r.caja[r.nfv - 1])],
  );
  const wsFlujo = XLSX.utils.aoa_to_sheet(flujo);
  wsFlujo["!cols"] = [{ wch: 32 }, ...sems.map(() => ({ wch: 11 })), { wch: 12 }];
  formatoMiles(wsFlujo);
  XLSX.utils.book_append_sheet(wb, wsFlujo, "Flujo");

  // ── hoja 3 · Detalle por partida ───────────────────────────
  const CAP = { macro: "Macroloteador", inmob: "Inmobiliario" } as const;
  const detalle: Row[] = [["Grupo", "Partida", "Cuenta", "Capa", ...sems, "Total"]];
  for (const l of r.lines) {
    const arr = trunc(l.arr, r.nfv);
    const capa = LAYERS.find((x) => x.id === l.layer);
    detalle.push([
      l.grp,
      l.label,
      CAP[l.cap],
      capa ? `${capa.n}. ${capa.nombre}` : l.layer,
      ...arr.map(n0),
      Math.round(arr.reduce((a, b) => a + b, 0)),
    ]);
  }
  const wsDetalle = XLSX.utils.aoa_to_sheet(detalle);
  wsDetalle["!cols"] = [
    { wch: 24 },
    { wch: 34 },
    { wch: 15 },
    { wch: 24 },
    ...sems.map(() => ({ wch: 11 })),
    { wch: 12 },
  ];
  formatoMiles(wsDetalle);
  XLSX.utils.book_append_sheet(wb, wsDetalle, "Detalle");

  const slug = escenario.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  XLSX.writeFile(wb, `flujo-integracion-${slug}-${new Date().toISOString().slice(0, 10)}.xlsx`);
}

/** Miles con punto y negativos con signo, como en la tabla y en el deck. */
function formatoMiles(ws: XLSX.WorkSheet) {
  const ref = ws["!ref"];
  if (!ref) return;
  const range = XLSX.utils.decode_range(ref);
  for (let R = range.s.r; R <= range.e.r; R++) {
    for (let C = range.s.c; C <= range.e.c; C++) {
      const cell = ws[XLSX.utils.encode_cell({ r: R, c: C })];
      if (cell && cell.t === "n") cell.z = "#,##0;-#,##0";
    }
  }
}
