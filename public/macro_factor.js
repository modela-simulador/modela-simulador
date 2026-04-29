// ════════════════════════════════════════════════════════════════════
// macro_factor.js — Factor Model Opción C (Capa 2)
// ════════════════════════════════════════════════════════════════════
//
// Samplea 5 macros con t-cópula (matriz Spearman empírica) y propaga
// a shocks de precio/velocidad/costo/plazo por familia:
//
//   precio_yoy_familiar = IPV_familiar_sampled + ε_idiosincrático
//   costo_yoy           = ICOI_sampled + ε_idiosincrático
//   velocidad_yoy       = α + Σ β_i·macro_i_sampled + ε_residual_OLS
//   plazo_yoy           = N(0, σ_histórica)
//
// Mode "preset": el usuario elige un escenario histórico (Crisis 2008,
// COVID 2020, etc.). Las macros se centran en los valores de ese preset
// (mean shift), y la cópula sortea variabilidad alrededor de ese centro.
//
// Mode "custom": el usuario setea cada slider de macro manualmente.
//
// Dependencias: window.MACRO_FACTOR_C (cargado de macro_factor_c.js),
//                window.MarketCopula (cargado de market_copula.js — pero
//                solo usamos sus utilities matemáticas).
//
// Uso:
//   const sampler = MacroFactor.create('edif_4p', { nu: 4, preset: 'subprime_2009' });
//   const draw = sampler.sampleOne(rng);  // → { precio_yoy, velocidad_yoy, costo_yoy, plazo_yoy, macros: {...} }
// ════════════════════════════════════════════════════════════════════

