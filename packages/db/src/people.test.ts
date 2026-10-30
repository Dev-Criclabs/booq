import type { PoolClient } from 'pg';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { collectRegistry } from './registry';
import { checkTableClasses } from './registry/check';
import { createDb, type Db } from './tx';
import { createTestDatabase, type TestDatabase } from './testing/harness';

// F01-T12 / migration 0003: people, roles, consent, invites, testers (ROLE-01, PDPA-01-AC2, AC6;
// D100, D115, D122, SR-01).
const A = '3f2b8f0e-7c1d-4a55-9d0a-1c2e3f4a5b6c';
const B = '9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d';
const U1 = '11111111-1111-4111-8111-111111111111';
const U2 = '22222222-2222-4222-8222-222222222222';
const U3 = '33333333-3333-4333-8333-333333333333';
const STAFF = '77777777-7777-4777-8777-777777777777';

let tdb: TestDatabase;
let db: Db;

beforeEach(async () => {
  tdb = await createTestDatabase();
  await tdb.query(`insert into public.club (id, slug, name_th, name_en) values ($1,'a','ก','A'), ($2,'b','ข','B')`, [A, B]);
  db = createDb({ connectionString: tdb.url, max: 4 });
});
afterEach(async () => {
  await db.end();
  await tdb.close();
});

/** Insert a person with roles in one transaction (the roles are checked at commit). */
async function person(club: string, id: string, line: string | null, roles: string[] = ['player']) {
  const c = await tdb.pool.connect();
  try {
    await c.query('begin');
    await c.query('insert into public.app_user (club_id, id, line_user_id, display_name) values ($1,$2,$3,$4)', [club, id, line, 'p-' + id.slice(0, 2)]);
    for (const r of roles) await c.query('insert into public.app_user_role (club_id, user_id, role) values ($1,$2,$3)', [club, id, r]);
    await c.query('commit');
  } catch (e) {
    await c.query('rollback');
    throw e;
  } finally {
    c.release();
  }
}
const tx = async (fn: (c: PoolClient) => Promise<unknown>) => {
  const c = await tdb.pool.connect();
  try {
    await c.query('begin');
    await fn(c);
    await c.query('commit');
  } catch (e) {
    await c.query('rollback');
    throw e;
  } finally {
    c.release();
  }
};
const ctx = (roles: string[], userId = U1, club = A) => ({ clubId: club, userId, roles, source: 'admin' as const });

describe('a person keeps the Player role, so at least one role (ROLE-01-AC7, D115)', () => {
  it('a person with no role is refused at commit', async () => {
    await expect(tx((c) => c.query('insert into public.app_user (club_id, id) values ($1,$2)', [A, U1]))).rejects.toThrow(/player role/);
  });
  it('a person with only a coach role is refused: Player is always there', async () => {
    await expect(person(A, U1, 'L1', ['coach'])).rejects.toThrow(/player role/);
    await person(A, U1, 'L1', ['coach', 'player']);
  });
  it('removing the last role is refused; removing Player from a coach is refused too', async () => {
    await person(A, U1, 'L1', ['player']);
    await expect(tx((c) => c.query(`delete from public.app_user_role where user_id = $1`, [U1]))).rejects.toThrow(/player role/);
    await person(A, U2, 'L2', ['player', 'coach']);
    await expect(tx((c) => c.query(`delete from public.app_user_role where user_id = $1 and role = 'player'`, [U2]))).rejects.toThrow(/player role/);
    await tx((c) => c.query(`delete from public.app_user_role where user_id = $1 and role = 'coach'`, [U2])); // coach goes, player stays
  });
  it('a deactivated person need not hold roles; reactivating needs Player', async () => {
    await person(A, U1, 'L1', ['player']);
    await tx(async (c) => {
      await c.query('update public.app_user set active = false where id = $1', [U1]);
      await c.query('delete from public.app_user_role where user_id = $1', [U1]);
    });
    await expect(tx((c) => c.query('update public.app_user set active = true where id = $1', [U1]))).rejects.toThrow(/player role/);
  });
  it('a role must be one of the five', async () => {
    await expect(person(A, U1, 'L1', ['player', 'admin'])).rejects.toThrow(/check/i);
  });
});

