import { f01Datasets } from '../export/service';

// Report modules and the CI harness that checks them (F01-T29; PLAT-07-AC7; D33). A report is anything that
// counts or lists club data for a person or the platform: reports, daily close, receipts lists, exports and
// platform counts. Each one names the tables it reads that carry `is_test`; the harness (test-exclusion.test.ts)
// seeds a test row in each of those tables and the report must return nothing for it. A feature that adds a
// report adds it here, and adds a seeder in the harness for any test table it reads that has none yet.

export interface ReportTx {
  query(text: string, params?: unknown[]): Promise<{ rows: any[]; rowCount?: number | null }>;
}

export interface ReportModule {
  name: string;
  /** Tables (without schema) the report reads that are registered in app.test_tables. */
  reads: readonly string[];
  /** Runs inside a club transaction and returns the number of rows (or counted things) it found. */
  run(tx: ReportTx): Promise<number>;
}

const modules: ReportModule[] = [];

export function registerReport(m: ReportModule): void {
  if (modules.some((x) => x.name === m.name)) throw new Error(`report ${m.name} is already registered`);
  modules.push(m);
}
export const reportModules = (): readonly ReportModule[] => modules;

// F01: the club export datasets that read a test table.
registerReport({
  name: 'export:players',
  reads: ['app_user'],
  run: async (tx) => (await tx.query(f01Datasets.find((d) => d.name === 'players')!.sql)).rows.length,
});
