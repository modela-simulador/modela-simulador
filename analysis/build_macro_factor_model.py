"""
Capa 2 cíclica del Factor Model — calibración offline.

Empata las series macro (BCCh + INE + CChC) con los datos CIDU 2010-2024
en grilla trimestral, calcula variaciones interanuales (YoY) para
remover tendencias, y estima regresiones lineales por familia de
producto:

    precio_t      = α + β1·dIPV_yoy + β2·dIMACEC_yoy + β3·tasa_hipo + β4·desempleo + ε
    velocidad_t   = γ + γ1·dIMACEC_yoy + γ2·desempleo + γ3·tasa_hipo + ε
    costo_t       = δ + δ1·dICOI_yoy + δ2·dIMACEC_yoy + ε   (DS19/Casa/etc)
    plazo_t       = θ + θ1·dIMACEC_yoy + ε

También calcula:
- Matriz de correlación Spearman entre macros (driver de la t-cópula macro)
- Distribuciones marginales de cada macro (mean, std, percentiles densos)
- Coeficientes empíricos por familia
- Residuos ε_i con sus correlaciones (intra-stratum)

Output: analysis/macro_factor_model.json
"""
import pandas as pd
import numpy as np
import json
from scipy import stats

OUT_JSON = 'analysis/macro_factor_model.json'
OUT_REPORT = 'analysis/macro_report.md'


# ──────────────────────────────────────────────────────────────────
# 1. Cargar y normalizar series macro
# ──────────────────────────────────────────────────────────────────

def parse_period_to_quarter(p):
    """Convierte fechas (2010-03-01) o años (2015) a período trimestral 'YYYY-Q'."""
    if isinstance(p, str):
        # Probar formato fecha
        try:
            d = pd.to_datetime(p)
            return f'{d.year}-Q{(d.month-1)//3+1}'
        except:
            pass
        # Probar año puro
        try:
            y = int(float(p))
            return f'{y}-Q1'  # asignar a Q1 por convención
        except:
            return None
    if isinstance(p, (int, float)):
        return f'{int(p)}-Q1'
    return None


def load_monthly_to_quarterly(path, value_col, date_col=0):
    """Carga serie mensual y agrega a trimestre (media)."""
    df = pd.read_csv(path)
    # Detectar header
    if df.iloc[0, 0] in ['Mes', 'Periodo', 'Período', 'Mes ', 'Period']:
        df = df.iloc[1:].reset_index(drop=True)
    df.columns = [str(c).strip() for c in df.columns]
    # Primera col fecha, segunda valor (asumido)
    df['date'] = pd.to_datetime(df.iloc[:, date_col], errors='coerce')
    df['val'] = pd.to_numeric(df.iloc[:, value_col], errors='coerce')
    df = df.dropna(subset=['date', 'val'])
    df['quarter'] = df['date'].dt.to_period('Q')
    quarterly = df.groupby('quarter')['val'].mean().reset_index()
    # Pandas Period → 'YYYYQN'. Normalizar a 'YYYY-QN' para coincidir con CIDU.
    quarterly['quarter_str'] = quarterly['quarter'].astype(str).str.replace(
        r'^(\d{4})Q(\d)$', r'\1-Q\2', regex=True)
    return quarterly[['quarter_str', 'val']]


def load_yearly(path, value_col, year_col=0):
    """Carga serie anual."""
    df = pd.read_csv(path)
    # Detectar header (skip primeras 2-3 filas hasta encontrar 'Año' o 'Periodo')
    for skip in range(5):
        if skip > 0:
            df_try = pd.read_csv(path, skiprows=skip)
        else:
            df_try = df
        first_col = str(df_try.columns[0]).strip().lower()
        if first_col in ['año', 'ano', 'periodo', 'period', 'mes']:
            df = df_try
            break
    df.columns = [str(c).strip() for c in df.columns]
    df['year'] = pd.to_numeric(df.iloc[:, year_col], errors='coerce')
    df['val'] = pd.to_numeric(df.iloc[:, value_col], errors='coerce')
    df = df.dropna(subset=['year', 'val'])
    df['year'] = df['year'].astype(int)
    return df[['year', 'val']]


