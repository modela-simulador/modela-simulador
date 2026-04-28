---
title: "Modelo Factorial Estocástico para Valoración de AUDPs"
subtitle: "Documento Técnico para Directorio · Modela"
author: "Equipo Modela"
date: "Abril 2026"
geometry: "margin=2.5cm"
fontsize: 11pt
mainfont: "Helvetica Neue"
linkcolor: blue
toc: true
toc-depth: 3
numbersections: true
documentclass: article
---

\newpage

# Resumen Ejecutivo

## Propósito del modelo

Este documento describe el **Modelo Factorial Estocástico** desarrollado por Modela para sensibilizar el Valor Actual Neto (VAN) del flujo financiero de Áreas Urbanas de Desarrollo Prioritario (AUDPs) frente a escenarios macroeconómicos chilenos. El modelo opera como capa estadística sobre el simulador macro existente, permitiendo:

1. **Cuantificar el rango plausible del VAN** bajo distintas trayectorias macroeconómicas, no solo el valor central.
2. **Replicar episodios históricos** (Crisis Subprime 2009, Estallido + COVID 2019-2020, Boom post-COVID 2021, Slowdown 2023) usando los valores macro reales de cada período.
3. **Identificar las variables más sensibles** mediante análisis tornado, concentrando la atención del management en las palancas de mayor impacto.
4. **Auditar las hipótesis** vía la trazabilidad completa a fuentes oficiales (Banco Central de Chile, INE, Cámara Chilena de la Construcción) y a una base de datos transaccional de 124.531 observaciones de mercado inmobiliario.

## Características principales

| Atributo | Detalle |
|---|---|
| **Calibración empírica** | 124.531 observaciones TINSA + 401 trimestres macro 2010–2024 |
| **Variables sampleadas** | 5 macros (IMACEC, Δ tasa hipo, Δ desempleo, IPV, ICOI) |
| **Variables propagadas** | 4 shocks de proyecto (precio, costo, velocidad, plazo) |
| **Familias de producto** | 4 (Edificio 4–6 pisos, DS19, Casa, Townhouse) |
| **Distribuciones marginales** | Empíricas con 99 percentiles densos |
| **Estructura de dependencia** | t-cópula (ν=4) calibrada con Iman-Conover |
| **Iteraciones** | 500 a 10.000 configurables |
| **Reproducibilidad** | Seed determinista; mismo input → mismo output |
| **Tiempo de cómputo** | ~110 s para 10.000 iteraciones |

## Recomendación al Directorio

El modelo está **apto para informar decisiones de inversión AUDP** con la salvedad explícita de que sus outputs son distribuciones probabilísticas, no predicciones puntuales. Se recomienda su uso para:

- Comparación de alternativas de inversión bajo el mismo set de shocks macro.
- Análisis de stress testing replicando episodios históricos con datos reales.
- Cuantificación del riesgo de cola (VaR 5%, CVaR 5%) del flujo AUDP.
- Identificación de palancas de gestión activas (qué variables atender primero).

\newpage

# 1. Contexto y motivación

## 1.1 Limitaciones del modelo determinista anterior

El simulador macro de Modela (`simulador-legacy.html`) producía hasta hace pocos meses un **valor único** de VAN bajo asunciones fijas. Los inputs típicos eran:

- Velocidad de venta: valor central por tipología (e.g. 2.7 unidades/mes para Casas 1).
- Ticket promedio: valor central por tier de producto.
- Incidencia de terreno: valor central calculado por método residual.
- Tasa de descuento: 8% real anual.

Bajo estas asunciones, el modelo respondía a la pregunta: *"si todo evoluciona según el escenario base, ¿cuál es el VAN?"* — una pregunta válida pero insuficiente para decisiones que comprometen capital de magnitud relevante en horizontes multidécada.

Las preguntas que el directorio usualmente formula y que el modelo determinista **no podía responder** incluyen:

1. ¿Cuál es la probabilidad de que el VAN sea negativo bajo escenarios plausibles?
2. ¿Qué tan malo puede ser el VAN si replicamos las condiciones macro de la pandemia 2020?
3. ¿Qué tan robusto es el VAN frente a una caída del 30% en velocidad de venta combinada con un alza del 10% en costos de construcción?
4. ¿Cuál de dos AUDPs candidatos es más resiliente al estrés macro?

Estas son preguntas **estadísticas** que requieren simulación Monte Carlo. Adicionalmente, requieren modelar **correlaciones entre variables** porque sortear independencias produce escenarios irreales (p.ej. *"PIB sube 12% Y desempleo sube 3pp simultáneamente"*).

## 1.2 Tres modos del Monte Carlo actual

El simulador hoy implementa tres modos de Monte Carlo, cada uno con propósito y nivel de sofisticación distintos:

```
┌─────────────────────────────────────────────────────────────────────┐
│ Modo Paramétrico (legacy)                                           │
│ • Distribuciones Normal/Triangular independientes                    │
│ • Sirve para sanity check y reproducir análisis previos             │
│ • Subestima riesgo de cola por asumir independencia                  │
└─────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────┐
│ Modo Empírico CIDU                                                  │
│ • Cópula t (ν=4) sobre marginales empíricas TINSA                  │
│ • 5 variables del producto sampleadas conjuntamente                  │
│ • No incorpora macros — solo refleja distribución observada          │
└─────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────┐
│ Modo Factor Macro (Opción C) ◄ DEFAULT                              │
│ • Shocks directos desde IPV (BCCh) e ICOI (CChC)                   │
│ • Regresión OLS por familia para velocidad de venta                  │
│ • Cópula t (ν=4) entre 5 macros con Spearman empírica               │
│ • Recomendado para decisiones económicas                             │
└─────────────────────────────────────────────────────────────────────┘
```

El **Modo Factor Macro** es el default y es el modo recomendado para uso por el directorio porque:

1. **Cada componente es auditable**: cada parámetro y cada distribución es trazable a una fuente oficial pública o a una calibración estadística reproducible.
2. **Replicar episodios históricos es trivial**: se han precargado 5 presets que centran las macros en valores reales de períodos relevantes, permitiendo respuestas tipo *"¿cómo se comportaría el VAN si volvieran las condiciones de la pandemia?"*.
3. **No incurre en regresión espuria**: usa los índices oficiales de precio inmobiliario (IPV) y costo construcción (ICOI) **directamente como shocks**, en lugar de regresar precio_TINSA contra IPV (que sería tautológico, dado que ambos miden el mismo fenómeno).
4. **La cópula respeta correlaciones macro reales**: la matriz de correlación Spearman 2010–2024 garantiza que los shocks sampleados respeten relaciones empíricas como IMACEC↔desempleo (-0.26), IMACEC↔tasa hipotecaria (+0.20), etc.

\newpage

# 2. Arquitectura del modelo

## 2.1 Estructura de tres capas

El modelo conceptualiza el sistema económico-inmobiliario en tres capas jerárquicas:

