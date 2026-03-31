"use client";

import { PRODUCTS } from "@/lib/constants";
import type { SubdivisionResult } from "@/lib/types";

interface ExportPanelProps {
  subdivision: SubdivisionResult;
  macroloteFid: string;
}

function downloadJSON(data: object, filename: string) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function downloadCSV(rows: string[][], filename: string) {
  const csv = rows.map((r) => r.join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export default function ExportPanel({ subdivision, macroloteFid }: ExportPanelProps) {
  const handleExportGeoJSON = () => {
    const features = subdivision.lots.map((lot, i) => {
      const product = PRODUCTS.find((p) => p.id === lot.product);
      return {
        type: "Feature",
        properties: {
          id: i,
          product: lot.product,
          productName: product?.name || lot.product,
          areaM2: lot.areaM2,
          units: lot.units,
          frontageM: lot.frontageM,
        },
        geometry: lot.geometry,
      };
    });

    const streetsFeatures = subdivision.streets.map((s, i) => ({
      type: "Feature",
      properties: { id: i, type: "street", areaM2: s.areaM2 },
      geometry: s.geometry,
    }));

    const parkFeatures = subdivision.parks.map((p, i) => ({
      type: "Feature",
      properties: { id: i, type: "park", areaM2: p.areaM2 },
      geometry: p.geometry,
    }));

    const geojson = {
      type: "FeatureCollection",
      features: [...features, ...streetsFeatures, ...parkFeatures],
    };

    downloadJSON(geojson, `cabida-macrolote-${macroloteFid}.geojson`);
  };

  const handleExportCSV = () => {
    const header = ["Lote", "Producto", "Area_ha", "Viviendas", "Frente_m"];
    const rows = subdivision.lots.map((lot, i) => {
      const product = PRODUCTS.find((p) => p.id === lot.product);
      return [
        String(i + 1),
        product?.name || lot.product,
        (lot.areaM2 / 10000).toFixed(3),
        String(lot.units),
        lot.frontageM?.toFixed(1) || "0",
      ];
    });

    // Summary rows
    const { metrics } = subdivision;
    rows.push([]);
    rows.push(["RESUMEN", "", "", "", ""]);
    rows.push(["Total Lotes", String(metrics.totalLots), "", "", ""]);
    rows.push(["Total Viviendas", String(metrics.totalUnits), "", "", ""]);
    rows.push(["Eficiencia", `${metrics.efficiencyPct}%`, "", "", ""]);
    rows.push(["Densidad", `${metrics.densityPerHa} viv/ha`, "", "", ""]);
    rows.push(["Calles", `${(metrics.streetAreaM2 / 10000).toFixed(3)} ha`, "", "", ""]);
    rows.push(["Parques", `${(metrics.parkAreaM2 / 10000).toFixed(3)} ha`, "", "", ""]);

    downloadCSV([header, ...rows], `cabida-macrolote-${macroloteFid}.csv`);
  };

  const handleExportState = () => {
    downloadJSON(subdivision, `cabida-state-${macroloteFid}.json`);
  };

  return (
    <div className="flex flex-col gap-2">
      <p className="text-xs text-zinc-400 uppercase tracking-wider font-semibold">Exportar</p>
      <div className="grid grid-cols-1 gap-1.5">
        <button
          onClick={handleExportGeoJSON}
          className="flex items-center gap-2 px-3 py-2 bg-zinc-800/50 hover:bg-zinc-700/50 rounded-lg text-xs text-zinc-200 transition-colors"
        >
          <span className="text-green-400">&#9679;</span>
          GeoJSON (lotes + calles + parques)
        </button>
        <button
          onClick={handleExportCSV}
          className="flex items-center gap-2 px-3 py-2 bg-zinc-800/50 hover:bg-zinc-700/50 rounded-lg text-xs text-zinc-200 transition-colors"
        >
          <span className="text-blue-400">&#9679;</span>
          CSV (tabla de lotes + resumen)
        </button>
        <button
          onClick={handleExportState}
          className="flex items-center gap-2 px-3 py-2 bg-zinc-800/50 hover:bg-zinc-700/50 rounded-lg text-xs text-zinc-200 transition-colors"
        >
          <span className="text-orange-400">&#9679;</span>
          Estado completo (JSON recargable)
        </button>
      </div>
    </div>
  );
}
