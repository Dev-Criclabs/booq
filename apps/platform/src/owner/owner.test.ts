import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { hashInviteToken } from '@booq/auth';
import { createDb, createPlatformDb, type Db, type PlatformDb } from '@booq/db';
import { createTestDatabase, type TestDatabase } from '@booq/db/testing';
import { createOwnerService, createStubInviteMailer, type InviteMail } from './owner';

// F01-T23 part b: owner invite, status, confirmation and contact changes (SR-01, D122, ROLE-02-AC8).
const CLUB = '3f2b8f0e-7c1d-4a55-9d0a-1c2e3f4a5b6c';
const OWNER_LINE = 'U00000000000000000000000000000001';
const OWNER_USER = '11111111-1111-4111-8111-111111111111';

let tdb: TestDatabase;
let pdb: PlatformDb;
let db: Db;
let svc: ReturnType<typeof createOwnerService>;
let mails: InviteMail[];
let adminA: string;
let adminB: string;
let spec: string;
let loner: string;

async function staff(email: string, role: string, auth: string, name: string): Promise<string> {
  return (await tdb.query(`insert into platform.platform_staff (auth_user_id, email, display_name, role) values ($1, $2, $3, $4) returning id`, [auth, email, name, role])).rows[0].id;
}
const act = (staffId: string, fresh = true) => ({ staffId, stepUpFresh: fresh });
const tokenOf = (mail: InviteMail) => new URL(mail.params.link).searchParams.get('invite') as string;
async function redeem(token: string, phone = '0812345678') {
  const c = await tdb.pool.connect();
  try {
    await c.query('begin');
    await c.query('insert into public.app_user (club_id, id, line_user_id, display_name, phone, phone_normalized) values ($1,$2,$3,$4,$5,$6) on conflict do nothing', [CLUB, OWNER_USER, OWNER_LINE, 'Nok L.', phone, phone.replace(/\D/g, '')]);
    await c.query('insert into public.app_user_role (club_id, user_id, role) values ($1,$2,$3) on conflict do nothing', [CLUB, OWNER_USER, 'player']);
    await c.query('commit');
  } finally {
    c.release();
  }
  return db.withClubTx({ clubId: CLUB, userId: OWNER_USER, roles: [], source: 'player_app' }, async (tx) =>
    (await tx.query(`select * from app.redeem_invite($1, $2, $3)`, [hashInviteToken(token), OWNER_LINE, OWNER_USER])).rows);
}

beforeEach(async () => {
  tdb = await createTestDatabase();
  await tdb.query(
    `insert into public.club (id, slug, name_th, name_en, status, owner_name, owner_phone, owner_line, owner_email, default_language) values
       ($1, 'club-a', 'ก', 'Club A', 'testing', 'Nok', '0812345678', $2, 'nok@example.com', 'en')`,
    [CLUB, OWNER_LINE],
  );
  adminA = await staff('a@booq.example', 'platform_admin', '99999999-0000-4000-8000-000000000001', 'Ada Admin');
  adminB = await staff('b@booq.example', 'platform_admin', '99999999-0000-4000-8000-000000000004', 'Bo Admin');
  spec = await staff('s@booq.example', 'onboarding_specialist', '99999999-0000-4000-8000-000000000002', 'Sam Specialist');
  loner = await staff('l@booq.example', 'onboarding_specialist', '99999999-0000-4000-8000-000000000003', 'Lee Loner');
  await tdb.query(`insert into platform.staff_assignment (staff_id, club_id) values ($1, $2)`, [spec, CLUB]);
  pdb = createPlatformDb({ connectionString: tdb.url, max: 1 });
  db = createDb({ connectionString: tdb.url, max: 1 });
  mails = [];
  svc = createOwnerService({ db: pdb, mailer: createStubInviteMailer(mails), baseUrl: 'https://app.example.test' });
});
afterEach(async () => {
  await pdb.end();
  await db.end();
  await tdb.close();
});

