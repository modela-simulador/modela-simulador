// Descarga del Consolidado como libro de Excel: una hoja con el flujo anual
// dividido por unidades de negocio (Tierra / Sanitaria / Consolidado) y una
// hoja de indicadores con la paridad contra las planillas del simulador.
// Mismo diseño verde del deck del Directorio (helpers de integracion-export).

import type { Workbook, Worksheet } from "exceljs";
import {
  banda,
  cabecera,
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
import {
  PARIDAD_PLANILLAS,
  TIERRA_AUDP,
  VAN_RATE,
  YEARS,
  type Unidad,
} from "./consolidado-model";

const TITULO = "Consolidado por Unidad de Negocio — AUDP Batuco + Colina";
const n0 = (v: number): number | null => (Math.abs(v) > 0.5 ? Math.round(v) : null);

export async function construirLibroConsolidado(unidades: Unidad[]): Promise<Workbook> {
  const ExcelJS = (await import("exceljs")).default;
  const wb = new ExcelJS.Workbook();
  wb.creator = "Modela";
  wb.company = "Modela";
  hojaIndicadores(wb, unidades);
  hojaFlujo(wb, unidades);
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

// ── hoja 1 · Indicadores ─────────────────────────────────────

function hojaIndicadores(wb: Workbook, unidades: Unidad[]) {
  const ws = wb.addWorksheet("Indicadores", { views: [{ showGridLines: false }] });
  ws.columns = [{ width: 44 }, { width: 17 }, { width: 17 }, { width: 17 }];
  portada(ws, `Valores en UF · ${YEARS[0]} – ${YEARS[YEARS.length - 1]}`, "anual", 4, TITULO);
  ws.addRow([]);

  banda(ws, "INDICADORES FINANCIEROS", 4);
  cabecera(ws, ["Indicador", ...unidades.map((u) => u.nombre)]);

  const fila = (label: string, vals: (number | string)[], fmt?: string, destacar = false) => {
    const row = ws.addRow([label, ...vals]);
    row.eachCell((c, i) => {
      c.font = { name: FUENTE, size: 10, bold: destacar, color: { argb: TINTA } };
      c.border = LINEA_ABAJO;
      if (i > 1) {
        c.alignment = { horizontal: "right" };
        if (typeof vals[i - 2] === "number" && fmt) c.numFmt = fmt;
      }
    });
    return row;
  };

  fila("Ingresos totales", unidades.map((u) => Math.round(u.totalIngresos)), N_UF);
  fila("Costos totales", unidades.map((u) => Math.round(u.totalCostos)), N_UF);
  fila("Resultado (flujo de caja)", unidades.map((u) => Math.round(u.totalResultado)), N_UF, true);
  fila(`VAN (${VAN_RATE * 100}%) c/ tierra`, unidades.map((u) => Math.round(u.van)), N_UF, true);
  fila("TIR c/ tierra", unidades.map((u) => (u.tir === null ? "—" : u.tir)), "0.0%", true);
  fila("Capital de Trabajo", unidades.map((u) => Math.round(u.capitalTrabajo)), N_UF);
  fila("Payback", unidades.map((u) => u.payback ?? "—"), "0");
  fila("Flujos positivos permanentes desde", unidades.map((u) => u.flujosPermanentes), "0");

  ws.addRow([]);
  banda(ws, "CRITERIOS", 4);
  const nota = (t: string) => {
    const row = ws.addRow([t]);
    ws.mergeCells(row.number, 1, row.number, 4);
    row.getCell(1).font = { name: FUENTE, size: 9, color: { argb: GRIS } };
    row.getCell(1).alignment = { wrapText: true, vertical: "top" };
    return row;
  };
  nota(`La tierra (${TIERRA_AUDP.toLocaleString("es-CL")} UF, valor AUDP del simulador) se devenga proporcional a la venta e impacta VAN, TIR y costos, pero no el capital de trabajo: es un aporte de los dueños, no caja a financiar.`);
  nota("Capital de trabajo: Tierra y Consolidado sobre el resultado acumulado (incluye la factibilización gastada). Sanitaria sobre el flujo futuro: el pago del desarrollador ya netea las inversiones (criterio del simulador).");
  nota("Hasta 2034 mandan los números de la planilla semestral de Integración (urbanizar primero, vender después). Desde 2035 los residuos siguen la forma de las planillas anuales para que los totales calcen con ellas.");
  nota("La tierra asume las inversiones sanitarias. La sanitaria opera la planta y el 2045 vende el negocio en 147.433 UF.");

  ws.addRow([]);
  banda(ws, "PARIDAD CON LAS PLANILLAS DEL SIMULADOR", 4);
  cabecera(ws, ["Concepto", "Modelo", "Planilla anual", "Diferencia"]);
  const t = unidades[0];
  const total = (labelStart: string) => {
    const l = t.costos.find((c) => c.label.startsWith(labelStart));
    return l ? Math.round(l.total) : 0;
  };
  const comparar = (label: string, vivo: number, deck: number) => {
    const row = ws.addRow([label, vivo, deck, vivo - deck]);
    row.eachCell((c, i) => {
      c.font = { name: FUENTE, size: 10, color: { argb: TINTA } };
      c.border = LINEA_ABAJO;
      if (i > 1) {
        c.numFmt = N_UF;
        c.alignment = { horizontal: "right" };
      }
    });
    const d = row.getCell(4);
    d.font = { name: FUENTE, size: 10, bold: true, color: { argb: Math.abs(vivo - deck) < 1 ? "FF1D7A45" : "FFB91C1C" } };
  };
  comparar("Ingresos Venta de Tierra", Math.round(t.totalIngresos), PARIDAD_PLANILLAS.ingresosTierra);
  comparar("Costos Infraestructura", total("Costos Infraestructura"), PARIDAD_PLANILLAS.infraestructura);
  comparar("Costos Mitigaciones", total("Costos Mitigaciones"), PARIDAD_PLANILLAS.mitigaciones);
  comparar("Mantención y seguridad", total("Mantención"), PARIDAD_PLANILLAS.mantencion);
  comparar("Inversiones Sanitarias", total("Inversiones Sanitarias"), PARIDAD_PLANILLAS.inversionesSanitarias);
}

// ── hoja 2 · Flujo por unidad de negocio ─────────────────────

function hojaFlujo(wb: Workbook, unidades: Unidad[]) {
  const ws = wb.addWorksheet("Flujo por unidad", { views: [{ showGridLines: false }] });
  const ancho = YEARS.length + 2;
  ws.columns = [{ width: 38 }, ...YEARS.map(() => ({ width: 10.5 })), { width: 12.5 }];
  portada(ws, "Flujo anual por unidad de negocio · UF", "anual", ancho, TITULO);
  ws.addRow([]);
  cabecera(ws, ["Concepto", ...YEARS.map(String), "Total"]);
  ws.views = [{ state: "frozen", xSplit: 1, ySplit: 4, showGridLines: false }];

  for (const u of unidades) {
    const bandaRow = banda(ws, `UNIDAD ${u.nombre.toUpperCase()}`, ancho);
    bandaRow.getCell(1).font = { name: FUENTE, size: 10, bold: true, color: { argb: VERDE } };
    let z = 0;
    const linea = (label: string, arr: number[], opts?: { informativa?: boolean }) => {
      const row = ws.addRow([label, ...arr.map(n0), Math.round(arr.reduce((a, b) => a + b, 0))]);
      row.eachCell({ includeEmpty: true }, (c, i) => {
        if (i > ancho) return;
        c.font = { name: FUENTE, size: 9.5, italic: opts?.informativa, color: { argb: opts?.informativa ? GRIS : TINTA } };
        c.border = LINEA_ABAJO;
        if (!opts?.informativa && z % 2 === 1) c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: ZEBRA } };
        if (i > 1) {
          c.numFmt = N_UF;
          c.alignment = { horizontal: "right" };
        }
      });
      row.getCell(ancho).font = { name: FUENTE, size: 9.5, bold: !opts?.informativa, italic: opts?.informativa, color: { argb: opts?.informativa ? GRIS : TINTA } };
      z++;
      return row;
    };

    // ingresos y costos de caja (la tierra devengada va aparte, informativa)
    for (const l of u.ingresos) linea(l.label, l.arr);
    for (const l of u.costos.filter((c) => !c.label.startsWith("Costo de la Tierra"))) linea(l.label, l.arr);

    const neto = ws.addRow(["FLUJO NETO", ...u.resultado.map(n0), Math.round(u.totalResultado)]);
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
    const caja = ws.addRow(["Caja acumulada", ...u.resultadoAcum.map(n0), Math.round(u.resultadoAcum[u.resultadoAcum.length - 1])]);
    caja.eachCell((c, i) => {
      c.font = { name: FUENTE, size: 9.5, italic: true, color: { argb: GRIS } };
      c.border = LINEA_ABAJO;
      if (i > 1) {
        c.numFmt = N_UF;
        c.alignment = { horizontal: "right" };
      }
    });

    const tierraLinea = u.costos.find((c) => c.label.startsWith("Costo de la Tierra"));
    if (tierraLinea) {
      linea(tierraLinea.label, tierraLinea.arr, { informativa: true });
      linea("Resultado c/ tierra (económico)", u.resultado.map((v, i) => v + tierraLinea.arr[i]), { informativa: true });
    }
    ws.addRow([]);
  }
}
