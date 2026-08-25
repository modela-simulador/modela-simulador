// Consolidado anual por unidades de negocio — AUDP Batuco + Colina.
//
// Dos unidades: VENTA DE TIERRA y SANITARIA, más su suma. Reglas del
// Directorio (2026-08-25):
//
//  · Hasta 2034 mandan los números, periodos y costos de la planilla
//    SEMESTRAL de /integracion (venta a terceros), anualizada. Ese plan
//    urbaniza primero y vende después: más infraestructura temprana y una
//    caja más negativa — el escenario real.
//  · Desde 2035, cada concepto recibe su residuo (total de la planilla
//    anual de Primeras Etapas menos lo ya consumido) repartido con la
//    forma de esa planilla, para que los TOTALES calcen con ella.
//  · La tierra (343.000 UF — AUDP_TIERRA_TOTAL del simulador) se devenga
//    proporcional a la venta e impacta VAN, TIR y costos, pero NO el
//    capital de trabajo: es un aporte de los dueños, no caja a financiar.
//  · La tierra asume las inversiones sanitarias. La sanitaria las paga y
//    recibe del desarrollador un pago equivalente (efecto neto 0), opera
//    la planta y el 2045 vende el negocio en 147.433 UF.
//  · Capital de trabajo: tierra y consolidado sobre el resultado acumulado
//    (incluye la factibilización gastada, como la planilla AUDP); la
//    sanitaria sobre el flujo futuro (el pago del desarrollador ya netea
//    las inversiones — criterio del simulador para los modos sanitarios).
//
// Fuentes: primeras_etapas_audp / primeras_etapas_sanAudp (simulador,
// modo Solo AUDP y Sanitaria AUDP) y el flujo semestral de /integracion.

export const YEARS: number[] = [];
for (let y = 2026; y <= 2045; y++) YEARS.push(y);
const NY = YEARS.length;
const iy = (y: number) => y - 2026;

const serie = (pairs: Record<number, number>) => {
  const a = new Array(NY).fill(0);
  for (const [y, v] of Object.entries(pairs)) a[iy(Number(y))] += v;
  return a;
};
const suma = (a: number[]) => a.reduce((x, y) => x + y, 0);
const addv = (...as: number[][]) => {
  const r = new Array(NY).fill(0);
  for (const a of as) for (let i = 0; i < NY; i++) r[i] += a[i];
  return r;
};
export const acum = (a: number[]) => {
  let s = 0;
  return a.map((v) => (s += v));
};

// ── semestral anualizada (manda 2030–2034; equipamiento sigue su serie) ──
const SEM = {
  ingresos: serie({ 2030: 30000, 2031: 306201, 2032: 49738, 2033: 157028, 2034: 62875 }), // incluye COPEC 30.000
  infra: serie({ 2030: -103934, 2031: -97987, 2032: -104820, 2033: -68119 }), // vialidades + plazas + mejoramiento
  mitigaciones: serie({ 2031: -35810, 2032: -23262, 2033: -9132, 2034: -5000 }),
  sanitariaInv: serie({ 2030: -53735, 2031: -35824 }), // etapas 1-2 de la planta, adelantadas
  mantencion: serie({ 2032: -778, 2033: -1556, 2034: -2334 }),
  equipamiento: serie({ 2030: -7700, 2031: -1400, 2032: -2274, 2033: -124, 2034: -124, 2035: -246 }),
};

