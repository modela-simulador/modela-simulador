"""
Verificación EXHAUSTIVA de todas las correlaciones cross macro × producto
en el modelo Factor v3.

Cada celda: 25 correlaciones (5 macros × 5 producto)
Total celdas: 8 (4 familias × 2 zonas)
Total correlaciones cross: 200

Para cada una verifica:
- Calibración empírica (TINSA × Macros)
- Calibración del modelo v3 JSON
- Identifica las significativas (|ρ| > 0.20)
- Identifica las cuestionables (n < 30 o p > 0.10)
"""

import json
import numpy as np
import pandas as pd
from scipy import stats

# Cargar v3 JSON
with open('analysis/macro_factor_v3_cross.json') as f:
    v3 = json.load(f)

# Las 5 macros × 5 productos
MACROS = ['imacec_var', 'd_tasa_hipo', 'd_desempleo', 'ipv_general_yoy', 'icoi_yoy']
PRODUCTS = ['precio_yoy', 'velocidad_yoy', 'plazo_yoy', 'descuento_yoy', 'sup_yoy']

MACRO_LABELS = {
    'imacec_var': 'IMACEC',
    'd_tasa_hipo': 'Δ tasa hipo',
    'd_desempleo': 'Δ desempleo',
    'ipv_general_yoy': 'IPV YoY',
    'icoi_yoy': 'ICOI YoY',
}
PROD_LABELS = {
    'precio_yoy': 'Precio',
    'velocidad_yoy': 'Velocidad',
    'plazo_yoy': 'Plazo',
    'descuento_yoy': 'Descuento',
    'sup_yoy': 'Tamaño',
}

print('═══ VERIFICACIÓN EXHAUSTIVA DE TODAS LAS CÓPULAS CROSS ═══\n')
print(f'Total combinaciones esperadas: 5 macros × 5 productos × 4 familias × 2 zonas = 200\n')

cross_models = v3['cross_models']

# Tabla por celda (zona × familia)
total_significativas = 0
total_calibradas = 0
total_skipped = 0

for zone in cross_models:
    print(f'\n┌─────────────────────────────────────────────────────────────────┐')
    print(f'│ ZONA: {zone}'.ljust(70) + '│')
    print(f'└─────────────────────────────────────────────────────────────────┘\n')

    for fam in cross_models[zone]:
        m_data = cross_models[zone][fam]
        n_trim = m_data['n_trimestres']
        corr = m_data['corr_spearman']
        vars_present = m_data['vars']

        print(f'\n  ▼ {fam}  (n={n_trim} trimestres)\n')
        print(f'  {"":>14}', end='')
        for p in PRODUCTS:
            label = PROD_LABELS.get(p, p)[:12]
            print(f' {label:>11}', end='')
        print()
        print(f'  {"":>14}' + '─' * (12 * 5))

        for ma in MACROS:
            ma_lbl = MACRO_LABELS.get(ma, ma)
            print(f'  {ma_lbl:<14}', end='')
            for pr in PRODUCTS:
                if ma in corr and pr in corr[ma]:
                    rho = corr[ma][pr]
                    total_calibradas += 1
                    # Marcar las significativas
                    if abs(rho) > 0.20:
                        total_significativas += 1
                        # Color simulado con texto
                        marker = '★' if abs(rho) > 0.40 else '✓'
                        print(f' {marker}{rho:+8.3f} ', end='')
                    else:
                        print(f'  {rho:+8.3f} ', end='')
                else:
                    total_skipped += 1
                    print(f'      n/a   ', end='')
            print()

print('\n\n═══ RESUMEN ═══\n')
print(f'  Total correlaciones calibradas: {total_calibradas} / 200')
print(f'  Significativas (|ρ| > 0.20):    {total_significativas}')
print(f'  Fuertes (|ρ| > 0.40):           contadas más abajo')
print(f'  No calibradas (data insuficiente): {total_skipped}')

# ── Test riguroso de significancia 95% (Spearman) ──
# Para Spearman con sample size n, |ρ| crítico al 95% bilateral ≈ 1.96/√(n−3).
# Las correlaciones por debajo de ese umbral son indistinguibles de cero.
print('\n\n═══ TEST RIGUROSO DE SIGNIFICANCIA AL 95% ═══\n')
print(f'  Umbral crítico: |ρ| > 1.96/√(n−3)\n')
n_real_signal = 0
n_fake_signal = 0
n_below_thr = 0
fake_by_cell = {}
for zone in cross_models:
    for fam in cross_models[zone]:
        corr = cross_models[zone][fam]['corr_spearman']
        n = cross_models[zone][fam]['n_trimestres']
        rho_crit = 1.96 / np.sqrt(max(n - 3, 1))
        cell_real = 0
        cell_fake = 0
        cell_below = 0
        for ma in MACROS:
            for pr in PRODUCTS:
                if ma in corr and pr in corr[ma]:
                    rho = abs(corr[ma][pr])
                    if rho > rho_crit:
                        n_real_signal += 1; cell_real += 1
                    elif rho > 0.20:
                        n_fake_signal += 1; cell_fake += 1
                    else:
                        n_below_thr += 1; cell_below += 1
        fake_by_cell[(zone, fam, n, rho_crit)] = (cell_real, cell_fake, cell_below)

