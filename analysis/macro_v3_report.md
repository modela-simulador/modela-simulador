# Factor Model v3 — Cópula CROSS Unificada

## Concepto

Cópula t (ν=4) **única** sobre 10 variables: 5 macros + 5 producto.
Captura correlaciones directas que v1/v2 perdían (mediadas por regresión OLS).

## Top correlaciones cross (macro × producto) por zona/familia


### audp_zone/edif_4p (n=47 trim)

| Macro | Producto | ρ Spearman |
|---|---|---|
| imacec_var | velocidad_yoy | +0.420 |
| d_tasa_hipo | velocidad_yoy | -0.241 |
| d_tasa_hipo | plazo_yoy | +0.422 |
| d_desempleo | velocidad_yoy | -0.265 |
| d_desempleo | plazo_yoy | +0.240 |
| ipv_general_yoy | plazo_yoy | -0.373 |
| icoi_yoy | precio_yoy | +0.408 |
| icoi_yoy | velocidad_yoy | -0.207 |

### audp_zone/ds19 (n=27 trim)

| Macro | Producto | ρ Spearman |
|---|---|---|
| imacec_var | precio_yoy | -0.343 |
| imacec_var | plazo_yoy | -0.223 |
| imacec_var | descuento_yoy | -0.248 |
| d_tasa_hipo | descuento_yoy | +0.277 |
| d_desempleo | velocidad_yoy | -0.299 |
| d_desempleo | plazo_yoy | +0.365 |
| d_desempleo | descuento_yoy | +0.421 |
| ipv_general_yoy | precio_yoy | -0.538 |
| ipv_general_yoy | velocidad_yoy | -0.466 |
| ipv_general_yoy | sup_yoy | +0.356 |
| icoi_yoy | precio_yoy | -0.250 |
| icoi_yoy | sup_yoy | +0.541 |

### audp_zone/casa (n=47 trim)

| Macro | Producto | ρ Spearman |
|---|---|---|
| imacec_var | plazo_yoy | -0.420 |
| d_tasa_hipo | velocidad_yoy | -0.383 |
| d_tasa_hipo | plazo_yoy | +0.289 |
| ipv_general_yoy | velocidad_yoy | +0.440 |
| ipv_general_yoy | plazo_yoy | -0.497 |
| icoi_yoy | precio_yoy | +0.491 |
| icoi_yoy | velocidad_yoy | +0.234 |
| icoi_yoy | descuento_yoy | -0.569 |
| icoi_yoy | sup_yoy | -0.379 |

### audp_zone/townhouse (n=37 trim)

| Macro | Producto | ρ Spearman |
|---|---|---|
| imacec_var | velocidad_yoy | -0.356 |
| imacec_var | sup_yoy | +0.294 |
| d_tasa_hipo | velocidad_yoy | -0.277 |
| d_tasa_hipo | plazo_yoy | +0.280 |
| d_tasa_hipo | sup_yoy | -0.298 |
| ipv_general_yoy | plazo_yoy | -0.303 |
| ipv_general_yoy | sup_yoy | +0.415 |

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