def yearly_to_quarterly(df_yearly):
    """Expande serie anual a 4 trimestres (interpolación lineal)."""
    rows = []
    yrs = df_yearly['year'].tolist()
    vals = df_yearly['val'].tolist()
    for i, (y, v) in enumerate(zip(yrs, vals)):
        # Q1, Q2, Q3, Q4 — interpolar entre v[i] y v[i+1]
        v_next = vals[i+1] if i+1 < len(vals) else v
        for q in range(1, 5):
            frac = (q - 1) / 4
            interp = v * (1 - frac) + v_next * frac
            rows.append({'quarter_str': f'{y}-Q{q}', 'val': interp})
    return pd.DataFrame(rows)


def yoy_pct_change(df_quarterly, lag_quarters=4):
    """Variación interanual (YoY) = (val_t - val_{t-4}) / val_{t-4}."""
    df = df_quarterly.copy().sort_values('quarter_str').reset_index(drop=True)
    df['yoy'] = (df['val'] - df['val'].shift(lag_quarters)) / df['val'].shift(lag_quarters)
    return df[['quarter_str', 'val', 'yoy']]


print('Cargando series macro...')

# IMACEC: ya en variación % anual (la primera col tras la fecha — confirmado de inspección)
imacec = load_monthly_to_quarterly('analysis/macro_raw/imacec.csv', value_col=1)
imacec.columns = ['quarter_str', 'imacec_var_pct']
print(f'  IMACEC: {len(imacec)} trimestres ({imacec["quarter_str"].iloc[0]} → {imacec["quarter_str"].iloc[-1]})')

# Tasa hipotecaria: nivel mensual %
tasa_hipo = load_monthly_to_quarterly('analysis/macro_raw/tasa_hipotecaria.csv', value_col=1)
tasa_hipo.columns = ['quarter_str', 'tasa_hipo']
print(f'  Tasa hipotecaria: {len(tasa_hipo)} trimestres')

# Desempleo: nivel mensual %
desempleo = load_monthly_to_quarterly('analysis/macro_raw/desempleo.csv', value_col=1)
desempleo.columns = ['quarter_str', 'desempleo']
print(f'  Desempleo: {len(desempleo)} trimestres')

# IPV: anual desglosado. Cargo manualmente para extraer columnas relevantes.
ipv_raw = pd.read_csv('analysis/macro_raw/ipv.csv', skiprows=2)
ipv_raw.columns = [str(c).strip() for c in ipv_raw.columns]
ipv_raw['year'] = pd.to_datetime(ipv_raw.iloc[:, 0], errors='coerce').dt.year
ipv_cols = {
    'general':       '1. IPV General.',
    'casas':         '1.1. IPV Casas',
    'casas_nuevas':  '1.1.1. IPV Casas Nuevas',
    'deptos':        '1.2. IPV Departamentos',
    'deptos_nuevos': '1.2.1. IPV Departamentos Nuevo',
}
# Usamos columnas por índice posicional para evitar problemas de naming
# col 0=Periodo, 1=General, 2=Casas, 3=Casas Nuevas, 4=Casas Usadas, 5=Deptos, 6=Deptos Nuevos
ipv_yearly = pd.DataFrame({
    'year': ipv_raw['year'],
    'general': pd.to_numeric(ipv_raw.iloc[:, 1], errors='coerce'),
    'casas_nuevas': pd.to_numeric(ipv_raw.iloc[:, 3], errors='coerce'),
    'deptos_nuevos': pd.to_numeric(ipv_raw.iloc[:, 6], errors='coerce'),
}).dropna(subset=['year']).copy()
ipv_yearly['year'] = ipv_yearly['year'].astype(int)
print(f'  IPV: {len(ipv_yearly)} años')

