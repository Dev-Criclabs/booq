// CI entry point named in .github/workflows/ci.yml. Every table the registry marks `audited`
// is in audit.registry and has its audit_row trigger, and the other way round (F01-T11; FA 4.5).
import { spawnSync } from 'node:child_process';

const r = spawnSync(
  'pnpm',
  ['exec', 'vite-node', 'tools/check-table-classes.run.ts', '--', '--kinds', 'audit-trigger-missing,audit-undeclared', '--label', 'Audit triggers'],
  { stdio: 'inherit', env: process.env },
);
process.exit(r.status ?? 1);
