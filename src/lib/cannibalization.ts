/**
 * Canibalización de ventas en proyectos multi-etapa.
 *
 * Cuando varias etapas venden simultáneamente, el mercado absorbe MENOS
 * que la suma individual. Factor de canibalización:
 *   velocidadTotalActiva = baseVelocity × cannibalizationFactor(n)
 *
 * donde n es el número de etapas activas vendiendo en un mes dado.
 * Cada etapa recibe una fracción proporcional: baseVelocity × factor(n) / n.
 *
 * Dato conocido (aportado por Sebastián):
 *   factor(1) = 1.00  (1 etapa: vende n unidades)
 *   factor(2) = 1.35  (2 etapas: entre ambas venden 1.35n, no 2n)
 *
 * Faltan factor(3) y factor(4). El usuario define estos dos valores según
 * su know-how del mercado (datos empíricos o criterio profesional).
 */

export function cannibalizationFactor(nActiveEtapas: number): number {
  // TODO: define tus factores para 3 y 4 etapas activas simultáneamente.
  //
  // Consideraciones:
  //  - La curva debe ser cóncava (diminishing returns)
  //  - factor(n) / n debe ser decreciente (vender en más etapas baja la velocidad de cada una)
  //  - Empíricamente: el límite de absorción del mercado local rara vez sube >2x de
  //    lo que una etapa única puede vender
  //  - Dos sub-opciones típicas en la literatura inmobiliaria chilena:
  //      (a) factor(3)=1.55, factor(4)=1.70  — canibalización fuerte
  //      (b) factor(3)=1.60, factor(4)=1.80  — canibalización moderada
  //
  // Reemplaza los "? ? ?" con tus valores.
  if (nActiveEtapas <= 0) return 0;
  if (nActiveEtapas === 1) return 1.0;
  if (nActiveEtapas === 2) return 1.35;
  if (nActiveEtapas === 3) return /* TODO: tu valor, ej 1.55 */ 1.55;
  if (nActiveEtapas === 4) return /* TODO: tu valor, ej 1.70 */ 1.70;
  // Más de 4: extrapolación log (para evitar crashes; realmente no usado)
  return 1.7 + 0.1 * Math.log2(nActiveEtapas / 4);
}