ipv_general_q = yearly_to_quarterly(ipv_yearly[['year', 'general']].rename(columns={'general': 'val'}))
ipv_general_q.columns = ['quarter_str', 'ipv_general']
ipv_casas_q = yearly_to_quarterly(ipv_yearly[['year', 'casas_nuevas']].rename(columns={'casas_nuevas': 'val'}))
ipv_casas_q.columns = ['quarter_str', 'ipv_casas_nuevas']
ipv_deptos_q = yearly_to_quarterly(ipv_yearly[['year', 'deptos_nuevos']].rename(columns={'deptos_nuevos': 'val'}))
ipv_deptos_q.columns = ['quarter_str', 'ipv_deptos_nuevos']

# ICOI: anual, columna 1
icoi_raw = pd.read_csv('analysis/macro_raw/indice_de_construccion_desglos.csv', skiprows=2)
icoi_raw.columns = [str(c).strip() for c in icoi_raw.columns]
icoi_yearly = pd.DataFrame({
    'year': pd.to_numeric(icoi_raw.iloc[:, 0], errors='coerce'),
    'val': pd.to_numeric(icoi_raw.iloc[:, 1], errors='coerce'),
}).dropna()
icoi_yearly['year'] = icoi_yearly['year'].astype(int)
icoi_yearly = icoi_yearly.drop_duplicates(subset=['year'], keep='first').reset_index(drop=True)
print(f'  ICOI: {len(icoi_yearly)} años')
icoi_q = yearly_to_quarterly(icoi_yearly)
icoi_q.columns = ['quarter_str', 'icoi']

# IPC para deflactar (anual)
ipc_yearly = pd.DataFrame({
    'year': pd.to_numeric(icoi_raw.iloc[:, 0], errors='coerce'),
    'val': pd.to_numeric(icoi_raw.iloc[:, 2], errors='coerce'),
}).dropna()
ipc_yearly['year'] = ipc_yearly['year'].astype(int)
ipc_q = yearly_to_quarterly(ipc_yearly)
ipc_q.columns = ['quarter_str', 'ipc']


# ──────────────────────────────────────────────────────────────────
# 2. Empate trimestral
# ──────────────────────────────────────────────────────────────────

print('\nEmpatando series en grilla trimestral común...')

# Período común: max(min) → min(max)
all_dfs = [imacec, tasa_hipo, desempleo, ipv_general_q, ipv_casas_q, ipv_deptos_q, icoi_q, ipc_q]
all_qstrs = [df['quarter_str'].tolist() for df in all_dfs]

merged = imacec.copy()
for df, name in [(tasa_hipo, 'tasa_hipo'),
                  (desempleo, 'desempleo'),
                  (ipv_general_q, 'ipv_general'),
                  (ipv_casas_q, 'ipv_casas_nuevas'),
                  (ipv_deptos_q, 'ipv_deptos_nuevos'),
                  (icoi_q, 'icoi'),
                  (ipc_q, 'ipc')]:
    merged = merged.merge(df, on='quarter_str', how='outer')

merged = merged.sort_values('quarter_str').reset_index(drop=True)
print(f'  {len(merged)} trimestres total')

# Calcular YoY de IPV, ICOI, IPC
for col in ['ipv_general', 'ipv_casas_nuevas', 'ipv_deptos_nuevos', 'icoi', 'ipc']:
    merged[f'{col}_yoy'] = merged[col].pct_change(periods=4) * 100

# Filtrar a período con todas las variables principales
mask = merged[['imacec_var_pct', 'tasa_hipo', 'desempleo', 'ipv_general_yoy', 'icoi_yoy']].notna().all(axis=1)
merged_clean = merged[mask].copy().reset_index(drop=True)
print(f'  {len(merged_clean)} trimestres con todas las macros principales presentes')


# ──────────────────────────────────────────────────────────────────
# 3. Empatar con CIDU
# ──────────────────────────────────────────────────────────────────

print('\nCargando CIDU...')
cidu = pd.read_csv('analysis/data.csv', low_memory=False)
NUMERIC_COLS = ['UFM2P', 'UMESP', 'MAGOST', 'DPROM', 'SUPP', 'NPISOS']
for c in NUMERIC_COLS:
    cidu[c] = pd.to_numeric(cidu[c], errors='coerce')

