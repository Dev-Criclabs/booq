import type { NextConfig } from 'next';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

// API routes only for now (no pages). The workspace packages are TypeScript source, so Next compiles them.
const config: NextConfig = {
  transpilePackages: ['@booq/auth', '@booq/db', '@booq/time', '@booq/secrets'],
  serverExternalPackages: ['pg'],
  outputFileTracingRoot: root,
  turbopack: { root },
  poweredByHeader: false,
};

export default config;
