const path = require('path');

const API_ORIGIN = process.env.API_ORIGIN || 'http://localhost:3001';

const securityHeaders = [
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Referrer-Policy', value: 'same-origin' },
  { key: 'Permissions-Policy', value: 'camera=(self), microphone=(), geolocation=()' },
  {
    key: 'Content-Security-Policy',
    value: [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline'" + (process.env.NODE_ENV === 'development' ? " 'unsafe-eval'" : ''),
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
      "font-src 'self' https://fonts.gstatic.com",
      "img-src 'self' data: blob:",
      "connect-src 'self'",
      "frame-ancestors 'none'",
      "base-uri 'self'",
      "form-action 'self'",
    ].join('; '),
  },
];

/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  // Monorepo: trace dependencies from the repo root so hoisted packages end up in the build.
  experimental: { outputFileTracingRoot: path.join(__dirname, '../../') },
  poweredByHeader: false,
  // Style rules run with `npm run lint`; a lint warning must never stop a production build.
  // Type errors still do (next build type-checks).
  eslint: { ignoreDuringBuilds: true },
  // The browser only ever talks to this origin; /api is proxied to the NestJS server.
  // Same origin means the session cookie is first-party and SameSite=Strict works.
  async rewrites() {
    return [{ source: '/api/:path*', destination: `${API_ORIGIN}/api/:path*` }];
  },
  async headers() {
    return [{ source: '/:path*', headers: securityHeaders }];
  },
};
module.exports = nextConfig;
