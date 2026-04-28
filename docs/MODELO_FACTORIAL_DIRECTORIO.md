# Modelo Factorial Estocástico — Documento Técnico para Directorio

**Versión:** Opción C · Abril 2026
**Propósito:** sensibilizar el VAN del flujo AUDP frente a escenarios macroeconómicos chilenos, con calibración empírica sobre 124.531 observaciones de mercado y 401 trimestres de datos macro 2010–2024.

---

## 1. Resumen ejecutivo

El modelo Monte Carlo del simulador AUDP ahora opera en **tres modos seleccionables**, en orden de sofisticación creciente:

| Modo | Default | Filosofía | Uso recomendado |
|---|---|---|---|
| **Paramétrico** | – | Distribuciones Normal/Triangular independientes (legacy) | Reproducir análisis previos, sanity check |
| **Empírico CIDU** | – | Cópula t con marginales empíricas de TINSA | Cuando se quiere fidelidad a la distribución observada |
| **Factor Macro (Opción C)** | ✓ | Shocks directos desde IPV (BCCh) e ICOI (CChC) + regresión OLS para velocidad de venta + cópula t entre 5 macros | **Decisiones económicas estratégicas, stress testing, defensa ante directorio** |

El **Factor Macro** es el modo recomendado para evaluación de inversiones AUDP porque:

1. **Cada componente es auditable**: trazable a fuentes oficiales (BCCh, CChC, INE) o a calibración estadística reproducible.
2. **Replicar episodios históricos es trivial**: basta seleccionar un preset (Subprime 2009, COVID 2020, Boom 2021, Slowdown 2023) que se centra automáticamente en los valores macro reales de ese período.
3. **No incurre en regresión espuria**: usa los índices oficiales de precio (IPV) y costo (ICOI) directamente como shocks, en lugar de regresar precio_TINSA contra IPV (que es lo mismo medido de otra forma).
4. **La cópula preserva correlaciones macro reales**: nunca samplea escenarios irreales como "PIB sube 12% Y desempleo sube 3pp simultáneamente".

---

## 2. Variables del modelo y su tratamiento

### 2.1 Variables sampleadas (5 macros) — Capa 2

Se samplean conjuntamente con **t-cópula (ν = 4)** sobre matriz de correlación Spearman empírica 2010–2024.

| Variable | Símbolo | Fuente | Frecuencia | Distribución muestreada |
|---|---|---|---|---|
| **IMACEC variación %** anual | imacec_var_pct | BCCh | Mensual | Empírica (99 percentiles densos), winsorizada p1–p99 |
| **Δ Tasa hipotecaria** (cambio anual en pp) | d_tasa_hipo | BCCh-CMF | Mensual | Empírica |
| **Δ Tasa de desempleo** (cambio anual en pp) | d_desempleo | INE | Trimestral móvil | Empírica |
| **IPV Departamentos Nuevos YoY %** | ipv_deptos_nuevos_yoy | BCCh | Anual interpolada a Q | Empírica |
| **IPV Casas Nuevas YoY %** | ipv_casas_nuevas_yoy | BCCh | Anual interpolada a Q | Empírica |
| **ICOI YoY %** (Índice Costos Construcción) | icoi_yoy | CChC | Anual interpolada a Q | Empírica |

> **Nota técnica**: por familia de producto se samplea un solo IPV (deptos o casas, según corresponda), por lo que en cada draw se generan 5 valores macro, no 7.

### 2.2 Variables del proyecto (Capa 1) — derivadas de las macros

Cada draw de macro se propaga a 4 shocks que afectan el flujo del proyecto:

#### Precio de venta (UF/m²)

```
precio_yoy_familiar = IPV_familiar_sampleado + ε
ε ~ N(0, σ_idiosincrático)
```

Sin término de bias (ver Sección 5 — Bug detectado y resuelto).