// ── planilla anual Primeras Etapas AUDP (tierra): totales y forma 2035+ ──
const AN_T = {
  ingresos: serie({ 2029: 173755, 2030: 177230, 2031: 184740, 2032: 184699, 2033: 288727, 2034: 319805, 2035: 289627, 2036: 236969, 2037: 253497, 2038: 258088, 2039: 267514, 2040: 277390, 2041: 119801 }),
  infra: serie({ 2030: -89447, 2031: -80246, 2032: -66157, 2033: -87138, 2034: -80446, 2035: -55352, 2036: -31247, 2037: -22647, 2038: -18036, 2039: -14991, 2040: -12728, 2041: -4855 }),
  mitigaciones: serie({ 2030: -35809, 2031: -23262, 2032: -9131, 2033: -5000, 2034: -14417, 2035: -23664, 2036: -20103, 2037: -14924, 2038: -8731, 2039: -7880, 2040: -8695, 2041: -13459 }),
  mantencion: serie({ 2031: -778, 2032: -1555, 2033: -2333, 2034: -2415, 2035: -3234, 2036: -4170, 2037: -6335, 2038: -7716, 2039: -9495, 2040: -4736 }),
  sanitariaInv: serie({ 2031: -53735, 2032: -19703, 2033: -16121, 2035: -56222, 2036: -83480, 2037: -30666, 2039: -19358, 2040: -15838, 2041: -12905, 2042: -10559 }),
  factibPorGastar: serie({ 2026: -58923, 2027: -34641, 2028: -24350, 2029: -4909, 2030: -2813, 2031: -1139, 2032: -133 }),
  factibGastada: serie({ 2026: -132513 }),
};

// ── planilla anual Primeras Etapas SAN AUDP (sanitaria) ──
const AN_S = {
  ingOp: serie({ 2031: 2590, 2032: 4030, 2033: 7770, 2034: 11354, 2035: 16730, 2036: 23897, 2037: 28516, 2038: 31388, 2039: 34059, 2040: 36730, 2041: 39312, 2042: 41761, 2043: 43887, 2044: 44733, 2045: 44967 }),
  costOp: serie({ 2031: -8961, 2032: -10870, 2033: -14151, 2034: -26003, 2035: -27622, 2036: -29779, 2037: -31169, 2038: -32033, 2039: -32837, 2040: -33641, 2041: -34419, 2042: -35156, 2043: -35796, 2044: -36050, 2045: -36120 }),
  venta: serie({ 2045: 147433 }),
  factibPorGastar: serie({ 2026: -11850, 2027: -9099, 2028: -6336, 2029: -892, 2030: -842, 2031: -827, 2032: -779 }),
  factibGastada: serie({ 2026: -42899 }),
};

export const TIERRA_AUDP = 343000; // AUDP_TIERRA_TOTAL del simulador
const COMISION = 0.02;
export const VAN_RATE = 0.08;
export const VENTA_SANITARIA = 147433;

/** Semestral tal cual hasta 2034 (2035 el equipamiento); residuo 2035+ con la forma anual. */
function fusion(sem: number[], an: number[]): number[] {
  const residuo = suma(an) - suma(sem);
  const base = YEARS.reduce((s, y, i) => s + (y >= 2035 ? an[i] : 0), 0);
  const out = sem.slice();
  if (Math.abs(base) > 1e-9) {
    const k = residuo / base;
    for (let i = 0; i < NY; i++) if (YEARS[i] >= 2035) out[i] += an[i] * k;
  }
  return out;
}

export interface Linea {
  label: string;
  arr: number[];
  total: number;
}
export interface Unidad {
  id: "tierra" | "sanitaria" | "consolidado";
  nombre: string;
  ingresos: Linea[];
  costos: Linea[];
  flujo: number[]; // flujo de caja futuro (sin factib gastada, sin tierra)
  resultado: number[]; // flujo + factib gastada — la base de caja, KT y payback
  resultadoAcum: number[];
  flujoVan: number[]; // resultado económico: flujo futuro ± tierra devengada
  // indicadores
  van: number;
  tir: number | null;
  capitalTrabajo: number;
  payback: number | null;
  flujosPermanentes: number;
  totalIngresos: number;
  totalCostos: number;
  totalResultado: number;
}

