// Product definitions from BatucoTerra simulator
export interface Product {
  id: string;
  name: string;
  family: "casas" | "townhouses" | "ds19" | "edificios" | "comercio" | "equipamiento";
  efficiency: number; // units per hectare (0 for non-residential)
  minUnits: number;
  maxUnits: number;
  minLotHa: number;
  priceUF: number; // avg ticket in UF per unit (or UF/m2 for comercio/equipamiento)
  landValueUFm2: number; // land value in UF per m2
  color: string;
}

export const PRODUCTS: Product[] = [
  // Valores sincronizados con simulador inmobiliario (simulador.html)
  // Casas: amarillo
  { id: "casas1", name: "Casas 1", family: "casas", efficiency: 35, minUnits: 45, maxUnits: 90, minLotHa: 1.3, priceUF: 4900, landValueUFm2: 0, color: "#FACC15" },
  { id: "casas2", name: "Casas 2", family: "casas", efficiency: 32, minUnits: 45, maxUnits: 90, minLotHa: 1.4, priceUF: 5900, landValueUFm2: 0, color: "#EAB308" },
  { id: "casas3", name: "Casas 3", family: "casas", efficiency: 30, minUnits: 45, maxUnits: 90, minLotHa: 1.5, priceUF: 6900, landValueUFm2: 0, color: "#CA8A04" },
  // Townhouses: naranjo (intermedio entre amarillo y naranjo oscuro)
  { id: "townhouses1", name: "Townhouses 1", family: "townhouses", efficiency: 55, minUnits: 55, maxUnits: 75, minLotHa: 1.0, priceUF: 4700, landValueUFm2: 0, color: "#FB923C" },
  { id: "townhouses2", name: "Townhouses 2", family: "townhouses", efficiency: 52, minUnits: 55, maxUnits: 75, minLotHa: 1.1, priceUF: 5500, landValueUFm2: 0, color: "#F97316" },
  { id: "townhouses3", name: "Townhouses 3", family: "townhouses", efficiency: 49, minUnits: 55, maxUnits: 75, minLotHa: 1.1, priceUF: 6500, landValueUFm2: 0, color: "#EA580C" },
  // DS19: violeta
  { id: "ds19", name: "DS19", family: "ds19", efficiency: 190, minUnits: 300, maxUnits: 450, minLotHa: 2.1, priceUF: 2200, landValueUFm2: 0, color: "#8B5CF6" },
  // Edificios: naranjo oscuro
  { id: "deptos1", name: "Deptos 1", family: "edificios", efficiency: 190, minUnits: 120, maxUnits: 220, minLotHa: 0.75, priceUF: 3500, landValueUFm2: 0, color: "#C2410C" },
  { id: "deptos2", name: "Deptos 2", family: "edificios", efficiency: 190, minUnits: 120, maxUnits: 220, minLotHa: 0.75, priceUF: 4000, landValueUFm2: 0, color: "#9A3412" },
  { id: "deptos3", name: "Deptos 3", family: "edificios", efficiency: 190, minUnits: 120, maxUnits: 220, minLotHa: 0.75, priceUF: 4500, landValueUFm2: 0, color: "#7C2D12" },
  { id: "edificios6p", name: "Edificios 6P", family: "edificios", efficiency: 190, minUnits: 120, maxUnits: 220, minLotHa: 0.75, priceUF: 2600, landValueUFm2: 0, color: "#431407" },
  // Comercio: rojo
  { id: "comercio", name: "Comercio", family: "comercio", efficiency: 0, minUnits: 0, maxUnits: 0, minLotHa: 0.5, priceUF: 0, landValueUFm2: 3.2, color: "#EF4444" },
  // Equipamiento: azul
  { id: "equipamiento", name: "Equipamiento", family: "equipamiento", efficiency: 0, minUnits: 0, maxUnits: 0, minLotHa: 0.3, priceUF: 0, landValueUFm2: 0, color: "#3B82F6" },
];

export const PRODUCT_FAMILIES = [
  { id: "casas", name: "Casas", color: "#FACC15" },          // amarillo
  { id: "townhouses", name: "Townhouses", color: "#FB923C" }, // naranjo intermedio
  { id: "ds19", name: "DS19", color: "#8B5CF6" },             // violeta
  { id: "edificios", name: "Edificios", color: "#C2410C" },   // naranjo oscuro
  { id: "comercio", name: "Comercio", color: "#EF4444" },     // rojo
  { id: "equipamiento", name: "Equipamiento", color: "#3B82F6" }, // azul
] as const;

export const STREET_WIDTH_M = 12;
export const CHAMFER_M = 3;
export const MINI_PARK_MIN_M2 = 500;
export const MINI_PARK_MAX_M2 = 1000;

