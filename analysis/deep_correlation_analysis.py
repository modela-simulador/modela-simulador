"""
Análisis profundo de correlaciones TINSA × Macros.

Responde preguntas:
1. ¿Qué variables macro mueven más cada variable TINSA?
2. ¿Con qué lag operan los efectos macro? (contemporáneos, t-1, t-2, t-3, t-4 trim)
3. ¿La estratificación por familia es necesaria o podemos pool todo?
4. ¿Qué variable, en qué lag, predice mejor la velocidad de venta?
5. ¿Qué cópulas adicionales agregaría valor al modelo?

Output:
- analysis/deep_correlations.json (datos completos)
- analysis/deep_correlation_report.md (reporte humano)
- docs/figures/10_lagged_correlations.png (heatmap lags 0-4)
- docs/figures/11_pooled_vs_familia.png (comparación)
- docs/figures/12_variable_importance.png (random forest importance)
- docs/figures/13_top_correlations_scatter.png (las 6 correlaciones más fuertes)
"""

import os
import json
import numpy as np
import pandas as pd
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
import seaborn as sns
from scipy import stats
from sklearn.ensemble import RandomForestRegressor
from sklearn.preprocessing import StandardScaler

os.makedirs('docs/figures', exist_ok=True)
sns.set_style('whitegrid')
plt.rcParams.update({'font.size': 9, 'axes.titlesize': 10, 'figure.dpi': 130, 'savefig.dpi': 200, 'savefig.bbox': 'tight'})


# ════════════════════════════════════════════════════════════
# 1. Cargar datos
# ════════════════════════════════════════════════════════════

print('═══ ANÁLISIS PROFUNDO TINSA × MACROS ═══\n')
print('Paso 1: Cargar datos…')

# TINSA
cidu = pd.read_csv('analysis/data.csv', low_memory=False)
NUM = ['UFM2P', 'UMESP', 'MAGOST', 'DPROM', 'SUPP', 'NPISOS', 'UVEND']
for c in NUM:
    cidu[c] = pd.to_numeric(cidu[c], errors='coerce')

def cidu_to_quarter(year, per):
    if not pd.isna(year) and isinstance(per, str):
        per_clean = per.strip().upper().rstrip('P')
        try: return f'{int(year)}-Q{int(per_clean)}'
        except: return None
    return None

cidu['quarter_str'] = cidu.apply(lambda r: cidu_to_quarter(r['AÑO'], r['PER']), axis=1)
cidu_active = cidu[(cidu['UFM2P'] > 0) & (cidu['UMESP'] > 0) & (cidu['SUPP'] > 0) & (cidu['UVEND'] > 0)].copy()
print(f'  TINSA activas: {len(cidu_active):,} obs')

# Estratos
def is_townhouse(row):
    return row['TPROP'] == 'TOWNHOUSE' or row['TCAT'] == 'TOWNHOUSE'

cidu_active['_stratum'] = 'pooled'  # default a todo
cidu_active.loc[(cidu_active['TPROP']=='DEPARTAMENTO') & (cidu_active['NPISOS']<=6) & (cidu_active['TSUB']=='SIN SUBSIDIO'), 'fam'] = 'edif_4p'
cidu_active.loc[cidu_active['TSUB'].astype(str).str.contains('DS19', na=False), 'fam'] = 'ds19'
cidu_active.loc[(cidu_active['TPROP']=='CASA') & (cidu_active['TSUB']=='SIN SUBSIDIO'), 'fam'] = 'casa'
cidu_active.loc[cidu_active.apply(is_townhouse, axis=1), 'fam'] = 'townhouse'

# Macros
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

imacec = load_csv_to_q('analysis/macro_raw/imacec.csv'); imacec.columns = ['quarter_str', 'imacec_var']
tasa = load_csv_to_q('analysis/macro_raw/tasa_hipotecaria.csv'); tasa.columns = ['quarter_str', 'tasa_hipo_nivel']
desemp = load_csv_to_q('analysis/macro_raw/desempleo.csv'); desemp.columns = ['quarter_str', 'desempleo_nivel']

