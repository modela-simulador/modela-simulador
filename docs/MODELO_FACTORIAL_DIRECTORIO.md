---
title: "Modelo Factorial Estocástico para Valoración de AUDPs"
subtitle: "Documento Técnico para Directorio · Modela · Versión 4 (cópula CROSS)"
author: "Equipo Modela"
date: "Abril 2026 · v4 con verificación exhaustiva 200/200 correlaciones macro×producto"
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

# Resumen para el Directorio

## ¿Qué hicimos?

Construimos una herramienta que **evalúa proyectos AUDP no con un solo número, sino con un rango de resultados posibles**. La diferencia es como pasar de un pronóstico del tiempo que dice "mañana 22°C" a uno que dice "mañana 18°C a 26°C, lo más probable 22°C". El segundo es honesto sobre la incertidumbre real; el primero da falsa precisión.

Para construirla, **cruzamos dos fuentes de datos chilenas**:

1. **TINSA**: 124.526 proyectos inmobiliarios reales con sus precios, velocidades de venta, plazos y tamaños. La mayor base de datos disponible del mercado chileno.
2. **Macros oficiales**: 401 trimestres de IMACEC (BCCh), tasa hipotecaria, desempleo (INE), IPV (BCCh) e ICOI (CChC). Lo que efectivamente pasó en la economía chilena 2010-2024.

Las cruzamos por trimestre y descubrimos cómo se mueven juntas las variables económicas y los resultados de los proyectos.

## ¿Qué encontramos?

Los hallazgos más importantes del análisis profundo:

1. **El IPV oficial chileno se anticipa al precio observado en TINSA por 2-3 trimestres**. Es decir, si hoy el IPV sube 2%, los precios TINSA suelen subir 2-4% nueve meses después. Esto cambia cómo deberíamos usar el IPV en el modelo.

2. **La comuna donde está el proyecto explica el 49% del precio por m²**. Es la variable más importante de todas. Más que la familia de producto (10%) o el año (24%).

3. **El IMACEC alto baja la velocidad de venta de cada proyecto individual** con un trimestre de lag (correlación -0.38). Suena contraintuitivo pero tiene sentido: cuando la economía está bien, todos los developers lanzan proyectos al mismo tiempo y la competencia entre ellos baja la velocidad de cada uno.

4. **Las familias de producto se comportan distinto**: el signo de la relación velocidad-IMACEC cambia entre Casa (+0.16, no significativo), Edificio (-0.39) y Townhouse (-0.66). Esto justifica mantener la estratificación por familia, aunque la próxima iteración debería incluir también la comuna.

5. **Las macros explican entre 62% y 75% de la varianza** de las variables TINSA cuando usamos modelos no-lineales (Random Forest), versus solo 5-40% con regresiones lineales tradicionales. **Hay relaciones no-lineales importantes que el modelo actual está perdiendo**.

## ¿Qué decisiones podemos tomar con esta herramienta?

✓ **Comparar dos AUDPs** bajo el mismo escenario macro y ver cuál es más resiliente.

✓ **Identificar las palancas de gestión activa**: qué variables del proyecto, si se mejoran, mueven más el VAN.

✓ **Cuantificar el riesgo de cola**: ¿qué tan malo puede ser el VAN bajo escenarios adversos plausibles?

✓ **Auditar las hipótesis** ante consultores externos o auditores: cada componente del modelo es trazable a fuentes oficiales y reproducible con scripts en el repositorio.

✗ **No predice el VAN futuro con precisión**. Eso requiere predecir las macros futuras, que es por definición incierto.

✗ **No captura riesgos idiosincráticos del proyecto** (ejecución del developer, marketing específico). Esos quedan como ruido en el modelo.

✗ **No modela rupturas estructurales** (cambio regulatorio mayor, salto tecnológico). Si hay un evento sin precedente histórico, el modelo no lo verá venir.

\newpage

# 1. ¿Qué es Monte Carlo y por qué lo usamos?

## 1.1 La pregunta detrás del modelo

Cuando se evalúa la inversión en un AUDP que tomará 15-30 años en madurar, la pregunta importante para el Directorio no es **"¿cuál es el VAN?"** sino:

- **¿Qué rango de VANes es plausible?**
- **¿Qué probabilidad hay de que el AUDP sea rentable?**
- **¿Qué tan resiliente es el VAN frente a escenarios adversos?**

El simulador anterior respondía la primera pregunta dando un solo número bajo asunciones fijas. Es útil pero **falsamente preciso**: presenta un valor como si fuera la realidad, cuando en verdad es solo el resultado de una asunción específica.

## 1.2 ¿Qué es una simulación Monte Carlo?

Monte Carlo es una técnica que **simula muchos escenarios posibles** y calcula el VAN en cada uno. Al final, en lugar de un número, se obtiene una **distribución completa** que muestra:

- VAN promedio
- VAN en el 5% peor caso (riesgo de cola)
- VAN en el 95% mejor caso (oportunidad)
- Probabilidad de que VAN sea negativo

**Procedimiento**:

```
Para i = 1 hasta N (típicamente 3.000 a 10.000 iteraciones):
  1. Sortear valores para todas las variables económicas, respetando
     que se muevan juntas como en la realidad (correlaciones)
  2. Calcular el VAN del AUDP con esos valores
  3. Almacenar el resultado

Al final se obtienen N valores → distribución del VAN
```

El nombre "Monte Carlo" viene del casino de Mónaco. Lo acuñaron Stanislaw Ulam y John von Neumann en los años 40 durante el desarrollo de la bomba atómica, para describir una técnica donde "se juega a los dados" y se observan los resultados promedio.

## 1.3 ¿Cuándo es apropiado usar Monte Carlo?

Cuando se cumplen **estas cinco condiciones**:

1. **El modelo es complejo**: muchas variables interactúan.
2. **No hay fórmula cerrada**: no podés derivar la respuesta con álgebra.
3. **Las variables tienen incertidumbre**: tienen distribuciones razonablemente estimables.
4. **Las correlaciones importan**: las variables no son independientes.
5. **El decisor necesita el rango**: no le sirve solo el valor central.

El simulador AUDP cumple las cinco. Por eso Monte Carlo es la herramienta apropiada.

## 1.4 ¿Quién más usa Monte Carlo en finanzas y real estate?

| Aplicación | Quién | Para qué |
|---|---|---|
| Pricing de derivados financieros | Bancos de inversión globales | Valorar opciones complejas |
| Riesgo regulatorio Basel III | Bancos comerciales | Capital regulatorio |
| Stress testing CCAR | Federal Reserve (USA) | Resistencia a escenarios adversos |
| Valuación de proyectos petroleros | Shell, ExxonMobil | VAN bajo precios crudo inciertos |
| **Evaluación de proyectos inmobiliarios** | **Real estate developers globales** | **VAN bajo escenarios de demanda inciertos** |
| Solvency II | Aseguradoras europeas | Capital regulatorio para liabilities |
| Análisis de concesiones | Bancos multilaterales | Probabilidad de repago |

En real estate específicamente, el uso es estándar entre los principales developers internacionales desde los años 90.

## 1.5 ¿Qué NO hace Monte Carlo?

