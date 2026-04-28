// Test integrado: simula el ciclo completo factor → sensibilidades → incidencia.
// Verifica que distintos presets produzcan distintas incidencias finales.

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ctx = vm.createContext({ window: {}, console: console });
vm.runInContext(fs.readFileSync(path.join(__dirname, '../public/market_stats.js'), 'utf8'), ctx);
vm.runInContext(fs.readFileSync(path.join(__dirname, '../public/market_copula.js'), 'utf8'), ctx);
vm.runInContext(fs.readFileSync(path.join(__dirname, '../public/macro_factor_c.js'), 'utf8'), ctx);
vm.runInContext(fs.readFileSync(path.join(__dirname, '../public/macro_factor.js'), 'utf8'), ctx);

const { MacroFactor } = ctx.window;

// Sensibilidades default (mismo set que en legacy)
const DEFAULT_SENS = {
  edif_4p:   { ticket: 0.70, velocidad: 0.10, costo: -0.50, plazo: -0.15 },
  ds19:      { ticket: 0.45, velocidad: 0.05, costo: -0.35, plazo: -0.10 },
  casa:      { ticket: 0.65, velocidad: 0.08, costo: -0.45, plazo: -0.12 },
  townhouse: { ticket: 0.65, velocidad: 0.08, costo: -0.45, plazo: -0.12 },
};

const BASELINE_INCIDENCIA = { edif_4p: 0.14, ds19: 0.12, casa: 0.10, townhouse: 0.10 };

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

const N = 3000;
const PRESETS = MacroFactor.listPresets();

console.log('═══ Test integrado: factor → sensibilidades → Δincidencia ═══\n');
console.log('Sensibilidades default usadas (cuando representantes no las traen):');
for (const [fam, s] of Object.entries(DEFAULT_SENS)) {
  console.log('  ' + fam + ': ticket=' + s.ticket + ', vel=' + s.velocidad + ', costo=' + s.costo + ', plazo=' + s.plazo);
}
console.log();

const family = 'edif_4p';  // analizamos edif_4p como representativo
const sens = DEFAULT_SENS[family];
const baseInc = BASELINE_INCIDENCIA[family];

console.log('━━━ Familia: ' + family + ', baseline incidencia = ' + (baseInc * 100).toFixed(1) + '% ━━━\n');

for (const preset of PRESETS) {
  const sampler = MacroFactor.create(family, { nu: 4, preset: preset });
  const rng = mulberry32(42);
  const incs = [];
  const tms = [];
  const vels = [];
  const costos = [];

  for (let i = 0; i < N; i++) {
    const draw = sampler.sampleOne(rng);
    const tm = Math.max(0.5, Math.min(2.0, 1 + draw.precio_yoy / 100));
    const vel = Math.max(-80, Math.min(150, draw.velocidad_yoy));
    const costoMult = Math.max(0.6, Math.min(1.5, 1 + draw.costo_yoy / 100));
    const plazoMult = Math.max(0.5, Math.min(2.0, 1 + draw.plazo_yoy / 100));

    // Δincidencia linealizado (mismo cálculo que en _applyResidualShocks)
    const fTicket = tm - 1;
    const fVel = vel / 100;
    const fCosto = costoMult - 1;
    const fPlazo = plazoMult - 1;
    const dInc = sens.ticket * fTicket + sens.velocidad * fVel + sens.costo * fCosto + sens.plazo * fPlazo;
    const newInc = Math.max(0.01, Math.min(0.50, baseInc + dInc));

    incs.push(newInc);
    tms.push(tm);
    vels.push(vel);
    costos.push(costoMult);
  }

  const incStats = stats(incs);
  const tmStats = stats(tms);
  const velStats = stats(vels);
  const costoStats = stats(costos);

  console.log('Preset: ' + preset);
  console.log('  Incidencia: mean=' + (incStats.mean*100).toFixed(2) + '%, P5=' + (incStats.p5*100).toFixed(2) + '%, P50=' + (incStats.p50*100).toFixed(2) + '%, P95=' + (incStats.p95*100).toFixed(2) + '%');
  console.log('  tm (precio): mean=' + tmStats.mean.toFixed(3) + ', range [' + tmStats.p5.toFixed(3) + ', ' + tmStats.p95.toFixed(3) + ']');
  console.log('  vel (%): mean=' + velStats.mean.toFixed(1) + ', range [' + velStats.p5.toFixed(1) + ', ' + velStats.p95.toFixed(1) + ']');
  console.log('  costoMult: mean=' + costoStats.mean.toFixed(3) + ', range [' + costoStats.p5.toFixed(3) + ', ' + costoStats.p95.toFixed(3) + ']');
  console.log();
}

// Compute differences
console.log('━━━ Diferencias entre presets (efecto en incidencia) ━━━\n');
const baseRng = mulberry32(42);
const baseDraws = [];
for (let i = 0; i < N; i++) {
  const sampler = MacroFactor.create(family, { nu: 4, preset: 'base_esperado' });
  const rng = mulberry32(42 + i * 1000);
  const draw = sampler.sampleOne(rng);
  baseDraws.push(draw);
}

for (const preset of PRESETS) {
  const sampler = MacroFactor.create(family, { nu: 4, preset: preset });
  const rng = mulberry32(42);
  const incs = [];
  for (let i = 0; i < N; i++) {
    const draw = sampler.sampleOne(rng);
    const tm = 1 + draw.precio_yoy / 100;
    const vel = draw.velocidad_yoy;
    const costoMult = 1 + draw.costo_yoy / 100;
    const plazoMult = 1 + draw.plazo_yoy / 100;
    const dInc = sens.ticket * (tm-1) + sens.velocidad * (vel/100) + sens.costo * (costoMult-1) + sens.plazo * (plazoMult-1);
    incs.push(baseInc + dInc);
  }
  const m = incs.reduce((a,b)=>a+b,0)/N;
  const baseM = baseInc;
  const delta = (m - baseM) * 100;  // pp
  const sign = delta >= 0 ? '+' : '';
  console.log('  ' + preset.padEnd(30) + ': Δincidencia ' + sign + delta.toFixed(2) + 'pp vs baseline');
}
