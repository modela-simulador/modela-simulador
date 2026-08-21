// Modelo de Integración Vertical — AUDP Batuco + Colina.
//
// Port fiel del modelo del Directorio (gen_pptx.mjs v21.3, jun 2026) que produjo
// `Presentacion_Directorio.pptx`. La diferencia: aquí el flujo se construye por CAPAS
// encendibles, de la base (venta de suelo) hasta la integración vertical completa.
//
// Paridad verificada contra las láminas del deck:
//   · Todas las capas apagadas salvo las del macroloteador → Venta a terceros (slide 6/7)
//   · Todas las capas encendidas                            → Vertical integrado (slide 9/10)
// Ver PARIDAD_PPTX al final del archivo.

// ════════════════════════════════════════════════════════════
// PARÁMETROS DEL MODELO
// ════════════════════════════════════════════════════════════

export const PRECIO: Record<string, number> = {
  DS19: 2200,
  "Edificio 4P": 3250,
  Townhouses: 5200,
  Casas: 5500,
}; // UF/unidad (venta bruta)

interface ProductoBase {
  audp: "Batuco" | "Colina";
  etapa: 1 | 2;
  prod: string;
  u: number; // unidades
  v: number; // velocidad de venta (u/mes)
  land: number; // valor del macrolote (UF)
  constr: number; // meses de construcción
}

const DATA_BASE: ProductoBase[] = [
  { audp: "Batuco", etapa: 1, prod: "DS19", u: 270, v: 8, land: 71280, constr: 17 },
  { audp: "Batuco", etapa: 1, prod: "Edificio 4P", u: 130, v: 3, land: 57037, constr: 15 },
  { audp: "Batuco", etapa: 1, prod: "Townhouses", u: 37, v: 2, land: 19240, constr: 13 },
  { audp: "Batuco", etapa: 2, prod: "DS19", u: 320, v: 8, land: 84480, constr: 17 },
  { audp: "Batuco", etapa: 2, prod: "Edificio 4P", u: 135, v: 3, land: 57152, constr: 15 },
  { audp: "Batuco", etapa: 2, prod: "Townhouses", u: 27, v: 2, land: 14840, constr: 13 },
  { audp: "Colina", etapa: 1, prod: "DS19", u: 298, v: 8, land: 78672, constr: 17 },
  { audp: "Colina", etapa: 1, prod: "Edificio 4P", u: 100, v: 3, land: 40625, constr: 15 },
  { audp: "Colina", etapa: 1, prod: "Casas", u: 52, v: 2.5, land: 31460, constr: 13 },
  { audp: "Colina", etapa: 2, prod: "DS19", u: 247, v: 8, land: 61750, constr: 17 },
  { audp: "Colina", etapa: 2, prod: "Casas", u: 52, v: 2.5, land: 32280, constr: 13 },
];

const DATA = DATA_BASE.map((d) => ({ ...d, precio: PRECIO[d.prod], V: d.u * PRECIO[d.prod] }));

const M_IPV = 6; // meses compra → inicio de preventa
const PV = 0.2; // preventa hasta colocar el 20% de las unidades
const PLUS = 0.02; // plusvalía del suelo (anual)
const COMM = 0.02; // comercialización sobre venta de suelo
const KT_PCT = 0.2; // capital de trabajo = 20% de las ventas brutas
const BANCO = 0.8; // el banco cobra el 80% del precio al escriturar

/** Semestre de venta del lote de 1ª etapa: DS19 arranca en S1'30, el resto medio año después. */
const landE1 = (prod: string) => (prod === "DS19" ? 0 : 6);

const e1 = DATA.filter((d) => d.etapa === 1);
const keyE1 = (a: string, p: string) => e1.find((d) => d.audp === a && d.prod === p)!;
const icE1 = (a: string, p: string) => {
  const c = keyE1(a, p);
  return landE1(p) + M_IPV + (PV * c.u) / c.v;
};

/**
 * Cronograma por producto (en meses desde el inicio del proyecto).
 * Gatillo de 2ª etapa: el terreno se vende cuando la E1 del mismo producto llega al 85%
 * de absorción menos 6 meses, nunca antes del inicio de construcción de la E1.
 */
