import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // Hinweis: "output: standalone" erst in Etappe 6 aktivieren, und nur dann,
  // wenn das Ziel ein eigener Container ist. Mit "next start" ist die Option
  // unvertraeglich und bricht den E2E-Lauf gegen einen Produktionsbuild.
  reactStrictMode: true,
  typedRoutes: true,
  typescript: {
    // Typecheck laeuft ebenfalls als eigener CI-Schritt (tsc --noEmit).
    ignoreBuildErrors: false,
  },
};

export default nextConfig;
