// Test v3: cópula CROSS produce shocks coherentes con correlaciones empíricas directas
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ctx = vm.createContext({ window: {}, console: console });
vm.runInContext(fs.readFileSync(path.join(__dirname, '../public/market_stats.js'), 'utf8'), ctx);
vm.runInContext(fs.readFileSync(path.join(__dirname, '../public/market_copula.js'), 'utf8'), ctx);
vm.runInContext(fs.readFileSync(path.join(__dirname, '../public/macro_factor_c.js'), 'utf8'), ctx);
vm.runInContext(fs.readFileSync(path.join(__dirname, '../public/macro_factor_v2.js'), 'utf8'), ctx);
vm.runInContext(fs.readFileSync(path.join(__dirname, '../public/macro_factor_v3.js'), 'utf8'), ctx);
vm.runInContext(fs.readFileSync(path.join(__dirname, '../public/macro_factor.js'), 'utf8'), ctx);

const { MacroFactor, MACRO_FACTOR_V3 } = ctx.window;

function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function spearman(x, y) {
  const n = x.length;
  const idx_x = Array.from({length:n}, (_,i)=>i).sort((a,b)=>x[a]-x[b]);
  const idx_y = Array.from({length:n}, (_,i)=>i).sort((a,b)=>y[a]-y[b]);
  const rx = new Array(n), ry = new Array(n);
  idx_x.forEach((i, r) => rx[i] = r);
  idx_y.forEach((i, r) => ry[i] = r);
  const mx = rx.reduce((a,b)=>a+b,0)/n, my = ry.reduce((a,b)=>a+b,0)/n;
  let num=0, dx=0, dy=0;
  for (let i = 0; i < n; i++) {
    const a = rx[i]-mx, b = ry[i]-my;
    num += a*b; dx += a*a; dy += b*b;
  }
  return num / Math.sqrt(dx*dy || 1);
}

console.log('═══ Test v3 cross-cópula: validar correlaciones sampleadas ═══\n');

const N = 5000;
for (const family of ['edif_4p', 'casa']) {
  console.log(`━━━ ${family} (audp_zone) ━━━`);
  const sampler = MacroFactor.createV3(family, { nu: 4, zone: 'audp_zone' });
  const rng = mulberry32(42);
  const draws = sampler.sample(N, rng);

  // Extraer cada variable
  const data = {};
  for (const v of sampler.vars) {
    data[v] = draws.map(d => d.macros[v] || 0);
  }

  console.log('  Correlaciones cross macro↔producto (sampleadas):');
  const macros = ['imacec_var', 'd_tasa_hipo', 'd_desempleo', 'icoi_yoy'];
  const prods = ['precio_yoy', 'velocidad_yoy'];
  for (const m of macros) {
    for (const p of prods) {
      if (data[m] && data[p]) {
        const r_sampled = spearman(data[m], data[p]);
        // Correlación target del modelo
        const fam = MACRO_FACTOR_V3.cross_models['audp_zone'][family];
        const r_target = fam.corr_spearman[m] && fam.corr_spearman[m][p];
        if (r_target !== undefined) {
          console.log(`    ${m.padEnd(15)} ↔ ${p.padEnd(14)} target=${r_target.toFixed(3).padStart(7)}  sampled=${r_sampled.toFixed(3).padStart(7)}  Δ=${(r_sampled-r_target).toFixed(3)}`);
        }
      }
    }
  }
  console.log();
}

console.log('═══ FIN ═══');