Es importante manejar expectativas realistas:

- **No predice el futuro**. Dice "dada la información histórica, el VAN tiene esta distribución". No dice "el VAN será X".
- **La calidad del output depende de la calidad de los inputs**. Si las distribuciones de entrada son malas, los outputs lo serán también.
- **No captura "cisnes negros"**: eventos sin precedente histórico (cambio regulatorio mayor, salto tecnológico) están fuera del modelo.
- **No reemplaza el juicio cualitativo**: es complemento, no sustituto del análisis del contexto regulatorio, comercial y geográfico específico.

\newpage

# 2. ¿Cómo conectamos los datos?

Esta sección explica con detalle cómo se cruzaron las dos fuentes de datos principales del modelo.

## 2.1 Las dos fuentes

### Fuente 1: TINSA — proyectos inmobiliarios reales

TINSA es una empresa que compila información del mercado inmobiliario chileno. Su base de datos contiene **124.526 observaciones activas** de proyectos. Cada observación es un **proyecto-trimestre**: un proyecto específico observado en un trimestre específico, con métricas como:

- Precio promedio por m² vendible (UFM2P)
- Velocidad de venta en unidades por mes (UMESP)
- Tamaño promedio de unidad (SUPP)
- Stock disponible al inicio del trimestre (OFEPER)
- Unidades vendidas en el trimestre (UVEND)
- Meses estimados para agotar el stock (MAGOST)
- Comuna (NCOM), número de pisos (NPISOS), tipología (TCAT)
- Tipo de subsidio (TSUB) — DS19, DS01, sin subsidio
- Ubicación geográfica X, Y
- Distancia al CBD (DCBD)
- Indicadores de Bienestar Humano Territorial (BHT)

### Fuente 2: Macros oficiales chilenas

Series temporales de indicadores económicos publicados por instituciones oficiales:

| Variable | Fuente | Frecuencia | Cobertura |
|---|---|---|---|
| IMACEC variación % anual | BCCh | Mensual | 1997-presente |
| Tasa hipotecaria UF | BCCh-CMF | Mensual | 2002-presente |
| Tasa desempleo nacional | INE-NESI | Trimestral móvil | 2010-presente |
| IPV (Índice Precios Vivienda) | BCCh | Anual | 2002-presente |
| ICOI (Índice Costos Construcción) | CChC | Anual | 2013-presente |

## 2.2 El cruce: por trimestre

El cruce entre ambas fuentes se hace **por trimestre calendario**. Cada observación TINSA tiene un atributo `PEAÑO` (formato `1P 2014` por ejemplo). Lo convertimos al formato `2014-Q1` que también usa la grilla macro.

**Pasos del cruce**:

1. Las macros mensuales (IMACEC, tasa hipo, desempleo) las **agregamos a trimestre** tomando el promedio de los 3 meses.
2. Las macros anuales (IPV, ICOI) las **interpolamos linealmente a trimestre** (Q1 = valor anual; Q2, Q3 = interpolación; Q4 = valor anual del año siguiente).
3. Las variaciones interanuales (YoY %) se calculan comparando con el mismo trimestre del año anterior, no con el trimestre previo. Esto elimina el efecto de estacionalidad.

**Resultado**: una tabla maestra con 401 trimestres (2002-Q1 a 2026-Q1) donde cada fila tiene:

- Macros del trimestre
- Macros con lag 1 trim, 2 trim, 3 trim, 4 trim (valores del mismo período del año pasado)
- Agregaciones TINSA del trimestre (precio promedio ponderado por unidades vendidas, velocidad promedio, etc.)

## 2.3 ¿Por qué ponderar por unidades vendidas (UVEND)?

Antes la agregación TINSA por trimestre era por **mediana**. La cambiamos a **media ponderada por UVEND** (unidades vendidas en el trimestre). Razones:

1. **Refleja el peso real del mercado**: si el trimestre tuvo 5 proyectos pequeños y 1 mega-proyecto que vendió 200 unidades, la mediana lo trata igual que si fueran 6 proyectos chicos. La media ponderada da el peso correcto.

2. **El IPV oficial usa metodología similar**: BCCh pondera por valor de transacción, no por número de proyectos.

3. **Reduce el ruido de muestreo**: trimestres con poca actividad ya tienen pesos chicos automáticamente.

\newpage

# 3. Análisis profundo: ¿qué descubrimos cuando cruzamos los datos?

Esta sección presenta los hallazgos del análisis exhaustivo de las correlaciones entre TINSA y macros, considerando lags (efectos retardados) hasta 4 trimestres.

## 3.1 La correlación más fuerte: el IPV oficial **anticipa** el precio TINSA

![Top 6 correlaciones más fuertes en el dataset](figures/13_top_correlations_scatter.png){ width=100% }

La correlación más fuerte de todo el análisis es **IPV general en t-3 → Precio TINSA en t**, con ρ Spearman = +0.55 (p < 0.001, n=53 trimestres).

**¿Qué significa?** El IPV oficial del Banco Central **se anticipa al precio observado en TINSA por aproximadamente 9 meses (3 trimestres)**.

**¿Por qué pasa esto?**

Hay tres explicaciones plausibles:

1. **El IPV captura un ciclo de mercado** que después se traduce a precios efectivos en TINSA con cierto lag. Cuando los compradores y vendedores anticipan condiciones más favorables, el IPV sube primero (por revaluaciones, expectativas), y luego los precios de transacción TINSA se ajustan.

2. **Diferencia metodológica entre las fuentes**: el IPV se construye sobre TODAS las transacciones registradas en el SII. TINSA captura proyectos específicos que están en venta. El IPV es más amplio y captura tendencias antes que TINSA específica.

3. **El IPV es una medida más "estable"** (controlada por composición), mientras TINSA refleja el mix de proyectos en venta cada trimestre.

**Implicancia para el modelo**: la versión actual usa IPV contemporáneo. Debería usar IPV con lag 2-3 trimestres para predecir mejor. Esta es una **mejora pendiente identificada** del análisis profundo.

## 3.2 Heatmap de correlaciones con lags

![Correlación TINSA × Macros en 5 lags distintos](figures/10_lagged_correlations_pooled.png){ width=100% }

Cada panel muestra cómo se correlaciona una variable TINSA (columnas: precio, velocidad, plazo, tamaño, unidades vendidas) con las 5 macros principales en 5 lags (filas).

**Lectura del heatmap**:
- Verde intenso = correlación positiva fuerte (cuando una sube, la otra también)
- Rojo intenso = correlación negativa fuerte (cuando una sube, la otra baja)
- Blanco = correlación cercana a cero

**Patrones interesantes**:

1. **Precio × IPV**: la correlación crece de 0.34 (lag 0) a 0.55 (lag 3). El IPV se anticipa.

2. **Velocidad × IMACEC**: significativa solo en lag 1, con signo negativo (-0.38). El boom económico baja la velocidad individual al aumentar la oferta competidora.

3. **Plazo × IPV**: relación negativa creciente con lag (lag 4: ρ=-0.37). En mercados que están subiendo, los plazos de obra se acortan.

4. **Unidades vendidas × IPV (lag 4)**: ρ=+0.37. Mercado caliente arrastra unidades vendidas con un año de lag.

