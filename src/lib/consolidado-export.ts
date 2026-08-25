// Descarga del Consolidado como libro de Excel de TRES hojas — Tierra,
// Sanitaria y Consolidado — cada una con su flujo anual y sus indicadores.
//
// Todo lo calculado va con FÓRMULA (más su resultado cacheado): totales por
// fila, comercialización 2%, flujo neto, cajas acumuladas, tierra devengada,
// VAN (NPV), TIR (IRR), capital de trabajo (MIN), payback (INDEX/MATCH) y
// flujos permanentes (SUMPRODUCT). La hoja Consolidado referencia celda a
// celda a las otras dos: tocar un número recalcula el libro entero.
// Ojo: en el XML de xlsx las fórmulas van SIEMPRE con coma como separador de
// argumentos (formato en-US); Excel las muestra con ; según el idioma.
// Mismo diseño verde del deck del Directorio (helpers de integracion-export).

import type { Workbook, Worksheet, Row, CellValue } from "exceljs";
import {
  banda,
  FUENTE,
  GRIS,
  LINEA_ABAJO,
  N_NETO,
  N_UF,
  portada,
  TINTA,
  VERDE,
  ZEBRA,
} from "./integracion-export";
import { TIERRA_AUDP, VAN_RATE, YEARS, type Unidad } from "./consolidado-model";

const TITULO = "Consolidado por Unidad de Negocio — AUDP Batuco + Colina";
const NY = YEARS.length; // 20 años → columnas B..U; V = Total
const COL_TOT = NY + 2;
const L = (n: number) => String.fromCharCode(64 + n); // 2→B … 22→V
const LT = L(COL_TOT);
const LU = L(NY + 1); // última columna de años
const rango = (row: number) => `B${row}:${LU}${row}`;
const n0 = (v: number): number | null => (Math.abs(v) > 0.5 ? Math.round(v) : null);

/** Fórmula con resultado cacheado: Excel/LibreOffice muestran el valor y recalculan al editar. */
const F = (formula: string, result: number): CellValue => ({ formula, result });

interface Ctx {
  ws: Worksheet;
  hdrRow: number;
  zebra: number;
  filas: Record<string, number>; // label → número de fila
}

export async function construirLibroConsolidado(unidades: Unidad[]): Promise<Workbook> {
  const ExcelJS = (await import("exceljs")).default;
  const wb = new ExcelJS.Workbook();
  wb.creator = "Modela";
  wb.company = "Modela";
  const [tierra, sanitaria, consolidado] = unidades;
  const ctxT = hojaTierra(wb, tierra);
  const ctxS = hojaSanitaria(wb, sanitaria, ctxT);
  hojaConsolidado(wb, consolidado, ctxT, ctxS);
  return wb;
}

export async function descargarConsolidado(unidades: Unidad[]) {
  const wb = await construirLibroConsolidado(unidades);
  const buf = await wb.xlsx.writeBuffer();
  const blob = new Blob([buf], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `consolidado-unidades-negocio-${new Date().toISOString().slice(0, 10)}.xlsx`;
  a.click();
  URL.revokeObjectURL(url);
}

// ── esqueleto común ──────────────────────────────────────────

function abrirHoja(wb: Workbook, nombre: string, subtitulo: string): Ctx {
  const ws = wb.addWorksheet(nombre, { views: [{ showGridLines: false }] });
  ws.columns = [{ width: 40 }, ...YEARS.map(() => ({ width: 10.5 })), { width: 12.5 }];
  portada(ws, subtitulo, "anual", COL_TOT, TITULO);
  ws.addRow([]);
  return { ws, hdrRow: 0, zebra: 0, filas: {} };
}

/** Cabecera de años como NÚMEROS, para que INDEX/MATCH del payback devuelvan el año. */
function cabeceraAnios(ctx: Ctx) {
  const row = ctx.ws.addRow(["Concepto", ...YEARS, "Total"]);
  row.height = 18;
  row.eachCell((c, i) => {
    c.font = { name: FUENTE, size: 9, bold: true, color: { argb: "FFFFFFFF" } };
    c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: VERDE } };
    c.alignment = { horizontal: i === 1 ? "left" : "right", vertical: "middle" };
    if (i > 1 && i < COL_TOT) c.numFmt = "0";
  });
  ctx.hdrRow = row.number;
  ctx.ws.views = [{ state: "frozen", xSplit: 1, ySplit: row.number, showGridLines: false }];
}