(function (global) {
  'use strict';

  // Variables macro que sampleamos en la cópula. Orden fijo.
  // Usamos los IPV específicos por familia (deptos vs casas), pero sampleamos
  // solo el correspondiente a la familia para evitar dimensionalidad inútil.
  const MACRO_VARS_BASE = ['imacec_var_pct', 'd_tasa_hipo', 'd_desempleo', 'icoi_yoy'];
  // Más el IPV de la familia (5to)

  // ── Helpers matemáticos (delegados a MarketCopula si está cargado) ──
  function getMath() {
    if (global.MarketCopula) {
      return {
        cholesky: global.MarketCopula._cholesky,
        spearmanToPearson: global.MarketCopula._spearmanToPearson,
        empQuantile: global.MarketCopula._empiricalQuantile,
        normCdf: global.MarketCopula._normCdf,
        tCdf: global.MarketCopula._tCdf,
      };
    }
    throw new Error('MacroFactor requires MarketCopula to be loaded first');
  }

  function gauss(rng) {
    let u = 0, v = 0;
    while (u === 0) u = rng();
    while (v === 0) v = rng();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }

  function chi2(rng, nu) {
    if (nu >= 30) {
      const c = 2 / (9 * nu);
      const z = gauss(rng);
      const r = 1 - c + z * Math.sqrt(c);
      return Math.max(1e-6, nu * r * r * r);
    }
    let s = 0;
    for (let i = 0; i < nu; i++) {
      const z = gauss(rng);
      s += z * z;
    }
    return s;
  }

  function sampleMVTUnit(L, nu, rng) {
    const n = L.length;
    const eps = new Array(n);
    for (let i = 0; i < n; i++) eps[i] = gauss(rng);
    const z = new Array(n).fill(0);
    for (let i = 0; i < n; i++) {
      for (let j = 0; j <= i; j++) z[i] += L[i][j] * eps[j];
    }
    const w = chi2(rng, nu);
    const scale = Math.sqrt(nu / w);
    return z.map(zi => zi * scale);
  }

  // ── Clase principal ──────────────────────────────────────────────

  function create(family, opts) {
    opts = opts || {};
    const nu = opts.nu || 4;
    const presetName = opts.preset || 'base_esperado';
    const customCenters = opts.customCenters || null; // override por macro

    if (!global.MACRO_FACTOR_C) {
      throw new Error('macro_factor_c.js no cargado (window.MACRO_FACTOR_C)');
    }
    const M = global.MACRO_FACTOR_C;
    if (!M.family_models[family]) {
      throw new Error('Familia desconocida en MACRO_FACTOR_C: ' + family);
    }
    const fam = M.family_models[family];
    const ipvCol = M.metadata.family_ipv_map[family];

    // Variables que sampleamos: 4 base + IPV específico
    const MACRO_VARS = [...MACRO_VARS_BASE, ipvCol];

    // Construir matriz Spearman → Pearson para estas variables
    const n = MACRO_VARS.length;
    const R_p = Array.from({ length: n }, () => new Array(n).fill(0));
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        if (i === j) {
          R_p[i][j] = 1;
        } else {
          const rs = M.macros_corr_spearman[MACRO_VARS[i]][MACRO_VARS[j]];
          R_p[i][j] = 2 * Math.sin(Math.PI / 6 * rs);
        }
      }
    }
    const math = getMath();
    const L = math.cholesky(R_p);

    // Centro del shock: preset histórico o custom
    const presetMacros = customCenters || M.presets[presetName] || M.presets.base_esperado;

    // Para cada macro: necesitamos saber DESVIACIÓN del p50 esperada por
    // el preset, y la dispersión normal alrededor de esa media.
    // Estrategia: sample uniformly cópula-driven, mappear a empirical quantile,
    // luego SHIFT por (preset[var] - p50[var]) — esto centra el sample en el preset.
    const macroShifts = {};
    for (const mv of MACRO_VARS) {
      const p50 = M.macros[mv].p50;
      const presetVal = presetMacros[mv] != null ? presetMacros[mv] : p50;
      macroShifts[mv] = presetVal - p50;
    }

    // Cuantil empírico inverso (interpolación lineal sobre 99 percentiles)
    function empQuantile(pcts, u) {
      const idx = u * 100 - 1;
      if (idx <= 0) return pcts[0];
      if (idx >= 98) return pcts[98];
      const lo = Math.floor(idx);
      const hi = lo + 1;
      const frac = idx - lo;
      return pcts[lo] * (1 - frac) + pcts[hi] * frac;
    }

    // Sample 1 draw
    function sampleOne(rng) {
      // 1. Sample t-cópula joint sobre los 5 macros
      const t = sampleMVTUnit(L, nu, rng);
      const u = t.map(ti => math.tCdf(ti, nu));

      // 2. Convertir a valores de macro vía cuantil empírico + shift por preset
      const macros = {};
      for (let i = 0; i < n; i++) {
        const mv = MACRO_VARS[i];
        const pcts = M.macros[mv].pcts;
        const empVal = empQuantile(pcts, u[i]);
        macros[mv] = empVal + macroShifts[mv];
      }

      // 3. Aplicar shocks DIRECTOS para precio y costo
      // precio_yoy = IPV_familiar_sampled + ε_idiosincrático ~ N(0, σ)
      // NOTA: NO sumamos el bias histórico — ese bias representa un drift
      // composicional (TINSA agregada vs IPV controlado) que NO es un shock
      // cíclico. Para Monte Carlo de stress queremos solo el componente
      // que efectivamente se mueve con el preset macro.
      const ipvSampled = macros[ipvCol];
      const precioSigma = fam.precio_shock.sigma_idiosyncratic_pp || 5;
      const precio_yoy = ipvSampled + gauss(rng) * precioSigma;

      // costo_yoy = ICOI_sampled + ε ~ N(0, σ_idiosincrático ~3pp)
      const icoiSampled = macros['icoi_yoy'];
      const costoSigma = fam.costo_shock.sigma_idiosyncratic_pp || 3;
      const costo_yoy = icoiSampled + gauss(rng) * costoSigma;

      // 4. Velocidad: regresión OLS + ε ~ N(0, σ_residual)
      // Clamp a ±30pp para evitar predicciones extremas cuando R² es bajo.
      // En modelo R²=0.04 cualquier outlier de macro se amplifica linealmente
      // sin mecanismo de corrección. El clamp es un "guard rail" económicamente
      // razonable — velocidad de venta de un proyecto rara vez se duplica
      // o desploma 50% en 1 año.
      let velocidad_yoy = 0;
      const velReg = fam.velocidad_regression;
      if (velReg) {
        velocidad_yoy = velReg.intercept;
        for (const [varName, coef] of Object.entries(velReg.coefs)) {
          if (macros[varName] != null) {
            velocidad_yoy += coef * macros[varName];
          }
        }
        velocidad_yoy += gauss(rng) * Math.min(velReg.sigma_residual || 30, 25);
        velocidad_yoy = Math.max(-40, Math.min(60, velocidad_yoy));
      }

      // 5. Plazo: σ histórica simple, clamp a ±25pp
      const plazoSigma = Math.min(fam.plazo_shock.sigma_idiosyncratic_pp || 10, 20);
      let plazo_yoy = gauss(rng) * plazoSigma;
      plazo_yoy = Math.max(-30, Math.min(40, plazo_yoy));

      return {
        precio_yoy,
        velocidad_yoy,
        costo_yoy,
        plazo_yoy,
        macros,
      };
    }

    function sample(N, rng) {
      const out = new Array(N);
      for (let i = 0; i < N; i++) out[i] = sampleOne(rng);
      return out;
    }

    return {
      family, nu, presetName,
      vars: MACRO_VARS,
      R_pearson: R_p,
      L_cholesky: L,
      ipvCol,
      familyModel: fam,
      sampleOne,
      sample,
    };
  }

  // ── Lista de presets disponibles (para UI) ──
  function listPresets() {
    if (!global.MACRO_FACTOR_C) return [];
    return Object.keys(global.MACRO_FACTOR_C.presets);
  }

  function getPreset(name) {
    if (!global.MACRO_FACTOR_C) return null;
    return global.MACRO_FACTOR_C.presets[name] || null;
  }

  // ════════════════════════════════════════════════════════════════
  // v2 Sampler — Cópula expandida + zona AUDP + lag t-3 + polinómica
  // ════════════════════════════════════════════════════════════════

  function createV2(family, opts) {
    opts = opts || {};
    const nu = opts.nu || 4;
    const zone = opts.zone || 'audp_zone';

    if (!global.MACRO_FACTOR_V2) {
      throw new Error('macro_factor_v2.js no cargado (window.MACRO_FACTOR_V2)');
    }
    const M = global.MACRO_FACTOR_V2;
    const fam = M.family_models[zone] && M.family_models[zone][family];
    if (!fam) {
      throw new Error('Familia/zona desconocida en MACRO_FACTOR_V2: ' + zone + '/' + family);
    }

    // Variables expandidas en la cópula
    const VARS = M.expanded_macros_key.filter(v => M.macros_expanded[v]);
    const n = VARS.length;

    // Construir matriz Spearman → Pearson + Cholesky
    const math = getMath();
    const R_p = Array.from({ length: n }, () => new Array(n).fill(0));
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        if (i === j) {
          R_p[i][j] = 1;
        } else {
          const rs = M.macros_corr_expanded[VARS[i]][VARS[j]];
          R_p[i][j] = 2 * Math.sin(Math.PI / 6 * rs);
        }
      }
    }
    const L = math.cholesky(R_p);

    // Drivers de los shocks
    const ipvLag3Col = fam.precio_shock.driver;  // 'ipv_general_yoy_L3' (mejora 1)
    const icoiCol = 'icoi_yoy';

    function empQuantile(pcts, u) {
      const idx = u * 100 - 1;
      if (idx <= 0) return pcts[0];
      if (idx >= 98) return pcts[98];
      const lo = Math.floor(idx);
      return pcts[lo] * (1 - (idx - lo)) + pcts[lo + 1] * (idx - lo);
    }

    function sampleOne(rng) {
      // 1. Sample t-cópula joint sobre las variables expandidas
      const t = sampleMVTUnit(L, nu, rng);
      const u = t.map(ti => math.tCdf(ti, nu));

      const macros = {};
      for (let i = 0; i < n; i++) {
        const mv = VARS[i];
        macros[mv] = empQuantile(M.macros_expanded[mv].pcts, u[i]);
      }

      // 2. Precio shock vía IPV en lag-3 (MEJORA 1)
      const ipvLag3Sampled = macros[ipvLag3Col] || 0;
      const precioSigma = fam.precio_shock.sigma_idiosyncratic_pp || 5;
      const precio_yoy = ipvLag3Sampled + gauss(rng) * precioSigma;

      // 3. Costo shock vía ICOI contemporáneo
      const icoiSampled = macros[icoiCol] || 0;
      const costoSigma = fam.costo_shock.sigma_idiosyncratic_pp || 3;
      const costo_yoy = icoiSampled + gauss(rng) * costoSigma;

      // 4. Velocidad: regresión polinómica (MEJORA 3)
      let velocidad_yoy = 0;
      const reg = fam.velocidad_regression_polynomial;
      if (reg && reg.coefs) {
        velocidad_yoy = reg.intercept || 0;
        const imacec = macros['imacec_var_pct'] || 0;
        const ipv = macros['ipv_general_yoy'] || 0;
        const icoi = macros['icoi_yoy'] || 0;
        // Construir features según el modelo polinómico
        const c = reg.coefs;
        velocidad_yoy += (c.imacec || 0) * imacec;
        velocidad_yoy += (c.ipv || 0) * ipv;
        velocidad_yoy += (c.icoi || 0) * icoi;
        velocidad_yoy += (c.imacec_x_ipv || 0) * imacec * ipv;
        velocidad_yoy += (c.imacec_sq || 0) * imacec * imacec;
        velocidad_yoy += gauss(rng) * Math.min(reg.sigma_residual || 30, 25);
        velocidad_yoy = Math.max(-40, Math.min(60, velocidad_yoy));
      }

      // 5. Plazo: shock idiosincrático
      const plazoSigma = Math.min(fam.plazo_shock.sigma_idiosyncratic_pp || 10, 20);
      let plazo_yoy = gauss(rng) * plazoSigma;
      plazo_yoy = Math.max(-30, Math.min(40, plazo_yoy));

      return { precio_yoy, velocidad_yoy, costo_yoy, plazo_yoy, macros };
    }

    function sample(N, rng) {
      const out = new Array(N);
      for (let i = 0; i < N; i++) out[i] = sampleOne(rng);
      return out;
    }

    return {
      family, zone, nu,
      version: 'v2',
      vars: VARS.slice(),
      ipvLag3Col,
      familyModel: fam,
      sampleOne, sample,
    };
  }

  function listZonesV2() {
    if (!global.MACRO_FACTOR_V2) return [];
    return Object.keys(global.MACRO_FACTOR_V2.family_models);
  }

  // ════════════════════════════════════════════════════════════════
  // v3 Sampler — Cópula CROSS unificada (10D: macros + producto)
  // ════════════════════════════════════════════════════════════════
  // Captura correlaciones DIRECTAS macro↔producto (e.g., desempleo↔precio)
  // que v1/v2 perdían al mediar por regresión OLS.

  function createV3(family, opts) {
    opts = opts || {};
    const nu = opts.nu || 4;
    const zone = opts.zone || 'audp_zone';

    if (!global.MACRO_FACTOR_V3) {
      throw new Error('macro_factor_v3.js no cargado (window.MACRO_FACTOR_V3)');
    }
    const M = global.MACRO_FACTOR_V3;
    const fam = M.cross_models[zone] && M.cross_models[zone][family];
    if (!fam) {
      throw new Error('Familia/zona desconocida en MACRO_FACTOR_V3: ' + zone + '/' + family);
    }

    // Variables: 5 macros + 5 producto (10 dim)
    const VARS = fam.vars;
    const n = VARS.length;

    const math = getMath();
    const R_p = Array.from({ length: n }, () => new Array(n).fill(0));
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        if (i === j) {
          R_p[i][j] = 1;
        } else {
          const rs = fam.corr_spearman[VARS[i]][VARS[j]];
          R_p[i][j] = 2 * Math.sin(Math.PI / 6 * rs);
        }
      }
    }
    const L = math.cholesky(R_p);

    function empQuantile(pcts, u) {
      const idx = u * 100 - 1;
      if (idx <= 0) return pcts[0];
      if (idx >= 98) return pcts[98];
      const lo = Math.floor(idx);
      return pcts[lo] * (1 - (idx - lo)) + pcts[lo + 1] * (idx - lo);
    }

    function sampleOne(rng) {
      const t = sampleMVTUnit(L, nu, rng);
      const u = t.map(ti => math.tCdf(ti, nu));

      const sample = {};
      for (let i = 0; i < n; i++) {
        const v = VARS[i];
        sample[v] = empQuantile(fam.marginals[v].pcts, u[i]);
      }

      // En v3 las variables PRODUCTO ya vienen sampleadas directamente de la cópula
      // (no se derivan de regresión). Solo agregamos clamps para guard rails.
      const precio_yoy = Math.max(-50, Math.min(60, sample['precio_yoy'] || 0));
      const velocidad_yoy = Math.max(-60, Math.min(80, sample['velocidad_yoy'] || 0));
      const plazo_yoy = Math.max(-30, Math.min(40, sample['plazo_yoy'] || 0));

      // Para costo, derivamos de ICOI (no está como variable producto en TINSA)
      const icoiSampled = sample['icoi_yoy'] || 0;
      const costo_yoy = icoiSampled + gauss(rng) * 3;  // σ idiosincrático fijo

      return {
        precio_yoy,
        velocidad_yoy,
        costo_yoy,
        plazo_yoy,
        macros: sample,
      };
    }

    function sample(N, rng) {
      const out = new Array(N);
      for (let i = 0; i < N; i++) out[i] = sampleOne(rng);
      return out;
    }

    return {
      family, zone, nu,
      version: 'v3',
      vars: VARS.slice(),
      familyModel: fam,
      sampleOne, sample,
    };
  }

  function listZonesV3() {
    if (!global.MACRO_FACTOR_V3) return [];
    return Object.keys(global.MACRO_FACTOR_V3.cross_models);
  }

  global.MacroFactor = {
    create,
    createV2,
    createV3,
    listPresets,
    getPreset,
    listZonesV2,
    listZonesV3,
    MACRO_VARS_BASE,
  };

})(typeof window !== 'undefined' ? window : globalThis);