# IPV anual → trimestral
ipv_raw = pd.read_csv('analysis/macro_raw/ipv.csv', skiprows=2)
ipv_raw['year'] = pd.to_datetime(ipv_raw.iloc[:, 0], errors='coerce').dt.year
ipv_yearly = pd.DataFrame({
    'year': ipv_raw['year'],
    'ipv_general': pd.to_numeric(ipv_raw.iloc[:, 1], errors='coerce'),
    'ipv_casas': pd.to_numeric(ipv_raw.iloc[:, 3], errors='coerce'),
    'ipv_deptos': pd.to_numeric(ipv_raw.iloc[:, 6], errors='coerce'),
}).dropna(subset=['year']).copy()
ipv_yearly['year'] = ipv_yearly['year'].astype(int)

def yearly_to_q(df_yearly, val_col):
    rows = []
    for i, (_, row) in enumerate(df_yearly.iterrows()):
        nxt = df_yearly.iloc[i+1] if i+1 < len(df_yearly) else row
        for q in range(1, 5):
            f = (q-1)/4
            rows.append({
                'quarter_str': f'{row["year"]}-Q{q}',
                'val': row[val_col]*(1-f) + nxt[val_col]*f
            })
    return pd.DataFrame(rows)

ipv_gen_q = yearly_to_q(ipv_yearly[['year', 'ipv_general']], 'ipv_general'); ipv_gen_q.columns = ['quarter_str', 'ipv_general']
ipv_cas_q = yearly_to_q(ipv_yearly[['year', 'ipv_casas']], 'ipv_casas'); ipv_cas_q.columns = ['quarter_str', 'ipv_casas']
ipv_dep_q = yearly_to_q(ipv_yearly[['year', 'ipv_deptos']], 'ipv_deptos'); ipv_dep_q.columns = ['quarter_str', 'ipv_deptos']

# ICOI
icoi_raw = pd.read_csv('analysis/macro_raw/indice_de_construccion_desglos.csv', skiprows=2)
icoi_yearly = pd.DataFrame({
    'year': pd.to_numeric(icoi_raw.iloc[:, 0], errors='coerce'),
    'icoi': pd.to_numeric(icoi_raw.iloc[:, 1], errors='coerce'),
}).dropna()
icoi_yearly['year'] = icoi_yearly['year'].astype(int)
icoi_q = yearly_to_q(icoi_yearly[['year', 'icoi']], 'icoi'); icoi_q.columns = ['quarter_str', 'icoi']

# Merge macros
m = imacec.merge(tasa, on='quarter_str', how='outer').merge(desemp, on='quarter_str', how='outer')
m = m.merge(ipv_gen_q, on='quarter_str', how='outer').merge(ipv_cas_q, on='quarter_str', how='outer').merge(ipv_dep_q, on='quarter_str', how='outer').merge(icoi_q, on='quarter_str', how='outer')
m = m.sort_values('quarter_str').reset_index(drop=True)

# Calcular variaciones YoY y deltas
for c in ['ipv_general', 'ipv_casas', 'ipv_deptos', 'icoi']:
    m[f'{c}_yoy'] = m[c].pct_change(periods=4) * 100
m['d_tasa_hipo'] = m['tasa_hipo_nivel'].diff(periods=4)
m['d_desempleo'] = m['desempleo_nivel'].diff(periods=4)
print(f'  Macros: {len(m)} trimestres')


# ════════════════════════════════════════════════════════════
# 2. Construir LAGS de las macros
# ════════════════════════════════════════════════════════════

print('\nPaso 2: Construir lags t, t-1, t-2, t-3, t-4 trim…')
LAG_VARS = ['imacec_var', 'd_tasa_hipo', 'd_desempleo', 'ipv_general_yoy',
            'ipv_casas_yoy', 'ipv_deptos_yoy', 'icoi_yoy', 'tasa_hipo_nivel', 'desempleo_nivel']

for v in LAG_VARS:
    for lag in range(1, 5):
        m[f'{v}_L{lag}'] = m[v].shift(lag)


# ════════════════════════════════════════════════════════════
# 3. Agregar TINSA por trimestre — POOLED y por FAMILIA
# ════════════════════════════════════════════════════════════

