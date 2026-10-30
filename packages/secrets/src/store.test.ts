import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createDb, type Db } from '../../db/src/tx';
import { createTestDatabase, type TestDatabase } from '../../db/src/testing/harness';
import { generateKeyPair } from './envelope';
import { readSecret, writeSecret } from './store';

// F01-T09: stored secrets (PLAT-02-AC8, PDPA-01-AC9, D27, D32, D34, SR-03).
const A = '3f2b8f0e-7c1d-4a55-9d0a-1c2e3f4a5b6c';
const B = '9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d';
const OWNER_A = '11111111-1111-4111-8111-111111111111';
const OWNER_B = '22222222-2222-4222-8222-222222222222';
const COACH = '33333333-3333-4333-8333-333333333333';
const MARKER = 'MARKER-sk_test_0123456789wxyz';
const keys = generateKeyPair();

let tdb: TestDatabase;
let web: Db;
let worker: Db;

beforeEach(async () => {
  tdb = await createTestDatabase();
  await tdb.query(`insert into public.club (id, slug, name_th, name_en) values ($1,'a','ก','A'), ($2,'b','ข','B')`, [A, B]);
  for (const [club, id, line, roles] of [[A, OWNER_A, 'L1', ['owner', 'player']], [B, OWNER_B, 'L2', ['owner', 'player']], [A, COACH, 'L3', ['coach', 'player']]] as const) {
    const c = await tdb.pool.connect();
    try {
      await c.query('begin');
      await c.query('insert into public.app_user (club_id, id, line_user_id) values ($1,$2,$3)', [club, id, line]);
      for (const r of roles) await c.query('insert into public.app_user_role (club_id, user_id, role) values ($1,$2,$3)', [club, id, r]);
      await c.query('commit');
    } finally {
      c.release();
    }
  }
  web = createDb({ connectionString: tdb.url, max: 2 });
  worker = createDb({ connectionString: tdb.url, max: 2, role: 'booq_worker' });
});
afterEach(async () => {
  await web.end();
  await worker.end();
  await tdb.close();
});

const owner = (club = A, user = OWNER_A) => ({ clubId: club, userId: user, roles: ['owner', 'player'], source: 'admin' as const });
const put = (kind: Parameters<typeof writeSecret>[3], value = MARKER, club = A, user = OWNER_A) =>
  web.withClubTx(owner(club, user), (tx) => writeSecret(tx, keys.publicKey, club, kind, value));
const read = (kind: Parameters<typeof readSecret>[3], club = A, via: 'web' | 'worker' = 'web') =>
  (via === 'web' ? web : worker).withClubTx({ clubId: club, userId: null, roles: [], source: 'job' }, (tx) => readSecret(tx, keys.privateKey, club, kind, via));

describe('a written secret is ciphertext, and only the last four show (PLAT-02-AC8, D27)', () => {
  it('the table holds an envelope, never the value; the audit entry holds a marker, not the value', async () => {
    await put('beam_api_key_live');
    const everything = JSON.stringify([
      (await tdb.query('select * from public.club_secret')).rows,
      (await tdb.query('select * from public.audit_entry')).rows,
      (await tdb.query('select * from public.payment_connection')).rows,
    ]);
    expect(everything).not.toContain(MARKER);
    expect(everything).not.toContain('sk_test_0123456789');
    const row = (await tdb.query('select ciphertext, key_id from public.club_secret')).rows[0];
    expect(row.ciphertext).toMatch(/^booq1\./);
    const entry = (await tdb.query(`select new_value from public.audit_entry where record_type = 'club_secret'`)).rows[0];
    expect(entry.new_value).toMatchObject({ ciphertext: 'set' });
  });

  it('the connection row keeps the last four characters per secret, and nothing more', async () => {
    await put('beam_api_key_live');
    await put('line_channel_token', 'tokentokentoken9876');
    expect((await tdb.query('select secret_last4 from public.payment_connection')).rows[0].secret_last4).toEqual({ beam_api_key_live: 'wxyz' });
    expect((await tdb.query('select secret_last4 from public.line_connection')).rows[0].secret_last4).toEqual({ line_channel_token: '9876' });
  });

  it('writing again replaces the secret and its tail', async () => {
    await put('beam_api_key_live');
    await put('beam_api_key_live', 'second-value-1234');
    expect(await read('beam_api_key_live')).toBe('second-value-1234');
    expect((await tdb.query('select secret_last4 from public.payment_connection')).rows[0].secret_last4).toEqual({ beam_api_key_live: '1234' });
    expect((await tdb.query('select count(*)::int as n from public.club_secret')).rows[0].n).toBe(1);
  });

  it('Beam keeps two sets side by side (D32)', async () => {
    await put('beam_api_key_test', 'test-value-aaaa');
    await put('beam_api_key_live', 'live-value-bbbb');
    expect(await read('beam_api_key_test')).toBe('test-value-aaaa');
    expect(await read('beam_api_key_live')).toBe('live-value-bbbb');
  });

  it('the database refuses a plaintext value, an unknown kind and more than four characters of tail', async () => {
    await expect(tdb.query(`insert into public.club_secret (club_id, kind, ciphertext, key_id, written_by_user) values ($1,'beam_api_key_live','plain','k',$2)`, [A, OWNER_A])).rejects.toThrow(/is_envelope/);
    await expect(tdb.query(`insert into public.club_secret (club_id, kind, ciphertext, key_id, written_by_user) values ($1,'other','booq1.x','k',$2)`, [A, OWNER_A])).rejects.toThrow(/kind_values/);
    await expect(web.withClubTx(owner(), (tx) => tx.query(`select app.write_secret('beam_api_key_live', 'booq1.x', 'k', '12345')`))).rejects.toThrow(/four characters/);
  });
});

