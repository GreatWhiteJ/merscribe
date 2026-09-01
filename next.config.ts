import type { NextConfig } from "next";

// When BASE_PATH is set (the embed build for jarrettwhite.com — see
// scripts/build-embed.mjs), the static export is served from a sub-path
// (/merscribe) inside another site, so every asset URL must be prefixed.
// The default build (Electron desktop + `next dev`) leaves this empty so
// file:// loading and localhost keep working unchanged.
const BASE_PATH = process.env.BASE_PATH || '';

const nextConfig: NextConfig = {
  output: 'export',       // generates out/ directory
  trailingSlash: true,    // each route → /route/index.html
  ...(BASE_PATH ? { basePath: BASE_PATH, assetPrefix: BASE_PATH } : {}),

  // NOTE: headers() only applies to `next dev` / `next start`.
  // The static out/ export is served by bin/cli.js (serve package) —
  // configure headers there or in your deployment platform separately.
  async headers() {
    return [{
      source: '/(.*)',
      headers: [
        { key: 'X-Content-Type-Options', value: 'nosniff' },
        { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
        { key: 'X-XSS-Protection', value: '1; mode=block' },
        { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
        { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
      ],
    }];
  },
};

export default nextConfig;
