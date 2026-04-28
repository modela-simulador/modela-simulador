"""Convierte macro_factor_model.json a JS embebible (window.MACRO_MODEL)."""
import json, os

with open('analysis/macro_factor_model.json') as f:
    model = json.load(f)

# Adelgazar — el JSON tiene los percentiles densos completos. Mantenemos
# todo (es esencial para la cópula). Pero redondeamos para reducir tamaño.
def round_floats(o, ndigits=4):
    if isinstance(o, float):
        return round(o, ndigits)
    if isinstance(o, dict):
        return {k: round_floats(v, ndigits) for k, v in o.items()}
    if isinstance(o, list):
        return [round_floats(v, ndigits) for v in o]
    return o

slim = round_floats(model)

js = '// Auto-generado por analysis/build_macro_js.py\n'
js += '// Capa 2 cíclica del factor model: macros + regresiones por familia\n'
js += '// Fuente: Info MacroEco CL.xlsx + CIDU 2010-2024\n'
js += 'window.MACRO_MODEL = ' + json.dumps(slim, separators=(',', ':')) + ';\n'

with open('public/macro_model.js', 'w') as f:
    f.write(js)
size_kb = os.path.getsize('public/macro_model.js') / 1024
print(f'Wrote public/macro_model.js ({size_kb:.1f} KB)')
print(f'Familias: {list(model["family_models"].keys())}')
print(f'Macros: {list(model["macros"].keys())}')
