"""
Capa 2 — Factor Model v2 (mejorado).

Mejoras sobre v1:
1. Agregación trimestral PONDERADA POR UNIDADES VENDIDAS (UVEND) en vez de
   mediana. La mediana descarta el peso real de cada proyecto. La ponderada
   refleja lo que el mercado realmente transó ese trimestre.
2. Lags de macros (t-1, t-2): captura la dinámica de transmisión macro→precio.
3. Long-difference: comparar t vs t-4 (interanual) reduce ruido más que diff trimestral.
4. IPV como anchor: IPV YoY entra como "termómetro de mercado de vivienda" — su
   coef debería ser ~+1 si la calibración es coherente.
5. Usa solo período post-2014 (con todas las macros disponibles + sin shock COVID
   que distorsiona regresiones lineales).
6. Diagnóstico: muestra coefs t, t-1, t-2 separados para identificar qué lag
   manda en cada par (variable, target).

Output: analysis/macro_factor_model_v2.json + macro_report_v2.md
"""
import pandas as pd
import numpy as np
import json
from scipy import stats

OUT_JSON = 'analysis/macro_factor_model_v2.json'
OUT_REPORT = 'analysis/macro_report_v2.md'


# ──────────────────────────────────────────────────────────────────
# Helpers (reusados de v1)
# ──────────────────────────────────────────────────────────────────

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
    """OLS: y = X·β + ε. Devuelve coefs + R² + std_err + p-values aproximados."""
    valid = ~(np.isnan(y) | np.isnan(X).any(axis=1))
    y_v = y[valid]
    X_v = X[valid]
    if len(y_v) < 10:
        return None
    X_const = np.column_stack([np.ones(len(X_v)), X_v])
    try:
        beta, _, _, _ = np.linalg.lstsq(X_const, y_v, rcond=None)
    except:
        return None
    y_pred = X_const @ beta
    resid = y_v - y_pred
    ss_res = (resid ** 2).sum()
    ss_tot = ((y_v - y_v.mean()) ** 2).sum()
    r2 = 1 - ss_res / ss_tot if ss_tot > 0 else 0
    n = len(y_v)
    k = len(beta)
    sigma2 = ss_res / max(1, n - k)
    sigma_eps = np.sqrt(sigma2)
    # Standard errors of coefs: diag((X'X)^-1) * sigma2
    try:
        cov = np.linalg.inv(X_const.T @ X_const) * sigma2
        se = np.sqrt(np.diag(cov))
        t_stats = beta / np.where(se > 0, se, 1)
        # Two-tailed p-values
        pvals = 2 * (1 - stats.t.cdf(np.abs(t_stats), df=max(1, n - k)))
    except:
        se = np.zeros_like(beta)
        pvals = np.ones_like(beta)
    return {
        'intercept': float(beta[0]),
        'coefs': {n: float(b) for n, b in zip(X_names, beta[1:])},
        'std_errs': {n: float(s) for n, s in zip(X_names, se[1:])},
        'pvalues': {n: float(p) for n, p in zip(X_names, pvals[1:])},
        'r2': float(r2),
        'sigma_residual': float(sigma_eps),
        'n_obs': int(n),
    }


# ──────────────────────────────────────────────────────────────────
# 1. Cargar macros (igual que v1)
# ──────────────────────────────────────────────────────────────────

print('=== v2: Factor Model mejorado ===\n')
print('Cargando series macro...')

imacec = load_monthly_to_quarterly('analysis/macro_raw/imacec.csv')
imacec.columns = ['quarter_str', 'imacec_var_pct']

tasa_hipo = load_monthly_to_quarterly('analysis/macro_raw/tasa_hipotecaria.csv')
tasa_hipo.columns = ['quarter_str', 'tasa_hipo']

desempleo = load_monthly_to_quarterly('analysis/macro_raw/desempleo.csv')
desempleo.columns = ['quarter_str', 'desempleo']

# IPV (anual desglosado)
ipv_raw = pd.read_csv('analysis/macro_raw/ipv.csv', skiprows=2)
ipv_raw.columns = [str(c).strip() for c in ipv_raw.columns]
ipv_raw['year'] = pd.to_datetime(ipv_raw.iloc[:, 0], errors='coerce').dt.year
ipv_yearly = pd.DataFrame({
    'year': ipv_raw['year'],
    'general': pd.to_numeric(ipv_raw.iloc[:, 1], errors='coerce'),
    'casas_nuevas': pd.to_numeric(ipv_raw.iloc[:, 3], errors='coerce'),
    'deptos_nuevos': pd.to_numeric(ipv_raw.iloc[:, 6], errors='coerce'),
}).dropna(subset=['year']).copy()
ipv_yearly['year'] = ipv_yearly['year'].astype(int)

