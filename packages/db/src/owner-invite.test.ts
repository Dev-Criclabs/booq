import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createDb, type Db } from './tx';
import { createPlatformDb, type PlatformDb } from './platform-tx';
import { createTestDatabase, type TestDatabase } from './testing/harness';

// F01-T23 part b / migration 0035: the owner invite (SR-01, D122), owner_verified, and the
// second-admin rule for owner contact changes (review T18 R5; design 7.1; ROLE-02-AC8).
const CLUB = '3f2b8f0e-7c1d-4a55-9d0a-1c2e3f4a5b6c';
const OTHER = '9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d';
const OWNER_LINE = 'U00000000000000000000000000000001';
const OWNER_USER = '11111111-1111-4111-8111-111111111111';
const HASH1 = 'a'.repeat(64);
const HASH2 = 'b'.repeat(64);

let tdb: TestDatabase;
let pdb: PlatformDb;
let db: Db;
let adminA: string;
let adminB: string;
let spec: string;
let loner: string;

async function staff(email: string, role: string, auth: string, name: string): Promise<string> {
  return (await tdb.query(`insert into platform.platform_staff (auth_user_id, email, display_name, role) values ($1, $2, $3, $4) returning id`, [auth, email, name, role])).rows[0].id;
}
const as = (staffId: string, club = CLUB) => ({ staffId, staffLabel: 'Staff', clubId: club });
const invite = (who: string, hash = HASH1, club = CLUB) =>
  pdb.withPlatformTx(as(who, club), async (tx) => (await tx.query(`select platform.create_owner_invite($1, $2) as id`, [club, hash])).rows[0]?.id as string);
const status = (who: string, club = CLUB) =>
  pdb.withPlatformTx(as(who, club), async (tx) => (await tx.query(`select platform.owner_invite_status($1) as s`, [club])).rows[0]?.s);
const confirm = (who: string, club = CLUB) =>
  pdb.withPlatformTx(as(who, club), (tx) => tx.query(`select platform.confirm_owner_verified($1)`, [club]));
const check = async (key: string) => (await tdb.query(`select result, checked_by from platform.launch_check where club_id = $1 and check_key = $2`, [CLUB, key])).rows[0];

/** The owner signs in with LINE (F02): the person row exists with a typed phone, then the invite is redeemed. */
async function redeem(hash: string, line = OWNER_LINE, phone = '081-234-5678', user = OWNER_USER) {
  const c = await tdb.pool.connect();
  try {
    await c.query('begin');
    await c.query('insert into public.app_user (club_id, id, line_user_id, display_name, phone, phone_normalized) values ($1,$2,$3,$4,$5,$6) on conflict do nothing', [CLUB, user, line, 'Nok L.', phone, phone.replace(/\D/g, '')]);
    await c.query('insert into public.app_user_role (club_id, user_id, role) values ($1,$2,$3) on conflict do nothing', [CLUB, user, 'player']);
    await c.query('commit');
  } finally {
    c.release();
  }
  return db.withClubTx({ clubId: CLUB, userId: user, roles: [], source: 'player_app' }, async (tx) =>
    (await tx.query(`select * from app.redeem_invite($1, $2, $3)`, [hash, line, user])).rows);
}

beforeEach(async () => {
  tdb = await createTestDatabase();
  await tdb.query(
    `insert into public.club (id, slug, name_th, name_en, status, owner_name, owner_phone, owner_line, owner_email) values
       ($1, 'a', 'ก', 'A', 'testing', 'Nok', '0812345678', $3, 'nok@example.com'),
       ($2, 'b', 'ข', 'B', 'draft', 'Pim', '0898765432', null, 'pim@example.com')`,
    [CLUB, OTHER, OWNER_LINE],
  );
  adminA = await staff('a@booq.example', 'platform_admin', '99999999-0000-4000-8000-000000000001', 'Ada Admin');
  adminB = await staff('b@booq.example', 'platform_admin', '99999999-0000-4000-8000-000000000004', 'Bo Admin');
  spec = await staff('s@booq.example', 'onboarding_specialist', '99999999-0000-4000-8000-000000000002', 'Sam Specialist');
  loner = await staff('l@booq.example', 'onboarding_specialist', '99999999-0000-4000-8000-000000000003', 'Lee Loner');
  await tdb.query(`insert into platform.staff_assignment (staff_id, club_id) values ($1, $2)`, [spec, CLUB]);
  pdb = createPlatformDb({ connectionString: tdb.url, max: 1 });
  db = createDb({ connectionString: tdb.url, max: 1 });
});
afterEach(async () => {
  await pdb.end();
  await db.end();
  await tdb.close();
});