# Período: AÑO + PER ('1P' / '2P' / '3P' / '4P') → 'YYYY-Q1' etc
def cidu_to_quarter(year, per):
    if not pd.isna(year) and isinstance(per, str):
        per_clean = per.strip().upper().rstrip('P')
        try:
            return f'{int(year)}-Q{int(per_clean)}'
        except:
            return None
    return None

cidu['quarter_str'] = cidu.apply(lambda r: cidu_to_quarter(r['AÑO'], r['PER']), axis=1)
cidu_active = cidu[(cidu['UFM2P'] > 0) & (cidu['UMESP'] > 0) & (cidu['SUPP'] > 0)].copy()

# Estratos
def is_townhouse(row):
    return row['TPROP'] == 'TOWNHOUSE' or row['TCAT'] == 'TOWNHOUSE'

cidu_active['_stratum'] = None
cidu_active.loc[(cidu_active['TPROP']=='DEPARTAMENTO') & (cidu_active['NPISOS']<=6) & (cidu_active['TSUB']=='SIN SUBSIDIO'), '_stratum'] = 'edif_4p'
cidu_active.loc[cidu_active['TSUB'].astype(str).str.contains('DS19', na=False), '_stratum'] = 'ds19'
cidu_active.loc[(cidu_active['TPROP']=='CASA') & (cidu_active['TSUB']=='SIN SUBSIDIO'), '_stratum'] = 'casa'
cidu_active.loc[cidu_active.apply(is_townhouse, axis=1), '_stratum'] = 'townhouse'

print(f'  {len(cidu_active)} obs CIDU activas')


# ──────────────────────────────────────────────────────────────────
# 4. Regresiones por familia
# ──────────────────────────────────────────────────────────────────

# Variable IPV específica por familia: edif/ds19 → deptos_nuevos, casa/townhouse → casas_nuevas
FAMILY_IPV = {
    'edif_4p':   'ipv_deptos_nuevos_yoy',
    'ds19':      'ipv_deptos_nuevos_yoy',
    'casa':      'ipv_casas_nuevas_yoy',
    'townhouse': 'ipv_casas_nuevas_yoy',
}

def winsorize(s, p_low=0.01, p_high=0.99):
    s = s.dropna()
    if len(s) == 0:
        return s
    lo, hi = s.quantile(p_low), s.quantile(p_high)
    return s.clip(lo, hi)

def fit_regression(y, X, X_names):
    """OLS con scipy: y = X·β + ε. Devuelve coeficientes + R² + std_err."""
    # Drop NAs
    valid = ~(np.isnan(y) | np.isnan(X).any(axis=1))
    y_v = y[valid]
    X_v = X[valid]
    if len(y_v) < 10:
        return None
    # Add intercept column
    X_const = np.column_stack([np.ones(len(X_v)), X_v])
    try:
        beta, residuals, rank, _ = np.linalg.lstsq(X_const, y_v, rcond=None)
    except:
        return None
    y_pred = X_const @ beta
    resid = y_v - y_pred
    ss_res = (resid ** 2).sum()
    ss_tot = ((y_v - y_v.mean()) ** 2).sum()
    r2 = 1 - ss_res / ss_tot if ss_tot > 0 else 0
    sigma_eps = np.sqrt(ss_res / max(1, len(y_v) - len(beta)))
    return {
        'intercept': float(beta[0]),
        'coefs': {n: float(b) for n, b in zip(X_names, beta[1:])},
        'r2': float(r2),
        'sigma_residual': float(sigma_eps),
        'n_obs': int(len(y_v)),
    }


print('\nCalibrando regresiones por familia (target: variaciones interanuales)...')

