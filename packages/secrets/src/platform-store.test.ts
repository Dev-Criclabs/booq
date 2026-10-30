import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createDb, type Db } from '../../db/src/tx';
import { createTestDatabase, type TestDatabase } from '../../db/src/testing/harness';
import { generateKeyPair } from './envelope';
import { readSecret, writeSecretAsStaff } from './store';

// F01-T09 follow-up / migration 0015: BOOQ staff and the secrets (PLAT-02-AC8, D27, SR-02, SR-03).
const A = '3f2b8f0e-7c1d-4a55-9d0a-1c2e3f4a5b6c';
const B = '9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d';
const OWNER = '11111111-1111-4111-8111-111111111111';
const ADMIN = '77777777-7777-4777-8777-777777777771';
const SPEC = '77777777-7777-4777-8777-777777777772';
const OTHER_SPEC = '77777777-7777-4777-8777-777777777773';
const MARKER = 'MARKER-sk_live_staffwrote9876';
const keys = generateKeyPair();

interface PoolClient {
  query(text: string, params?: unknown[]): Promise<{ rows: Record<string, any>[]; rowCount: number | null }>; // eslint-disable-line @typescript-eslint/no-explicit-any
  release(): void;
}
let tdb: TestDatabase;
let web: Db;

beforeEach(async () => {
  tdb = await createTestDatabase();
  await tdb.query(`insert into public.club (id, slug, name_th, name_en, status) values ($1,'a','ก','A','testing'), ($2,'b','ข','B','testing')`, [A, B]);
  await tdb.query(`insert into platform.platform_staff (id, auth_user_id, email, display_name, role) values
    ($1, gen_random_uuid(), 'a@booq.test', 'Ann', 'platform_admin'), ($2, gen_random_uuid(), 's@booq.test', 'Sam', 'onboarding_specialist'), ($3, gen_random_uuid(), 'o@booq.test', 'Oli', 'onboarding_specialist')`, [ADMIN, SPEC, OTHER_SPEC]);
  await tdb.query(`insert into platform.staff_assignment (staff_id, club_id) values ($1, $2)`, [SPEC, A]);
  const c = (await tdb.pool.connect()) as unknown as PoolClient;
  try {
    await c.query('begin');
    await c.query('insert into public.app_user (club_id, id, line_user_id) values ($1,$2,$3)', [A, OWNER, 'L1']);
    await c.query(`insert into public.app_user_role (club_id, user_id, role) values ($1,$2,'owner'), ($1,$2,'player')`, [A, OWNER]);
    await c.query('commit');
  } finally {
    c.release();
  }
  web = createDb({ connectionString: tdb.url, max: 2 });
});
afterEach(async () => {
  await web.end();
  await tdb.close();
});

/** What withPlatformTx does: booq_platform, the staff member, the label and the club, as transaction settings. */
async function asStaff<T>(staff: string, label: string, club: string, fn: (c: PoolClient) => Promise<T>): Promise<T> {
  const c = (await tdb.pool.connect()) as unknown as PoolClient;
  try {
    await c.query('begin');
    await c.query('set local role booq_platform');
    await c.query(`select set_config('app.actor_platform_staff_id', $1, true), set_config('app.actor_label', $2, true), set_config('app.club_id', $3, true)`, [staff, label, club]);
    const out = await fn(c);
    await c.query('commit');
    return out;
  } catch (e) {
    await c.query('rollback');
    throw e;
  } finally {
    c.release();
  }
}
const put = (staff: string, club: string, kind: Parameters<typeof writeSecretAsStaff>[3] = 'beam_api_key_test', value = MARKER) =>
  asStaff(staff, 'BOOQ staff: x', club, (c) => writeSecretAsStaff(c as never, keys.publicKey, club, kind, value));

