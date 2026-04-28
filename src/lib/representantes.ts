/**
 * Representantes — gestión de evaluaciones residuales guardadas.
 *
 * Cada familia de producto (edif_4p / ds19 / casa / townhouse) puede tener
 * un único "representante" guardado: la última evaluación residual que el
 * usuario eligió como caso típico de esa familia.
 *
 * Los representantes se guardan en localStorage para que tanto la página
 * `/residual` (Next.js) como el simulador legacy HTML los puedan leer —
 * comparten el mismo origen `modela-simulador.github.io` y por tanto el
 * mismo localStorage.
 *
 * Formato de almacenamiento (versión 1):
 *   localStorage["modela_representantes_v1"] = JSON.stringify({
 *     edif_4p:   { ... } | undefined,
 *     ds19:      { ... } | undefined,
 *     casa:      { ... } | undefined,
 *     townhouse: { ... } | undefined,
 *   })
 */

import type { ResidualInputs, ResidualOutput } from "./residual-types";
import { solveResidual } from "./residual-engine";

export type ProductFamily = "edif_4p" | "ds19" | "casa" | "townhouse";

export const FAMILY_LABELS: Record<ProductFamily, string> = {
  edif_4p: "Edificio 4-6 pisos",
  ds19: "DS19",
  casa: "Casa",
  townhouse: "Townhouse",
};

/**
 * Lista de productIds del simulador residual que mapean a cada familia.
 * Útil para sugerir automáticamente la familia al guardar.
 */
export const FAMILY_FROM_PRODUCT_ID: Record<string, ProductFamily> = {
  // Edificios — todos los deptos quedan en edif_4p como representante de
  // edificación residencial libre (incluyendo 4-6 pisos por norma).
  deptos1: "edif_4p",
  deptos2: "edif_4p",
  deptos3: "edif_4p",
  // DS19
  ds19: "ds19",
  // Casas
  casas1: "casa",
  casas2: "casa",
  casas3: "casa",
  // Townhouses
  th1: "townhouse",
  th2: "townhouse",
  th3: "townhouse",
};

/**
 * Sensibilidades del residual a las 4 variables clave del proyecto.
 * Cada valor representa: cómo cambia la incidencia / land UF/m² ante
 * un shock de +1% en el parámetro k (mantienendo todo lo demás constante).
 *
 * Permite que el Monte Carlo macro aplique correcciones linealizadas a
 * la incidencia sin re-correr el motor residual 10.000 veces:
 *
 *   Δincidencia ≈ Σ_k (∂incidencia/∂k) × Δk
 *
 * Calculadas perturbando ±5% cada parámetro (centered-difference) y
 * promediando los dos lados para mejor robustez en no-linealidades suaves.
 */
export interface ResidualSensitivities {
  // ∂incidencia / ∂(% en cada parámetro)  — unidades: incidencia (no %)
  incidencia: {
    ticket: number;   // ∂i/∂(precio UF/m² × 1.01)
    velocidad: number;
    costo: number;    // costo construcción directo UF/m²
    plazo: number;    // meses de obra
  };
  // ∂landValueUFm2 / ∂(% en cada parámetro)
  landValue: {
    ticket: number;
    velocidad: number;
    costo: number;
    plazo: number;
  };
  // Baselines usados para normalizar shocks en el MC
  baseline: {
    ticket: number;     // priceUFm2 del primer unitModel
    velocidad: number;  // salesVelocity (uds/mes)
    costo: number;      // constructionCostUFm2
    plazo: number;      // constructionMonths
  };
}

export interface Representante {
  family: ProductFamily;
  productId: string; // productId original elegido en /residual
  productName: string;
  lotFid: string;
  lotAreaM2: number;
  // Inputs completos del residual: permiten re-correr el motor con
  // parámetros sensibilizados (Monte Carlo / factor model).
  inputs: ResidualInputs;
  // Output: incidencia, land value, TIR, VAN, etc.
  result: ResidualOutput;
  // Sensibilidades calculadas al guardar (∂incidencia/∂param × shock)
  // Permiten al MC del legacy aplicar shocks linealizados sin re-correr
  // el residual completo en cada iteración.
  sensitivities?: ResidualSensitivities;
  savedAt: string; // ISO timestamp
}

