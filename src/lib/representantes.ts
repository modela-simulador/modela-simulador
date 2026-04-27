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
  savedAt: string; // ISO timestamp
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