describe('staff write secrets, write-only', () => {
  it('an assigned specialist and an admin write in Testing; the value is ciphertext, the tail is kept', async () => {
    await put(SPEC, A);
    await put(ADMIN, B, 'line_channel_token', 'channel-token-1234');
    expect(JSON.stringify((await tdb.query('select * from public.club_secret')).rows)).not.toContain(MARKER);
    expect((await tdb.query('select secret_last4 from public.payment_connection where club_id = $1', [A])).rows[0].secret_last4).toEqual({ beam_api_key_test: '9876' });
    expect((await tdb.query('select written_by_staff from public.club_secret where club_id = $1', [A])).rows[0].written_by_staff).toBe(SPEC);
  });
  it('the web app can decrypt what staff wrote (the platform app cannot)', async () => {
    await put(SPEC, A);
    const v = await web.withClubTx({ clubId: A, userId: null, roles: [], source: 'job' }, (tx) => readSecret(tx, keys.privateKey, A, 'beam_api_key_test'));
    expect(v).toBe(MARKER);
  });
  it('an unassigned specialist gets "not found", the same as a club that does not exist', async () => {
    await expect(put(OTHER_SPEC, A)).rejects.toThrow(/not found/);
    await expect(put(SPEC, B)).rejects.toThrow(/not found/);
    await expect(put(SPEC, '5c5c5c5c-5c5c-45c5-85c5-5c5c5c5c5c5c')).rejects.toThrow(/not found/);
  });
  it('a deactivated staff member and a call with no staff are refused', async () => {
    await tdb.query('update platform.platform_staff set active = false where id = $1', [SPEC]);
    await expect(put(SPEC, A)).rejects.toThrow(/not found/);
    const c = (await tdb.pool.connect()) as unknown as PoolClient;
    try {
      await c.query('begin');
      await c.query('set local role booq_platform');
      await c.query(`select set_config('app.club_id', $1, true)`, [A]);
      await expect(c.query(`select platform.write_secret('beam_api_key_test', 'booq1.x', 'k', 'abcd')`)).rejects.toThrow(/not found/);
      await c.query('rollback');
    } finally {
      c.release();
    }
  });
  it('staff cannot select the ciphertext or the table; no select on the secret tables at all', async () => {
    await put(SPEC, A);
    for (const sql of ['select ciphertext from public.club_secret', 'select * from public.club_secret', 'select * from public.club_secret_read']) {
      await expect(asStaff(ADMIN, 'x', A, (c) => c.query(sql)), sql).rejects.toThrow(/permission denied/);
    }
    await expect(asStaff(ADMIN, 'x', A, (c) => c.query(`update public.club_secret set key_id = 'x'`))).rejects.toThrow(/permission denied/);
  });
  it('a plaintext value is refused by the database', async () => {
    await expect(asStaff(SPEC, 'x', A, (c) => c.query(`select platform.write_secret('beam_api_key_test', 'plain-text', 'k', 'abcd')`))).rejects.toThrow(/is_envelope/);
    await expect(asStaff(SPEC, 'x', A, (c) => c.query(`select platform.write_secret('beam_api_key_test', 'booq1.x', 'k', '12345')`))).rejects.toThrow(/four characters/);
  });
  it('the app roles cannot call the staff function', async () => {
    for (const role of ['booq_app', 'booq_worker']) {
      expect((await tdb.query(`select has_function_privilege($1, 'platform.write_secret(text,text,text,text)', 'execute') as ok`, [role])).rows[0].ok, role).toBe(false);
    }
  });
});

describe('Live and Paused clubs are look only, until the owner opens the window (SR-02)', () => {
  it('refused on Live; allowed while the owner’s window is open; refused again after it closes; a notice is left', async () => {
    await tdb.query(`update public.club set status = 'live' where id = $1`, [A]);
    await expect(put(SPEC, A)).rejects.toThrow(/look only/);
    await tdb.query(`update public.club set allow_booq_changes_until = app.now() + interval '1 hour', allow_booq_changes_set_at = app.now() where id = $1`, [A]);
    await put(SPEC, A, 'beam_api_key_live', 'live-value-5555');
    const n = (await tdb.query('select kind, subject, by_staff_label, seen_at from public.owner_notice')).rows;
    expect(n).toEqual([{ kind: 'platform_change', subject: 'club_secret:beam_api_key_live', by_staff_label: 'BOOQ staff: x', seen_at: null }]);
    await tdb.advance('2 hours');
    await expect(put(SPEC, A)).rejects.toThrow(/look only/);
  });
  it('a Paused club is look only too', async () => {
    await tdb.query(`update public.club set status = 'paused' where id = $1`, [A]);
    await expect(put(SPEC, A)).rejects.toThrow(/look only/);
  });
  it('no notice in Draft or Testing', async () => {
    await put(SPEC, A);
    expect((await tdb.query('select count(*)::int as n from public.owner_notice')).rows[0].n).toBe(0);
  });
  it('a connection edit by staff on a Live club in the window leaves a notice too, and outside it changes nothing', async () => {
    await tdb.query(`update public.club set status = 'live' where id = $1`, [A]);
    const edit = () => asStaff(SPEC, 'BOOQ staff: Sam', A, (c) => c.query(`insert into public.line_connection (club_id, liff_id) values ($1,'1234-abcd') on conflict (club_id) do update set liff_id = excluded.liff_id`, [A]));
    await expect(edit()).rejects.toThrow(/row-level security/);
    await tdb.query(`update public.club set allow_booq_changes_until = app.now() + interval '1 hour', allow_booq_changes_set_at = app.now() where id = $1`, [A]);
    await edit();
    expect((await tdb.query('select subject from public.owner_notice')).rows).toEqual([{ subject: 'line_connection' }]);
  });
});