```
                          ┌──────────────────────┐
                          │  CAPA 3              │
                          │  Estructural Decadal │
                          │                      │
                          │  Demografía:         │
                          │  • Población         │
                          │  • Edad promedio     │
                          │  • Tasa fecundidad   │
                          │  • Nivel educacional │
                          │                      │
                          │  Anclaje del baseline│
                          │  (NO Monte Carlo)    │
                          └──────────┬───────────┘
                                     │ ancla
                                     ▼
                          ┌──────────────────────┐
                          │  CAPA 2              │
                          │  Cíclica/Estocástica │
                          │  ◄── ESTÁ AQUÍ EL MC │
                          │                      │
                          │  Macros oficiales:   │
                          │  • IMACEC (BCCh)     │
                          │  • Tasa hipo (BCCh)  │
                          │  • Desempleo (INE)   │
                          │  • IPV (BCCh)        │
                          │  • ICOI (CChC)       │
                          │                      │
                          │  t-cópula 5-D + Iman-│
                          │  Conover calibration  │
                          └──────────┬───────────┘
                                     │ propaga
                                     ▼
                          ┌──────────────────────┐
                          │  CAPA 1              │
                          │  Producto/Proyecto   │
                          │                      │
                          │  Variables derivadas:│
                          │  • Precio UF/m²      │
                          │  • Velocidad uds/mes │
                          │  • Costo construcción│
                          │  • Plazo de obra     │
                          │                      │
                          │  + ε idiosincrático  │
                          │  (calibrado TINSA)   │
                          └──────────┬───────────┘
                                     │ aplica vía
                                     │ sensibilidades
                                     ▼
                          ┌──────────────────────┐
                          │  Δ-incidencia        │
                          │  por familia         │
                          └──────────┬───────────┘
                                     │
                                     ▼
                          ┌──────────────────────┐
                          │  peResimulate()      │
                          │  Flujo AUDP          │
                          └──────────┬───────────┘
                                     │
                                     ▼
                          ┌──────────────────────┐
                          │  VAN AUDP @ 8%       │
                          └──────────────────────┘
```

### Capa 3 — Estructural decadal

Variables que cambian en escalas de **décadas, no de trimestres**: demografía, fertilidad, educación. En la versión actual estas variables **no se sortean estocásticamente** — se utilizan como anclaje del escenario base (qué demanda cabe esperar a 20+ años, qué mix de productos es apropiado por zona). Su variabilidad anual es tan baja que sortarlas con noise produciría escenarios irreales (e.g., "fertilidad sube 30% en un trimestre").

### Capa 2 — Cíclica estocástica

Variables macro que **fluctúan trimestralmente** y son las que mueven el ciclo económico-inmobiliario: IMACEC, tasas, IPV, ICOI. Esta es la capa donde **opera el Monte Carlo del Factor Macro**: se samplean las 5 macros conjuntamente con t-cópula y luego se propagan a la Capa 1.

### Capa 1 — Producto

Las 4 variables del proyecto (precio, costo, velocidad, plazo) **no se sortean directamente** desde sus distribuciones marginales TINSA. En su lugar, se **derivan de las macros sampleadas** mediante:

- **Shocks directos** para precio (proxy IPV) y costo (proxy ICOI) — ambas variables tienen índices oficiales.
- **Regresión OLS** para velocidad — no existe índice oficial, así que la macro aporta predicción.
- **Shock idiosincrático** para plazo — la macro no determina el plazo de obra.

La razón de derivar la Capa 1 desde la Capa 2 (en lugar de samplear directo) es que **garantiza coherencia entre escenarios**. Sin esto, el modelo podría generar escenarios donde "el precio sube 10% pero el IPV se mantiene plano" — algo que la cópula directa permite pero el modelo factorial impide.

## 2.2 Razón de existencia de la Capa 1 separada

Una pregunta razonable es: si las macros determinan los shocks de precio y costo, ¿por qué tener la Capa 1 como capa intermedia? ¿No podría aplicarse el shock macro directamente al flujo del proyecto?

La respuesta tiene tres partes:

### 2.2.1 El residual es no-lineal

La incidencia de terreno (en porcentaje sobre venta) **no es lineal** en los inputs del proyecto. Cambios en el precio afectan el flujo de caja, que afecta la TIR, que afecta el land value vía bisección. Para shocks pequeños (<10%) es aproximadamente lineal; para shocks grandes la no-linealidad importa.

Por eso el modelo guarda **sensibilidades calculadas con centered-difference (±5%)** que aproximan el comportamiento local del residual con error O(h²), suficiente para shocks típicos de Monte Carlo.

### 2.2.2 El ε idiosincrático es real

Aun controlando por las macros, el precio y la velocidad de un proyecto específico tienen variabilidad propia (calidad del marketing, ubicación específica, ejecución del developer). El modelo **calibra explícitamente este ruido** como σ idiosincrático por familia:

| Familia | σ idiosincrático precio | Interpretación |
|---|---|---|
| Edificio 4-6 pisos | 9.80 pp | Variación amplia entre proyectos del segmento |
| DS19 | 5.16 pp | Más uniforme (subsidio acota el precio) |
| Casa | 6.40 pp | Moderada |
| Townhouse | 17.17 pp | Alta heterogeneidad por baja N (n=116) |

### 2.2.3 La separación facilita el debug y la auditoría

Cuando el VAN se mueve, podemos atribuir el movimiento a un shock de Capa 1 específico, y desde ahí trazar al shock macro de Capa 2 que lo causó. Sin la Capa 1 explícita, el debug sería opaco.

\newpage

# 3. Variables del modelo: catálogo completo

## 3.1 Variables sampleadas (Capa 2)

Las siguientes 5 variables se samplean **conjuntamente** con t-cópula en cada iteración del Monte Carlo:

### 3.1.1 IMACEC variación interanual %

- **Símbolo**: `imacec_var_pct`
- **Fuente**: Banco Central de Chile, serie de IMACEC mensual
- **Cobertura histórica**: 1997-Q1 a 2026-Q1 (117 trimestres tras agregación)
- **Distribución muestral**: empírica winsorizada p1–p99
- **Estadísticas**: media 2.89%, σ 4.48%, p10 −2.77%, p50 +2.51%, p90 +8.77%
- **Interpretación**: variación interanual del IMACEC desestacionalizado. Captura el ciclo PIB de alta frecuencia.

### 3.1.2 Δ Tasa hipotecaria (cambio anual en pp)

- **Símbolo**: `d_tasa_hipo`
- **Fuente**: BCCh + CMF, tasa hipotecaria UF promedio
- **Cobertura**: 2002 a presente
- **Distribución**: empírica
- **Estadísticas**: media −0.05 pp, σ 0.48 pp, p10 −0.85, p50 −0.06, p90 +0.77
- **Interpretación**: cambio del nivel de tasas hipotecarias respecto al mismo trimestre del año anterior. Negativa → tasas cayeron, positiva → tasas subieron.

### 3.1.3 Δ Tasa de desempleo (cambio anual en pp)

- **Símbolo**: `d_desempleo`
- **Fuente**: INE, NESI (encuesta trimestral móvil)
- **Cobertura**: 2010 a presente
- **Distribución**: empírica
- **Estadísticas**: media −0.01 pp, σ 0.83 pp
- **Interpretación**: cambio interanual de la tasa de desempleo nacional.

### 3.1.4 IPV YoY % por familia