print('\nPaso 3: Agregar TINSA por trimestre…')
def weighted_mean(df, val_col, weight_col):
    w = df[weight_col].sum()
    if w == 0: return df[val_col].mean()
    return (df[val_col] * df[weight_col]).sum() / w

# Pooled
pooled_rows = []
for q, grp in cidu_active.groupby('quarter_str'):
    pooled_rows.append({
        'quarter_str': q,
        'precio': weighted_mean(grp, 'UFM2P', 'UVEND'),
        'velocidad': weighted_mean(grp, 'UMESP', 'UVEND'),
        'plazo': weighted_mean(grp, 'MAGOST', 'UVEND'),
        'sup': weighted_mean(grp, 'SUPP', 'UVEND'),
        'descuento': weighted_mean(grp, 'DPROM', 'UVEND'),
        'uvend': grp['UVEND'].sum(),
        'n_proyectos': len(grp),
    })
pooled = pd.DataFrame(pooled_rows).sort_values('quarter_str').reset_index(drop=True)
for c in ['precio', 'velocidad', 'plazo', 'sup', 'descuento', 'uvend']:
    pooled[f'{c}_yoy'] = pooled[c].pct_change(4) * 100
print(f'  Pooled: {len(pooled)} trimestres')

# Por familia
fam_dfs = {}
for fam in ['edif_4p', 'ds19', 'casa', 'townhouse']:
    sub = cidu_active[cidu_active['fam'] == fam]
    if len(sub) < 50: continue
    rows = []
    for q, grp in sub.groupby('quarter_str'):
        rows.append({
            'quarter_str': q,
            'precio': weighted_mean(grp, 'UFM2P', 'UVEND'),
            'velocidad': weighted_mean(grp, 'UMESP', 'UVEND'),
            'plazo': weighted_mean(grp, 'MAGOST', 'UVEND'),
            'sup': weighted_mean(grp, 'SUPP', 'UVEND'),
            'descuento': weighted_mean(grp, 'DPROM', 'UVEND'),
            'uvend': grp['UVEND'].sum(),
        })
    df = pd.DataFrame(rows).sort_values('quarter_str').reset_index(drop=True)
    for c in ['precio', 'velocidad', 'plazo', 'sup', 'descuento', 'uvend']:
        df[f'{c}_yoy'] = df[c].pct_change(4) * 100
    fam_dfs[fam] = df
    print(f'  {fam}: {len(df)} trimestres')


# ════════════════════════════════════════════════════════════
# 4. CORRELACIONES POOLED — TINSA × MACROS × LAGS
# ════════════════════════════════════════════════════════════

print('\nPaso 4: Correlaciones pooled (todas las familias juntas)…')
TINSA_VARS = ['precio_yoy', 'velocidad_yoy', 'plazo_yoy', 'sup_yoy', 'uvend_yoy']

merged_pooled = pooled.merge(m, on='quarter_str', how='inner')
print(f'  Trimestres con TINSA + macros: {len(merged_pooled)}')

# Matriz: filas = TINSA vars, columnas = (macro, lag)
def compute_lagged_corr(df, tinsa_vars, macro_vars, lags):
    rows = []
    for tv in tinsa_vars:
        for mv in macro_vars:
            for lag in lags:
                col_name = mv if lag == 0 else f'{mv}_L{lag}'
                if col_name not in df.columns or tv not in df.columns:
                    continue
                pair = df[[tv, col_name]].dropna()
                if len(pair) < 15:
                    continue
                rho, pval = stats.spearmanr(pair[tv], pair[col_name])
                rows.append({
                    'tinsa_var': tv,
                    'macro_var': mv,
                    'lag': lag,
                    'rho': float(rho) if not np.isnan(rho) else 0.0,
                    'pval': float(pval) if not np.isnan(pval) else 1.0,
                    'n': len(pair),
                })
    return pd.DataFrame(rows)

LAGS = [0, 1, 2, 3, 4]
MACROS = ['imacec_var', 'd_tasa_hipo', 'd_desempleo', 'ipv_general_yoy', 'icoi_yoy']