describe('creating and sending the invite (SR-01)', () => {
  it('emails the link to the club owner email and returns status only: the staff member never gets the link or token', async () => {
    const r = await svc.createOwnerInvite(act(spec), CLUB);
    expect(r).toEqual({ ok: true, status: 'sent' });
    expect(mails).toHaveLength(1);
    expect(mails[0]).toMatchObject({ to: 'nok@example.com', language: 'en', subjectKey: 'L-new.owner_invite_subject', bodyKey: 'L-new.owner_invite_body' });
    expect(mails[0]?.params.clubName).toBe('Club A');
    expect(mails[0]?.params.link).toMatch(/^https:\/\/app\.example\.test\/c\/club-a\/join\?invite=[A-Za-z0-9_-]{43}$/);
    const token = tokenOf(mails[0] as InviteMail);
    expect(JSON.stringify(r)).not.toContain(token);
    // Only the hash is stored, and the token is nowhere in the logs.
    expect((await tdb.query(`select token_hash from public.club_invite`)).rows).toEqual([{ token_hash: hashInviteToken(token) }]);
    const everywhere = JSON.stringify([(await tdb.query(`select * from platform.audit_log`)).rows, (await tdb.query(`select * from public.audit_entry`)).rows]);
    expect(everywhere).not.toContain(token);
    expect((await tdb.query(`select action, staff_name_at_time as n from platform.audit_log where action = 'club.owner_invite_created'`)).rows).toEqual([{ action: 'club.owner_invite_created', n: 'Sam Specialist' }]);
  });

  it('the status shows sent, then redeemed with the redeemer beside the owner phone; no token anywhere', async () => {
    expect(await svc.getOwnerInvite(spec, CLUB)).toEqual({ ok: true, invite: { status: 'none' } });
    await svc.createOwnerInvite(act(spec), CLUB);
    const pending = await svc.getOwnerInvite(spec, CLUB);
    expect(pending).toMatchObject({ ok: true, invite: { status: 'pending' } });
    expect(JSON.stringify(pending)).not.toContain(tokenOf(mails[0] as InviteMail));
    await redeem(tokenOf(mails[0] as InviteMail), '0999999999');
    expect(await svc.getOwnerInvite(spec, CLUB)).toMatchObject({ ok: true, invite: { status: 'redeemed', redeemer_name: 'Nok L.', redeemer_phone: '0999999999', owner_phone: '0812345678', phone_matches: false } });
  });

  it('a fresh invite replaces the older: the old link no longer works', async () => {
    await svc.createOwnerInvite(act(adminA), CLUB);
    await tdb.setNow('2099-01-01T00:00:00Z');
    await tdb.advance('1 minute');
    await svc.createOwnerInvite(act(adminA), CLUB);
    const [first, second] = mails as [InviteMail, InviteMail];
    expect(await redeem(tokenOf(first))).toEqual([]);
    expect(await redeem(tokenOf(second))).toHaveLength(1);
  });

  it('refuses an unassigned specialist and an unknown club (not_found), missing owner contact, a stale factor, a deactivated account', async () => {
    expect(await svc.createOwnerInvite(act(loner), CLUB)).toEqual({ ok: false, code: 'not_found' });
    expect(await svc.createOwnerInvite(act(adminA), 'aaaaaaaa-0000-4000-8000-0000000000ff')).toEqual({ ok: false, code: 'not_found' });
    expect(await svc.createOwnerInvite(act(adminA), 'nope')).toEqual({ ok: false, code: 'not_found' });
    expect(await svc.createOwnerInvite(act(adminA, false), CLUB)).toEqual({ ok: false, code: 'step_up_required' });
    await tdb.query(`update public.club set owner_email = null where id = $1`, [CLUB]);
    expect(await svc.createOwnerInvite(act(adminA), CLUB)).toEqual({ ok: false, code: 'owner_contact_missing' });
    await tdb.query(`update platform.platform_staff set active = false where id = $1`, [adminA]);
    expect(await svc.createOwnerInvite(act(adminA), CLUB)).toEqual({ ok: false, code: 'not_found' });
    expect(mails).toEqual([]);
  });

  it('a failed email is reported, logged in P6, and the link is not returned', async () => {
    const failing = createOwnerService({ db: pdb, mailer: { sendOwnerInvite: async () => { throw new Error('smtp down'); } }, baseUrl: 'https://app.example.test' });
    const r = await failing.createOwnerInvite(act(spec), CLUB);
    expect(r).toEqual({ ok: false, code: 'mail_failed' });
    expect((await tdb.query(`select action from platform.audit_log order by occurred_at, id`)).rows.map((x) => x.action)).toEqual(['club.owner_invite_created', 'club.owner_invite_mail_failed']);
  });
});