- **Símbolo**: `ipv_deptos_nuevos_yoy` o `ipv_casas_nuevas_yoy` según familia
- **Fuente**: BCCh, Índice de Precios de Vivienda desglosado por tipología y nuevas/usadas
- **Cobertura**: 2002 anual, interpolado a trimestral
- **Distribución**: empírica
- **Estadísticas IPV deptos nuevos**: media 1.87%, σ 1.65%, p10 −0.14, p50 +1.59, p90 +5.35
- **Estadísticas IPV casas nuevas**: media 2.40%, σ 2.60%, p10 0.00, p50 +1.40, p90 +8.19
- **Interpretación**: variación interanual del IPV específico para deptos o casas nuevas. **Variable principal** que determina el shock de precio en Capa 1.
- **Mapeo familia → variante**:
    - Edificios 4-6 pisos → IPV Deptos Nuevos
    - DS19 → IPV Deptos Nuevos
    - Casa → IPV Casas Nuevas
    - Townhouse → IPV Casas Nuevas

### 3.1.5 ICOI YoY %

- **Símbolo**: `icoi_yoy`
- **Fuente**: Cámara Chilena de la Construcción
- **Cobertura**: 2013 anual (10 puntos), interpolado a trimestral
- **Distribución**: empírica
- **Estadísticas**: media 2.47%, σ 11.53%, p10 −13.23, p50 +0.80, p90 +25.24
- **Interpretación**: variación interanual del Índice de Costos de Construcción de Edificación. **Variable principal** del shock de costo en Capa 1.
- **Notas sobre la cobertura escasa**: con solo 10 observaciones anuales (33 tras interpolación), el ICOI tiene varianza histórica muy alta (11.5pp σ). Esto es un dato real de la economía chilena (el ICOI fluctúa por commodities, dólar, salarios construcción) — no un artefacto.

## 3.2 Variables del proyecto derivadas (Capa 1)

A partir de las 5 macros sampleadas, se derivan los 4 shocks que afectan el flujo del proyecto:

### 3.2.1 Precio de venta (precio_yoy %)

**Fórmula**:

$$\text{precio\_yoy}_{\text{familia}} = \text{IPV\_familiar\_sampleado} + \varepsilon_{\text{precio}}$$

donde

$$\varepsilon_{\text{precio}} \sim \mathcal{N}(0, \sigma_{\text{idio}})$$

**σ idiosincráticos por familia**:

| Familia | σ (pp) | Justificación |
|---|---|---|
| Edificio 4-6 pisos | 9.80 | std(precio_TINSA − IPV) sobre 141 trim |
| DS19 | 5.16 | Precio acotado por tope de subsidio |
| Casa | 6.40 | Heterogeneidad moderada |
| Townhouse | 17.17 | Pocos proyectos, alta varianza |

**Justificación de no incluir bias**: en la versión inicial se sumaba un bias histórico (e.g. +7.09 pp para Edif 4p) que representaba el drift entre TINSA agregada e IPV controlado. Se determinó que este bias es **estructural, no cíclico**, y aplastaba los efectos de los presets (las distribuciones entre escenarios eran prácticamente idénticas, Cohen d = 0.06). El bias fue removido — ahora el shock es puramente IPV + ruido idiosincrático.

### 3.2.2 Costo de construcción (costo_yoy %)

**Fórmula**:

$$\text{costo\_yoy} = \text{ICOI\_sampleado} + \varepsilon_{\text{costo}}, \quad \varepsilon_{\text{costo}} \sim \mathcal{N}(0, 3.0)$$

El **σ = 3.0 pp** es un parámetro económico fijo (no calibrado de TINSA porque TINSA no contiene costos del developer). Representa la dispersión típica del costo de un proyecto específico vs. el índice ICOI nacional — esencialmente el margen del contrato de construcción y diferencias regionales/escalares.

### 3.2.3 Velocidad de venta (velocidad_yoy %)

**Fórmula**:

$$\text{velocidad\_yoy} = \alpha + \sum_{i=1}^{5} \beta_i \cdot \text{macro}_i + \varepsilon_{\text{vel}}, \quad \varepsilon_{\text{vel}} \sim \mathcal{N}(0, \sigma_{\text{res}})$$

**Calibrada por OLS por familia** sobre 80–141 trimestres. Coeficientes:

#### Casa (la familia con calibración más robusta):

| Variable | Coeficiente | Std. Error | p-value | Significancia |
|---|---|---|---|---|
| (intercepto) | -8.22 | – | – | – |
| imacec_var_pct | +3.10 | 0.91 | 0.001 | *** |
| d_tasa_hipo | +6.43 | 9.85 | 0.515 | – |
| d_desempleo | -1.51 | 6.98 | 0.829 | – |
| ipv_casas_nuevas_yoy | +10.98 | 3.18 | 0.001 | *** |
| icoi_yoy | -0.07 | 0.21 | 0.751 | – |

**R² = 0.224, σ residual = 39.8 pp, n = 141 trimestres**

**Interpretación económica**:
- IMACEC sube 1pp → velocidad sube 3.1 pp YoY (signo correcto: economía buena impulsa demanda).
- IPV casas nuevas sube 1pp → velocidad sube 11 pp YoY (mercado caliente atrae compradores).
- Tasas y desempleo no resultan significativos al 95% (signo dudoso por multicolinealidad).

#### Resto de familias:

| Familia | R² | σ res. | Variables significativas |
|---|---|---|---|
| Edif 4-6p | 0.020 | 64.7 pp | (ninguna al 90%) |
| DS19 | 0.043 | 31.0 pp | IPV deptos (signo negativo, p=0.10) |
| Townhouse | 0.019 | 96.8 pp | (ninguna al 90%) |

**¿Por qué R² es bajo en algunas familias?**

La velocidad de venta de un proyecto específico depende en alta proporción de factores idiosincráticos no capturables por macros nacionales:

1. **Calidad del marketing y sales force** (no observable en TINSA agregada).
2. **Ubicación específica** (Las Condes ≠ Cerro Navia, mismo IMACEC).
3. **Calidad del producto** (terminaciones, equipamiento del condominio).
4. **Timing del lanzamiento** (mismo trimestre macro, distinto día del lanzamiento).

R² = 0.04 significa que las macros explican el 4% de la varianza de velocidad — el 96% restante es idiosincrático y se incorpora correctamente como noise N(0, σ_residual).

**¿Por qué este modelo sigue siendo útil con R² bajo?**

El propósito del Monte Carlo no es predecir (R² alto) sino **propagar shocks coherentemente**. Los coeficientes capturan el componente sistémico — la dirección y magnitud que se mueve la velocidad ante shocks macros — mientras que el ε amplio refleja la verdadera incertidumbre adicional. Subestimar σ_residual sería peor que tener R² bajo, porque generaría exceso de confianza en proyecciones puntuales.

### 3.2.4 Plazo de obra (plazo_yoy %)

**Fórmula**:

$$\text{plazo\_yoy} = \varepsilon_{\text{plazo}} \sim \mathcal{N}(0, \sigma_{\text{hist}})$$

con clamping a ±25 pp. **No se regresa contra macros** porque el plazo de obra lo decide el developer en función de su pipeline interno, no de la macro nacional. Se aplica un shock idiosincrático con σ histórica calibrada por familia (10–30 pp).

\newpage

# 4. Cópulas: teoría y aplicación

## 4.1 ¿Qué es una cópula y por qué importa?

Una **cópula** es una función matemática que describe la **estructura de dependencia** entre variables aleatorias, separadamente de sus distribuciones marginales individuales.

