// ═════════════════════════════════════════════════════════════════════
// market_copula.js — t-cópula con marginales empíricas (CIDU)
// ═════════════════════════════════════════════════════════════════════
//
// Implementación completa de:
//   1. Conversión Spearman → Pearson (fórmula seno para cópula elíptica)
//   2. Cholesky decomposition (regulariza cuando la matriz no es PSD)
//   3. Multivariate-t sampling (Z = MVN, W = chi²/ν, T = Z/√W)
//   4. CDF univariada t (Student) — aproximación serie continua
//   5. Cuantil-inversa empírica (interpolación lineal sobre 99 percentiles)
//
// Diseño extensible: cuando lleguen los datos macro (Capa 2), se agrega
// un método sampleWithMacroDriver(family, macroVec, n) que aplique
// regresiones precalibradas precio = α + β·macros y use esta cópula
// para sortear los residuos ε.
//
// Uso:
//   const cop = MarketCopula.create('edif_4p', { nu: 4 });
//   const draws = cop.sample(3000, seedRng);
//   // draws[i] = { precio_uf_m2, velocidad_uds_mes, plazo, descuento, sup }
//
// Dependencias: window.MARKET_STATS (cargado de market_stats.js).
// ═════════════════════════════════════════════════════════════════════

(function (global) {
  'use strict';

  // ── Variables empíricas que vamos a sortear con la cópula ──────────
  // Orden fijo — la matriz Spearman y los samples siguen este orden.
  const VARS = [
    'precio_uf_m2',
    'velocidad_uds_mes',
    'plazo_construccion_meses',  // realmente "lead-time venta-entrega"
    'descuento_pct',
    'sup_promedio_m2',
  ];

  // ──────────────────────────────────────────────────────────────────
  // Funciones especiales (erf, gamma, etc.) — implementación pura JS
  // ──────────────────────────────────────────────────────────────────

  // erf: aproximación Abramowitz-Stegun 7.1.26 (precisión ~1e-7)
  function erf(x) {
    const a1 = 0.254829592, a2 = -0.284496736, a3 = 1.421413741;
    const a4 = -1.453152027, a5 = 1.061405429, p = 0.3275911;
    const sign = x < 0 ? -1 : 1;
    x = Math.abs(x);
    const t = 1 / (1 + p * x);
    const y = 1 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-x * x);
    return sign * y;
  }

  // CDF normal estándar
  const normCdf = (z) => 0.5 * (1 + erf(z / Math.SQRT2));

  // Lanczos approximation para log(Γ(x)) (Numerical Recipes)
  function logGamma(x) {
    const cof = [76.18009172947146, -86.50532032941677, 24.01409824083091,
                 -1.231739572450155, 1.208650973866179e-3, -5.395239384953e-6];
    let y = x, t = x + 5.5;
    t -= (x + 0.5) * Math.log(t);
    let ser = 1.000000000190015;
    for (let j = 0; j < 6; j++) ser += cof[j] / ++y;
    return -t + Math.log(2.5066282746310005 * ser / x);
  }

  // Beta-incompleta regularizada I_x(a,b) — usada para t-CDF
  // Implementación de Numerical Recipes (continued fraction)
  function betacf(a, b, x) {
    const fpmin = 1e-30;
    const qab = a + b, qap = a + 1, qam = a - 1;
    let c = 1, d = 1 - qab * x / qap;
    if (Math.abs(d) < fpmin) d = fpmin;
    d = 1 / d;
    let h = d;
    for (let m = 1; m <= 200; m++) {
      const m2 = 2 * m;
      let aa = m * (b - m) * x / ((qam + m2) * (a + m2));
      d = 1 + aa * d; if (Math.abs(d) < fpmin) d = fpmin;
      c = 1 + aa / c; if (Math.abs(c) < fpmin) c = fpmin;
      d = 1 / d;
      h *= d * c;
      aa = -(a + m) * (qab + m) * x / ((a + m2) * (qap + m2));
      d = 1 + aa * d; if (Math.abs(d) < fpmin) d = fpmin;
      c = 1 + aa / c; if (Math.abs(c) < fpmin) c = fpmin;
      d = 1 / d;
      const del = d * c;
      h *= del;
      if (Math.abs(del - 1) < 3e-7) break;
    }
    return h;
  }

  function betaIncReg(x, a, b) {
    if (x === 0 || x === 1) return x;
    const bt = Math.exp(logGamma(a + b) - logGamma(a) - logGamma(b)
                        + a * Math.log(x) + b * Math.log(1 - x));
    if (x < (a + 1) / (a + b + 2)) return bt * betacf(a, b, x) / a;
    return 1 - bt * betacf(b, a, 1 - x) / b;
  }

  // CDF de t-Student con ν grados de libertad
  // P(T_nu <= t) = 1 - 0.5 * I_{nu/(nu+t²)}(nu/2, 1/2)   if t > 0
  function tCdf(t, nu) {
    if (t === 0) return 0.5;
    const x = nu / (nu + t * t);
    const ib = 0.5 * betaIncReg(x, nu / 2, 0.5);
    return t > 0 ? 1 - ib : ib;
  }

  // ──────────────────────────────────────────────────────────────────
  // Álgebra: Cholesky con regularización (PSD-safe)
  // ──────────────────────────────────────────────────────────────────

  // Convierte Spearman → Pearson para cópula elíptica:
  //   ρ_pearson = 2 · sin(π/6 · ρ_spearman)
  // Esta es la fórmula exacta que preserva la dependencia de rangos
  // bajo una transformación uniforme/normal.
  function spearmanToPearson(rs) {
    return 2 * Math.sin(Math.PI / 6 * rs);
  }

  // Cholesky con regularización: si la matriz no es PSD (ocurre con
  // matrices de correlación estimadas en muestras pequeñas), agregamos
  // ε·I hasta que sea PSD. Devuelve la matriz triangular inferior L.
  function cholesky(A) {
    const n = A.length;
    // Copia y regulariza si hace falta
    let M = A.map(row => row.slice());
    let attempts = 0;
    while (attempts < 10) {
      try {
        const L = Array.from({length: n}, () => new Array(n).fill(0));
        let ok = true;
        for (let i = 0; i < n && ok; i++) {
          for (let j = 0; j <= i && ok; j++) {
            let s = 0;
            for (let k = 0; k < j; k++) s += L[i][k] * L[j][k];
            if (i === j) {
              const d = M[i][i] - s;
              if (d <= 0) { ok = false; break; }
              L[i][j] = Math.sqrt(d);
            } else {
              L[i][j] = (M[i][j] - s) / L[j][j];
            }
          }
        }
        if (ok) return L;
      } catch (e) {}
      // No PSD: agregar ε a la diagonal
      const eps = 0.001 * Math.pow(2, attempts);
      for (let i = 0; i < n; i++) M[i][i] += eps;
      attempts++;
    }
    throw new Error('cholesky: matriz no PSD aún tras regularización');
  }

  // ──────────────────────────────────────────────────────────────────
  // Sampling: MVN, Chi², Multivariate-t
  // ──────────────────────────────────────────────────────────────────

  // Box-Muller con un PRNG reproducible (rng() devuelve uniforme [0,1))
  function gauss(rng) {
    let u = 0, v = 0;
    while (u === 0) u = rng();
    while (v === 0) v = rng();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }

  // Chi-squared con ν grados de libertad: suma de ν gaussianas al cuadrado
  // Para ν moderado (≤ 30) es eficiente. Para ν grande usar Wilson-Hilferty.
  function chi2(rng, nu) {
    if (nu >= 30) {
      // Wilson-Hilferty: aproximación ((χ²/ν)^(1/3) ≈ N(1 - 2/(9ν), 2/(9ν)))
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

  // Multivariate-t: T = μ + Z·√(ν/W) donde Z ~ MVN(0, Σ), W ~ χ²(ν)
  // Con μ = 0 y Σ = R (matriz correlación), L = chol(R):
  //   z = L · ε,  ε ~ N(0, I)
  //   t = z · √(ν / w)
  function sampleMVTUnit(L, nu, rng) {
    const n = L.length;
    const eps = new Array(n);
    for (let i = 0; i < n; i++) eps[i] = gauss(rng);
    // z = L · eps
    const z = new Array(n).fill(0);
    for (let i = 0; i < n; i++) {
      for (let j = 0; j <= i; j++) z[i] += L[i][j] * eps[j];
    }
    const w = chi2(rng, nu);
    const scale = Math.sqrt(nu / w);
    return z.map(zi => zi * scale);
  }

  // ──────────────────────────────────────────────────────────────────
  // Cuantil-inversa empírica (interpolación lineal en 99 percentiles)
  // ──────────────────────────────────────────────────────────────────

  // pcts: array de 99 valores en posiciones q = 0.01, 0.02, ..., 0.99
  // u: cuantil deseado en (0, 1)
  // Devuelve el valor x tal que F(x) ≈ u, interpolando linealmente.
  function empiricalQuantile(pcts, u) {
    // Mapeamos u ∈ (0, 1) al índice continuo en [0, 98]
    // q[i] = (i + 1) / 100, i ∈ [0, 98]
    const idx = u * 100 - 1;  // u=0.01 → idx=0; u=0.99 → idx=98
    if (idx <= 0) return pcts[0];
    if (idx >= 98) return pcts[98];
    const lo = Math.floor(idx);
    const hi = lo + 1;
    const frac = idx - lo;
    return pcts[lo] * (1 - frac) + pcts[hi] * frac;
  }

  // ──────────────────────────────────────────────────────────────────
  // Construcción de la cópula para una familia
  // ──────────────────────────────────────────────────────────────────

  function create(family, opts) {
    opts = opts || {};
    const nu = opts.nu || 4;  // grados de libertad de la t-cópula

    if (!global.MARKET_STATS || !global.MARKET_STATS[family]) {
      throw new Error('MarketCopula: familia desconocida o MARKET_STATS no cargado: ' + family);
    }
    const stats = global.MARKET_STATS[family];

    // Construir matriz de correlación Spearman → Pearson (aprox inicial)
    const n = VARS.length;
    const R = Array.from({length: n}, () => new Array(n).fill(0));
    const targetSpearman = Array.from({length: n}, () => new Array(n).fill(0));
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        if (i === j) {
          R[i][j] = 1;
          targetSpearman[i][j] = 1;
        } else {
          const rs = stats.corr_spearman[VARS[i]][VARS[j]];
          targetSpearman[i][j] = rs;
          R[i][j] = spearmanToPearson(rs);
        }
      }
    }

    // ── Calibración Iman-Conover (corrección iterativa de Pearson) ──
    // La fórmula 2·sin(π/6·ρs) es exacta para Gaussian copula, pero con
    // t-cópula introduce un sesgo de ~5-10%. Aquí hacemos K iteraciones:
    // 1) sample N draws con la R actual, 2) medimos Spearman observado,
    // 3) ajustamos R_ij <- R_ij + α·(target_ij - observed_ij), 4) repetir.
    // Convergencia típica: 3-5 iteraciones, error final < 0.02.
    if (opts.calibrate !== false) {
      const Ncal = opts.calibrationN || 3000;
      const Kmax = opts.calibrationIters || 4;
      const alpha = 0.85;
      const calibRng = (function () {
        let a = 12345;
        return function () {
          a = (a + 0x6D2B79F5) >>> 0;
          let t = a;
          t = Math.imul(t ^ (t >>> 15), t | 1);
          t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
          return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
        };
      })();

      for (let iter = 0; iter < Kmax; iter++) {
        let L_iter;
        try { L_iter = cholesky(R); } catch (e) { break; }
        // Generamos draws en el espacio de la t-cópula (uniformes via t-CDF)
        const draws = new Array(Ncal);
        for (let s = 0; s < Ncal; s++) {
          const t = sampleMVTUnit(L_iter, nu, calibRng);
          // Solo necesitamos el orden de los samples (rangos), no los valores absolutos
          draws[s] = t;
        }
        // Calculamos Spearman sobre los draws de la cópula (en escala t)
        const observed = computeSpearmanMatrix(draws, n);
        // Ajustamos R por el delta
        let maxErr = 0;
        for (let i = 0; i < n; i++) {
          for (let j = 0; j < n; j++) {
            if (i === j) continue;
            const err = targetSpearman[i][j] - observed[i][j];
            if (Math.abs(err) > maxErr) maxErr = Math.abs(err);
            R[i][j] = Math.max(-0.99, Math.min(0.99, R[i][j] + alpha * err));
          }
        }
        if (maxErr < 0.01) break;  // suficiente precisión
      }
    }

    const L = cholesky(R);

    // Cachear pcts por variable (acceso O(1) en sampling)
    const pctsCache = {};
    for (const v of VARS) pctsCache[v] = stats.marginals[v].pcts;

    // ── API pública del objeto cópula ──
    return {
      family: family,
      name: stats.name,
      nu: nu,
      vars: VARS.slice(),
      R_pearson: R,         // expuesta para validación
      R_spearman: stats.corr_spearman,
      stats: stats,
      L_cholesky: L,        // expuesta para diagnóstico

      // Genera 1 draw (objeto con valores absolutos)
      sampleOne: function (rng) {
        const t = sampleMVTUnit(L, nu, rng);
        const u = t.map(ti => tCdf(ti, nu));
        const out = {};
        for (let i = 0; i < n; i++) {
          out[VARS[i]] = empiricalQuantile(pctsCache[VARS[i]], u[i]);
        }
        return out;
      },

      // Genera N draws en una llamada
      sample: function (N, rng) {
        const out = new Array(N);
        for (let i = 0; i < N; i++) out[i] = this.sampleOne(rng);
        return out;
      },
    };
  }

  // ──────────────────────────────────────────────────────────────────
  // Validación: matriz de correlación Spearman observada en los samples
  // (debería aproximarse a la matriz original de input)
  // ──────────────────────────────────────────────────────────────────

  // Spearman sobre una matriz N×k de números (no objetos). Para uso interno
  // en la calibración Iman-Conover.
  function computeSpearmanMatrix(rows, k) {
    const n = rows.length;
    const ranks = Array.from({length: k}, () => new Array(n));
    for (let v = 0; v < k; v++) {
      const idxSorted = Array.from({length: n}, (_, i) => i)
        .sort((a, b) => rows[a][v] - rows[b][v]);
      for (let i = 0; i < n; i++) ranks[v][idxSorted[i]] = i + 1;
    }
    const out = Array.from({length: k}, () => new Array(k).fill(0));
    for (let i = 0; i < k; i++) {
      for (let j = 0; j < k; j++) {
        if (i === j) { out[i][j] = 1; continue; }
        let sx = 0, sy = 0;
        for (let s = 0; s < n; s++) { sx += ranks[i][s]; sy += ranks[j][s]; }
        const mx = sx / n, my = sy / n;
        let num = 0, dx = 0, dy = 0;
        for (let s = 0; s < n; s++) {
          const a = ranks[i][s] - mx, b = ranks[j][s] - my;
          num += a * b; dx += a * a; dy += b * b;
        }
        out[i][j] = num / Math.sqrt(dx * dy || 1);
      }
    }
    return out;
  }

  function spearmanFromSamples(samples, vars) {
    const n = samples.length;
    const k = vars.length;
    // Computar ranks por columna
    const ranks = vars.map(v => {
      const idxSorted = Array.from({length: n}, (_, i) => i)
        .sort((a, b) => samples[a][v] - samples[b][v]);
      const r = new Array(n);
      for (let i = 0; i < n; i++) r[idxSorted[i]] = i + 1;
      return r;
    });
    const matrix = Array.from({length: k}, () => new Array(k).fill(0));
    for (let i = 0; i < k; i++) {
      for (let j = 0; j < k; j++) {
        if (i === j) { matrix[i][j] = 1; continue; }
        // Pearson sobre ranks = Spearman
        let sx = 0, sy = 0;
        for (let s = 0; s < n; s++) { sx += ranks[i][s]; sy += ranks[j][s]; }
        const mx = sx / n, my = sy / n;
        let num = 0, dx = 0, dy = 0;
        for (let s = 0; s < n; s++) {
          const a = ranks[i][s] - mx, b = ranks[j][s] - my;
          num += a * b; dx += a * a; dy += b * b;
        }
        matrix[i][j] = num / Math.sqrt(dx * dy || 1);
      }
    }
    return matrix;
  }

  // ──────────────────────────────────────────────────────────────────
  // Export
  // ──────────────────────────────────────────────────────────────────

  global.MarketCopula = {
    create: create,
    VARS: VARS,
    // Expuestos para diagnóstico/test
    _normCdf: normCdf,
    _tCdf: tCdf,
    _spearmanToPearson: spearmanToPearson,
    _cholesky: cholesky,
    _empiricalQuantile: empiricalQuantile,
    _spearmanFromSamples: spearmanFromSamples,
  };

})(typeof window !== 'undefined' ? window : globalThis);