describe('a club past Draft keeps an active owner (A-3)', () => {
  beforeEach(async () => {
    await person(A, U1, 'L1', ['owner', 'player']);
    await person(A, U2, 'L2', ['owner', 'player']);
  });
  it('removing the last owner of a live club is refused', async () => {
    await tdb.query(`update public.club set status = 'live' where id = $1`, [A]);
    await tx((c) => c.query(`delete from public.app_user_role where user_id = $1 and role = 'owner'`, [U1])); // another owner remains
    await expect(tx((c) => c.query(`delete from public.app_user_role where user_id = $1 and role = 'owner'`, [U2]))).rejects.toThrow(/active owner/);
  });
  it('deactivating the last owner is refused', async () => {
    await tdb.query(`update public.club set status = 'live' where id = $1`, [A]);
    await tx((c) => c.query('update public.app_user set active = false where id = $1', [U1]));
    await expect(tx((c) => c.query('update public.app_user set active = false where id = $1', [U2]))).rejects.toThrow(/active owner/);
  });
  it('a Draft club may lose its owner', async () => {
    await tx((c) => c.query(`delete from public.app_user_role where role = 'owner'`));
  });
  it('swapping the owner in one transaction is fine (checked at commit)', async () => {
    await tdb.query(`update public.club set status = 'live' where id = $1`, [A]);
    await tx(async (c) => {
      await c.query(`delete from public.app_user_role where role = 'owner'`);
      await c.query(`insert into public.app_user_role (club_id, user_id, role) values ($1,$2,'owner')`, [A, U1]);
    });
  });
  it('the rule is per club', async () => {
    await tdb.query(`update public.club set status = 'live'`);
    await person(B, U3, 'L3', ['owner', 'player']);
    await tx((c) => c.query(`delete from public.app_user_role where club_id = $1 and role = 'owner'`, [A]).catch(() => undefined)).catch(() => undefined);
    expect((await tdb.query(`select count(*)::int as n from public.app_user_role where club_id = $1 and role = 'owner'`, [B])).rows[0].n).toBe(1);
  });
});

describe('who can read what (PDPA-01, D35)', () => {
  beforeEach(async () => {
    await person(A, U1, 'L1', ['owner', 'player']);
    await person(A, U2, 'L2', ['player']);
    await person(B, U3, 'L3', ['player']);
    await tdb.query(`insert into public.user_staff_note (club_id, user_id, note, created_by) values ($1,$2,'late payer',$3)`, [A, U2, U1]);
  });
  const names = (roles: string[], user: string) => db.withClubTx(ctx(roles, user), (t) => t.query('select id from public.app_user order by id')).then((r) => r.rows.map((x) => x.id));

  it('staff notes are unreadable by the player, the coach and the accountant; owner and front desk read them', async () => {
    for (const roles of [['player'], ['coach', 'player'], ['accountant', 'player']]) {
      const r = await db.withClubTx(ctx(roles, U2), (t) => t.query('select note from public.user_staff_note'));
      expect(r.rows, roles.join()).toEqual([]);
    }
    expect((await db.withClubTx(ctx(['owner', 'player']), (t) => t.query('select note from public.user_staff_note'))).rows).toEqual([{ note: 'late payer' }]);
    expect((await db.withClubTx(ctx(['front_desk', 'player'], U1), (t) => t.query('select note from public.user_staff_note'))).rows).toHaveLength(1);
  });
  it('a player cannot write a staff note', async () => {
    await expect(
      db.withClubTx(ctx(['player'], U2), (t) => t.query(`insert into public.user_staff_note (club_id, user_id, note, created_by) values ($1,$2,'x',$2)`, [A, U2])),
    ).rejects.toThrow(/row-level security|permission denied/);
  });
  it('a player sees only their own row; staff see the club; the accountant sees none; no club sees the other', async () => {
    expect(await names(['player'], U2)).toEqual([U2]);
    expect(await names(['owner', 'player'], U1)).toEqual([U1, U2]);
    expect(await names(['accountant', 'player'], U2)).toEqual([U2]); // only as the person they are; no staff view
    expect(await db.withClubTx(ctx(['accountant'], '44444444-4444-4444-8444-444444444444'), (t) => t.query('select id from public.app_user'))).toMatchObject({ rows: [] });
    expect(await names(['owner', 'player'], U3)).not.toContain(U3);
  });
  it('a player cannot make themselves an owner or reactivate/deactivate beyond their rights', async () => {
    await expect(db.withClubTx(ctx(['player'], U2), (t) => t.query(`insert into public.app_user_role (club_id, user_id, role) values ($1,$2,'owner')`, [A, U2]))).rejects.toThrow(/row-level security|permission denied/);
    await expect(db.withClubTx(ctx(['player'], U2), (t) => t.query(`update public.app_user set active = false where id = $1`, [U2]))).rejects.toThrow(/row-level security/);
    await expect(db.withClubTx(ctx(['player'], U2), (t) => t.query(`update public.app_user set line_user_id = 'x' where id = $1`, [U2]))).rejects.toThrow(/permission denied/);
  });
  it('BOOQ staff have no privilege on any people table (class D)', async () => {
    for (const t of ['app_user', 'app_user_role', 'user_staff_note', 'user_consent', 'club_invite', 'club_tester']) {
      for (const priv of ['select', 'insert', 'update', 'delete']) {
        expect((await tdb.query('select has_table_privilege($1, $2, $3) as ok', ['booq_platform', `public.${t}`, priv])).rows[0].ok, `${t} ${priv}`).toBe(false);
      }
    }
  });
});

