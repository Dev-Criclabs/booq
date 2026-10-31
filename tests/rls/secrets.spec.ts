// Secrets (D27, D32, D34, D149, SR-03; PLAT-02-AC8, PDPA-01-AC9): stored secrets are write-only. A secret is an envelope made
// in the application (ciphertext starting "booq1."); the database never holds a plaintext, never returns the ciphertext to a
// table reader, and lets each caller role read only the kinds its function serves. Runs on a scratch database with every
// CHECK constraint in place (the constraints are part of what is tested).
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createPlatformDb, type PlatformDb } from '../../packages/db/src/platform-tx';
import { createTestDatabase, type TestDatabase } from '../../packages/db/src/testing/harness';
import { createDb, type Db } from '../../packages/db/src/tx';

const A = '3f2b8f0e-7c1d-4a55-9d0a-1c2e3f4a5b6c';
const B = '9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d';
const OWNER_A = '11111111-1111-4111-8111-111111111111';
const DESK_A = '22222222-2222-4222-8222-222222222222';
const PLAYER_A = '44444444-4444-4444-8444-444444444444';
const OWNER_B = '55555555-5555-4555-8555-555555555555';

const KINDS = ['line_channel_token', 'line_channel_secret', 'line_login_secret', 'beam_api_key_test', 'beam_hmac_key_test', 'beam_api_key_live', 'beam_hmac_key_live'];
/** What apps/web (booq_app) may read through app.read_secret (D149); everything else is worker only. */
const WEB_KINDS = ['beam_api_key_test', 'beam_hmac_key_test', 'beam_api_key_live', 'beam_hmac_key_live', 'line_channel_secret'];
const WORKER_ONLY = KINDS.filter((k) => !WEB_KINDS.includes(k));
const mark = (club: string, kind: string) => `booq1.QAMARK-${club.slice(0, 4)}-${kind}`;

let tdb: TestDatabase;
let app: Db;
let worker: Db;
let pdb: PlatformDb;
let staff: string;

const ctx = (club: string, userId: string | null, roles: string[]) => ({ clubId: club, userId, roles: roles as never, source: 'admin' as const });
const ownerA = ctx(A, OWNER_A, ['owner', 'player']);
const ownerB = ctx(B, OWNER_B, ['owner', 'player']);
const on = <T = Record<string, any>>(db: Db, c: ReturnType<typeof ctx>, sql: string, params: unknown[] = []) => // eslint-disable-line @typescript-eslint/no-explicit-any
  db.withClubTx(c, async (tx) => (await tx.query(sql, params)).rows as T[]);
const code = async (p: Promise<unknown>) => {
  try {
    await p;
    return 'ok';
  } catch (e) {
    return (e as { code?: string }).code ?? 'error';
  }
};

async function person(club: string, id: string, line: string, roles: string[]) {
  // The roles rule is checked at commit, so the person and the roles go in one transaction.
  const c = await tdb.pool.connect();
  try {
    await c.query('begin');
    await c.query(`insert into public.app_user (club_id, id, line_user_id, display_name) values ($1,$2,$3,$4)`, [club, id, line, `Name ${line}`]);
    for (const r of roles) await c.query(`insert into public.app_user_role (club_id, user_id, role) values ($1,$2,$3)`, [club, id, r]);
    await c.query('commit');
  } finally {
    c.release();
  }
}

beforeAll(async () => {
  tdb = await createTestDatabase();
  await tdb.query(`insert into public.club (id, slug, name_th, name_en, status) values ($1,'a','ก','A','live'), ($2,'b','ข','B','live')`, [A, B]);
  await person(A, OWNER_A, 'L1', ['owner', 'player']);
  await person(A, DESK_A, 'L2', ['front_desk', 'player']);
  await person(A, PLAYER_A, 'L3', ['player']);
  await person(B, OWNER_B, 'L4', ['owner', 'player']);
  app = createDb({ connectionString: tdb.url, max: 2 });
  worker = createDb({ connectionString: tdb.url, max: 2, role: 'booq_worker' });
  pdb = createPlatformDb({ connectionString: tdb.url, max: 2 });
  staff = (await tdb.query(`insert into platform.platform_staff (auth_user_id, email, display_name, role) values (gen_random_uuid(), 'a@booq.example', 'Admin', 'platform_admin') returning id`)).rows[0]!.id as string;
  for (const [club, owner] of [[A, ownerA], [B, ownerB]] as const) {
    for (const k of KINDS) await on(app, owner, `select app.write_secret($1, $2, 'key-1', 'abcd')`, [k, mark(club, k)]);
  }
  // Mutation check (by hand, tests/rls/README.md): QA_MUTATE_SQL runs one statement as the admin; the suite must go red.
  if (process.env.QA_MUTATE_SQL) await tdb.query(process.env.QA_MUTATE_SQL);
});
afterAll(async () => {
  await app.end();
  await worker.end();
  await pdb.end();
  await tdb.close();
});

