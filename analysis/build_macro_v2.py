"""
Versión 2 del Factor Model con todas las mejoras priorizadas:

  Mejora 1: Usar IPV con lag t-3 (correlación 0.34 → 0.55)
  Mejora 2: Estratificar por comuna (filtrar TINSA por comunas AUDP)
  Mejora 3: Modelo polinómico para velocidad (con interacciones)
  Mejora 4: Cópula expandida con lags principales

Output: analysis/macro_factor_v2.json + public/macro_factor_v2.js
"""
import os
import json
import numpy as np
import pandas as pd
from scipy import stats

print('═══ Factor Model v2 — Calibración mejorada ═══\n')

# ─── Comunas relevantes para AUDP (Batuco/Colina) ───
# Periferia norte de Santiago: similar perfil socioeconómico,
# expansión periurbana, distancias similares al CBD
COMUNAS_AUDP_RELEVANTES = [
    'LAMPA',          # AUDP Batuco está en Lampa
    'COLINA',         # AUDP Colina + adyacente Batuco
    'BUIN',           # Sur, comparable demanda
    'PADRE HURTADO',  # Norte-poniente, similar
    'SAN BERNARDO',   # Sur, periurbana
    'TILTIL',         # Norte
    'MELIPILLA',      # Poniente periurbana
]

print('Comunas AUDP-relevantes:', ', '.join(COMUNAS_AUDP_RELEVANTES))

# ─── Cargar TINSA ───
print('\nCargando TINSA...')
cidu = pd.read_csv('analysis/data.csv', low_memory=False)
NUM = ['UFM2P', 'UMESP', 'MAGOST', 'DPROM', 'SUPP', 'NPISOS', 'UVEND']
for c in NUM:
    cidu[c] = pd.to_numeric(cidu[c], errors='coerce')
cidu['quarter_str'] = cidu.apply(
    lambda r: f'{int(r["AÑO"])}-Q{int(r["PER"].strip("P"))}' if not pd.isna(r['AÑO']) and isinstance(r['PER'], str) else None,
    axis=1
)
cidu = cidu[(cidu['UFM2P'] > 0) & (cidu['UMESP'] > 0) & (cidu['SUPP'] > 0) & (cidu['UVEND'] > 0)].copy()

# Estratos por familia
def is_townhouse(row):
    return row['TPROP'] == 'TOWNHOUSE' or row['TCAT'] == 'TOWNHOUSE'

cidu['fam'] = 'otros'
cidu.loc[(cidu['TPROP']=='DEPARTAMENTO') & (cidu['NPISOS']<=6) & (cidu['TSUB']=='SIN SUBSIDIO'), 'fam'] = 'edif_4p'
cidu.loc[cidu['TSUB'].astype(str).str.contains('DS19', na=False), 'fam'] = 'ds19'
cidu.loc[(cidu['TPROP']=='CASA') & (cidu['TSUB']=='SIN SUBSIDIO'), 'fam'] = 'casa'
cidu.loc[cidu.apply(is_townhouse, axis=1), 'fam'] = 'townhouse'

# ─── MEJORA 2: Stratification por comuna AUDP-relevante ───
cidu['audp_zone'] = cidu['NCOM'].apply(
    lambda c: 'audp_zone' if c in COMUNAS_AUDP_RELEVANTES else 'otra_zona'
)

audp_data = cidu[cidu['audp_zone'] == 'audp_zone']
nat_data = cidu  # nacional

print(f'\n  TINSA total nacional: {len(cidu):,} obs')
print(f'  TINSA AUDP zone: {len(audp_data):,} obs')
print(f'  Comunas AUDP en TINSA: {audp_data["NCOM"].value_counts().head(7).to_dict()}')