/** Fila del flujo; el Total siempre es =SUM de la fila (o la fórmula que se pase). */
function linea(
  ctx: Ctx,
  label: string,
  celdas: CellValue[],
  totalResult: number,
  opts?: { informativa?: boolean; totalFormula?: string },
): Row {
  const row = ctx.ws.addRow([label, ...celdas, 0]);
  row.getCell(COL_TOT).value = F(opts?.totalFormula ?? `SUM(${rango(row.number)})`, Math.round(totalResult));
  row.eachCell({ includeEmpty: true }, (c, i) => {
    if (i > COL_TOT) return;
    c.font = {
      name: FUENTE,
      size: 9.5,
      italic: opts?.informativa,
      color: { argb: opts?.informativa ? GRIS : TINTA },
    };
    c.border = LINEA_ABAJO;
    if (!opts?.informativa && ctx.zebra % 2 === 1)
      c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: ZEBRA } };
    if (i > 1) {
      c.numFmt = N_UF;
      c.alignment = { horizontal: "right" };
    }
  });
  row.getCell(COL_TOT).font = {
    name: FUENTE,
    size: 9.5,
    bold: !opts?.informativa,
    italic: opts?.informativa,
    color: { argb: opts?.informativa ? GRIS : TINTA },
  };
  ctx.zebra++;
  ctx.filas[label] = row.number;
  return row;
}

/**
 * FLUJO NETO (=SUM de ingresos + SUM de costos por columna) y Caja acumulada
 * (=celda anterior + flujo del año), ambos como fórmulas.
 */
function filasNeto(
  ctx: Ctx,
  ing: [number, number],
  cos: [number, number],
  flujo: number[],
  acumArr: number[],
  totalResultado: number,
) {
  const ws = ctx.ws;
  const neto = ws.addRow([
    "FLUJO NETO",
    ...flujo.map((v, i) => {
      const c = L(i + 2);
      return F(`SUM(${c}${ing[0]}:${c}${ing[1]})+SUM(${c}${cos[0]}:${c}${cos[1]})`, Math.round(v));
    }),
    0,
  ]);
  neto.getCell(COL_TOT).value = F(`SUM(${rango(neto.number)})`, Math.round(totalResultado));
  neto.height = 17;
  neto.eachCell((c, i) => {
    c.font = { name: FUENTE, size: 10, bold: true, color: { argb: TINTA } };
    c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFD9E5DD" } };
    c.border = { top: { style: "thin", color: { argb: VERDE } } };
    if (i > 1) {
      c.numFmt = N_NETO;
      c.alignment = { horizontal: "right" };
    }
  });
  ctx.filas["FLUJO NETO"] = neto.number;

  const nf = neto.number;
  const caja = ws.addRow([
    "Caja acumulada",
    ...acumArr.map((v, i) =>
      i === 0 ? F(`B${nf}`, Math.round(v)) : F(`${L(i + 1)}${nf + 1}+${L(i + 2)}${nf}`, Math.round(v)),
    ),
    F(`${LU}${nf + 1}`, Math.round(acumArr[NY - 1])),
  ]);
  caja.eachCell((c, i) => {
    c.font = { name: FUENTE, size: 9.5, italic: true, color: { argb: GRIS } };
    c.border = LINEA_ABAJO;
    if (i > 1) {
      c.numFmt = N_UF;
      c.alignment = { horizontal: "right" };
    }
  });
  ctx.filas["Caja acumulada"] = caja.number;
}

