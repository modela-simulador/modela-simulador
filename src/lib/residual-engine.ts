/**
 * Método Residual Dinámico — Financial Computation Engine
 *
 * Pure functions with no React dependencies.
 * Replicates the logic from "Evaluación C.T. Batuco Edificios 2026.xlsx"
 */

import type {
  ResidualInputs,
  MonthlyCashFlowRow,
  ProfitAndLoss,
  ResidualOutput,
  UnitModel,
} from './residual-types';
import { DEFAULT_INPUTS } from './residual-types';
import { PRODUCTS } from './constants';

// ── Helpers ──────────────────────────────────────────────────

function monthLabel(startYear: number, startMonth: number, offset: number): string {
  const m = (startMonth + offset - 1) % 12 + 1;
  const y = startYear + Math.floor((startMonth + offset - 1) / 12);
  return `${y}-${String(m).padStart(2, '0')}`;
}

// ── NPV ──────────────────────────────────────────────────────

export function computeNPV(flows: number[], monthlyRate: number): number {
  let npv = 0;
  for (let i = 0; i < flows.length; i++) {
    npv += flows[i] / Math.pow(1 + monthlyRate, i);
  }
  return npv;
}

// ── IRR (Newton-Raphson on monthly flows) ────────────────────

export function computeIRR(flows: number[], guess = 0.01, maxIter = 300, tol = 1e-8): number | null {
  const hasPos = flows.some(v => v > 0);
  const hasNeg = flows.some(v => v < 0);
  if (!hasPos || !hasNeg) return null;

  let rate = guess;
  for (let iter = 0; iter < maxIter; iter++) {
    let npv = 0, dnpv = 0;
    for (let i = 0; i < flows.length; i++) {
      const d = Math.pow(1 + rate, i);
      npv += flows[i] / d;
      if (i > 0) dnpv -= i * flows[i] / (d * (1 + rate));
    }
    if (Math.abs(dnpv) < 1e-14) break;
    const newRate = rate - npv / dnpv;
    if (Math.abs(newRate - rate) < tol) return newRate;
    rate = newRate;
    if (rate < -0.99) rate = -0.5;
    if (rate > 10) rate = 5;
  }

  // Fallback: bisection
  let lo = -0.5, hi = 5.0;
  if (computeNPV(flows, lo) * computeNPV(flows, hi) > 0) return null;
  for (let k = 0; k < 200; k++) {
    const mid = (lo + hi) / 2;
    if (computeNPV(flows, mid) > 0) lo = mid; else hi = mid;
    if (Math.abs(hi - lo) < tol) break;
  }
  return (lo + hi) / 2;
}

// ── Build monthly cash flow ──────────────────────────────────