describe('consent is append-only (PDPA-01-AC2)', () => {
  it('records language and notice version; cannot be edited or deleted', async () => {
    await person(A, U2, 'L2');
    await db.withClubTx(ctx(['player'], U2), (t) => t.query(`insert into public.user_consent (club_id, user_id, notice_version, language) values ($1,$2,'v1','th')`, [A, U2]));
    await expect(tdb.query(`update public.user_consent set language = 'en'`)).rejects.toThrow(/append-only/);
    await expect(tdb.query('delete from public.user_consent')).rejects.toThrow(/append-only/);
    await expect(tdb.query(`insert into public.user_consent (club_id, user_id, notice_version, language) values ($1,$2,'v1','de')`, [A, U2])).rejects.toThrow(/check/i);
  });
  it("a player cannot record consent for someone else", async () => {
    await person(A, U1, 'L1');
    await person(A, U2, 'L2');
    await expect(db.withClubTx(ctx(['player'], U2), (t) => t.query(`insert into public.user_consent (club_id, user_id, notice_version, language) values ($1,$2,'v1','th')`, [A, U1]))).rejects.toThrow(/row-level security/);
  });
});

describe('invites (SR-01, D115, D122)', () => {
  const future = "now() + interval '3 days'";
  const mk = (kind: string, roles: string[], extra: { bound?: string | null; staff?: string | null; user?: string | null } = {}) =>
    tdb.query(
      `insert into public.club_invite (club_id, token_hash, kind, roles, bound_line_user_id, created_by_staff, created_by_user, expires_at)
       values ($1, md5(random()::text), $2, $3, $4, $5, $6, ${future})`,
      [A, kind, roles, extra.bound ?? null, extra.staff ?? null, extra.user ?? null],
    );
  beforeEach(async () => {
    await person(A, U1, 'L1', ['owner', 'player']);
    await tdb.query(`insert into platform.platform_staff (id, auth_user_id, email, display_name, role) values ($1, gen_random_uuid(), 'm@booq.test', 'Mali', 'platform_admin')`, [STAFF]);
  });

  it('every kind carries the Player role; the roles must match the kind', async () => {
    await mk('owner', ['owner', 'player'], { bound: 'L9', staff: STAFF });
    await mk('tester', ['player'], { staff: STAFF });
    await mk('coach', ['player', 'coach'], { user: U1 });
    await mk('staff', ['front_desk', 'player'], { user: U1 });
    await expect(mk('owner', ['owner'], { bound: 'L9', staff: STAFF })).rejects.toThrow(/roles_for_kind/);
    await expect(mk('tester', ['player', 'owner'], { staff: STAFF })).rejects.toThrow(/roles_for_kind/);
    await expect(mk('staff', ['front_desk'], { user: U1 })).rejects.toThrow(/roles_for_kind/);
    await expect(mk('staff', ['owner', 'player'], { user: U1 })).rejects.toThrow(/roles_for_kind/);
    await expect(mk('coach', ['coach'], { user: U1 })).rejects.toThrow(/roles_for_kind/);
  });
  it('an owner invite is bound to one LINE ID', async () => {
    await expect(mk('owner', ['owner', 'player'], { staff: STAFF })).rejects.toThrow(/owner_bound/);
  });
  it('a platform account cannot create a staff or coach invite; there is exactly one creator', async () => {
    await expect(mk('staff', ['front_desk', 'player'], { staff: STAFF })).rejects.toThrow(/platform_kinds/);
    await expect(mk('coach', ['coach', 'player'], { staff: STAFF })).rejects.toThrow(/platform_kinds/);
    await expect(mk('tester', ['player'])).rejects.toThrow(/one_creator/);
    await expect(mk('tester', ['player'], { staff: STAFF, user: U1 })).rejects.toThrow(/one_creator/);
  });
  it('only an owner creates staff and coach invites through the app; the token hash is never selectable by others', async () => {
    const own = ctx(['owner', 'player']);
    await db.withClubTx(own, (t) => t.query(`insert into public.club_invite (club_id, token_hash, kind, roles, created_by_user, expires_at) values ($1,'h1','coach','{coach,player}',$2, now() + interval '1 day')`, [A, U1]));
    await expect(db.withClubTx(own, (t) => t.query(`insert into public.club_invite (club_id, token_hash, kind, roles, bound_line_user_id, created_by_user, expires_at) values ($1,'h2','owner','{owner,player}','L8',$2, now() + interval '1 day')`, [A, U1]))).rejects.toThrow(/row-level security/);
    await expect(db.withClubTx(ctx(['front_desk', 'player']), (t) => t.query(`insert into public.club_invite (club_id, token_hash, kind, roles, created_by_user, expires_at) values ($1,'h3','coach','{coach,player}',$2, now() + interval '1 day')`, [A, U1]))).rejects.toThrow(/row-level security/);
    expect((await db.withClubTx(ctx(['player'], U1), (t) => t.query('select * from public.club_invite'))).rows).toEqual([]);
  });

  describe('redeeming (one atomic statement)', () => {
    const hash = 'tok-hash';
    const redeem = (user: string, line: string, club = A, h = hash) =>
      db.withClubTx({ clubId: club, userId: user, roles: [], source: 'player_app' }, (t) => t.query('select * from app.redeem_invite($1,$2,$3)', [h, line, user]));
    const invite = (kind: string, roles: string[], bound: string | null, user: string | null, staff: string | null, expires = future, h = hash) =>
      tdb.query(
        `insert into public.club_invite (club_id, token_hash, kind, roles, bound_line_user_id, created_by_staff, created_by_user, expires_at) values ($1,$2,$3,$4,$5,$6,$7, ${expires})`,
        [A, h, kind, roles, bound, staff, user],
      );
    // The redeemer exists as a person (a pending signup becomes a row in the same transaction in F02) without roles yet:
    // the Player role arrives with the redemption, so the row is created deferred-checked in one transaction.
    const newcomer = async (id: string, line: string) => {
      const c = await tdb.pool.connect();
      try {
        await c.query('begin');
        await c.query('insert into public.app_user (club_id, id, line_user_id) values ($1,$2,$3)', [A, id, line]);
        await c.query(`insert into public.app_user_role (club_id, user_id, role) values ($1,$2,'player')`, [A, id]);
        await c.query('commit');
      } finally {
        c.release();
      }
    };

    it('a coach invite grants Coach and Player and is then used up', async () => {
      await newcomer(U2, 'L2');
      await invite('coach', ['coach', 'player'], null, U1, null);
      const r = await redeem(U2, 'L2');
      expect(r.rows[0]).toMatchObject({ kind: 'coach' });
      const roles = (await tdb.query(`select role from public.app_user_role where user_id = $1 order by role`, [U2])).rows.map((x) => x.role);
      expect(roles).toEqual(['coach', 'player']);
      expect((await redeem(U2, 'L2')).rows).toEqual([]); // single use
    });
    it('two parallel redemptions have one winner', async () => {
      await newcomer(U2, 'L2');
      await newcomer(U3, 'L3');
      await invite('coach', ['coach', 'player'], null, U1, null);
      const results = await Promise.all([redeem(U2, 'L2'), redeem(U3, 'L3')]);
      expect(results.map((r) => r.rows.length).sort()).toEqual([0, 1]);
      expect((await tdb.query(`select count(*)::int as n from public.app_user_role where role = 'coach'`)).rows[0].n).toBe(1);
    });
    it('a tester invite can produce no role but Player, and adds the tester record', async () => {
      await newcomer(U2, 'L2');
      await invite('tester', ['player'], null, null, STAFF);
      await redeem(U2, 'L2');
      expect((await tdb.query(`select role from public.app_user_role where user_id = $1`, [U2])).rows).toEqual([{ role: 'player' }]);
      expect((await tdb.query(`select kind, removed_at from public.club_tester where user_id = $1`, [U2])).rows).toEqual([{ kind: 'boq_tester', removed_at: null }]);
    });
    it('an owner invite is refused for any LINE ID but the bound one, and is not burned by the refusal', async () => {
      await newcomer(U2, 'L2');
      await newcomer(U3, 'L3');
      await invite('owner', ['owner', 'player'], 'L2', null, STAFF);
      expect((await redeem(U3, 'L3')).rows).toEqual([]);
      expect((await tdb.query(`select used_at from public.club_invite`)).rows[0].used_at).toBeNull();
      expect((await redeem(U2, 'L2')).rows[0]).toMatchObject({ kind: 'owner' });
      expect((await tdb.query(`select role from public.app_user_role where user_id = $1 order by role`, [U2])).rows.map((x) => x.role)).toEqual(['owner', 'player']);
    });
    it('an expired invite and an unknown token give nothing', async () => {
      await newcomer(U2, 'L2');
      await invite('coach', ['coach', 'player'], null, U1, null, "now() + interval '1 hour'");
      await tdb.setNow(new Date(Date.now() + 2 * 3600_000));
      expect((await redeem(U2, 'L2')).rows).toEqual([]);
      expect((await redeem(U2, 'L2', A, 'nope')).rows).toEqual([]);
    });
    it('the person must be that LINE user in this club, and an invite of another club is invisible', async () => {
      await newcomer(U2, 'L2');
      await invite('coach', ['coach', 'player'], null, U1, null);
      await expect(redeem(U2, 'someone-else')).rejects.toThrow(/not that LINE user/);
      await person(B, U3, 'L2');
      expect((await redeem(U3, 'L2', B)).rows).toEqual([]);
    });
    it('is not callable by the worker or the platform role', async () => {
      for (const role of ['booq_worker', 'booq_platform']) {
        expect((await tdb.query(`select has_function_privilege($1, 'app.redeem_invite(text,text,uuid)', 'execute') as ok`, [role])).rows[0].ok, role).toBe(false);
      }
    });
  });
});

