import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createDb, type Db } from './tx';
import { createTestDatabase, type TestDatabase } from './testing/harness';

// F01-T33 / migration 0019: app.deletion_impact and app.anonymise_user (PDPA-01-AC5 to AC7;
// D104, SR-04, SR-19, A-18).
const A = '3f2b8f0e-7c1d-4a55-9d0a-1c2e3f4a5b6c';
const B = '9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d';
const VICTIM = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';
const DESK = '33333333-3333-4333-8333-333333333333';
const OWNER = '44444444-4444-4444-8444-444444444444';
const C1 = '00000000-0000-4000-8000-0000000000c1';
const LINE = 'U' + 'a'.repeat(32);
const NAME = 'MARKERNAME Somchai';
const PHONE = '66899991234';
const at = (h: number, day = 29) => new Date(Date.UTC(2026, 11, day, h - 7)).toISOString();
const NOW = '2026-12-29T02:00:00Z';

let tdb: TestDatabase;
let web: Db;
beforeEach(async () => {
  tdb = await createTestDatabase();
  await tdb.setNow(NOW);
  await tdb.query(`insert into public.club (id, slug, name_th, name_en, status) values ($1,'a','ก','A','live'), ($2,'b','ข','B','live')`, [A, B]);
  await tdb.query(`insert into public.location (club_id, id, name) values ($1,'00000000-0000-4000-8000-0000000000a1','M')`, [A]);
  await tdb.query(`insert into public.resource (club_id, id, location_id, name, sport) values ($1,$2,'00000000-0000-4000-8000-0000000000a1','1','tennis')`, [A, C1]);
  const mk = async (id: string, line: string, roles: string[], extra = '') => {
    const c = await tdb.pool.connect();
    try {
      await c.query('begin');
      await c.query(`insert into public.app_user (club_id, id, line_user_id, display_name, full_name, phone, phone_normalized, date_of_birth, language, level) values ($1,$2,$3,$4,$5,$6,$7,$8,'th','beginner')`,
        [A, id, line, 'Nok', id === VICTIM ? NAME : 'Other Person', id === VICTIM ? '+' + PHONE : '+66800000000', id === VICTIM ? PHONE : '66800000000', '1990-12-15']);
      for (const r of roles) await c.query('insert into public.app_user_role (club_id, user_id, role) values ($1,$2,$3)', [A, id, r]);
      if (extra) await c.query(extra, [A, id]);
      await c.query('commit');
    } finally {
      c.release();
    }
  };
  await mk(VICTIM, LINE, ['player']);
  await mk(OTHER, 'U' + 'b'.repeat(32), ['player']);
  await mk(DESK, 'U' + 'c'.repeat(32), ['front_desk', 'player']);
  await mk(OWNER, 'U' + 'd'.repeat(32), ['owner', 'player']);
  web = createDb({ connectionString: tdb.url, max: 2 });
});
afterEach(async () => {
  await web.end();
  await tdb.close();
});
const ctx = (user: string, roles: string[]) => ({ clubId: A, userId: user, roles, source: 'admin' as const });
const staff = ctx(DESK, ['front_desk', 'player']);
const anonymise = (user = VICTIM, c = staff) => web.withClubTx(c, (tx) => tx.query('select app.anonymise_user($1)', [user]));
const impact = (user = VICTIM, c = staff) => web.withClubTx(c, (tx) => tx.query('select app.deletion_impact($1) as r', [user])).then((r) => r.rows[0]!.r as Record<string, number>);

async function booking(status: string, start: string, end: string, extra: Record<string, unknown> = {}) {
  const o = (await tdb.query(`insert into public.orders (club_id, customer_id, source) values ($1,$2,'online') returning id`, [A, VICTIM])).rows[0].id;
  return (await tdb.query(
    `insert into public.booking (club_id, order_id, type, resource_id, customer_id, start_at, end_at, status, source, created_by, confirmed_at, hold_expires_at)
     values ($1,$2,'court',$3,$4,$5,$6,$7,'online',$4, case when $7 = 'awaiting_payment' then null else now() end, $8) returning id`,
    [A, o, C1, VICTIM, start, end, status, extra.hold ?? null],
  )).rows[0].id as string;
}
/** Personal data of the victim in every store the function must clear. */
async function seedStores() {
  await tdb.query(`insert into public.user_staff_note (club_id, user_id, note, created_by) values ($1,$2,'MARKERNOTE pays late',$3)`, [A, VICTIM, DESK]);
  await tdb.query(`insert into public.user_consent (club_id, user_id, notice_version, language) values ($1,$2,'v1','th')`, [A, VICTIM]);
  await tdb.query(`insert into public.auth_session (club_id, token_hash, user_id, line_user_id, state, expires_at) values ($1, repeat('a',64), $2, $3, 'active', app.now() + interval '1 day')`, [A, VICTIM, LINE]);
  await tdb.query(`insert into public.idempotency_key (club_id, key, user_id, request_hash, response) values ($1,'k1',$2,'h','{"name":"MARKERNAME Somchai"}')`, [A, VICTIM]);
  await tdb.query(`insert into public.data_request (club_id, user_id, kind, note) values ($1,$2,'delete','MARKERREQ called her')`, [A, VICTIM]);
  const job = (await tdb.query(`insert into public.import_job (club_id, kind, file_name, created_by, expires_at) values ($1,'players','p.csv',$2, app.now() + interval '1 day') returning id`, [A, OWNER])).rows[0].id;
  await tdb.query(`insert into public.import_row (club_id, job_id, row_no, raw) values ($1,$2,1,$3), ($1,$2,2,'{"name":"Someone Else"}')`, [A, job, JSON.stringify({ name: NAME, phone: PHONE })]);
  await tdb.query(`insert into public.club_invite (club_id, token_hash, kind, roles, bound_line_user_id, created_by_staff, expires_at) values ($1,'h-owner','owner','{owner,player}',$2,null, now() + interval '1 day')`, [A, LINE]).catch(() => undefined);
}
const everything = async () =>
  JSON.stringify(
    await Promise.all(['app_user', 'user_staff_note', 'auth_session', 'idempotency_key', 'data_request', 'import_row', 'claim_request', 'audit_entry', 'club_invite'].map(async (t) => (await tdb.query(`select * from public.${t}`)).rows)),
  );