describe('writing', () => {
  it('only an owner of the club writes a secret; every other role and a context with no user is refused', async () => {
    for (const c of [ctx(A, DESK_A, ['front_desk', 'player']), ctx(A, PLAYER_A, ['player']), ctx(A, null, ['guest']), ctx(A, null, ['owner', 'player'])]) {
      expect(await code(on(app, c, `select app.write_secret('beam_api_key_test', 'booq1.x', 'key-1', 'abcd')`)), JSON.stringify(c.roles)).toBe('42501');
    }
  });

  it('a plaintext value is refused by the database: the ciphertext must be an envelope', async () => {
    expect(await code(on(app, ownerA, `select app.write_secret('beam_api_key_test', 'sk_live_plaintext', 'key-1', 'abcd')`))).toBe('23514');
    expect(await code(tdb.query(`insert into public.club_secret (club_id, kind, ciphertext, key_id, written_by_staff) values ($1, 'beam_api_key_test', 'plaintext', 'k', $2) on conflict (club_id, kind) do update set ciphertext = excluded.ciphertext`, [A, staff]))).toBe('23514');
  });

  it('an unknown kind and a tail longer than four characters are refused', async () => {
    expect(await code(on(app, ownerA, `select app.write_secret('password', 'booq1.x', 'key-1', 'abcd')`))).toBe('23514');
    expect(await code(on(app, ownerA, `select app.write_secret('beam_api_key_test', 'booq1.x', 'key-1', 'abcde')`))).toBe('P0001');
  });

  it('only the last four characters are kept for display, per kind', async () => {
    const r = await on<{ secret_last4: Record<string, string> }>(app, ownerA, `select secret_last4 from public.payment_connection`);
    expect(r[0]!.secret_last4['beam_api_key_test']).toBe('abcd');
    expect(Object.values(r[0]!.secret_last4).every((v) => v.length <= 4)).toBe(true);
  });

  it('a value is never written to the audit log or to P6: not the ciphertext, and not the plaintext tail beyond four characters', async () => {
    const audit = JSON.stringify((await tdb.query(`select * from public.audit_entry`)).rows);
    const p6 = JSON.stringify((await tdb.query(`select * from platform.audit_log`)).rows);
    expect(audit).not.toContain('QAMARK');
    expect(p6).not.toContain('QAMARK');
    // The write itself is audited (as an event), so the marker test above is not passing on an empty log.
    expect((await tdb.query(`select count(*)::int as n from public.audit_entry where record_type = 'club_secret'`)).rows[0]!.n).toBeGreaterThan(0);
  });
});

