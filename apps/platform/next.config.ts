import type { NextConfig } from 'next';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

// The API and the first pages (enrolment, team). The workspace packages are TypeScript source, so Next compiles them.
const config: NextConfig = {
  transpilePackages: ['@booq/auth', '@booq/beam', '@booq/db', '@booq/domain', '@booq/line', '@booq/time', '@booq/secrets'],
  serverExternalPackages: ['pg'],
  outputFileTracingRoot: root,
  turbopack: { root },
  poweredByHeader: false,
  // The enrolment link carries its token in the address fragment: nothing may leak it by referrer, cache or framing.
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'Referrer-Policy', value: 'no-referrer' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Cache-Control', value: 'no-store' },
        ],
      },
    ];
  },
};

export default config;
