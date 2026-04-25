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
import { cannibalizationFactor } from './cannibalization';

// ── Helpers ──────────────────────────────────────────────────

/**
 * IVA: DS19 (DFL-2) está exento. Sus viviendas + estacs + bodegas se venden
 * SIN IVA y el desarrollador no recupera IVA crédito de construcción.
 * Los locales comerciales siempre son gravados, incluso dentro de un proyecto DS19.
 */
function isProductIvaExento(productId: string): boolean {
  const p = PRODUCTS.find(x => x.id === productId);
  return p?.family === 'ds19';
}

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
  const serviuLagForHorizon = inputs.creditoEnlaceOn ? 2 : 0;
  const totalMonths = Math.ceil(Math.max(
    monthEscrituracion + backlogSpanMonths + serviuLagForHorizon + 6,
    monthSalesEnd + 12,
  ));

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
  // DS19 (DFL-2): venta exenta de IVA → el precio ingresado ya es NETO, no se divide.
  const exentoProject = isProductIvaExento(inputs.productId);
  const totalRevenueNet = exentoProject ? totalRevenueGross : totalRevenueGross / (1 + ivaRate);
  // IMPORTANTE: revenuePerUnit en NETO para cash flow (coincide con Excel H71 "Total PxQ Neto").
  const revenuePerUnit = totalRevenueNet / totalUnits;

  // ── Curva S para el costo directo de construcción ──
  // smoothstep(t) = 3t² − 2t³ genera un perfil sigmoide clásico (menos inicio/final, peak mitad).
  const smoothstep = (t: number): number => {
    const c = Math.max(0, Math.min(1, t));
    return 3 * c * c - 2 * c * c * c;
  };
  const anticipoAmount = directConstructionCost * inputs.constructionAdvancePct;
  const mcStart = Math.round(monthConstructionStart);
  let anticipoRemaining = anticipoAmount;
  let retencionAccumulated = 0;

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
      creditoEnlaceDrawdown: 0,
      creditoEnlaceRepayment: 0,
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

    // ── CONSTRUCTION COSTS ──
    // Anticipo al contratista: paga al mes de inicio de obra
    if (m === mcStart) {
      row.constructionCost += anticipoAmount;
    }

    // SoPs mensuales vía curva S sumando 100% del directo (invoice total al contratista).
    // De cada SoP: retención (5%), recuperación del anticipo (15% hasta agotar).
    // Cash pagado al contratista = gross − retención − recuperación.
    // Balanceado: cuando anticipoPct = recuperaciónPct, la caja suma exacto al directo.
    if (m >= mcStart && m < mcStart + constructionMonths) {
      const i = m - mcStart;
      const n = constructionMonths;
      const share = smoothstep((i + 1) / n) - smoothstep(i / n);
      const sopGross = directConstructionCost * share;
      const recovery = Math.min(inputs.anticipoRecoveryFromSoPPct * sopGross, anticipoRemaining);
      anticipoRemaining -= recovery;
      const retencion = inputs.constructionRetencionPct * sopGross;
      retencionAccumulated += retencion;
      const paidToContractor = sopGross - recovery - retencion;
      row.constructionCost += paidToContractor;

      // Resto de costos (indirectos, urba, mov tierra, postventa, utilidad, imprevistos) siguen lineal
      row.indirectCosts = totalIndirectCosts / constructionMonths;
      const urbMonths = Math.ceil(constructionMonths * 0.5);
      if (m < mcStart + urbMonths) {
        row.urbanizationCost = totalUrbanizationCost / urbMonths;
        row.earthMovementCost = totalEarthMovement / urbMonths;
      }
      row.postVentaConstruction = totalPostVentaConst / constructionMonths;
      row.constructorUtility = totalConstructorUtility / constructionMonths;
      row.contingencies = totalContingencies / constructionMonths;
    }

    // Liberación de retención al mes de recepción municipal
    if (m === monthReceptionInt && retencionAccumulated > 0) {
      row.constructionCost += retencionAccumulated;
      retencionAccumulated = 0;
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

      // Determinar el mes de escrituración ANTES de programar el PIE,
      // porque el PIE se reparte entre mes de venta y escrituración.
      const BACKLOG_MONTHLY_CAP = 20;
      const serviuLag = inputs.creditoEnlaceOn ? 2 : 0;
      const isStockPostRecep = m >= monthReception;
      let escriMonth: number;
      if (isStockPostRecep) {
        // Stock post-recepción: venta con mutuo inmediato, lag bancario
        escriMonth = m + inputs.escrituracionLagMonths + serviuLag;
      } else {
        // Preventa: backlog FIFO al ritmo de BACKLOG_MONTHLY_CAP un/mes
        const saleOrder = cumSold - canSell;
        const backlogOffset = Math.floor(saleOrder / BACKLOG_MONTHLY_CAP);
        escriMonth = monthEscrituracionInt + backlogOffset + serviuLag;
      }

      // ── PIE y ESCRITURACIÓN ──
      // Stock post-recepción: el banco aprueba mutuo inmediato → 100% al escriturar
      // (no hay cuotas de PIE porque el edificio está recibido).
      // Preventa: PIE repartido en cuotas desde mes posterior a promesa hasta escrituración,
      // luego 85% restante al escriturar. Ventas tempranas = cuotas más pequeñas (más meses).
      if (isStockPostRecep) {
        escrituracionSchedule.push({
          month: escriMonth,
          amount: canSell * revenuePerUnit,  // 100% neto en un solo pago
          units: canSell,
        });
      } else {
        // PIE distribuido entre m+1 y escriMonth-1 (ambos inclusive)
        const piePerUnit = revenuePerUnit * piePct;
        const nCuotas = Math.max(1, escriMonth - m - 1);
        const pieMonthly = piePerUnit / nCuotas;
        for (let pm = 0; pm < nCuotas; pm++) {
          pieSchedule.push({
            month: m + pm + 1,
            amount: pieMonthly * canSell,
          });
        }
        // Escrituración: 85% restante
        const escriAmount = canSell * revenuePerUnit * escrituracionCollectionPct;
        escrituracionSchedule.push({
          month: escriMonth,
          amount: escriAmount,
          units: canSell,
        });
      }

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

    // Revenue de vivienda (pre-commerce) para track de IVA débito
    const housingRevenueThisMonth = row.revenuePIE + row.revenueEscrituracion;

    // ── COMMERCE SALE (lump sum at reception month, neto para IVA débito) ──
    // Los locales comerciales SIEMPRE son gravados, aunque el resto del proyecto sea DS19 exento.
    let commerceRevenueThisMonth = 0;
    if (inputs.comercioOn && m === monthReceptionInt) {
      commerceRevenueThisMonth = comercioActiveM2 * inputs.comercioPriceUFm2 / (1 + ivaRate);
      row.revenueEscrituracion += commerceRevenueThisMonth;
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
    // DS19 (exento DFL-2): housing no paga IVA; comercio sí (siempre gravado).
    // Proyecto normal: todo el revenue es gravado.
    const ivaDebito = exentoProject
      ? commerceRevenueThisMonth * ivaRate   // solo comercio
      : row.totalRevenue * ivaRate;

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
      row.constructorUtility +    // Utilidad constructora
      row.contingencies +         // Imprevistos
      // ─ Estudios profesionales 94% (6% permisos municipales exentos) ─
      row.studiesPermitsCost * 0.94 +
      row.itoCost +
      row.salesCommission +
      row.marketingCost +
      row.greenInsurance +
      row.postVentaGav +
      row.stockMaintenance +
      // Tarifa gestión: solo 20% son servicios externos gravados
      row.adminCost * 0.20;
      // EXENTOS (no se suman aquí):
      //   - row.landCost (compra terreno)
      //   - row.landContributions (contribuciones territoriales)
      //   - row.studiesPermitsCost × 0.06 (permisos municipales)
      //   - row.afrVialCost (AFR, aportes viales al Estado)
      //   - row.escrituracionCost (servicios notariales)
      //   - row.financingInterest (intereses, servicios financieros exentos)
    // IVA proveedores (desembolso real del desarrollador, siempre):
    // el contratista factura NETO + 19% IVA → el desarrollador paga BRUTO.
    const ivaPaidToSuppliers = ivaCreditoBase * ivaRate;
    // Recuperación vía SII:
    //  - Gravado: se descarga contra débito ventas → pass-through perfecto.
    //  - Exento (DS19): no hay débito para descontar → IVA queda como costo.
    const ivaCreditoRecoverable = exentoProject ? 0 : ivaPaidToSuppliers;
    const netoIVA = ivaDebito - ivaCreditoRecoverable;

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
    // ivaCreditoPaid: IVA desembolsado al proveedor (SIEMPRE, incluso para exentos).
    // Para gravados se recupera via débito; para exentos queda absorbido como costo.
    row.ivaCreditoPaid = ivaPaidToSuppliers;

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

  // Para proyectos EXENTO (DS19): el IVA absorbido a proveedores se capitaliza
  // como parte del costo (tratamiento tributario chileno para DFL-2). La base
  // tributaria es utilidad sobre costo BRUTO, no NETO.
  const totalIvaAbsorbido = exentoProject
    ? rows.reduce((s, r) => s + r.ivaCreditoPaid - r.ivaDebitoReceived, 0)
    : 0;
  const utilidadAntesImpuesto = totalRevNet - totalConstructionCostNet - totalGAVNet -
    totalLandCostNet - totalFinancingCost - totalIvaAbsorbido;
  const incomeTaxPayable = Math.max(0, utilidadAntesImpuesto * incomeTaxRate);

  // ── CRÉDITO DE ENLACE (DS19) ─────────────────────────────
  // Subsidio estatal: desembolsos durante obra (hasta cap total_viv × UF/viv),
  // repagado proporcional a escrituraciones post-recepción. Sin interés.
  // Mejora la TIR al reducir capital negativo acumulado en la fase de obra.
  if (inputs.creditoEnlaceOn && inputs.creditoEnlaceUFPerUnit > 0) {
    const totalCredito = inputs.creditoEnlaceUFPerUnit * totalUnits;

    // Pase 1: desembolsos del Crédito Enlace coinciden con cada pago de obra
    // (incluido el anticipo al contratista en el mes de inicio). En la práctica
    // DS19, el banco/gobierno deposita el enlace al desarrollador en el mismo
    // momento que éste debe pagar al contratista — así evita descapitalizar.
    let drawn = 0;
    for (let m = 0; m < rows.length; m++) {
      if (drawn >= totalCredito) break;
      const row = rows[m];
      const cost =
        row.constructionCost + row.urbanizationCost + row.earthMovementCost +
        row.indirectCosts + row.postVentaConstruction + row.constructorUtility + row.contingencies;
      if (cost <= 0) continue;
      const drawdown = Math.min(cost, totalCredito - drawn);
      row.creditoEnlaceDrawdown = drawdown;
      drawn += drawdown;
    }

    // Pase 2: repagos proporcional a escrituración post-recepción
    const totalEscriPost = rows
      .slice(monthReceptionInt)
      .reduce((s, r) => s + r.revenueEscrituracion, 0);
    let repaid = 0;
    if (totalEscriPost > 0 && drawn > 0) {
      for (let i = monthReceptionInt; i < rows.length; i++) {
        const row = rows[i];
        if (row.revenueEscrituracion <= 0) continue;
        const share = row.revenueEscrituracion / totalEscriPost;
        const repayment = Math.min(share * drawn, drawn - repaid);
        row.creditoEnlaceRepayment = repayment;
        repaid += repayment;
      }
      // Residual por redondeo → al último mes de escrituración
      if (drawn - repaid > 0.01 && rows.length > 0) {
        rows[rows.length - 1].creditoEnlaceRepayment += drawn - repaid;
      }
    }

    // Pase 3: aplicar deltas al netCashFlow (cash in durante obra, cash out al repagar)
    for (const row of rows) {
      const delta = row.creditoEnlaceDrawdown - row.creditoEnlaceRepayment;
      row.netCashFlow += delta;
      row.netCashFlowLevered += delta;
    }
  }

  // Aplicar impuesto renta al mes de escrituración + 3 (trámite tributario anual)
  // monthEscrituracion puede ser fraccional (por MC fraccional); snap a entero.
  const taxMonth = Math.min(Math.round(monthEscrituracion + 3), rows.length - 1);
  if (taxMonth >= 0 && incomeTaxPayable > 0) {
    rows[taxMonth].incomeTax = incomeTaxPayable;
    rows[taxMonth].totalCost += incomeTaxPayable;
    rows[taxMonth].netCashFlow -= incomeTaxPayable;
    rows[taxMonth].netCashFlowLevered -= incomeTaxPayable;
  }

  // Recalcular acumulados desde el principio (crédito enlace afectó toda la serie)
  let cumFix = 0;
  let cumFixLev = 0;
  for (let i = 0; i < rows.length; i++) {
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
  const exento = isProductIvaExento(inputs.productId);

  // ─── INGRESOS (Bruto = con IVA, Net = sin IVA) ───
  // DS19 (DFL-2) es exento: el precio ingresado es NETO y coincide con el BRUTO (no hay IVA al cliente).
  const ventasInmobiliariasGross = inputs.unitModels.reduce(
    (s, m) => s + m.count * m.supVendibleM2 * m.priceUFm2, 0);
  const ventasInmobiliariasNet = exento ? ventasInmobiliariasGross : ventasInmobiliariasGross / (1 + iva);

  // Ventas estacionamientos — superficie + subt (suma en UNA sola línea del EERR)
  const subtParkRatioPnL = inputs.subterraneoOn ? inputs.subterraneoPct : 0;
  const ventasEstacionamientosGross = inputs.unitModels.reduce(
    (s, m) =>
      s +
      m.parkingCount * (1 - subtParkRatioPnL) * m.parkingPriceUF +
      m.parkingCount * subtParkRatioPnL * m.parkingPriceSubtUF,
    0);
  const ventasEstacionamientosNet = exento ? ventasEstacionamientosGross : ventasEstacionamientosGross / (1 + iva);

  // Ventas bodegas — accesorias a vivienda, siguen el mismo régimen IVA que la vivienda principal
  const ventasBodegasGross = inputs.unitModels.reduce(
    (s, m) => s + m.bodegaCount * m.bodegaPriceUF, 0);
  const ventasBodegasNet = exento ? ventasBodegasGross : ventasBodegasGross / (1 + iva);

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
  // Para proyectos EXENTO (DS19): la utilidad refleja el IVA absorbido como costo
  // embebido en los items gravados (usa BRUTO en vez de NETO para esos items).
  // Metodológicamente equivalente a decir: el 19% se aplica al final y queda en costo.
  const margenExplotacion = exento
    ? totalIngresosNet - totalCostosExplotacionGross
    : totalIngresosNet - totalCostosExplotacionNet;

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
  // Para exento: también usamos GAV BRUTO (IVA sobre servicios absorbido).
  const resultadoExplotacion = exento
    ? margenExplotacion - totalGAVGross
    : margenExplotacion - totalGAVNet;
  // Intereses de construcción ya fueron contados en costos explotación (línea "Intereses de Construcción").
  // "Gastos Fin. Crédito Construcción" queda en 0 para evitar DOBLE CONTEO.
  // Si el proyecto tuviera fees adicionales del crédito (comisiones, seguros), se agregarían aquí.
  const gastosFinCreditoConstruccion = 0;
  const utilidadAntesImpuesto = resultadoExplotacion - gastosFinCreditoConstruccion;
  const impuestoRenta = sum(r => r.incomeTax);
  const pagoIVA = sum(r => r.ivaPaid);
  const utilidadEtapa = utilidadAntesImpuesto - impuestoRenta;
  // IVA No Recuperable: campo informacional, pero NO se vuelve a restar (el cost
  // bruto del contrato DS19 ya lo contiene cuando el proyecto se negocia bruto-inclusive).
  const ivaNoRecuperable = 0;
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
    ivaNoRecuperable,
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

// ── Multi-etapa con canibalización ──
// Si numEtapas = 2: divide el proyecto en dos mitades. La etapa 2 inicia preventas
// calzando su IC con los últimos `etapaOverlapMonths` de obra de la etapa 1.
// Ambas etapas venden a velocidad canibalizada (cannibalizationFactor(2)/2 × base)
// desde sus respectivos inicios de preventa. Los flujos se suman mes a mes.
// Gastos generales se ajustan en etapa 2 para no duplicar durante el traslape.

function emptyCashFlowRow(m: number): MonthlyCashFlowRow {
  return {
    month: m, date: '', utilidadDesarrollador: 0,
    ivaDebitoReceived: 0, ivaCreditoPaid: 0,
    unitsSoldThisMonth: 0, cumulativeUnitsSold: 0,
    unitsDelivered: 0, cumulativeUnitsDelivered: 0,
    revenuePIE: 0, revenueEscrituracion: 0, totalRevenue: 0,
    landCost: 0, landContributions: 0,
    constructionCost: 0, urbanizationCost: 0, earthMovementCost: 0,
    indirectCosts: 0, postVentaConstruction: 0, constructorUtility: 0,
    contingencies: 0, studiesPermitsCost: 0, afrVialCost: 0, itoCost: 0,
    totalConstructionCost: 0,
    escrituracionCost: 0, salesCommission: 0, marketingCost: 0,
    adminCost: 0, postVentaGav: 0, stockMaintenance: 0, greenInsurance: 0,
    totalGAV: 0,
    financingInterest: 0, ivaPaid: 0, incomeTax: 0,
    totalCost: 0, netCashFlow: 0, cumulativeCashFlow: 0,
    financingDrawdown: 0, financingRepayment: 0,
    netCashFlowLevered: 0, cumulativeCashFlowLevered: 0,
    creditoEnlaceDrawdown: 0, creditoEnlaceRepayment: 0,
  };
}

function mergeCashFlowRows(a: MonthlyCashFlowRow, b: MonthlyCashFlowRow): MonthlyCashFlowRow {
  const out = { ...a };
  const sumKeys: (keyof MonthlyCashFlowRow)[] = [
    'utilidadDesarrollador', 'ivaDebitoReceived', 'ivaCreditoPaid',
    'unitsSoldThisMonth', 'cumulativeUnitsSold', 'unitsDelivered', 'cumulativeUnitsDelivered',
    'revenuePIE', 'revenueEscrituracion', 'totalRevenue',
    'landCost', 'landContributions',
    'constructionCost', 'urbanizationCost', 'earthMovementCost',
    'indirectCosts', 'postVentaConstruction', 'constructorUtility',
    'contingencies', 'studiesPermitsCost', 'afrVialCost', 'itoCost',
    'totalConstructionCost', 'escrituracionCost', 'salesCommission', 'marketingCost',
    'adminCost', 'postVentaGav', 'stockMaintenance', 'greenInsurance', 'totalGAV',
    'financingInterest', 'ivaPaid', 'incomeTax',
    'totalCost', 'netCashFlow',
    'financingDrawdown', 'financingRepayment', 'netCashFlowLevered',
    'creditoEnlaceDrawdown', 'creditoEnlaceRepayment',
  ];
  for (const k of sumKeys) {
    (out[k] as number) = (a[k] as number) + (b[k] as number);
  }
  return out;
}

export function buildMultiEtapaCashFlow(
  inputs: ResidualInputs,
  landPriceUFm2: number,
): MonthlyCashFlowRow[] {
  if (inputs.numEtapas <= 1) {
    return buildCashFlow(inputs, landPriceUFm2);
  }

  // División simétrica: 2 etapas iguales (redondeo hacia abajo, el residuo se
  // adjunta a etapa 2 para no perder unidades).
  const unitsE1 = Math.floor(inputs.totalUnits / 2);
  const unitsE2 = inputs.totalUnits - unitsE1;
  const supConstE1 = inputs.totalSupConstruidaM2 * (unitsE1 / inputs.totalUnits);
  const supConstE2 = inputs.totalSupConstruidaM2 - supConstE1;
  const supVendE1 = inputs.totalSupVendibleM2 * (unitsE1 / inputs.totalUnits);
  const supVendE2 = inputs.totalSupVendibleM2 - supVendE1;
  const baseVel = inputs.salesVelocity;
  const canibVel = baseVel * cannibalizationFactor(2) / 2;  // 0.675 × base

  // Ambas etapas venden a velocidad canibalizada. Simplificación de v1:
  // el momento solo (etapa 1 sin etapa 2) también va canibalizado → subestima
  // ligeramente la caja en los primeros meses, pero es conservador.
  const etapaCommon: Partial<ResidualInputs> = {
    numEtapas: 1,  // recursion safety
    salesVelocity: canibVel,
  };

  // Cada etapa toma su porción proporcional del lote para que los costos
  // basados en lotAreaM2 (mov. tierra edificios, urbanización casas) NO se
  // dupliquen al construir 2 cash flows independientes. El terreno total
  // pagado se mantiene = landPrice × lotAreaM2 completo (suma de las dos partes).
  const propE1 = unitsE1 / inputs.totalUnits;
  const propE2 = unitsE2 / inputs.totalUnits;
  const lotE1 = inputs.lotAreaM2 * propE1;
  const lotE2 = inputs.lotAreaM2 * propE2;

  // Etapa 1 — lleva su porción del terreno y contribuciones
  const e1Inputs: ResidualInputs = {
    ...inputs,
    ...etapaCommon,
    totalUnits: unitsE1,
    totalSupConstruidaM2: supConstE1,
    totalSupVendibleM2: supVendE1,
    lotAreaM2: lotE1,
    landContributionsUF: inputs.landContributionsUF * propE1,
    landBrokerageUF: inputs.landBrokerageUF * propE1,
    unitModels: inputs.unitModels.map(m => ({
      ...m,
      count: unitsE1,
      parkingCount: Math.round(m.parkingCount * unitsE1 / inputs.totalUnits),
    })),
  };
  const e1 = buildCashFlow(e1Inputs, landPriceUFm2);

  // Cálculo del desfase de etapa 2:
  //   icE1 = monthPreSalesStart + ceil(unitsE1 * preventaPct / canibVel)
  //   icE2_target = icE1 + constructionMonths - overlapMonths
  //   preventaTimeE2 = ceil(unitsE2 * preventaPct / canibVel)
  //   preSalesStart_E2 = icE2_target - preventaTimeE2
  const preventaE1Units = unitsE1 * inputs.preventasBeforeConstructionPct;
  const preventaE2Units = unitsE2 * inputs.preventasBeforeConstructionPct;
  const icE1 = inputs.autoConstructionStart
    ? inputs.monthPreSalesStart + Math.ceil(preventaE1Units / Math.max(0.1, canibVel))
    : inputs.monthConstructionStart;
  const icE2Target = icE1 + inputs.constructionMonths - inputs.etapaOverlapMonths;
  const preventaTimeE2 = Math.ceil(preventaE2Units / Math.max(0.1, canibVel));
  const preSalesStartE2 = Math.max(inputs.monthPreSalesStart, icE2Target - preventaTimeE2);

  // Etapa 2 — sin terreno, sin contribuciones, + reducciones por traslape
  // de costos de EQUIPO compartido (team fijo que maneja ambas etapas):
  //   - Gastos generales obra (gerente, supervisión): un equipo para ambas
  //   - Tarifa gestión inmobiliaria (5.5%): gerente inmobiliario único
  //   - Post-venta inmobiliaria (0.6%): equipo interno compartido
  //   - Marketing (1.2%): campañas/piloto compartidos
  // NO se reducen: ventas (comisión por venta individual a corredoras externas),
  // escrituración (notario por unidad), seguro verde (por viv), etc.
  const overlapFactor = Math.max(0, 1 - inputs.etapaOverlapMonths / inputs.constructionMonths);
  const e2Inputs: ResidualInputs = {
    ...inputs,
    ...etapaCommon,
    totalUnits: unitsE2,
    totalSupConstruidaM2: supConstE2,
    totalSupVendibleM2: supVendE2,
    lotAreaM2: lotE2,
    landContributionsUF: inputs.landContributionsUF * propE2,
    landBrokerageUF: inputs.landBrokerageUF * propE2,
    unitModels: inputs.unitModels.map(m => ({
      ...m,
      count: unitsE2,
      parkingCount: Math.round(m.parkingCount * unitsE2 / inputs.totalUnits),
    })),
    monthPreSalesStart: preSalesStartE2,
    indirectCostsUFMonth: inputs.indirectCostsUFMonth * overlapFactor,
    // GAV equipo inmobiliario compartido durante traslape
    tarifaGestionInmobiliariaPct: inputs.tarifaGestionInmobiliariaPct * overlapFactor,
    postVentaGavPct: inputs.postVentaGavPct * overlapFactor,
    marketingPct: inputs.marketingPct * overlapFactor,
  };
  // E2 paga su porción del terreno (mismo landPriceUFm2). Total terreno = E1 + E2 = full lot.
  const e2 = buildCashFlow(e2Inputs, landPriceUFm2);

  // Fusionar mes a mes
  const maxLen = Math.max(e1.length, e2.length);
  const merged: MonthlyCashFlowRow[] = [];
  let cumCF = 0, cumCFLev = 0;
  for (let m = 0; m < maxLen; m++) {
    const r1 = e1[m] || emptyCashFlowRow(m);
    const r2 = e2[m] || emptyCashFlowRow(m);
    const row = mergeCashFlowRows(r1, r2);
    row.month = m;
    row.date = r1.date || r2.date || '';
    cumCF += row.netCashFlow;
    cumCFLev += row.netCashFlowLevered;
    row.cumulativeCashFlow = cumCF;
    row.cumulativeCashFlowLevered = cumCFLev;
    merged.push(row);
  }
  return merged;
}

// ── Main solver: Método Residual Dinámico clásico (como Excel) ──
// Terreno es la variable; el solver lo ajusta hasta que TIR (activo puro) = target.
// La utilidad acontecible sale como RESULTADO NATURAL — no se fuerza.

export function solveResidual(inputs: ResidualInputs): ResidualOutput {
  const targetMonthly = Math.pow(1 + inputs.targetTIRAnnual, 1/12) - 1;

  // Solver por TIR: busca land tal que TIR unlevered = target
  const byTIR = bisectLand(inputs, (land) => {
    const cf = buildMultiEtapaCashFlow(inputs, land);
    const tir = computeIRR(cf.map(r => r.netCashFlow));
    if (tir === null) return null;
    return tir - targetMonthly;
  });

  // Solver por Utilidad (informativo, para diagnóstico)
  const byMargin = bisectLand(inputs, (land) => {
    const cf = buildMultiEtapaCashFlow(inputs, land);
    const pnl = buildPnL(inputs, cf, land);
    if (pnl.totalRevenueNet <= 0) return null;
    return (pnl.netProfit / pnl.totalRevenueNet) - inputs.developerMarginPct;
  });

  const finalLand = Math.max(0, byTIR.land);
  const bindingConstraint: 'TIR' | 'Margin' = 'TIR';
  const totalIterations = byTIR.iterations + byMargin.iterations;
  const converged = byTIR.converged;

  // ── Build final output con el land binding ──
  const cashFlow = buildMultiEtapaCashFlow(inputs, finalLand);
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
  // Sin tope superior de unidades: la densidad del PRC manda (puede excederse maxUnits).
  const totalUnits = Math.floor(lotAreaHa * effectiveEfficiency);

  // Default sellable surface (m²) per specific product id.
  // Edificios/Deptos: 60 m² (típico Chile medio)
  // Casas: 85 m² · Townhouses: 85 m²
  // El ticket viene del constants.ts; UF/m² se deriva como ticket / m²_vendible.
  const SUP_VENDIBLE_BY_PRODUCT: Record<string, number> = {
    // DS19 (vivienda social)
    ds19: 52,
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
    parkingPrice = 220;
    parkingPriceSubt = 320;
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

  // Overrides específicos por familia
  const isDs19 = product.family === 'ds19';
  const isHouseLike = product.family === 'casas' || product.family === 'townhouses';

  const ds19Overrides = isDs19 ? {
    constructionCostUFm2: 16.7,
    estudioArquitecturaUFm2: 0.3,
    estudioCalculoUFm2: 0.06,
    // Ventas/marketing quedan en el default global (1.2% cada una)
    tarifaGestionInmobiliariaPct: 0.055,
    escrituracionUFPerUnit: 6,
    contribucionesViviendasUFPerUnit: 5.8,
    decoracionPilotoUF: 0,
    vialContributionUFPerUnit: 18,
    commonAreaPct: 0.18,
    salesVelocity: 7.5,
    creditoEnlaceOn: true,
    creditoEnlaceUFPerUnit: 300,
  } : {};

  const houseOverrides = isHouseLike ? {
    estudioArquitecturaUFm2: 0.35,
    estudioCalculoUFm2: 0.08,
    vialContributionUFPerUnit: 20,
    commonAreaPct: 0,  // casas/TH: cada unidad es independiente, sin áreas comunes
  } : {};

  // Recalcular supConstruida con el commonAreaPct efectivo de cada familia
  const effectiveCommonArea = isDs19 ? 0.18 : isHouseLike ? 0 : commonAreaPct;
  const effectiveSupConstruida = supVendible * (1 + effectiveCommonArea);
  const effectiveUnitModel: UnitModel = {
    ...unitModel,
    supConstruidaM2: effectiveSupConstruida,
  };

  return {
    ...DEFAULT_INPUTS,
    lotAreaM2,
    lotFid,
    productId,
    prcOn,
    unitModels: [effectiveUnitModel],
    totalUnits,
    totalSupConstruidaM2: effectiveSupConstruida * totalUnits,
    totalSupVendibleM2: supVendible * totalUnits,
    subterraneoOn,
    constructionMonths,
    ...ds19Overrides,
    ...houseOverrides,
  };
}