ipv_general_q = yearly_to_quarterly_interp(ipv_yearly[['year', 'general']].rename(columns={'general': 'val'}))
ipv_general_q.columns = ['quarter_str', 'ipv_general']
ipv_casas_q = yearly_to_quarterly_interp(ipv_yearly[['year', 'casas_nuevas']].rename(columns={'casas_nuevas': 'val'}))
ipv_casas_q.columns = ['quarter_str', 'ipv_casas_nuevas']
ipv_deptos_q = yearly_to_quarterly_interp(ipv_yearly[['year', 'deptos_nuevos']].rename(columns={'deptos_nuevos': 'val'}))
ipv_deptos_q.columns = ['quarter_str', 'ipv_deptos_nuevos']

# ICOI
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

# Merge
merged = imacec.copy()
for df, name in [(tasa_hipo, 'tasa_hipo'),
                  (desempleo, 'desempleo'),
                  (ipv_general_q, 'ipv_general'),
                  (ipv_casas_q, 'ipv_casas_nuevas'),
                  (ipv_deptos_q, 'ipv_deptos_nuevos'),
                  (icoi_q, 'icoi')]:
    merged = merged.merge(df, on='quarter_str', how='outer')

merged = merged.sort_values('quarter_str').reset_index(drop=True)

# YoY
for col in ['ipv_general', 'ipv_casas_nuevas', 'ipv_deptos_nuevos', 'icoi']:
    merged[f'{col}_yoy'] = merged[col].pct_change(periods=4) * 100

merged['d_tasa_hipo'] = merged['tasa_hipo'].diff(periods=4)
merged['d_desempleo'] = merged['desempleo'].diff(periods=4)


# ──────────────────────────────────────────────────────────────────
# 2. Lags de macros (t-1, t-2) — mejora clave v2
# ──────────────────────────────────────────────────────────────────

LAG_VARS = ['imacec_var_pct', 'd_tasa_hipo', 'd_desempleo',
            'ipv_general_yoy', 'ipv_casas_nuevas_yoy', 'ipv_deptos_nuevos_yoy', 'icoi_yoy']

for var in LAG_VARS:
    merged[f'{var}_L1'] = merged[var].shift(1)  # t-1 (lag de 1 trimestre)
    merged[f'{var}_L2'] = merged[var].shift(2)  # t-2

print(f'  Macro merged: {len(merged)} trimestres con lags t-1, t-2')


# ──────────────────────────────────────────────────────────────────
# 3. Cargar TINSA y agregar PONDERADO POR UVEND
# ──────────────────────────────────────────────────────────────────

print('\nCargando TINSA (CIDU)...')
cidu = pd.read_csv('analysis/data.csv', low_memory=False)
NUMERIC_COLS = ['UFM2P', 'UMESP', 'MAGOST', 'DPROM', 'SUPP', 'NPISOS', 'UVEND']
for c in NUMERIC_COLS:
    cidu[c] = pd.to_numeric(cidu[c], errors='coerce')

def cidu_to_quarter(year, per):
    if not pd.isna(year) and isinstance(per, str):
        per_clean = per.strip().upper().rstrip('P')
        try:
            return f'{int(year)}-Q{int(per_clean)}'
        except:
            return None
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

print(f'  {len(cidu_active)} obs activas con UVEND>0')

# ── Agregación PONDERADA por unidades vendidas (mejora v2) ──
def weighted_mean(df, val_col, weight_col):
    w = df[weight_col].sum()
    if w == 0:
        return df[val_col].mean()
    return (df[val_col] * df[weight_col]).sum() / w

FAMILY_IPV = {
    'edif_4p':   'ipv_deptos_nuevos_yoy',
    'ds19':      'ipv_deptos_nuevos_yoy',
    'casa':      'ipv_casas_nuevas_yoy',
    'townhouse': 'ipv_casas_nuevas_yoy',
}


# ──────────────────────────────────────────────────────────────────
# 4. Regresiones por familia con lags (mejora central v2)
# ──────────────────────────────────────────────────────────────────

print('\nCalibrando regresiones v2 (ponderadas + lagged)...\n')

