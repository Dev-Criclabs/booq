// F12-T09 access suite (QA), kept in tests/ because QA edits tests/** only (the task names packages/db/src/f12-access.test.ts). IDs: CC-1, CC-2, PLAT-02.
// Which role reads or writes which F12 table and function, from the grants of a migrated database. Behaviour of the guards and the policies is in
// packages/db/src/coach-attendance-note.test.ts (read by owner and front desk only, no app role writes, a mark is never deleted, audited, test rows follow the coach).
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestDatabase, type TestDatabase } from '../../packages/db/src/testing/harness';

let tdb: TestDatabase;
beforeAll(async () => {
  tdb = await createTestDatabase();
}, 120_000);
afterAll(async () => {
  await tdb?.close();
});

const TABLES = ['coach_attendance', 'coach_note'];
const PRIVS = ['select', 'insert', 'update', 'delete', 'truncate'];
const priv = async (role: string, table: string, p: string) => (await tdb.query(`select has_table_privilege($1, $2, $3) as ok`, [role, `public.${table}`, p])).rows[0].ok as boolean;
/** The portal functions, by who may run them: the coach portal calls through booq_app; the helpers (portal_*) are for the definer functions only. */
const APP_FUNCTIONS = ['coach_day(date)', 'coach_schedule(date,date)', 'coach_session(text,uuid)', 'mark_attendance(uuid,text)', 'save_session_note(text,uuid,uuid,text)'];
const INTERNAL_FUNCTIONS = ['portal_coach()', 'portal_mark_state(uuid,timestamp with time zone,timestamp with time zone)', 'portal_sessions(uuid,timestamp with time zone,timestamp with time zone)', 'coach_attendance_guard()', 'coach_note_guard()'];
const exec = async (role: string, f: string) => (await tdb.query(`select has_function_privilege($1, $2::regprocedure, 'execute') as ok`, [role, `app.${f}`])).rows[0].ok as boolean;

describe('F12-T09 the F12 tables (CC-1, CC-2, PLAT-02)', () => {
  it('anon, authenticated, the platform role and the worker hold nothing on a mark or a note', async () => {
    for (const t of TABLES) for (const role of ['anon', 'authenticated', 'booq_platform', 'booq_worker']) for (const p of PRIVS) expect(await priv(role, t, p), `${role} ${p} on ${t}`).toBe(false);
  });
  it('the app role reads both (the row policies decide who sees a row) and writes neither: a mark and a note are written only by the portal functions', async () => {
    for (const t of TABLES) {
      expect(await priv('booq_app', t, 'select'), `booq_app select on ${t}`).toBe(true);
      for (const p of ['insert', 'update', 'delete', 'truncate']) expect(await priv('booq_app', t, p), `booq_app ${p} on ${t}`).toBe(false);
    }
  });
  it('both tables are club data with row security forced, so a role that may read still sees only its club', async () => {
    for (const t of TABLES) {
      const r = (await tdb.query(`select relrowsecurity as on, relforcerowsecurity as forced from pg_class where oid = $1::regclass`, [`public.${t}`])).rows[0];
      expect(r, t).toEqual({ on: true, forced: true });
    }
  });
});

describe('F12-T09 the F12 functions', () => {
  it('the portal functions run for the app role only; none for anon, authenticated, the platform role or the worker', async () => {
    for (const f of APP_FUNCTIONS) {
      expect(await exec('booq_app', f), `booq_app ${f}`).toBe(true);
      for (const role of ['anon', 'authenticated', 'booq_platform', 'booq_worker']) expect(await exec(role, f), `${role} ${f}`).toBe(false);
    }
  });
  it('the helpers and the guards run for nobody but the function owner', async () => {
    for (const f of INTERNAL_FUNCTIONS) for (const role of ['anon', 'authenticated', 'booq_platform', 'booq_worker', 'booq_app']) expect(await exec(role, f), `${role} ${f}`).toBe(false);
  });
  it('a new function of the coach portal must be listed here: every app function named coach_*, portal_*, mark_attendance or save_session_note is known', async () => {
    const names = (await tdb.query(`select p.oid::regprocedure::text as f from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'app' and p.proname ~ '^(portal_|coach_day|coach_schedule|coach_session|mark_attendance|save_session_note|coach_attendance_guard|coach_note_guard)'`)).rows.map((r) => (r.f as string).replace(/^app\./, ''));
    expect(names.filter((f) => ![...APP_FUNCTIONS, ...INTERNAL_FUNCTIONS].includes(f)), 'a portal function this suite does not know').toEqual([]);
  });
});