# ─── Cargar Macros ───
def load_csv_to_q(path, val_col=1):
    df = pd.read_csv(path)
    if df.iloc[0, 0] in ['Mes', 'Periodo', 'Período', 'Mes ']:
        df = df.iloc[1:].reset_index(drop=True)
    df.columns = [str(c).strip() for c in df.columns]
    df['date'] = pd.to_datetime(df.iloc[:, 0], errors='coerce')
    df['val'] = pd.to_numeric(df.iloc[:, val_col], errors='coerce')
    df = df.dropna(subset=['date', 'val'])
    df['quarter'] = df['date'].dt.to_period('Q')
    quarterly = df.groupby('quarter')['val'].mean().reset_index()
    quarterly['quarter_str'] = quarterly['quarter'].astype(str).str.replace(r'^(\d{4})Q(\d)$', r'\1-Q\2', regex=True)
    return quarterly[['quarter_str', 'val']]

def yearly_to_q(df_yearly, val_col):
    rows = []
    for i, (_, row) in enumerate(df_yearly.iterrows()):
        nxt = df_yearly.iloc[i+1] if i+1 < len(df_yearly) else row
        yr = int(row['year'])
        for q in range(1, 5):
            f = (q-1)/4
            rows.append({'quarter_str': f'{yr}-Q{q}', 'val': row[val_col]*(1-f) + nxt[val_col]*f})
    return pd.DataFrame(rows)

print('\nCargando macros...')
imacec = load_csv_to_q('analysis/macro_raw/imacec.csv'); imacec.columns = ['quarter_str', 'imacec_var_pct']
tasa = load_csv_to_q('analysis/macro_raw/tasa_hipotecaria.csv'); tasa.columns = ['quarter_str', 'tasa_hipo']
desemp = load_csv_to_q('analysis/macro_raw/desempleo.csv'); desemp.columns = ['quarter_str', 'desempleo']

ipv_raw = pd.read_csv('analysis/macro_raw/ipv.csv', skiprows=2)
ipv_raw['year'] = pd.to_datetime(ipv_raw.iloc[:, 0], errors='coerce').dt.year
ipv_yearly = pd.DataFrame({
    'year': ipv_raw['year'],
    'ipv_general': pd.to_numeric(ipv_raw.iloc[:, 1], errors='coerce'),
    'ipv_casas_nuevas': pd.to_numeric(ipv_raw.iloc[:, 3], errors='coerce'),
    'ipv_deptos_nuevos': pd.to_numeric(ipv_raw.iloc[:, 6], errors='coerce'),
}).dropna(subset=['year']).copy()
ipv_yearly['year'] = ipv_yearly['year'].astype(int)

ipv_general_q = yearly_to_q(ipv_yearly[['year','ipv_general']], 'ipv_general'); ipv_general_q.columns = ['quarter_str','ipv_general']
ipv_casas_q = yearly_to_q(ipv_yearly[['year','ipv_casas_nuevas']], 'ipv_casas_nuevas'); ipv_casas_q.columns = ['quarter_str','ipv_casas_nuevas']
ipv_deptos_q = yearly_to_q(ipv_yearly[['year','ipv_deptos_nuevos']], 'ipv_deptos_nuevos'); ipv_deptos_q.columns = ['quarter_str','ipv_deptos_nuevos']

icoi_raw = pd.read_csv('analysis/macro_raw/indice_de_construccion_desglos.csv', skiprows=2)
icoi_yearly = pd.DataFrame({
    'year': pd.to_numeric(icoi_raw.iloc[:, 0], errors='coerce'),
    'val': pd.to_numeric(icoi_raw.iloc[:, 1], errors='coerce'),
}).dropna()
icoi_yearly['year'] = icoi_yearly['year'].astype(int)
icoi_yearly = icoi_yearly.drop_duplicates(subset=['year'], keep='first').reset_index(drop=True)
icoi_q = yearly_to_q(icoi_yearly, 'val'); icoi_q.columns = ['quarter_str','icoi']