function npvAt(flow: number[], rate: number) {
  return flow.reduce((s, v, i) => s + v / Math.pow(1 + rate, i), 0);
}
function tirDe(flow: number[]): number | null {
  if (!flow.some((v) => v < 0) || !flow.some((v) => v > 0)) return null;
  let lo = -0.99, hi = 10.0;
  for (let k = 0; k < 200; k++) {
    const mid = (lo + hi) / 2;
    if (npvAt(flow, mid) > 0) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}
function paybackDe(resAcum: number[]): number | null {
  for (let i = 1; i < NY; i++) if (resAcum[i] >= 0 && resAcum[i - 1] < 0) return YEARS[i];
  return null;
}
/** Año desde el cual el flujo anual no vuelve a ser negativo. */
function permanentesDe(flujo: number[]): number {
  let last = -1;
  flujo.forEach((v, i) => {
    if (v < -0.5) last = i;
  });
  return last >= 0 && last + 1 < NY ? YEARS[last + 1] : YEARS[0];
}

export function computeConsolidado(): { tierra: Unidad; sanitaria: Unidad; consolidado: Unidad } {
  // ── unidad TIERRA ──
  const ingTierra = fusion(SEM.ingresos, AN_T.ingresos);
  const infra = fusion(SEM.infra, AN_T.infra);
  const mitig = fusion(SEM.mitigaciones, AN_T.mitigaciones);
  const mant = fusion(SEM.mantencion, AN_T.mantencion);
  const sanInv = fusion(SEM.sanitariaInv, AN_T.sanitariaInv);
  const comercializacion = ingTierra.map((v) => -COMISION * v);
  const equip = SEM.equipamiento;

  // tierra devengada proporcional a la venta (sin COPEC, que es un terreno aparte)
  const ingSinCopec = ingTierra.slice();
  ingSinCopec[iy(2030)] -= 30000;
  const baseTierra = suma(ingSinCopec);
  const tierraDev = ingSinCopec.map((v) => (-TIERRA_AUDP * v) / baseTierra);

  const tFlujo = addv(ingTierra, infra, mitig, comercializacion, mant, equip, sanInv, AN_T.factibPorGastar);
  const tRes = addv(tFlujo, AN_T.factibGastada);
  const tVanFlow = addv(tFlujo, tierraDev);
  const tResAcum = acum(tRes);

  const tierra: Unidad = {
    id: "tierra",
    nombre: "Venta de Tierra",
    ingresos: [{ label: "Ingresos Venta de Tierra (incl. COPEC)", arr: ingTierra, total: suma(ingTierra) }],
    costos: [
      { label: "Costos Infraestructura", arr: infra, total: suma(infra) },
      { label: "Costos Mitigaciones", arr: mitig, total: suma(mitig) },
      { label: "Comercialización (2%)", arr: comercializacion, total: suma(comercializacion) },
      { label: "Mantención y seguridad", arr: mant, total: suma(mant) },
      { label: "Equipamiento comercial (neto)", arr: equip, total: suma(equip) },
      { label: "Inversiones Sanitarias (asumidas)", arr: sanInv, total: suma(sanInv) },
      { label: "Factibilización AUDP por gastar", arr: AN_T.factibPorGastar, total: suma(AN_T.factibPorGastar) },
      { label: "Factibilización AUDP gastada (al 2026)", arr: AN_T.factibGastada, total: suma(AN_T.factibGastada) },
      { label: "Costo de la Tierra (aporte, devengado)", arr: tierraDev, total: suma(tierraDev) },
    ],
    flujo: tFlujo,
    resultado: tRes,
    resultadoAcum: tResAcum,
    flujoVan: tVanFlow,
    van: npvAt(tVanFlow, VAN_RATE),
    tir: tirDe(tVanFlow),
    capitalTrabajo: Math.abs(Math.min(...tResAcum, 0)),
    payback: paybackDe(tResAcum),
    flujosPermanentes: permanentesDe(tRes),
    totalIngresos: suma(ingTierra),
    totalCostos: suma(addv(infra, mitig, comercializacion, mant, equip, sanInv, AN_T.factibPorGastar, AN_T.factibGastada)),
    totalResultado: suma(tRes),
  };

  // ── unidad SANITARIA ──
  const sInv = sanInv.slice();
  const sPagoDev = sanInv.map((v) => -v);
  const sFlujo = addv(AN_S.ingOp, AN_S.costOp, sInv, sPagoDev, AN_S.venta, AN_S.factibPorGastar);
  const sRes = addv(sFlujo, AN_S.factibGastada);
  const sResAcum = acum(sRes);
  const sFlujoAcum = acum(sFlujo);

  const sanitaria: Unidad = {
    id: "sanitaria",
    nombre: "Sanitaria",
    ingresos: [
      { label: "Ingresos Operacionales", arr: AN_S.ingOp, total: suma(AN_S.ingOp) },
      { label: "Pago Desarrollador (neteo inversiones)", arr: sPagoDev, total: suma(sPagoDev) },
      { label: "Venta Negocio Sanitario (2045)", arr: AN_S.venta, total: suma(AN_S.venta) },
    ],
    costos: [
      { label: "Costos Operacionales", arr: AN_S.costOp, total: suma(AN_S.costOp) },
      { label: "Inversiones Sanitarias", arr: sInv, total: suma(sInv) },
      { label: "Factibilización Sanitaria por gastar", arr: AN_S.factibPorGastar, total: suma(AN_S.factibPorGastar) },
      { label: "Factibilización Sanitaria gastada (al 2026)", arr: AN_S.factibGastada, total: suma(AN_S.factibGastada) },
    ],
    flujo: sFlujo,
    resultado: sRes,
    resultadoAcum: sResAcum,
    flujoVan: sFlujo,
    van: npvAt(sFlujo, VAN_RATE),
    tir: tirDe(sFlujo),
    // criterio simulador para modos sanitarios: el valle del flujo futuro
    capitalTrabajo: Math.abs(Math.min(...sFlujoAcum, 0)),
    payback: paybackDe(sResAcum),
    flujosPermanentes: permanentesDe(sRes),
    totalIngresos: suma(addv(AN_S.ingOp, sPagoDev, AN_S.venta)),
    totalCostos: suma(addv(AN_S.costOp, sInv, AN_S.factibPorGastar, AN_S.factibGastada)),
    totalResultado: suma(sRes),
  };

  // ── CONSOLIDADO ──
  const cFlujo = addv(tFlujo, sFlujo);
  const cRes = addv(tRes, sRes);
  const cResAcum = acum(cRes);
  const cVanFlow = addv(tVanFlow, sFlujo);

  const consolidado: Unidad = {
    id: "consolidado",
    nombre: "Consolidado",
    ingresos: [...tierra.ingresos, ...sanitaria.ingresos],
    costos: [...tierra.costos.filter((c) => !c.label.startsWith("Costo de la Tierra")), ...sanitaria.costos, tierra.costos[tierra.costos.length - 1]],
    flujo: cFlujo,
    resultado: cRes,
    resultadoAcum: cResAcum,
    flujoVan: cVanFlow,
    van: npvAt(cVanFlow, VAN_RATE),
    tir: tirDe(cVanFlow),
    capitalTrabajo: Math.abs(Math.min(...cResAcum, 0)),
    payback: paybackDe(cResAcum),
    flujosPermanentes: permanentesDe(cRes),
    totalIngresos: tierra.totalIngresos + sanitaria.totalIngresos,
    totalCostos: tierra.totalCostos + sanitaria.totalCostos,
    totalResultado: suma(cRes),
  };

  return { tierra, sanitaria, consolidado };
}

/**
 * Paridad con las planillas anuales del simulador: los totales por concepto
 * de la fusión deben calzar con Primeras Etapas AUDP / SAN AUDP. La página
 * los contrasta en vivo — si el modelo se toca y deja de calzar, se delata.
 */
export const PARIDAD_PLANILLAS = {
  ingresosTierra: 3031842, // total planilla AUDP (la fusión suma COPEC dentro)
  infraestructura: -563290,
  mitigaciones: -185075,
  mantencion: -42767,
  inversionesSanitarias: -318587, // etapas 1-6 gatilladas de la planta
  resultadoTierraPlanilla: 1602065, // sin equipamiento comercial (la anual no lo modela)
  resultadoSanitariaPlanilla: 61025,
  equipamientoSemestral: -11868, // única diferencia de total vs las anuales
} as const;
