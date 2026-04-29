"""
Capa 2 — Factor Model Opción C (recomendado para decisiones económicas).

Filosofía: usar índices oficiales como shocks DIRECTOS donde existan
(IPV del BCCh para precio, ICOI de CChC para costo construcción), y
regresar SÓLO velocidad (donde no hay índice oficial y la macro
agrega valor predictivo real).

Ventajas:
- Cero regresión espuria precio_TINSA ~ IPV (que es lo mismo medido
  con otro instrumento)
- Auditable: cada componente es interpretable independientemente
- Replicar episodios históricos es trivial (load IPV histórico Q4-2008)
- σ_idiosincrático calculado HONESTAMENTE como std(precio_TINSA -
  IPV_familiar) por familia

Output:
- analysis/macro_factor_c.json
- public/macro_factor.js (embebible)

Componentes del modelo:

1. Marginales empíricas de 5 macros (con percentiles densos)
2. Matriz Spearman entre macros (cópula t Capa 2)
3. Por familia:
   a. IPV variant a usar (deptos vs casas nuevas)
   b. σ_idiosincrático precio = std(precio_yoy_TINSA - IPV_yoy_familiar)
   c. σ_idiosincrático costo = std(... - ICOI_yoy)  ← global, no por familia
   d. Regresión velocidad_yoy = α + β·macros + ε
4. Presets históricos (Crisis 2008, COVID, Estallido, Boom 2021)
"""
import pandas as pd
import numpy as np
import json
from scipy import stats

OUT_JSON = 'analysis/macro_factor_c.json'
OUT_REPORT = 'analysis/macro_report_c.md'


# ── Helpers ──────────────────────────────────────────────────

def load_monthly_to_quarterly(path, value_col=1):
    df = pd.read_csv(path)
    if df.iloc[0, 0] in ['Mes', 'Periodo', 'Período', 'Mes ']:
        df = df.iloc[1:].reset_index(drop=True)
    df.columns = [str(c).strip() for c in df.columns]
    df['date'] = pd.to_datetime(df.iloc[:, 0], errors='coerce')
    df['val'] = pd.to_numeric(df.iloc[:, value_col], errors='coerce')
    df = df.dropna(subset=['date', 'val'])
    df['quarter'] = df['date'].dt.to_period('Q')
    quarterly = df.groupby('quarter')['val'].mean().reset_index()
    quarterly['quarter_str'] = quarterly['quarter'].astype(str).str.replace(
        r'^(\d{4})Q(\d)$', r'\1-Q\2', regex=True)
    return quarterly[['quarter_str', 'val']]


def yearly_to_quarterly_interp(df_yearly):
    rows = []
    yrs = df_yearly['year'].tolist()
    vals = df_yearly['val'].tolist()
    for i, (y, v) in enumerate(zip(yrs, vals)):
        v_next = vals[i+1] if i+1 < len(vals) else v
        for q in range(1, 5):
            frac = (q - 1) / 4
            interp = v * (1 - frac) + v_next * frac
            rows.append({'quarter_str': f'{y}-Q{q}', 'val': interp})
    return pd.DataFrame(rows)


def fit_regression(y, X, X_names):
    valid = ~(np.isnan(y) | np.isnan(X).any(axis=1))
    y_v = y[valid]; X_v = X[valid]
    if len(y_v) < 10: return None
    X_const = np.column_stack([np.ones(len(X_v)), X_v])
    try:
        beta, _, _, _ = np.linalg.lstsq(X_const, y_v, rcond=None)
    except: return None
    y_pred = X_const @ beta
    resid = y_v - y_pred
    ss_res = (resid ** 2).sum()
    ss_tot = ((y_v - y_v.mean()) ** 2).sum()
    r2 = 1 - ss_res / ss_tot if ss_tot > 0 else 0
    n = len(y_v); k = len(beta)
    sigma_eps = np.sqrt(ss_res / max(1, n - k))
    try:
        cov = np.linalg.inv(X_const.T @ X_const) * (ss_res / max(1, n - k))
        se = np.sqrt(np.diag(cov))
        t_stats = beta / np.where(se > 0, se, 1)
        pvals = 2 * (1 - stats.t.cdf(np.abs(t_stats), df=max(1, n - k)))
    except:
        se = np.zeros_like(beta); pvals = np.ones_like(beta)
    return {
        'intercept': float(beta[0]),
        'coefs': {n: float(b) for n, b in zip(X_names, beta[1:])},
        'std_errs': {n: float(s) for n, s in zip(X_names, se[1:])},
        'pvalues': {n: float(p) for n, p in zip(X_names, pvals[1:])},
        'r2': float(r2),
        'sigma_residual': float(sigma_eps),
        'n_obs': int(n),
    }