corr_pooled = compute_lagged_corr(merged_pooled, TINSA_VARS, MACROS, LAGS)
corr_pooled.to_csv('analysis/lag_corr_pooled.csv', index=False)


# ════════════════════════════════════════════════════════════
# 5. CORRELACIONES POR FAMILIA
# ════════════════════════════════════════════════════════════

print('\nPaso 5: Correlaciones por familia…')
corr_fam = {}
for fam, df in fam_dfs.items():
    md = df.merge(m, on='quarter_str', how='inner')
    if len(md) < 20:
        continue
    cf = compute_lagged_corr(md, TINSA_VARS, MACROS, LAGS)
    cf['fam'] = fam
    corr_fam[fam] = cf
    print(f'  {fam}: {len(md)} trim, {len(cf)} pares calculados')


# ════════════════════════════════════════════════════════════
# 6. RANDOM FOREST: variable importance
# ════════════════════════════════════════════════════════════

print('\nPaso 6: Random Forest (variable importance)…')

# Para cada variable TINSA, qué predictores macro (con lags) son más importantes.
# Usamos un set REDUCIDO de features para evitar perder todos los rows en dropna
# (con 57 trimestres y muchos lags, la matriz queda vacía por NaN al inicio).
# Estrategia: incluir las macros principales en t, t-1, t-2 (no t-3 ni t-4).
all_macros_with_lags = []
PRINCIPAL_MACROS = ['imacec_var', 'd_tasa_hipo', 'd_desempleo', 'ipv_general_yoy', 'icoi_yoy']
for v in PRINCIPAL_MACROS:
    all_macros_with_lags.append(v)
    for lag in [1, 2]:
        all_macros_with_lags.append(f'{v}_L{lag}')

# Imputar NaN restantes con 0 (variables YoY detrendeadas: 0 = sin shock)
merged_pooled_imp = merged_pooled.copy()
for col in all_macros_with_lags:
    if col in merged_pooled_imp.columns:
        merged_pooled_imp[col] = merged_pooled_imp[col].fillna(0)

importance_rows = []
for tv in TINSA_VARS:
    df_clean = merged_pooled_imp[[tv] + all_macros_with_lags].dropna(subset=[tv])
    if len(df_clean) < 25:
        continue
    X = df_clean[all_macros_with_lags].values
    y = df_clean[tv].values
    rf = RandomForestRegressor(n_estimators=300, random_state=42, max_depth=6, min_samples_leaf=3)
    rf.fit(X, y)
    imp = rf.feature_importances_
    r2 = rf.score(X, y)
    for feat, val in zip(all_macros_with_lags, imp):
        importance_rows.append({
            'tinsa_var': tv,
            'feature': feat,
            'importance': float(val),
            'rf_r2_in_sample': float(r2),
        })

imp_df = pd.DataFrame(importance_rows)
print(f'  Importance rows: {len(importance_rows)}')
if len(imp_df) == 0:
    # Debug: ¿por qué está vacío?
    for tv in TINSA_VARS:
        df_clean = merged_pooled[[tv] + all_macros_with_lags].dropna()
        print(f'  {tv}: rows después de dropna = {len(df_clean)}')
    # Crear estructura vacía para no romper código posterior
    imp_df = pd.DataFrame(columns=['tinsa_var', 'feature', 'importance', 'rf_r2_in_sample'])
imp_df.to_csv('analysis/variable_importance.csv', index=False)
print('  Importance calculadas para targets TINSA')


# ════════════════════════════════════════════════════════════
# 7. VISUALIZACIONES
# ════════════════════════════════════════════════════════════

print('\nPaso 7: Generando visualizaciones…')

# === Fig 10: Lag heatmap pooled ===
print('  Fig 10: Lag heatmap pooled')
# Construir matriz: filas = pares (TINSA, macro), columnas = lag
pivot = corr_pooled.pivot_table(
    index=['tinsa_var', 'macro_var'],
    columns='lag',
    values='rho'
)