export const SCHEDULE = DATA.map((d) => {
  const c = keyE1(d.audp, d.prod);
  const landM =
    d.etapa === 1
      ? landE1(d.prod)
      : Math.max(landE1(d.prod) + (0.85 * c.u) / c.v, icE1(d.audp, d.prod));
  const ipv = landM + M_IPV; // inicio de preventa
  const ic = ipv + (PV * d.u) / d.v; // inicio de construcción
  const ie = ic + d.constr; // inicio de escrituración
  const sellout = ipv + d.u / d.v;
  return { ...d, landM, ipv, ic, ie, sellout, entregaEnd: Math.max(sellout, ie + 3) };
});

type Producto = (typeof SCHEDULE)[number];

const firstIE = (a: string, et: number) =>
  Math.min(...SCHEDULE.filter((d) => d.audp === a && d.etapa === et).map((d) => d.ie));

// ════════════════════════════════════════════════════════════
// UTILIDADES DE SERIE SEMESTRAL
// ════════════════════════════════════════════════════════════

/** Horizonte máximo del modelo: 14 semestres (S1'30 – S2'36). */
export const NF = 14;

const z = () => new Array<number>(NF).fill(0);
const fac = (m: number) => Math.pow(1 + PLUS, m / 12); // plusvalía acumulada al mes m
const semOf = (m: number) => Math.floor((m + 1e-6) / 6);

export const SEM = (i: number) => `${i % 2 === 0 ? "S1" : "S2"} '${String(2030 + Math.floor(i / 2)).slice(2)}`;

const addA = (...as: number[][]) => {
  const r = z();
  for (const a of as) for (let i = 0; i < NF; i++) r[i] += a[i];
  return r;
};
const cum = (a: number[]) => {
  let s = 0;
  return a.map((x) => (s += x));
};
const sum = (a: number[]) => a.reduce((x, y) => x + y, 0);

/** Trunca a n semestres concentrando el residuo posterior en la última columna (preserva el total). */
const trunc = (a: number[], n: number) => {
  if (n >= a.length) return a.slice();
  const r = a.slice(0, n);
  r[n - 1] = a.slice(n - 1).reduce((x, y) => x + y, 0);
  return r;
};

// ── constructores de series de costo ──
const at = (pares: Array<[number, number]>) => {
  const a = z();
  for (const [i, v] of pares) if (i < NF) a[i] += v;
  return a;
};
const third = (s: number, t: number) => {
  const a = z();
  for (let k = 0; k < 3; k++) if (s + k >= 0 && s + k < NF) a[s + k] = -t / 3;
  return a;
};
const half = (s: number, t: number) => {
  const a = z();
  for (let k = 0; k < 2; k++) if (s + k >= 0 && s + k < NF) a[s + k] = -t / 2;
  return a;
};
const fromTo = (s0: number, s1: number, v: number) => {
  const a = z();
  for (let i = Math.max(0, s0); i <= s1 && i < NF; i++) a[i] = v;
  return a;
};

// ════════════════════════════════════════════════════════════
// NEGOCIO INMOBILIARIO: cascada de escrituración y capital de trabajo
// ════════════════════════════════════════════════════════════

/** Fracción de unidades vendidas al mes t (preventa desde el IPV, ritmo v/mes). */
const fVend = (p: Producto, t: number) => Math.max(0, Math.min(1, (p.v * (t - p.ipv)) / p.u));

/** Cascada 80/20: nada del margen se libera hasta vender el 80%; todo al 100%. */
const gRel = (f: number) => Math.max(0, Math.min(1, (f - BANCO) / (1 - BANCO)));

/** Monto M liberado por cascada, devengado solo desde el inicio de escrituración. */
function cascadeFlow(p: Producto, M: number) {
  const a = z();
  const sIE = semOf(p.ie);
  let prev = 0;
  for (let s = 0; s < NF; s++) {
    const rel = s < sIE ? 0 : gRel(fVend(p, (s + 1) * 6)) * M;
    a[s] = rel - prev;
    prev = rel;
  }
  if (prev < M - 0.5) a[NF - 1] += M - prev; // residuo post-horizonte a la última columna
  return a;
}