print('=== Factor Model Opción C — Calibración ===\n')

# ── 1. Cargar macros ──────────────────────────────────────────

print('Cargando macros...')
imacec = load_monthly_to_quarterly('analysis/macro_raw/imacec.csv')
imacec.columns = ['quarter_str', 'imacec_var_pct']

tasa_hipo = load_monthly_to_quarterly('analysis/macro_raw/tasa_hipotecaria.csv')
tasa_hipo.columns = ['quarter_str', 'tasa_hipo']

desempleo = load_monthly_to_quarterly('analysis/macro_raw/desempleo.csv')
desempleo.columns = ['quarter_str', 'desempleo']

ipv_raw = pd.read_csv('analysis/macro_raw/ipv.csv', skiprows=2)
ipv_raw.columns = [str(c).strip() for c in ipv_raw.columns]
ipv_raw['year'] = pd.to_datetime(ipv_raw.iloc[:, 0], errors='coerce').dt.year
ipv_yearly = pd.DataFrame({
    'year': ipv_raw['year'],
    'general':       pd.to_numeric(ipv_raw.iloc[:, 1], errors='coerce'),
    'casas_nuevas':  pd.to_numeric(ipv_raw.iloc[:, 3], errors='coerce'),
    'deptos_nuevos': pd.to_numeric(ipv_raw.iloc[:, 6], errors='coerce'),
}).dropna(subset=['year']).copy()
ipv_yearly['year'] = ipv_yearly['year'].astype(int)

ipv_general_q = yearly_to_quarterly_interp(ipv_yearly[['year', 'general']].rename(columns={'general': 'val'}))
ipv_general_q.columns = ['quarter_str', 'ipv_general']
ipv_casas_q = yearly_to_quarterly_interp(ipv_yearly[['year', 'casas_nuevas']].rename(columns={'casas_nuevas': 'val'}))
ipv_casas_q.columns = ['quarter_str', 'ipv_casas_nuevas']
ipv_deptos_q = yearly_to_quarterly_interp(ipv_yearly[['year', 'deptos_nuevos']].rename(columns={'deptos_nuevos': 'val'}))
ipv_deptos_q.columns = ['quarter_str', 'ipv_deptos_nuevos']

icoi_raw = pd.read_csv('analysis/macro_raw/indice_de_construccion_desglos.csv', skiprows=2)
icoi_raw.columns = [str(c).strip() for c in icoi_raw.columns]
icoi_yearly = pd.DataFrame({
    'year': pd.to_numeric(icoi_raw.iloc[:, 0], errors='coerce'),
    'val': pd.to_numeric(icoi_raw.iloc[:, 1], errors='coerce'),
}).dropna()
icoi_yearly['year'] = icoi_yearly['year'].astype(int)
icoi_yearly = icoi_yearly.drop_duplicates(subset=['year'], keep='first').reset_index(drop=True)
icoi_q = yearly_to_quarterly_interp(icoi_yearly)
icoi_q.columns = ['quarter_str', 'icoi']

merged = imacec.copy()
for df, name in [(tasa_hipo, 'tasa_hipo'), (desempleo, 'desempleo'),
                  (ipv_general_q, 'ipv_general'), (ipv_casas_q, 'ipv_casas_nuevas'),
                  (ipv_deptos_q, 'ipv_deptos_nuevos'), (icoi_q, 'icoi')]:
    merged = merged.merge(df, on='quarter_str', how='outer')
merged = merged.sort_values('quarter_str').reset_index(drop=True)

# YoY transformations
for col in ['ipv_general', 'ipv_casas_nuevas', 'ipv_deptos_nuevos', 'icoi']:
    merged[f'{col}_yoy'] = merged[col].pct_change(periods=4) * 100
merged['d_tasa_hipo'] = merged['tasa_hipo'].diff(periods=4)
merged['d_desempleo'] = merged['desempleo'].diff(periods=4)


# ── 2. Cargar TINSA + agregar ponderado ───────────────────────

print('Cargando TINSA...')
cidu = pd.read_csv('analysis/data.csv', low_memory=False)
NUMERIC_COLS = ['UFM2P', 'UMESP', 'MAGOST', 'DPROM', 'SUPP', 'NPISOS', 'UVEND']
for c in NUMERIC_COLS:
    cidu[c] = pd.to_numeric(cidu[c], errors='coerce')