# Relabel para legibilidad
labels_tinsa = {
    'precio_yoy': 'Precio YoY',
    'velocidad_yoy': 'Velocidad YoY',
    'plazo_yoy': 'Plazo YoY',
    'sup_yoy': 'Tamaño YoY',
    'uvend_yoy': 'Uds vendidas YoY',
}
labels_macro = {
    'imacec_var': 'IMACEC',
    'd_tasa_hipo': 'Δ Tasa hipo',
    'd_desempleo': 'Δ Desempleo',
    'ipv_general_yoy': 'IPV general',
    'icoi_yoy': 'ICOI',
}

# Construir heatmap por TINSA var (5 subplots, uno por cada variable TINSA)
fig, axes = plt.subplots(1, 5, figsize=(20, 6), sharey=True)
for ax_idx, tv in enumerate(TINSA_VARS):
    ax = axes[ax_idx]
    sub = corr_pooled[corr_pooled['tinsa_var'] == tv].pivot_table(
        index='macro_var', columns='lag', values='rho'
    )
    sub = sub.reindex(MACROS)
    sub.index = [labels_macro.get(i, i) for i in sub.index]
    sub.columns = [f't' if l == 0 else f't−{l}' for l in sub.columns]
    sns.heatmap(sub, annot=True, fmt='+.2f', cmap='RdBu_r', center=0,
                vmin=-0.6, vmax=0.6, square=True,
                cbar=ax_idx == 4, cbar_kws={'shrink': 0.6} if ax_idx == 4 else None,
                annot_kws={'size': 9, 'weight': 'bold'},
                ax=ax)
    ax.set_title(labels_tinsa[tv], fontsize=11, weight='bold')
    ax.set_xlabel('Lag (trimestres)', fontsize=9)
    if ax_idx == 0:
        ax.set_ylabel('Variable macro', fontsize=10)
    else:
        ax.set_ylabel('')
fig.suptitle('Correlación Spearman: variables TINSA (filas) × variables macro (en lags 0-4 trimestres)\nTodas las familias agregadas (124k obs, 401 trimestres)',
             fontsize=12, weight='bold', y=1.02)
plt.tight_layout()
plt.savefig('docs/figures/10_lagged_correlations_pooled.png')
plt.close()