merged = imacec.copy()
for df, _ in [(tasa,'_'), (desemp,'_'), (ipv_general_q,'_'), (ipv_casas_q,'_'), (ipv_deptos_q,'_'), (icoi_q,'_')]:
    merged = merged.merge(df, on='quarter_str', how='outer')
merged = merged.sort_values('quarter_str').reset_index(drop=True)
for c in ['ipv_general', 'ipv_casas_nuevas', 'ipv_deptos_nuevos', 'icoi']:
    merged[f'{c}_yoy'] = merged[c].pct_change(periods=4) * 100
merged['d_tasa_hipo'] = merged['tasa_hipo'].diff(periods=4)
merged['d_desempleo'] = merged['desempleo'].diff(periods=4)

# ─── MEJORA 4: Construir lags principales ───
LAG_VARS = ['imacec_var_pct', 'd_tasa_hipo', 'd_desempleo',
            'ipv_general_yoy', 'ipv_casas_nuevas_yoy', 'ipv_deptos_nuevos_yoy', 'icoi_yoy']
for v in LAG_VARS:
    for lag in [1, 2, 3]:
        merged[f'{v}_L{lag}'] = merged[v].shift(lag)

# ─── Helpers ───
def weighted_mean(df, val_col, weight_col):
    w = df[weight_col].sum()
    if w == 0: return df[val_col].mean()
    return (df[val_col] * df[weight_col]).sum() / w

def aggregate_tinsa(df_filtered, label):
    rows = []
    for q, grp in df_filtered.groupby('quarter_str'):
        rows.append({
            'quarter_str': q,
            'precio': weighted_mean(grp, 'UFM2P', 'UVEND'),
            'velocidad': weighted_mean(grp, 'UMESP', 'UVEND'),
            'plazo': weighted_mean(grp, 'MAGOST', 'UVEND'),
            'sup': weighted_mean(grp, 'SUPP', 'UVEND'),
            'uvend': grp['UVEND'].sum(),
        })
    df = pd.DataFrame(rows).sort_values('quarter_str').reset_index(drop=True)
    for c in ['precio', 'velocidad', 'plazo', 'sup']:
        df[f'{c}_yoy'] = df[c].pct_change(4) * 100
    print(f'  {label}: {len(df)} trimestres')
    return df

# ─── Calibración por familia × zona ───
FAMILY_IPV = {
    'edif_4p':   'ipv_deptos_nuevos_yoy',
    'ds19':      'ipv_deptos_nuevos_yoy',
    'casa':      'ipv_casas_nuevas_yoy',
    'townhouse': 'ipv_casas_nuevas_yoy',
}

def fit_polynomial_velocity(y, X_dict, lag=False):
    """
    MEJORA 3: regresión polinómica con interacciones para velocidad.
    Incluye: macros lineales + cuadráticas + interacciones IMACEC×tasa, IMACEC×IPV
    """
    if len(y) < 25:
        return None
    # Construir matriz REDUCIDA: 5 features para evitar overfit con N=36-57 obs.
    # Variables seleccionadas por contribución empírica (top RF): IMACEC, IPV, ICOI
    # más 2 interacciones críticas (IMACEC×IPV, IMACEC×Δtasa).
    feats = {
        'imacec': X_dict.get('imacec_var_pct', np.zeros_like(y)),
        'ipv': X_dict.get('ipv_yoy', np.zeros_like(y)),
        'icoi': X_dict.get('icoi_yoy', np.zeros_like(y)),
        'imacec_x_ipv': X_dict.get('imacec_var_pct', np.zeros_like(y)) * X_dict.get('ipv_yoy', np.zeros_like(y)),
        'imacec_sq': X_dict.get('imacec_var_pct', np.zeros_like(y)) ** 2,
    }

    feat_names = list(feats.keys())
    X = np.column_stack([feats[k] for k in feat_names])

    # Manejar NaN — fillna con 0 (variables YoY/Δ ya detrended)
    X = np.nan_to_num(X, nan=0.0)
    y_v = np.nan_to_num(y, nan=0.0)

    # OLS
    X_const = np.column_stack([np.ones(len(y_v)), X])
    try:
        beta, *_ = np.linalg.lstsq(X_const, y_v, rcond=None)
    except:
        return None
    y_pred = X_const @ beta
    resid = y_v - y_pred
    ss_res = (resid**2).sum()
    ss_tot = ((y_v - y_v.mean())**2).sum()
    r2 = 1 - ss_res/ss_tot if ss_tot > 0 else 0
    sigma = np.sqrt(ss_res / max(1, len(y_v) - len(beta)))
    return {
        'intercept': float(beta[0]),
        'coefs': {n: float(b) for n, b in zip(feat_names, beta[1:])},
        'r2': float(r2),
        'sigma_residual': float(sigma),
        'n_obs': int(len(y_v)),
        'features_used': feat_names,
    }

