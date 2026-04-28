// Test independiente del Factor Model: ¿produce distribuciones distintas
// para distintos presets? Si no lo hace, hay un bug.
//
// Ejecuta el módulo MacroFactor con cada preset, samplea N draws, y compara
// las distribuciones de precio_yoy/velocidad_yoy/costo_yoy.

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ctx = vm.createContext({ window: {}, console: console });
vm.runInContext(fs.readFileSync(path.join(__dirname, '../public/market_stats.js'), 'utf8'), ctx);
vm.runInContext(fs.readFileSync(path.join(__dirname, '../public/market_copula.js'), 'utf8'), ctx);
vm.runInContext(fs.readFileSync(path.join(__dirname, '../public/macro_factor_c.js'), 'utf8'), ctx);
vm.runInContext(fs.readFileSync(path.join(__dirname, '../public/macro_factor.js'), 'utf8'), ctx);

const { MarketCopula, MacroFactor, MACRO_FACTOR_C, MARKET_STATS } = ctx.window;

if (!MacroFactor || !MACRO_FACTOR_C) {
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
  const std = Math.sqrt(arr.reduce((a, b) => a + (b - mean) ** 2, 0) / (n - 1));
  return {
    mean,
    std,
    p5: s[Math.floor(0.05 * n)],
    p50: s[Math.floor(0.50 * n)],
    p95: s[Math.floor(0.95 * n)],
  };
}

const N = 5000;
const FAMILIES = ['edif_4p', 'ds19', 'casa', 'townhouse'];
const PRESETS = MacroFactor.listPresets();

console.log('═══ Test Factor Macro: ¿los presets producen distribuciones distintas? ═══\n');
console.log('Presets disponibles:', PRESETS.join(', '));
console.log('Familias:', FAMILIES.join(', '));
console.log('N draws por (familia × preset):', N);
console.log();

for (const fam of FAMILIES) {
  console.log('━━━ ' + fam + ' ━━━');
  const results = {};
  for (const preset of PRESETS) {
    const sampler = MacroFactor.create(fam, { nu: 4, preset: preset });
    const rng = mulberry32(42);
    const draws = sampler.sample(N, rng);
    const precio = draws.map(d => d.precio_yoy);
    const velocidad = draws.map(d => d.velocidad_yoy);
    const costo = draws.map(d => d.costo_yoy);
    const plazo = draws.map(d => d.plazo_yoy);
    results[preset] = {
      precio: stats(precio),
      velocidad: stats(velocidad),
      costo: stats(costo),
      plazo: stats(plazo),
      // Macro samples
      ipv: stats(draws.map(d => d.macros[sampler.ipvCol])),
      icoi: stats(draws.map(d => d.macros['icoi_yoy'])),
      imacec: stats(draws.map(d => d.macros['imacec_var_pct'])),
    };
  }

  // Compute differences between presets
  console.log('  Mean precio_yoy por preset:');
  for (const p of PRESETS) {
    console.log('    ' + p.padEnd(28) + ': ' + results[p].precio.mean.toFixed(2) + 'pp (P5=' + results[p].precio.p5.toFixed(1) + ', P95=' + results[p].precio.p95.toFixed(1) + ')');
  }
  console.log('  Mean costo_yoy por preset:');
  for (const p of PRESETS) {
    console.log('    ' + p.padEnd(28) + ': ' + results[p].costo.mean.toFixed(2) + 'pp');
  }
  console.log('  Mean velocidad_yoy por preset:');
  for (const p of PRESETS) {
    console.log('    ' + p.padEnd(28) + ': ' + results[p].velocidad.mean.toFixed(2) + 'pp');
  }
  console.log('  Mean macros sampleados (IPV / ICOI / IMACEC):');
  for (const p of PRESETS) {
    console.log('    ' + p.padEnd(28) + ': ' + results[p].ipv.mean.toFixed(2) + ' / ' + results[p].icoi.mean.toFixed(2) + ' / ' + results[p].imacec.mean.toFixed(2));
  }

  // Test: ¿hay diferencia significativa entre Boom y COVID?
  const boom = results['boom_post_covid_2021'];
  const covid = results['estallido_covid_2019_2020'];
  const diffPrecio = boom.precio.mean - covid.precio.mean;
  const pooledStd = Math.sqrt((boom.precio.std ** 2 + covid.precio.std ** 2) / 2);
  const cohenD = diffPrecio / pooledStd;

  console.log('\n  Test Boom vs COVID: diff precio_yoy = ' + diffPrecio.toFixed(2) + 'pp, Cohen d = ' + cohenD.toFixed(2));
  console.log('    ' + (Math.abs(cohenD) > 0.2 ? '✓ Diferencia detectable (d > 0.2)' : '✗ Diferencia INSIGNIFICANTE (d < 0.2)'));
  console.log();
}

console.log('═══ FIN ═══');