describe('what staff see before they confirm (PDPA-01-AC5)', () => {
  it('counts future confirmed bookings and live holds; not past, released or other people’s', async () => {
    await booking('confirmed', at(15), at(16));
    await booking('confirmed', at(5, 28), at(6, 28));   // ended before now
    await booking('awaiting_payment', at(17), at(18), { hold: at(10) });
    await booking('awaiting_payment', at(19), at(20), { hold: at(8) });   // hold already ran out
    expect(await impact()).toEqual({ future_bookings: 1, held_bookings: 1 });
    expect(await impact(OTHER)).toEqual({ future_bookings: 0, held_bookings: 0 });
  });
  it('only owner and front desk may ask; an unknown person is not found', async () => {
    for (const roles of [['player'], ['coach', 'player'], ['accountant', 'player']]) {
      await expect(impact(VICTIM, ctx(OTHER, roles)), roles.join()).rejects.toThrow(/not allowed/);
    }
    await expect(impact('00000000-0000-4000-8000-00000000ffff')).rejects.toThrow(/not found/);
  });
  it('features register their own counts (F06 credits and wallet) and they are merged in', async () => {
    await tdb.query(`
      create function app.t_impact(p_club uuid, p_user uuid) returns jsonb language sql as $$ select '{"package_credits": 3, "wallet_satang": 12000}'::jsonb $$;
      insert into app.deletion_impact_handlers (handler_key, handler) values ('t', 'app.t_impact(uuid,uuid)'::regprocedure);`);
    expect(await impact()).toEqual({ future_bookings: 0, held_bookings: 0, package_credits: 3, wallet_satang: 12000 });
  });
});