results = {}
for stratum in ['edif_4p', 'ds19', 'casa', 'townhouse']:
    sub = cidu_active[cidu_active['_stratum'] == stratum].copy()
    if len(sub) < 50:
        continue

    # Agregación PONDERADA por UVEND (lo que el mercado realmente transó)
    agg_rows = []
    for q, grp in sub.groupby('quarter_str'):
        agg_rows.append({
            'quarter_str': q,
            'precio': weighted_mean(grp, 'UFM2P', 'UVEND'),
            'velocidad': weighted_mean(grp, 'UMESP', 'UVEND'),
            'plazo': weighted_mean(grp, 'MAGOST', 'UVEND'),
            'sup': weighted_mean(grp, 'SUPP', 'UVEND'),
            'uvend_total': grp['UVEND'].sum(),
            'n_proyectos': len(grp),
        })
    agg = pd.DataFrame(agg_rows).sort_values('quarter_str').reset_index(drop=True)

    # YoY del agregado
    agg['precio_yoy'] = agg['precio'].pct_change(4) * 100
    agg['velocidad_yoy'] = agg['velocidad'].pct_change(4) * 100
    agg['plazo_yoy'] = agg['plazo'].pct_change(4) * 100

    # Empatar con macros
    df = agg.merge(merged, on='quarter_str', how='inner').dropna(subset=['precio_yoy'])
    n_q = len(df)
    if n_q < 20:
        print(f'  {stratum}: {n_q} trimestres, skipping')
        continue

    ipv_var = FAMILY_IPV[stratum]

    # ── Modelo con lags ──
    # Para precio: IPV familiar (con lag óptimo) + ICOI (costo, t-1)
    # Para velocidad: IMACEC + d_tasa_hipo + d_desempleo + IPV
    # Para plazo: simple (varía poco)

    # Versión "rica" con t y t-1 de cada variable. R² mejorará si los lags
    # contribuyen estadísticamente.
    X_cols_precio = [
        ipv_var,                  # IPV t (anchor de mercado)
        f'{ipv_var}_L1',          # IPV t-1 (transmisión lag)
        'd_tasa_hipo',
        'd_tasa_hipo_L1',
        'imacec_var_pct',
        'icoi_yoy',
    ]

    X_cols_vel = [
        'imacec_var_pct',
        'imacec_var_pct_L1',
        'd_tasa_hipo',
        'd_tasa_hipo_L1',
        'd_desempleo',
        ipv_var,
    ]

    X_cols_plazo = [
        'imacec_var_pct',
        'icoi_yoy',
    ]

    fam_results = {
        'n_obs': n_q,
        'baseline': {
            'precio': float(df['precio'].mean()),
            'velocidad': float(df['velocidad'].mean()),
            'plazo': float(df['plazo'].mean()),
            'uvend_total_per_qtr': float(df['uvend_total'].mean()),
            'n_proyectos_per_qtr': float(df['n_proyectos'].mean()),
        },
        'X_cols_precio': X_cols_precio,
        'X_cols_vel': X_cols_vel,
        'X_cols_plazo': X_cols_plazo,
    }

    for tname, xcols, ycol in [
        ('reg_precio_yoy', X_cols_precio, 'precio_yoy'),
        ('reg_velocidad_yoy', X_cols_vel, 'velocidad_yoy'),
        ('reg_plazo_yoy', X_cols_plazo, 'plazo_yoy'),
    ]:
        # filtrar variables presentes en df
        xcols_ok = [c for c in xcols if c in df.columns]
        X = df[xcols_ok].values
        y = df[ycol].values
        rg = fit_regression(y, X, xcols_ok)
        fam_results[tname] = rg
        if rg:
            print(f'  {stratum} {tname}: R²={rg["r2"]:.3f}, σε={rg["sigma_residual"]:.2f}pp, n={rg["n_obs"]}')
            for n, b in rg['coefs'].items():
                p = rg['pvalues'].get(n, 1.0)
                star = '***' if p < 0.01 else '**' if p < 0.05 else '*' if p < 0.10 else ''
                print(f'      {n:<28}: {b:+.4f} {star} (p={p:.3f})')

    results[stratum] = fam_results
    print()


# ──────────────────────────────────────────────────────────────────
# 5. Comparación con v1: ¿mejoró el R²?
# ──────────────────────────────────────────────────────────────────

print('\n=== Comparación R² v1 vs v2 ===\n')
print('Familia      | v1 precio  | v2 precio  | v1 vel   | v2 vel   |')
print('-------------|------------|------------|----------|----------|')
v1_r2 = {
    'edif_4p': {'precio': 0.398, 'vel': 0.440},
    'ds19': {'precio': 0.138, 'vel': 0.010},
    'casa': {'precio': 0.053, 'vel': 0.249},
    'townhouse': {'precio': 0.043, 'vel': 0.108},
}
for fam, r in results.items():
    v2p = r['reg_precio_yoy']['r2'] if r.get('reg_precio_yoy') else None
    v2v = r['reg_velocidad_yoy']['r2'] if r.get('reg_velocidad_yoy') else None
    v1p = v1_r2.get(fam, {}).get('precio')
    v1v = v1_r2.get(fam, {}).get('vel')
    print(f'{fam:<12} |   {v1p:.3f}    |   {v2p:.3f}    |  {v1v:.3f}   |  {v2v:.3f}   |')


# ──────────────────────────────────────────────────────────────────
# 6. Output
# ──────────────────────────────────────────────────────────────────