/** Bloque de indicadores financieros, todo con fórmulas sobre las filas de la hoja. */
function indicadores(
  ctx: Ctx,
  u: Unidad,
  cfg: {
    filaEcon: number;
    filaCajaKT: number;
    rangosIng: [number, number];
    rangosCos: [number, number];
    conTierra: boolean;
    tasaRef: string; // celda o constante con la tasa de descuento
  },
) {
  const ws = ctx.ws;
  ws.addRow([]);
  banda(ws, "INDICADORES FINANCIEROS", COL_TOT);
  const { filaEcon, filaCajaKT, rangosIng, rangosCos, conTierra, tasaRef } = cfg;
  const h = ctx.hdrRow;
  const dato = (label: string, formula: string, result: number, fmt: string, destacar = false) => {
    const row = ws.addRow([label, F(formula, result)]);
    row.getCell(1).font = { name: FUENTE, size: 10, bold: destacar, color: { argb: TINTA } };
    row.getCell(1).border = LINEA_ABAJO;
    const v = row.getCell(2);
    v.font = { name: FUENTE, size: 10, bold: destacar, color: { argb: TINTA } };
    v.alignment = { horizontal: "right" };
    v.border = LINEA_ABAJO;
    v.numFmt = fmt;
  };
  const sufijo = conTierra ? " c/ tierra" : "";
  dato("Ingresos totales", `SUM(${LT}${rangosIng[0]}:${LT}${rangosIng[1]})`, Math.round(u.totalIngresos), N_UF);
  dato("Costos totales", `SUM(${LT}${rangosCos[0]}:${LT}${rangosCos[1]})`, Math.round(u.totalCostos), N_UF);
  dato("Resultado (flujo de caja)", `${LT}${ctx.filas["FLUJO NETO"]}`, Math.round(u.totalResultado), N_UF, true);
  dato(
    `VAN (${VAN_RATE * 100}%)${sufijo}`,
    `B${filaEcon}+NPV(${tasaRef},C${filaEcon}:${LU}${filaEcon})`,
    Math.round(u.van),
    N_UF,
    true,
  );
  dato(`TIR${sufijo}`, `IRR(${rango(filaEcon)})`, u.tir ?? 0, "0.0%", true);
  dato("Capital de Trabajo", `-MIN(${rango(filaCajaKT)})`, Math.round(u.capitalTrabajo), N_UF);
  dato(
    "Payback",
    `INDEX($B$${h}:$${LU}$${h},MATCH(TRUE,INDEX(${rango(ctx.filas["Caja acumulada"])}>=0,0),0))`,
    u.payback ?? 0,
    "0",
  );
  dato(
    "Flujos positivos permanentes desde",
    `SUMPRODUCT(MAX((${rango(ctx.filas["FLUJO NETO"])}<-0.5)*($B$${h}:$${LU}$${h})))+1`,
    u.flujosPermanentes,
    "0",
  );
}

function notas(ctx: Ctx, textos: string[]) {
  const ws = ctx.ws;
  ws.addRow([]);
  for (const t of textos) {
    const row = ws.addRow([t]);
    ws.mergeCells(row.number, 1, row.number, COL_TOT);
    row.getCell(1).font = { name: FUENTE, size: 9, color: { argb: GRIS } };
    row.getCell(1).alignment = { wrapText: true, vertical: "top" };
  }
}

const arrDe = (u: Unidad, label: string) => [...u.ingresos, ...u.costos].find((l) => l.label === label)!;

// ── hoja TIERRA ──────────────────────────────────────────────