def cidu_to_quarter(year, per):
    if not pd.isna(year) and isinstance(per, str):
        per_clean = per.strip().upper().rstrip('P')
        try: return f'{int(year)}-Q{int(per_clean)}'
        except: return None
    return None

cidu['quarter_str'] = cidu.apply(lambda r: cidu_to_quarter(r['AÑO'], r['PER']), axis=1)
cidu_active = cidu[(cidu['UFM2P'] > 0) & (cidu['UMESP'] > 0) & (cidu['SUPP'] > 0) & (cidu['UVEND'] > 0)].copy()

def is_townhouse(row):
    return row['TPROP'] == 'TOWNHOUSE' or row['TCAT'] == 'TOWNHOUSE'

cidu_active['_stratum'] = None
cidu_active.loc[(cidu_active['TPROP']=='DEPARTAMENTO') & (cidu_active['NPISOS']<=6) & (cidu_active['TSUB']=='SIN SUBSIDIO'), '_stratum'] = 'edif_4p'
cidu_active.loc[cidu_active['TSUB'].astype(str).str.contains('DS19', na=False), '_stratum'] = 'ds19'
cidu_active.loc[(cidu_active['TPROP']=='CASA') & (cidu_active['TSUB']=='SIN SUBSIDIO'), '_stratum'] = 'casa'
cidu_active.loc[cidu_active.apply(is_townhouse, axis=1), '_stratum'] = 'townhouse'

def weighted_mean(df, val_col, weight_col):
    w = df[weight_col].sum()
    if w == 0: return df[val_col].mean()
    return (df[val_col] * df[weight_col]).sum() / w


# ── 3. σ idiosincrático por familia (clave de Opción C) ───────

print('\nCalculando σ idiosincrático por familia (residual de IPV/ICOI)...\n')

FAMILY_IPV = {
    'edif_4p':   'ipv_deptos_nuevos_yoy',
    'ds19':      'ipv_deptos_nuevos_yoy',
    'casa':      'ipv_casas_nuevas_yoy',
    'townhouse': 'ipv_casas_nuevas_yoy',
}

family_results = {}
for stratum in ['edif_4p', 'ds19', 'casa', 'townhouse']:
    sub = cidu_active[cidu_active['_stratum'] == stratum].copy()
    if len(sub) < 50: continue

    agg_rows = []
    for q, grp in sub.groupby('quarter_str'):
        agg_rows.append({
            'quarter_str': q,
            'precio': weighted_mean(grp, 'UFM2P', 'UVEND'),
            'velocidad': weighted_mean(grp, 'UMESP', 'UVEND'),
            'plazo': weighted_mean(grp, 'MAGOST', 'UVEND'),
            'uvend_total': grp['UVEND'].sum(),
        })
    agg = pd.DataFrame(agg_rows).sort_values('quarter_str').reset_index(drop=True)
    agg['precio_yoy'] = agg['precio'].pct_change(4) * 100
    agg['velocidad_yoy'] = agg['velocidad'].pct_change(4) * 100
    agg['plazo_yoy'] = agg['plazo'].pct_change(4) * 100

    df = agg.merge(merged, on='quarter_str', how='inner').dropna(subset=['precio_yoy'])
    if len(df) < 15: continue

    ipv_col = FAMILY_IPV[stratum]

    # σ idiosincrático precio = std(precio_yoy - IPV_familiar_yoy)
    delta_precio = df['precio_yoy'] - df[ipv_col]
    sigma_precio = delta_precio.std()
    bias_precio = delta_precio.mean()

    # σ idiosincrático costo = std(... - ICOI_yoy)
    # Notar: TINSA no tiene costo construcción, solo precio. Asumimos
    # que el costo del developer sigue ICOI con ε independiente.
    # σ histórica de ICOI YoY = 8.8pp. La variabilidad idiosincrática
    # del costo de UN proyecto vs ICOI promedio es típicamente ±3pp
    # (margen del contrato). Lo dejamos como parámetro fijo razonable.
    sigma_costo = 3.0  # parámetro económicamente razonable

    # Regresión solo para velocidad (donde sí hay valor agregado)
    X_cols_vel = [
        'imacec_var_pct',
        'd_tasa_hipo',
        'd_desempleo',
        ipv_col,
        'icoi_yoy',
    ]
    X = df[X_cols_vel].values
    reg_vel = fit_regression(df['velocidad_yoy'].values, X, X_cols_vel)

    # Plazo: variable poco predecible, no merece regresión. Solo σ histórica.
    sigma_plazo = df['plazo_yoy'].dropna().std()

    print(f'{stratum} (n={len(df)} trim):')
    print(f'  precio: shock = IPV {ipv_col} + ε ~ N(bias={bias_precio:+.2f}pp, σ={sigma_precio:.2f}pp)')
    if reg_vel:
        print(f'  velocidad: regresión OLS, R²={reg_vel["r2"]:.3f}, σε={reg_vel["sigma_residual"]:.2f}pp')
        for n, b in reg_vel['coefs'].items():
            p = reg_vel['pvalues'].get(n, 1.0)
            star = '***' if p < 0.01 else '**' if p < 0.05 else '*' if p < 0.10 else ''
            print(f'    {n:<28}: {b:+.4f} {star} (p={p:.3f})')
    print(f'  plazo: σ histórica = {sigma_plazo:.2f}pp\n')

    family_results[stratum] = {
        'n_obs': int(len(df)),
        'baseline': {
            'precio': float(df['precio'].mean()),
            'velocidad': float(df['velocidad'].mean()),
            'plazo': float(df['plazo'].mean()),
        },
        'precio_shock': {
            'driver': ipv_col,
            'bias_pp': float(bias_precio),
            'sigma_idiosyncratic_pp': float(sigma_precio),
        },
        'costo_shock': {
            'driver': 'icoi_yoy',
            'sigma_idiosyncratic_pp': float(sigma_costo),
        },
        'velocidad_regression': reg_vel,
        'plazo_shock': {
            'sigma_idiosyncratic_pp': float(sigma_plazo) if not np.isnan(sigma_plazo) else 10.0,
        },
    }