/** Capital de trabajo: −M repartido en campana senoidal sobre los meses de construcción. */
function bellFlow(p: Producto, M: number) {
  const a = z();
  const D = p.constr;
  const w: number[] = [];
  let tot = 0;
  for (let m = 0; m < D; m++) {
    const wm = Math.sin((Math.PI * (m + 0.5)) / D);
    w.push(wm);
    tot += wm;
  }
  for (let m = 0; m < D; m++) {
    const s = semOf(p.ic + m);
    if (s < NF) a[s] += (-M * w[m]) / tot;
  }
  return a;
}

const KT = (p: Producto) => KT_PCT * p.V;

// ════════════════════════════════════════════════════════════
// EQUIPAMIENTO COMERCIAL (subvención de comercio temprano)
// ════════════════════════════════════════════════════════════

const TASA_C = 0.05; // crédito bullet UF + 5%
const C_INI = 1; // inicio de construcción del equipamiento (S2'30)
const C_OP = 4; // entra en operación (S1'32)
const divBull = (V: number) => (0.8 * V * TASA_C) / 2; // dividendo semestral = solo interés del 80%

const ieDS19 = (audp: string) =>
  semOf(SCHEDULE.find((p) => p.audp === audp && p.prod === "DS19" && p.etapa === 1)!.ie);

interface Equipamiento {
  label: string;
  audp: string;
  tipo: "placa" | "mercado";
  V: number;
  arr: number;
}

const COMERCIAL: Equipamiento[] = [
  { label: "Placas Comerciales", audp: "Batuco", tipo: "placa", V: 6336, arr: 118 },
  { label: "Placas Comerciales", audp: "Colina", tipo: "placa", V: 4445, arr: 83 },
  { label: "MUB", audp: "Batuco", tipo: "mercado", V: 20000, arr: 373 },
  { label: "MUC", audp: "Colina", tipo: "mercado", V: 15000, arr: 280 },
];

/** Arriendo (+), dividendo del crédito (−) y pie del 20% (−, en un único semestre). */
function eqParts(e: Equipamiento) {
  const sCr = e.tipo === "placa" ? ieDS19(e.audp) : C_INI;
  const sOp = e.tipo === "placa" ? ieDS19(e.audp) : C_OP;
  return {
    arr: fromTo(sOp, NF - 1, e.arr),
    div: fromTo(sCr, NF - 1, -divBull(e.V)),
    pie: at([[sCr, -0.2 * e.V]]),
  };
}
const eqNeto = (e: Equipamiento) => {
  const p = eqParts(e);
  return addA(p.arr, p.div, p.pie);
};

// ════════════════════════════════════════════════════════════
// COSTOS DE URBANIZACIÓN
// ════════════════════════════════════════════════════════════

const bIE1 = semOf(firstIE("Batuco", 1));
const bIE2 = semOf(firstIE("Batuco", 2));
const cIE1 = semOf(firstIE("Colina", 1));
const cIE2 = semOf(firstIE("Colina", 2));

interface CostLine {
  grp: string;
  label: string;
  arr: number[];
  layer: LayerId;
}

const COST: CostLine[] = [
  // Costos directos — obras de urbanización por AUDP y etapa
  { grp: "Costos directos · Batuco", label: "Vialidades — Etapa 1", arr: third(0, 63900), layer: "urbanizacion" },
  { grp: "Costos directos · Batuco", label: "Plazas — Etapa 1", arr: third(0, 8000), layer: "urbanizacion" },
  { grp: "Costos directos · Batuco", label: "Áreas verdes — Etapa 1", arr: half(bIE1 - 2, 24566), layer: "urbanizacion" },
  { grp: "Costos directos · Batuco", label: "Vialidades — Etapa 2", arr: third(bIE2 - 3, 66000), layer: "urbanizacion" },
  { grp: "Costos directos · Batuco", label: "Áreas verdes — Etapa 2", arr: half(bIE2 - 2, 22855), layer: "urbanizacion" },
  { grp: "Costos directos · Colina", label: "Vialidades — Etapa 1", arr: third(0, 72000), layer: "urbanizacion" },
  { grp: "Costos directos · Colina", label: "Plazas — Etapa 1", arr: third(0, 6000), layer: "urbanizacion" },
  { grp: "Costos directos · Colina", label: "Áreas verdes — Etapa 1", arr: half(cIE1 - 2, 22754), layer: "urbanizacion" },
  { grp: "Costos directos · Colina", label: "Urbanización — Etapa 2", arr: third(cIE2 - 3, 44100), layer: "urbanizacion" },
  { grp: "Costos directos · Colina", label: "Áreas verdes — Etapa 2", arr: half(cIE2 - 2, 39984), layer: "urbanizacion" },
  // Costos comunes del proyecto
  { grp: "Costos comunes · Proyecto", label: "Sanitaria — Etapa 1", arr: at([[1, -53735], [2, -19703], [3, -16121]]), layer: "comunes" },
  { grp: "Costos comunes · Proyecto", label: "Mitigaciones viales", arr: at([[2, -17905], [3, -17905], [4, -11631], [5, -11631], [6, -4566], [7, -4566], [8, -2500], [9, -2500]]), layer: "comunes" },
  { grp: "Costos comunes · Proyecto", label: "Mejoramiento estaciones", arr: at([[1, -4000]]), layer: "comunes" },
  { grp: "Costos comunes · Proyecto", label: "Embellecimiento barrio", arr: at([[2, -700]]), layer: "comunes" },
  { grp: "Costos comunes · Proyecto", label: "Mantenimiento", arr: at([[4, -389], [5, -389], [6, -778], [7, -778], [8, -1167], [9, -1167]]), layer: "comunes" },
];