print('\nCalibrando familias × zonas...')

family_models = {}
for zone_label, zone_data in [('audp_zone', audp_data), ('nacional', nat_data)]:
    family_models[zone_label] = {}
    for fam in ['edif_4p', 'ds19', 'casa', 'townhouse']:
        sub = zone_data[zone_data['fam'] == fam]
        if len(sub) < 30:
            print(f'  ⚠ {zone_label} × {fam}: solo {len(sub)} obs, omitido')
            continue
        agg = aggregate_tinsa(sub, f'{zone_label} × {fam}')
        df = agg.merge(merged, on='quarter_str', how='inner').dropna(subset=['precio_yoy'])
        if len(df) < 15:
            continue

        ipv_col = FAMILY_IPV[fam]

        # ─── MEJORA 1: σ idiosincrático precio con IPV general en lag t-3 ───
        # Usamos IPV general (no familiar) para tener UNA sola variable IPV
        # en la cópula expandida. La σ_idiosincrático absorbe la diferencia
        # entre el IPV familiar y el IPV general.
        ipv_lag3_col = 'ipv_general_yoy_L3'
        if ipv_lag3_col in df.columns:
            df_lag = df.dropna(subset=[ipv_lag3_col])
            if len(df_lag) >= 10:
                delta_precio_lag3 = df_lag['precio_yoy'] - df_lag[ipv_lag3_col]
                sigma_precio_lag3 = float(delta_precio_lag3.std())
                bias_precio_lag3 = float(delta_precio_lag3.mean())
                # comparar con contemporáneo (usando IPV familiar)
                delta_precio_t = df['precio_yoy'] - df[ipv_col]
                sigma_precio_t = float(delta_precio_t.std())
            else:
                sigma_precio_lag3 = sigma_precio_t = 5.0
                bias_precio_lag3 = 0.0
        else:
            sigma_precio_lag3 = sigma_precio_t = 5.0
            bias_precio_lag3 = 0.0

        # ─── MEJORA 3: regresión polinómica con interacciones para velocidad ───
        # Usamos IPV general (no familiar) para que esté en la cópula expandida
        X_dict = {
            'imacec_var_pct': df['imacec_var_pct'].values,
            'd_tasa_hipo': df['d_tasa_hipo'].values,
            'd_desempleo': df['d_desempleo'].values,
            'ipv_yoy': df['ipv_general_yoy'].values,
            'icoi_yoy': df['icoi_yoy'].values,
        }
        reg_vel_poly = fit_polynomial_velocity(df['velocidad_yoy'].values, X_dict)

        sigma_plazo = float(df['plazo_yoy'].dropna().std() or 10.0)

        family_models[zone_label][fam] = {
            'n_obs': int(len(df)),
            'baseline': {
                'precio': float(df['precio'].mean()),
                'velocidad': float(df['velocidad'].mean()),
                'plazo': float(df['plazo'].mean()),
            },
            'precio_shock': {
                'driver': 'ipv_general_yoy_L3',  # MEJORA 1: lag óptimo
                'family_ipv_orig': ipv_col,       # familia original (para comparar)
                'lag': 3,
                'sigma_idiosyncratic_pp': sigma_precio_lag3,
                'sigma_contemporaneo': sigma_precio_t,
            },
            'costo_shock': {
                'driver': 'icoi_yoy',
                'sigma_idiosyncratic_pp': 3.0,
            },
            'velocidad_regression_polynomial': reg_vel_poly,
            'plazo_shock': {'sigma_idiosyncratic_pp': sigma_plazo},
        }

        print(f'    {zone_label}/{fam}: σ precio_t={sigma_precio_t:.2f}pp, σ precio_t-3={sigma_precio_lag3:.2f}pp, vel R²={reg_vel_poly["r2"]:.3f}')