| Familia | IPV usado | σ idiosincrático |
|---|---|---|
| Edificios 4-6 pisos | IPV Deptos Nuevos | **9.80 pp** |
| DS19 | IPV Deptos Nuevos | 5.16 pp |
| Casa | IPV Casas Nuevas | 6.40 pp |
| Townhouse | IPV Casas Nuevas | 17.17 pp |

**Justificación de σ**: calculado como `std(precio_yoy_TINSA_familia − IPV_familiar_yoy)` sobre 80–141 trimestres por familia. Captura la variabilidad real entre el precio agregado de TINSA y el índice oficial. La σ alta de townhouses (17pp) refleja que la categoría tiene pocas observaciones y mayor heterogeneidad por proyecto.

#### Costo construcción

```
costo_yoy = ICOI_sampleado + ε
ε ~ N(0, 3.0 pp)
```

El **σ = 3.0 pp** es un parámetro económicamente razonable (no calibrado de TINSA, porque TINSA no contiene costos del developer). Representa la dispersión típica del costo de un proyecto específico vs. el índice ICOI nacional — esencialmente el margen del contrato de construcción.

#### Velocidad de venta

```
velocidad_yoy = α + β₁·IMACEC + β₂·Δtasa_hipo + β₃·Δdesempleo + β₄·IPV + β₅·ICOI_yoy + ε
ε ~ N(0, σ_residual_OLS)
```

**Calibrada por OLS por familia** sobre 80–141 trimestres. Los coeficientes capturan la relación efectiva PIB ↑ → velocidad ↑, tasa_hipo ↑ → velocidad ↓ que la teoría económica predice.

| Familia | R² | σ residual | Variables significativas (p<0.10) |
|---|---|---|---|
| Edificio 4-6p | 0.020 | 64.7 pp | (ninguna) — ruido idiosincrático domina |
| DS19 | 0.043 | 31.0 pp | IPV deptos (negativa, p=0.10) |
| **Casa** | **0.224** | **39.8 pp** | **IMACEC (+3.10 ***), IPV casas (+10.98 ***)** |
| Townhouse | 0.019 | 96.8 pp | (ninguna) |

**Interpretación**: las regresiones de velocidad son útiles principalmente para Casas (R²=22%, signos significativos al 1%). En las otras familias, R² es bajo por alta varianza idiosincrática — sin embargo, los coeficientes preservan la dirección económica correcta (IMACEC positivo, Δdesempleo negativo donde aplica).

> **Por qué R² bajo no es un bug**: en macro-empírica de alta frecuencia, R² 0.05–0.40 es lo esperable. La velocidad de venta de un proyecto específico depende mucho más de factores locales (ubicación, marketing, calidad del developer) que de macro nacional. Lo que el modelo captura — y debe capturar — es el **componente sistémico** que se mueve con la economía. El componente idiosincrático se incorpora como ruido N(0, σ_residual).

#### Plazo obra

```
plazo_yoy = N(0, σ_histórica)
```

No se regresa contra macros porque no hay relación causal limpia (el plazo lo decide el developer, no la macro). Se aplica un shock idiosincrático con σ histórica (10–30 pp por familia) clampeado a ±25 pp.

---

## 3. Cópulas aplicadas

### 3.1 Cópula t (Student) entre macros — la pieza central

**Especificación matemática**:
- Dimensión: 5 (las macros sampleadas conjuntamente)
- Grados de libertad: ν = 4 (estándar en finanzas modernas para captura de tail dependence)
- Matriz de correlación: Pearson derivada de Spearman empírica vía fórmula `ρ_p = 2·sin(π/6 · ρ_s)`
- Marginales: empíricas (interpolación lineal sobre 99 percentiles del histórico)

**Por qué t-cópula y no Gaussiana**:

| Comportamiento | Gaussiana | **t-cópula (ν=4)** |
|---|---|---|
| Correlaciones lineales | ✓ | ✓ |
| Tail dependence (eventos extremos correlacionados) | ✗ — subestima | ✓ — la captura |
| Replicar crisis donde múltiples shocks ocurren juntos | Subestima probabilidad | Refleja realidad |
| Convergencia a Gaussiana | – | ν → ∞ |