# Cambio clave: target = YoY (precio_yoy_pct, velocidad_yoy_pct) en vez de
# log(precio). Esto elimina la tendencia común (precios e ipv ambos crecen
# con la economía) y aísla el componente cíclico que es lo que el factor
# model debe predecir. Las regresiones nivel-a-nivel daban signos invertidos
# por multicolinealidad de tendencias compartidas.
#
# Variables explicativas también en YoY o cambios (Δtasa_hipo, Δdesempleo)
# para que los signos sean económicamente interpretables.

# Pre-calcular Δ tasa_hipo y Δ desempleo (cambio anual en pp)
merged_clean['d_tasa_hipo'] = merged_clean['tasa_hipo'].diff(periods=4)
merged_clean['d_desempleo'] = merged_clean['desempleo'].diff(periods=4)

results = {}
for stratum in ['edif_4p', 'ds19', 'casa', 'townhouse']:
    sub = cidu_active[cidu_active['_stratum'] == stratum].copy()
    if len(sub) < 50:
        continue

    agg = sub.groupby('quarter_str').agg({
        'UFM2P': 'median',
        'UMESP': 'median',
        'MAGOST': 'median',
        'SUPP': 'median',
    }).reset_index()
    agg.columns = ['quarter_str', 'precio', 'velocidad', 'plazo', 'sup']

    # Calcular YoY de precio, velocidad, plazo (lag 4 trimestres)
    agg = agg.sort_values('quarter_str').reset_index(drop=True)
    agg['precio_yoy'] = agg['precio'].pct_change(4) * 100
    agg['velocidad_yoy'] = agg['velocidad'].pct_change(4) * 100
    agg['plazo_yoy'] = agg['plazo'].pct_change(4) * 100

    df = agg.merge(merged_clean, on='quarter_str', how='inner')
    n_q = len(df.dropna(subset=['precio_yoy']))
    if n_q < 15:
        print(f'  {stratum}: solo {n_q} trimestres con YoY, skipping')
        continue

    ipv_col = FAMILY_IPV[stratum]
    if ipv_col not in df.columns:
        ipv_col = 'ipv_general_yoy'

    # Variables explicativas (todas en YoY o cambios, escala consistente)
    X_cols = ['imacec_var_pct', 'd_tasa_hipo', 'd_desempleo', ipv_col, 'icoi_yoy']
    X = df[X_cols].values

    y_precio = df['precio_yoy'].values
    y_velocidad = df['velocidad_yoy'].values
    y_plazo = df['plazo_yoy'].values

    print(f'\n  {stratum} — {n_q} trimestres:')
    fam_results = {
        'n_obs': n_q,
        'X_names': X_cols,
        'baseline': {
            'precio': float(df['precio'].mean()),
            'velocidad': float(df['velocidad'].mean()),
            'plazo': float(df['plazo'].mean()),
        },
        'reg_precio_yoy': fit_regression(y_precio, X, X_cols),
        'reg_velocidad_yoy': fit_regression(y_velocidad, X, X_cols),
        'reg_plazo_yoy': fit_regression(y_plazo, X, X_cols),
    }
    if fam_results['reg_precio_yoy']:
        print(f'    precio_yoy ← R²={fam_results["reg_precio_yoy"]["r2"]:.3f}, σε={fam_results["reg_precio_yoy"]["sigma_residual"]:.2f}pp')
        for n, b in fam_results['reg_precio_yoy']['coefs'].items():
            print(f'      {n}: {b:+.4f}')
    if fam_results['reg_velocidad_yoy']:
        print(f'    velocidad_yoy ← R²={fam_results["reg_velocidad_yoy"]["r2"]:.3f}, σε={fam_results["reg_velocidad_yoy"]["sigma_residual"]:.2f}pp')
        for n, b in fam_results['reg_velocidad_yoy']['coefs'].items():
            print(f'      {n}: {b:+.4f}')
    results[stratum] = fam_results


# ──────────────────────────────────────────────────────────────────
# 5. Distribución conjunta de macros (cópula de Capa 2)
# ──────────────────────────────────────────────────────────────────

print('\nDistribución de variables macro (para cópula de Capa 2)...')

