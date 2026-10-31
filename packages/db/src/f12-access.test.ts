import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestDatabase, type TestDatabase } from './testing/harness';

// F12-T09: who may touch the F12 tables and functions, pinned in one place so a later migration cannot widen it unseen (CC-1, CC-2, PLAT-02).
// The row level behaviour of each function is tested with its migration; this is the grant and class picture.
let tdb: TestDatabase;
beforeEach(async () => {
  tdb = await createTestDatabase();
});
afterEach(async () => {
  await tdb.close();
});

const ENTRY_POINTS = [
  'app.coach_day(date)', 'app.coach_schedule(date,date)', 'app.coach_session(text,uuid)', 'app.mark_attendance(uuid,text)', 'app.save_session_note(text,uuid,uuid,text)',
  'app.my_earnings(date)', 'app.my_payout_history()', 'app.my_payout_adjustments(date)', 'app.coach_rest_cap()', 'app.f12_export(uuid)',
];
const INTERNAL = [
  'app.portal_coach()', 'app.portal_sessions(uuid,timestamp with time zone,timestamp with time zone)', 'app.portal_mark_state(uuid,timestamp with time zone,timestamp with time zone)',
  'app.f12_notify_coach()', 'app.f12_notify_coach_add()', 'app.coach_attendance_guard()', 'app.coach_note_guard()',
  'app.f12_deletion_impact(uuid,uuid)', 'app.f12_anonymise(uuid,uuid)',
];
const TABLES = ['coach_attendance', 'coach_note'];

describe('the F12 functions', () => {
  it('the ten entry points exist, are owned by the table owner and run only for the app role', async () => {
    for (const f of ENTRY_POINTS) {
      const r = (await tdb.query(`select pg_get_userbyid(p.proowner) as owner, p.prosecdef as definer from pg_proc p where p.oid = $1::regprocedure`, [f])).rows[0];
      expect(r, f).toEqual({ owner: 'booq_owner', definer: true });
      expect((await tdb.query(`select has_function_privilege('booq_app', $1, 'execute') as ok`, [f])).rows[0].ok, `booq_app ${f}`).toBe(true);
      for (const role of ['booq_worker', 'booq_platform', 'anon', 'authenticated']) {
        expect((await tdb.query(`select has_function_privilege($1, $2, 'execute') as ok`, [role, f])).rows[0].ok, `${role} ${f}`).toBe(false);
      }
    }
  });
  it('the helpers and trigger functions are internal: no app, worker or BOOQ role may run them', async () => {
    for (const f of INTERNAL) {
      expect((await tdb.query(`select pg_get_userbyid(p.proowner) as owner from pg_proc p where p.oid = $1::regprocedure`, [f])).rows[0].owner, f).toBe('booq_owner');
      for (const role of ['booq_app', 'booq_worker', 'booq_platform', 'anon', 'authenticated']) {
        expect((await tdb.query(`select has_function_privilege($1, $2, 'execute') as ok`, [role, f])).rows[0].ok, `${role} ${f}`).toBe(false);
      }
    }
  });
  it('no other function of the portal exists that this list does not name', async () => {
    const named = new Set([...ENTRY_POINTS, ...INTERNAL].map((f) => f.split('(')[0]!.replace('app.', '')));
    const found = (await tdb.query(
      `select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'app' and (p.proname like 'portal\\_%' or p.proname like 'f12\\_%' or p.proname in ('coach_day', 'coach_schedule', 'coach_session', 'mark_attendance', 'save_session_note', 'my_earnings', 'my_payout_history', 'my_payout_adjustments', 'coach_rest_cap', 'coach_attendance_guard', 'coach_note_guard'))`)).rows.map((r) => r.proname as string);
    for (const f of found) expect(named.has(f), `${f} is not in the access list`).toBe(true);
  });
});

describe('the F12 tables', () => {
  it('are class D with row level security forced; the app role may only select; nobody else reads or writes', async () => {
    for (const t of TABLES) {
      const r = (await tdb.query(`select c.relrowsecurity as rls, c.relforcerowsecurity as forced, pg_get_userbyid(c.relowner) as owner from pg_class c where c.oid = $1::regclass`, [`public.${t}`])).rows[0];
      expect(r, t).toEqual({ rls: true, forced: true, owner: 'booq_owner' });
      expect((await tdb.query(`select has_table_privilege('booq_app', $1, 'select') as ok`, [`public.${t}`])).rows[0].ok, `booq_app select ${t}`).toBe(true);
      for (const role of ['booq_app', 'booq_worker', 'booq_platform', 'anon', 'authenticated']) {
        expect((await tdb.query(`select has_table_privilege($1, $2, 'insert,update,delete,truncate') as ok`, [role, `public.${t}`])).rows[0].ok, `${role} write ${t}`).toBe(false);
      }
      for (const role of ['booq_worker', 'booq_platform', 'anon', 'authenticated']) {
        expect((await tdb.query(`select has_table_privilege($1, $2, 'select') as ok`, [role, `public.${t}`])).rows[0].ok, `${role} select ${t}`).toBe(false);
      }
    }
  });
  it('the tenant policy is restrictive on both and no policy lets the coach role read them', async () => {
    for (const t of TABLES) {
      const p = (await tdb.query(`select policyname, permissive, roles::text as roles, cmd, qual from pg_policies where schemaname = 'public' and tablename = $1 order by policyname`, [t])).rows;
      expect(p.find((x) => x.policyname === `${t}_tenant`)).toMatchObject({ permissive: 'RESTRICTIVE' });
      const staff = p.find((x) => x.policyname === `${t}_staff_read`);
      expect(staff.qual).toContain('owner');
      expect(staff.qual).toContain('front_desk');
      expect(staff.qual).not.toMatch(/coach|accountant|player/);
    }
  });
});