export function buildCashFlow(
  inputs: ResidualInputs,
  landPriceUFm2: number
): MonthlyCashFlowRow[] {
  const {
    lotAreaM2, unitModels, totalUnits,
    totalSupConstruidaM2, totalSupVendibleM2,
    salesVelocity, constructionCostUFm2,
    urbanizationCostUFm2, earthMovementCostUFm2,
    indirectCostsUFMonth,
    postVentaConstructionPct, constructorUtilityPct, contingenciesPct,
    ivaRate,
    escrituracionUFPerUnit, salesCommissionPct, marketingPct, tarifaGestionInmobiliariaPct: adminPct,
    postVentaGavPct, stockMaintenanceUFPerUnit, greenInsuranceUFPerUnit,
    studiesBeforeICPct,
    afrUFPerUnit, vialContributionUFPerUnit, itoUFMonth,
    monthLandPurchase, monthPreSalesStart,
    constructionMonths,
    monthsAfterConstructionToReception, monthsAfterReceptionToEscrituracion,
    piePct, pieMonths, escrituracionCollectionPct,
    landFinancingPct, constructionFinancingPct, interestRateAnnual,
    incomeTaxRate,
    landContributionsUF, landBrokerageUF,
  } = inputs;

  // ── Inicio de construcción dinámico ───────────────────────
  // Si autoConstructionStart = true: inicia cuando se alcanza X% preventas
  // (ej. banco exige 20% para activar crédito construcción).
  // Si false: usa el mes manual (monthConstructionStart).
  const monthConstructionStart = (() => {
    if (!inputs.autoConstructionStart) return inputs.monthConstructionStart;
    const unitsNeeded = totalUnits * inputs.preventasBeforeConstructionPct;
    const monthsToReach = Math.ceil(unitsNeeded / Math.max(1, salesVelocity));
    return monthPreSalesStart + monthsToReach;
  })();

  // Detailed studies & permits (UF/m² construido) — sum of 10 individual items.
  // NOTA: NO incluye "estudiosAntesICUFm2" porque era un duplicado conceptual.
  // El campo `studiesBeforeICPct` maneja el TIMING (qué % se paga antes de IC).
  const studiesDesignUFm2 = inputs.estudioArquitecturaUFm2 + inputs.estudioCalculoUFm2 +
    inputs.estudioMecanicaSuelosUFm2 + inputs.estudioSanitariosUFm2 + inputs.estudioElectricoUFm2 +
    inputs.estudioBasuraUFm2 + inputs.estudioImpactoVialUFm2 + inputs.estudioImpactoAmbientalUFm2 +
    inputs.estudioSenaleticaUFm2 + inputs.estudioOtrosGlobalUFm2;
  const permitsLicensesUFm2 = inputs.permisoObraUFm2 + inputs.gastosRecepcionUFm2;
  const itoUF = itoUFMonth * constructionMonths;

  // Derived dates (pueden ser fraccionales por MC fraccional)
  const monthReception = monthConstructionStart + constructionMonths + monthsAfterConstructionToReception;
  const monthEscrituracion = monthReception + monthsAfterReceptionToEscrituracion;
  // Eventos one-shot snapean al entero más cercano (round) para reflejar cuándo "ocurre" el hito.
  // Esto produce respuesta más granular a cambios en salesVelocity (evita plateaus largas).
  const monthReceptionInt = Math.round(monthReception);
  const monthEscrituracionInt = Math.round(monthEscrituracion);
  const salesMonths = Math.ceil(totalUnits / salesVelocity);
  const monthSalesEnd = monthPreSalesStart + salesMonths;

  // Total project duration (with buffer para backlog spread y stock post-recepción)
  // Backlog cap = 20 un/mes → span = ceil(totalUnits/20) meses después de monthEscrituracion.
  const backlogSpanMonths = Math.ceil(totalUnits / 20);
  const totalMonths = Math.ceil(Math.max(monthEscrituracion + backlogSpanMonths + 6, monthSalesEnd + 12));

  // ── Compute total costs (for percentage-based items) ──
  const totalLandCost = landPriceUFm2 * lotAreaM2;

  // Subterranean parking area: estacs_totales × %subt × area_por_estac (bruto, incluye muros/rampas)
  const supSubterraneoM2 = inputs.subterraneoOn
    ? totalUnits * inputs.subterraneoPct * inputs.subterraneoAreaPerUnit
    : 0;
  // Costo directo BAJO cota 0 — con su propio UF/m² (default 10)
  const subterraneoCost = supSubterraneoM2 * inputs.subterraneoCostUFm2;

  // ── Placas comerciales (locales) ──
  // Si está activo, el m² comercial se suma al costo directo (con su propio UF/m²).
  // Los % de postventa, utilidad e imprevistos se aplican proporcionalmente vía baseConstructionCost.
  // NO se suma a gastos generales (indirectCostsUFMonth).
  const comercioActiveM2 = inputs.comercioOn ? inputs.comercioM2 : 0;
  const comercioDirectCost = comercioActiveM2 * inputs.comercioConstructionCostUFm2;

  // Total m² construidos incluye subterráneo y placas comerciales
  const supConstruidaTotal = totalSupConstruidaM2 + supSubterraneoM2 + comercioActiveM2;

  const directConstructionCost = totalSupConstruidaM2 * constructionCostUFm2 + subterraneoCost + comercioDirectCost;

  // ─── Urbanización & Mov. Tierra: fórmulas condicionales por familia de producto ───
  const product = PRODUCTS.find(p => p.id === inputs.productId);
  const family = product?.family ?? "edificios";

  // Superficie de estacionamientos en superficie (cuando NO hay subterráneo)
  const estacionamientoAreaPerUnit = 25; // m² por estac. superficial
  const supEstacSuperficie = !inputs.subterraneoOn && (family === "edificios" || family === "ds19")
    ? estacionamientoAreaPerUnit * totalUnits
    : 0;
  // Superficie de áreas verdes por depto (sólo aplica para edificios/ds19)
  const areaVerdePorUnit = 24; // m² verde por depto
  const supAreaVerde = (family === "edificios" || family === "ds19")
    ? areaVerdePorUnit * totalUnits
    : 0;

  // Urbanización por familia:
  //   - casas/townhouses: 35% del terreno
  //   - edificios/DS19 sin subt: (24 m² verde + 25 m² estac × 1.15) × N_units
  //   - edificios/DS19 con subt 100%: 24 × N (jardín sobre losa superior = misma urba que verde)
  //   - edificios/DS19 con subt < 100%: area verde aumenta hasta +10% linealmente
  //     (refleja mayor exposición de losa cuando menos estac va al subt)
  const SURFACE_PARKING_OVERHEAD = 1.15; // vialidades/maniobras sobre estac. superficie
  let supUrbanizar: number;
  if (family === "casas" || family === "townhouses") {
    supUrbanizar = lotAreaM2 * 0.30;
  } else if (family === "edificios" || family === "ds19") {
    if (inputs.subterraneoOn) {
      const greenAreaBump = 1 + 0.10 * (1 - inputs.subterraneoPct);
      supUrbanizar = areaVerdePorUnit * greenAreaBump * totalUnits;
    } else {
      supUrbanizar = (areaVerdePorUnit + estacionamientoAreaPerUnit * SURFACE_PARKING_OVERHEAD) * totalUnits;
    }
  } else {
    supUrbanizar = lotAreaM2;
  }
  const totalUrbanizationCost = supUrbanizar * urbanizationCostUFm2;

  // Mov. tierra por familia y modo:
  //   - Con subterráneo: mov. tierra tradicional ANULADO → solo excavación subt = supSubt × 0.5 UF/m²
  //   - Sin subterráneo:
  //     · casas/townhouses: 1.5 UF/m² × (15% vialidades + 35% plataformas) = lot × 0.5 × earthMov
  //     · edificios/DS19: 1.5 UF/m² × (lot - (24 × N verde) - (estacSuperficie / 2))
  let totalEarthMovement: number;
  if (inputs.subterraneoOn) {
    totalEarthMovement = supSubterraneoM2 * inputs.subterraneoExcavationCostUFm2;
  } else {
    let supMovTierra: number;
    if (family === "casas" || family === "townhouses") {
      supMovTierra = lotAreaM2 * (0.15 + 0.35);
    } else if (family === "edificios" || family === "ds19") {
      supMovTierra = Math.max(0, lotAreaM2 - supAreaVerde - (supEstacSuperficie / 2));
    } else {
      supMovTierra = lotAreaM2;
    }
    totalEarthMovement = supMovTierra * earthMovementCostUFm2;
  }
  // Gastos generales: si subt ON, suma N meses extra (subt ocupa tiempo adicional sin mover recepción)
  const subtExtraMonths = inputs.subterraneoOn ? inputs.subterraneoConstructionMonths : 0;
  const totalIndirectCosts = indirectCostsUFMonth * (constructionMonths + subtExtraMonths);

  const baseConstructionCost = directConstructionCost + totalUrbanizationCost + totalEarthMovement;
  const totalPostVentaConst = baseConstructionCost * postVentaConstructionPct;
  const totalConstructorUtility = baseConstructionCost * constructorUtilityPct;
  const totalContingencies = baseConstructionCost * contingenciesPct;

  const totalConstructionCostNeto = directConstructionCost + totalUrbanizationCost +
    totalEarthMovement + totalIndirectCosts + totalPostVentaConst +
    totalConstructorUtility + totalContingencies;

  // Revenue totals — estac. se separa en superficie y subt cuando aplica
  const subtParkRatio = inputs.subterraneoOn ? inputs.subterraneoPct : 0;
  const totalRevenueGross = unitModels.reduce((sum, m) => {
    const vivRev = m.count * m.supVendibleM2 * m.priceUFm2;
    const parkSurfaceRev = m.parkingCount * (1 - subtParkRatio) * m.parkingPriceUF;
    const parkSubtRev = m.parkingCount * subtParkRatio * m.parkingPriceSubtUF;
    const bodRev = m.bodegaCount * m.bodegaPriceUF;
    return sum + vivRev + parkSurfaceRev + parkSubtRev + bodRev;
  }, 0);
  const totalRevenueNet = totalRevenueGross / (1 + ivaRate);
  // IMPORTANTE: revenuePerUnit en NETO para cash flow (coincide con Excel H71 "Total PxQ Neto").
  // Antes estaba en BRUTO causando un bug que inflaba la caja ~16% del revenue.
  const revenuePerUnit = totalRevenueNet / totalUnits;

  // Studies & permits
  const totalStudies = totalSupConstruidaM2 * studiesDesignUFm2;
  const totalPermits = totalSupConstruidaM2 * permitsLicensesUFm2;
  const totalAFR = afrUFPerUnit * totalUnits + vialContributionUFPerUnit * totalUnits;

  // GAV totals (for reference)
  const totalEscrituracion = escrituracionUFPerUnit * totalUnits;
  const totalSalesComm = totalRevenueGross * salesCommissionPct;
  const totalMarketing = totalRevenueGross * marketingPct;
  const totalAdmin = totalRevenueGross * adminPct;
  const totalPostVentaGav = totalRevenueNet * postVentaGavPct;

  // Monthly interest rate
  const monthlyInterestRate = Math.pow(1 + interestRateAnnual, 1/12) - 1;

  // ── Build monthly rows ──
  const rows: MonthlyCashFlowRow[] = [];
  let cumSold = 0, cumDelivered = 0, cumCF = 0, cumCFLev = 0;
  let financingBalance = 0;

  // Track PIE payment schedule: each sale generates PIE payments over pieMonths
  const pieSchedule: { month: number; amount: number }[] = [];
  // Track escrituración schedule: sales pre-reception release at monthEscrituracion,
  // post-reception sales release after escrituracionLagMonths
  const escrituracionSchedule: { month: number; amount: number; units: number }[] = [];

  // ── IVA state (carry-forward siguiendo metodología Excel) ──
  // Cash flow ahora trabaja en NETO (como Excel). IVA es pass-through al SII.
  // IVA débito = revenue_NETO × 19% (IVA cobrado al cliente en c/ venta)
  // IVA crédito = costo_NETO_gravado × 19% (IVA pagado al proveedor, recuperable)
  // Pago SII = débito − crédito (con arrastre mensual)
  let ivaAcumuladoPrev = 0;     // saldo de IVA arrastrado mes a mes
  let ivaDebitoTotal = 0;        // débito acumulado total (cap para pagos)
  let ivaPagadoTotal = 0;        // pagado acumulado total (para detener pago)

  for (let m = 0; m < totalMonths; m++) {
    const row: MonthlyCashFlowRow = {
      month: m,
      date: monthLabel(2024, 1, m),
      utilidadDesarrollador: 0,
      ivaDebitoReceived: 0,
      ivaCreditoPaid: 0,
      unitsSoldThisMonth: 0,
      cumulativeUnitsSold: 0,
      unitsDelivered: 0,
      cumulativeUnitsDelivered: 0,
      revenuePIE: 0,
      revenueEscrituracion: 0,
      totalRevenue: 0,
      landCost: 0,
      landContributions: 0,
      constructionCost: 0,
      urbanizationCost: 0,
      earthMovementCost: 0,
      indirectCosts: 0,
      postVentaConstruction: 0,
      constructorUtility: 0,
      contingencies: 0,
      studiesPermitsCost: 0,
      afrVialCost: 0,
      itoCost: 0,
      totalConstructionCost: 0,
      escrituracionCost: 0,
      salesCommission: 0,
      marketingCost: 0,
      adminCost: 0,
      postVentaGav: 0,
      stockMaintenance: 0,
      greenInsurance: 0,
      totalGAV: 0,
      financingInterest: 0,
      ivaPaid: 0,
      incomeTax: 0,
      totalCost: 0,
      netCashFlow: 0,
      cumulativeCashFlow: 0,
      financingDrawdown: 0,
      financingRepayment: 0,
      netCashFlowLevered: 0,
      cumulativeCashFlowLevered: 0,
    };

    // ── LAND PURCHASE ──
    if (m === monthLandPurchase) {
      row.landCost = totalLandCost;
      row.landContributions = landContributionsUF + landBrokerageUF;
    }

    // ── STUDIES & PERMITS (spread before and during early construction) ──
    const studiesStartMonth = Math.max(0, monthConstructionStart - 6);
    const studiesEndMonth = monthConstructionStart;
    const studiesMonths = studiesEndMonth - studiesStartMonth;
    if (studiesMonths > 0 && m >= studiesStartMonth && m < studiesEndMonth) {
      const studiesTotal = totalStudies + totalPermits;
      if (m < studiesStartMonth + Math.ceil(studiesMonths * studiesBeforeICPct)) {
        // Pre-IC studies
        const preICMonths = Math.ceil(studiesMonths * studiesBeforeICPct);
        row.studiesPermitsCost = studiesTotal * studiesBeforeICPct / preICMonths;
      } else {
        const postICMonths = studiesMonths - Math.ceil(studiesMonths * studiesBeforeICPct);
        if (postICMonths > 0) {
          row.studiesPermitsCost = studiesTotal * (1 - studiesBeforeICPct) / postICMonths;
        }
      }
    }

    // AFR: at permit month
    if (m === inputs.monthPermitObtained) {
      row.afrVialCost = totalAFR;
    }

    // ITO: spread during construction
    if (m >= monthConstructionStart && m < monthConstructionStart + constructionMonths) {
      row.itoCost = itoUF / constructionMonths;
    }

    // ── CONSTRUCTION COSTS (linear distribution) ──
    if (m >= monthConstructionStart && m < monthConstructionStart + constructionMonths) {
      row.constructionCost = directConstructionCost / constructionMonths;
      row.indirectCosts = totalIndirectCosts / constructionMonths;

      const urbMonths = Math.ceil(constructionMonths * 0.5);
      if (m < monthConstructionStart + urbMonths) {
        row.urbanizationCost = totalUrbanizationCost / urbMonths;
        row.earthMovementCost = totalEarthMovement / urbMonths;
      }

      row.postVentaConstruction = totalPostVentaConst / constructionMonths;
      row.constructorUtility = totalConstructorUtility / constructionMonths;
      row.contingencies = totalContingencies / constructionMonths;
    }

    row.totalConstructionCost = row.constructionCost + row.urbanizationCost +
      row.earthMovementCost + row.indirectCosts + row.postVentaConstruction +
      row.constructorUtility + row.contingencies + row.studiesPermitsCost +
      row.afrVialCost + row.itoCost;

    // ── SALES ──
    // Stock en pie: post-recepción la velocidad aumenta por stockAccelerationPct
    //   (unidades terminadas se entregan inmediato → mayor conversión comercial)
    const effectiveVelocity = m >= monthReception
      ? salesVelocity * (1 + inputs.stockAccelerationPct)
      : salesVelocity;
    if (m >= monthPreSalesStart && cumSold < totalUnits) {
      const canSell = Math.min(effectiveVelocity, totalUnits - cumSold);
      row.unitsSoldThisMonth = canSell;
      cumSold += canSell;

      // Schedule PIE payments for these sales
      const piePerUnit = revenuePerUnit * piePct;
      const pieMonthly = piePerUnit / pieMonths;
      for (let pm = 0; pm < pieMonths; pm++) {
        pieSchedule.push({
          month: m + pm + 1, // PIE starts month after sale
          amount: pieMonthly * canSell,
        });
      }

      // Schedule ESCRITURACIÓN for these sales:
      //   - if sale BEFORE monthEscrituracion → accumulates in backlog, releases at monthEscrituracion
      //   - if sale AFTER monthEscrituracion (stock post-recepción) → releases sale_month + lag
      const escriAmount = canSell * revenuePerUnit * escrituracionCollectionPct;
      // Escrituración de preventas: FIFO al ritmo de BACKLOG_MONTHLY_CAP un/mes
      // (el banco procesa ~20 escrituras/mes). Las primeras preventas escrituran
      // en monthEscrituracion; las últimas, algunos meses después.
      // Esto hace que mayor velocidad de venta → unidades "ganan cola" → TIR mejor.
      const BACKLOG_MONTHLY_CAP = 20;
      let escriMonth: number;
      if (m < monthEscrituracion) {
        const saleOrder = cumSold - canSell; // unidades vendidas ANTES de este batch
        const backlogOffset = Math.floor(saleOrder / BACKLOG_MONTHLY_CAP);
        escriMonth = monthEscrituracionInt + backlogOffset;
      } else {
        escriMonth = m + inputs.escrituracionLagMonths;  // stock post-recepción
      }
      escrituracionSchedule.push({
        month: escriMonth,
        amount: escriAmount,
        units: canSell,
      });

      // Green insurance at promesa
      row.greenInsurance = canSell * greenInsuranceUFPerUnit;
    }
    row.cumulativeUnitsSold = cumSold;

    // ── PIE COLLECTION ──
    for (const ps of pieSchedule) {
      if (ps.month === m) {
        row.revenuePIE += ps.amount;
      }
    }

    // ── ESCRITURACIÓN COLLECTION (stock-based) ──
    // Units are delivered/escriturated on the month their escritura is scheduled.
    // Pre-reception backlog releases at monthEscrituracion;
    // stock post-reception flows with each sale + lag.
    for (const es of escrituracionSchedule) {
      if (es.month === m) {
        row.revenueEscrituracion += es.amount;
        row.unitsDelivered += es.units;
        cumDelivered += es.units;
        row.escrituracionCost += es.units * escrituracionUFPerUnit;
      }
    }
    row.cumulativeUnitsDelivered = cumDelivered;

    // ── COMMERCE SALE (lump sum at reception month, neto para IVA débito) ──
    if (inputs.comercioOn && m === monthReceptionInt) {
      const commerceRevenueNet = comercioActiveM2 * inputs.comercioPriceUFm2 / (1 + ivaRate);
      row.revenueEscrituracion += commerceRevenueNet;
    }

    row.totalRevenue = row.revenuePIE + row.revenueEscrituracion;

    // ── GAV (during sales period) ──
    if (m >= monthPreSalesStart && m <= monthSalesEnd + 3) {
      const gavMonths = monthSalesEnd - monthPreSalesStart + 4;
      row.salesCommission = totalSalesComm / gavMonths;
      row.marketingCost = totalMarketing / gavMonths;
      row.adminCost = totalAdmin / gavMonths;
    }

    // Post-venta GAV: 24 months after reception
    if (m >= monthReception && m < monthReception + 24) {
      row.postVentaGav = totalPostVentaGav / 24;
    }

    // Stock maintenance: units between construction end and escrituración
    if (m >= monthConstructionStart + constructionMonths && m < monthEscrituracion) {
      const unsold = totalUnits - cumDelivered;
      row.stockMaintenance = unsold * stockMaintenanceUFPerUnit;
    }

    row.totalGAV = row.escrituracionCost + row.salesCommission + row.marketingCost +
      row.adminCost + row.postVentaGav + row.stockMaintenance + row.greenInsurance;

    // ── FINANCING ──
    if (constructionFinancingPct > 0) {
      // Drawdown: during construction
      if (m >= monthConstructionStart && m < monthConstructionStart + constructionMonths) {
        const drawdown = row.totalConstructionCost * constructionFinancingPct;
        row.financingDrawdown = drawdown;
        financingBalance += drawdown;
      }

      // Interest on outstanding balance
      row.financingInterest = financingBalance * monthlyInterestRate;

      // Repayment: at escrituración
      if (m === monthEscrituracionInt && financingBalance > 0) {
        row.financingRepayment = financingBalance;
        financingBalance = 0;
      }
    }

    // ── IVA (método proporcional con arrastre — sigue Excel Flujo Etapa 59-64) ──
    // Cash flow NETO: débito = 19% sobre ingreso NETO del mes
    // (matemáticamente idéntico a 16% × BRUTO pero el base ahora es NETO)
    const ivaDebito = row.totalRevenue * ivaRate;

    // Crédito: 19% sobre costos NETOS GRAVADOS.
    // Realidad chilena: casi todo servicio contratado a empresas tiene IVA (19%).
    // Solo quedan EXENTOS: compra terreno, contribuciones (impuestos municipales),
    // permisos y aportes al Estado (AFR, IMIV, permiso de obra, gastos recepción),
    // escrituración (servicios notariales), e intereses financieros.
    //
    // TODO el resto paga IVA y genera crédito fiscal.
    const ivaCreditoBase =
      // ─ Construcción (todos los sub-items son servicios de empresas constructoras) ─
      row.constructionCost +      // Edificación directa
      row.urbanizationCost +      // Urbanización
      row.earthMovementCost +     // Movimiento de tierra
      row.indirectCosts +         // Indirectos de obra
      row.postVentaConstruction + // Post-venta constructora
      row.constructorUtility +    // Utilidad constructora (es margen, pero es servicio)
      row.contingencies +         // Imprevistos
      // ─ Estudios y diseños (honorarios de oficinas profesionales = empresas con IVA) ─
      // 94% es estudios profesionales (IVA), 6% permisos municipales (exento)
      row.studiesPermitsCost * 0.94 +
      // ─ Inspección Técnica (ITO) — si la contrata empresa tiene IVA ─
      row.itoCost +
      // ─ GAV: servicios contratados a terceros ─
      row.salesCommission +       // Comisiones ventas (empresa corredora)
      row.marketingCost +         // Marketing (agencia publicidad)
      row.greenInsurance +        // Seguro venta en verde (compañía seguros)
      row.postVentaGav +          // Post-venta inmobiliaria (servicio post-entrega)
      row.stockMaintenance +      // Condominios y mantención stock
      row.adminCost;              // Tarifa gestión inmobiliaria (servicio administrativo)
      // EXENTOS (no se suman aquí):
      //   - row.landCost (compra terreno)
      //   - row.landContributions (contribuciones territoriales)
      //   - row.studiesPermitsCost × 0.06 (permisos municipales)
      //   - row.afrVialCost (AFR, aportes viales al Estado)
      //   - row.escrituracionCost (servicios notariales)
      //   - row.financingInterest (intereses, servicios financieros exentos)
    const ivaCredito = ivaCreditoBase * ivaRate;
    const netoIVA = ivaDebito - ivaCredito;

    // Arrastre: saldo del mes = neto + saldo anterior (el pago del mes previo ya se restó)
    const ivaAcumulado = netoIVA + ivaAcumuladoPrev;
    const ivaPositivo = Math.max(0, ivaAcumulado);

    // Pago IVA sólo después del inicio de escrituración y hasta saldar el total acumulado débito
    ivaDebitoTotal += ivaDebito;
    let ivaPago = 0;
    if (m >= monthEscrituracion && ivaPagadoTotal < ivaDebitoTotal) {
      ivaPago = Math.min(ivaPositivo, ivaDebitoTotal - ivaPagadoTotal);
    }
    ivaPagadoTotal += ivaPago;
    row.ivaPaid = ivaPago;

    // Saldo arrastrado al siguiente mes = acumulado actual − lo pagado este mes
    ivaAcumuladoPrev = ivaAcumulado - ivaPago;

    // ── INCOME TAX: NO en el loop. Se aplica post-loop sobre utilidad NETA ──
    row.incomeTax = 0;

    // ── Guardar IVA débito/crédito del mes (líneas separadas de cash flow) ──
    row.ivaDebitoReceived = ivaDebito;
    row.ivaCreditoPaid = ivaCredito;

    // ── TOTAL COSTOS (NETO, sin IVA) ──
    // ivaPaid, débito y crédito se manejan como líneas separadas en cash flow
    row.totalCost = row.landCost + row.landContributions + row.totalConstructionCost +
      row.totalGAV + row.financingInterest + row.incomeTax;

    // ── CASH FLOW (Excel D67): NETO profit + débito - crédito - pagoSII ──
    // Developer cobra BRUTO del cliente (= NETO + débito) → cash in
    // Developer paga BRUTO al proveedor (= NETO + crédito) → cash out
    // Developer paga residual IVA al SII (débito acumulado - crédito usado)
    row.netCashFlow = row.totalRevenue - row.totalCost
      + row.ivaDebitoReceived     // +cash: IVA cobrado al cliente
      - row.ivaCreditoPaid        // -cash: IVA pagado al proveedor
      - row.ivaPaid;              // -cash: IVA pagado al SII (residual)
    cumCF += row.netCashFlow;
    row.cumulativeCashFlow = cumCF;

    // Levered flow
    row.netCashFlowLevered = row.netCashFlow + row.financingDrawdown - row.financingRepayment;
    cumCFLev += row.netCashFlowLevered;
    row.cumulativeCashFlowLevered = cumCFLev;

    rows.push(row);
  }

  // ── POST-LOOP: Impuesto Renta sobre UTILIDAD NETA ──
  // Método Residual Dinámico clásico: retorno del desarrollador ES la TIR.
  // row.totalRevenue ya es NETO (post-fix), así que suma = totalRevNet directamente.
  const totalRevNet = rows.reduce((s, r) => s + r.totalRevenue, 0);
  const totalConstructionCostNet = rows.reduce((s, r) => s + r.totalConstructionCost, 0);
  const totalGAVNet = rows.reduce((s, r) => s + r.totalGAV, 0);
  const totalLandCostNet = rows.reduce((s, r) => s + r.landCost + r.landContributions, 0);
  const totalFinancingCost = rows.reduce((s, r) => s + r.financingInterest, 0);

  const utilidadAntesImpuesto = totalRevNet - totalConstructionCostNet - totalGAVNet -
    totalLandCostNet - totalFinancingCost;
  const incomeTaxPayable = Math.max(0, utilidadAntesImpuesto * incomeTaxRate);

  // Aplicar impuesto renta al mes de escrituración + 3 (trámite tributario anual)
  // monthEscrituracion puede ser fraccional (por MC fraccional); snap a entero.
  const taxMonth = Math.min(Math.round(monthEscrituracion + 3), rows.length - 1);
  if (taxMonth >= 0 && incomeTaxPayable > 0) {
    rows[taxMonth].incomeTax = incomeTaxPayable;
    rows[taxMonth].totalCost += incomeTaxPayable;
    rows[taxMonth].netCashFlow -= incomeTaxPayable;
    rows[taxMonth].netCashFlowLevered -= incomeTaxPayable;
  }

  // Recalcular acumulados desde el taxMonth hacia adelante
  let cumFix = taxMonth > 0 ? rows[taxMonth - 1].cumulativeCashFlow : 0;
  let cumFixLev = taxMonth > 0 ? rows[taxMonth - 1].cumulativeCashFlowLevered : 0;
  for (let i = taxMonth; i < rows.length; i++) {
    cumFix += rows[i].netCashFlow;
    cumFixLev += rows[i].netCashFlowLevered;
    rows[i].cumulativeCashFlow = cumFix;
    rows[i].cumulativeCashFlowLevered = cumFixLev;
  }

  return rows;
}

