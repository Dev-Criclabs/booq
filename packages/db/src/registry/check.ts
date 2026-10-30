import type { Pool } from 'pg';
import type { Registry } from './types';

export type ProblemKind =
  | 'unclassified'
  | 'no-rls'
  | 'no-force-rls'
  | 'no-club-id'
  | 'no-unique-club-id-id'
  | 'personal-column-in-setup-table'
  | 'wrong-schema-for-class'
  | 'is-test-not-registered'
  | 'is-test-registered-without-column'
  | 'is-test-trigger-missing'
  | 'audit-trigger-missing'
  | 'audit-undeclared';

export interface Problem {
  kind: ProblemKind;
  table: string;
  detail?: string;
}
export interface CheckResult {
  problems: Problem[];
  /** Registry entries with no table yet (a feature not built). Not a failure. */
  warnings: { table: string }[];
  checked: number;
}

// Columns whose name says "personal data" or "secret". Setup (S) tables may hold none of them
// except where the registry allows it (the owner contact, decision D2; masked secret tails).
const PERSONAL = /(^|_)(full_name|phone|email|date_of_birth|dob|line_user_id|staff_note|notes?|password|passcode|secret|token|api_key|hmac)(_|$)/;
const ALWAYS_ALLOWED = new Set(['secret_last4']);

const TABLES_SQL = `
select n.nspname as schema, c.relname as name,
       c.relrowsecurity as rls, c.relforcerowsecurity as force_rls,
       array(select a.attname::text from pg_attribute a
              where a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped order by a.attnum) as columns,
       exists (
         select 1 from pg_index i
          where i.indrelid = c.oid and i.indisunique and i.indnatts = 2
            and (select array_agg(a.attname::text order by k.ord)
                   from unnest(i.indkey) with ordinality as k(attnum, ord)
                   join pg_attribute a on a.attrelid = c.oid and a.attnum = k.attnum) = array['club_id','id']
       ) as has_unique_club_id_id
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
 where c.relkind in ('r','p')
   and n.nspname not in ('pg_catalog','information_schema')
   and n.nspname not like 'pg\\_%'
   and not exists (select 1 from pg_depend d where d.objid = c.oid and d.deptype = 'e')
 order by 1, 2`;

export async function checkTableClasses(db: Pick<Pool, 'query'>, registry: Registry): Promise<CheckResult> {
  const { rows } = await db.query(TABLES_SQL);
  const problems: Problem[] = [];
  const seen = new Set<string>();

  for (const t of rows) {
    const key = `${t.schema}.${t.name}`;
    seen.add(key);
    const entry = registry[key];
    if (!entry) {
      problems.push({ kind: 'unclassified', table: key });
      continue;
    }
    if (entry.class === 'infra') continue;

    const inPlatform = t.schema === 'platform';
    if ((entry.class === 'P') !== inPlatform) {
      problems.push({ kind: 'wrong-schema-for-class', table: key, detail: `class ${entry.class} in schema ${t.schema}` });
    }
    if (entry.class === 'P') continue;

    const scope = entry.scope ?? 'club';
    if (!t.rls) problems.push({ kind: 'no-rls', table: key });
    else if (!t.force_rls) problems.push({ kind: 'no-force-rls', table: key });

    if (scope === 'club') {
      if (!t.columns.includes('club_id')) problems.push({ kind: 'no-club-id', table: key });
      else if (t.columns.includes('id') && !t.has_unique_club_id_id) problems.push({ kind: 'no-unique-club-id-id', table: key });
    }

    if (entry.class === 'S') {
      const allowed = new Set([...ALWAYS_ALLOWED, ...(entry.allowColumns ?? [])]);
      for (const col of t.columns as string[]) {
        if (PERSONAL.test(col) && !allowed.has(col)) problems.push({ kind: 'personal-column-in-setup-table', table: key, detail: col });
      }
    }
  }

  // Test-mode tables (F01-T26): every table with an is_test column is in app.test_tables, and back.
  const reg = await db.query(`
    select to_regclass('app.test_tables') is not null as present`);
  if (reg.rows[0].present) {
    const { rows: tt } = await db.query(
      `select table_schema || '.' || table_name as key, auto_flag,
              exists (select 1 from pg_trigger g where g.tgrelid = to_regclass(quote_ident(table_schema) || '.' || quote_ident(table_name))
                        and g.tgname = 'is_test_set' and not g.tgisinternal) as has_set,
              exists (select 1 from pg_trigger g where g.tgrelid = to_regclass(quote_ident(table_schema) || '.' || quote_ident(table_name))
                        and g.tgname = 'is_test_keep' and not g.tgisinternal) as has_keep
         from app.test_tables`,
    );
    const registered = new Map(tt.map((r) => [r.key as string, r]));
    for (const t of rows) {
      const key = `${t.schema}.${t.name}`;
      const has = (t.columns as string[]).includes('is_test');
      const r = registered.get(key);
      if (has && !r) problems.push({ kind: 'is-test-not-registered', table: key });
      if (!has && r) problems.push({ kind: 'is-test-registered-without-column', table: key });
      if (has && r && ((r.auto_flag && !r.has_set) || !r.has_keep)) problems.push({ kind: 'is-test-trigger-missing', table: key });
    }
    for (const key of registered.keys()) {
      if (!rows.some((t) => `${t.schema}.${t.name}` === key)) problems.push({ kind: 'is-test-registered-without-column', table: key, detail: 'table does not exist' });
    }
  }

  // Audited tables (F01-T11): the registry's `audited` flag, audit.registry and the audit_row trigger agree.
  const aud = await db.query(`select to_regclass('audit.registry') is not null as present`);
  if (aud.rows[0].present) {
    const { rows: ar } = await db.query(
      `select r.table_schema || '.' || r.table_name as key,
              exists (select 1 from pg_trigger g
                       where g.tgrelid = to_regclass(quote_ident(r.table_schema) || '.' || quote_ident(r.table_name))
                         and g.tgname = 'audit_row' and not g.tgisinternal) as has_trigger
         from audit.registry r`,
    );
    const inAudit = new Map(ar.map((r) => [r.key as string, r.has_trigger as boolean]));
    for (const [key, entry] of Object.entries(registry)) {
      if (!entry.audited || !seen.has(key)) continue;
      if (inAudit.get(key) !== true) problems.push({ kind: 'audit-trigger-missing', table: key });
    }
    for (const [key, hasTrigger] of inAudit) {
      if (!registry[key]?.audited) problems.push({ kind: 'audit-undeclared', table: key });
      else if (!hasTrigger && !problems.some((p) => p.kind === 'audit-trigger-missing' && p.table === key)) problems.push({ kind: 'audit-trigger-missing', table: key });
    }
  }

  const warnings = Object.keys(registry)
    .filter((k) => !seen.has(k))
    .sort()
    .map((table) => ({ table }));
  return { problems, warnings, checked: rows.length };
}