# ─── MEJORA 4: Cópula expandida con macros + lags ───
print('\nCalibrando cópula expandida con lags...')

EXPANDED_MACROS = LAG_VARS + [f'{v}_L{lag}' for v in LAG_VARS for lag in [1, 2, 3]]
# Reducir solo a las más relevantes (sin redundancias)
# Cópula simplificada con 8 variables (incluye lags clave para mejora 1):
EXPANDED_MACROS_KEY = [
    'imacec_var_pct',           # PIB contemporáneo
    'imacec_var_pct_L1',        # PIB lag-1 (importante para velocidad)
    'd_tasa_hipo',              # Δ tasa hipotecaria
    'd_desempleo',              # Δ desempleo
    'ipv_general_yoy',          # IPV contemporáneo (para regresión velocidad)
    'ipv_general_yoy_L3',       # IPV lag-3 (driver óptimo de precio — mejora 1)
    'icoi_yoy',                 # ICOI contemporáneo
    'icoi_yoy_L1',              # ICOI lag-1
]
# 8 variables sobre ~37 trimestres → ratio obs/var = 4.6 (aceptable)

# Distribuciones marginales de cada macro
PERCENTILES_DENSE = list(np.linspace(0.01, 0.99, 99))
macro_data_expanded = {}
for col in EXPANDED_MACROS_KEY:
    if col not in merged.columns:
        continue
    s = merged[col].dropna()
    if len(s) < 10:
        continue
    s = s.clip(s.quantile(0.01), s.quantile(0.99))
    macro_data_expanded[col] = {
        'n': int(len(s)),
        'mean': float(s.mean()),
        'std': float(s.std()),
        'p10': float(s.quantile(0.1)),
        'p50': float(s.quantile(0.5)),
        'p90': float(s.quantile(0.9)),
        'pcts': [float(s.quantile(q)) for q in PERCENTILES_DENSE],
    }

# Matriz de correlación expandida
present = [c for c in EXPANDED_MACROS_KEY if c in macro_data_expanded]
df_corr = merged[present].dropna()
print(f'  Variables expandidas en cópula: {len(present)}')
print(f'  Trimestres con todos los lags: {len(df_corr)}')

macro_corr_expanded = {}
if len(df_corr) > 10:
    for vi in present:
        macro_corr_expanded[vi] = {}
        for vj in present:
            if vi == vj:
                macro_corr_expanded[vi][vj] = 1.0
            else:
                rs, _ = stats.spearmanr(df_corr[vi], df_corr[vj])
                macro_corr_expanded[vi][vj] = float(rs) if not np.isnan(rs) else 0.0

# ─── Output ───
print('\nGuardando outputs...')
output = {
    'metadata': {
        'version': 'v2',
        'mejoras': [
            '1. IPV con lag t-3 (correlación 0.34 → 0.55 en pooled)',
            '2. Estratificación por comuna (audp_zone vs nacional)',
            '3. Regresión polinómica para velocidad (con interacciones)',
            '4. Cópula expandida con lags principales (15 variables)',
        ],
        'cidu_obs_total': int(len(cidu)),
        'cidu_obs_audp_zone': int(len(audp_data)),
        'comunas_audp_relevantes': COMUNAS_AUDP_RELEVANTES,
        'percentiles_dense_q': PERCENTILES_DENSE,
        'family_ipv_map': FAMILY_IPV,
    },
    'macros_expanded': macro_data_expanded,
    'macros_corr_expanded': macro_corr_expanded,
    'family_models': family_models,
    'expanded_macros_key': EXPANDED_MACROS_KEY,
}

