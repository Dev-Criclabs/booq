// CI entry point named in .github/workflows/ci.yml. The check itself is TypeScript
// (packages/db/src/registry), so this runs it through vite-node.
import { spawnSync } from 'node:child_process';

const r = spawnSync('pnpm', ['exec', 'vite-node', 'tools/check-table-classes.run.ts'], { stdio: 'inherit', env: process.env });
process.exit(r.status ?? 1);
