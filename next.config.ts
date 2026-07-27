import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // Standalone-Output haelt uns deploy-agnostisch: derselbe Build laeuft
  // auf Vercel, Railway oder in einem eigenen Container.
  output: 'standalone',
  reactStrictMode: true,
  typedRoutes: true,
  typescript: {
    // Typecheck laeuft ebenfalls als eigener CI-Schritt (tsc --noEmit).
    ignoreBuildErrors: false,
  },
};

export default nextConfig;