MACROS = ['imacec_var_pct', 'tasa_hipo', 'desempleo', 'ipv_general_yoy', 'ipv_deptos_nuevos_yoy',
          'ipv_casas_nuevas_yoy', 'icoi_yoy']

macro_data = {}
PERCENTILES_DENSE = list(np.linspace(0.01, 0.99, 99))
for col in MACROS:
    if col not in merged_clean.columns:
        continue
    s = merged_clean[col].dropna()
    if len(s) < 10:
        continue
    s = winsorize(s)
    macro_data[col] = {
        'n': int(len(s)),
        'mean': float(s.mean()),
        'std': float(s.std()),
        'p10': float(s.quantile(0.1)),
        'p50': float(s.quantile(0.5)),
        'p90': float(s.quantile(0.9)),
        'pcts': [float(s.quantile(q)) for q in PERCENTILES_DENSE],
    }

# Matriz de correlación Spearman entre macros (para sample joint con cópula)
macro_corr = {}
present = [c for c in MACROS if c in macro_data]
df_corr = merged_clean[present].dropna()
if len(df_corr) > 10:
    for vi in present:
        macro_corr[vi] = {}
        for vj in present:
            if vi == vj:
                macro_corr[vi][vj] = 1.0
            else:
                rs, _ = stats.spearmanr(df_corr[vi], df_corr[vj])
                macro_corr[vi][vj] = float(rs) if not np.isnan(rs) else 0.0


# ──────────────────────────────────────────────────────────────────
# 6. Output JSON
# ──────────────────────────────────────────────────────────────────

output = {
    'metadata': {
        'cidu_obs': int(len(cidu_active)),
        'macro_quarters': int(len(merged_clean)),
        'period': f'{merged_clean["quarter_str"].iloc[0]} → {merged_clean["quarter_str"].iloc[-1]}',
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


# Reporte humano
report = ['# Macro Factor Model — Calibración Empírica\n\n']
report.append(f'Período: {output["metadata"]["period"]}, {output["metadata"]["macro_quarters"]} trimestres con macros completas.\n')
report.append(f'CIDU: {output["metadata"]["cidu_obs"]} obs activas.\n\n')

report.append('## Distribuciones macro (winsorized p1-p99)\n\n')
report.append('| Variable | N | Media | DE | p10 | p50 | p90 |\n')
report.append('|---|---|---|---|---|---|---|\n')
for k, v in macro_data.items():
    report.append(f'| {k} | {v["n"]} | {v["mean"]:.2f} | {v["std"]:.2f} | {v["p10"]:.2f} | {v["p50"]:.2f} | {v["p90"]:.2f} |\n')

report.append('\n## Correlación Spearman entre macros (matriz de la cópula Capa 2)\n\n')
report.append('| | ' + ' | '.join(present[:5]) + ' |\n')
report.append('|---' + '|---' * len(present[:5]) + '|\n')
for vi in present[:5]:
    row = f'| **{vi[:20]}** |'
    for vj in present[:5]:
        row += f' {macro_corr[vi][vj]:+.2f} |'
    report.append(row + '\n')

report.append('\n## Regresiones por familia\n\n')
for fam, r in results.items():
    report.append(f'\n### {fam} — N = {r["n_obs"]} trimestres\n\n')
    for reg_name in ['reg_precio', 'reg_velocidad', 'reg_plazo']:
        rg = r.get(reg_name)
        if not rg: continue
        ylabel = reg_name.replace('reg_', 'log(') + ')'
        report.append(f'**{ylabel}** — R²={rg["r2"]:.3f}, σε={rg["sigma_residual"]:.3f}\n\n')
        report.append('| Variable | Coef |\n|---|---|\n')
        report.append(f'| (intercept) | {rg["intercept"]:+.4f} |\n')
        for n, b in rg['coefs'].items():
            report.append(f'| {n} | {b:+.5f} |\n')
        report.append('\n')

with open(OUT_REPORT, 'w') as f:
    f.writelines(report)
print(f'Wrote {OUT_REPORT}')
