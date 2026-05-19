import type { NextConfig } from "next";

// Static export para GitHub Pages.
// Repo = modela-simulador.github.io → sirve en raíz, basePath vacío.
const isProd = process.env.NODE_ENV === "production";
const isGhPages = process.env.DEPLOY_TARGET === "gh-pages" || isProd;
const basePath = "";

const nextConfig: NextConfig = {
  turbopack: {
    root: __dirname,
  },
  ...(isGhPages && {
    output: "export",
    basePath,
    assetPrefix: basePath,
    images: { unoptimized: true },
    trailingSlash: true,
  }),
  env: {
    NEXT_PUBLIC_BASE_PATH: basePath,
  },
};

export default nextConfig;
