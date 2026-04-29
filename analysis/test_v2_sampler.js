// Test rápido: sampler v2 produce shocks distintos entre AUDP zone y Nacional
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ctx = vm.createContext({ window: {}, console: console });
vm.runInContext(fs.readFileSync(path.join(__dirname, '../public/market_stats.js'), 'utf8'), ctx);
vm.runInContext(fs.readFileSync(path.join(__dirname, '../public/market_copula.js'), 'utf8'), ctx);
vm.runInContext(fs.readFileSync(path.join(__dirname, '../public/macro_factor_c.js'), 'utf8'), ctx);
vm.runInContext(fs.readFileSync(path.join(__dirname, '../public/macro_factor_v2.js'), 'utf8'), ctx);
vm.runInContext(fs.readFileSync(path.join(__dirname, '../public/macro_factor.js'), 'utf8'), ctx);

const { MacroFactor, MACRO_FACTOR_V2 } = ctx.window;

if (!MacroFactor || !MACRO_FACTOR_V2) {
  console.error('FAIL: módulos no cargados');
  process.exit(1);
}

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

function stats(arr) {
  const s = [...arr].sort((a, b) => a - b);
  const n = s.length;
  const mean = arr.reduce((a, b) => a + b, 0) / n;
  return {
    mean,
    p5: s[Math.floor(0.05 * n)],
    p50: s[Math.floor(0.50 * n)],
    p95: s[Math.floor(0.95 * n)],
  };
}

const N = 5000;
console.log('═══ Test v2 sampler: AUDP zone vs Nacional ═══\n');

for (const family of ['edif_4p', 'casa', 'townhouse']) {
  console.log(`━━━ ${family} ━━━`);
  for (const zone of ['audp_zone', 'nacional']) {
    const sampler = MacroFactor.createV2(family, { nu: 4, zone: zone });
    const rng = mulberry32(42);
    const draws = sampler.sample(N, rng);
    const precio = draws.map(d => d.precio_yoy);
    const vel = draws.map(d => d.velocidad_yoy);
    const costo = draws.map(d => d.costo_yoy);
    const ps = stats(precio);
    const vs = stats(vel);
    const cs = stats(costo);
    console.log(`  ${zone}:`);
    console.log(`    Precio: mean=${ps.mean.toFixed(2)}pp, P5=${ps.p5.toFixed(2)}, P95=${ps.p95.toFixed(2)}`);
    console.log(`    Velocidad: mean=${vs.mean.toFixed(2)}pp, P5=${vs.p5.toFixed(2)}, P95=${vs.p95.toFixed(2)}`);
    console.log(`    Costo: mean=${cs.mean.toFixed(2)}pp, P5=${cs.p5.toFixed(2)}, P95=${cs.p95.toFixed(2)}`);
  }
  console.log();
}
console.log('═══ FIN ═══');
