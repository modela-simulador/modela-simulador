# CLAUDE.md — modela-simulador.github.io

> Guía para Claude Code. Generado 2026-07-03 analizando el código real.

## Qué es
**Sitio publicado por GitHub Pages** del simulador financiero-inmobiliario **Modela** (org `modela-simulador`). Se sirve en `https://modela-simulador.github.io/`. Todo vive en un único archivo estático `simulador.html` (~15.900 líneas): landing + app. Modela flujos de caja, VAN/TIR, capital de trabajo, Monte Carlo, stress test y drawdowns para proyectos de urbanización en modos **PDUC**, **AUDP** y **sanitaria**. `pduc_plan.jpg` es el plano del plan urbanístico usado en la UI.

## Stack
- HTML + CSS + JavaScript vanilla, **todo inline** en `simulador.html`. Sin framework, sin bundler, sin `package.json`.
- Librerías por CDN (jsdelivr): Chart.js 4.4, chartjs-plugin-zoom, Hammer.js, html2pdf.js, jsPDF + autotable. Fuentes: Google Fonts (Inter).
- 100% cliente: sin backend, sin `fetch`/XHR a APIs, sin `localStorage`. Los cálculos y la exportación a PDF corren en el navegador.
- Carpeta `Modela/` + `Modela.xcodeproj`: proyecto Xcode/SwiftUI que es solo el **stub inicial "Hello, world!"** (no usa el simulador; ignorable).

## Estructura
```
index.html                     Stub: redirige a simulador.html?v=<timestamp>
simulador.html                 LA app real (landing + simulador, todo inline)
pduc_plan.jpg                  Plano PDUC (activo de la UI)
modela-simulador/
  index.html                   Stub redirect a ../simulador.html (URL legacy)
  simulador.html               Stub redirect a ../simulador.html (URL legacy)
Modela/                        SwiftUI stub "Hello world" (sin relación con el sim)
Modela.xcodeproj/              Proyecto Xcode del stub
```

## Comandos
No hay build ni tests. Es un sitio estático. Para previsualizar localmente:
```
python3 -m http.server 8000    # abrir http://localhost:8000/
```
(Abrir `simulador.html` por `file://` puede fallar por la CSP / rutas relativas; usa un servidor.)

## Deploy / entorno
- **Repo de GitHub Pages tipo user/org site** (`<org>.github.io`): GitHub publica automáticamente la raíz de la rama de Pages en `https://modela-simulador.github.io/`.
- Sin `CNAME` (dominio por defecto `*.github.io`), sin `.github/workflows` (publicación nativa de Pages; existe también rama remota `gh-pages`).
- `index.html` fuerza no-cache y redirige a `simulador.html?v=Date.now()` para saltar caché.
- Los stubs bajo `modela-simulador/` cubren la **URL legacy `/modela-simulador/`** (último commit `c854f29`, 2026-05-19).

## Estado real (según código, 2026-07-03)
- HEAD `c854f29` "Add redirect stubs for legacy /modela-simulador/ URL", 2026-05-19.
- **Este repo (`modela-simulador/modela-simulador.github.io`) y `modela-simulador/modela-simulador` son idénticos byte a byte**: mismo commit HEAD, mismo árbol de trabajo (`diff -rq` vacío), mismas ramas (`main`, `gh-pages`, `feature/nextjs-app`, `claude/wifi-password-recovery-*`).
- Relación: **este repo `.github.io` es el sitio publicado** (GitHub Pages user/org site).
- ⚠️ **`modela-simulador/modela-simulador.git` y `modela-simulador/modela-simulador.github.io.git` son EL MISMO repo en GitHub** (la primera URL redirige a la segunda; verificado 2026-08-21 con `git ls-remote`: ambas devuelven el mismo SHA). **Un solo `git push` publica**. No commitear el mismo cambio en las dos copias locales: crea commits duplicados y el segundo push se rechaza por non-fast-forward. Si la copia local `~/Proyectos/modela-simulador` quedó atrasada, sincronizarla con `git fetch && git reset --hard origin/main`.

## Notas / gotchas
- Edita **solo `simulador.html`** (raíz). Los otros `*.html` son redirects; no dupliques lógica ahí.
- `Modela/` (SwiftUI) es un stub sin relación con el simulador; no lo confundas con la app real.
- Como este es el repo **efectivamente publicado**, cualquier cambio aquí es visible en producción tras el deploy de Pages; replícalo en `modela-simulador` para no desincronizar.
- La rama remota `feature/nextjs-app` sugiere una posible futura migración a Next.js, pero `main` sigue siendo el sitio estático de un solo archivo.