// ════════════════════════════════════════════════════════════
// CAPAS
// ════════════════════════════════════════════════════════════

export type LayerId =
  | "suelo"
  | "urbanizacion"
  | "comunes"
  | "comercializacion"
  | "equipamiento"
  | "inmobiliario";

export interface LayerDef {
  id: LayerId;
  n: number;
  nombre: string;
  desc: string;
  detalle: string;
  color: string; // tailwind-friendly hex
  base?: boolean; // no se puede apagar
}

/** Las capas en orden narrativo: de la base hasta la integración vertical. */
export const LAYERS: LayerDef[] = [
  {
    id: "suelo",
    n: 1,
    nombre: "Venta de suelo",
    desc: "El ingreso del macroloteador: venta de los macrolotes urbanizados más el terreno COPEC.",
    detalle:
      "11 macrolotes (Batuco y Colina, etapas 1 y 2) + 30.000 UF del lote COPEC en S1'30. El suelo acumula plusvalía del 2% anual.",
    color: "#22c55e",
    base: true,
  },
  {
    id: "urbanizacion",
    n: 2,
    nombre: "Urbanización",
    desc: "Las obras que hacen vendible el suelo: vialidades, plazas y áreas verdes.",
    detalle:
      "Vialidades y plazas de 1ª etapa se adelantan a S1'30; las áreas verdes y toda la 2ª etapa terminan en el inicio de escrituración de su etapa.",
    color: "#f59e0b",
  },
  {
    id: "comunes",
    n: 3,
    nombre: "Costos comunes",
    desc: "Infraestructura y compromisos que no pertenecen a un AUDP en particular.",
    detalle:
      "Sanitaria, mitigaciones viales, mejoramiento de estaciones, embellecimiento del barrio y mantenimiento.",
    color: "#f97316",
  },
  {
    id: "comercializacion",
    n: 4,
    nombre: "Comercialización",
    desc: "El 2% sobre la venta de suelo.",
    detalle: "Se aplica sobre el ingreso de macrolotes y del terreno COPEC. El arriendo comercial no paga comisión.",
    color: "#ef4444",
  },
  {
    id: "equipamiento",
    n: 5,
    nombre: "Equipamiento comercial",
    desc: "La subvención del comercio temprano: placas comerciales y mercados urbanos.",
    detalle:
      "Cuatro activos financiados al 80% con crédito bullet a 12 años (UF+5%). El costo es el dividendo de solo interés más el pie del 20%; el ingreso, el arriendo.",
    color: "#a855f7",
  },
  {
    id: "inmobiliario",
    n: 6,
    nombre: "Integración vertical",
    desc: "Dejamos de vender el lote: aportamos el terreno y tomamos el negocio inmobiliario.",
    detalle:
      "El suelo pasa a cobrarse por cascada de escrituración. Se suman la utilidad inmobiliaria y el capital de trabajo de obra (20% de las ventas brutas, en campana durante la construcción).",
    color: "#2B6CB0",
  },
];

export type LayerState = Record<LayerId, boolean>;

export const LAYERS_BASE: LayerState = {
  suelo: true,
  urbanizacion: false,
  comunes: false,
  comercializacion: false,
  equipamiento: false,
  inmobiliario: false,
};

