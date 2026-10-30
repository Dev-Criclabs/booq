// Test data is not club data (PLAT-07-AC7; D33). Every report, daily close, receipts list and platform count
// that reads a table carrying `is_test` puts this condition in its WHERE clause, so a Testing club's rehearsal
// never shows in a number. The lint (tools/lint/banned-patterns.mjs, rule report-not-test) fails a report
// module that reads such a table without it, and the harness in reports/ seeds test rows into each report.

const IDENT = /^[a-z_][a-z0-9_]*$/;

/** `is_test = false`, or `<alias>.is_test = false`. The alias is checked so it can never carry SQL. */
export function notTest(alias?: string): string {
  if (alias === undefined) return 'is_test = false';
  if (!IDENT.test(alias)) throw new Error(`notTest: "${alias}" is not a table alias`);
  return `${alias}.is_test = false`;
}