// ── Build P&L from cash flow ─────────────────────────────────

export function buildPnL(
  inputs: ResidualInputs,
  cashFlow: MonthlyCashFlowRow[],
  landPriceUFm2: number
): ProfitAndLoss {
  const sum = (fn: (r: MonthlyCashFlowRow) => number) => cashFlow.reduce((s, r) => s + fn(r), 0);
  const iva = inputs.ivaRate;

  // ─── INGRESOS (Bruto = con IVA, Net = sin IVA) ───
  // Ventas inmobiliarias: viviendas (sup vendible × precio × unidades)
  const ventasInmobiliariasGross = inputs.unitModels.reduce(
    (s, m) => s + m.count * m.supVendibleM2 * m.priceUFm2, 0);
  const ventasInmobiliariasNet = ventasInmobiliariasGross / (1 + iva);

  // Ventas estacionamientos — superficie + subt (suma en UNA sola línea del EERR)
  const subtParkRatioPnL = inputs.subterraneoOn ? inputs.subterraneoPct : 0;
  const ventasEstacionamientosGross = inputs.unitModels.reduce(
    (s, m) =>
      s +
      m.parkingCount * (1 - subtParkRatioPnL) * m.parkingPriceUF +
      m.parkingCount * subtParkRatioPnL * m.parkingPriceSubtUF,
    0);
  const ventasEstacionamientosNet = ventasEstacionamientosGross / (1 + iva);

  // Ventas bodegas
  const ventasBodegasGross = inputs.unitModels.reduce(
    (s, m) => s + m.bodegaCount * m.bodegaPriceUF, 0);
  const ventasBodegasNet = ventasBodegasGross / (1 + iva);

  // Ventas locales comerciales
  const ventaLocalesGross = inputs.comercioOn
    ? inputs.comercioM2 * inputs.comercioPriceUFm2
    : 0;
  const ventaLocalesNet = ventaLocalesGross / (1 + iva);

  const totalIngresosNet = ventasInmobiliariasNet + ventasEstacionamientosNet + ventasBodegasNet + ventaLocalesNet;
  const totalIngresosGross = ventasInmobiliariasGross + ventasEstacionamientosGross + ventasBodegasGross + ventaLocalesGross;

  // ─── COSTOS DE EXPLOTACIÓN ───
  const terrenoNet = landPriceUFm2 * inputs.lotAreaM2;
  const terrenoGross = terrenoNet; // terreno no gravado con IVA
  const landContributions = sum(r => r.landContributions);
  const contribucionesCorretajeTerreno = landContributions;
  const interesesTerreno = 0; // usualmente 0 si terreno se paga al contado

  // Edificación Neto = directo + indirectos + post-venta + utilidad constructora + imprevistos
  const constructionDirect = sum(r => r.constructionCost);
  const indirectCostsTotal = sum(r => r.indirectCosts);
  const postVentaConstructionTotal = sum(r => r.postVentaConstruction);
  const constructorUtilityTotal = sum(r => r.constructorUtility);
  const contingenciesTotal = sum(r => r.contingencies);
  const edificacionNet = constructionDirect + indirectCostsTotal + postVentaConstructionTotal +
    constructorUtilityTotal + contingenciesTotal;
  const edificacionGross = edificacionNet * (1 + iva); // edificación gravada

  const menorCostoIVA = 0;

  // Urbanización Neto = urba + mov. tierra (se agrupan en el Excel)
  const urbanizationDirect = sum(r => r.urbanizationCost);
  const earthMovementTotal = sum(r => r.earthMovementCost);
  const urbanizacionNet = urbanizationDirect + earthMovementTotal;
  const urbanizacionGross = urbanizacionNet * (1 + iva);

  const infraestructuraNet = 0;

  const construccionNet = edificacionNet + urbanizacionNet + infraestructuraNet + menorCostoIVA;
  const construccionGross = edificacionGross + urbanizacionGross;

  const afrAportesViales = sum(r => r.afrVialCost);
  const studiesPermitsTotal = sum(r => r.studiesPermitsCost);
  // Aproximación: 94% estudios, 6% licencias (según proporción UF/m² del Excel)
  const estudiosDisenoVariables = studiesPermitsTotal * 0.94;
  const licenciasTramitesVariables = studiesPermitsTotal * 0.06;
  const inspeccionTecnica = sum(r => r.itoCost);
  const interesesConstruccion = sum(r => r.financingInterest);

  const totalCostosExplotacionNet = terrenoNet + contribucionesCorretajeTerreno + interesesTerreno +
    construccionNet + afrAportesViales + estudiosDisenoVariables + licenciasTramitesVariables +
    inspeccionTecnica + interesesConstruccion;
  const totalCostosExplotacionGross = terrenoGross + contribucionesCorretajeTerreno + interesesTerreno +
    construccionGross + afrAportesViales + estudiosDisenoVariables + licenciasTramitesVariables +
    inspeccionTecnica + interesesConstruccion;

  // ─── MARGEN ───
  const margenExplotacion = totalIngresosNet - totalCostosExplotacionNet;

  // ─── GAV (orden Excel) ───
  const servicioEscrituracion = sum(r => r.escrituracionCost);
  const ventasFijasVariables = sum(r => r.salesCommission);
  const ventasFijasVariablesGross = ventasFijasVariables * (1 + iva);
  const seguroVentaVerde = sum(r => r.greenInsurance);
  const seguroVentaVerdeGross = seguroVentaVerde * (1 + iva);
  const marketingFijoVariable = sum(r => r.marketingCost);
  const marketingFijoVariableGross = marketingFijoVariable * (1 + iva);
  const decoracionPiloto = inputs.decoracionPilotoUF;
  const condominiosMantencionStock = sum(r => r.stockMaintenance);
  const postVentaInmobiliaria = sum(r => r.postVentaGav);
  // Contribuciones viviendas durante stock (proporcional a escrituración lag × contribUFPerUnit)
  const contribucionesViviendas = inputs.contribucionesViviendasUFPerUnit * inputs.totalUnits;
  const administracionGeneral = inputs.administracionGeneralFijoUF;
  const tarifaGestionInmobiliaria = sum(r => r.adminCost);

  const totalGAVNet = servicioEscrituracion + ventasFijasVariables + seguroVentaVerde +
    marketingFijoVariable + decoracionPiloto + condominiosMantencionStock +
    postVentaInmobiliaria + contribucionesViviendas + administracionGeneral +
    tarifaGestionInmobiliaria;
  const totalGAVGross = servicioEscrituracion + ventasFijasVariablesGross + seguroVentaVerdeGross +
    marketingFijoVariableGross + decoracionPiloto + condominiosMantencionStock +
    postVentaInmobiliaria + contribucionesViviendas + administracionGeneral +
    tarifaGestionInmobiliaria;

  // ─── RESULTADO ───
  const resultadoExplotacion = margenExplotacion - totalGAVNet;
  // Intereses de construcción ya fueron contados en costos explotación (línea "Intereses de Construcción").
  // "Gastos Fin. Crédito Construcción" queda en 0 para evitar DOBLE CONTEO.
  // Si el proyecto tuviera fees adicionales del crédito (comisiones, seguros), se agregarían aquí.
  const gastosFinCreditoConstruccion = 0;
  const utilidadAntesImpuesto = resultadoExplotacion - gastosFinCreditoConstruccion;
  const impuestoRenta = sum(r => r.incomeTax);
  const pagoIVA = sum(r => r.ivaPaid);
  const utilidadEtapa = utilidadAntesImpuesto - impuestoRenta;
  // Utilidad desarrollador como REFERENCIA (no se descuenta como costo — lo maneja la TIR)
  // Es la utilidad acontecible, que es el residual natural del método
  const utilidadDesarrolladorPnL = utilidadEtapa; // acontecible = utilidad neta real

  // ─── Build response with both new (Excel-match) and old (compat) names ───
  return {
    // NEW: Excel-match
    ventasInmobiliariasNet, ventasInmobiliariasGross,
    ventasEstacionamientosNet, ventasEstacionamientosGross,
    ventasBodegasNet, ventasBodegasGross,
    ventaLocalesNet, ventaLocalesGross,
    totalIngresosNet, totalIngresosGross,
    terrenoNet, terrenoGross, contribucionesCorretajeTerreno, interesesTerreno,
    construccionNet, construccionGross,
    edificacionNet, edificacionGross, menorCostoIVA,
    urbanizacionNet, urbanizacionGross, infraestructuraNet,
    afrAportesViales, estudiosDisenoVariables, licenciasTramitesVariables,
    inspeccionTecnica, interesesConstruccion,
    totalCostosExplotacionNet, totalCostosExplotacionGross,
    margenExplotacion,
    margenExplotacionPct: totalIngresosNet > 0 ? margenExplotacion / totalIngresosNet : 0,
    servicioEscrituracion,
    ventasFijasVariables, ventasFijasVariablesGross,
    seguroVentaVerde, seguroVentaVerdeGross,
    marketingFijoVariable, marketingFijoVariableGross,
    decoracionPiloto, condominiosMantencionStock, postVentaInmobiliaria,
    contribucionesViviendas, administracionGeneral, tarifaGestionInmobiliaria,
    totalGAVNet, totalGAVGross,
    resultadoExplotacion,
    resultadoExplotacionPct: totalIngresosNet > 0 ? resultadoExplotacion / totalIngresosNet : 0,
    gastosFinCreditoConstruccion,
    utilidadDesarrollador: utilidadDesarrolladorPnL,
    utilidadDesarrolladorPct: totalIngresosNet > 0 ? utilidadDesarrolladorPnL / totalIngresosNet : 0,
    utilidadAntesImpuesto,
    utilidadAntesImpuestoPct: totalIngresosNet > 0 ? utilidadAntesImpuesto / totalIngresosNet : 0,
    impuestoRenta, pagoIVA, utilidadEtapa,
    utilidadEtapaPct: totalIngresosNet > 0 ? utilidadEtapa / totalIngresosNet : 0,

    // ALIAS (backwards compatibility)
    totalRevenueGross: totalIngresosGross,
    totalRevenueNet: totalIngresosNet,
    revenueImmobiliaryNet: ventasInmobiliariasNet,
    revenueParkingNet: ventasEstacionamientosNet,
    revenueBodegaNet: ventasBodegasNet,
    landCost: terrenoNet,
    landContributions: contribucionesCorretajeTerreno,
    constructionTotal: constructionDirect,
    urbanizationTotal: urbanizationDirect,
    earthMovementTotal,
    indirectCostsTotal,
    postVentaConstructionTotal,
    constructorUtilityTotal,
    contingenciesTotal,
    studiesPermitsTotal,
    afrVialTotal: afrAportesViales,
    itoTotal: inspeccionTecnica,
    constructionInterest: interesesConstruccion,
    totalCostsExploitation: totalCostosExplotacionNet,
    grossMargin: margenExplotacion,
    grossMarginPct: totalIngresosNet > 0 ? margenExplotacion / totalIngresosNet : 0,
    totalGAV: totalGAVNet,
    gavBreakdown: {
      escrituracion: servicioEscrituracion,
      sales: ventasFijasVariables,
      marketing: marketingFijoVariable,
      admin: tarifaGestionInmobiliaria,
      postVenta: postVentaInmobiliaria,
      stockMaintenance: condominiosMantencionStock,
      greenInsurance: seguroVentaVerde,
    },
    operatingResult: resultadoExplotacion,
    operatingResultPct: totalIngresosNet > 0 ? resultadoExplotacion / totalIngresosNet : 0,
    financingCost: gastosFinCreditoConstruccion,
    profitBeforeTax: utilidadAntesImpuesto,
    incomeTax: impuestoRenta,
    ivaPaid: pagoIVA,
    netProfit: utilidadEtapa,
    netProfitPct: totalIngresosNet > 0 ? utilidadEtapa / totalIngresosNet : 0,
  };
}