/** Escenario A del deck: todo el macroloteador, sin integración vertical. */
export const LAYERS_TERCEROS: LayerState = {
  suelo: true,
  urbanizacion: true,
  comunes: true,
  comercializacion: true,
  equipamiento: true,
  inmobiliario: false,
};

/** Escenario B del deck: integración vertical completa. */
export const LAYERS_VERTICAL: LayerState = {
  suelo: true,
  urbanizacion: true,
  comunes: true,
  comercializacion: true,
  equipamiento: true,
  inmobiliario: true,
};

// ════════════════════════════════════════════════════════════
// FLUJO
// ════════════════════════════════════════════════════════════

/**
 * Ingresos por venta de suelo.
 * - Sin integración vertical: ambas etapas se cobran al inicio de construcción,
 *   contra permiso de edificación e inicio de obras.
 * - Con integración vertical: el suelo se recupera por cascada desde la escrituración.
 */
function ingresos(vertical: boolean) {
  const G: Record<string, number[]> = {
    "Batuco-1": z(),
    "Batuco-2": z(),
    "Colina-1": z(),
    "Colina-2": z(),
  };
  for (const p of SCHEDULE) {
    const key = `${p.audp}-${p.etapa}`;
    if (!vertical) {
      const semL = semOf(p.ic);
      if (semL < NF) G[key][semL] += p.land * fac(p.ic);
    } else {
      const f = cascadeFlow(p, p.land * fac(p.ie));
      for (let i = 0; i < NF; i++) G[key][i] += f[i];
    }
  }
  const copec = z();
  copec[0] = 30000;
  return [
    { grp: "Ingresos", label: "Venta terreno COPEC", arr: copec },
    { grp: "Ingresos", label: "Terreno · Batuco — Etapa 1", arr: G["Batuco-1"] },
    { grp: "Ingresos", label: "Terreno · Batuco — Etapa 2", arr: G["Batuco-2"] },
    { grp: "Ingresos", label: "Terreno · Colina — Etapa 1", arr: G["Colina-1"] },
    { grp: "Ingresos", label: "Terreno · Colina — Etapa 2", arr: G["Colina-2"] },
  ];
}

export interface FlowLine {
  grp: string;
  label: string;
  cap: "macro" | "inmob";
  layer: LayerId;
  arr: number[];
}

export interface GroupRow {
  sec: "INGRESOS" | "COSTOS" | "EQUIPAMIENTO COMERCIAL";
  name: string;
  arr: number[];
  total: number;
}

export interface FlujoResult {
  lines: FlowLine[];
  /** Filas consolidadas tal como aparecen en la tabla del deck. */
  groups: GroupRow[];
  /** Flujo neto por semestre, truncado al horizonte visible. */
  net: number[];
  /** Caja acumulada por semestre. */
  caja: number[];
  macroNet: number[];
  inmobNet: number[];
  /** Semestres visibles. */
  nfv: number;
  /** Totales del horizonte completo (no truncados). */
  ingresos: number;
  costos: number;
  neto: number;
  /** Máximo financiamiento requerido (valle de caja) y el semestre en que ocurre. */
  valle: number;
  valleIdx: number;
  /** Valles separados: macroloteador vs capital de trabajo de obra. */
  valleMacro: number;
  valleInmob: number;
  utilidadInmob: number;
}

export interface FlujoConfig {
  layers: LayerState;
  /** Participación en el negocio inmobiliario (1 = 100%, 0.5 = mitad con socio). */
  share: number;
  /** Semestres visibles. Por defecto, 11 sin integración vertical y 14 con ella. */
  horizonte?: number;
}

