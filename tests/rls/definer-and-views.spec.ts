// SECURITY DEFINER functions and views (RLS test plan RLS-M05, RLS-M06, RLS-A02). A definer function runs with its owner's
// rights, and a view runs with its owner's rights unless it is security_invoker, so both can bypass row level security.
// The catalog checks need no data. The probe calls every function the application role may execute, as a club A context,
// with the ids of club B's rows as arguments, and fails if anything of club B comes back or club B's rows change.
import { afterAll, describe, expect, it } from 'vitest';
import { A, B, buildWorld } from './world';

const { tdb, db, registry, clubTables, unseedable, close } = await buildWorld();
afterAll(close);

// Mutation check (by hand, tests/rls/README.md): QA_MUTATE_SQL runs one statement as the admin before the checks; the suite must go red.
if (process.env.QA_MUTATE_SQL) await tdb.query(process.env.QA_MUTATE_SQL);

const q = async (sql: string, params: unknown[] = []) => (await tdb.query(sql, params)).rows as Array<Record<string, any>>; // eslint-disable-line @typescript-eslint/no-explicit-any
const SCHEMAS = `('public','app','platform','audit')`;

// ---- club B's ids and text markers, used to recognise a leak in any result ----
const bIds = new Set<string>([B]);
const bMarkers = new Set<string>();
for (const [t, e] of clubTables) {
  if (e.scope === 'self' || t in unseedable) continue;
  for (const r of await q(`select to_jsonb(x) as j from ${t} x where club_id = $1`, [B])) {
    for (const v of Object.values(r.j as Record<string, unknown>)) {
      if (typeof v === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v)) bIds.add(v);
      if (typeof v === 'string' && v.startsWith('s-')) bMarkers.add(v);
    }
  }
}
const leaks = (value: unknown): string[] => {
  const text = JSON.stringify(value ?? null);
  return [...bMarkers].filter((m) => text.includes(m));
};
const fingerprint = async () => {
  const out: Record<string, string> = {};
  for (const [t, e] of clubTables) {
    const col = e.scope === 'self' ? 'id' : 'club_id';
    out[t] = (await q(`select md5(coalesce(string_agg(x::text, '|' order by x::text), '')) as h from ${t} x where ${col} = $1`, [B]))[0]!.h as string;
  }
  return out;
};

describe('seed for the probe', () => {
  it('club B has rows and markers to recognise', () => {
    expect(bIds.size).toBeGreaterThan(20);
    expect(bMarkers.size).toBeGreaterThan(20);
  });
});

// ---------------------------------------------------------------------------------------------------------------
const defs = await q(
  `select n.nspname as s, p.proname as name, p.oid, pg_get_userbyid(p.proowner) as owner, coalesce(p.proconfig::text, '') as cfg, coalesce(p.proacl::text, '') as acl,
          pg_get_function_identity_arguments(p.oid) as args, pg_get_function_arguments(p.oid) as argdefs
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname in ${SCHEMAS} and p.prokind = 'f' and p.prosecdef order by 1, 2`,
);

