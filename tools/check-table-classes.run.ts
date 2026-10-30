import { checkTableClasses } from '../packages/db/src/registry/check';
import { collectRegistry } from '../packages/db/src/registry/index';
import { startCluster, type Cluster } from '../packages/db/src/testing/cluster';
import { createProductionDatabase } from '../packages/db/src/testing/harness';

// CI entry (see tools/check-table-classes.mjs): builds a database from the migrations only and
// checks every table against the registry. Uses BOOQ_TEST_DATABASE_URL if set, else starts a
// throwaway Postgres.
// --kinds a,b limits the problems reported (check-audit-triggers.mjs passes the audit ones);
// --label names the check in the output.
const args = process.argv.slice(2);
const opt = (name: string): string | undefined => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const kinds = opt('--kinds')?.split(',');
const label = opt('--label') ?? 'Table classes';

async function main(): Promise<number> {
  const strict = process.env.CI_STRICT === 'true';
  let cluster: Cluster | undefined;
  try {
    if (!process.env.BOOQ_TEST_DATABASE_URL) {
      try {
        cluster = await startCluster();
        process.env.BOOQ_TEST_DATABASE_URL = cluster.adminUrl;
      } catch (e) {
        const msg = `${label}: no Postgres available to check against (${(e as Error).message})`;
        console.error(strict ? `::error::${msg}` : `::notice::${msg}. Skipped.`);
        return strict ? 1 : 0;
      }
    }
    const db = await createProductionDatabase();
    try {
      const result = await checkTableClasses(db.pool, await collectRegistry());
      const problems = result.problems.filter((p) => !kinds || kinds.includes(p.kind));
      if (!kinds) for (const w of result.warnings) console.log(`::notice::${label}: ${w.table} is in the registry but no table exists yet`);
      for (const p of problems) console.error(`::error::${label}: ${p.kind} ${p.table}${p.detail ? ` (${p.detail})` : ''}`);
      console.log(`${label}: ${problems.length === 0 ? 'OK' : 'FAILED'} (${result.checked} tables checked, ${problems.length} problems)`);
      return problems.length === 0 ? 0 : 1;
    } finally {
      await db.close();
    }
  } finally {
    await cluster?.stop();
  }
}

main().then((code) => process.exit(code), (e) => {
  console.error(e);
  process.exit(1);
});