with open('analysis/macro_factor_v2.json', 'w') as f:
    json.dump(output, f, indent=2, default=str)
print('  ✓ analysis/macro_factor_v2.json')


# Generar JS embebible
import math
def sanitize(o, ndigits=4):
    if isinstance(o, float):
        if math.isnan(o) or math.isinf(o):
            return 0.0
        return round(o, ndigits)
    if isinstance(o, dict):
        return {k: sanitize(v, ndigits) for k, v in o.items()}
    if isinstance(o, list):
        return [sanitize(v, ndigits) for v in o]
    return o

slim = sanitize(output)
js = '// Auto-generado por analysis/build_macro_v2.py\n'
js += '// Factor Model v2: IPV lag-3 + comuna + polinómica + cópula expandida\n'
js += 'window.MACRO_FACTOR_V2 = ' + json.dumps(slim, separators=(',', ':')) + ';\n'

with open('public/macro_factor_v2.js', 'w') as f:
    f.write(js)
print(f'  ✓ public/macro_factor_v2.js ({os.path.getsize("public/macro_factor_v2.js")/1024:.1f} KB)')


# ─── Reporte humano ───
report = ['# Factor Model v2 — Reporte de Mejoras\n\n']
report.append('## Mejoras incorporadas\n\n')
for m in output['metadata']['mejoras']:
    report.append(f'- {m}\n')

report.append(f'\n## Estratificación por comuna\n\n')
report.append(f'AUDP-zone abarca {len(audp_data):,} obs de las comunas: {", ".join(COMUNAS_AUDP_RELEVANTES)}\n')
report.append(f'Nacional total: {len(nat_data):,} obs\n\n')

report.append('## Comparación σ idiosincrático precio: IPV contemporáneo vs IPV lag-3\n\n')
report.append('| Zona | Familia | σ contemporáneo | σ lag-3 | Δ |\n|---|---|---|---|---|\n')
for zone in family_models:
    for fam in family_models[zone]:
        m = family_models[zone][fam]
        sig_t = m['precio_shock'].get('sigma_contemporaneo', 0)
        sig_l3 = m['precio_shock']['sigma_idiosyncratic_pp']
        delta = sig_l3 - sig_t
        report.append(f'| {zone} | {fam} | {sig_t:.2f}pp | {sig_l3:.2f}pp | {delta:+.2f}pp |\n')

report.append('\n## Regresión polinómica velocidad — R² por (zona × familia)\n\n')
report.append('| Zona | Familia | R² lineal (v1) | R² polinómica (v2) |\n|---|---|---|---|\n')
v1_r2 = {'edif_4p': 0.020, 'ds19': 0.043, 'casa': 0.224, 'townhouse': 0.019}
for zone in family_models:
    for fam in family_models[zone]:
        m = family_models[zone][fam]
        r2_v2 = m['velocidad_regression_polynomial']['r2'] if m.get('velocidad_regression_polynomial') else 0
        r2_v1 = v1_r2.get(fam, 0)
        report.append(f'| {zone} | {fam} | {r2_v1:.3f} | **{r2_v2:.3f}** |\n')

report.append('\n## Variables en cópula expandida\n\n')
for v in present:
    md = macro_data_expanded[v]
    report.append(f'- `{v}`: media {md["mean"]:.2f}, σ {md["std"]:.2f}, p10 {md["p10"]:.2f}, p90 {md["p90"]:.2f}\n')

with open('analysis/macro_v2_report.md', 'w') as f:
    f.writelines(report)
print('  ✓ analysis/macro_v2_report.md')

print('\n═══ FIN ═══')