// ── Bisection helper: land such that a metric function equals zero ──
// `evalFn(land)` should return positive when land is too LOW (metric above target),
// negative when land is too HIGH (metric below target).
function bisectLand(
  inputs: ResidualInputs,
  evalFn: (land: number) => number | null,
  lo = 0, hi = 80, maxIter = 120, rangeTol = 0.001
): { land: number; iterations: number; converged: boolean } {
  // Bisección por RANGO (no por valor): seguimos hasta que [lo, hi] colapse.
  // Evita devolver valores redondos espurios (ej. 10.000) cuando la TIR en ese
  // punto está "cerca" del target pero el verdadero óptimo es diferente.
  let loVal = lo, hiVal = hi;
  let iterations = 0;
  let mid = (loVal + hiVal) / 2;
  for (let k = 0; k < maxIter; k++) {
    iterations = k + 1;
    mid = (loVal + hiVal) / 2;
    const v = evalFn(mid);
    if (v === null) {
      hiVal = mid;
      continue;
    }
    if (hiVal - loVal < rangeTol) {
      return { land: mid, iterations, converged: true };
    }
    if (v > 0) loVal = mid; else hiVal = mid;
  }
  return { land: mid, iterations, converged: false };
}

// ── Main solver: Método Residual Dinámico clásico (como Excel) ──
// Terreno es la variable; el solver lo ajusta hasta que TIR (activo puro) = target.
// La utilidad acontecible sale como RESULTADO NATURAL — no se fuerza.