export function computeFlujo({ layers, share, horizonte }: FlujoConfig): FlujoResult {
  const vertical = layers.inmobiliario;

  // ── líneas del macroloteador ──
  const ING: FlowLine[] = ingresos(vertical).map((r) => ({ ...r, cap: "macro" as const, layer: "suelo" as const }));
  const ingSueloTot = addA(...ING.map((r) => r.arr)); // base de la comercialización

  let eqArr = z();
  let eqDiv = z();
  let eqPie = z();
  for (const e of COMERCIAL) {
    const p = eqParts(e);
    eqArr = addA(eqArr, p.arr);
    eqDiv = addA(eqDiv, p.div);
    eqPie = addA(eqPie, p.pie);
  }
  const equip: FlowLine[] = [
    { grp: "Equipamiento comercial", label: "Arriendo comercial", cap: "macro", layer: "equipamiento", arr: eqArr },
    { grp: "Equipamiento comercial", label: "Dividendo crédito (interés 80%)", cap: "macro", layer: "equipamiento", arr: eqDiv },
    { grp: "Equipamiento comercial", label: "Aporte propio 20% (pie)", cap: "macro", layer: "equipamiento", arr: eqPie },
  ];
  const comerc: FlowLine = {
    grp: "Comercialización",
    label: "Comercialización (2%)",
    cap: "macro",
    layer: "comercializacion",
    arr: ingSueloTot.map((v) => -COMM * v),
  };
  const costMacro: FlowLine[] = COST.map((r) => ({ ...r, cap: "macro" as const }));

  let LINES: FlowLine[] = [...ING, ...costMacro, ...equip, comerc];

  // ── capa inmobiliaria: utilidad, recupero y capital de trabajo, escalados a nuestra participación ──
  if (vertical) {
    let util = z();
    let recup = z();
    let capt = z();
    for (const p of SCHEDULE) {
      util = addA(util, cascadeFlow(p, p.land));
      recup = addA(recup, cascadeFlow(p, KT(p)));
      capt = addA(capt, bellFlow(p, KT(p)));
    }
    util = util.map((v) => v * share);
    recup = recup.map((v) => v * share);
    capt = capt.map((v) => v * share);
    const pct = `${Math.round(share * 100)}%`;
    LINES = LINES.concat([
      { grp: "Negocio inmobiliario", label: `Utilidad inmobiliaria (${pct})`, cap: "inmob", layer: "inmobiliario", arr: util },
      { grp: "Negocio inmobiliario", label: `Recupero capital de trabajo (${pct})`, cap: "inmob", layer: "inmobiliario", arr: recup },
      { grp: "Negocio inmobiliario", label: `Capital de trabajo (${pct})`, cap: "inmob", layer: "inmobiliario", arr: capt },
    ]);
  }

  // ── filtrar por capas activas ──
  const active = LINES.filter((r) => layers[r.layer]);

  const net = addA(...active.map((r) => r.arr));
  const macroNet = addA(...active.filter((r) => r.cap === "macro").map((r) => r.arr));
  const inmobL = active.filter((r) => r.cap === "inmob");
  const inmobNet = inmobL.length ? addA(...inmobL.map((r) => r.arr)) : z();

  const utilLine = active.find((r) => r.label.startsWith("Utilidad inmobiliaria"));
  const utilidadInmob = utilLine ? sum(utilLine.arr) : 0;

  const on = (l: LayerId) => layers[l];
  const ingresosTot =
    sum(ingSueloTot) + (on("equipamiento") ? sum(eqArr) : 0) + utilidadInmob;
  const costosTot =
    (on("urbanizacion") ? sum(addA(...COST.filter((c) => c.layer === "urbanizacion").map((r) => r.arr))) : 0) +
    (on("comunes") ? sum(addA(...COST.filter((c) => c.layer === "comunes").map((r) => r.arr))) : 0) +
    (on("equipamiento") ? sum(eqDiv) + sum(eqPie) : 0) +
    (on("comercializacion") ? sum(comerc.arr) : 0);

  // ── horizonte visible: sin integración vertical el proyecto cierra antes ──
  const nfv = horizonte ?? (vertical ? NF : 11);
  const netD = trunc(net, nfv);
  const caja = cum(netD);
  const cajaMacro = cum(trunc(macroNet, nfv));
  const cajaInmob = cum(trunc(inmobNet, nfv));

  let valle = Infinity;
  let valleIdx = 0;
  caja.forEach((v, i) => {
    if (v < valle) {
      valle = v;
      valleIdx = i;
    }
  });

  // ── consolidación por concepto (idéntica a la tabla del deck) ──
  const groups: GroupRow[] = [];
  const find = (sec: GroupRow["sec"], name: string) => {
    let g = groups.find((x) => x.sec === sec && x.name === name);
    if (!g) {
      g = { sec, name, arr: z(), total: 0 };
      groups.push(g);
    }
    return g;
  };
  for (const r of active) {
    if (r.grp === "Equipamiento comercial") continue;
    const l = r.label;
    let sec: GroupRow["sec"];
    let name: string;
    if (/COPEC|Terreno/.test(l)) {
      sec = "INGRESOS";
      name = "Venta de terrenos";
    } else if (/Utilidad inmobiliaria/.test(l)) {
      sec = "INGRESOS";
      name = l;
    } else if (/Vialidades|Urbanización/.test(l)) {
      sec = "COSTOS";
      name = "Vialidades y urbanización";
    } else if (/Plazas|Áreas verdes/.test(l)) {
      sec = "COSTOS";
      name = "Plazas y áreas verdes";
    } else if (/Sanitaria/.test(l)) {
      sec = "COSTOS";
      name = "Sanitaria";
    } else if (/Mitigaciones/.test(l)) {
      sec = "COSTOS";
      name = "Mitigaciones viales";
    } else if (/Mejoramiento|Embellecimiento/.test(l)) {
      sec = "COSTOS";
      name = "Mejoramiento entorno y barrio";
    } else if (/Comercialización/.test(l)) {
      sec = "COSTOS";
      name = "Comercialización";
    } else if (/Mantenimiento/.test(l)) {
      sec = "COSTOS";
      name = "Seguridad y mantenimiento";
    } else if (/Capital de trabajo|Recupero capital/.test(l)) {
      sec = "COSTOS";
      name = "Capital de trabajo";
    } else continue;
    const g = find(sec, name);
    g.arr = addA(g.arr, r.arr);
  }
  if (layers.equipamiento) {
    find("EQUIPAMIENTO COMERCIAL", "Placas Comerciales (neto)").arr = addA(
      ...COMERCIAL.filter((e) => e.tipo === "placa").map(eqNeto),
    );
    for (const e of COMERCIAL.filter((e) => e.tipo === "mercado")) {
      find("EQUIPAMIENTO COMERCIAL", `${e.label} (neto · incl. pie)`).arr = eqNeto(e);
    }
  }
  const secOrder = { INGRESOS: 0, COSTOS: 1, "EQUIPAMIENTO COMERCIAL": 2 } as const;
  groups.sort((a, b) => secOrder[a.sec] - secOrder[b.sec]);
  for (const g of groups) {
    g.arr = trunc(g.arr, nfv);
    g.total = sum(g.arr);
  }

  return {
    lines: active,
    groups,
    net: netD,
    caja,
    macroNet: trunc(macroNet, nfv),
    inmobNet: trunc(inmobNet, nfv),
    nfv,
    ingresos: ingresosTot,
    costos: costosTot,
    neto: sum(net),
    valle: Math.min(0, valle),
    valleIdx,
    valleMacro: Math.min(0, ...cajaMacro),
    valleInmob: Math.min(0, ...cajaInmob),
    utilidadInmob,
  };
}

