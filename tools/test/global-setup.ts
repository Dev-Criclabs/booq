import { startCluster, type Cluster } from '../../packages/db/src/testing/cluster';

// Starts one throwaway Postgres for the whole Vitest run unless BOOQ_TEST_DATABASE_URL
// already points at a server (CI). If neither works, DB tests fail with the reason.
let cluster: Cluster | undefined;

export async function setup() {
  if (process.env.BOOQ_TEST_DATABASE_URL) return;
  try {
    cluster = await startCluster();
    process.env.BOOQ_TEST_DATABASE_URL = cluster.adminUrl;
  } catch (e) {
    process.env.BOOQ_TEST_DB_ERROR = `Could not start a test Postgres: ${(e as Error).message}`;
  }
}

export async function teardown() {
  await cluster?.stop();
}