describe('write-only grants (SR-03, D27)', () => {
  beforeEach(async () => {
    await put('beam_api_key_live');
  });
  it('booq_platform has no privilege on any secret table', async () => {
    for (const t of ['club_secret', 'club_secret_read', 'line_connection', 'payment_connection']) {
      for (const priv of ['select', 'insert', 'update', 'delete']) {
        expect((await tdb.query('select has_table_privilege($1, $2, $3) as ok', ['booq_platform', `public.${t}`, priv])).rows[0].ok, `${t} ${priv}`).toBe(false);
      }
    }
  });
  it('the app role cannot read the ciphertext column, directly or with select *', async () => {
    await expect(web.withClubTx(owner(), (tx) => tx.query('select ciphertext from public.club_secret'))).rejects.toThrow(/permission denied/);
    await expect(web.withClubTx(owner(), (tx) => tx.query('select * from public.club_secret'))).rejects.toThrow(/permission denied/);
    const meta = await web.withClubTx(owner(), (tx) => tx.query('select kind, key_id from public.club_secret'));
    expect(meta.rows).toHaveLength(1);
  });
  it('the app role cannot write the table directly; only the function', async () => {
    await expect(web.withClubTx(owner(), (tx) => tx.query(`update public.club_secret set key_id = 'x'`))).rejects.toThrow(/permission denied/);
    await expect(web.withClubTx(owner(), (tx) => tx.query(`delete from public.club_secret`))).rejects.toThrow(/permission denied/);
  });
  it('only the club owner may write a secret', async () => {
    const coach = { clubId: A, userId: COACH, roles: ['coach', 'player'], source: 'admin' as const };
    await expect(web.withClubTx(coach, (tx) => writeSecret(tx, keys.publicKey, A, 'beam_api_key_test', 'abcdefgh'))).rejects.toThrow(/not allowed/);
  });
  it('the metadata is visible to the owner of the club only', async () => {
    const coach = { clubId: A, userId: COACH, roles: ['coach', 'player'] };
    expect((await web.withClubTx(coach, (tx) => tx.query('select kind from public.club_secret'))).rows).toEqual([]);
  });
});