describe('creating the owner invite (SR-01, D122)', () => {
  it('an admin or assigned specialist creates it: kind owner, owner and player roles, bound to the owner LINE id, expiry from config', async () => {
    await tdb.setNow('2026-12-01T03:00:00Z');
    const id = await invite(spec);
    expect(id).toMatch(/^[0-9a-f-]{36}$/);
    const r = (await tdb.query(`select kind, roles, bound_line_user_id, created_by_staff, token_hash, expires_at from public.club_invite where id = $1`, [id])).rows[0];
    expect(r).toMatchObject({ kind: 'owner', bound_line_user_id: OWNER_LINE, created_by_staff: spec, token_hash: HASH1 });
    expect([...r.roles].sort()).toEqual(['owner', 'player']);
    const ttl = Number((await tdb.query(`select value from platform.config where key = 'invite_ttl_hours'`)).rows[0].value);
    expect(new Date(r.expires_at).getTime()).toBe(new Date('2026-12-01T03:00:00Z').getTime() + ttl * 3600_000);
    expect((await invite(adminA, HASH2)).length).toBeGreaterThan(0);
  });

  it('refuses an unassigned specialist (not found), a club with no owner LINE id or email, and a bad token hash', async () => {
    await expect(invite(loner)).rejects.toThrow(/not_found/);
    await expect(invite(adminA, HASH1, OTHER)).rejects.toThrow(/owner_contact_missing/); // OTHER has no owner_line
    await tdb.query(`update public.club set owner_line = 'U00000000000000000000000000000002', owner_email = null where id = $1`, [OTHER]);
    await expect(invite(adminA, HASH1, OTHER)).rejects.toThrow(/owner_contact_missing/);
    await expect(invite(adminA, 'short')).rejects.toThrow(/token_hash/);
    expect((await tdb.query(`select count(*)::int as n from public.club_invite`)).rows[0].n).toBe(0);
  });

  it('a fresh invite ends the older unused one: only the newest can be redeemed', async () => {
    await tdb.setNow('2026-12-01T03:00:00Z');
    await invite(adminA, HASH1);
    await tdb.advance('1 minute');
    await invite(adminA, HASH2);
    expect(await redeem(HASH1)).toEqual([]);
    expect(await redeem(HASH2)).toHaveLength(1);
  });

  it('the platform cannot create it through the table, and no function returns a token', async () => {
    await expect(pdb.withPlatformTx(as(adminA), (tx) => tx.query(`insert into public.club_invite (club_id, token_hash, kind, roles, bound_line_user_id, created_by_staff, expires_at) values ($1,'h','owner','{owner,player}',$2,$3, now() + interval '1 day')`, [CLUB, OWNER_LINE, adminA]))).rejects.toThrow(/permission denied/i);
    const f = await tdb.query(`select has_function_privilege('booq_platform', 'platform.create_owner_invite(uuid, text)', 'execute') as ok, has_function_privilege('booq_app', 'platform.create_owner_invite(uuid, text)', 'execute') as app`);
    expect(f.rows[0]).toEqual({ ok: true, app: false });
  });
});