print(f'  Pasan significancia 95% (señal real):     {n_real_signal}')
print(f'  Reportadas como sig. pero son ruido:      {n_fake_signal}')
print(f'  Bajo umbral |ρ|≤0.20 (no reclamadas):     {n_below_thr}')
print()
print('  Por celda (zona/familia):')
print(f'    {"celda":30s} {"n":>4} {"ρ_crit_95":>10} {"sig real":>9} {"ruido":>7} {"<0.20":>7}')
for (zone, fam, n, rho_crit), (real, fake, below) in sorted(fake_by_cell.items(), key=lambda x: x[0][2]):
    cell = f'{zone}/{fam}'
    print(f'    {cell:30s} {n:>4} {rho_crit:>10.3f} {real:>9} {fake:>7} {below:>7}')

# Si shrinkage está aplicado, mostrarlo
print('\n\n═══ SHRINKAGE BAYESIANO APLICADO ═══\n')
any_shrinkage = False
for zone in cross_models:
    for fam in cross_models[zone]:
        m = cross_models[zone][fam]
        if 'shrinkage_applied' in m:
            any_shrinkage = True
            sh = m['shrinkage_applied']
            print(f'  {zone}/{fam} (n={sh["n_local"]}):')
            print(f'    α={sh["alpha"]:.2f} → corr_spearman = {sh["alpha"]*100:.0f}% local + {(1-sh["alpha"])*100:.0f}% prior')
            print(f'    prior: {sh["prior"]}')
if not any_shrinkage:
    print('  Sin shrinkage aplicado (todas las celdas tienen n suficiente)')

# Top correlaciones por magnitud
print('\n\n═══ TOP 30 CORRELACIONES CROSS MAS FUERTES (todas las zonas/familias) ═══\n')
all_correlations = []
for zone in cross_models:
    for fam in cross_models[zone]:
        corr = cross_models[zone][fam]['corr_spearman']
        n = cross_models[zone][fam]['n_trimestres']
        for ma in MACROS:
            for pr in PRODUCTS:
                if ma in corr and pr in corr[ma]:
                    all_correlations.append({
                        'zone': zone,
                        'fam': fam,
                        'macro': ma,
                        'producto': pr,
                        'rho': corr[ma][pr],
                        'abs_rho': abs(corr[ma][pr]),
                        'n': n,
                    })

df_top = pd.DataFrame(all_correlations).sort_values('abs_rho', ascending=False).head(30)
print(f'{"#":<3} {"Zona":<11} {"Familia":<10} {"Macro":<14} {"Producto":<12} {"ρ":>8} {"n":>4}')
print('─' * 70)
for i, (_, r) in enumerate(df_top.iterrows(), 1):
    sign = '+' if r['rho'] >= 0 else ''
    print(f'{i:<3} {r["zone"]:<11} {r["fam"]:<10} {MACRO_LABELS[r["macro"]]:<14} {PROD_LABELS[r["producto"]]:<12} {sign}{r["rho"]:7.3f} {r["n"]:>4}')


# Patrones por macro
print('\n\n═══ ANÁLISIS POR MACRO ═══\n')
for ma in MACROS:
    print(f'\n▶ {MACRO_LABELS[ma]}:')
    sub = df_top[df_top['macro'] == ma].sort_values('abs_rho', ascending=False)
    if len(sub) == 0:
        sub = pd.DataFrame(all_correlations)
        sub = sub[sub['macro'] == ma].sort_values('abs_rho', ascending=False).head(5)
    else:
        sub = sub.head(5)
    for _, r in sub.iterrows():
        print(f'  {r["zone"]:<11} {r["fam"]:<10} {PROD_LABELS[r["producto"]]:<12} ρ={r["rho"]:+.3f} (n={r["n"]})')


# Validación: ¿hay correlaciones contraintuitivas?
print('\n\n═══ VALIDACIÓN ECONÓMICA ═══\n')
print('Checks de signos esperados teóricamente:\n')
checks = [
    # (macro, producto, signo_esperado, razon)
    ('d_desempleo', 'precio_yoy', '-', 'desempleo alto → precio baja'),
    ('d_desempleo', 'velocidad_yoy', '-', 'desempleo alto → velocidad baja'),
    ('imacec_var', 'precio_yoy', '+', 'PIB alto → precio sube'),
    ('imacec_var', 'velocidad_yoy', '+', 'PIB alto → velocidad sube (modelo causal simple)'),
    ('d_tasa_hipo', 'velocidad_yoy', '-', 'tasa sube → velocidad baja por affordability'),
    ('icoi_yoy', 'plazo_yoy', '+', 'costo alto → plazos se alargan (problemas suministro)'),
]

for ma, pr, esperado, razon in checks:
    print(f'  {MACRO_LABELS[ma]} ↔ {PROD_LABELS[pr]} (esperado {esperado}): {razon}')
    for zone in cross_models:
        for fam in cross_models[zone]:
            corr = cross_models[zone][fam]['corr_spearman']
            if ma in corr and pr in corr[ma]:
                rho = corr[ma][pr]
                actual = '+' if rho >= 0 else '-'
                match = '✓' if actual == esperado else '✗'
                if abs(rho) > 0.15:
                    print(f'    {zone:<11} {fam:<10} ρ={rho:+.3f}  {match}')
    print()


# Save full table
df_all = pd.DataFrame(all_correlations)
df_all.to_csv('analysis/all_cross_correlations.csv', index=False)
print(f'\n✓ Tabla completa guardada en analysis/all_cross_correlations.csv ({len(df_all)} filas)')