describe('reading the table', () => {
  it('no role set of the application role can select the ciphertext, by name or with select *', async () => {
    for (const roles of [[], ['guest'], ['player'], ['front_desk', 'player'], ['accountant', 'player'], ['owner', 'player']]) {
      expect(await code(on(app, ctx(A, OWNER_A, roles), 'select ciphertext from public.club_secret')), `[${roles}] ciphertext`).toBe('42501');
      expect(await code(on(app, ctx(A, OWNER_A, roles), 'select * from public.club_secret')), `[${roles}] *`).toBe('42501');
      expect(await code(on(app, ctx(A, OWNER_A, roles), 'select written_by_staff from public.club_secret')), `[${roles}] who wrote it`).toBe('42501');
    }
  });

  it('the owner sees which secrets exist for their own club (kind, key id, time) and no other club', async () => {
    const rows = await on(app, ownerA, 'select club_id, kind, key_id from public.club_secret order by kind');
    expect(rows.map((r) => r.kind)).toEqual([...KINDS].sort());
    expect(new Set(rows.map((r) => r.club_id))).toEqual(new Set([A]));
  });

  it('front desk, accountant, coach and player see no secret row at all', async () => {
    for (const roles of [['front_desk', 'player'], ['accountant', 'player'], ['coach', 'player'], ['player'], ['guest']]) {
      expect(await on(app, ctx(A, DESK_A, roles), 'select kind from public.club_secret'), `[${roles}]`).toEqual([]);
    }
  });

  it('the worker and the platform role have no privilege on the table or on the ciphertext column', async () => {
    for (const role of ['booq_worker', 'booq_platform', 'anon', 'authenticated']) {
      const r = (await tdb.query(`select has_table_privilege($1, 'public.club_secret', 'select') t, has_column_privilege($1, 'public.club_secret', 'ciphertext', 'select') c`, [role])).rows[0]!;
      expect(r.t, `${role} table`).toBe(false);
      expect(r.c, `${role} ciphertext`).toBe(false);
    }
    expect((await tdb.query(`select has_column_privilege('booq_app', 'public.club_secret', 'ciphertext', 'select') c`)).rows[0]!.c).toBe(false);
  });

  it('the platform role cannot read a secret back, even for a club it can edit', async () => {
    await expect(pdb.withPlatformTx({ staffId: staff, staffLabel: 'Admin', clubId: A }, (tx) => tx.query('select ciphertext from public.club_secret'))).rejects.toMatchObject({ code: '42501' });
    await expect(pdb.withPlatformTx({ staffId: staff, staffLabel: 'Admin', clubId: A }, (tx) => tx.query(`select app.read_secret('beam_api_key_test')`))).rejects.toMatchObject({ code: '42501' });
    await expect(pdb.withPlatformTx({ staffId: staff, staffLabel: 'Admin', clubId: A }, (tx) => tx.query(`select app.read_secret_worker('beam_api_key_test')`))).rejects.toMatchObject({ code: '42501' });
  });
});

describe('reading through the functions (D149)', () => {
  it('apps/web reads the Beam keys and the LINE channel secret, and is refused the LINE token and the login secret', async () => {
    for (const k of WEB_KINDS) {
      const r = await on<{ v: string }>(app, ownerA, `select app.read_secret($1) as v`, [k]);
      expect(r[0]!.v, k).toBe(mark(A, k));
    }
    for (const k of WORKER_ONLY) expect(await code(on(app, ownerA, `select app.read_secret($1)`, [k])), k).toBe('42501');
  });

  it('the worker reads every kind through its own function', async () => {
    for (const k of KINDS) {
      const r = await on<{ v: string }>(worker, ownerA, `select app.read_secret_worker($1) as v`, [k]);
      expect(r[0]!.v, k).toBe(mark(A, k));
    }
  });

  it('each role may execute only its own reader; nobody may execute the internal one', async () => {
    expect(await code(on(app, ownerA, `select app.read_secret_worker('line_channel_token')`)), 'web calls the worker reader').toBe('42501');
    expect(await code(on(worker, ownerA, `select app.read_secret('beam_api_key_test')`)), 'worker calls the web reader').toBe('42501');
    expect(await code(on(app, ownerA, `select app.read_secret_internal('line_channel_token', array['line_channel_token'])`)), 'web calls the internal reader').toBe('42501');
    expect(await code(on(worker, ownerA, `select app.read_secret_internal('line_channel_token', array['line_channel_token'])`)), 'worker calls the internal reader').toBe('42501');
    expect(await code(on(app, ownerA, `select app.write_secret('beam_api_key_test','booq1.x','k','abcd')`)), 'sanity: the owner can still write').toBe('ok');
    expect(await code(on(worker, ownerA, `select app.write_secret('beam_api_key_test','booq1.x','k','abcd')`)), 'worker writes a secret').toBe('42501');
  });

  it('a read returns the secret of the club in the context only', async () => {
    const a = await on<{ v: string }>(app, ownerA, `select app.read_secret('beam_hmac_key_live') as v`);
    const b = await on<{ v: string }>(app, ownerB, `select app.read_secret('beam_hmac_key_live') as v`);
    expect(a[0]!.v).toBe(mark(A, 'beam_hmac_key_live'));
    expect(b[0]!.v).toBe(mark(B, 'beam_hmac_key_live'));
    expect(JSON.stringify(a)).not.toContain('-' + B.slice(0, 4) + '-');
  });

  it('with no club in the context a read fails and returns nothing', async () => {
    const c = await tdb.pool.connect();
    try {
      await c.query('begin');
      await c.query('set local role booq_app');
      await expect(c.query(`select app.read_secret('beam_api_key_test')`)).rejects.toMatchObject({ code: 'P0001' });
    } finally {
      await c.query('rollback').catch(() => undefined);
      c.release();
    }
  });

  it('a read is counted per kind, as a number only', async () => {
    const before = Number((await tdb.query(`select reads from public.club_secret_read where club_id = $1 and kind = 'beam_api_key_live'`, [A])).rows[0]?.reads ?? 0);
    await on(app, ownerA, `select app.read_secret('beam_api_key_live')`);
    const after = Number((await tdb.query(`select reads from public.club_secret_read where club_id = $1 and kind = 'beam_api_key_live'`, [A])).rows[0]!.reads);
    expect(after).toBe(before + 1);
    const cols = (await tdb.query(`select column_name from information_schema.columns where table_schema = 'public' and table_name = 'club_secret_read' order by 1`)).rows.map((r) => r.column_name);
    expect(cols).toEqual(['club_id', 'kind', 'last_read_at', 'reads']);
  });
});

