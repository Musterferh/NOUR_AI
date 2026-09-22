import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ['@libsql/client', '@prisma/adapter-libsql'],
  devIndicators: false,
  outputFileTracingIncludes: { '/api/**': ['./data/*.json', './data/coach-policy.md'] },
  async headers() {
    return [{ source: '/:path*', headers: [
      { key: 'X-Content-Type-Options', value: 'nosniff' },
      { key: 'Referrer-Policy', value: 'same-origin' },
      { key: 'X-Frame-Options', value: 'DENY' },
      { key: 'Permissions-Policy', value: 'microphone=(self), camera=()' },
    ] }];
  },
};

export default nextConfig;
