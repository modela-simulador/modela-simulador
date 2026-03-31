"use client";

import { useState, useEffect, useMemo } from "react";
import { PRODUCTS, PRODUCT_FAMILIES, type DistrictDef } from "@/lib/constants";
import type { ProductAllocation } from "@/lib/types";

interface ProductMixFormProps {
  areaHa: number;
  onGenerate: (allocations: ProductAllocation[]) => void;
  isGenerating: boolean;
  districts?: DistrictDef[];  // active districts for the selected macrolotes
}

export default function ProductMixForm({ areaHa, onGenerate, isGenerating, districts = [] }: ProductMixFormProps) {
  // Determine which families are allowed based on districts
  const allowedFamilies = useMemo(() => {
    if (districts.length === 0) {
      // No district info — allow all
      return PRODUCT_FAMILIES.map((f) => f.id as string);
    }
    // Intersection of allowed families across all selected districts
    const sets = districts.map((d) => new Set(d.allowedFamilies));
    return PRODUCT_FAMILIES.map((f) => f.id as string).filter((fam) =>
      sets.every((s) => s.has(fam))
    );
  }, [districts]);

  // Aggregate max viviendas across selected districts
  const maxViviendas = useMemo(() => {
    if (districts.length === 0) return Infinity;
    return districts.reduce((sum, d) => sum + d.maxViviendas, 0);
  }, [districts]);

  const isIndustrial = useMemo(() => {
    return districts.length > 0 && districts.every((d) => d.isIndustrial);
  }, [districts]);

  const [allocations, setAllocations] = useState<ProductAllocation[]>([
    { familyId: "casas", productId: "casas1", percentage: 20 },
    { familyId: "townhouses", productId: "townhouses1", percentage: 15 },
    { familyId: "ds19", productId: "ds19", percentage: 25 },
    { familyId: "edificios", productId: "edificios6p", percentage: 20 },
    { familyId: "comercio", productId: "comercio", percentage: 10 },
    { familyId: "equipamiento", productId: "equipamiento", percentage: 10 },
  ]);

  // When districts change, zero out disallowed families and redistribute
  useEffect(() => {
    if (districts.length === 0) return;

    setAllocations((prev) => {
      const disallowed = prev.filter((a) => !allowedFamilies.includes(a.familyId));
      const allowed = prev.filter((a) => allowedFamilies.includes(a.familyId));
      const freedPct = disallowed.reduce((s, a) => s + a.percentage, 0);

      if (freedPct === 0) return prev;

      // Zero out disallowed
      const zeroed = disallowed.map((a) => ({ ...a, percentage: 0 }));

      // Redistribute freed percentage proportionally among allowed
      const allowedTotal = allowed.reduce((s, a) => s + a.percentage, 0);
      const redistributed = allowed.map((a) => ({
        ...a,
        percentage: allowedTotal > 0
          ? Math.round((a.percentage / allowedTotal) * (allowedTotal + freedPct) / 5) * 5
          : Math.round(((allowedTotal + freedPct) / allowed.length) / 5) * 5,
      }));

      // Fix rounding to sum to 100
      const newTotal = redistributed.reduce((s, a) => s + a.percentage, 0);
      if (redistributed.length > 0 && newTotal !== 100) {
        redistributed[0].percentage += 100 - newTotal;
      }

      return [...zeroed, ...redistributed].sort(
        (a, b) => PRODUCT_FAMILIES.findIndex((f) => f.id === a.familyId) - PRODUCT_FAMILIES.findIndex((f) => f.id === b.familyId)
      );
    });
  }, [allowedFamilies, districts]);

  // Lot size overrides for comercio/equipamiento (m2)
  const [comercioLotSize, setComercioLotSize] = useState(7500);
  const [equipamientoLotSize, setEquipamientoLotSize] = useState(7500);

  const totalPct = allocations.reduce((s, a) => s + a.percentage, 0);
  const isValid = Math.abs(totalPct - 100) < 1;

  const updatePercentage = (index: number, value: number) => {
    const next = [...allocations];
    next[index] = { ...next[index], percentage: value };
    setAllocations(next);
  };

  const updateProduct = (index: number, productId: string) => {
    const next = [...allocations];
    next[index] = { ...next[index], productId };
    setAllocations(next);
  };

  // Calculate preview metrics
  const preview = allocations.map((alloc) => {
    const product = PRODUCTS.find((p) => p.id === alloc.productId);
    if (!product) return null;
    const allocHa = areaHa * (alloc.percentage / 100) * 0.85;

    if (product.family === "comercio" || product.family === "equipamiento") {
      const lotSizeM2 = product.family === "comercio" ? comercioLotSize : equipamientoLotSize;
      const numLots = Math.max(1, Math.floor((allocHa * 10000) / lotSizeM2));
      const valueUF = product.family === "comercio" ? numLots * lotSizeM2 * product.landValueUFm2 : 0;
      return { product, allocHa, units: 0, numLots, lotSizeM2, valueUF, meetsMin: true, meetsLot: true };
    }

    const units = Math.round(allocHa * product.efficiency);
    const meetsMin = units >= product.minUnits;
    const meetsLot = allocHa >= product.minLotHa;
    const valueUF = units * product.priceUF;
    return { product, allocHa, units, valueUF, meetsMin, meetsLot };
  });

  const handleGenerate = () => {
    // Inject lot sizes into allocations for comercio/equipamiento
    const enriched = allocations.map((alloc) => {
      if (alloc.familyId === "comercio") return { ...alloc, lotSizeM2: comercioLotSize };
      if (alloc.familyId === "equipamiento") return { ...alloc, lotSizeM2: equipamientoLotSize };
      return alloc;
    });
    onGenerate(enriched);
  };

  // Total estimated units across all products
  const estimatedTotalUnits = useMemo(() => {
    return preview.reduce((sum, prev) => {
      if (!prev) return sum;
      return sum + (prev.units || 0);
    }, 0);
  }, [preview]);

  const exceedsMaxViv = maxViviendas < Infinity && estimatedTotalUnits > maxViviendas;

  return (
    <div className="flex flex-col gap-4">
      <h3 className="text-sm font-semibold text-zinc-300 uppercase tracking-wider">
        Mix de Productos
      </h3>

      {/* District info banner */}
      {districts.length > 0 && (
        <div className="bg-zinc-800/70 rounded-lg px-3 py-2.5 border border-zinc-700">
          {districts.map((d) => (
            <div key={d.id} className="flex items-center gap-2 mb-1 last:mb-0">
              <div className="w-3 h-3 rounded-full flex-shrink-0" style={{ backgroundColor: d.color }} />
              <span className="text-xs font-medium text-zinc-200">{d.name}</span>
              {d.isIndustrial ? (
                <span className="ml-auto text-xs text-amber-400 font-mono">Industrial</span>
              ) : (
                <span className="ml-auto text-xs text-zinc-400 font-mono">
                  max {d.maxViviendas.toLocaleString()} viv
                </span>
              )}
            </div>
          ))}
          {!isIndustrial && maxViviendas < Infinity && (
            <div className={`mt-1.5 pt-1.5 border-t border-zinc-700 flex items-center justify-between text-xs ${exceedsMaxViv ? "text-red-400" : "text-zinc-400"}`}>
              <span>Estimado: ~{estimatedTotalUnits.toLocaleString()} viv</span>
              <span>Máx: {maxViviendas.toLocaleString()}</span>
            </div>
          )}
        </div>
      )}

      {allocations.map((alloc, i) => {
        const family = PRODUCT_FAMILIES.find((f) => f.id === alloc.familyId);
        const familyProducts = PRODUCTS.filter((p) => p.family === alloc.familyId);
        const prev = preview[i];
        const isSpecial = alloc.familyId === "comercio" || alloc.familyId === "equipamiento";
        const isDisabled = !allowedFamilies.includes(alloc.familyId);

        if (isDisabled && alloc.percentage === 0) return null; // hide zeroed-out disabled families

        return (
          <div key={alloc.familyId} className={`rounded-lg p-3 ${isDisabled ? "bg-zinc-800/20 opacity-40" : "bg-zinc-800/50"}`}>
            {/* Family header */}
            <div className="flex items-center gap-2 mb-2">
              <div
                className="w-3 h-3 rounded-full"
                style={{ backgroundColor: family?.color }}
              />
              <span className={`text-sm font-medium ${isDisabled ? "text-zinc-500 line-through" : "text-white"}`}>{family?.name}</span>
              {isDisabled && (
                <span className="text-[10px] text-red-400/70 bg-red-400/10 px-1.5 py-0.5 rounded">
                  No permitido
                </span>
              )}
              <span className="ml-auto text-sm font-mono text-zinc-400">
                {alloc.percentage}%
              </span>
            </div>

            {/* Slider */}
            <input
              type="range"
              min={0}
              max={100}
              step={5}
              value={alloc.percentage}
              disabled={isDisabled}
              onChange={(e) => updatePercentage(i, Number(e.target.value))}
              className={`w-full h-1.5 rounded-full appearance-none ${isDisabled ? "cursor-not-allowed" : "cursor-pointer"}`}
              style={{
                background: `linear-gradient(to right, ${isDisabled ? "#52525b" : family?.color} ${alloc.percentage}%, #3f3f46 ${alloc.percentage}%)`,
              }}
            />

            {/* Product selector (for families with variants) */}
            {!isSpecial && familyProducts.length > 1 && (
              <select
                value={alloc.productId}
                onChange={(e) => updateProduct(i, e.target.value)}
                className="mt-2 w-full bg-zinc-700 text-zinc-200 text-xs rounded px-2 py-1.5 border border-zinc-600"
              >
                {familyProducts.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} ({p.efficiency} viv/ha)
                  </option>
                ))}
              </select>
            )}

            {/* Lot size selector for comercio/equipamiento */}
            {isSpecial && alloc.percentage > 0 && (
              <div className="mt-2">
                <div className="flex items-center justify-between text-xs mb-1">
                  <span className="text-zinc-400">Tamaño lote</span>
                  <span className="text-zinc-300 font-mono">
                    {(alloc.familyId === "comercio" ? comercioLotSize : equipamientoLotSize).toLocaleString()} m2
                  </span>
                </div>
                <input
                  type="range"
                  min={2000}
                  max={20000}
                  step={500}
                  value={alloc.familyId === "comercio" ? comercioLotSize : equipamientoLotSize}
                  onChange={(e) => {
                    const val = Number(e.target.value);
                    if (alloc.familyId === "comercio") setComercioLotSize(val);
                    else setEquipamientoLotSize(val);
                  }}
                  className="w-full h-1.5 rounded-full appearance-none cursor-pointer"
                  style={{
                    background: `linear-gradient(to right, ${family?.color} ${((alloc.familyId === "comercio" ? comercioLotSize : equipamientoLotSize) - 2000) / 180}%, #3f3f46 ${((alloc.familyId === "comercio" ? comercioLotSize : equipamientoLotSize) - 2000) / 180}%)`,
                  }}
                />
              </div>
            )}

            {/* Preview metrics */}
            {prev && !isSpecial && (
              <div className="mt-2 flex gap-3 text-xs">
                <span className={prev.meetsMin ? "text-green-400" : "text-red-400"}>
                  ~{prev.units} viv
                </span>
                <span className="text-zinc-500">
                  {prev.allocHa.toFixed(1)} ha
                </span>
                {prev.valueUF > 0 && (
                  <span className="text-amber-400">
                    {(prev.valueUF / 1000).toFixed(0)}k UF
                  </span>
                )}
                {!prev.meetsMin && (
                  <span className="text-red-400">
                    min {prev.product.minUnits}
                  </span>
                )}
              </div>
            )}

            {prev && isSpecial && alloc.percentage > 0 && (
              <div className="mt-2 flex gap-3 text-xs">
                <span className="text-zinc-300">
                  ~{(prev as { numLots?: number }).numLots || 1} lote{((prev as { numLots?: number }).numLots || 1) > 1 ? "s" : ""}
                </span>
                <span className="text-zinc-500">
                  {prev.allocHa.toFixed(1)} ha
                </span>
                {alloc.familyId === "comercio" && (
                  <span className="text-amber-400">
                    3.2 UF/m2
                  </span>
                )}
                {alloc.familyId === "equipamiento" && (
                  <span className="text-zinc-500">
                    0 UF/m2
                  </span>
                )}
              </div>
            )}
          </div>
        );
      })}

      {/* Total indicator */}
      <div className={`text-center text-sm font-medium ${isValid ? "text-green-400" : "text-red-400"}`}>
        Total: {totalPct}% {isValid ? "\u2713" : `(debe ser 100%)`}
      </div>

      {/* Generate button */}
      <button
        onClick={handleGenerate}
        disabled={isGenerating || !isValid}
        className="w-full py-3 px-4 bg-blue-600 hover:bg-blue-500 disabled:bg-zinc-700 disabled:text-zinc-500 text-white font-medium rounded-lg transition-colors"
      >
        {isGenerating ? "Generando cabida..." : "Generar Cabida"}
      </button>
    </div>
  );
}