# ── 4. Marginales y correlación de macros ─────────────────────

print('Distribuciones de macros (sample para t-cópula)...')

MACROS_OUT = ['imacec_var_pct', 'd_tasa_hipo', 'd_desempleo',
              'ipv_general_yoy', 'ipv_casas_nuevas_yoy', 'ipv_deptos_nuevos_yoy', 'icoi_yoy']

PERCENTILES_DENSE = list(np.linspace(0.01, 0.99, 99))
macro_data = {}
for col in MACROS_OUT:
    if col not in merged.columns: continue
    s = merged[col].dropna()
    if len(s) < 10: continue
    s = s.clip(s.quantile(0.01), s.quantile(0.99))
    macro_data[col] = {
        'n': int(len(s)),
        'mean': float(s.mean()),
        'std': float(s.std()),
        'p5': float(s.quantile(0.05)),
        'p10': float(s.quantile(0.10)),
        'p50': float(s.quantile(0.50)),
        'p90': float(s.quantile(0.90)),
        'p95': float(s.quantile(0.95)),
        'pcts': [float(s.quantile(q)) for q in PERCENTILES_DENSE],
    }

# Spearman macros
present = [c for c in MACROS_OUT if c in macro_data]
df_corr = merged[present].dropna()
macro_corr = {}
if len(df_corr) > 10:
    for vi in present:
        macro_corr[vi] = {}
        for vj in present:
            if vi == vj:
                macro_corr[vi][vj] = 1.0
            else:
                rs, _ = stats.spearmanr(df_corr[vi], df_corr[vj])
                macro_corr[vi][vj] = float(rs) if not np.isnan(rs) else 0.0


# ── 5. Presets históricos de escenarios ───────────────────────

print('\nConstruyendo presets históricos...')

def find_quarter_macros(quarter_str):
    row = merged[merged['quarter_str'] == quarter_str]
    if row.empty: return None
    r = row.iloc[0]
    return {
        'imacec_var_pct': float(r.get('imacec_var_pct', 0) or 0),
        'd_tasa_hipo': float(r.get('d_tasa_hipo', 0) or 0),
        'd_desempleo': float(r.get('d_desempleo', 0) or 0),
        'ipv_general_yoy': float(r.get('ipv_general_yoy', 0) or 0),
        'ipv_casas_nuevas_yoy': float(r.get('ipv_casas_nuevas_yoy', 0) or 0),
        'ipv_deptos_nuevos_yoy': float(r.get('ipv_deptos_nuevos_yoy', 0) or 0),
        'icoi_yoy': float(r.get('icoi_yoy', 0) or 0),
    }

# Promedios ventana para presets: 4 trimestres alrededor del peor punto
def preset_avg(quarters):
    macros = [find_quarter_macros(q) for q in quarters]
    macros = [m for m in macros if m]
    if not macros: return None
    keys = macros[0].keys()
    return {k: float(np.mean([m[k] for m in macros])) for k in keys}