// ════════════════════════════════════════════════════════════
// PARIDAD CON EL DECK DEL DIRECTORIO
// ════════════════════════════════════════════════════════════

/**
 * Valores de las láminas de `Presentacion_Directorio.pptx` (v21.3, jun 2026).
 * La UI los contrasta contra el cálculo en vivo: si el modelo se toca y deja de
 * cuadrar, el indicador de paridad lo delata en pantalla.
 */
export const PARIDAD_PPTX = {
  terceros: {
    slide: "6 y 7",
    ingresos: 614299,
    costos: -574730,
    neto: 39568,
    valle: -162828,
    valleSem: "S1 '33",
  },
  vertical: {
    slide: "9 y 10",
    ingresos: 903846,
    costos: -575033,
    neto: 328813,
    valle: -523789,
    valleSem: "S1 '32",
    // El deck separa los dos valles: el del macroloteador y el del capital de trabajo de obra.
    valleMacro: -351217,
    valleInmob: -194432,
  },
} as const;

/** Totales de contexto que el deck cita en la lámina de Equity. */
export const CONTEXTO = {
  pxq: DATA.reduce((s, d) => s + d.V, 0), // 4.588.050 UF de ventas brutas
  unidades: DATA.reduce((s, d) => s + d.u, 0),
  suelo: DATA.reduce((s, d) => s + d.land, 0), // 548.816 UF
  capitalTrabajo: KT_PCT * DATA.reduce((s, d) => s + d.V, 0), // 917.610 UF
} as const;