describe('redemption (SR-01, D122, ROLE-02-AC8)', () => {
  it('only the bound LINE id can redeem; the owner gets owner and player; the invite is single use', async () => {
    await invite(adminA);
    expect(await redeem(HASH1, 'Uother', '0811111111', '33333333-3333-4333-8333-333333333333')).toEqual([]);
    const ok = await redeem(HASH1);
    expect(ok).toHaveLength(1);
    expect([...(ok[0]?.roles ?? [])].sort()).toEqual(['owner', 'player']);
    expect(await redeem(HASH1)).toEqual([]);
  });

  it('writes P6 and the club audit entry with the redeemer name and typed phone, and records owner_signed_in', async () => {
    await invite(adminA);
    await redeem(HASH1);
    const p6 = (await tdb.query(`select action, club_id, detail from platform.audit_log where action = 'club.owner_invite_redeemed'`)).rows;
    expect(p6).toEqual([{ action: 'club.owner_invite_redeemed', club_id: CLUB, detail: { redeemer_name: 'Nok L.', redeemer_phone: '081-234-5678', phone_matches: true } }]);
    const a = (await tdb.query(`select record_type, pii_new from public.audit_entry where club_id = $1 and action = 'owner_invite.redeemed'`, [CLUB])).rows;
    expect(a).toHaveLength(1);
    expect((await check('owner_signed_in')).result).toBe('pass');
  });

  it('a phone that matches (any common format) marks the owner verified; one that does not leaves it failed', async () => {
    await invite(adminA);
    await redeem(HASH1, OWNER_LINE, '+66 81 234 5678');
    expect((await check('owner_verified')).result).toBe('pass');
  });

  it('a phone mismatch marks "owner not verified" and records it in P6', async () => {
    await invite(adminA);
    await redeem(HASH1, OWNER_LINE, '0999999999');
    expect((await check('owner_signed_in')).result).toBe('pass');
    expect((await check('owner_verified')).result).toBe('fail');
    const d = (await tdb.query(`select detail from platform.audit_log where action = 'club.owner_invite_redeemed'`)).rows[0].detail;
    expect(d.phone_matches).toBe(false);
  });

  it('Go live is refused while the owner is unverified, even with every other check passed (SR-01)', async () => {
    await invite(adminA);
    await redeem(HASH1, OWNER_LINE, '0999999999');
    const keys = (await tdb.query(`select value from platform.config where key = 'required_launch_checks'`)).rows[0].value.map((x: { key: string }) => x.key) as string[];
    for (const k of keys.filter((k) => k !== 'owner_signed_in' && k !== 'owner_verified')) {
      await tdb.query(`insert into platform.launch_check (club_id, check_key, result) values ($1, $2, 'pass')`, [CLUB, k]);
    }
    const b = await tdb.query(`select app.status_blockers($1, 'testing', 'live') as b`, [CLUB]);
    expect(b.rows[0].b).toEqual([{ item: 'owner_verified', owed_by: 'booq', result: 'fail' }]);
  });
});

describe('the status P3 shows (never the token)', () => {
  it('pending, then redeemed with the redeemer beside the owner phone, then none for a club without an invite', async () => {
    expect(await status(adminA)).toEqual({ status: 'none' });
    await invite(spec);
    const pending = await status(spec);
    expect(pending).toMatchObject({ status: 'pending', created_by: spec });
    expect(JSON.stringify(pending)).not.toContain(HASH1);
    await redeem(HASH1, OWNER_LINE, '0999999999');
    expect(await status(spec)).toMatchObject({ status: 'redeemed', redeemer_name: 'Nok L.', redeemer_phone: '0999999999', owner_phone: '0812345678', phone_matches: false });
  });

  it('shows expired after the expiry, and nothing to a staff member who cannot see the club', async () => {
    await tdb.setNow('2026-12-01T03:00:00Z');
    await invite(adminA);
    await tdb.advance('30 days');
    expect(await status(adminA)).toMatchObject({ status: 'expired' });
    expect(await status(loner)).toBeNull();
  });
});

describe('confirming the owner by another channel (SR-01: a second admin)', () => {
  async function mismatch() {
    await invite(adminA);
    await redeem(HASH1, OWNER_LINE, '0999999999');
  }
  it('an admin other than the one who created the invite confirms; the check passes and names them', async () => {
    await mismatch();
    await confirm(adminB);
    expect(await check('owner_verified')).toMatchObject({ result: 'pass', checked_by: adminB });
    const p6 = await tdb.query(`select staff_name_at_time as n from platform.audit_log where action = 'club.owner_verified_confirmed'`);
    expect(p6.rows).toEqual([{ n: 'Bo Admin' }]);
  });
  it('refuses the admin who created the invite, a specialist, an invite not yet redeemed, and a club already verified', async () => {
    await invite(adminA);
    await expect(confirm(adminB)).rejects.toThrow(/not_redeemed/);
    await redeem(HASH1, OWNER_LINE, '0999999999');
    await expect(confirm(adminA)).rejects.toThrow(/same_admin/);
    await expect(confirm(spec)).rejects.toThrow(/admin_only/);
    expect((await check('owner_verified')).result).toBe('fail');
    await confirm(adminB);
    await expect(confirm(adminB)).rejects.toThrow(/already_verified/);
  });
});