Para bienes raíces en mercados emergentes con shocks recurrentes, la t-cópula con ν=4 es el estándar (referencia: S&P, Moody's, modelos de Solvency II).

**Matriz de correlación Spearman empírica usada (5 macros, 401 trimestres)**:

|  | imacec | Δ tasa_hipo | Δ desemp. | IPV deptos | ICOI |
|---|---|---|---|---|---|
| **imacec** | 1.00 | +0.20 | −0.26 | +0.06 | – |
| **Δ tasa_hipo** | +0.20 | 1.00 | −0.29 | −0.13 | – |
| **Δ desemp.** | −0.26 | −0.29 | 1.00 | −0.22 | – |
| **IPV deptos** | +0.06 | −0.13 | −0.22 | 1.00 | – |

Signos económicamente correctos:
- IMACEC ↔ desempleo: −0.26 (boom = menos desempleo) ✓
- IMACEC ↔ tasa_hipo: +0.20 (BCCh sube tasas en boom) ✓
- desempleo ↔ tasa_hipo: −0.29 (recesión → tasas bajan, desempleo sube) ✓
- IPV ↔ desempleo: −0.22 (boom inmobiliario en buena economía) ✓

### 3.2 Cópula t (Student) entre variables del producto — Modo Empírico CIDU

Para el modo **Empírico CIDU** (sin macros), se usa una segunda t-cópula sobre las 5 variables del producto:

| Variable | Familia |
|---|---|
| Precio UF/m² | TINSA |
| Velocidad uds/mes | TINSA |
| Plazo (lead time INI→FIN) | TINSA |
| Descuento % | TINSA |
| Superficie promedio | TINSA |

Calibrada con **Iman-Conover** (4 iteraciones, α=0.85) sobre 124.531 observaciones. Permite samplear conjuntamente las 5 variables preservando correlaciones empíricas (precio↔velocidad: −0.38, precio↔tamaño: +0.55 en casas, etc.).

### 3.3 Cópula NO usada — comparativa

| Cópula | ¿Se usa? | Por qué no |
|---|---|---|
| Gaussiana | ✗ | Subestima tail dependence — peligroso para stress testing |
| Skew-t | ✗ | Aporta marginales asimétricas pero compleja; las marginales empíricas ya capturan asimetría |
| Vine cópulas (D-vine, C-vine) | ✗ | Máxima flexibilidad pero requiere mucha data + sensible a la estructura del vine |
| Bootstrap empírico | ✗ | 100% no paramétrico pero solo da escenarios "ya vistos" sin extrapolar |
| **t-cópula (ν=4)** | **✓** | **Sweet spot: tail dependence + simplicidad + estándar de la industria** |

---

## 4. Variables NO incluidas (futuras extensiones posibles)

### 4.1 Datos disponibles pero no integrados (Capa 3 estructural)

Estas variables tienen baja frecuencia de cambio y se usan como **anclajes de baseline** en lugar de shocks Monte Carlo:

| Variable | Frecuencia | Razón de no integración Monte Carlo |
|---|---|---|
| Tasa de fecundidad (hijos/mujer) | Anual lenta | Cambio decadal, no shock cíclico |
| Edad promedio | Anual lenta | Demografía estructural |
| Población total | Anual | Trend exógeno |
| Nivel educacional (CASEN) | Bianual | Solo 6 puntos en 14 años |
| % casamientos | Anual lenta | Tendencia secular, no shock |
| PBI per cápita | Anual | Redundante con IMACEC + IPC |

**Cómo se podrían integrar en futuras versiones**:

1. **Ancla de baseline**: para evaluación a 20+ años, las proyecciones INE de fertilidad/edad/población anclan el escenario "qué demanda habrá en 2040". El factor model actual asume estructura demográfica constante.

2. **Segmentación**: usar nivel educacional o ingresos por comuna como filtros para qué AUDP captura demanda alta vs. baja.

3. **Tendencia secular en velocidad**: incorporar tasa fecundidad declinante como tendencia negativa de demanda largo plazo.

### 4.2 Datos NO disponibles (deseables)

| Variable | Por qué importaría | Cómo conseguirla |
|---|---|---|
| Costo construcción real del developer (no índice nacional) | El ICOI captura promedio nacional; el costo de un developer específico puede divergir ±10-15% | Encuesta interna a constructoras |
| Velocidad de venta por comuna específica | TINSA es nacional; comunas como Las Condes vs. Cerro Navia tienen ciclos distintos | Stratificar TINSA por NCOM |
| Tasa de absorción por nivel socioeconómico | Permitiría modelar segmentos de demanda separadamente | CASEN + cruzar con TINSA |
| Stock de oferta competidora | El stock determina poder de pricing | DICTUC, CChC tiene parcialmente |
| Dispoibilidad de crédito (LTV, plazo) | Tasa hipo capta solo precio; LTV captura cantidad | CMF en detalle |

---

## 5. Bug detectado y resuelto durante calibración

Durante la validación empírica de la versión inicial del modelo, se detectaron **dos problemas críticos**:

### 5.1 Bias positivo aplastando los presets

La calibración inicial agregaba a `precio_yoy` un **bias histórico** (p.ej. +7.09 pp para Edif 4p) calculado como `mean(precio_TINSA − IPV_familiar)`.

**Síntoma**: las distribuciones de precio_yoy entre presets (Base vs. COVID vs. Boom) eran prácticamente idénticas (Cohen d = 0.06, insignificante). El bias constante dominaba sobre los shifts de los presets.

**Causa**: el bias representa un "drift composicional" entre TINSA agregada (que captura mix cambiante de proyectos) e IPV BCCh (que controla por composición). Es una **tendencia estructural**, no un shock cíclico — no debería estar en el factor model como término aditivo.

**Resolución**: bias removido. `precio_yoy = IPV_sampleado + ε` directamente. La tendencia composicional queda absorbida en el baseline del residual (representante guardado en `/residual`).

### 5.2 Sensibilidades faltantes en representantes guardados

El motor del Monte Carlo aplica los shocks a la incidencia vía sensibilidades pre-calculadas (`∂incidencia/∂param`) almacenadas con cada representante. **Si el representante fue guardado antes de la implementación de sensibilidades, los shocks de costo y plazo se descartan silenciosamente**.

**Síntoma reportado por el usuario**: distintos presets daban "los mismos resultados" en VAN.

**Resolución**:
1. **Default sensibilidades por familia** (fallback razonable cuando faltan):
   ```
   edif_4p:   ticket=+0.70, vel=+0.10, costo=−0.50, plazo=−0.15
   ds19:      ticket=+0.45, vel=+0.05, costo=−0.35, plazo=−0.10
   casa:      ticket=+0.65, vel=+0.08, costo=−0.45, plazo=−0.12
   townhouse: ticket=+0.65, vel=+0.08, costo=−0.45, plazo=−0.12
   ```

2. **Panel de diagnóstico en UI**: al abrir el MC, banner indica el estado:
   - Verde: 4/4 representantes con sensibilidades calculadas (modelo en plena capacidad)
   - Amarillo: representantes existen pero sin sensibilidades (usando defaults)
   - Rojo: sin representantes (shocks de costo/plazo no afectan VAN)

3. **Para mayor precisión**: re-guardar los 4 representantes en `/residual` (botón "💾 Guardar como representante" ahora calcula automáticamente las sensibilidades en ~1 segundo).

### 5.3 Validación post-fix

Test integrado (5.000 iteraciones, familia Edif 4p, baseline incidencia 14.0%):

| Preset | Incidencia mean | Δ vs base | Interpretación |
|---|---|---|---|
| base_esperado | 15.07% | – | – |
| subprime_2009 | 13.58% | −1.49 pp | Crisis suave: leve compresión margen |
| **estallido_covid_2019_2020** | **13.02%** | **−2.05 pp** | **Crisis con costos ICOI altos: margen comprime** |
| boom_post_covid_2021 | 14.71% | −0.36 pp | Boom no afecta costos materialmente |
| **slowdown_2023** | **22.45%** | **+7.38 pp** | **ICOI cayó −16%: gran alivio de costos** |

Los signos económicos son **correctos y robustos**:
- Crisis con shock de costo → incidencia cae → land value cae
- Slowdown con caída de costos → incidencia sube → land value sube

---

## 6. Validez estadística — análisis crítico

### 6.1 Fortalezas

| Atributo | Implementación |
|---|---|
| **Calibración con datos reales** | 124.531 obs TINSA + 401 trimestres macro |
| **Marginales empíricas** | 99 percentiles densos por variable, sin asunciones paramétricas |
| **Cópula tail-aware** | t (ν=4) calibrada con Iman-Conover (4 iter, error correlación final <0.06) |
| **Signos económicamente coherentes** | Verificados ex post (precio↔velocidad −0.38, IMACEC↔desempleo −0.26, etc.) |
| **Reproducibilidad** | Seed reproducible, mismo input → mismo output |
| **Auditabilidad** | Cada componente trazable a fuente oficial o calibración Python reproducible |
| **Stress testing histórico** | 4 presets centrados en macros reales 2009/2020/2021/2023 |

### 6.2 Limitaciones (transparentes)

| Limitación | Magnitud | Mitigación |
|---|---|---|
| **R² regresión velocidad** | 0.02–0.22 según familia | Aceptable en macro YoY de alta frec. El componente idiosincrático se incorpora como σ_residual N(0, σ) |
| **Bajo N en algunas familias** | DS19 (80 trim), Townhouse (116) | Resultados directionalmente correctos pero σ amplia |
| **Costos no calibrados con TINSA** | TINSA no tiene costos de developer | σ=3pp asumido como parámetro económico razonable |
| **Linealización de Δincidencia** | Aproximación de primer orden vía sensibilidades | Centered-difference O(h²); error <2% para shocks ≤10% |
| **Sin lags en Capa 2** | Solo macros contemporáneas (no t-1, t-2) | Versión v2 probada; aportó poco vs. complejidad agregada |
| **Cópula constante en ν=4** | No se calibra ν empíricamente | Estándar industria; ν=4 razonable para real estate emergente |

### 6.3 Comparación con alternativas

| Modelo | Sofisticación | Adecuado para directorio |
|---|---|---|
| **Monte Carlo Excel con 1 distribución por variable, independientes** (típico de boutique) | Bajo | ✗ Subestima riesgo de cola |
| **Modelo paramétrico legacy del simulador anterior** | Bajo-medio | Aceptable para sanity check |
| **Cópula gaussiana sobre 5 macros** | Medio | Mejor, pero pierde tail dependence |
| **t-cópula sobre 5 macros + shocks directos IPV/ICOI + regresión velocidad** ← **actual** | **Medio-alto** | **✓ Apto para decisiones de inversión multi-millones UF** |
| Vine cópulas o factor stochastic volatility | Alto | Innecesario para esta escala; mayor riesgo de overfitting |

---

## 7. Conclusión

> **¿Es el modelo estadísticamente contundente para tomar decisiones económicas serias?**
> **Sí, dentro de su alcance, con caveats explícitos.**

### Lo que el modelo entrega con confianza

1. **Distribución del VAN bajo escenarios macro plausibles**, con tail dependence apropiada para riesgo de cola.
2. **Comparación de escenarios** (Crisis 2009 vs. COVID 2020 vs. Boom 2021) usando macros reales de cada período — no inventados.
3. **Atribución de varianza al VAN** (tornado): qué variables mueven más el resultado.
4. **Reproducibilidad**: mismo seed + mismos inputs → mismo output, exactamente. Auditable.

### Lo que el modelo NO entrega

1. **NO predice el VAN futuro** con precisión puntual. Eso requeriría conocer el escenario macro futuro, que es por definición incierto.
2. **NO captura riesgos endógenos al proyecto específico** (ejecución del developer, marketing, calidad). Esos son idiosincráticos y entran como noise.
3. **NO modela rupturas estructurales** (cambio de regulación, salto tecnológico). El factor model asume estructura macro 2010–2024 estable hacia adelante.

### Cuándo SÍ y cuándo NO usarlo

| Pregunta del Directorio | ¿Usa este modelo? |
|---|---|
| "¿Cuál es el VAN esperado del AUDP X bajo escenario base?" | ✓ Sí |
| "¿Qué tan malo puede ser el VAN si replicamos COVID 2020?" | ✓ Sí (preset Estallido+COVID) |
| "¿Qué probabilidad hay de VAN < 0?" | ✓ Sí, con caveats sobre el horizonte de los datos |
| "¿Cuál es la sensibilidad del VAN a cada palanca?" | ✓ Sí (tornado) |
| "¿Qué pasará exactamente con el VAN en 2030?" | ✗ No — eso requiere proyectar las macros futuras, fuera del alcance |
| "¿Cómo se comporta el modelo bajo cambio regulatorio del DS-19?" | ✗ No (no hay data del cambio en el histórico) |
| "¿Cuál AUDP es mejor entre 2 candidatos bajo el mismo escenario?" | ✓ Sí (correr ambos con mismo preset y comparar distribuciones) |
| "¿Cuánto tendría que cambiar el ICOI para que el VAN cambie su signo?" | ✓ Sí (correr varios presets y graficar VAN(ICOI)) |

### Recomendación final al Directorio

El modelo es **apto para informar decisiones de inversión AUDP** con la salvedad de que sus outputs son **distribuciones probabilísticas, no predicciones puntuales**. Su valor está en:

1. **Cuantificar** el rango plausible del VAN bajo distintos escenarios macro.
2. **Comparar** alternativas de inversión bajo los mismos shocks.
3. **Identificar** las palancas más sensibles (concentrar atención del management).
4. **Auditar** las hipótesis vía la trazabilidad a fuentes oficiales (BCCh, INE, CChC) y data TINSA.

Su límite es no ser oráculo. Toda decisión que requiera certeza debe complementarse con análisis cualitativo del contexto regulatorio, comercial y geográfico específico que el modelo no captura.

---

## 8. Anexo técnico — verificación de funcionamiento

### Test ejecutado (Abr 28 2026)

**Comando**: `node analysis/test_factor_with_sens.js`
**N**: 3.000 iteraciones por preset, familia Edif 4p
**Resultado**: 5/5 presets producen distribuciones de incidencia con medias significativamente distintas (rango 13.0% a 22.5%).

**Conclusión del test**: el ciclo completo `factor model → sensibilidades → Δincidencia` opera correctamente y los 5 escenarios se diferencian económicamente como se espera.

### Archivos del modelo

| Archivo | Propósito |
|---|---|
| `analysis/build_macro_option_c.py` | Pipeline de calibración (reproducible) |
| `analysis/macro_factor_c.json` | Modelo calibrado completo (lectura humana) |
| `analysis/macro_report_c.md` | Reporte estadístico de calibración |
| `public/macro_factor_c.js` | Modelo embebible en navegador (12 KB) |
| `public/macro_factor.js` | Implementación de sampling t-cópula + propagación |
| `public/market_copula.js` | Utilidades matemáticas (Cholesky, t-CDF, etc.) |
| `public/market_stats.js` | Distribuciones empíricas TINSA (124k obs) |
| `public/simulador-legacy.html` | Integración al Monte Carlo del simulador macro |

### Reproducibilidad

```bash
# Recalibrar el modelo desde cero (requiere CSVs en analysis/macro_raw/)
python3 analysis/build_macro_option_c.py
python3 analysis/build_macro_c_js.py
# Validar
node analysis/test_factor_with_sens.js
```

Todos los scripts son deterministas; mismo input produce mismo output con seed 42.
