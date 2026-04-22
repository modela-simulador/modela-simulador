/**
 * basePath helper para servir la app bajo `/modela-simulador` en GitHub Pages.
 * En dev local (sin DEPLOY_TARGET) el basePath queda vacío.
 */
export const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH || "";

/** Prefija una ruta absoluta con el basePath del deployment. */
export const withBase = (path: string): string => {
  if (!path.startsWith("/")) return path;
  return `${BASE_PATH}${path}`;
};
