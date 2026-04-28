"""Convierte macro_factor_c.json → public/macro_factor_c.js (window.MACRO_FACTOR_C)."""
import json, os, math

with open('analysis/macro_factor_c.json') as f:
    model = json.load(f)

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

slim = sanitize(model)

js = '// Auto-generado por analysis/build_macro_c_js.py\n'
js += '// Factor Model Opción C: shocks directos IPV/ICOI + regresión sólo para velocidad\n'
js += 'window.MACRO_FACTOR_C = ' + json.dumps(slim, separators=(',', ':')) + ';\n'

with open('public/macro_factor_c.js', 'w') as f:
    f.write(js)

print(f'Wrote public/macro_factor_c.js ({os.path.getsize("public/macro_factor_c.js")/1024:.1f} KB)')
print(f'Familias: {list(model["family_models"].keys())}')
print(f'Presets: {list(model["presets"].keys())}')
print(f'Macros: {list(model["macros"].keys())}')