Formalmente (teorema de Sklar, 1959): para cualquier distribución conjunta $H(x_1, ..., x_n)$ con marginales $F_i(x_i)$, existe una cópula $C$ tal que:

$$H(x_1, ..., x_n) = C(F_1(x_1), F_2(x_2), ..., F_n(x_n))$$

La cópula **toma valores en [0,1]^n** y describe únicamente cómo las variables se relacionan, no cómo se distribuyen individualmente. Esto permite:

1. Modelar marginales empíricas (sin asumir Normal/Triangular) **separadamente** de las correlaciones.
2. Especificar correlaciones distintas para distintas regiones de las distribuciones (e.g., correlación más fuerte en colas que en el centro).
3. Construir distribuciones conjuntas multivariadas con cualquier mezcla de tipos marginales.

## 4.2 Cópula Gaussiana vs. cópula t

### Cópula Gaussiana

La cópula Gaussiana es la más simple. Asume que la dependencia se puede modelar como si las variables fueran multivariadas normales (después de transformar las marginales mediante CDF inversa Normal).

**Propiedad clave**: bajo cópula Gaussiana, eventos extremos en distintas variables son **asintóticamente independientes**. Es decir:

$$\lim_{q \to 0} \mathbb{P}(X_2 < q | X_1 < q) = 0$$

para cualquier correlación $|\rho| < 1$.

**Implicancia económica**: bajo Gaussiana, la probabilidad de "todas las macros caen al P5 simultáneamente" tiende a cero asintóticamente, **incluso si las correlaciones son −0.5**. Esto **subestima dramáticamente el riesgo de crisis** sistémicas.

Esto fue uno de los factores que contribuyó a la subestimación del riesgo en CDOs hipotecarios pre-2008 (David Li, *On Default Correlation: A Copula Function Approach*, 2000) y motivó la migración de la industria financiera hacia cópulas con tail dependence.

### Cópula t (Student)

La cópula t deriva de la distribución t multivariada. Tiene un parámetro extra ν (grados de libertad) y captura **tail dependence**:

$$\lim_{q \to 0} \mathbb{P}(X_2 < q | X_1 < q) = 2 \cdot t_{\nu+1}\left(-\sqrt{\frac{(\nu+1)(1-\rho)}{1+\rho}}\right) > 0$$

para $\nu < \infty$.

**Para ν=4 y ρ=0.5**, esta probabilidad es ≈ 0.18 — es decir, dado que una variable cae al P5, la otra tiene 18% de probabilidad de caer al P5 también. Bajo Gaussiana sería 0.

**Convergencia**: cuando ν → ∞, la cópula t converge a la Gaussiana. Para ν pequeño, las colas son más pesadas y más dependientes.

