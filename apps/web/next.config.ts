import type { NextConfig } from 'next';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

// API routes only for now (no pages). The workspace packages are TypeScript source, so Next compiles them.
const config: NextConfig = {
  transpilePackages: ['@booq/auth', '@booq/db', '@booq/domain', '@booq/line', '@booq/time'],
  // Loaded by Node at runtime, not bundled: pdfkit reads its own data files from disk, and the receipt
  // PDF resolves the Sarabun font files to real paths (packages/receipts/src/pdf.ts).
  serverExternalPackages: ['pg', 'pdfkit', '@expo-google-fonts/sarabun'],
  outputFileTracingRoot: root,
  turbopack: { root },
  poweredByHeader: false,
  // Files the server reads at runtime that the build tracer cannot see, so they ship with the API
  // functions: the language files (read from LOCALES_DIR for receipts and LINE text, pending keys
  // included) and the Sarabun fonts the receipt PDF embeds (packages/receipts/src/pdf.ts finds them
  // from the package's package.json at runtime). Paths are relative to apps/web.
  outputFileTracingIncludes: {
    // Keys are picomatch route globs (brackets would be character classes), so every API route.
    '/api/**': [
      '../../locales/en.json',
      '../../locales/th.json',
      '../../locales/pending/*.json',
      '../../node_modules/.pnpm/@expo-google-fonts+sarabun@*/node_modules/@expo-google-fonts/sarabun/package.json',
      '../../node_modules/.pnpm/@expo-google-fonts+sarabun@*/node_modules/@expo-google-fonts/sarabun/400Regular/Sarabun_400Regular.ttf',
      '../../node_modules/.pnpm/@expo-google-fonts+sarabun@*/node_modules/@expo-google-fonts/sarabun/700Bold/Sarabun_700Bold.ttf',
    ],
  },
};

export default config;