describe('SECURITY DEFINER functions: catalog', () => {
  const label = (f: Record<string, any>) => `${f.s}.${f.name}(${f.args})`; // eslint-disable-line @typescript-eslint/no-explicit-any

  it('there are definer functions to check', () => {
    expect(defs.length).toBeGreaterThan(50);
  });

  it('every definer function is owned by a role that is not a superuser and does not bypass row level security', async () => {
    const owners = [...new Set(defs.map((f) => f.owner as string))];
    const roles = await q(`select rolname, rolsuper, rolbypassrls from pg_roles where rolname = any($1)`, [owners]);
    expect(roles.filter((r) => r.rolsuper || r.rolbypassrls).map((r) => r.rolname), 'definer owner that bypasses row level security').toEqual([]);
    expect(roles.length).toBe(owners.length);
  });

  it('every definer function fixes its search_path, starting with pg_catalog and never naming public', () => {
    const bad = defs.filter((f) => !/search_path=pg_catalog/.test((f.cfg as string).replace(/"/g, '')) || /search_path=[^,}]*\bpublic\b/.test(f.cfg as string)).map(label);
    expect(bad).toEqual([]);
  });

  it('no definer function can be executed by PUBLIC, anon or authenticated', async () => {
    const bad: string[] = [];
    for (const f of defs) {
      const r = (await q(`select has_function_privilege('anon', $1::oid, 'execute') a, has_function_privilege('authenticated', $1::oid, 'execute') b`, [f.oid]))[0]!;
      if (r.a || r.b || /(^|[{,])=X/.test(f.acl as string) || f.acl === '') bad.push(label(f));
    }
    expect(bad).toEqual([]);
  });

  // A function may take a club id only if it answers nothing for any club but the context club. Each exception is proven below.
  const NAMED_CLUB_ALLOWED: Record<string, string> = {
    'app.coach_flag_reason': 'returns null unless p_club equals the context club (migration 0807); it is a helper for the coach_flagged_session view',
  };

  it('no definer function the application role may execute takes a club id: the club comes from the context', async () => {
    const bad: string[] = [];
    for (const f of defs) {
      if (`${f.s}.${f.name}` in NAMED_CLUB_ALLOWED) continue;
      if (!(await q(`select has_function_privilege('booq_app', $1::oid, 'execute') ok`, [f.oid]))[0]!.ok) continue;
      if (/\b(p_)?club(_id)?\b/i.test(f.argdefs as string)) bad.push(label(f));
    }
    expect(bad, 'a caller could name another club').toEqual([]);
  });
});

// ---------------------------------------------------------------------------------------------------------------
type Arg = { name: string; type: string };
function parseArgs(argdefs: string): Arg[] | null {
  if (!argdefs.trim()) return [];
  const out: Arg[] = [];
  for (const raw of argdefs.split(/,\s*(?![^()]*\))/)) {
    const m = /^(?:(?:IN|INOUT)\s+)?(?:(\w+)\s+)?(.+?)(?:\s+DEFAULT\s+.*)?$/i.exec(raw.trim());
    if (!m || /^(OUT|VARIADIC|TABLE)\b/i.test(raw.trim())) return null;
    out.push({ name: m[1] ?? '', type: m[2]!.trim().toLowerCase() });
  }
  return out;
}
function valueFor(a: Arg, id: string): unknown | undefined {
  const t = a.type;
  if (t === 'uuid') return id;
  if (t === 'text' || t.startsWith('character')) return /hash/.test(a.name) ? 'a'.repeat(64) : 'x';
  if (t === 'integer' || t === 'smallint' || t === 'bigint' || t === 'numeric') return 1;
  if (t === 'boolean') return false;
  if (t.startsWith('timestamp')) return '2026-12-07T10:00:00+07:00';
  if (t === 'date') return '2026-12-07';
  if (t === 'jsonb' || t === 'json') return '{}';
  if (t === 'interval') return '1 hour';
  if (t.endsWith('[]')) return '{}';
  return undefined;
}

describe('SECURITY DEFINER functions: allowed club arguments', () => {
  it('app.coach_flag_reason answers null for another club, even with a real coach of that club', async () => {
    const coach = (await q(`select id from public.coach where club_id = $1 limit 1`, [B]))[0]?.id ?? '00000000-0000-4000-8000-000000000001';
    const r = await db.withClubTx({ clubId: A, userId: null, roles: ['owner', 'player'], source: 'admin' }, async (tx) =>
      (await tx.query(`select app.coach_flag_reason($1::uuid, $2::uuid, now()) as r`, [B, coach])).rows,
    );
    expect(r[0]!.r).toBeNull();
  });
});

describe('SECURITY DEFINER functions: probe with another club\'s ids', () => {
  it('no function the application role may execute returns club B data or changes club B rows, as a club A owner or a guest', async () => {
    const fns = await q(
      `select n.nspname as s, p.proname as name, p.oid, pg_get_function_arguments(p.oid) as argdefs, pg_get_function_identity_arguments(p.oid) as args, p.prorettype::regtype::text as ret
         from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname in ${SCHEMAS} and p.prokind = 'f' and p.prosecdef and p.prorettype <> 'trigger'::regtype
          and has_function_privilege('booq_app', p.oid, 'execute') order by 1, 2`,
    );
    expect(fns.length).toBeGreaterThan(20);
    const before = await fingerprint();
    const ids = [...bIds];
    let calls = 0;
    let skipped = 0;
    const leaked: string[] = [];
    for (const f of fns) {
      const args = parseArgs(f.argdefs as string);
      if (!args) { skipped++; continue; }
      const types = args.map((a) => a.type);
      const hasUuid = types.includes('uuid');
      const probeIds = hasUuid ? ids : [ids[0]!];
      for (const id of probeIds) {
        const params = args.map((a) => valueFor(a, id));
        if (params.some((p) => p === undefined)) { skipped++; break; }
        const sql = `select * from ${f.s}.${f.name}(${args.map((a, i) => `$${i + 1}::${a.type}`).join(', ')})`;
        for (const roles of [['owner', 'player'], ['guest']]) {
          calls++;
          try {
            const rows = await db.withClubTx({ clubId: A, userId: null, roles, source: 'admin', reason: 'qa probe' }, async (tx) => (await tx.query(sql, params)).rows);
            const found = leaks(rows);
            if (found.length > 0) leaked.push(`${f.s}.${f.name}(${f.args}) as [${roles}] with ${id}: returned club B data`);
          } catch {
            // A refusal is the right answer.
          }
        }
      }
    }
    const after = await fingerprint();
    const changed = Object.keys(before).filter((t) => before[t] !== after[t]);
    console.log(`definer probe: ${fns.length} functions, ${calls} calls, ${skipped} skipped (argument types the probe cannot fill)`);
    expect(leaked).toEqual([]);
    expect(changed, 'club B rows changed by a call made in club A\'s context').toEqual([]);
  }, 280_000);
});

// ---------------------------------------------------------------------------------------------------------------
const views = await q(
  `select n.nspname as s, c.relname as name, c.oid, c.relkind, coalesce(c.reloptions::text, '') as opts, pg_get_viewdef(c.oid) as def
     from pg_class c join pg_namespace n on n.oid = c.relnamespace where c.relkind in ('v','m') and n.nspname in ${SCHEMAS} order by 1, 2`,
);

describe('views', () => {
  const full = (v: Record<string, any>) => `${v.s}.${v.name}`; // eslint-disable-line @typescript-eslint/no-explicit-any

  /** Relations a view reads from, one level down (pg_depend through the rewrite rule). */
  const sources = async (oid: number) =>
    (
      await q(
        `select distinct n.nspname || '.' || c.relname as rel, c.relkind from pg_depend d join pg_rewrite r on r.oid = d.objid join pg_class c on c.oid = d.refobjid join pg_namespace n on n.oid = c.relnamespace
          where r.ev_class = $1::oid and d.refobjid <> $1::oid and c.relkind in ('r','p','v','m')`,
        [oid],
      )
    ).map((r) => ({ rel: r.rel as string, kind: r.relkind as string }));

  it('there are views to check', () => {
    expect(views.length).toBeGreaterThan(5);
  });

  it('every view is security_invoker, or filters by app.club_id(), or is built on a view that does', async () => {
    const ok = new Set(views.filter((v) => /security_invoker=true/.test(v.opts as string) || /app\.club_id\(\)/.test(v.def as string)).map(full));
    const bad: string[] = [];
    for (const v of views) {
      if (ok.has(full(v))) continue;
      // Built on a filtered view (for example package_status joins package_balance): the join can only keep rows the
      // filtered view returns. This is a shortcut, not a proof; the behavioural test below is the proof.
      const src = await sources(v.oid as number);
      if (!src.some((s) => s.kind === 'v' && ok.has(s.rel))) bad.push(full(v));
    }
    expect(bad, 'a view that runs with its owner rights and does not filter by the club').toEqual([]);
  });

  it('PUBLIC, anon and authenticated may select no view', async () => {
    const bad: string[] = [];
    for (const v of views) {
      const r = (await q(`select has_table_privilege('anon', $1::oid, 'select') a, has_table_privilege('authenticated', $1::oid, 'select') b`, [v.oid]))[0]!;
      if (r.a || r.b) bad.push(full(v));
    }
    expect(bad).toEqual([]);
  });

  it('a view the platform role may read is built on setup or platform tables only, never on club data (class D)', async () => {
    const bad: string[] = [];
    const walk = async (oid: number, seen = new Set<number>()): Promise<string[]> => {
      if (seen.has(oid)) return [];
      seen.add(oid);
      const out: string[] = [];
      for (const s of await sources(oid)) {
        if (s.kind === 'v' || s.kind === 'm') out.push(...(await walk((await q(`select $1::regclass::oid as o`, [s.rel]))[0]!.o as number, seen)));
        else if (registry[s.rel]?.class === 'D') out.push(s.rel);
      }
      return out;
    };
    for (const v of views) {
      const canRead = (await q(`select has_table_privilege('booq_platform', $1::oid, 'select') as ok`, [v.oid]))[0]!.ok as boolean;
      if (!canRead) continue;
      const d = await walk(v.oid as number);
      if (d.length > 0) bad.push(`${full(v)} reads class D: ${[...new Set(d)].join(', ')}`);
    }
    expect(bad).toEqual([]);
  });

  it('a club A context reads no club B row through any view, in any role set; no context reads nothing', async () => {
    const problems: string[] = [];
    for (const v of views) {
      const canApp = (await q(`select has_table_privilege('booq_app', $1::oid, 'select') as ok`, [v.oid]))[0]!.ok as boolean;
      if (!canApp) continue;
      for (const roles of [[], ['guest'], ['player'], ['coach', 'player'], ['front_desk', 'player'], ['accountant', 'player'], ['owner', 'player']]) {
        try {
          const rows = await db.withClubTx({ clubId: A, userId: null, roles, source: 'admin' }, async (tx) => (await tx.query(`select * from ${full(v)}`)).rows);
          const found = leaks(rows);
          if (found.length > 0) problems.push(`${full(v)} as [${roles}] returned club B data`);
          const text = JSON.stringify(rows);
          if ([...bIds].some((id) => id !== B && text.includes(id)) || text.includes(B)) problems.push(`${full(v)} as [${roles}] returned a club B id`);
        } catch {
          // permission denied for this role set is isolated
        }
      }
      const c = await tdb.pool.connect();
      try {
        await c.query('begin');
        await c.query('set local role booq_app');
        try {
          const r = await c.query(`select * from ${full(v)}`);
          if ((r.rowCount ?? 0) > 0) problems.push(`${full(v)} returned rows with no club context`);
        } catch {
          // denied
        }
      } finally {
        await c.query('rollback').catch(() => undefined);
        c.release();
      }
    }
    expect(problems).toEqual([]);
  });
});