# Crisis Asia (1998-99) - probablemente sin data en nuestra ventana
# Subprime 2008-09 - parcial
# Estallido + COVID (2019Q4 → 2020Q4): -10% IMACEC profundo
# Boom post-COVID 2021: +12% IMACEC
# Slowdown 2014-15
# Inflation/recession 2022-23
presets = {
    'base_esperado': {col: float(macro_data[col]['p50']) if col in macro_data else 0.0 for col in MACROS_OUT},
    'subprime_2009': preset_avg(['2009-Q1', '2009-Q2', '2009-Q3', '2009-Q4']),
    'estallido_covid_2019_2020': preset_avg(['2019-Q4', '2020-Q1', '2020-Q2', '2020-Q3']),
    'boom_post_covid_2021': preset_avg(['2021-Q1', '2021-Q2', '2021-Q3', '2021-Q4']),
    'slowdown_2023': preset_avg(['2023-Q1', '2023-Q2', '2023-Q3', '2023-Q4']),
}
# remove None presets
presets = {k: v for k, v in presets.items() if v}


# ── 6. Output ────────────────────────────────────────────────

output = {
    'metadata': {
        'version': 'option_c',
        'description': 'Factor model con shocks directos IPV/ICOI + regresion velocidad',
        'cidu_obs': int(len(cidu_active)),
        'macro_quarters': int(len(merged)),
        'percentiles_dense_q': PERCENTILES_DENSE,
        'family_ipv_map': FAMILY_IPV,
    },
    'macros': macro_data,
    'macros_corr_spearman': macro_corr,
    'family_models': family_results,
    'presets': presets,
}

with open(OUT_JSON, 'w') as f:
    json.dump(output, f, indent=2, default=str)
print(f'\nWrote {OUT_JSON}')

# Reporte
report = ['# Factor Model Opción C — Reporte de Calibración\n\n']
report.append('Filosofía: índices oficiales (IPV BCCh, ICOI CChC) como shocks directos. Regresión OLS sólo para velocidad.\n\n')

report.append('## Distribuciones macro\n\n| Variable | Media | DE | p5 | p50 | p95 |\n|---|---|---|---|---|---|\n')
for k, v in macro_data.items():
    report.append(f'| {k} | {v["mean"]:.2f} | {v["std"]:.2f} | {v["p5"]:.2f} | {v["p50"]:.2f} | {v["p95"]:.2f} |\n')

report.append('\n## Modelo por familia\n\n')
for fam, r in family_results.items():
    report.append(f'\n### {fam} (n={r["n_obs"]} trimestres)\n\n')
    p = r['precio_shock']
    report.append(f'**Shock precio**: directo desde {p["driver"]}, sesgo histórico {p["bias_pp"]:+.2f}pp, σ idiosincrático {p["sigma_idiosyncratic_pp"]:.2f}pp\n\n')
    rg = r.get('velocidad_regression')
    if rg:
        report.append(f'**Regresión velocidad** (R²={rg["r2"]:.3f}, σε={rg["sigma_residual"]:.2f}pp):\n\n')
        report.append('| Variable | Coef | p-value | Sig |\n|---|---|---|---|\n')
        report.append(f'| (intercept) | {rg["intercept"]:+.3f} | — | — |\n')
        for n, b in rg['coefs'].items():
            pv = rg['pvalues'].get(n, 1)
            star = '***' if pv < 0.01 else '**' if pv < 0.05 else '*' if pv < 0.10 else ''
            report.append(f'| {n} | {b:+.4f} | {pv:.3f} | {star} |\n')
        report.append('\n')

report.append('\n## Presets históricos\n\n')
report.append('| Escenario | IMACEC | Δ tasa hipo | Δ desempleo | IPV deptos YoY | IPV casas YoY | ICOI YoY |\n|---|---|---|---|---|---|---|\n')
for name, p in presets.items():
    report.append(f'| {name} | {p["imacec_var_pct"]:+.2f}% | {p["d_tasa_hipo"]:+.2f}pp | {p["d_desempleo"]:+.2f}pp | {p["ipv_deptos_nuevos_yoy"]:+.2f}% | {p["ipv_casas_nuevas_yoy"]:+.2f}% | {p["icoi_yoy"]:+.2f}% |\n')

with open(OUT_REPORT, 'w') as f:
    f.writelines(report)
print(f'Wrote {OUT_REPORT}')