describe('test accounts (D100, PLAT-07)', () => {
  it('rows of a person follow the person; roles of a normal account are not test data even in Testing', async () => {
    await tdb.query(`update public.club set status = 'testing' where id = $1`, [A]);
    await person(A, U1, 'L1', ['owner', 'player']); // is_test false (not made through a tester invite)
    expect((await tdb.query('select is_test from public.app_user_role')).rows.every((r) => r.is_test === false)).toBe(true);
  });
  it('the flag of a person cannot be changed afterwards', async () => {
    await person(A, U1, 'L1');
    await expect(tdb.query('update public.app_user set is_test = true')).rejects.toThrow(/cannot be changed/);
  });
});

describe('audit and registry', () => {
  it('a role grant is audited; personal values land in pii columns only', async () => {
    await tx(async (c) => {
      await c.query(`select set_config('app.source','admin',true)`);
      await c.query('insert into public.app_user (club_id, id, line_user_id, display_name) values ($1,$2,$3,$4)', [A, U1, 'Uline123', 'Nok']);
      await c.query(`insert into public.app_user_role (club_id, user_id, role) values ($1,$2,'player')`, [A, U1]);
    });
    const e = (await tdb.query(`select * from public.audit_entry where record_type = 'app_user'`)).rows[0];
    expect(JSON.stringify([e.old_value, e.new_value])).not.toContain('Uline123');
    expect(e.pii_new).toMatchObject({ line_user_id: 'Uline123', display_name: 'Nok' });
    expect((await tdb.query(`select count(*)::int as n from public.audit_entry where record_type = 'app_user_role'`)).rows[0].n).toBe(1);
  });
  it('an invite token hash never appears in the audit entry', async () => {
    await person(A, U1, 'L1', ['owner', 'player']);
    await tdb.query(`insert into public.club_invite (club_id, token_hash, kind, roles, created_by_user, expires_at) values ($1,'SECRET-HASH','coach','{coach,player}',$2, now() + interval '1 day')`, [A, U1]);
    const rows = (await tdb.query(`select * from public.audit_entry where record_type = 'club_invite'`)).rows;
    expect(rows).toHaveLength(1);
    expect(JSON.stringify(rows)).not.toContain('SECRET-HASH');
  });
  it('every table is classified and the checks pass', async () => {
    const r = await checkTableClasses(tdb.pool, await collectRegistry());
    expect(r.problems.filter((p) => p.table !== 'app.test_clock')).toEqual([]);
  });
});