function hojaTierra(wb: Workbook, u: Unidad): Ctx {
  const ctx = abrirHoja(wb, "Tierra", "Negocio Venta de Tierra · flujo anual en UF");
  const ws = ctx.ws;

  // supuestos editables: las fórmulas de la hoja los referencian
  banda(ws, "SUPUESTOS", COL_TOT);
  const sup = (label: string, v: number, fmt: string) => {
    const row = ws.addRow([label, v]);
    row.getCell(1).font = { name: FUENTE, size: 9.5, color: { argb: TINTA } };
    row.getCell(1).border = LINEA_ABAJO;
    const c = row.getCell(2);
    c.font = { name: FUENTE, size: 9.5, bold: true, color: { argb: TINTA } };
    c.alignment = { horizontal: "right" };
    c.numFmt = fmt;
    c.border = LINEA_ABAJO;
    return row.number;
  };
  const rTasa = sup("Tasa de descuento", VAN_RATE, "0%");
  ctx.filas["__tasa"] = rTasa;
  const rCom = sup("Comisión de venta", 0.02, "0%");
  const rTierra = sup("Valor de la tierra (aporte)", TIERRA_AUDP, N_UF);
  ws.addRow([]);

  cabeceraAnios(ctx);
  banda(ws, "INGRESOS", COL_TOT);
  const ing = arrDe(u, "Ingresos Venta de Tierra");
  const copec = arrDe(u, "Venta terreno COPEC");
  linea(ctx, ing.label, ing.arr.map(n0), ing.total);
  linea(ctx, copec.label, copec.arr.map(n0), copec.total);
  const rIng = ctx.filas[ing.label];
  const rCopec = ctx.filas[copec.label];

  banda(ws, "COSTOS", COL_TOT);
  for (const label of ["Costos Infraestructura", "Costos Mitigaciones"]) {
    const l = arrDe(u, label);
    linea(ctx, l.label, l.arr.map(n0), l.total);
  }
  const com = arrDe(u, "Comercialización (2%)");
  linea(
    ctx,
    com.label,
    com.arr.map((v, i) => {
      const c = L(i + 2);
      return Math.abs(v) > 0.5 ? F(`-$B$${rCom}*SUM(${c}${rIng}:${c}${rCopec})`, Math.round(v)) : null;
    }),
    com.total,
  );
  for (const label of [
    "Mantención y seguridad",
    "Equipamiento comercial (neto)",
    "Inversiones Sanitarias (asumidas)",
    "Factibilización por gastar",
    "Factibilización gastada (al 2026)",
  ]) {
    const l = arrDe(u, label);
    linea(ctx, l.label, l.arr.map(n0), l.total);
  }
  const rCos1 = ctx.filas["Costos Infraestructura"];
  const rGastada = ctx.filas["Factibilización gastada (al 2026)"];

  filasNeto(ctx, [rIng, rCopec], [rCos1, rGastada], u.resultado, u.resultadoAcum, u.totalResultado);
  const nf = ctx.filas["FLUJO NETO"];

  // tierra devengada: -tierra × venta del año / venta total (COPEC fuera)
  const dev = arrDe(u, "Costo de la Tierra (aporte, devengado)");
  linea(
    ctx,
    dev.label,
    dev.arr.map((v, i) => {
      const c = L(i + 2);
      return Math.abs(v) > 0.5 ? F(`-$B$${rTierra}*${c}${rIng}/$${LT}$${rIng}`, Math.round(v)) : null;
    }),
    dev.total,
    { informativa: true },
  );
  const rDev = ctx.filas[dev.label];

  // flujo que descuentan el VAN y la TIR: neto − factib. gastada (hundida) + tierra.
  // u.flujoVan ya es exactamente eso (el flujo futuro no incluye la gastada).
  linea(
    ctx,
    "Flujo económico (c/ tierra, excl. factib. gastada)",
    u.flujoVan.map((v, i) => {
      const c = L(i + 2);
      return F(`${c}${nf}-SUM(${c}${rGastada})+SUM(${c}${rDev})`, Math.round(v));
    }),
    u.flujoVan.reduce((a, b) => a + b, 0),
    { informativa: true },
  );

  indicadores(ctx, u, {
    filaEcon: ctx.filas["Flujo económico (c/ tierra, excl. factib. gastada)"],
    filaCajaKT: ctx.filas["Caja acumulada"],
    rangosIng: [rIng, rCopec],
    rangosCos: [rCos1, rGastada],
    conTierra: true,
    tasaRef: `$B$${rTasa}`,
  });
  notas(ctx, [
    "La tierra se devenga proporcional a la venta e impacta VAN, TIR y costos, pero no el capital de trabajo: es un aporte de los dueños, no caja a financiar. El VAN y la TIR descuentan el flujo económico (c/ tierra, sin la factibilización gastada, que es costo hundido).",
    "Hasta 2034 mandan los números de la planilla semestral de Integración (urbanizar primero, vender después). Desde 2035 los residuos siguen la forma de la planilla anual de Primeras Etapas AUDP: los totales calzan con ella.",
  ]);
  return ctx;
}

// ── hoja SANITARIA ───────────────────────────────────────────