describe('confirming the owner (SR-01: a second admin)', () => {
  it('a different admin confirms an owner whose phone did not match; the creator and a specialist cannot', async () => {
    await svc.createOwnerInvite(act(adminA), CLUB);
    expect(await svc.confirmOwnerVerified(act(adminB), CLUB)).toEqual({ ok: false, code: 'not_redeemed' });
    await redeem(tokenOf(mails[0] as InviteMail), '0999999999');
    expect(await svc.confirmOwnerVerified(act(adminA), CLUB)).toEqual({ ok: false, code: 'same_admin' });
    expect(await svc.confirmOwnerVerified(act(spec), CLUB)).toEqual({ ok: false, code: 'forbidden' });
    expect(await svc.confirmOwnerVerified(act(adminB, false), CLUB)).toEqual({ ok: false, code: 'step_up_required' });
    expect(await svc.confirmOwnerVerified(act(adminB), CLUB)).toEqual({ ok: true });
    expect(await svc.confirmOwnerVerified(act(adminB), CLUB)).toEqual({ ok: false, code: 'already_verified' });
    expect((await tdb.query(`select result, checked_by from platform.launch_check where check_key = 'owner_verified'`)).rows).toEqual([{ result: 'pass', checked_by: adminB }]);
  });
});

describe('owner contact changes (review T18 R5)', () => {
  it('apply at once before an invite; wait for another admin after one', async () => {
    expect(await svc.changeOwnerContact(act(spec), CLUB, { owner_phone: '0877777777' })).toEqual({ ok: true, applied: true });
    await svc.createOwnerInvite(act(adminA), CLUB);
    const r = await svc.changeOwnerContact(act(spec), CLUB, { owner_email: 'new@example.com' });
    if (!r.ok || r.applied) throw new Error('should wait');
    expect((await tdb.query(`select owner_email from public.club where id = $1`, [CLUB])).rows[0].owner_email).toBe('nok@example.com');
    expect(await svc.decideOwnerContactChange(act(spec), CLUB, r.requestId, true)).toEqual({ ok: false, code: 'forbidden' });
    expect(await svc.decideOwnerContactChange(act(adminB), CLUB, r.requestId, true)).toEqual({ ok: true });
    expect((await tdb.query(`select owner_email from public.club where id = $1`, [CLUB])).rows[0].owner_email).toBe('new@example.com');
    expect(await svc.decideOwnerContactChange(act(adminB), CLUB, r.requestId, true)).toEqual({ ok: false, code: 'not_pending' });
  });

  it('refuses a bad body, a Live club without the window, a stale factor, and an admin approving their own request', async () => {
    expect(await svc.changeOwnerContact(act(spec), CLUB, { name_en: 'x' })).toEqual({ ok: false, code: 'invalid' });
    expect(await svc.changeOwnerContact(act(spec), CLUB, {})).toEqual({ ok: false, code: 'invalid' });
    expect(await svc.changeOwnerContact(act(spec), CLUB, null)).toEqual({ ok: false, code: 'invalid' });
    expect(await svc.changeOwnerContact(act(spec), CLUB, { owner_line: '@nok' })).toEqual({ ok: false, code: 'invalid' });
    expect(await svc.changeOwnerContact(act(spec, false), CLUB, { owner_phone: '1' })).toEqual({ ok: false, code: 'step_up_required' });
    expect(await svc.changeOwnerContact(act(loner), CLUB, { owner_phone: '1' })).toEqual({ ok: false, code: 'not_found' });
    await svc.createOwnerInvite(act(adminA), CLUB);
    const r = await svc.changeOwnerContact(act(adminB), CLUB, { owner_line: 'U00000000000000000000000000000003' });
    if (!r.ok || r.applied) throw new Error('should wait');
    expect(await svc.decideOwnerContactChange(act(adminB), CLUB, r.requestId, true)).toEqual({ ok: false, code: 'same_admin' });
    expect(await svc.decideOwnerContactChange(act(adminA), CLUB, r.requestId, false)).toEqual({ ok: true });
    await tdb.query(`update public.club set status = 'live' where id = $1`, [CLUB]);
    expect(await svc.changeOwnerContact(act(adminA), CLUB, { owner_phone: '2' })).toEqual({ ok: false, code: 'look_only' });
  });
});
