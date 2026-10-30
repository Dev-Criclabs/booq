import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createDb, type Db } from './tx';
import { createTestDatabase, type TestDatabase } from './testing/harness';

// F02-T09b / F01-T31b database side: imported players are claimed, never matched silently
// (D105, SR-05; PLAT-06-AC7, AUTH-02-AC28). Migration 0103.
const A = '3f2b8f0e-7c1d-4a55-9d0a-1c2e3f4a5b6c';
const B = '9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d';
const IMP = '11111111-1111-4111-8111-111111111111';     // imported record
const IMP2 = '12121212-1212-4121-8121-121212121212';    // a second imported record, other phone
const NEW1 = '22222222-2222-4222-8222-222222222222';    // a person who just signed up
const NEW2 = '23232323-2323-4232-8232-232323232323';
const DESK = '33333333-3333-4333-8333-333333333333';
const PLAYER = '44444444-4444-4444-8444-444444444444';
const PHONE = '0812345678';

let tdb: TestDatabase;
let web: Db;
beforeEach(async () => {
  tdb = await createTestDatabase();
  await tdb.query(`insert into public.club (id, slug, name_th, name_en) values ($1,'a','ก','A'), ($2,'b','ข','B')`, [A, B]);
  await person(A, DESK, 'Ld', ['front_desk', 'player']);
  await person(A, PLAYER, 'Lp', ['player']);
  await imported(A, IMP, PHONE);
  await imported(A, IMP2, '0899999999');
  await person(A, NEW1, 'Ln1', ['player']);
  await person(A, NEW2, 'Ln2', ['player']);
  web = createDb({ connectionString: tdb.url, max: 2 });
});
afterEach(async () => {
  await web.end();
  await tdb.close();
});
async function person(club: string, id: string, line: string, roles: string[]) {
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
async function imported(club: string, id: string, phone: string, name = 'Imported Name') {
  const c = await tdb.pool.connect();
  try {
    await c.query('begin');
    await c.query(`insert into public.app_user (club_id, id, line_user_id, claim_state, full_name, phone, phone_normalized) values ($1,$2,null,'unclaimed',$3,$4,$4)`, [club, id, name, phone]);
    await c.query(`insert into public.app_user_role (club_id, user_id, role) values ($1,$2,'player')`, [club, id]);
    await c.query('commit');
  } finally {
    c.release();
  }
}
const me = (user: string, roles = ['player'], club = A) => ({ clubId: club, userId: user, roles, source: 'player_app' as const });
const request = (user: string, phone = PHONE, name = 'Typed Name', club = A) =>
  web.withClubTx(me(user, ['player'], club), (tx) => tx.query('select app.request_claim($1, $2, $3, $4) as r', [user, name, phone, phone]));
const open = async () => (await tdb.query(`select imported_user_id, claimant_user_id, status from public.claim_request order by requested_at, claimant_user_id`)).rows;

describe('the imported record (D105)', () => {
  it('an imported record has no LINE id and a claim state; an ordinary person must have a LINE id', async () => {
    await expect(tdb.query(`insert into public.app_user (club_id, line_user_id) values ($1, null)`, [A])).rejects.toThrow(/line_or_imported/);
    await expect(tdb.query(`insert into public.app_user (club_id, line_user_id, claim_state) values ($1, 'x', 'unclaimed')`, [A])).rejects.toThrow(/unclaimed_has_no_line/);
    await expect(tdb.query(`update public.app_user set claim_state = 'claimed' where id = $1`, [IMP])).rejects.toThrow(/claim_state_values/);
  });
  it('a second person typing the same phone sees nothing of the record', async () => {
    const seen = await web.withClubTx(me(NEW1), (tx) => tx.query('select id from public.app_user'));
    expect(seen.rows).toEqual([{ id: NEW1 }]);
    expect((await web.withClubTx(me(NEW1), (tx) => tx.query('select * from public.duplicate_phone_flags'))).rowCount).toBe(0);
  });
});

describe('request_claim (F02-T09b)', () => {
  it('exactly one unclaimed record with that phone gives one open request; the caller learns nothing', async () => {
    const r = await request(NEW1);
    expect(r.rows[0]).toEqual({ r: '' });                        // void: C2 never says a record was found
    expect(await open()).toEqual([{ imported_user_id: IMP, claimant_user_id: NEW1, status: 'open' }]);
    const row = (await tdb.query('select typed_full_name, typed_phone from public.claim_request')).rows[0];
    expect(row).toEqual({ typed_full_name: 'Typed Name', typed_phone: PHONE });
  });
  it('no match makes nothing; the same call twice makes one request', async () => {
    await request(NEW1, '0800000000');
    expect(await open()).toEqual([]);
    await request(NEW1);
    await request(NEW1);
    expect(await open()).toHaveLength(1);
  });
  it('two unclaimed records with the same phone: no request (more than one match is a new player)', async () => {
    await imported(A, '13131313-1313-4131-8131-131313131313', PHONE);
    await request(NEW1);
    expect(await open()).toEqual([]);
  });
  it('only unclaimed records match: an ordinary player with that phone, a merged record, or another club’s record never do', async () => {
    await tdb.query(`update public.app_user set phone = '0877777777', phone_normalized = '0877777777' where id = $1`, [PLAYER]);
    await request(NEW1, '0877777777');
    await imported(B, '14141414-1414-4141-8141-141414141414', '0866666666');
    await request(NEW1, '0866666666');
    expect(await open()).toEqual([]);
  });
  it('the claimant is the person in the context, an active ordinary player, and not an imported record', async () => {
    await expect(web.withClubTx(me(NEW1), (tx) => tx.query('select app.request_claim($1,$2,$3,$4)', [NEW2, 'n', PHONE, PHONE]))).rejects.toThrow(/claimant/);
    await expect(web.withClubTx(me(IMP), (tx) => tx.query('select app.request_claim($1,$2,$3,$4)', [IMP, 'n', PHONE, PHONE]))).rejects.toThrow(/claimant/);
  });
  it('two claimants for one record leave two open requests and the record unclaimed', async () => {
    await request(NEW1);
    await request(NEW2);
    expect(await open()).toHaveLength(2);
    expect((await tdb.query('select claim_state from public.app_user where id = $1', [IMP])).rows[0].claim_state).toBe('unclaimed');
  });
  it('the typed values reach the audit log only in the pii columns', async () => {
    await request(NEW1, PHONE, 'MARKER Somchai');
    const e = (await tdb.query(`select * from public.audit_entry where record_type = 'claim_request'`)).rows[0];
    expect(JSON.stringify([e.old_value, e.new_value])).not.toContain('MARKER');
    expect(e.pii_new).toMatchObject({ typed_full_name: 'MARKER Somchai' });
  });
});

describe('confirm and reject (F01-T31b database side)', () => {
  const staff = me(DESK, ['front_desk', 'player']);
  const confirm = (imp: string, claimant: string, c = staff) => web.withClubTx(c, (tx) => tx.query('select app.claim_confirm($1,$2)', [imp, claimant]));
  const reject = (id: string, c = staff) => web.withClubTx(c, (tx) => tx.query('select app.claim_reject($1)', [id]));
  beforeEach(async () => {
    await request(NEW1);
  });

  it('only owner and front desk confirm; a player, a coach and the accountant cannot, and not the claimant themself', async () => {
    for (const roles of [['player'], ['coach', 'player'], ['accountant', 'player']]) {
      await expect(confirm(IMP, NEW1, me(PLAYER, roles)), roles.join()).rejects.toThrow(/not allowed/);
    }
    await expect(confirm(IMP, NEW1, me(NEW1, ['player']))).rejects.toThrow(/not allowed/);
  });
  it('confirming merges the record into the claimant, deactivates it, closes the request and rejects the rival request', async () => {
    await request(NEW2);
    await confirm(IMP, NEW1);
    expect((await tdb.query('select claim_state, merged_into, active from public.app_user where id = $1', [IMP])).rows[0]).toEqual({ claim_state: 'merged', merged_into: NEW1, active: false });
    const rows = (await tdb.query(`select claimant_user_id, status, handled_by is not null as handled from public.claim_request order by claimant_user_id`)).rows;
    expect(rows).toEqual([{ claimant_user_id: NEW1, status: 'confirmed', handled: true }, { claimant_user_id: NEW2, status: 'rejected', handled: true }]);
  });
  it('without an open request from that claimant, nothing is confirmed', async () => {
    await expect(confirm(IMP, NEW2)).rejects.toThrow(/no open request/);
    await expect(confirm(IMP2, NEW1)).rejects.toThrow(/no open request/);
  });
  it('a record can be confirmed once', async () => {
    await confirm(IMP, NEW1);
    await expect(confirm(IMP, NEW1)).rejects.toThrow(/no open request/);
  });
  it('rejecting closes the request and leaves the record unclaimed', async () => {
    const id = (await tdb.query('select id from public.claim_request')).rows[0].id;
    await reject(id);
    expect((await open())[0]?.status).toBe('rejected');
    expect((await tdb.query('select claim_state from public.app_user where id = $1', [IMP])).rows[0].claim_state).toBe('unclaimed');
    await expect(reject(id)).rejects.toThrow(/no open request/);
  });
  it('handlers registered by later features (the ledger transfer, F06) run inside the confirm; one that fails undoes it', async () => {
    await tdb.query(`
      create table public.t_transfer (imported uuid, claimant uuid);
      create function app.t_transfer(p_club uuid, p_imported uuid, p_claimant uuid) returns void language plpgsql as $$ begin insert into public.t_transfer values (p_imported, p_claimant); end $$;
      insert into app.claim_handlers (handler_key, handler) values ('t_transfer', 'app.t_transfer(uuid,uuid,uuid)'::regprocedure);
      grant insert on public.t_transfer to booq_owner;`);
    await confirm(IMP, NEW1);
    expect((await tdb.query('select * from public.t_transfer')).rows).toEqual([{ imported: IMP, claimant: NEW1 }]);
    await imported(A, '15151515-1515-4151-8151-151515151515', '0855555555');
    await request(NEW2, '0855555555');
    await tdb.query(`create function app.t_fail(p_club uuid, p_imported uuid, p_claimant uuid) returns void language plpgsql as $$ begin raise exception 'transfer failed'; end $$;
      insert into app.claim_handlers (handler_key, handler) values ('u_fail', 'app.t_fail(uuid,uuid,uuid)'::regprocedure)`);
    await expect(confirm('15151515-1515-4151-8151-151515151515', NEW2)).rejects.toThrow(/transfer failed/);
    expect((await tdb.query(`select claim_state from public.app_user where id = '15151515-1515-4151-8151-151515151515'`)).rows[0].claim_state).toBe('unclaimed');
  });
  it('the confirmation is audited with the staff member', async () => {
    await confirm(IMP, NEW1);
    const e = (await tdb.query(`select actor_user_id, new_value from public.audit_entry where record_type = 'app_user' and record_id = $1 and action = 'update'`, [IMP])).rows;
    expect(e.some((x) => x.actor_user_id === DESK && x.new_value?.claim_state === 'merged')).toBe(true);
  });
  it('the app roles have no direct write on claim_request; BOOQ staff no privilege; the worker cannot call the functions', async () => {
    for (const priv of ['insert', 'update', 'delete']) {
      expect((await tdb.query(`select has_table_privilege('booq_app', 'public.claim_request', $1) as ok`, [priv])).rows[0].ok, priv).toBe(false);
    }
    for (const priv of ['select', 'insert', 'update', 'delete']) {
      expect((await tdb.query(`select has_table_privilege('booq_platform', 'public.claim_request', $1) as ok`, [priv])).rows[0].ok, priv).toBe(false);
    }
    for (const f of ['app.request_claim(uuid,text,text,text)', 'app.claim_confirm(uuid,uuid)', 'app.claim_reject(uuid)']) {
      expect((await tdb.query(`select has_function_privilege('booq_worker', $1, 'execute') as ok`, [f])).rows[0].ok, f).toBe(false);
    }
  });
  it('staff list the open requests with the imported name beside the typed one; a player sees none', async () => {
    const r = await web.withClubTx(staff, (tx) => tx.query('select typed_full_name, typed_phone from public.claim_request'));
    expect(r.rowCount).toBe(1);
    expect((await web.withClubTx(me(NEW1), (tx) => tx.query('select 1 from public.claim_request'))).rowCount).toBe(0);
  });
});