export function solveResidual(inputs: ResidualInputs): ResidualOutput {
  const targetMonthly = Math.pow(1 + inputs.targetTIRAnnual, 1/12) - 1;

  // Solver por TIR: busca land tal que TIR unlevered = target
  const byTIR = bisectLand(inputs, (land) => {
    const cf = buildCashFlow(inputs, land);
    const tir = computeIRR(cf.map(r => r.netCashFlow));
    if (tir === null) return null;
    return tir - targetMonthly;
  });

  // Solver por Utilidad (informativo, para diagnóstico)
  const byMargin = bisectLand(inputs, (land) => {
    const cf = buildCashFlow(inputs, land);
    const pnl = buildPnL(inputs, cf, land);
    if (pnl.totalRevenueNet <= 0) return null;
    return (pnl.netProfit / pnl.totalRevenueNet) - inputs.developerMarginPct;
  });

  const finalLand = Math.max(0, byTIR.land);
  const bindingConstraint: 'TIR' | 'Margin' = 'TIR';
  const totalIterations = byTIR.iterations + byMargin.iterations;
  const converged = byTIR.converged;

  // ── Build final output con el land binding ──
  const cashFlow = buildCashFlow(inputs, finalLand);
  const flows = cashFlow.map(r => r.netCashFlow);
  const tirMonthly = computeIRR(flows) ?? 0;
  const tirAnnual = Math.pow(1 + tirMonthly, 12) - 1;
  const pnl = buildPnL(inputs, cashFlow, finalLand);
  const totalLandCost = finalLand * inputs.lotAreaM2;
  const paybackMonth = cashFlow.findIndex(r => r.cumulativeCashFlow > 0);
  const maxCapital = Math.abs(Math.min(...cashFlow.map(r => r.cumulativeCashFlow)));
  const leveredFlows = cashFlow.map(r => r.netCashFlowLevered);
  const tirMonthlyLev = computeIRR(leveredFlows) ?? tirMonthly;
  const tirAnnualLev = Math.pow(1 + tirMonthlyLev, 12) - 1;
  const vanUF = computeNPV(flows, targetMonthly);
  const salesMonths = Math.ceil(inputs.totalUnits / inputs.salesVelocity);

  // Construction cost KPIs
  const supSubterraneoTotal = inputs.subterraneoOn
    ? inputs.totalUnits * inputs.subterraneoPct * inputs.subterraneoAreaPerUnit
    : 0;
  const comercioAreaKPI = inputs.comercioOn ? inputs.comercioM2 : 0;
  const supConstruidaTotal = inputs.totalSupConstruidaM2 + supSubterraneoTotal + comercioAreaKPI;
  const costosConstruccionNetoTotal = pnl.constructionTotal + pnl.urbanizationTotal +
    pnl.earthMovementTotal + pnl.indirectCostsTotal + pnl.postVentaConstructionTotal +
    pnl.constructorUtilityTotal + pnl.contingenciesTotal;
  const costoConstruccionNetoUFm2 = supConstruidaTotal > 0
    ? costosConstruccionNetoTotal / supConstruidaTotal
    : 0;

  return {
    landValueUFm2: finalLand,
    totalLandCostUF: totalLandCost,
    incidencia: pnl.ventasInmobiliariasNet > 0 ? totalLandCost / pnl.ventasInmobiliariasNet : 0,
    tirMonthly,
    tirAnnual,
    tirAnnualLevered: tirAnnualLev,
    vanUF,
    paybackMonth: paybackMonth >= 0 ? paybackMonth : cashFlow.length,
    maxCapitalRequired: maxCapital,
    totalMonths: cashFlow.length,
    salesMonths,
    supConstruidaTotal,
    supSubterraneoTotal,
    costoConstruccionNetoUFm2,
    costoConstruccionDirectoUFm2: inputs.constructionCostUFm2,
    landByTIRUFm2: byTIR.land,
    landByMarginUFm2: byMargin.land,
    bindingConstraint,
    cashFlow,
    pnl,
    converged,
    iterations: totalIterations,
  };
}