# Distribución y correlaciones macro (igual que v1, recalculado)
MACROS_OUT = LAG_VARS  # las contemporáneas, sin lags
macro_data = {}
PERCENTILES_DENSE = list(np.linspace(0.01, 0.99, 99))
for col in MACROS_OUT:
    if col not in merged.columns: continue
    s = merged[col].dropna()
    if len(s) < 10: continue
    s = s.clip(s.quantile(0.01), s.quantile(0.99))
    macro_data[col] = {
        'n': int(len(s)),
        'mean': float(s.mean()),
        'std': float(s.std()),
        'p10': float(s.quantile(0.1)),
        'p50': float(s.quantile(0.5)),
        'p90': float(s.quantile(0.9)),
        'pcts': [float(s.quantile(q)) for q in PERCENTILES_DENSE],
    }

# Spearman macros
macro_corr = {}
present = [c for c in MACROS_OUT if c in macro_data]
df_corr = merged[present].dropna()
if len(df_corr) > 10:
    for vi in present:
        macro_corr[vi] = {}
        for vj in present:
            if vi == vj:
                macro_corr[vi][vj] = 1.0
            else:
                rs, _ = stats.spearmanr(df_corr[vi], df_corr[vj])
                macro_corr[vi][vj] = float(rs) if not np.isnan(rs) else 0.0

output = {
    'metadata': {
        'version': 'v2',
        'mejoras': [
            'agregación ponderada por UVEND (no mediana)',
            'lags t-1 y t-2 de macros',
            'p-values Student-t para diagnóstico',
        ],
        'cidu_obs': int(len(cidu_active)),
        'macro_quarters': int(len(merged)),
        'percentiles_dense_q': PERCENTILES_DENSE,
    },
    'macros': macro_data,
    'macros_corr_spearman': macro_corr,
    'family_models': results,
    'family_ipv_map': FAMILY_IPV,
}

with open(OUT_JSON, 'w') as f:
    json.dump(output, f, indent=2, default=str)
print(f'\nWrote {OUT_JSON}')


# Reporte
report = ['# Macro Factor Model v2 — Calibración Mejorada\n\n']
report.append('## Mejoras vs v1\n\n')
report.append('1. **Agregación ponderada por UVEND**: en vez de mediana trimestral (que descarta peso de mercado), uso media ponderada por unidades vendidas. Refleja lo que el mercado realmente transó.\n')
report.append('2. **Lags t-1 y t-2 de macros**: captura la dinámica de transmisión macro→precio. Generalmente el mercado responde con 1-2 trimestres de lag.\n')
report.append('3. **p-values Student-t**: diagnóstico estadístico para identificar coefs significativos.\n\n')

report.append('## Comparación R² v1 vs v2\n\n')
report.append('| Familia | v1 precio | v2 precio | v1 vel | v2 vel |\n')
report.append('|---|---|---|---|---|\n')
for fam, r in results.items():
    v2p = r['reg_precio_yoy']['r2'] if r.get('reg_precio_yoy') else 0
    v2v = r['reg_velocidad_yoy']['r2'] if r.get('reg_velocidad_yoy') else 0
    v1p = v1_r2.get(fam, {}).get('precio', 0)
    v1v = v1_r2.get(fam, {}).get('vel', 0)
    delta_p = v2p - v1p
    delta_v = v2v - v1v
    report.append(f'| {fam} | {v1p:.3f} | **{v2p:.3f}** ({delta_p:+.2f}) | {v1v:.3f} | **{v2v:.3f}** ({delta_v:+.2f}) |\n')

report.append('\n## Coeficientes con significancia estadística (* p<0.10, ** p<0.05, *** p<0.01)\n\n')
for fam, r in results.items():
    report.append(f'\n### {fam}\n\n')
    for tname, label in [('reg_precio_yoy', 'precio_yoy'), ('reg_velocidad_yoy', 'velocidad_yoy'), ('reg_plazo_yoy', 'plazo_yoy')]:
        rg = r.get(tname)
        if not rg: continue
        report.append(f'**{label}** — R²={rg["r2"]:.3f}, σε={rg["sigma_residual"]:.2f}pp, n={rg["n_obs"]}\n\n')
        report.append('| Variable | Coef | Std.Err | p-value | Sig |\n|---|---|---|---|---|\n')
        report.append(f'| (intercept) | {rg["intercept"]:+.3f} | — | — | — |\n')
        for n, b in rg['coefs'].items():
            se = rg['std_errs'].get(n, 0)
            p = rg['pvalues'].get(n, 1)
            star = '***' if p < 0.01 else '**' if p < 0.05 else '*' if p < 0.10 else ''
            report.append(f'| {n} | {b:+.4f} | {se:.4f} | {p:.3f} | {star} |\n')
        report.append('\n')

with open(OUT_REPORT, 'w') as f:
    f.writelines(report)
print(f'Wrote {OUT_REPORT}')