describe('read_secret has no club argument and a role allow-list (SR-03)', () => {
  it('takes only the kind', async () => {
    const r = await tdb.query(`select proname, pronargs, pg_get_function_arguments(oid) as args from pg_proc where proname in ('read_secret', 'read_secret_worker')`);
    for (const f of r.rows) {
      expect(f.pronargs, f.proname).toBe(1);
      expect(f.args).not.toMatch(/club/i);
    }
    expect(r.rows).toHaveLength(2);
  });
  it('in club A, asking for club B’s secret returns nothing; the club cannot be named', async () => {
    await put('beam_api_key_live', 'club-b-value-1111', B, OWNER_B);
    expect(await read('beam_api_key_live', A)).toBeNull();
    expect(await read('beam_api_key_live', B)).toBe('club-b-value-1111');
  });
  it('a row copied from one club to another does not decrypt there', async () => {
    await put('beam_api_key_live', 'club-b-value-1111', B, OWNER_B);
    await tdb.query(`insert into public.club_secret (club_id, kind, ciphertext, key_id, written_by_staff) select $1, kind, ciphertext, key_id, gen_random_uuid() from public.club_secret where club_id = $2`, [A, B]);
    await expect(read('beam_api_key_live', A)).rejects.toThrow(/decrypt/);
  });
  it('fails with no club in the context', async () => {
    const c = await tdb.pool.connect();
    try {
      await c.query('set role booq_app');
      await expect(c.query(`select app.read_secret('beam_api_key_live')`)).rejects.toThrow(/club in the context/);
    } finally {
      c.release();
    }
  });
  it('the web role reads Beam keys and the LINE channel secret, not the LINE tokens', async () => {
    for (const k of ['beam_api_key_test', 'beam_hmac_key_live', 'line_channel_secret', 'line_channel_token', 'line_login_secret'] as const) await put(k, `value-of-${k}`);
    expect(await read('beam_hmac_key_live')).toBe('value-of-beam_hmac_key_live');
    expect(await read('line_channel_secret')).toBe('value-of-line_channel_secret');
    await expect(read('line_channel_token')).rejects.toThrow(/not allowed/);
    await expect(read('line_login_secret')).rejects.toThrow(/not allowed/);
  });
  it('the worker role reads Beam keys and every LINE secret', async () => {
    for (const k of ['beam_api_key_test', 'line_channel_token', 'line_login_secret'] as const) await put(k, `value-of-${k}`);
    for (const k of ['beam_api_key_test', 'line_channel_token', 'line_login_secret'] as const) expect(await read(k, A, 'worker')).toBe(`value-of-${k}`);
  });
  it('who can execute which function is the fence: platform none, web not the worker one, worker not the web one', async () => {
    const can = async (role: string, fn: string) => (await tdb.query('select has_function_privilege($1, $2, $3) as ok', [role, fn, 'execute'])).rows[0].ok;
    expect(await can('booq_platform', 'app.read_secret(text)')).toBe(false);
    expect(await can('booq_platform', 'app.read_secret_worker(text)')).toBe(false);
    expect(await can('booq_platform', 'app.write_secret(text,text,text,text)')).toBe(false);
    expect(await can('booq_app', 'app.read_secret_worker(text)')).toBe(false);
    expect(await can('booq_worker', 'app.read_secret(text)')).toBe(false);
    expect(await can('booq_app', 'app.read_secret_internal(text,text[])')).toBe(false);
    expect(await can('booq_worker', 'app.read_secret_internal(text,text[])')).toBe(false);
    expect(await can('booq_worker', 'app.write_secret(text,text,text,text)')).toBe(false);
  });
  it('counts reads per club and kind, counts only', async () => {
    await put('beam_api_key_live');
    await read('beam_api_key_live');
    await read('beam_api_key_live');
    const r = (await tdb.query('select club_id, kind, reads from public.club_secret_read')).rows;
    expect(r).toEqual([{ club_id: A, kind: 'beam_api_key_live', reads: '2' }]);
  });
  it('a missing secret reads as null and is not counted', async () => {
    expect(await read('beam_api_key_live')).toBeNull();
    expect((await tdb.query('select count(*)::int as n from public.club_secret_read')).rows[0].n).toBe(0);
  });
});

describe('the value never reaches a log, a response or an error', () => {
  it('writes, reads and failures print nothing that contains it', async () => {
    const spies = (['log', 'info', 'warn', 'error', 'debug'] as const).map((m) => vi.spyOn(console, m).mockImplementation(() => undefined));
    await put('beam_api_key_live');
    expect(await read('beam_api_key_live')).toBe(MARKER);
    let message = '';
    try { await read('line_channel_token'); } catch (e) { message = (e as Error).message; }
    const h = await openTx();
    try { await readSecret(h.tx, generateKeyPair().privateKey, A, 'beam_api_key_live'); } catch (e) { message += (e as Error).message; } finally { await h.done(); }
    expect(message).not.toContain(MARKER);
    for (const s of spies) expect(JSON.stringify(s.mock.calls)).not.toContain(MARKER);
    spies.forEach((s) => s.mockRestore());
  });
  async function openTx() {
    // a transaction handle that runs read_secret for club A, to try a wrong private key
    const c = await tdb.pool.connect();
    await c.query('begin');
    await c.query('set local role booq_app');
    await c.query(`select set_config('app.club_id', $1, true)`, [A]);
    return {
      tx: { query: (text: string, params?: unknown[]) => c.query(text, params as unknown[]) } as never,
      done: async () => { await c.query('rollback'); c.release(); },
    };
  }
});