// ── Effective efficiency based on PRC status ─────────────────
// Sin PRC nuevo: deptos = 150 viv/ha (norma actual, 4 pisos)
// Con PRC nuevo: deptos = 190 viv/ha (6 pisos, mayor densidad)
// DS19 y otros mantienen su eficiencia base (no afectados por PRC)
export function getEffectiveEfficiency(productId: string, prcOn: boolean): number {
  const product = PRODUCTS.find(p => p.id === productId);
  if (!product) return 0;
  if (product.family === "edificios") {
    return prcOn ? product.efficiency : 150;
  }
  return product.efficiency;
}

// ── Derive default inputs from product + lot area ────────────

export function deriveDefaults(
  productId: string,
  lotAreaM2: number,
  lotFid = '',
  prcOn: boolean = DEFAULT_INPUTS.prcOn
): ResidualInputs {
  const product = PRODUCTS.find(p => p.id === productId);
  if (!product) throw new Error(`Product not found: ${productId}`);

  const lotAreaHa = lotAreaM2 / 10000;
  const effectiveEfficiency = getEffectiveEfficiency(productId, prcOn);
  const totalUnits = Math.min(
    Math.floor(lotAreaHa * effectiveEfficiency),
    product.maxUnits
  );

  // Default sellable surface (m²) per specific product id.
  // Edificios/Deptos: 60 m² (típico Chile medio)
  // Casas: 85 m² · Townhouses: 85 m²
  // El ticket viene del constants.ts; UF/m² se deriva como ticket / m²_vendible.
  const SUP_VENDIBLE_BY_PRODUCT: Record<string, number> = {
    // DS19 (vivienda social)
    ds19: 42,
    // Deptos / Edificios — todos 60 m²
    deptos1: 60,        // 3500 UF → 58.3 UF/m²
    deptos2: 60,        // 4000 UF → 66.7 UF/m²
    deptos3: 60,        // 4500 UF → 75.0 UF/m²
    edificios6p: 60,    // 2600 UF → 43.3 UF/m²
    // Casas — todas 85 m²
    casas1: 85,         // 4900 UF → 57.6 UF/m²
    casas2: 85,         // 5900 UF → 69.4 UF/m²
    casas3: 85,         // 6900 UF → 81.2 UF/m²
    // Townhouses — todos 85 m²
    townhouses1: 85,    // 4700 UF → 55.3 UF/m²
    townhouses2: 85,    // 5500 UF → 64.7 UF/m²
    townhouses3: 85,    // 6500 UF → 76.5 UF/m²
  };

  const commonAreaPct = DEFAULT_INPUTS.commonAreaPct; // 20% áreas comunes → 1.20×
  const supVendible = SUP_VENDIBLE_BY_PRODUCT[productId] ?? 57;
  // priceUFm2 derivado del ticket y m² defaults; user puede ajustarlo libremente después
  const priceM2 = product.priceUF > 0 && supVendible > 0
    ? product.priceUF / supVendible
    : 60;
  const supConstruida = supVendible * (1 + commonAreaPct);

  // Subterráneo: OFF por default para todos los productos.
  // El usuario lo activa manualmente si el proyecto lo requiere.
  const subterraneoOn = false;

  // Parking defaults por familia:
  //   - edificios (deptos): 1 estac/viv × 300 UF
  //   - ds19: 1 estac/viv × 250 UF
  //   - casas / townhouses: sin estacionamiento separado (se incluye en la parcela)
  let parkingPerUnit = 1;
  let parkingPrice = 300;          // superficie
  let parkingPriceSubt = 400;      // subterráneo (más caro: producto techado)
  if (product.family === 'ds19') {
    parkingPrice = 250;
    parkingPriceSubt = 350;
  } else if (product.family === 'casas' || product.family === 'townhouses') {
    parkingPerUnit = 0;
    parkingPrice = 0;
    parkingPriceSubt = 0;
  }

  const unitModel: UnitModel = {
    name: product.name,
    supVendibleM2: supVendible,
    supConstruidaM2: supConstruida,
    count: totalUnits,
    priceUFm2: priceM2,
    parkingCount: totalUnits * parkingPerUnit,
    parkingPriceUF: parkingPrice,
    parkingPriceSubtUF: parkingPriceSubt,
    bodegaCount: 0,
    bodegaPriceUF: 0,
  };

  // Plazo construcción por familia (estándar chileno):
  //   edificios / DS19 / edif 6P: 16 meses
  //   casas / townhouses: 14 meses
  const constructionMonthsByFamily: Record<string, number> = {
    edificios: 16,
    ds19: 16,
    casas: 14,
    townhouses: 14,
  };
  const constructionMonths = constructionMonthsByFamily[product.family] ?? 15;

  return {
    ...DEFAULT_INPUTS,
    lotAreaM2,
    lotFid,
    productId,
    prcOn,
    unitModels: [unitModel],
    totalUnits,
    totalSupConstruidaM2: supConstruida * totalUnits,
    totalSupVendibleM2: supVendible * totalUnits,
    subterraneoOn,
    constructionMonths,
  };
}