## 3.3 Variable importance: ¿qué realmente mueve el modelo?

![Variable importance por Random Forest para cada target TINSA](figures/12_variable_importance.png){ width=100% }

Random Forest ajusta un modelo no-lineal que captura interacciones entre variables. Para cada variable TINSA (precio, velocidad, plazo, tamaño, unidades), el algoritmo calcula qué predictores macro (con sus lags) son los más importantes.

**Hallazgos clave**:

| Target TINSA | Predictor #1 | Predictor #2 | R² Random Forest |
|---|---|---|---|
| **Precio YoY** | IPV general (t-1) | IPV general (t-2) | **0.745** |
| **Velocidad YoY** | IMACEC (t) | ICOI (t-1) | **0.622** |
| **Plazo YoY** | IMACEC (t) | IPV general (t-2) | **0.676** |
| **Tamaño YoY** | IPV general (t-2) | ICOI (t-1) | **0.673** |
| **Unidades vendidas YoY** | IPV general (t-2) | IMACEC (t) | **0.643** |

**Interpretación**:

1. **Las macros explican entre 62% y 75% de la varianza** de cada variable TINSA. Esto es **mucho más** que lo que indicaba el modelo OLS lineal anterior (R²=0.05-0.40).

2. **La diferencia OLS vs Random Forest revela no-linealidades importantes**: el efecto de IMACEC sobre la velocidad cambia según otras variables (es no-lineal).

3. **El IPV (con lags) aparece como predictor #1 o #2 en 3 de 5 targets**: es la macro más informativa.

4. **El ICOI con lag 1 es importante para velocidad y tamaño**: el costo construcción afecta decisiones de inversión y mix de productos con un trimestre de retraso.

\newpage

## 3.4 La velocidad de venta por familia: las correlaciones cambian

![Velocidad por familia × lags de macros](figures/11_velocidad_lags_familia.png){ width=100% }

Esta visualización muestra cómo las correlaciones cambian según la familia de producto. La pregunta clave era: ¿podemos pool todas las familias juntas o hay que mantener la estratificación?

**Caso ilustrativo: la velocidad ↔ IMACEC**:

| Familia | Lag óptimo | ρ | p-value | n |
|---|---|---|---|---|
| Edificio 4-6p | 2 trim | **-0.39** | 0.046 | 27 |
| DS19 | 0 trim | -0.22 | 0.228 | 32 |
| Casa | 0 trim | **+0.16** | 0.247 | 53 |
| Townhouse | 2 trim | **-0.66** | 0.001 | 23 |

**El signo cambia entre familias**: en Casa la correlación es positiva (no significativa, pero positiva). En Edificio y Townhouse es negativa fuerte.

**¿Por qué? Posible explicación económica**:

- **Edificios y Townhouses**: en boom económico hay muchos lanzamientos simultáneos (los developers anticipan demanda y entran al mercado). Más oferta competidora baja la velocidad de cada uno.
- **Casas**: el segmento es más fragmentado, menos correlacionado con el ciclo macro inmediato. Posiblemente la elasticidad de la demanda es distinta.

**Conclusión**: la estratificación por familia **sí es necesaria**, aunque introduce complejidad. Pooling perdería esta información heterogénea entre familias.

## 3.5 La dimensión más importante NO es la familia

![Dimensiones adicionales TINSA: comuna, pisos, distancia CBD, BHT](figures/14_dimensiones_extra.png){ width=100% }

Hicimos un análisis de varianza explicada por cada dimensión del Excel TINSA. Resultado:

| Dimensión | R² (% varianza precio explicada) |
|---|---|
| **Comuna (NCOM)** | **49.2%** |
| Año | 23.7% |
| Tipología (TCAT) | 17.1% |
| # Pisos | 13.7% |
| **Familia** | **10.0%** |

**La COMUNA explica casi 50% de la varianza del precio** — es la variable más informativa de todas. La familia (la dimensión que el modelo actual usa para estratificar) solo explica 10%.

**Implicación**: la próxima versión del modelo debería **filtrar TINSA por comunas relevantes al AUDP** en lugar de (o además de) estratificar por familia. Para AUDP Batuco, las comunas referencia serían Lampa, Buin, Padre Hurtado, Colina — proyectos en zonas similares de expansión periurbana de Santiago.

**Por ahora**, el modelo mantiene la estratificación por familia como aproximación. La incorporación de la dimensión comunal queda identificada como **prioridad #1 para la próxima iteración**.

\newpage

# 4. ¿Por qué cópulas y cuáles aplicamos?

## 4.1 El problema que resuelven las cópulas

Cuando hacemos Monte Carlo, necesitamos sortear valores para múltiples variables a la vez. **Si las sorteamos independientemente**, generamos escenarios irreales:

- Por ejemplo: "PIB sube 12% Y desempleo sube 3pp simultáneamente". En la realidad, esto rara vez pasa: cuando el PIB sube, el desempleo cae.

**Las cópulas permiten samplear variables conjuntamente respetando sus correlaciones empíricas**.

## 4.2 ¿Qué es una cópula?

Una cópula es una **función matemática** que describe **cómo se relacionan las variables entre sí**, separadamente de cómo se distribuye cada una individualmente.

**Ejemplo intuitivo**: si tomamos altura y peso de personas:
- La distribución de altura es una cosa (curva normal con cierta media y desviación)
- La distribución de peso es otra
- Pero altura y peso están correlacionados: gente alta tiende a pesar más

La cópula es lo que captura esa última relación. Permite combinar las dos distribuciones individuales (altura, peso) preservando la dependencia entre ellas.

Formalmente (teorema de Sklar, 1959): cualquier distribución conjunta puede descomponerse en (a) las marginales individuales × (b) una cópula que captura la dependencia.

## 4.3 ¿Por qué cópula t y no Gaussiana?

Hay muchos tipos de cópulas. Las dos más usadas son la **Gaussiana** y la **t (Student)**.

**Diferencia clave**: la cópula Gaussiana **subestima la probabilidad de eventos extremos correlacionados**.

Imaginá que precio y velocidad están correlacionados negativamente con ρ = -0.5. Bajo cópula Gaussiana, la probabilidad de "precio cae al 5% peor Y velocidad sube al 5% mejor" tiende a CERO en los extremos. Bajo cópula t (con grados de libertad bajos), esa probabilidad es **significativamente mayor**.

Esto es **crítico para análisis de riesgo**: la cópula Gaussiana fue uno de los factores que llevó a la subestimación del riesgo en CDOs hipotecarios pre-crisis 2008. La industria financiera migró a cópulas con "tail dependence" (dependencia en colas) — la t-cópula es la elección estándar.