describe('the support view of connections (D27)', () => {
  it('staff read the connection with the masked tails and cannot write a tail', async () => {
    await put(SPEC, A);
    const r = await asStaff(SPEC, 'x', A, (c) => c.query('select secret_last4 from public.payment_connection'));
    expect(r.rows).toEqual([{ secret_last4: { beam_api_key_test: '9876' } }]);
    await expect(asStaff(SPEC, 'x', A, (c) => c.query(`update public.payment_connection set secret_last4 = '{}'`))).rejects.toThrow(/permission denied/);
  });
  it('an unassigned specialist sees no connection row; another club’s rows are invisible', async () => {
    await put(SPEC, A);
    await put(ADMIN, B, 'beam_api_key_test', 'other-club-value-1');
    expect((await asStaff(OTHER_SPEC, 'x', A, (c) => c.query('select 1 from public.payment_connection'))).rowCount).toBe(0);
    expect((await asStaff(SPEC, 'x', A, (c) => c.query('select club_id from public.payment_connection where club_id = $1', [B]))).rowCount).toBe(0);
    expect((await asStaff(ADMIN, 'x', A, (c) => c.query('select 1 from public.payment_connection'))).rowCount).toBe(2);
  });
  it('staff edit the non-secret columns in Testing (merchant ids, LINE ids)', async () => {
    await asStaff(SPEC, 'x', A, (c) => c.query(`insert into public.payment_connection (club_id, merchant_id_test) values ($1, 'm-test-1')`, [A]));
    await asStaff(SPEC, 'x', A, (c) => c.query(`update public.payment_connection set merchant_id_live = 'm-live-1'`));
    expect((await tdb.query('select merchant_id_test, merchant_id_live from public.payment_connection')).rows).toEqual([{ merchant_id_test: 'm-test-1', merchant_id_live: 'm-live-1' }]);
  });
});

describe('the owner’s notice board', () => {
  it('only the owner reads the notices and marks one seen; BOOQ staff never read them', async () => {
    await tdb.query(`update public.club set status = 'live', allow_booq_changes_until = app.now() + interval '1 hour', allow_booq_changes_set_at = app.now() where id = $1`, [A]);
    await put(SPEC, A);
    const owner = { clubId: A, userId: OWNER, roles: ['owner', 'player'], source: 'admin' as const };
    expect((await web.withClubTx(owner, (tx) => tx.query('select id from public.owner_notice'))).rowCount).toBe(1);
    expect((await web.withClubTx({ ...owner, roles: ['front_desk', 'player'] }, (tx) => tx.query('select id from public.owner_notice'))).rowCount).toBe(0);
    const seen = await web.withClubTx(owner, (tx) => tx.query(`update public.owner_notice set seen_at = now(), seen_by = $1`, [OWNER]));
    expect(seen.rowCount).toBe(1);
    await expect(web.withClubTx(owner, (tx) => tx.query(`update public.owner_notice set subject = 'x'`))).rejects.toThrow(/permission denied/);
    expect((await tdb.query(`select has_table_privilege('booq_platform', 'public.owner_notice', 'select') as ok`)).rows[0].ok).toBe(false);
  });
});