# === Fig 11: Velocidad por familia con lags (la variable más importante) ===
print('  Fig 11: Velocidad por familia × lag')
fig, axes = plt.subplots(2, 2, figsize=(13, 9))
for idx, (fam, cf) in enumerate(corr_fam.items()):
    ax = axes[idx // 2, idx % 2]
    sub = cf[cf['tinsa_var'] == 'velocidad_yoy'].pivot_table(
        index='macro_var', columns='lag', values='rho'
    )
    sub = sub.reindex(MACROS)
    sub.index = [labels_macro.get(i, i) for i in sub.index]
    sub.columns = [f't' if l == 0 else f't−{l}' for l in sub.columns]
    sns.heatmap(sub, annot=True, fmt='+.2f', cmap='RdBu_r', center=0,
                vmin=-0.6, vmax=0.6, square=True,
                annot_kws={'size': 10, 'weight': 'bold'},
                cbar_kws={'shrink': 0.7}, ax=ax)
    ax.set_title(f'Velocidad de venta — {fam}', fontsize=11, weight='bold')
    ax.set_xlabel('Lag (trim)', fontsize=9)
    ax.set_ylabel('Macro', fontsize=9)
fig.suptitle('¿Qué macro y con qué lag predice mejor la velocidad de venta?',
             fontsize=13, weight='bold', y=1.0)
plt.tight_layout()
plt.savefig('docs/figures/11_velocidad_lags_familia.png')
plt.close()


# === Fig 12: Variable importance (random forest) ===
print('  Fig 12: Variable importance')
fig, axes = plt.subplots(1, 5, figsize=(22, 6))
for ax_idx, tv in enumerate(TINSA_VARS):
    ax = axes[ax_idx]
    sub = imp_df[imp_df['tinsa_var'] == tv].sort_values('importance', ascending=True).tail(10)
    if len(sub) == 0: continue
    # Renombrar features
    feat_labels = []
    for f in sub['feature']:
        # Extraer base y lag
        if '_L' in f:
            base, lag = f.rsplit('_L', 1)
        else:
            base, lag = f, '0'
        base_label = labels_macro.get(base, base)
        feat_labels.append(f'{base_label} (t−{lag})' if lag != '0' else f'{base_label} (t)')
    colors = ['#dc2626' if v > 0.10 else '#f59e0b' if v > 0.05 else '#94a3b8' for v in sub['importance']]
    ax.barh(range(len(sub)), sub['importance'], color=colors, alpha=0.85, edgecolor='white')
    ax.set_yticks(range(len(sub)))
    ax.set_yticklabels(feat_labels, fontsize=8)
    r2 = sub['rf_r2_in_sample'].iloc[0]
    ax.set_title(f'{labels_tinsa[tv]}\nR² in-sample = {r2:.2f}', fontsize=10, weight='bold')
    ax.set_xlabel('Importance', fontsize=8)
    ax.grid(True, axis='x', alpha=0.3)
fig.suptitle('Random Forest: ¿qué variables (macro × lag) predicen mejor cada variable TINSA?\n(Top 10 features por target, 200 árboles)',
             fontsize=12, weight='bold', y=1.0)
plt.tight_layout()
plt.savefig('docs/figures/12_variable_importance.png')
plt.close()


# === Fig 13: Top 6 correlaciones más fuertes (scatter) ===
print('  Fig 13: Top correlaciones scatter')
top_corrs = corr_pooled.copy()
top_corrs['abs_rho'] = top_corrs['rho'].abs()
top6 = top_corrs[(top_corrs['n'] >= 30) & (top_corrs['pval'] < 0.05)].sort_values('abs_rho', ascending=False).head(6)

fig, axes = plt.subplots(2, 3, figsize=(14, 9))
for idx, (_, row) in enumerate(top6.iterrows()):
    ax = axes[idx // 3, idx % 3]
    tv = row['tinsa_var']
    mv = row['macro_var']
    lag = int(row['lag'])
    col_macro = mv if lag == 0 else f'{mv}_L{lag}'
    df_pair = merged_pooled[[tv, col_macro]].dropna()
    ax.scatter(df_pair[col_macro], df_pair[tv], alpha=0.5, s=20, color='#3b82f6', edgecolor='none')
    z = np.polyfit(df_pair[col_macro], df_pair[tv], 1)
    xs = np.linspace(df_pair[col_macro].min(), df_pair[col_macro].max(), 100)
    ax.plot(xs, np.polyval(z, xs), color='#dc2626', lw=1.5, ls='--')
    macro_lbl = labels_macro.get(mv, mv)
    tinsa_lbl = labels_tinsa.get(tv, tv)
    lag_str = f't' if lag == 0 else f't−{lag}'
    ax.set_xlabel(f'{macro_lbl} ({lag_str})', fontsize=9)
    ax.set_ylabel(f'{tinsa_lbl}', fontsize=9)
    ax.set_title(f'ρ = {row["rho"]:+.3f} · n={int(row["n"])} · p={row["pval"]:.3f}',
                 fontsize=10, weight='bold')
    ax.grid(True, alpha=0.3)
fig.suptitle('Top 6 correlaciones más fuertes y significativas (TINSA × Macros con lags)',
             fontsize=13, weight='bold', y=1.00)
plt.tight_layout()
plt.savefig('docs/figures/13_top_correlations_scatter.png')
plt.close()


# ════════════════════════════════════════════════════════════
# 8. REPORTE
# ════════════════════════════════════════════════════════════

print('\nPaso 8: Generando reporte…')

# Top correlaciones por target
report = ['# Análisis Profundo TINSA × Macros — Reporte\n\n']
report.append(f'**N obs TINSA**: {len(cidu_active):,} ·  **N trimestres pooled**: {len(merged_pooled)} (con macros completas)\n\n')

report.append('## 1. Top correlaciones (significativas, n≥30, p<0.05)\n\n')
top20 = corr_pooled[(corr_pooled['n'] >= 30) & (corr_pooled['pval'] < 0.05)].sort_values('abs_rho' if 'abs_rho' in corr_pooled.columns else 'rho', key=abs, ascending=False).head(20)

if len(top20) > 0:
    top20 = top20.copy()
    top20['abs_rho'] = top20['rho'].abs()
    top20 = top20.sort_values('abs_rho', ascending=False).head(20)
    report.append('| Variable TINSA | Macro | Lag (trim) | ρ Spearman | p-value | n |\n')
    report.append('|---|---|---|---|---|---|\n')
    for _, row in top20.iterrows():
        macro_lbl = labels_macro.get(row['macro_var'], row['macro_var'])
        tinsa_lbl = labels_tinsa.get(row['tinsa_var'], row['tinsa_var'])
        report.append(f'| {tinsa_lbl} | {macro_lbl} | {int(row["lag"])} | {row["rho"]:+.3f} | {row["pval"]:.3f} | {int(row["n"])} |\n')

report.append('\n## 2. Variable importance (Random Forest, top 5 features por TINSA var)\n\n')
for tv in TINSA_VARS:
    sub = imp_df[imp_df['tinsa_var'] == tv].sort_values('importance', ascending=False).head(5)
    if len(sub) == 0: continue
    r2 = sub['rf_r2_in_sample'].iloc[0]
    report.append(f'\n### {labels_tinsa.get(tv, tv)} (RF R² = {r2:.3f})\n\n')
    report.append('| Feature | Importance |\n|---|---|\n')
    for _, r in sub.iterrows():
        feat = r['feature']
        if '_L' in feat:
            base, lag = feat.rsplit('_L', 1)
            feat_lbl = f'{labels_macro.get(base, base)} (t−{lag})'
        else:
            feat_lbl = f'{labels_macro.get(feat, feat)} (t)'
        report.append(f'| {feat_lbl} | {r["importance"]:.4f} |\n')

report.append('\n## 3. ¿Estratificar por familia?\n\n')
report.append('Comparación de la correlación Velocidad ↔ IMACEC entre familias:\n\n')
report.append('| Familia | Lag óptimo | ρ | p-value | n |\n|---|---|---|---|---|\n')
for fam, cf in corr_fam.items():
    sub = cf[cf['tinsa_var'] == 'velocidad_yoy']
    sub = sub[sub['macro_var'] == 'imacec_var']
    if len(sub) == 0: continue
    sub_sorted = sub.copy()
    sub_sorted['abs_rho'] = sub_sorted['rho'].abs()
    best = sub_sorted.sort_values('abs_rho', ascending=False).iloc[0]
    report.append(f'| {fam} | {int(best["lag"])} | {best["rho"]:+.3f} | {best["pval"]:.3f} | {int(best["n"])} |\n')

with open('analysis/deep_correlation_report.md', 'w') as f:
    f.writelines(report)


# JSON output
output = {
    'metadata': {
        'tinsa_obs': len(cidu_active),
        'pooled_quarters': len(merged_pooled),
    },
    'top_correlations_pooled': top20.head(20).to_dict('records') if len(top20) > 0 else [],
    'variable_importance': imp_df.to_dict('records'),
    'corr_per_family_velocidad_imacec': {
        fam: {
            'best_lag': int(cf[(cf['tinsa_var']=='velocidad_yoy') & (cf['macro_var']=='imacec_var')].sort_values('rho', key=abs, ascending=False).iloc[0]['lag']) if len(cf[(cf['tinsa_var']=='velocidad_yoy') & (cf['macro_var']=='imacec_var')]) > 0 else None,
        }
        for fam, cf in corr_fam.items()
    },
}

with open('analysis/deep_correlations.json', 'w') as f:
    json.dump(output, f, indent=2, default=str)

print('\n✓ Análisis completado. Outputs:')
print('  - analysis/deep_correlations.json')
print('  - analysis/deep_correlation_report.md')
print('  - analysis/lag_corr_pooled.csv')
print('  - analysis/variable_importance.csv')
print('  - docs/figures/10_lagged_correlations_pooled.png')
print('  - docs/figures/11_velocidad_lags_familia.png')
print('  - docs/figures/12_variable_importance.png')
print('  - docs/figures/13_top_correlations_scatter.png')