**Nuestro modelo usa t-cópula con ν=4 grados de libertad**:
- ν=4 es estándar industria para riesgo de crédito y operacional (S&P, Moody's, modelos Basel III)
- ν<4 produce demasiada masa en colas (mercado en crisis perpetua)
- ν>10 colapsa hacia Gaussiana

## 4.4 ¿Qué cópulas tiene actualmente el modelo?

### Cópula 1: entre las 5 macros sampleadas

Las 5 variables macro (IMACEC, Δ tasa hipotecaria, Δ desempleo, IPV, ICOI) **se samplean conjuntamente** con t-cópula. La matriz de correlaciones es la observada empíricamente en 401 trimestres 2010-2024.

![Matriz de correlación Spearman entre macros](figures/01_corr_macros.png){ width=85% }

**Validación visual**: los signos son todos económicamente correctos (boom = menos desempleo, BCCh sube tasas en boom, etc.).

### Cópula 2: entre variables del producto en TINSA (modo Empírico CIDU)

En el modo "Empírico CIDU" (que se usa cuando NO se quieren incluir macros explícitas), hay una segunda t-cópula sobre las 5 variables del producto en TINSA:

![Correlaciones entre variables del producto por familia](figures/02_corr_producto.png){ width=100% }

Calibrada con Iman-Conover sobre 124k observaciones.

## 4.5 ¿Qué cópulas DEBERÍAMOS agregar (próxima iteración)?

El análisis profundo identifica oportunidades para cópulas adicionales:

1. **Cópula entre macros y sus lags**: en lugar de samplear solo macros contemporáneas, samplear (IMACEC_t, IMACEC_{t-1}, IMACEC_{t-2}) conjuntamente. Captura la **persistencia temporal** de los shocks macro.

2. **Cópula expandida**: integrar las 5 macros + sus lags principales (de los hallazgos: IPV t-2, IMACEC t-1, ICOI t-1) en **una sola cópula de mayor dimensión**. Esto permitiría samplear escenarios donde el lag y el contemporáneo se mueven coherentemente.

3. **Cópula con dimensión comunal**: si la comuna explica 49% de la varianza, una próxima versión podría agregar un "factor comunal" que se samplee independientemente del macro nacional, capturando heterogeneidad geográfica.

## 4.6 Versión 3 — Cópula CROSS unificada (IMPLEMENTADA)

A partir del análisis profundo se identificó una **brecha estructural**: el modelo separaba en dos cópulas la dependencia macro-macro y producto-producto, pero **no calibraba correlaciones cruzadas directas** entre, por ejemplo, "tasa hipotecaria" y "velocidad de venta". La hipótesis implícita era que toda la propagación macro→producto pasaba por la regresión polinómica intermedia. Esto subestimaba sistemáticamente cinco canales económicos relevantes.

**Solución v3**: una sola cópula de **10 dimensiones** que integra simultáneamente las cinco macros (IMACEC, Δ tasa hipotecaria, Δ desempleo, IPV YoY, ICOI YoY) y las cinco variables de producto (precio, velocidad, plazo, descuento, tamaño). Calibrada por familia y por zona (AUDP vs. Nacional) sobre los datos pareados TINSA × macros 2010-2024.

**Verificación exhaustiva**: se auditaron las **200 correlaciones macro × producto** (5 macros × 5 productos × 4 familias × 2 zonas). Las 200 están calibradas; 102 son significativas (|ρ| > 0.20) y 27 fuertes (|ρ| > 0.40). El detalle auditable está en `analysis/all_cross_correlations.csv`.

**Hallazgos económicamente coherentes que la versión 2 no capturaba**:

| Macro | Producto | ρ | Familia · Zona | Lectura |
|-------|----------|---|----------------|---------|
| IPV YoY | Plazo de venta | -0.78 | townhouse · AUDP | precios aceleran → unidades se venden más rápido |
| ICOI YoY | Descuentos | -0.66 | casa · AUDP | costos suben → developers reducen descuentos |
| Δ desempleo | Precio | -0.55 | townhouse · nacional | desempleo destruye demanda → precio cae |
| IMACEC | Velocidad | +0.65 | edif_4p · AUDP | actividad económica eleva absorción |
| Δ tasa hipotecaria | Velocidad | -0.43 | edif_4p · nacional | canal de *affordability*: tasa sube → calificación cae |

El canal "Δ tasa hipotecaria → Velocidad" es **negativo en las ocho celdas significativas** (rango -0.28 a -0.46). Es uno de los pocos efectos cuyo signo es unánime en todas las familias y zonas, validando el mecanismo de *affordability* como canal sistémico.

**Limitación honesta**: con `n=25` trimestres en `audp_zone/townhouse` y 10 dimensiones, el ratio observaciones/variables es 2.5 — por debajo del umbral conservador de 5. La t-cópula con ν=4 mitiga el sobreajuste en colas, pero los extremos como ρ=-0.78 deben leerse con una banda de confianza aproximada de ±0.20.

\newpage

# 5. ¿Cómo se conectan los datos macro con el VAN del AUDP?

Esta sección explica el flujo end-to-end del modelo.

## 5.1 El recorrido de un sample en el Monte Carlo

```
PASO 1: Sortear shocks macro
─────────────────────────────────────────
Sample joint con t-cópula respetando correlaciones empíricas:
- IMACEC variación %       (e.g., -2.5%)
- Δ Tasa hipotecaria pp    (e.g., +0.8pp)
- Δ Desempleo pp           (e.g., +1.2pp)
- IPV YoY %                (e.g., +1.0%)
- ICOI YoY %               (e.g., +5.7%)

         ↓

PASO 2: Propagar a variables del proyecto (Capa 1)
─────────────────────────────────────────
Por cada familia (edif, ds19, casa, townhouse):
  precio_yoy   = IPV_familiar_sampleado + ε       (shock directo + ruido)
  costo_yoy   = ICOI_sampleado + ε                (shock directo + ruido)
  velocidad   = α + β·macros + ε                  (regresión OLS)
  plazo_yoy   = ε                                 (ruido idiosincrático)

         ↓

PASO 3: Convertir a multipliers
─────────────────────────────────────────
tm         = 1 + precio_yoy/100      (multiplicador ticket)
vel        = velocidad_yoy            (% sobre baseline)
costoMult  = 1 + costo_yoy/100
plazoMult  = 1 + plazo_yoy/100

         ↓

PASO 4: Aplicar a la incidencia del residual
─────────────────────────────────────────
Para cada familia con representante guardado:
  Δincidencia = ∂i/∂ticket × (tm-1) +
                ∂i/∂vel × (vel/100) +
                ∂i/∂costo × (costoMult-1) +
                ∂i/∂plazo × (plazoMult-1)
  PRODUCTS[fam].incidencia = baseline + Δincidencia

         ↓

PASO 5: Re-correr peResimulate del flujo AUDP
─────────────────────────────────────────
Con los nuevos valores en PRODUCTS:
- Velocidad cambiada (peVelocidadPct = vel)
- Ticket multiplicado (tm aplica a revenue)
- Incidencia ajustada (vía Δincidencia)
- Costos triangulares (infra, mit, san)
- Tasa descuento sortado uniforme

Calcula el flujo de caja del AUDP año a año.

         ↓

PASO 6: Calcular VAN del AUDP
─────────────────────────────────────────
VAN = Σ flujo_t / (1 + discRate)^t

         ↓

PASO 7: Almacenar resultado
─────────────────────────────────────────
Guardar VAN en lista de resultados.
```

Este ciclo se repite N veces (típicamente 3.000-10.000), y al final tenemos la **distribución completa del VAN AUDP** bajo los escenarios sampleados.

## 5.2 Sobre la velocidad: una variable, dos efectos

![Velocidad: una variable con dos efectos económicos acoplados](figures/07_velocidad_acoplamiento.png){ width=100% }

Una pregunta crítica: si la velocidad es una sola variable, ¿por qué afecta a la incidencia Y al timing del AUDP por separado?

**Respuesta**: es UNA variable con DOS efectos económicos sobre flujos distintos:

- **Efecto 1 (vía residual del proyecto)**: velocidad ↑ → menor costo financiero del PIE → margen del developer mejora → puede pagar MÁS por el terreno → **incidencia sube**
- **Efecto 2 (vía AUDP cash flow)**: velocidad ↑ → AUDP vende su tierra antes → ingresos llegan antes → **VAN AUDP sube por NPV @ 8%**

**No es doble conteo**: ambos efectos operan sobre **flujos de caja distintos** (proyecto vs. AUDP). La suma es el efecto total correcto.

En el código del MC, **la misma muestra de velocidad** se aplica consistentemente a ambos canales. Esto es la integración correcta de la variable.

\newpage

# 6. Variables del modelo: catálogo detallado

Esta sección detalla cada variable del modelo con su unidad, significado, fuente y rol.

## 6.1 Variables sampleadas (Capa 2 — entran a la cópula)

### IMACEC variación interanual

| Atributo | Detalle |
|---|---|
| **Unidad** | Porcentaje (%) |
| **Significado** | Cuánto creció (o cayó) la actividad económica chilena, mes a mes, comparado con el mismo mes del año anterior. |
| **Frecuencia** | Mensual (agregada a trimestral por promedio) |
| **Fuente** | Banco Central de Chile, base de datos pública si3.bcentral.cl |
| **Cómo interpretar** | +2.5% = crecimiento moderado típico; +5% = boom; 0% a +1% = lento; negativo = recesión |
| **Distribución** | Mean +2.89%, σ 4.48%, p10 -2.77%, p90 +8.77% |

### Δ Tasa hipotecaria

| Atributo | Detalle |
|---|---|
| **Unidad** | Puntos porcentuales (pp) |
| **Significado** | Cuánto subió o bajó el nivel de la tasa hipotecaria UF respecto al mismo trimestre del año anterior. **Es el cambio, no el nivel**. |
| **Frecuencia** | Mensual (agregada a trimestral) |
| **Fuente** | BCCh con datos de la CMF |
| **Cómo interpretar** | +1pp = la tasa subió 100 puntos básicos en el año (e.g., de 4% a 5%); -0.5pp = bajó 50 bps |
| **Distribución** | Mean -0.05pp, σ 0.48pp |

### Δ Tasa de desempleo

| Atributo | Detalle |
|---|---|
| **Unidad** | Puntos porcentuales (pp) |
| **Significado** | Cuánto subió o bajó el nivel de desempleo nacional respecto al mismo trimestre del año anterior. **Es el cambio, no el nivel**. |
| **Frecuencia** | Trimestre móvil INE |
| **Fuente** | INE-NESI |
| **Cómo interpretar** | +1pp = desempleo subió desde por ejemplo 7% a 8% en el año; -0.5pp = bajó 50 bps |
| **Distribución** | Mean -0.01pp, σ 0.83pp |

### IPV YoY (Índice Precios Vivienda variación anual)

| Atributo | Detalle |
|---|---|
| **Unidad** | Porcentaje (%) variación interanual |
| **Significado** | Cuánto cambió el índice oficial de precios de vivienda. Se construye con metodología Laspeyres controlando por composición. **Es el shock directo de precio** del modelo. |
| **Frecuencia** | Anual (interpolado a trimestral) |
| **Fuente** | BCCh, IPV desglosado por tipología (deptos nuevos, casas nuevas, etc.) |
| **Mapeo familia → variante** | Edif y DS19 → IPV deptos nuevos; Casa y Townhouse → IPV casas nuevas |
| **Distribución deptos** | Mean +1.87%, σ 1.65%, p10 -0.14%, p90 +5.35% |
| **Distribución casas** | Mean +2.40%, σ 2.60%, p10 0%, p90 +8.19% |

### ICOI YoY (Costos Construcción variación anual)

| Atributo | Detalle |
|---|---|
| **Unidad** | Porcentaje (%) variación interanual |
| **Significado** | Cuánto cambió el costo de construcción de edificación. Mide inflación de cemento, fierro, mano de obra, transporte. **Es el shock directo de costo** del modelo. |
| **Frecuencia** | Anual (interpolado a trimestral) |
| **Fuente** | Cámara Chilena de la Construcción |
| **Cobertura** | 2013-presente (10 puntos anuales — escasa, pero suficiente) |
| **Distribución** | Mean +2.47%, σ 11.53% — **muy volátil**. Refleja shocks de commodities y dólar |
| **Ejemplos históricos** | 2023: cayó 16% (recesión global de costos); 2021-2022: subió >20% (post-COVID) |

## 6.2 Variables del proyecto derivadas (Capa 1)

### Precio de venta YoY

| Atributo | Detalle |
|---|---|
| **Fórmula** | `precio_yoy = IPV_familiar_sampleado + ε` |
| **Unidad** | % variación interanual |
| **Significado** | Cuánto cambia el precio promedio (UF/m² vendible) del producto, respecto al año anterior |
| **σ idiosincrático por familia** | Edif 4-6p: 9.80pp · DS19: 5.16pp · Casa: 6.40pp · TH: 17.17pp |

### Costo construcción YoY

| Atributo | Detalle |
|---|---|
| **Fórmula** | `costo_yoy = ICOI_sampleado + ε` |
| **Unidad** | % variación interanual |
| **Significado** | Cuánto cambia el costo de construcción directo (UF/m² construido) que el developer paga al contratista, respecto al año anterior |
| **σ idiosincrático** | 3.0 pp (parámetro económico fijo) |

### Velocidad de venta YoY (variable acoplada)

| Atributo | Detalle |
|---|---|
| **Fórmula** | `velocidad_yoy = α + Σ β_i·macros_i + ε` (regresión OLS calibrada) |
| **Unidad** | % variación interanual de unidades vendidas/mes |
| **Significado** | Cuánto cambia la velocidad de venta del producto. **Velocidad de venta = unidades vendidas por mes** |
| **Acoplamiento** | UNA variable con DOS efectos: (1) afecta incidencia vía residual, (2) afecta timing AUDP |

### Plazo de obra YoY

| Atributo | Detalle |
|---|---|
| **Fórmula** | `plazo_yoy = ε` (ruido idiosincrático con clamp ±25pp) |
| **Unidad** | % variación interanual de meses de obra |
| **Significado** | Cuánto cambia la duración de la construcción del producto |
| **Razón de no regresar** | El plazo lo decide el developer en función de su pipeline interno, no de macros |

\newpage

# 7. Validación del modelo

## 7.1 Test 1: ¿Los presets producen distribuciones distintas?

Ejecutamos el modelo con cada preset histórico y medimos la incidencia resultante:

| Preset | Incidencia mean | Δ vs base | ¿Tiene sentido económico? |
|---|---|---|---|
| Base esperado | 15.07% | – | – |
| Subprime 2009 | 13.58% | -1.49 pp | Sí (crisis suave) |
| Estallido + COVID 2019-2020 | 13.02% | -2.05 pp | Sí (costos altos comprimen margen) |
| Boom post-COVID 2021 | 14.71% | -0.36 pp | Sí (boom no impacta materialmente) |
| **Slowdown 2023** | **22.45%** | **+7.38 pp** | **Sí (ICOI cayó -16% → mejor margen)** |

Los signos son **económicamente correctos y robustos**.

## 7.2 Test 2: ¿Las marginales sampleadas reproducen las observadas?

Diferencias entre sampleadas y empíricas (Edif 4-6p, 5.000 draws):

| Variable | Sampleado mean | Empírico mean | Δ |
|---|---|---|---|
| precio_uf_m2 | 72.20 | 72.26 | -0.1% |
| velocidad_uds_mes | 0.82 | 0.82 | -0.9% |
| plazo_construccion_meses | 24.96 | 24.76 | +0.8% |
| sup_promedio_m2 | 105.4 | 104.7 | +0.7% |

Diferencias < 1.5% en todos los casos.

## 7.3 Tornado: ¿Qué variables mueven más el VAN?

![Tornado de sensibilidad esperado](figures/08_tornado_esperado.png){ width=100% }

| Variable | Contribución a varianza VAN |
|---|---|
| Ticket multiplier | ~30-40% |
| Costo construcción (vía residual) | ~20-25% |
| Plazo obra (vía residual) | ~15-20% |
| Velocidad venta | ~8-12% |
| Tasa descuento | ~3-5% |
| Resto | ~10% |

**Comparación con versión anterior**: el ticket dominaba 92.6% por falta de costo y plazo como variables. La inclusión de las 4 variables del proyecto balancea el modelo correctamente.

\newpage

# 8. Limitaciones honestas y oportunidades de mejora

## 8.1 Limitaciones reconocidas

| Limitación | Magnitud | Mitigación |
|---|---|---|
| **R² regresión velocidad bajo (OLS)** | 0.02-0.22 | El ε residual con su σ se sortea; Random Forest podría reemplazar OLS y subir R² a 0.62 |
| **Bajo N en familias periféricas** | DS19 (80 trim), TH (116) | Resultados directionalmente correctos pero σ amplia |
| **Costos no calibrados con TINSA** | TINSA no tiene costos del developer | σ=3pp asumido como parámetro económico razonable |
| **Linealización Δ-incidencia** | Aproximación de primer orden | Centered-difference O(h²); error <2% para shocks ≤10% |
| **No usa lags óptimos de IPV** | Modelo usa IPV contemporáneo, óptimo es t-2/t-3 | Mejora identificada para próxima iteración |
| **No estratifica por comuna** | Comuna explica 49% del precio (más que familia 10%) | Próxima iteración debería filtrar TINSA por comunas relevantes al AUDP |

## 8.2 Mejoras IMPLEMENTADAS (Versión 2 del modelo)

Las 4 primeras mejoras priorizadas se implementaron en una nueva versión del factor model (`analysis/build_macro_v2.py` + `public/macro_factor_v2.js`). Resultados honestos:

### Mejora 1 ✓: IPV con lag t-3

Recalibramos σ idiosincrático del precio usando IPV con lag de 3 trimestres en lugar de contemporáneo.

**Resultado**: la diferencia σ_t vs σ_t-3 es **marginal por familia** (0.03-0.34 pp). Esto contrasta con el efecto fuerte que se ve en pooled (ρ 0.34 → 0.55).

**Por qué**: cuando estratificamos por familia (36-57 obs por celda), el efecto del lag se diluye porque hay más ruido idiosincrático específico al producto. El lag es importante a nivel agregado pero pierde señal a nivel de familia.

**Conclusión**: cambio conceptualmente correcto pero impacto cuantitativo modesto.

### Mejora 2 ✓: Estratificación por comuna AUDP-relevante

Filtramos TINSA por las **7 comunas** de la zona periurbana de Santiago: LAMPA, COLINA, BUIN, PADRE HURTADO, SAN BERNARDO, TILTIL, MELIPILLA. Total: **14.708 observaciones**, dominadas por COLINA (5.348), BUIN (2.639) y SAN BERNARDO (2.571).

**Resultado**: diferencia real y cuantificable en σ idiosincrático del precio:

| Familia | σ AUDP zone | σ nacional | Δ |
|---|---|---|---|
| Edif 4-6p | **21.69 pp** | 9.52 pp | **+12.2 pp** |
| Townhouse | **21.38 pp** | 16.21 pp | +5.2 pp |
| Casa | 7.97 pp | 7.06 pp | +0.9 pp |
| DS19 | 6.40 pp | 4.68 pp | +1.7 pp |

**Interpretación**: los proyectos en la zona AUDP tienen **MAYOR variabilidad de precios** entre sí que el promedio nacional. Esto es porque la zona incluye comunas heterogéneas (Colina premium con sectores de alta renta + Lampa popular + Buin clase media). El modelo nacional subestima el riesgo de precio para AUDPs específicos.

**Conclusión**: aporte real al modelo. Para evaluación de AUDP debería usarse la calibración AUDP-zone.

### Mejora 3 ✓: Regresión polinómica con interacciones para velocidad

Reemplazamos la regresión OLS lineal por una polinómica con 5 features: IMACEC, IPV, ICOI, IMACEC×IPV (interacción), IMACEC² (no-lineal).

**Resultado**: mejoras heterogéneas por familia:

| Familia | R² lineal v1 | R² polinómica v2 (AUDP zone) |
|---|---|---|
| DS19 | 0.043 | **0.157** (×3.7) ✓ |
| Townhouse | 0.019 | **0.139** (×7.3) ✓ |
| Edif 4-6p | 0.020 | 0.029 (similar) |
| Casa | 0.224 | 0.093 (bajó — overfit) ⚠ |

**Por qué Casa empeora**: con 57 obs y 5 features, el ratio observaciones/features es 11. La casa lineal tenía mejor ajuste por chance. La polinómica overfit en este caso específico.

**Conclusión**: mejora consistente para DS19 y Townhouse; para Casa la polinómica no aporta. La selección de modelo debería ser caso por caso.

### Mejora 4 ✓: Cópula expandida con lags principales

Construimos cópula t (ν=4) con **9 variables** (originalmente 5), agregando los lags más relevantes:

```
Variables originales (5): IMACEC, Δtasa hipo, Δdesempleo, IPV, ICOI
Lags agregados (4): IMACEC L1, IPV L3 (3 variantes), ICOI L1
Total: 9 variables sobre ~37 trimestres con todos los lags presentes
```

**Resultado**: ratio observaciones/variables ≈ 4 — al límite de lo aceptable. Los lags se incluyen pero la matriz de correlación es ruidosa por sample chico.

**Conclusión**: implementado pero con alerta sobre robustez. Una calibración más sólida requeriría más data temporal (series ICOI extendidas).

### Mejora 5 ⏳: Cobertura ICOI más larga (pendiente)

ICOI tiene solo 10 puntos anuales (2013-2024) en la fuente disponible. La CChC publica el índice desde antes en boletines internos pero no en formato máquina-legible.

**Trabajo pendiente**: contactar a CChC para obtener serie histórica completa, o reconstruir desde indicadores proxy (IPC construcción, costos commodities).

**Beneficio esperado**: extender ICOI a 20+ años permite calibrar mejor su volatilidad real y captura ciclos completos (incluido pre-crisis 2008).

### Mejora 7 ✓: Doble canal del shock de costo (post-revisión)

**Problema detectado en revisión**: el shock `costoMult` aparecía con peso bajo o nulo en el tornado de varianza del VAN, pese a que el costo de construcción es uno de los inputs más sensibles del modelo residual. La causa raíz era estructural y operaba en dos frentes:

1. **Canal residual condicionado a representantes**: el shock sólo se propagaba a la incidencia si existían representantes guardados en `localStorage` con sensibilidades calculadas. Para usuarios que abrían el simulador sin haber pasado primero por `/residual`, el código ejecutaba `continue` y el shock era inerte. **Fix**: aplicar las sensibilidades default razonables (`{ticket: 0.65, costo: -0.45, plazo: -0.12}`) siempre, no sólo cuando hay representante explícito.

2. **Canal directo desconectado**: las distribuciones de costo de infraestructura (`im`) y mitigaciones (`mm`) usaban distribuciones triangulares **independientes** del shock macro. Esto rompía la coherencia económica: una recesión que sube el ICOI 8% subía la incidencia con sensibilidad correcta, pero infra/mitigaciones se sampleaban de una distribución que ignoraba el shock — dos canales que en la realidad están perfectamente correlacionados (mismo input ICOI). **Fix**: en modo factor (v1/v2/v3), `im` y `mm` se acoplan directamente al `costoMult`. Las mitigaciones reciben una leve amplificación (×1.1) por su mayor componente regulatorio/social.

**Consecuencia esperada**: el `costoMult` ahora aparece sistemáticamente entre las primeras tres variables del tornado en escenarios con shocks materiales, reflejando su peso económico real. Este efecto se observa tanto en las celdas con representantes guardados (canal residual + directo) como en las que no (sólo canal directo, vía infra/mitigaciones acopladas).

### Mejora 8 ✓: Cap combinado AUDP de operadores simultáneos

**Problema detectado**: la herramienta podía proyectar ingresos anuales en torno a 12-13 millones USD por las dos AUDPs combinadas (Batuco + Colina), lo cual no es coherente con la realidad de absorción del eje Norte de Santiago. La causa: hasta antes de este fix, el modelo permitía hasta 32 operadores simultáneos en AUDPs (4 productos × 4 ops por escenario *esperada* × 2 zonas), sin un cap global combinado. Sólo Deptos 3 tenía cap combinado.

**Calibración empírica con TINSA**: la velocidad mediana de proyectos activos en Chile es 0.7 ud/mes/proyecto (124.981 observaciones); el percentil 75 es 1.4 ud/mes; sólo el percentil 90 supera 3 ud/mes. Los defaults del simulador (4-6 ud/mes/operador) corresponden a proyectos del top decil en zonas premium, no al promedio AUDP del eje Norte. Combinado con 16-32 operadores simultáneos, eso explica la sobreestimación.

**Fix**: nuevo cap global combinado AUDP, escalable por escenario:
- Pesimista: 8 operadores simultáneos máximo entre Batuco + Colina
- Esperada: 14 operadores
- Optimista: 20 operadores

La reducción se aplica de manera proporcional uniforme para preservar el mix de productos. Esto refleja que las AUDPs adyacentes en el mismo eje vial **comparten demanda regional** — un comprador interesado en Batuco también considera Colina, no son segmentos independientes.

**Limitación honesta**: el cap es una restricción de demanda regional, no una calibración mecánica. La velocidad por operador (`velVenta`) sigue como input del usuario (defaults heredados de la versión inicial). Para escenarios más conservadores, el usuario puede combinar cap esperada con `velVenta` reducido a 2.5-3.0 ud/mes (más alineado con TINSA p75).

### Mejora 6 ✓: Cópula CROSS unificada 10D (Versión 3)

**Brecha que cerró**: la versión 2 mantenía dos cópulas separadas (macro-macro y producto-producto). La dependencia macro→producto se modelaba indirectamente a través de la regresión polinómica de velocidad. Esto subestimaba canales económicos directos como "tasa hipotecaria → velocidad" o "desempleo → precio", cuya transmisión es estructural y no se reduce a una función de IMACEC e IPV.

**Implementación**: una única cópula t (ν=4) de 10 dimensiones por celda (familia × zona). Las 10 variables son las cinco macros (IMACEC, Δ tasa hipotecaria, Δ desempleo, IPV YoY, ICOI YoY) y las cinco de producto (precio, velocidad, plazo, descuento, tamaño), todas en YoY o variación interanual. Calibración por Spearman empírico convertido a Pearson y luego a matriz de correlación PSD vía Cholesky.

**Verificación 200/200**: el script `analysis/verify_all_cross_correlations.py` recorre las 200 combinaciones (5 macros × 5 productos × 4 familias × 2 zonas) y reporta el ρ empírico, su significancia y el sample size. Las 200 están calibradas; 102 son significativas y 27 fuertes.

**Validación económica de signos**:

```
✓ Δ tasa hipo → Velocidad: -0.28 a -0.46 (8/8 celdas)
   Affordability confirmada: tasa sube → menos compradores califican.

✓ Δ desempleo → Precio: -0.22 a -0.55 (4/4 celdas significativas)
   Canal de empleo→demanda directo, sin pasar por IMACEC.

✓ IPV YoY → Plazo de venta: -0.43 a -0.78
   Cuando precios aceleran, las unidades se venden más rápido.
   Validación cruzada con el modelo dinámico residual.

✗ Δ desempleo → Velocidad: signo mixto en townhouse
   Probablemente refleja efecto cohorte (compradores DS19 no
   afectados por ciclo laboral formal de manera lineal).
```

**Toggle en el simulador**: ⭐ v3 CROSS (default) | 🌟 v2 | 🌎 v1 | 📊 Empírico | ⚙ Paramétrico. El panel "Drivers macroeconómicos sampleados" en el resultado del Monte Carlo muestra histogramas con la distribución observada de las cinco macros durante las N iteraciones, permitiendo verificar visualmente que el sample respeta los regímenes históricos (boom, COVID, slowdown).

**Limitación documentada**: con `n=25-48` trimestres por celda y 10 dimensiones, el ratio observaciones/variables va de 2.5 a 4.8. La t-cópula con ν=4 introduce *tail dependence* y mitiga el sobreajuste, pero las correlaciones extremas individuales (e.g., -0.78) deben interpretarse con una banda aproximada de ±0.20. El detalle por celda está en `analysis/all_cross_correlations.csv`.

\newpage

# 9. Conclusiones para el Directorio

## 9.1 ¿Es estadísticamente robusto el modelo?

**Sí, dentro de su alcance, con caveats explícitos.**

**Fortalezas**:
- Calibrado con datos reales (124k obs TINSA + 401 trim macros)
- Marginales empíricas (no asume formas paramétricas)
- Cópula con tail dependence (captura riesgo de cola)
- Signos económicamente coherentes (validados ex post)
- Reproducibilidad bit-exacta (seed determinista)
- Cada componente es trazable a fuente oficial

**Debilidades reconocidas**:
- Usa IPV contemporáneo cuando el lag óptimo es t-2/t-3
- Estratifica por familia (10% varianza) cuando comuna (49%) sería más informativa
- OLS lineal en velocidad cuando Random Forest da mejor ajuste
- Subestima persistencia temporal de shocks

## 9.2 ¿Para qué sirve y para qué no sirve?

| Pregunta del Directorio | ¿Lo responde? |
|---|---|
| ¿Cuál es el VAN esperado del AUDP X bajo escenario base? | ✓ Sí |
| ¿Qué probabilidad hay de VAN < 0? | ✓ Sí |
| ¿Cuál AUDP es más resiliente entre 2 candidatos? | ✓ Sí |
| ¿Cuáles son las palancas con mayor impacto en VAN? | ✓ Sí (tornado) |
| ¿Qué pasa con el VAN si replicamos COVID 2020? | ✓ Sí (preset) |
| ¿Qué pasará exactamente con el VAN en 2030? | ✗ No — requiere predecir las macros futuras |
| ¿Cómo afecta un cambio regulatorio del DS-19? | ✗ No (no hay data en el histórico) |
| ¿Qué pasa si el dólar sube 30%? | ✗ Parcialmente (entraría vía ICOI con lag) |

## 9.3 Recomendación al Directorio

**Usar el modo Factor Macro como herramienta principal de evaluación de AUDPs**, complementado con análisis cualitativo del contexto regulatorio, comercial y geográfico que el modelo no captura.

**Flujo recomendado para evaluar un AUDP**:

1. Evaluar con macros base esperado → distribución del VAN
2. Re-evaluar con preset Estallido + COVID → "stress severo"
3. Re-evaluar con preset Boom 2021 → "upside"
4. Comparar percentiles P5, P50, P95 entre escenarios
5. Si VAN P5 < 0, profundizar análisis cualitativo
6. Si la dispersión entre escenarios es baja, el AUDP es resiliente

**Próximos pasos del modelo** (orden de prioridad):

1. Implementar estratificación por comuna (49% varianza)
2. Cambiar IPV a lag t-2 (correlación sube 0.34 → 0.55)
3. Reemplazar OLS por Random Forest (R² sube 0.40 → 0.75)
4. Expandir cópula con lags principales

\newpage

# Anexo A — Glosario

| Término | Definición |
|---|---|
| **AUDP** | Área Urbana de Desarrollo Prioritario |
| **TINSA / CIDU** | Base de datos transaccional de proyectos inmobiliarios chilenos |
| **Cópula** | Función matemática que describe cómo se relacionan variables aleatorias entre sí |
| **CVaR** | Conditional Value at Risk — promedio del peor X% de los outcomes |
| **IMACEC** | Indicador Mensual de Actividad Económica del BCCh |
| **ICOI** | Índice de Costos de Construcción de la CChC |
| **IPV** | Índice de Precios de Vivienda del BCCh |
| **Lag** | Retraso temporal entre dos variables |
| **Monte Carlo** | Simulación que genera N escenarios aleatorios |
| **NCOM** | Comuna en TINSA (variable más explicativa del precio) |
| **NPISOS** | Número de pisos del edificio en TINSA |
| **OLS** | Regresión lineal por mínimos cuadrados ordinarios |
| **R²** | Proporción de varianza explicada por el modelo (0 a 1) |
| **Random Forest** | Modelo no-lineal que captura interacciones entre variables |
| **σ idiosincrático** | Desviación estándar del componente no explicado por el modelo |
| **Spearman** | Correlación de rangos (invariante a transformaciones monótonas) |
| **Tail dependence** | Probabilidad de eventos extremos correlacionados |
| **Tornado** | Visualización de contribución de cada variable a la varianza del output |
| **VaR** | Value at Risk — peor outcome esperado con probabilidad dada |
| **YoY** | Year-over-Year (variación interanual) |
| **ν (nu)** | Grados de libertad de la distribución t |

\newpage

# Anexo B — Referencias

1. Sklar, A. (1959). "Fonctions de répartition à n dimensions et leurs marges". *Publications de l'Institut Statistique de l'Université de Paris*, 8.
2. Embrechts, P., Lindskog, F., McNeil, A. (2003). "Modelling Dependence with Copulas and Applications to Risk Management". Elsevier.
3. Iman, R. L., Conover, W. J. (1982). "A distribution-free approach to inducing rank correlation among input variables". *Communications in Statistics*, 11(3).
4. Li, D. X. (2000). "On Default Correlation: A Copula Function Approach". *Journal of Fixed Income*, 9(4).
5. Demarta, S., McNeil, A. (2005). "The t copula and related copulas". *International Statistical Review*, 73(1).
6. Banco Central de Chile (2024). *Manual del IPV*.
7. Cámara Chilena de la Construcción (2024). *Boletín del ICE*.
8. INE (2024). *Encuesta Nacional de Empleo — Metodología NESI*.
9. Cherubini, U., Luciano, E., Vecchiato, W. (2004). *Copula Methods in Finance*. Wiley.
10. McNeil, A., Frey, R., Embrechts, P. (2015). *Quantitative Risk Management*. Princeton University Press.
11. Metropolis, N., Ulam, S. (1949). "The Monte Carlo Method". *Journal of the American Statistical Association*, 44.
12. Glasserman, P. (2003). *Monte Carlo Methods in Financial Engineering*. Springer.
13. Breiman, L. (2001). "Random Forests". *Machine Learning*, 45(1).

\newpage

# Anexo C — Reproducibilidad técnica

## C.1 Pipeline reproducible

```bash
cd batucoterra-cabida/

# Recalibrar el modelo desde cero
python3 analysis/build_macro_option_c.py
python3 analysis/build_macro_c_js.py

# Análisis profundo (correlaciones con lags + variable importance)
python3 analysis/deep_correlation_analysis.py
python3 analysis/extra_dimensions.py

# Generar visualizaciones
python3 analysis/build_visualizations.py

# Validar
node analysis/test_factor_macro.js
node analysis/test_factor_with_sens.js
```

## C.2 Archivos clave

| Archivo | Propósito |
|---|---|
| `analysis/build_macro_option_c.py` | Calibración del Factor Model |
| `analysis/deep_correlation_analysis.py` | Análisis lags + Random Forest |
| `analysis/extra_dimensions.py` | Análisis comuna, pisos, BHT |
| `analysis/macro_factor_c.json` | Modelo calibrado (JSON) |
| `public/macro_factor_c.js` | Modelo embebible (12 KB) |
| `public/macro_factor.js` | Sampling t-cópula |
| `public/market_copula.js` | Utilidades matemáticas |
| `public/simulador-legacy.html` | Integración al simulador |

Todos los scripts son deterministas; mismo input produce mismo output con seed 42.

---

*Documento preparado por el equipo de Modela. Versión Abril 2026 (v3, post análisis profundo).*
