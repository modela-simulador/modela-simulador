"""
Análisis lateral: ¿qué dimensiones del Excel TINSA explican varianza
adicional que el modelo actual no captura?

Examina:
- Variabilidad por COMUNA (top 20)
- Variabilidad por # de pisos (deptos)
- Variabilidad por desarrollador (top 20)
- Variabilidad por tipología (estudio, 1D, 2D, etc.)
- Distancia al CBD (DCBD)
- Indicadores de Bienestar (BHT, ACC, AMB, SECON, SEG)

Output: docs/figures/14_extra_dimensions.png + report
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

os.makedirs('docs/figures', exist_ok=True)
sns.set_style('whitegrid')
plt.rcParams.update({'font.size': 9, 'figure.dpi': 130, 'savefig.dpi': 200, 'savefig.bbox': 'tight'})

print('═══ ANÁLISIS DIMENSIONES ADICIONALES TINSA ═══\n')

# Cargar
cidu = pd.read_csv('analysis/data.csv', low_memory=False)
NUM = ['UFM2P', 'UMESP', 'MAGOST', 'DPROM', 'SUPP', 'NPISOS', 'UVEND']
for c in NUM:
    cidu[c] = pd.to_numeric(cidu[c], errors='coerce')
cidu = cidu[(cidu['UFM2P'] > 0) & (cidu['UMESP'] > 0) & (cidu['SUPP'] > 0)].copy()

# ── Por COMUNA ──
print('Top 20 comunas por número de obs y precio mediano:')
comuna = cidu.groupby('NCOM').agg(
    n_obs=('UFM2P', 'count'),
    precio_med=('UFM2P', 'median'),
    precio_p25=('UFM2P', lambda x: x.quantile(0.25)),
    precio_p75=('UFM2P', lambda x: x.quantile(0.75)),
    velocidad_med=('UMESP', 'median'),
).sort_values('n_obs', ascending=False).head(20).reset_index()
print(comuna.to_string(index=False))

# Visualización: precio mediano por comuna
fig, axes = plt.subplots(2, 2, figsize=(15, 10))

# Panel 1: precio mediano por comuna
ax = axes[0, 0]
top15 = comuna.head(15).sort_values('precio_med')
ax.barh(range(len(top15)), top15['precio_med'], color='#2563eb', alpha=0.8, edgecolor='white')
ax.set_yticks(range(len(top15)))
ax.set_yticklabels(top15['NCOM'], fontsize=8)
ax.set_xlabel('Precio mediano UF/m²', fontsize=9)
ax.set_title('Top 15 comunas por # observaciones — precio mediano', fontsize=10, weight='bold')
ax.grid(True, axis='x', alpha=0.3)
# Anotar n_obs
for i, (med, n) in enumerate(zip(top15['precio_med'], top15['n_obs'])):
    ax.text(med + 1, i, f' n={n:,}', va='center', fontsize=7, color='#475569')

# Panel 2: velocidad por NPISOS (solo deptos)
ax = axes[0, 1]
deptos = cidu[cidu['TPROP'] == 'DEPARTAMENTO'].copy()
deptos['piso_bin'] = pd.cut(deptos['NPISOS'], bins=[0, 4, 8, 15, 25, 60],
                              labels=['1-4', '5-8', '9-15', '16-25', '26+'])
piso_stats = deptos.groupby('piso_bin', observed=True).agg(
    n_obs=('UFM2P', 'count'),
    precio_med=('UFM2P', 'median'),
    velocidad_med=('UMESP', 'median')
).reset_index()
ax2 = ax.twinx()
ax.bar(range(len(piso_stats)), piso_stats['precio_med'], color='#3b82f6', alpha=0.7, label='Precio (UF/m²)', width=0.4)
ax2.bar([i + 0.4 for i in range(len(piso_stats))], piso_stats['velocidad_med'], color='#dc2626', alpha=0.7, label='Velocidad (uds/mes)', width=0.4)
ax.set_xticks([i + 0.2 for i in range(len(piso_stats))])
ax.set_xticklabels(piso_stats['piso_bin'])
ax.set_xlabel('# Pisos del edificio', fontsize=9)
ax.set_ylabel('Precio mediano UF/m²', color='#3b82f6', fontsize=9)
ax2.set_ylabel('Velocidad mediana uds/mes', color='#dc2626', fontsize=9)
ax.set_title('Precio y velocidad por # pisos (departamentos, n={})'.format(len(deptos)), fontsize=10, weight='bold')
for i, (n, p) in enumerate(zip(piso_stats['n_obs'], piso_stats['precio_med'])):
    ax.text(i, p + 1, f'n={n:,}', ha='center', fontsize=7, color='#475569')

# Panel 3: distribución del DCBD vs precio
ax = axes[1, 0]
cidu['DCBD'] = pd.to_numeric(cidu['DCBD'], errors='coerce')
sub_dcbd = cidu.dropna(subset=['DCBD', 'UFM2P'])
sub_dcbd = sub_dcbd[(sub_dcbd['DCBD'] < 50000) & (sub_dcbd['UFM2P'] < 200)]
# Bin por distancia
sub_dcbd['dcbd_bin'] = pd.cut(sub_dcbd['DCBD'], bins=[0, 5000, 10000, 15000, 20000, 30000, 50000],
                                labels=['<5km', '5-10km', '10-15km', '15-20km', '20-30km', '>30km'])
dcbd_stats = sub_dcbd.groupby('dcbd_bin', observed=True)['UFM2P'].agg(['median', 'count']).reset_index()
ax.bar(range(len(dcbd_stats)), dcbd_stats['median'], color='#16a34a', alpha=0.8, edgecolor='white')
ax.set_xticks(range(len(dcbd_stats)))
ax.set_xticklabels(dcbd_stats['dcbd_bin'])
ax.set_xlabel('Distancia a estación Tobalaba (CBD)', fontsize=9)
ax.set_ylabel('Precio mediano UF/m²', fontsize=9)
ax.set_title('Precio por distancia al CBD', fontsize=10, weight='bold')
for i, (med, n) in enumerate(zip(dcbd_stats['median'], dcbd_stats['count'])):
    ax.text(i, med + 1, f'n={n:,}', ha='center', fontsize=7, color='#475569')
ax.grid(True, axis='y', alpha=0.3)

# Panel 4: precio vs índice BHT (Bienestar Humano Territorial)
ax = axes[1, 1]
cidu['BHT'] = pd.to_numeric(cidu['BHT'], errors='coerce')
sub_bht = cidu.dropna(subset=['BHT', 'UFM2P'])
sub_bht = sub_bht[(sub_bht['BHT'] >= 0) & (sub_bht['BHT'] <= 1) & (sub_bht['UFM2P'] < 200)]
ax.scatter(sub_bht['BHT'], sub_bht['UFM2P'], alpha=0.05, s=5, color='#7c3aed', edgecolor='none')
# Trend line
z = np.polyfit(sub_bht['BHT'], sub_bht['UFM2P'], 1)
xs = np.linspace(0, 1, 100)
ax.plot(xs, np.polyval(z, xs), color='#dc2626', lw=2, ls='--', label=f'OLS: slope={z[0]:.0f}')
rho, _ = stats.spearmanr(sub_bht['BHT'], sub_bht['UFM2P'])
ax.set_xlabel('Índice BHT (Bienestar Humano Territorial)', fontsize=9)
ax.set_ylabel('Precio UF/m²', fontsize=9)
ax.set_title(f'Precio vs BHT — ρ Spearman = {rho:+.3f}', fontsize=10, weight='bold')
ax.legend(loc='upper left', fontsize=8)
ax.grid(True, alpha=0.3)

plt.suptitle('Dimensiones adicionales TINSA: factores espaciales y estructurales',
             fontsize=12, weight='bold', y=1.0)
plt.tight_layout()
plt.savefig('docs/figures/14_dimensiones_extra.png')
plt.close()


# ── Análisis de varianza explicada por cada dimensión ──
print('\n¿Cuánta varianza del precio TINSA explica cada dimensión?')

results = []
# Comuna
sub = cidu.dropna(subset=['UFM2P', 'NCOM'])
ss_total = ((sub['UFM2P'] - sub['UFM2P'].mean()) ** 2).sum()
ss_within = sub.groupby('NCOM')['UFM2P'].apply(lambda x: ((x - x.mean()) ** 2).sum()).sum()
r2_comuna = 1 - ss_within / ss_total
results.append({'dimension': 'Comuna (NCOM)', 'r2': r2_comuna, 'n': len(sub),
                'interpretacion': f'{r2_comuna*100:.1f}% varianza precio entre comunas'})

# NPISOS
sub = cidu.dropna(subset=['UFM2P', 'NPISOS'])
sub['piso_bin'] = pd.cut(sub['NPISOS'], bins=[0, 4, 8, 15, 25, 60])
ss_total2 = ((sub['UFM2P'] - sub['UFM2P'].mean()) ** 2).sum()
ss_within2 = sub.groupby('piso_bin', observed=True)['UFM2P'].apply(lambda x: ((x - x.mean()) ** 2).sum()).sum()
r2_pisos = 1 - ss_within2 / ss_total2
results.append({'dimension': '# Pisos', 'r2': r2_pisos, 'n': len(sub),
                'interpretacion': f'{r2_pisos*100:.1f}% varianza precio entre rangos de pisos'})

# Tipología
sub = cidu.dropna(subset=['UFM2P', 'TCAT'])
ss_total3 = ((sub['UFM2P'] - sub['UFM2P'].mean()) ** 2).sum()
ss_within3 = sub.groupby('TCAT')['UFM2P'].apply(lambda x: ((x - x.mean()) ** 2).sum()).sum()
r2_tcat = 1 - ss_within3 / ss_total3
results.append({'dimension': 'Tipología (TCAT)', 'r2': r2_tcat, 'n': len(sub),
                'interpretacion': f'{r2_tcat*100:.1f}% varianza precio entre tipologías'})

# Año
sub = cidu.dropna(subset=['UFM2P', 'AÑO'])
ss_total4 = ((sub['UFM2P'] - sub['UFM2P'].mean()) ** 2).sum()
ss_within4 = sub.groupby('AÑO')['UFM2P'].apply(lambda x: ((x - x.mean()) ** 2).sum()).sum()
r2_year = 1 - ss_within4 / ss_total4
results.append({'dimension': 'Año', 'r2': r2_year, 'n': len(sub),
                'interpretacion': f'{r2_year*100:.1f}% varianza precio explicada por año'})

# Familia
def is_townhouse(row):
    return row['TPROP'] == 'TOWNHOUSE' or row['TCAT'] == 'TOWNHOUSE'
cidu['fam'] = 'otros'
cidu.loc[(cidu['TPROP']=='DEPARTAMENTO') & (cidu['NPISOS']<=6) & (cidu['TSUB']=='SIN SUBSIDIO'), 'fam'] = 'edif_4p'
cidu.loc[cidu['TSUB'].astype(str).str.contains('DS19', na=False), 'fam'] = 'ds19'
cidu.loc[(cidu['TPROP']=='CASA') & (cidu['TSUB']=='SIN SUBSIDIO'), 'fam'] = 'casa'
cidu.loc[cidu.apply(is_townhouse, axis=1), 'fam'] = 'townhouse'
sub = cidu.dropna(subset=['UFM2P'])
ss_total5 = ((sub['UFM2P'] - sub['UFM2P'].mean()) ** 2).sum()
ss_within5 = sub.groupby('fam')['UFM2P'].apply(lambda x: ((x - x.mean()) ** 2).sum()).sum()
r2_fam = 1 - ss_within5 / ss_total5
results.append({'dimension': 'Familia', 'r2': r2_fam, 'n': len(sub),
                'interpretacion': f'{r2_fam*100:.1f}% varianza precio explicada por familia'})

# Save
with open('analysis/dimension_variance.json', 'w') as f:
    json.dump(results, f, indent=2)

print('\nVarianza explicada por cada dimensión:')
for r in sorted(results, key=lambda x: -x['r2']):
    print(f'  {r["dimension"]:<20}: R²={r["r2"]:.3f}  ({r["interpretacion"]})')

print('\n✓ docs/figures/14_dimensiones_extra.png generado')