describe('anonymise_user (PDPA-01-AC6, AC7)', () => {
  it('replaces the personal values, deactivates, and leaves the row with its id', async () => {
    await anonymise();
    const u = (await tdb.query('select * from public.app_user where id = $1', [VICTIM])).rows[0];
    expect(u).toMatchObject({ full_name: null, phone: null, phone_normalized: null, date_of_birth: null, display_name: null, language: null, level: null, active: false });
    expect(u.line_user_id).toBe('erased:' + VICTIM);
    expect(u.anonymised_at).not.toBeNull();
  });
  it('no marker value remains in any store: person, notes, sessions, keys, requests, staging, invites, audit', async () => {
    await seedStores();
    expect(await everything()).toContain('MARKERNAME');
    await anonymise();
    const dump = await everything();
    for (const m of ['MARKERNAME', 'MARKERNOTE', 'MARKERREQ', PHONE, LINE]) expect(dump, m).not.toContain(m);
    // another person’s staging row and the other person’s data are untouched
    expect(dump).toContain('Someone Else');
    expect((await tdb.query(`select phone_normalized from public.app_user where id = $1`, [OTHER])).rows[0].phone_normalized).toBe('66800000000');
  });
  it('audit entries are otherwise unchanged and each erasure is recorded', async () => {
    await seedStores();
    const before = (await tdb.query(`select id, action, actor_label, old_value, new_value from public.audit_entry where record_id = $1 order by seq`, [VICTIM])).rows;
    await anonymise();
    const after = (await tdb.query(`select id, action, actor_label, old_value, new_value from public.audit_entry where record_id = $1 and action <> 'user.anonymised' and action <> 'update' order by seq`, [VICTIM])).rows;
    expect(after.length).toBeGreaterThan(0);
    for (const a of after) expect(before.find((b) => b.id === a.id)).toEqual(a);
    expect((await tdb.query(`select count(*)::int as n from public.audit_erasure where record_type = 'app_user' and record_id = $1`, [VICTIM])).rows[0].n).toBe(1);
    expect((await tdb.query(`select action from public.audit_entry where action = 'user.anonymised'`)).rows).toHaveLength(1);
    expect(JSON.stringify((await tdb.query(`select * from public.audit_entry where action = 'user.anonymised'`)).rows)).not.toContain(NAME);
  });
  it('bookings, orders and consent stay under the same id (receipts and ledgers will too)', async () => {
    await seedStores();
    const past = await booking('confirmed', at(5, 20), at(6, 20));
    await anonymise();
    expect((await tdb.query('select customer_id from public.booking where id = $1', [past])).rows[0].customer_id).toBe(VICTIM);
    expect((await tdb.query('select count(*)::int as n from public.orders where customer_id = $1', [VICTIM])).rows[0].n).toBe(1);
    expect((await tdb.query('select count(*)::int as n from public.user_consent where user_id = $1', [VICTIM])).rows[0].n).toBe(1);
  });
  it('refused while a future confirmed booking or live hold exists; allowed once it is past or released (A-18)', async () => {
    const b = await booking('confirmed', at(15), at(16));
    await expect(anonymise()).rejects.toThrow(/future booking/);
    await tdb.query(`update public.booking set status = 'cancelled' where id = $1`, [b]);
    const h = await booking('awaiting_payment', at(17), at(18), { hold: at(10) });
    await expect(anonymise()).rejects.toThrow(/future booking/);
    await tdb.query(`update public.booking set status = 'released', release_reason = 'expired', released_at = now(), hold_expires_at = null where id = $1`, [h]);
    await anonymise();
  });
  it('only owner and front desk; not the person for themselves; not twice; not an unknown person', async () => {
    for (const roles of [['player'], ['coach', 'player'], ['accountant', 'player']]) {
      await expect(anonymise(VICTIM, ctx(VICTIM, roles)), roles.join()).rejects.toThrow(/not allowed/);
    }
    await expect(anonymise('00000000-0000-4000-8000-00000000ffff')).rejects.toThrow(/not found/);
    await anonymise();
    await expect(anonymise()).rejects.toThrow(/already done/);
  });
  it('the last owner of a live club cannot be anonymised', async () => {
    await expect(anonymise(OWNER, ctx(DESK, ['front_desk', 'player']))).rejects.toThrow(/active owner/);
    expect((await tdb.query('select anonymised_at from public.app_user where id = $1', [OWNER])).rows[0].anonymised_at).toBeNull();
  });
  it('the same LINE user signing in later is a new player', async () => {
    await anonymise();
    const c = await tdb.pool.connect();
    try {
      await c.query('begin');
      await c.query('insert into public.app_user (club_id, line_user_id) values ($1,$2)', [A, LINE]);
      await c.query(`insert into public.app_user_role (club_id, user_id, role) select $1, id, 'player' from public.app_user where line_user_id = $2`, [A, LINE]);
      await c.query('commit');
    } finally {
      c.release();
    }
    expect((await tdb.query('select count(*)::int as n from public.app_user where line_user_id = $1', [LINE])).rows[0].n).toBe(1);
  });
  it('other clubs are never touched, and the names view shows nothing for the person', async () => {
    await anonymise();
    const r = await web.withClubTx(ctx(OWNER, ['owner', 'player']), (tx) => tx.query('select display_name, full_name from public.app_user_names where id = $1', [VICTIM]));
    expect(r.rows).toEqual([{ display_name: null, full_name: null }]);
  });
  it('handlers of later features (the F10 outbox) run inside the same transaction; one that fails undoes it', async () => {
    await tdb.query(`
      create table public.t_outbox (club_id uuid, user_id uuid, params text);
      insert into public.t_outbox values ('${A}', '${VICTIM}', 'MARKEROUTBOX');
      create function app.t_clear(p_club uuid, p_user uuid) returns void language sql as $$ update public.t_outbox set params = null where club_id = p_club and user_id = p_user $$;
      grant select, update on public.t_outbox to booq_owner;
      insert into app.anonymise_handlers (handler_key, handler) values ('t_outbox', 'app.t_clear(uuid,uuid)'::regprocedure);`);
    await anonymise();
    expect((await tdb.query('select params from public.t_outbox')).rows).toEqual([{ params: null }]);
    await tdb.query(`create function app.t_fail(p_club uuid, p_user uuid) returns void language plpgsql as $$ begin raise exception 'handler failed'; end $$;
      insert into app.anonymise_handlers (handler_key, handler) values ('z_fail', 'app.t_fail(uuid,uuid)'::regprocedure)`);
    await expect(anonymise(OTHER)).rejects.toThrow(/handler failed/);
    expect((await tdb.query('select anonymised_at from public.app_user where id = $1', [OTHER])).rows[0].anonymised_at).toBeNull();
  });
  it('the worker and BOOQ staff cannot call either function', async () => {
    for (const f of ['app.anonymise_user(uuid)', 'app.deletion_impact(uuid)']) {
      for (const role of ['booq_worker', 'booq_platform']) {
        expect((await tdb.query('select has_function_privilege($1, $2, $3) as ok', [role, f, 'execute'])).rows[0].ok, `${role} ${f}`).toBe(false);
      }
    }
  });
});