function hojaSanitaria(wb: Workbook, u: Unidad, t: Ctx): Ctx {
  const ctx = abrirHoja(wb, "Sanitaria", "Negocio Sanitario · flujo anual en UF");
  const ws = ctx.ws;
  cabeceraAnios(ctx);

  banda(ws, "INGRESOS", COL_TOT);
  const ingOp = arrDe(u, "Ingresos Operacionales");
  const pago = arrDe(u, "Pago Desarrollador (neteo inversiones)");
  const venta = arrDe(u, "Venta Negocio Sanitario (2045)");
  linea(ctx, ingOp.label, ingOp.arr.map(n0), ingOp.total);
  const pagoRow = linea(ctx, pago.label, pago.arr.map(n0), pago.total);
  linea(ctx, venta.label, venta.arr.map(n0), venta.total);

  banda(ws, "COSTOS", COL_TOT);
  for (const label of [
    "Costos Operacionales",
    "Inversiones Sanitarias",
    "Factibilización por gastar",
    "Factibilización gastada (al 2026)",
  ]) {
    const l = arrDe(u, label);
    linea(ctx, l.label, l.arr.map(n0), l.total);
  }
  const rInv = ctx.filas["Inversiones Sanitarias"];
  // el pago del desarrollador ES el espejo de las inversiones: fórmula, no valor
  for (let i = 0; i < NY; i++) {
    const c = L(i + 2);
    ws.getCell(`${c}${pagoRow.number}`).value =
      Math.abs(pago.arr[i]) > 0.5 ? F(`-${c}${rInv}`, Math.round(pago.arr[i])) : null;
  }

  const rIng1 = ctx.filas["Ingresos Operacionales"];
  const rVenta = ctx.filas["Venta Negocio Sanitario (2045)"];
  const rCos1 = ctx.filas["Costos Operacionales"];
  const rGastada = ctx.filas["Factibilización gastada (al 2026)"];
  filasNeto(ctx, [rIng1, rVenta], [rCos1, rGastada], u.resultado, u.resultadoAcum, u.totalResultado);
  const nf = ctx.filas["FLUJO NETO"];

  // flujo y caja sin la factibilización gastada: la base del VAN, la TIR y el KT sanitario
  linea(
    ctx,
    "Flujo s/ factib. gastada",
    u.flujo.map((v, i) => {
      const c = L(i + 2);
      return F(`${c}${nf}-SUM(${c}${rGastada})`, Math.round(v));
    }),
    u.flujo.reduce((a, b) => a + b, 0),
    { informativa: true },
  );
  const rEcon = ctx.filas["Flujo s/ factib. gastada"];
  const cajaFut: number[] = [];
  u.flujo.reduce((s, v) => {
    const n = s + v;
    cajaFut.push(n);
    return n;
  }, 0);
  linea(
    ctx,
    "Caja acumulada s/ factib. gastada",
    cajaFut.map((v, i) =>
      i === 0 ? F(`B${rEcon}`, Math.round(v)) : F(`${L(i + 1)}${rEcon + 1}+${L(i + 2)}${rEcon}`, Math.round(v)),
    ),
    cajaFut[NY - 1],
    { informativa: true, totalFormula: `${LU}${rEcon + 1}` },
  );

  indicadores(ctx, u, {
    filaEcon: rEcon,
    filaCajaKT: ctx.filas["Caja acumulada s/ factib. gastada"],
    rangosIng: [rIng1, rVenta],
    rangosCos: [rCos1, rGastada],
    conTierra: false,
    tasaRef: `Tierra!$B$${t.filas["__tasa"]}`,
  });
  notas(ctx, [
    "La sanitaria paga las inversiones y recibe del desarrollador un pago equivalente (efecto neto 0): el desarrollo de la tierra las asume. Opera la planta y el 2045 vende el negocio en 147.433 UF.",
    "Capital de trabajo sobre el flujo futuro (sin la factibilización gastada): el pago del desarrollador ya netea las inversiones — criterio del simulador para los modos sanitarios.",
  ]);
  return ctx;
}

// ── hoja CONSOLIDADO: referencias a las otras dos ────────────

