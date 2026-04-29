# Factor Model v3 — Cópula CROSS Unificada

## Concepto

Cópula t (ν=4) **única** sobre 10 variables: 5 macros + 5 producto.
Captura correlaciones directas que v1/v2 perdían (mediadas por regresión OLS).

## Top correlaciones cross (macro × producto) por zona/familia


### audp_zone/edif_4p (n=47 trim)

| Macro | Producto | ρ Spearman |
|---|---|---|
| imacec_var | velocidad_yoy | +0.401 |
| d_tasa_hipo | velocidad_yoy | -0.252 |
| d_tasa_hipo | plazo_yoy | +0.417 |
| d_desempleo | velocidad_yoy | -0.250 |
| d_desempleo | plazo_yoy | +0.233 |
| ipv_general_yoy | plazo_yoy | -0.363 |
| icoi_yoy | precio_yoy | +0.411 |

### audp_zone/ds19 (n=27 trim)

| Macro | Producto | ρ Spearman |
|---|---|---|
| imacec_var | precio_yoy | -0.276 |
| d_tasa_hipo | descuento_yoy | +0.245 |
| d_desempleo | velocidad_yoy | -0.228 |
| d_desempleo | plazo_yoy | +0.215 |
| d_desempleo | descuento_yoy | +0.304 |
| ipv_general_yoy | precio_yoy | -0.558 |
| ipv_general_yoy | velocidad_yoy | -0.423 |
| ipv_general_yoy | plazo_yoy | -0.258 |
| ipv_general_yoy | sup_yoy | +0.399 |
| icoi_yoy | sup_yoy | +0.416 |

### audp_zone/casa (n=47 trim)

| Macro | Producto | ρ Spearman |
|---|---|---|
| imacec_var | plazo_yoy | -0.419 |
| d_tasa_hipo | velocidad_yoy | -0.385 |
| d_tasa_hipo | plazo_yoy | +0.295 |
| ipv_general_yoy | velocidad_yoy | +0.432 |
| ipv_general_yoy | plazo_yoy | -0.490 |
| icoi_yoy | precio_yoy | +0.498 |
| icoi_yoy | velocidad_yoy | +0.226 |
| icoi_yoy | descuento_yoy | -0.563 |
| icoi_yoy | sup_yoy | -0.377 |

### audp_zone/townhouse (n=37 trim)

| Macro | Producto | ρ Spearman |
|---|---|---|
| imacec_var | velocidad_yoy | -0.356 |
| imacec_var | sup_yoy | +0.316 |
| d_tasa_hipo | velocidad_yoy | -0.293 |
| d_tasa_hipo | plazo_yoy | +0.264 |
| d_tasa_hipo | sup_yoy | -0.260 |
| ipv_general_yoy | plazo_yoy | -0.332 |
| ipv_general_yoy | sup_yoy | +0.375 |

### nacional/edif_4p (n=48 trim)

| Macro | Producto | ρ Spearman |
|---|---|---|
| imacec_var | precio_yoy | +0.327 |
| imacec_var | plazo_yoy | -0.256 |
| imacec_var | sup_yoy | -0.438 |
| d_tasa_hipo | velocidad_yoy | -0.458 |
| d_tasa_hipo | plazo_yoy | +0.334 |
| d_tasa_hipo | sup_yoy | -0.324 |
| d_desempleo | precio_yoy | -0.249 |
| d_desempleo | sup_yoy | +0.408 |
| ipv_general_yoy | precio_yoy | +0.331 |
| icoi_yoy | precio_yoy | +0.461 |
| icoi_yoy | descuento_yoy | -0.217 |
| icoi_yoy | sup_yoy | -0.302 |

### nacional/ds19 (n=32 trim)

| Macro | Producto | ρ Spearman |
|---|---|---|
| imacec_var | velocidad_yoy | -0.219 |
| imacec_var | descuento_yoy | +0.339 |
| d_tasa_hipo | precio_yoy | +0.209 |
| d_desempleo | precio_yoy | -0.314 |
| d_desempleo | plazo_yoy | -0.201 |
| d_desempleo | sup_yoy | +0.254 |
| ipv_general_yoy | precio_yoy | -0.614 |
| ipv_general_yoy | velocidad_yoy | -0.304 |
| ipv_general_yoy | plazo_yoy | -0.430 |
| ipv_general_yoy | sup_yoy | +0.516 |
| icoi_yoy | descuento_yoy | -0.411 |

### nacional/casa (n=48 trim)

| Macro | Producto | ρ Spearman |
|---|---|---|
| imacec_var | plazo_yoy | -0.394 |
| d_tasa_hipo | precio_yoy | +0.215 |
| d_tasa_hipo | velocidad_yoy | -0.422 |
| d_tasa_hipo | plazo_yoy | +0.414 |
| ipv_general_yoy | velocidad_yoy | +0.288 |
| ipv_general_yoy | plazo_yoy | -0.362 |
| icoi_yoy | precio_yoy | +0.627 |
| icoi_yoy | descuento_yoy | -0.445 |
| icoi_yoy | sup_yoy | -0.339 |

### nacional/townhouse (n=33 trim)

| Macro | Producto | ρ Spearman |
|---|---|---|
| imacec_var | precio_yoy | +0.315 |
| imacec_var | velocidad_yoy | -0.355 |
| imacec_var | plazo_yoy | -0.360 |
| imacec_var | descuento_yoy | +0.318 |
| imacec_var | sup_yoy | +0.451 |
| d_tasa_hipo | velocidad_yoy | -0.395 |
| d_desempleo | precio_yoy | -0.419 |
| d_desempleo | velocidad_yoy | +0.309 |
| d_desempleo | sup_yoy | -0.259 |
| ipv_general_yoy | velocidad_yoy | +0.213 |
| ipv_general_yoy | plazo_yoy | -0.507 |
| ipv_general_yoy | descuento_yoy | +0.213 |
| icoi_yoy | precio_yoy | +0.205 |