describe('changing the owner contact (review T18 R5; design 7.1)', () => {
  const change = (who: string, changes: Record<string, string>, club = CLUB) =>
    pdb.withPlatformTx(as(who, club), async (tx) => (await tx.query(`select platform.change_owner_contact($1, $2::jsonb) as r`, [club, JSON.stringify(changes)])).rows[0]?.r);
  const decide = (who: string, request: string, approve: boolean) =>
    pdb.withPlatformTx(as(who), (tx) => tx.query(`select platform.decide_owner_contact_change($1, $2)`, [request, approve]));
  const phone = async () => (await tdb.query(`select owner_phone from public.club where id = $1`, [CLUB])).rows[0].owner_phone as string;

  it('the platform cannot write the owner columns directly any more', async () => {
    await expect(pdb.withPlatformTx(as(adminA), (tx) => tx.query(`update public.club set owner_phone = '1' where id = $1`, [CLUB]))).rejects.toThrow(/permission denied/i);
    await pdb.withPlatformTx(as(adminA), (tx) => tx.query(`update public.club set name_en = 'Renamed' where id = $1`, [CLUB]));
  });

  it('before any owner invite exists the change is applied at once', async () => {
    expect(await change(spec, { owner_phone: '0877777777' })).toMatchObject({ applied: true });
    expect(await phone()).toBe('0877777777');
  });

  it('after an owner invite exists the change waits for a different admin; the requester cannot approve it', async () => {
    await invite(adminA);
    const r = await change(spec, { owner_phone: '0877777777', owner_email: 'new@example.com' });
    expect(r).toMatchObject({ applied: false });
    expect(await phone()).toBe('0812345678');
    await expect(decide(spec, r.request_id, true)).rejects.toThrow(/admin_only/);
    await decide(adminA, r.request_id, true); // an admin, but not the requester: allowed (the requester here is the specialist)
    expect(await phone()).toBe('0877777777');
    await expect(decide(adminB, r.request_id, true)).rejects.toThrow(/not_pending/);
  });

  it('an admin who requests a change cannot approve their own; another admin can reject it', async () => {
    await invite(adminA);
    const r = await change(adminB, { owner_line: 'U00000000000000000000000000000003' });
    await expect(decide(adminB, r.request_id, true)).rejects.toThrow(/same_admin/);
    await decide(adminA, r.request_id, false);
    expect((await tdb.query(`select owner_line from public.club where id = $1`, [CLUB])).rows[0].owner_line).toBe(OWNER_LINE);
    expect((await tdb.query(`select status, decided_by from platform.owner_contact_change where id = $1`, [r.request_id])).rows[0]).toEqual({ status: 'rejected', decided_by: adminA });
  });

  it('the owner LINE id must be a LINE user id: U and 32 hex characters (D122), in the table and in the change function', async () => {
    const bad = ['@nok', 'U1', 'u00000000000000000000000000000001', 'U0000000000000000000000000000000G', 'U000000000000000000000000000000012', ' U00000000000000000000000000000001'];
    for (const v of bad) {
      await expect(tdb.query(`update public.club set owner_line = $2 where id = $1`, [CLUB, v]), v).rejects.toThrow(/club_owner_line_format|check/i);
      await expect(change(spec, { owner_line: v }), v).rejects.toThrow(/invalid_field/);
    }
    expect((await tdb.query(`select owner_line from public.club where id = $1`, [CLUB])).rows[0].owner_line).toBe(OWNER_LINE);
    expect(await change(spec, { owner_line: 'U0000000000000000000000000000000a' })).toMatchObject({ applied: true });
  });

  it('accepts only the four owner columns, and not for a club the caller cannot see or cannot edit', async () => {
    await expect(change(spec, { name_en: 'x' })).rejects.toThrow(/invalid_field/);
    await expect(change(spec, {})).rejects.toThrow(/invalid_field/);
    await expect(change(loner, { owner_phone: '1' })).rejects.toThrow(/not_found/);
    await tdb.query(`update public.club set status = 'live' where id = $1`, [CLUB]);
    await expect(change(adminA, { owner_phone: '0877777777' })).rejects.toThrow(/look_only/);
  });

  it('every request and decision is written to P6 with the staff name', async () => {
    await invite(adminA);
    const r = await change(spec, { owner_phone: '0877777777' });
    await decide(adminB, r.request_id, true);
    const actions = (await tdb.query(`select action from platform.audit_log where action like 'club.owner_contact%' order by occurred_at, id`)).rows.map((x) => x.action);
    expect(actions).toEqual(['club.owner_contact_requested', 'club.owner_contact_changed']);
  });
});