function hojaConsolidado(wb: Workbook, u: Unidad, t: Ctx, s: Ctx) {
  const ctx = abrirHoja(wb, "Consolidado", "Tierra + Sanitaria · flujo anual en UF");
  const ws = ctx.ws;
  cabeceraAnios(ctx);

  const g = (label: string) => arrDe(u, label);
  /** Fila que referencia celda a celda una fila de otra hoja. */
  const ref = (hoja: "Tierra" | "Sanitaria", fila: number, label: string, opts?: { informativa?: boolean }) => {
    const l = g(label);
    return linea(
      ctx,
      label,
      l.arr.map((v, i) => {
        const c = L(i + 2);
        return Math.abs(v) > 0.5 ? F(`${hoja}!${c}${fila}`, Math.round(v)) : null;
      }),
      l.total,
      opts,
    );
  };
  /** Fila que suma la misma fila de ambas hojas (la factibilización agrupada). */
  const ref2 = (fT: number, fS: number, label: string) => {
    const l = g(label);
    return linea(
      ctx,
      label,
      l.arr.map((v, i) => {
        const c = L(i + 2);
        return Math.abs(v) > 0.5 ? F(`SUM(Tierra!${c}${fT})+SUM(Sanitaria!${c}${fS})`, Math.round(v)) : null;
      }),
      l.total,
    );
  };

  banda(ws, "INGRESOS", COL_TOT);
  ref("Tierra", t.filas["Ingresos Venta de Tierra"], "Ingresos Venta de Tierra");
  ref("Tierra", t.filas["Venta terreno COPEC"], "Venta terreno COPEC");
  ref("Sanitaria", s.filas["Ingresos Operacionales"], "Ingresos Operacionales");
  ref("Sanitaria", s.filas["Pago Desarrollador (neteo inversiones)"], "Pago Desarrollador (neteo inversiones)");
  ref("Sanitaria", s.filas["Venta Negocio Sanitario (2045)"], "Venta Negocio Sanitario (2045)");
  const rIng1 = ctx.filas["Ingresos Venta de Tierra"];
  const rIngN = ctx.filas["Venta Negocio Sanitario (2045)"];

  banda(ws, "COSTOS", COL_TOT);
  ref("Tierra", t.filas["Costos Infraestructura"], "Costos Infraestructura");
  ref("Tierra", t.filas["Costos Mitigaciones"], "Costos Mitigaciones");
  ref("Tierra", t.filas["Comercialización (2%)"], "Comercialización (2%)");
  ref("Tierra", t.filas["Mantención y seguridad"], "Mantención y seguridad");
  ref("Tierra", t.filas["Equipamiento comercial (neto)"], "Equipamiento comercial (neto)");
  ref("Tierra", t.filas["Inversiones Sanitarias (asumidas)"], "Inversiones Sanitarias (asumidas)");
  ref("Sanitaria", s.filas["Costos Operacionales"], "Costos Operacionales");
  ref("Sanitaria", s.filas["Inversiones Sanitarias"], "Inversiones Sanitarias");
  ref2(t.filas["Factibilización por gastar"], s.filas["Factibilización por gastar"], "Factibilización por gastar");
  ref2(t.filas["Factibilización gastada (al 2026)"], s.filas["Factibilización gastada (al 2026)"], "Factibilización gastada (al 2026)");
  const rCos1 = ctx.filas["Costos Infraestructura"];
  const rGastada = ctx.filas["Factibilización gastada (al 2026)"];

  filasNeto(ctx, [rIng1, rIngN], [rCos1, rGastada], u.resultado, u.resultadoAcum, u.totalResultado);
  const nf = ctx.filas["FLUJO NETO"];

  const dev = g("Costo de la Tierra (aporte, devengado)");
  ref("Tierra", t.filas["Costo de la Tierra (aporte, devengado)"], dev.label, { informativa: true });
  const rDev = ctx.filas[dev.label];

  // u.flujoVan ya excluye la factibilización gastada e incluye la tierra
  linea(
    ctx,
    "Flujo económico (c/ tierra, excl. factib. gastada)",
    u.flujoVan.map((v, i) => {
      const c = L(i + 2);
      return F(`${c}${nf}-SUM(${c}${rGastada})+SUM(${c}${rDev})`, Math.round(v));
    }),
    u.flujoVan.reduce((a, b) => a + b, 0),
    { informativa: true },
  );

  indicadores(ctx, u, {
    filaEcon: ctx.filas["Flujo económico (c/ tierra, excl. factib. gastada)"],
    filaCajaKT: ctx.filas["Caja acumulada"],
    rangosIng: [rIng1, rIngN],
    rangosCos: [rCos1, rGastada],
    conTierra: true,
    tasaRef: `Tierra!$B$${t.filas["__tasa"]}`,
  });
  notas(ctx, [
    "Cada celda de esta hoja referencia a las hojas Tierra y Sanitaria: tocar un número allá recalcula el consolidado. Las inversiones sanitarias aparecen en la tierra (asumidas), en la sanitaria (pagadas) y en el pago del desarrollador (+): el neto las cuenta una sola vez.",
  ]);
}