describe('writing by BOOQ staff', () => {
  const C = 'c0c0c0c0-7c1d-4a55-9d0a-1c2e3f4a5b6c';
  const asStaff = (club: string, sql: string) => pdb.withPlatformTx({ staffId: staff, staffLabel: 'Admin', clubId: club }, (tx) => tx.query(sql));

  it('a platform write works while the club is Draft, is read back by the application as the same envelope, and never reaches an audit log', async () => {
    await tdb.query(`insert into public.club (id, slug, name_th, name_en, status) values ($1, 'c', 'ค', 'C', 'draft')`, [C]);
    await asStaff(C, `select platform.write_secret('beam_api_key_test', 'booq1.QAMARK-staff', 'key-2', 'wxyz')`);
    const read = await on<{ v: string }>(app, ctx(C, null, ['guest']), `select app.read_secret('beam_api_key_test') as v`);
    expect(read[0]!.v).toBe('booq1.QAMARK-staff');
    const last4 = await asStaff(C, `select secret_last4 from public.payment_connection where club_id = '${C}'`);
    expect(last4.rows[0]!.secret_last4).toEqual({ beam_api_key_test: 'wxyz' });
    const logs = JSON.stringify((await tdb.query(`select * from public.audit_entry`)).rows) + JSON.stringify((await tdb.query(`select * from platform.audit_log`)).rows);
    expect(logs).not.toContain('QAMARK-staff');
  });

  it('a Live club is look only for a platform write unless the owner opened the window', async () => {
    await tdb.query(`update public.club set allow_booq_changes_until = null where id = $1`, [B]);
    await expect(asStaff(B, `select platform.write_secret('beam_api_key_test', 'booq1.QAMARK-live', 'key-2', 'wxyz')`)).rejects.toMatchObject({ code: '42501' });
    const v = (await on<{ v: string }>(app, ownerB, `select app.read_secret('beam_api_key_test') as v`))[0]!.v;
    expect(v).toBe(mark(B, 'beam_api_key_test'));
  });

  it('a specialist not assigned to the club cannot write: the club looks missing', async () => {
    const spec = (await tdb.query(`insert into platform.platform_staff (auth_user_id, email, display_name, role) values (gen_random_uuid(), 's@booq.example', 'Spec', 'onboarding_specialist') returning id`)).rows[0]!.id as string;
    await expect(pdb.withPlatformTx({ staffId: spec, staffLabel: 'Spec', clubId: C }, (tx) => tx.query(`select platform.write_secret('beam_api_key_test', 'booq1.QAMARK-x', 'k', 'abcd')`))).rejects.toMatchObject({ code: 'P0001' });
  });
});