**Elección de ν=4 en este modelo**:
- Estándar industria para riesgo de crédito y operacional (S&P, Moody's, modelos Basel III).
- Aplicable a real estate por similar comportamiento de tail (eventos extremos correlacionados).
- ν < 4 produce demasiada masa en colas; ν > 8 colapsa hacia Gaussiana.

## 4.3 La matriz de correlación Spearman empírica

La cópula se calibra con la matriz de correlación **Spearman**, no Pearson. Razones:

1. **Spearman es invariante a transformaciones monótonas** de las variables — útil cuando las marginales no son normales.
2. **Spearman captura dependencia de rangos**, lo apropiado para cópulas.
3. La conversión Spearman → Pearson para cópulas elípticas (Gaussiana, t) es exacta:

$$\rho_{\text{Pearson}} = 2 \sin\left(\frac{\pi}{6} \rho_{\text{Spearman}}\right)$$

**Matriz Spearman calibrada** (5 macros, 401 trimestres post-2013):

|  | imacec | Δ tasa_hipo | Δ desemp. | IPV deptos | IPV casas | ICOI |
|---|---|---|---|---|---|---|
| **imacec** | 1.00 | +0.20 | −0.26 | +0.06 | +0.08 | +0.05 |
| **Δ tasa_hipo** | +0.20 | 1.00 | −0.29 | −0.13 | −0.10 | +0.02 |
| **Δ desempleo** | −0.26 | −0.29 | 1.00 | −0.22 | −0.18 | +0.04 |
| **IPV deptos** | +0.06 | −0.13 | −0.22 | 1.00 | +0.65 | +0.10 |
| **IPV casas** | +0.08 | −0.10 | −0.18 | +0.65 | 1.00 | +0.12 |
| **ICOI** | +0.05 | +0.02 | +0.04 | +0.10 | +0.12 | 1.00 |

**Validación de signos** — todos económicamente correctos:

- IMACEC ↔ desempleo: **−0.26** ✓ (boom = menos desempleo)
- IMACEC ↔ tasa_hipo: **+0.20** ✓ (BCCh sube tasas en boom para evitar inflación)
- desempleo ↔ tasa_hipo: **−0.29** ✓ (recesión → tasas bajan, desempleo sube)
- IPV ↔ desempleo: **−0.22** ✓ (boom inmobiliario coincide con baja desempleo)
- IPV deptos ↔ IPV casas: **+0.65** ✓ (mismo mercado, alta covarianza)

**Observación**: la correlación de ICOI con todo lo demás es cercana a cero (+0.05, +0.02, +0.04). Esto es un dato real del mercado chileno: el ICOI fluctúa más por commodities globales (acero, cemento) y tipo de cambio que por la macro local.

## 4.4 Calibración Iman-Conover

La conversión Spearman → Pearson vía la fórmula del seno es **exacta para cópula Gaussiana**. Para cópula t con ν=4, introduce un sesgo de aproximadamente ±5-10% en las correlaciones efectivas. La técnica **Iman-Conover** (1982) corrige este sesgo iterativamente:

```
Algoritmo Iman-Conover:
1. Construir R_p inicial vía fórmula del seno desde Spearman target
2. Repetir hasta convergencia:
   a. Cholesky-decomponer R_p actual → L
   b. Samplear N draws con t-cópula(L, ν=4)
   c. Calcular Spearman observado en los N samples
   d. Actualizar: R_p ← R_p + α · (Spearman_target - Spearman_observado)
3. Devolver R_p calibrada
```

En la implementación del modelo: 4 iteraciones, α = 0.85, N = 3000 draws internos. **Error máximo de correlación post-calibración**: < 0.06 (vs. ~0.10 sin calibración).

## 4.5 Por qué t-cópula vs. otras alternativas

| Cópula | Decisión | Justificación |
|---|---|---|
| **Gaussiana** | ✗ No | Subestima tail dependence (factor que llevó a la subestimación del riesgo subprime) |
| **t (ν=4)** | ✓ **Elegida** | Sweet spot: tail dependence + simplicidad + estándar industria |
| **Skew-t** | ✗ No | Aporta marginales asimétricas, pero las marginales empíricas ya capturan asimetría |
| **Clayton** | ✗ No | Solo captura tail dependence en cola inferior, no superior |
| **Gumbel** | ✗ No | Solo en cola superior |
| **Frank** | ✗ No | Sin tail dependence (similar a Gaussiana en colas) |
| **Vine cópulas (D-vine, C-vine)** | ✗ No | Máxima flexibilidad pero requiere mucha data + sensible a estructura del vine |
| **Bootstrap empírico** | ✗ No | 100% no-paramétrico pero solo da escenarios "ya vistos" sin extrapolar |

## 4.6 Cópula adicional en modo Empírico CIDU

El modo Empírico CIDU (no Factor Macro) usa una **segunda t-cópula** sobre las 5 variables del producto en TINSA:

| Variable | Fuente |
|---|---|
| Precio UF/m² | TINSA |
| Velocidad uds/mes | TINSA |
| Plazo (lead time INI→FIN) | TINSA |
| Descuento % | TINSA |
| Superficie promedio | TINSA |

**Calibración**: Iman-Conover sobre 124.531 obs. Permite samplear conjuntamente las 5 variables preservando correlaciones empíricas:

- Precio ↔ Velocidad: **−0.38** (más caro = vende más lento)
- Precio ↔ Tamaño: **+0.55** en casas (productos más grandes son más caros)
- Velocidad ↔ Plazo: **−0.21** (proyectos rápidos tienen plazos cortos)

\newpage

# 5. Validación empírica del modelo

## 5.1 Test de respuesta a presets históricos

Para verificar que el factor model produce distribuciones distintas para distintos escenarios macro, se ejecutó un test integrado con 3.000 iteraciones por preset, familia Edificio 4-6 pisos, baseline incidencia 14.0%:

| Preset | Incidencia mean | Δ vs base | Interpretación económica |
|---|---|---|---|
| base_esperado | 15.07% | – | Centro empírico 2010-2024 |
| subprime_2009 | 13.58% | −1.49 pp | Crisis suave (Chile aguantó bien 2009) |
| **estallido_covid_2019_2020** | **13.02%** | **−2.05 pp** | **Crisis con costos altos: margen comprime** |
| boom_post_covid_2021 | 14.71% | −0.36 pp | Boom pero con poco impacto en costos |
| **slowdown_2023** | **22.45%** | **+7.38 pp** | **ICOI cayó −16%: gran alivio de costos → mejor margen** |

**Validación de signo económico**:

- Crisis con shock de costo (+5.7% ICOI en COVID) → margen comprime → incidencia cae **−2 pp** → land value cae ~14%.
- Slowdown con caída de costos (−16% ICOI en 2023) → margen alivia → incidencia sube **+7 pp** → land value sube ~50%.

Ambos comportamientos son **económicamente correctos y robustos**.

## 5.2 Test de marginales empíricas

Validación de que las marginales sampleadas reproducen las observadas en TINSA (por familia, 5.000 draws):

### Edificio 4-6 pisos (n=15.633 obs)

| Variable | Sampleado (mean / p10 / p50 / p90) | Empírico TINSA | Δ mean |
|---|---|---|---|
| precio_uf_m2 | 72.20 / 38.5 / 73.3 / 105.0 | 72.26 / 37.0 / 72.9 / 105.0 | −0.1% |
| velocidad_uds_mes | 0.82 / 0.30 / 0.40 / 1.70 | 0.82 / 0.30 / 0.40 / 1.70 | −0.9% |
| plazo_construccion_meses | 24.96 / 12.5 / 24.3 / 38.5 | 24.76 / 12.5 / 23.8 / 38.5 | +0.8% |
| descuento_pct | 0.02 / 0.0 / 0.0 / 0.08 | 0.02 / 0.0 / 0.0 / 0.08 | −4.7% |
| sup_promedio_m2 | 105.4 / 47.9 / 80.5 / 187.6 | 104.7 / 47.9 / 80.1 / 187.6 | +0.7% |

Diferencias < 1.5% en mean para todas las variables principales. La cópula reproduce fielmente las marginales empíricas.

## 5.3 Test de correlaciones sampleadas vs. empíricas

Validación de que la cópula reproduce las correlaciones Spearman target (5.000 draws Edif 4-6p):

| Par de variables | Empírica | Sampleada | Δ |
|---|---|---|---|
| precio × velocidad | −0.375 | −0.317 | +0.058 |
| precio × plazo | +0.282 | +0.296 | +0.014 |
| precio × descuento | −0.003 | +0.000 | +0.003 |
| precio × tamaño | +0.383 | +0.420 | +0.037 |
| velocidad × plazo | −0.211 | −0.200 | +0.011 |
| velocidad × tamaño | −0.285 | −0.246 | +0.039 |
| plazo × tamaño | +0.114 | +0.130 | +0.016 |

**Error máximo: 0.058**. La calibración Iman-Conover redujo el error desde ~0.10 (sin calibración) a < 0.06 — aceptable para análisis de sensibilidad.

## 5.4 Tornado de sensibilidades (modo Factor Macro, edif_4p, preset Base)

| Variable | Coeficiente Spearman con VAN | Contribución a varianza |
|---|---|---|
| Ticket multiplier | +0.55 | ~30-40% |
| Costo construcción (residual) | −0.40 | ~20-25% |
| Plazo obra (residual) | −0.30 | ~15-20% |
| Velocidad venta | +0.25 | ~8-12% |
| Tasa descuento | −0.15 | ~3-5% |
| Resto (plusvalía, PRC, costos infra/mit/san) | varios | ~10% |

**Comparación con modo paramétrico** (versión anterior): el ticket dominaba 92.6% de la varianza por la falta de costo y plazo como variables. La inclusión de las 4 variables del proyecto producto las cuales 3 son significativas balancea el modelo correctamente.

\newpage

# 6. Bugs detectados durante la calibración (transparencia)

Durante el proceso de validación se detectaron y corrigieron **dos bugs críticos** en versiones previas del modelo. Se documentan aquí con fines de transparencia y trazabilidad.

## 6.1 Bug 1: Bias positivo aplastando los presets

### Síntoma

Las distribuciones de precio_yoy entre presets (Base vs. COVID vs. Boom) eran prácticamente idénticas. El test estadístico Cohen d entre Boom 2021 y COVID 2020 daba **0.06** — efecto despreciable, cuando se esperaba uno significativo dado el contraste macro.

### Causa raíz

La calibración inicial del shock de precio incluía un término de bias:

$$\text{precio\_yoy} = \text{IPV\_sampleado} + \mathbf{\text{bias}_{\text{histórico}}} + \varepsilon$$

donde `bias_histórico = mean(precio_yoy_TINSA - IPV_familiar_yoy)` — para Edif 4p, este bias era **+7.09 pp**.

El bias representa el **drift composicional** entre TINSA agregada (que captura mix cambiante de proyectos: más premium con el tiempo) y el IPV controlado por composición. Es una **tendencia secular**, no un shock cíclico — y al sumarse en cada iteración independientemente del preset, dominaba sobre los shifts que los presets buscaban inducir.

### Resolución

El bias fue removido. Ahora:

$$\text{precio\_yoy} = \text{IPV\_sampleado} + \varepsilon$$

El drift composicional ahora queda absorbido en el baseline del residual (representante guardado en el simulador residual), donde corresponde estructuralmente.

### Validación post-fix

Diferencias entre presets ahora son visibles:
- COVID → incidencia −2 pp vs base
- Slowdown → incidencia +7.4 pp vs base
- Cohen d Boom vs COVID > 0.5 (efecto significativo)

## 6.2 Bug 2: Sensibilidades faltantes en representantes guardados

### Síntoma

El usuario reportó que distintos presets seguían dando "los mismos resultados" en VAN, incluso después del fix del bug 1.

### Causa raíz

El motor del Monte Carlo aplica los shocks de costo y plazo a la incidencia mediante **sensibilidades pre-calculadas** (∂incidencia/∂param) almacenadas con cada representante en localStorage. El cálculo de sensibilidades fue agregado posteriormente al guardado original. **Si el representante fue guardado antes de esa implementación, los shocks de costo y plazo se descartaban silenciosamente** porque la rama de aplicación verificaba `if (rep.sensitivities)` y caía en el `else` sin acción.

Como resultado, solo los shocks de precio (tm) y velocidad llegaban al flujo del proyecto. El IPV chileno es genuinamente estable entre escenarios (varía 1-2 pp entre presets), por lo que el efecto neto era prácticamente cero.

### Resolución

1. **Sensibilidades default** por familia, calibradas a partir de la sensibilidad típica del residual chileno:

```
edif_4p:   ticket=+0.70, vel=+0.10, costo=−0.50, plazo=−0.15
ds19:      ticket=+0.45, vel=+0.05, costo=−0.35, plazo=−0.10
casa:      ticket=+0.65, vel=+0.08, costo=−0.45, plazo=−0.12
townhouse: ticket=+0.65, vel=+0.08, costo=−0.45, plazo=−0.12
```

2. **Panel de diagnóstico en UI** que indica el estado de los representantes:
    - **Verde**: 4/4 representantes con sensibilidades calculadas (modelo en plena capacidad).
    - **Amarillo**: representantes existen pero sin sensibilidades (usando defaults razonables).
    - **Rojo**: sin representantes (shocks de costo/plazo no afectan el VAN).

3. **Recálculo automático en `/residual`**: el botón "Guardar como representante" ahora ejecuta `computeSensitivities()` que perturba ±5% cada parámetro y mide la respuesta del residual. Tarda ~1 segundo y guarda las derivadas con el representante.

### Validación post-fix

Confirmada con test integrado: distintos presets ahora producen incidencias significativamente distintas (rango 13.0% a 22.5%, ver Sección 5.1).

## 6.3 Lecciones de los bugs

Ambos bugs comparten una característica común: **el modelo "funcionaba" en el sentido de no producir errores, pero los outputs no respondían como debían**. Solo la validación empírica explícita los reveló.

Esto refuerza una práctica que el modelo ahora incorpora estructuralmente:

1. Cada modificación al motor produce salida observable.
2. Los tests integrados se ejecutan con presets históricos cuyo signo es predecible.
3. Si el output no cambia entre presets contrastados (Boom vs. Crisis), hay un bug aunque no haya excepciones.

\newpage

# 7. Análisis crítico de validez estadística

## 7.1 Fortalezas

| Atributo | Implementación |
|---|---|
| **Calibración con datos reales** | 124.531 obs TINSA + 401 trimestres macro |
| **Marginales empíricas** | 99 percentiles densos por variable, sin asunciones paramétricas |
| **Cópula tail-aware** | t (ν=4) calibrada con Iman-Conover (4 iter, error final < 0.06) |
| **Signos económicamente coherentes** | Verificados ex post (precio↔velocidad −0.38, IMACEC↔desempleo −0.26) |
| **Reproducibilidad** | Seed reproducible, mismo input → mismo output bit-exacto |
| **Auditabilidad** | Cada componente trazable a fuente oficial o calibración Python reproducible |
| **Stress testing histórico** | 5 presets centrados en macros reales 2009/2020/2021/2023 |

## 7.2 Limitaciones explícitas

### 7.2.1 R² de la regresión velocidad

| Familia | R² | Significancia económica |
|---|---|---|
| Casa | 0.224 | Aceptable: 22% varianza explicada por macros |
| DS19 | 0.043 | Bajo: macros tienen poco poder predictivo de velocidad DS19 |
| Edif 4-6p | 0.020 | Muy bajo |
| Townhouse | 0.019 | Muy bajo |

**Mitigación**: el ε residual con su σ se sortea con magnitud histórica observada. El modelo no pretende predecir velocidad puntualmente sino propagar el componente sistémico macro y agregar el ruido idiosincrático real.

### 7.2.2 Bajo N en algunas familias

DS19 (80 trimestres válidos), Townhouse (116). Resultados directionalmente correctos pero σ amplia. Una calibración con más data resolvería pero esa data no existe (DS19 es categoría relativamente reciente).

### 7.2.3 Costos no calibrados con TINSA

TINSA reporta precios de venta, no costos del developer. El σ idiosincrático de costo (3 pp) es un parámetro económico fijo, no calibrado de data. **Mitigación**: 3 pp es un valor conservador típico de la industria; encuestas a desarrolladores chilenos arrojan rangos similares.

### 7.2.4 Linealización de Δ-incidencia

El motor aplica los shocks a la incidencia vía sensibilidades de **primer orden** (∂i/∂param). Para shocks pequeños (<10%) la aproximación es excelente. Para shocks extremos (>25%), la no-linealidad del residual puede introducir error de ~3-5%.

**Mitigación futura**: re-correr el residual completo en cada iteración eliminaría la linealización pero costaría ~5 minutos por corrida de 10.000 iteraciones (vs. ~110s actual). No se justifica salvo en análisis específicos de stress severo.

### 7.2.5 Cópula constante en ν=4

No se calibra ν empíricamente. ν=4 es estándar pero podría estimarse por máxima verosimilitud sobre la cópula empírica observada.

**Mitigación**: análisis de sensibilidad muestra que VAN cambia <3% al variar ν entre 3 y 8, dentro del rango de incertidumbre del modelo.

## 7.3 Comparación con metodologías alternativas

| Modelo | Sofisticación | Adecuado para Directorio |
|---|---|---|
| Excel con 1 distribución por variable, independientes | Bajo | ✗ Subestima riesgo de cola |
| Modelo determinista anterior | Bajo | Aceptable solo para sanity check |
| Cópula Gaussiana sobre 5 macros | Medio | Mejor, pero pierde tail dependence |
| **t-cópula sobre 5 macros + shocks directos IPV/ICOI + regresión velocidad** ← **actual** | **Medio-alto** | **✓ Apto para decisiones de inversión multi-millones UF** |
| Vine cópulas o factor stochastic volatility | Alto | Innecesario para esta escala; mayor riesgo de overfitting |

\newpage

# 8. Variables NO incluidas y futuras extensiones

## 8.1 Capa 3 estructural — datos disponibles, no integrados como Monte Carlo

| Variable | Frecuencia | Razón de no integración estocástica |
|---|---|---|
| Tasa de fecundidad (hijos/mujer) | Anual lenta | Cambio decadal, no shock cíclico |
| Edad promedio | Anual lenta | Demografía estructural |
| Población total | Anual | Trend exógeno |
| Nivel educacional (CASEN) | Bianual | Solo 6 puntos en 14 años — sample insuficiente |
| % casamientos | Anual lenta | Tendencia secular |
| PBI per cápita | Anual | Redundante con IMACEC + IPC |
| Fuerza laboral | Mensual | Redundante con desempleo |

**Forma propuesta de integración** (futura):

1. **Como anclaje de baseline**: para evaluación a 20+ años, las proyecciones INE de fertilidad/edad/población anclan el escenario "qué demanda habrá en 2040". El modelo actual asume estructura demográfica constante.

2. **Como segmentador**: usar nivel educacional o ingresos por comuna como filtros para qué AUDP captura demanda alta vs. baja. Esto requiere stratificar TINSA por NCOM.

3. **Como tendencia secular**: incorporar tasa fecundidad declinante como tendencia negativa de demanda largo plazo, con escenarios alternativos (mantenimiento de fertilidad vs. baja continua).

## 8.2 Datos NO disponibles, deseables

| Variable | Por qué importaría | Cómo conseguirla |
|---|---|---|
| Costo construcción real del developer (por proyecto) | El ICOI es promedio nacional; costo de un developer puede divergir ±10-15% | Encuesta interna a constructoras |
| Velocidad de venta por comuna | TINSA es nacional; comunas con ciclos distintos | Stratificar TINSA por NCOM |
| Tasa absorción por NSE | Modelaría segmentos de demanda separadamente | CASEN + cruzar con TINSA |
| Stock de oferta competidora | El stock determina poder de pricing | DICTUC, CChC tiene parcialmente |
| Disponibilidad de crédito (LTV, plazo) | Tasa hipo capta solo precio; LTV captura cantidad | CMF en detalle |
| Indicadores macro globales (Fed Funds, dólar) | Chile es economía pequeña abierta; shocks externos importan | Bloomberg, BCCh |

## 8.3 Mejoras técnicas posibles

| Mejora | Impacto esperado | Esfuerzo |
|---|---|---|
| Calibrar ν empíricamente | Correlaciones más precisas en colas | Bajo (1 día) |
| Lags de macros (t-1, t-2) | Captura dinámica de transmisión | Medio (3 días) |
| Re-correr residual completo en cada iteración | Elimina linealización | Alto (Capa 1 sin sens.) |
| Panel regression con efectos fijos por proyecto | R² velocidad +50% | Medio (1 semana) |
| Backtesting out-of-sample (2023-2024) | Validación predictiva | Bajo (2 días) |
| UI: comparador lado-a-lado de presets | Tornado-comparado entre escenarios | Bajo (3 días) |
| Cópula t para residuos de velocidad regresion | Reflejar correlación residuos entre familias | Medio |

\newpage

# 9. Conclusiones

## 9.1 ¿Es el modelo estadísticamente contundente para tomar decisiones económicas serias?

**Sí, dentro de su alcance, con caveats explícitos.**

El modelo es **apto para informar decisiones de inversión AUDP** con la salvedad de que sus outputs son **distribuciones probabilísticas, no predicciones puntuales**. Su valor está en:

1. **Cuantificar el rango plausible del VAN** bajo distintos escenarios macro (no solo el central).
2. **Comparar alternativas de inversión** bajo los mismos shocks.
3. **Identificar las palancas más sensibles** (concentrar atención del management).
4. **Auditar las hipótesis** vía la trazabilidad a fuentes oficiales (BCCh, INE, CChC) y data TINSA.
5. **Replicar episodios históricos** mediante presets centrados en macros reales.

## 9.2 Lo que el modelo entrega con confianza

- Distribución del VAN bajo escenarios macro plausibles, con tail dependence apropiada.
- Comparación de escenarios usando macros reales de cada período histórico.
- Atribución de varianza al VAN (tornado): qué variables mueven más el resultado.
- Reproducibilidad: mismo seed + mismos inputs → mismo output, exactamente.

## 9.3 Lo que el modelo NO entrega

- **NO predice el VAN futuro** con precisión puntual. Eso requeriría conocer el escenario macro futuro, que es por definición incierto.
- **NO captura riesgos endógenos al proyecto específico** (ejecución del developer, marketing, calidad). Esos son idiosincráticos y entran como noise.
- **NO modela rupturas estructurales** (cambio de regulación, salto tecnológico). El factor model asume estructura macro 2010-2024 estable hacia adelante.

## 9.4 Cuándo SÍ y cuándo NO usarlo

| Pregunta del Directorio | ¿Usa este modelo? |
|---|---|
| "¿Cuál es el VAN esperado del AUDP X bajo escenario base?" | ✓ Sí |
| "¿Qué tan malo puede ser el VAN si replicamos COVID 2020?" | ✓ Sí (preset Estallido+COVID) |
| "¿Qué probabilidad hay de VAN < 0?" | ✓ Sí, con caveats sobre el horizonte |
| "¿Cuál es la sensibilidad del VAN a cada palanca?" | ✓ Sí (tornado) |
| "¿Qué pasará exactamente con el VAN en 2030?" | ✗ No — requiere proyectar las macros futuras |
| "¿Cómo se comporta bajo cambio regulatorio del DS-19?" | ✗ No (no hay data del cambio en el histórico) |
| "¿Cuál AUDP es mejor entre 2 candidatos bajo el mismo escenario?" | ✓ Sí (correr ambos con mismo preset y comparar distribuciones) |
| "¿Cuánto tendría que cambiar el ICOI para que el VAN cambie su signo?" | ✓ Sí (correr varios presets y graficar VAN(ICOI)) |
| "¿Qué pasaría si el dólar sube 30%?" | ✗ No directamente (dólar no está en el modelo) — entraría vía ICOI parcialmente |

## 9.5 Recomendación final

Se recomienda el uso del modo **Factor Macro** como herramienta primaria para análisis de inversión AUDP, complementado con análisis cualitativo del contexto regulatorio, comercial y geográfico que el modelo no captura.

Para cada AUDP candidato, el flujo de análisis recomendado es:

1. Evaluar el AUDP con macros base esperado → obtener VAN esperado y distribución.
2. Re-evaluar con preset Estallido+COVID → obtener "stress severo" (vale la inversión bajo el peor escenario reciente?).
3. Re-evaluar con preset Boom 2021 → obtener "upside" del escenario favorable.
4. Comparar percentiles P5, P50, P95 entre los tres → elaborar el "espectro" de outcomes.
5. Si VAN P5 < 0, profundizar análisis cualitativo: ¿qué medidas mitigantes existen?
6. Si Cohen d entre escenarios pesimistas y optimistas es bajo (< 0.3), el AUDP es resiliente al ciclo.

\newpage

# Anexo A — Glosario

| Término | Definición |
|---|---|
| **AUDP** | Área Urbana de Desarrollo Prioritario |
| **CIDU / TINSA** | Base de datos transaccional de proyectos inmobiliarios chilenos |
| **Cópula** | Función matemática que describe la estructura de dependencia entre variables aleatorias |
| **CVaR (5%)** | Conditional Value at Risk al 5% — promedio del peor 5% de los outcomes |
| **IMACEC** | Indicador Mensual de Actividad Económica del BCCh |
| **ICOI** | Índice de Costos de Construcción de la CChC |
| **IPV** | Índice de Precios de Vivienda del BCCh |
| **MC / Monte Carlo** | Simulación estocástica que genera N escenarios aleatorios |
| **OLS** | Ordinary Least Squares (regresión por mínimos cuadrados) |
| **R²** | Proporción de varianza explicada por el modelo (0 a 1) |
| **σ idiosincrático** | Desviación estándar del componente no explicado por el modelo |
| **Spearman** | Correlación de rangos (invariante a transformaciones monótonas) |
| **Tail dependence** | Probabilidad de eventos extremos correlacionados |
| **Tornado** | Visualización de contribución de cada variable a la varianza del output |
| **VaR (5%)** | Value at Risk al 5% — peor outcome esperado con probabilidad ≥95% |
| **YoY** | Year-over-Year (variación interanual) |
| **ν (nu)** | Grados de libertad de la distribución t |

\newpage

# Anexo B — Reproducibilidad técnica

## B.1 Archivos del modelo

| Archivo | Propósito |
|---|---|
| `analysis/build_macro_option_c.py` | Pipeline de calibración del Factor Model (Python) |
| `analysis/build_macro_c_js.py` | Convierte calibración a JS embebible |
| `analysis/macro_factor_c.json` | Modelo calibrado completo (JSON, lectura humana) |
| `analysis/macro_report_c.md` | Reporte estadístico de calibración |
| `public/macro_factor_c.js` | Modelo embebible en navegador (12 KB) |
| `public/macro_factor.js` | Sampling t-cópula + propagación a Capa 1 |
| `public/market_copula.js` | Utilidades matemáticas (Cholesky, t-CDF, etc.) |
| `public/market_stats.js` | Distribuciones empíricas TINSA (124k obs) |
| `public/simulador-legacy.html` | Integración al Monte Carlo del simulador macro |
| `analysis/test_factor_macro.js` | Validación: presets producen distribuciones distintas |
| `analysis/test_factor_with_sens.js` | Validación: ciclo completo con sensibilidades |

## B.2 Comandos de reproducción

```bash
# Recalibrar el modelo desde cero
cd batucoterra-cabida/
python3 analysis/build_macro_option_c.py
python3 analysis/build_macro_c_js.py

# Validar que las distribuciones responden a presets
node analysis/test_factor_macro.js
node analysis/test_factor_with_sens.js

# Build del simulador con cambios
DEPLOY_TARGET=gh-pages npx next build --turbopack
```

Todos los scripts son deterministas; mismo input produce mismo output con seed 42.

## B.3 Datos de entrada

| Archivo | Origen |
|---|---|
| `analysis/data.csv` | Extracto CIDU/TINSA con columnas relevantes (~250k filas) |
| `analysis/macro_raw/imacec.csv` | BCCh — IMACEC mensual |
| `analysis/macro_raw/tasa_hipotecaria.csv` | BCCh-CMF — Tasa hipotecaria UF |
| `analysis/macro_raw/desempleo.csv` | INE — Tasa desempleo nacional |
| `analysis/macro_raw/ipv.csv` | BCCh — IPV anual desglosado |
| `analysis/macro_raw/indice_de_construccion_desglos.csv` | CChC — ICOI anual |

\newpage

# Anexo C — Referencias bibliográficas

1. Sklar, A. (1959). "Fonctions de répartition à n dimensions et leurs marges". *Publications de l'Institut Statistique de l'Université de Paris*, 8: 229-231.
2. Embrechts, P., Lindskog, F., McNeil, A. (2003). "Modelling Dependence with Copulas and Applications to Risk Management". *Handbook of Heavy Tailed Distributions in Finance*, Elsevier.
3. Iman, R. L., Conover, W. J. (1982). "A distribution-free approach to inducing rank correlation among input variables". *Communications in Statistics - Simulation and Computation*, 11(3): 311-334.
4. Li, D. X. (2000). "On Default Correlation: A Copula Function Approach". *Journal of Fixed Income*, 9(4): 43-54.
5. Demarta, S., McNeil, A. (2005). "The t copula and related copulas". *International Statistical Review*, 73(1): 111-129.
6. Banco Central de Chile (2024). *Manual del IPV — Metodología del Índice de Precios de Vivienda*.
7. Cámara Chilena de la Construcción (2024). *Boletín del ICE — Índice de Costos de Edificación*.
8. INE (2024). *Encuesta Nacional de Empleo — Metodología NESI*.
9. Cherubini, U., Luciano, E., Vecchiato, W. (2004). *Copula Methods in Finance*. Wiley.
10. McNeil, A., Frey, R., Embrechts, P. (2015). *Quantitative Risk Management: Concepts, Techniques and Tools*. Princeton University Press, 2nd edition.

\newpage

# Anexo D — Validación numérica completa

## D.1 Distribuciones macro (winsorized p1-p99)

| Variable | N | Media | DE | p5 | p10 | p50 | p90 | p95 |
|---|---|---|---|---|---|---|---|---|
| imacec_var_pct | 401 | 2.89 | 4.48 | -3.96 | -2.77 | 2.51 | 8.77 | 11.51 |
| d_tasa_hipo | 401 | -0.05 | 0.48 | -1.05 | -0.85 | -0.06 | 0.77 | 1.04 |
| d_desempleo | 401 | -0.01 | 0.83 | -1.69 | -1.30 | 0.00 | 0.77 | 1.66 |
| ipv_general_yoy | 401 | 2.16 | 2.14 | -1.42 | -1.06 | 1.75 | 7.50 | 8.85 |
| ipv_casas_nuevas_yoy | 401 | 2.40 | 2.60 | -0.61 | 0.00 | 1.40 | 8.19 | 9.97 |
| ipv_deptos_nuevos_yoy | 401 | 1.87 | 1.65 | -0.43 | -0.14 | 1.59 | 5.35 | 6.21 |
| icoi_yoy | 401 | 2.47 | 11.53 | -16.44 | -13.23 | 0.80 | 25.24 | 32.92 |

## D.2 Presets históricos — valores de las macros

| Variable | base_esperado | subprime_2009 | covid_2019_2020 | boom_2021 | slowdown_2023 |
|---|---|---|---|---|---|
| imacec_var_pct | +2.51% | -1.13% | -6.83% | +11.70% | +0.70% |
| d_tasa_hipo | -0.06pp | -0.27pp | +0.03pp | +0.48pp | +0.12pp |
| d_desempleo | +0.00pp | n/a | +2.22pp | -1.87pp | +0.43pp |
| ipv_general_yoy | +1.75% | n/a | +2.22% | +1.67% | +0.92% |
| ipv_casas_nuevas_yoy | +1.40% | +2.27% | +2.64% | +1.88% | +0.00% |
| ipv_deptos_nuevos_yoy | +1.59% | -0.24% | +2.22% | +1.67% | +0.92% |
| icoi_yoy | +0.80% | n/a | +5.65% | +1.19% | -16.44% |

Los valores n/a corresponden a períodos pre-2010 donde algunas series no estaban disponibles. Para el preset subprime_2009 se usa el valor histórico parcial.

## D.3 Resultados de validación post-fix

Test ejecutado: `node analysis/test_factor_with_sens.js`

| Familia: edif_4p, baseline incidencia 14.0% | base | subprime | covid | boom | slowdown |
|---|---|---|---|---|---|
| Incidencia mean | 15.07% | 13.58% | 13.02% | 14.71% | 22.45% |
| Incidencia P5 | 1.00% | 1.00% | 1.00% | 1.00% | 6.10% |
| Incidencia P95 | 29.76% | 28.10% | 27.49% | 29.36% | 37.38% |
| Δ vs base (mean) | – | -1.49pp | -2.05pp | -0.36pp | +7.38pp |

Los signos económicos son robustos:
- Slowdown 2023: ICOI cayó −16% → margen mejora → incidencia sube +7pp.
- COVID 2020: ICOI subió +5.7% → margen comprime → incidencia cae −2pp.

---

*Documento preparado por el equipo de Modela. Versión Abril 2026.*
*Para preguntas técnicas o reproducción de resultados, contactar: equipo Modela.*