// ── District definitions ──────────────────────────────────────
// From BatucoTerra financial simulator (simulador.html)
// Each district has: max total housing, max per family, allowed product families,
// and the list of macrolote FIDs that belong to it.

export interface DistrictDef {
  id: string;
  name: string;
  color: string;
  maxViviendas: number;                              // total max housing units
  familyMax: { unifam: number; ds19: number; depto: number }; // max by family
  haResidencial: number;                              // residential hectares
  allowedFamilies: string[];                          // product family IDs allowed
  fids: string[];                                     // macrolote FIDs in this district
  isIndustrial?: boolean;                             // industrial zone flag
}

export const DISTRICTS: DistrictDef[] = [
  {
    id: "distrito_g",
    name: "Distrito G",
    color: "#FACC15", // yellow
    maxViviendas: 10425,
    familyMax: { unifam: 3224, ds19: 3993, depto: 3208 },
    haResidencial: 148.04,
    allowedFamilies: ["casas", "townhouses", "ds19", "edificios", "comercio", "equipamiento"],
    fids: [
      "1", "2", "3", "4", "5",
      "58", "59", "63", "64", "65", "66", "67", "68",
      "69", "70", "71", "72", "73", "74", "75", "76", "77",
      "78", "79", "80", "81", "82", "83", "84", "85", "86",
      "87", "88", "89", "90", "91",
    ],
  },
  {
    id: "distrito_40",
    name: "Distrito 4.0",
    color: "#EF4444", // red
    maxViviendas: 3475,
    familyMax: { unifam: 0, ds19: 0, depto: 3475 },
    haResidencial: 24.43,
    allowedFamilies: ["edificios", "comercio", "equipamiento"], // only deptos
    fids: ["52", "53", "54", "92", "93", "94", "95", "96", "97", "98", "99", "100"],
  },
  {
    id: "audp_batuco",
    name: "AUDP Batuco",
    color: "#F97316", // orange
    maxViviendas: 2011,
    familyMax: { unifam: 250, ds19: 600, depto: 1161 },
    haResidencial: 16.51,
    allowedFamilies: ["casas", "townhouses", "ds19", "edificios", "comercio", "equipamiento"],
    fids: [
      "131", "132", "133", "134", "135", "136", "137", "138", "139",
      "140", "141", "142", "143", "144", "145", "146", "147", "148",
      "149", "150",
    ],
  },
  {
    id: "ciudad_logistica",
    name: "Ciudad Logística",
    color: "#D946EF", // magenta
    maxViviendas: 0,
    familyMax: { unifam: 0, ds19: 0, depto: 0 },
    haResidencial: 0,
    allowedFamilies: ["comercio", "equipamiento"], // industrial only, no housing
    fids: [
      "55", "56", "57", "101", "102", "103", "106",
      "107", "108", "109", "110", "111", "112", "113", "114",
      "115", "116", "117", "118", "151", "152", "153", "154",
      "155", "156",
    ],
    isIndustrial: true,
  },
  {
    id: "audp_colina",
    name: "AUDP Colina",
    color: "#22D3EE", // cyan
    maxViviendas: 2696,
    familyMax: { unifam: 390, ds19: 600, depto: 1706 },
    haResidencial: 23.47,
    allowedFamilies: ["casas", "townhouses", "ds19", "edificios", "comercio", "equipamiento"],
    fids: [
      "203", "204", "205", "206", "207", "208", "209", "210", "211",
      "212", "213", "214", "215", "216", "217", "218", "219", "220",
      "221", "222", "223", "224", "225", "226", "227", "228", "229", "230",
    ],
  },
];

/** Look up which district a macrolote FID belongs to */
export function getDistrictForFid(fid: string): DistrictDef | null {
  return DISTRICTS.find((d) => d.fids.includes(fid)) ?? null;
}

/** Get district(s) for a set of selected macrolotes */
export function getDistrictsForFids(fids: string[]): DistrictDef[] {
  const seen = new Set<string>();
  const result: DistrictDef[] = [];
  for (const fid of fids) {
    const d = getDistrictForFid(fid);
    if (d && !seen.has(d.id)) {
      seen.add(d.id);
      result.push(d);
    }
  }
  return result;
}

// Mapbox style
export const MAP_CENTER: [number, number] = [-70.8029, -33.2660];
export const MAP_ZOOM = 13.5;

// Layer colors
export const LAYER_COLORS = {
  lotes: "#64748b",
  lotesSelected: "#3B82F6",
  areasVerdes: "#22c55e",
  vialNuevo: "#94a3b8",
  cerco: "#ef4444",
  divCalles: "#f97316",
};
