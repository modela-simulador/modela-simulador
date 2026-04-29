# Factor Model v3 — Cópula CROSS Unificada

## Concepto

Cópula t (ν=4) **única** sobre 10 variables: 5 macros + 5 producto.
Captura correlaciones directas que v1/v2 perdían (mediadas por regresión OLS).

## Top correlaciones cross (macro × producto) por zona/familia


### audp_zone/edif_4p (n=27 trim)

| Macro | Producto | ρ Spearman |
|---|---|---|
| imacec_var | precio_yoy | +0.221 |
| imacec_var | velocidad_yoy | +0.654 |
| imacec_var | plazo_yoy | -0.374 |
| imacec_var | descuento_yoy | -0.448 |
| d_tasa_hipo | precio_yoy | -0.233 |
| d_tasa_hipo | descuento_yoy | -0.279 |
| d_tasa_hipo | sup_yoy | -0.258 |
| d_desempleo | precio_yoy | -0.221 |
| d_desempleo | velocidad_yoy | -0.408 |
| d_desempleo | plazo_yoy | +0.308 |
| d_desempleo | descuento_yoy | +0.639 |
| ipv_general_yoy | precio_yoy | +0.254 |
| ipv_general_yoy | velocidad_yoy | -0.373 |
| ipv_general_yoy | plazo_yoy | -0.229 |
| ipv_general_yoy | descuento_yoy | +0.548 |
| ipv_general_yoy | sup_yoy | +0.478 |
| icoi_yoy | precio_yoy | +0.416 |
| icoi_yoy | velocidad_yoy | -0.386 |

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
| imacec_var | plazo_yoy | -0.383 |
| imacec_var | sup_yoy | -0.302 |
| d_tasa_hipo | velocidad_yoy | -0.402 |
| d_tasa_hipo | plazo_yoy | +0.376 |
| ipv_general_yoy | velocidad_yoy | +0.396 |
| ipv_general_yoy | plazo_yoy | -0.499 |
| icoi_yoy | precio_yoy | +0.344 |
| icoi_yoy | descuento_yoy | -0.659 |
| icoi_yoy | sup_yoy | -0.269 |

### audp_zone/townhouse (n=25 trim)

| Macro | Producto | ρ Spearman |
|---|---|---|
| imacec_var | precio_yoy | -0.334 |
| imacec_var | sup_yoy | +0.215 |
| d_tasa_hipo | precio_yoy | +0.399 |
| d_tasa_hipo | velocidad_yoy | -0.285 |
| d_tasa_hipo | plazo_yoy | +0.578 |
| d_tasa_hipo | descuento_yoy | -0.495 |
| d_tasa_hipo | sup_yoy | +0.352 |
| d_desempleo | velocidad_yoy | +0.262 |
| d_desempleo | plazo_yoy | -0.302 |
| d_desempleo | descuento_yoy | +0.236 |
| ipv_general_yoy | precio_yoy | -0.551 |
| ipv_general_yoy | velocidad_yoy | +0.417 |
| ipv_general_yoy | plazo_yoy | -0.779 |
| ipv_general_yoy | descuento_yoy | +0.372 |
| icoi_yoy | velocidad_yoy | +0.238 |
| icoi_yoy | descuento_yoy | +0.255 |
| icoi_yoy | sup_yoy | +0.470 |

### nacional/edif_4p (n=48 trim)

| Macro | Producto | ρ Spearman |
|---|---|---|
| imacec_var | precio_yoy | +0.229 |
| imacec_var | plazo_yoy | -0.283 |
| d_tasa_hipo | velocidad_yoy | -0.423 |
| d_tasa_hipo | plazo_yoy | +0.381 |
| d_desempleo | precio_yoy | -0.293 |
| ipv_general_yoy | precio_yoy | +0.212 |
| ipv_general_yoy | plazo_yoy | -0.295 |
| icoi_yoy | descuento_yoy | -0.288 |
| icoi_yoy | sup_yoy | -0.205 |

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
| imacec_var | plazo_yoy | -0.330 |
| d_tasa_hipo | precio_yoy | +0.244 |
| d_tasa_hipo | velocidad_yoy | -0.428 |
| d_tasa_hipo | plazo_yoy | +0.463 |
| d_tasa_hipo | sup_yoy | +0.226 |
| ipv_general_yoy | velocidad_yoy | +0.267 |
| ipv_general_yoy | plazo_yoy | -0.355 |
| ipv_general_yoy | descuento_yoy | +0.236 |
| icoi_yoy | precio_yoy | +0.541 |
| icoi_yoy | descuento_yoy | -0.490 |

### nacional/townhouse (n=39 trim)

| Macro | Producto | ρ Spearman |
|---|---|---|
| imacec_var | precio_yoy | +0.524 |
| imacec_var | velocidad_yoy | -0.342 |
| imacec_var | plazo_yoy | -0.243 |
| imacec_var | sup_yoy | +0.362 |
| d_tasa_hipo | velocidad_yoy | -0.455 |
| d_tasa_hipo | plazo_yoy | +0.374 |
| d_tasa_hipo | descuento_yoy | -0.316 |
| d_tasa_hipo | sup_yoy | +0.307 |
| d_desempleo | precio_yoy | -0.552 |
| d_desempleo | velocidad_yoy | +0.333 |
| d_desempleo | sup_yoy | -0.433 |
| ipv_general_yoy | velocidad_yoy | +0.200 |
| ipv_general_yoy | plazo_yoy | -0.435 |
| ipv_general_yoy | descuento_yoy | +0.275 |
| icoi_yoy | precio_yoy | +0.259 |
| icoi_yoy | sup_yoy | +0.205 |