/**
 * Calcula sensibilidades del residual perturbando cada parámetro ±5%
 * (centered-difference). Devuelve las derivadas parciales evaluadas en
 * el punto base. Coste: 8 corridas extras del residual (~1 segundo).
 *
 * El delta usado es 5% — suficientemente grande para no caer en ruido
 * numérico del bisección, suficientemente chico para que la linealización
 * sea válida en escenarios MC típicos (±10–20%).
 */
export function computeSensitivities(
  baseInputs: ResidualInputs,
  baseResult: ResidualOutput
): ResidualSensitivities {
  const DELTA = 0.05;

  // Helper: clona inputs profundamente sin perder los unitModels
  function cloneInputs(inp: ResidualInputs): ResidualInputs {
    return {
      ...inp,
      unitModels: inp.unitModels.map((u) => ({ ...u })),
    };
  }

  // Para cada parámetro: corre el residual con +DELTA y -DELTA, calcula la
  // derivada centered-difference: f'(x) ≈ [f(x+h) - f(x-h)] / (2h)
  function partial(
    perturb: (inp: ResidualInputs, mult: number) => void
  ): { incidencia: number; landValue: number } {
    const inpUp = cloneInputs(baseInputs);
    perturb(inpUp, 1 + DELTA);
    const inpDn = cloneInputs(baseInputs);
    perturb(inpDn, 1 - DELTA);
    const rUp = solveResidual(inpUp);
    const rDn = solveResidual(inpDn);
    return {
      incidencia: (rUp.incidencia - rDn.incidencia) / (2 * DELTA),
      landValue: (rUp.landValueUFm2 - rDn.landValueUFm2) / (2 * DELTA),
    };
  }

  const ticketDeriv = partial((inp, m) => {
    inp.unitModels = inp.unitModels.map((u) => ({ ...u, priceUFm2: u.priceUFm2 * m }));
  });
  const velDeriv = partial((inp, m) => {
    inp.salesVelocity *= m;
  });
  const costoDeriv = partial((inp, m) => {
    inp.constructionCostUFm2 *= m;
  });
  const plazoDeriv = partial((inp, m) => {
    inp.constructionMonths = Math.max(3, Math.round(inp.constructionMonths * m));
  });

  return {
    incidencia: {
      ticket: ticketDeriv.incidencia,
      velocidad: velDeriv.incidencia,
      costo: costoDeriv.incidencia,
      plazo: plazoDeriv.incidencia,
    },
    landValue: {
      ticket: ticketDeriv.landValue,
      velocidad: velDeriv.landValue,
      costo: costoDeriv.landValue,
      plazo: plazoDeriv.landValue,
    },
    baseline: {
      ticket: baseInputs.unitModels[0]?.priceUFm2 ?? 0,
      velocidad: baseInputs.salesVelocity,
      costo: baseInputs.constructionCostUFm2,
      plazo: baseInputs.constructionMonths,
    },
  };
}

const STORAGE_KEY = "modela_representantes_v1";

interface RepresentantesStore {
  edif_4p?: Representante;
  ds19?: Representante;
  casa?: Representante;
  townhouse?: Representante;
}

function readStore(): RepresentantesStore {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch (e) {
    console.warn("[representantes] error parsing localStorage:", e);
    return {};
  }
}

function writeStore(store: RepresentantesStore): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
}

/** Guarda (o reemplaza) el representante de una familia. */
export function saveRepresentante(rep: Representante): void {
  const store = readStore();
  store[rep.family] = rep;
  writeStore(store);
}

/** Borra el representante de una familia. */
export function clearRepresentante(family: ProductFamily): void {
  const store = readStore();
  delete store[family];
  writeStore(store);
}

/** Borra todos los representantes. */
export function clearAllRepresentantes(): void {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(STORAGE_KEY);
}

/** Carga todos los representantes guardados. */
export function loadAllRepresentantes(): RepresentantesStore {
  return readStore();
}

/** Carga el representante de una familia específica (o null). */
export function loadRepresentante(family: ProductFamily): Representante | null {
  return readStore()[family] ?? null;
}

/** Devuelve la lista de familias que tienen representante guardado. */
export function familiesWithRepresentante(): ProductFamily[] {
  const store = readStore();
  return (Object.keys(store) as ProductFamily[]).filter((k) => store[k] != null);
}

/** Sugiere la familia a partir del productId actual del residual. */
export function familyForProductId(productId: string): ProductFamily | null {
  return FAMILY_FROM_PRODUCT_ID[productId] ?? null;
}
