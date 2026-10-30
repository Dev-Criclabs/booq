import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestDatabase, type TestDatabase } from './testing/harness';

// F01-T24 / migration 0018: templates and platform.apply_template (PLAT-05-AC7 to AC13, AC15; D8).
const A = '3f2b8f0e-7c1d-4a55-9d0a-1c2e3f4a5b6c';
const B = '9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d';
const ADMIN = '77777777-7777-4777-8777-777777777771';
const SPEC = '77777777-7777-4777-8777-777777777772';

let tdb: TestDatabase;
const id = async (key: string) => (await tdb.query('select id from platform.template where key = $1', [key])).rows[0].id as string;
beforeEach(async () => {
  tdb = await createTestDatabase();
  await tdb.query(`insert into public.club (id, slug, name_th, name_en) values ($1,'a','ก','A'), ($2,'b','ข','B')`, [A, B]);
  await tdb.query(`insert into platform.platform_staff (id, auth_user_id, email, display_name, role) values ($1, gen_random_uuid(), 'a@b.test', 'Ann', 'platform_admin'), ($2, gen_random_uuid(), 's@b.test', 'Sam', 'onboarding_specialist')`, [ADMIN, SPEC]);
});
afterEach(async () => {
  await tdb.close();
});
async function apply(template: string, club = A, staff = ADMIN) {
  const c = await tdb.pool.connect();
  try {
    await c.query('begin');
    await c.query('set local role booq_platform');
    await c.query(`select set_config('app.actor_platform_staff_id', $1, true), set_config('app.club_id', $2, true), set_config('app.actor_label', 'BOOQ staff: Ann', true)`, [staff, club]);
    const r = await c.query('select platform.apply_template($1) as r', [template]);
    await c.query('commit');
    return r.rows[0].r as { template: string; items: Record<string, number> };
  } catch (e) {
    await c.query('rollback');
    throw e;
  } finally {
    c.release();
  }
}
const settings = async (club = A) => Object.fromEntries((await tdb.query('select key, value from public.club_setting where club_id = $1 order by key', [club])).rows.map((r) => [r.key, r.value]));

describe('the templates as data (AC11)', () => {
  it('Tennis and Blank can be chosen; Padel and Pickleball exist but are marked to build', async () => {
    const r = (await tdb.query('select key, to_build from platform.template order by key')).rows;
    expect(r).toEqual([{ key: 'blank', to_build: false }, { key: 'padel', to_build: true }, { key: 'pickleball', to_build: true }, { key: 'tennis', to_build: false }]);
    await expect(apply(await id('padel'))).rejects.toThrow(/to_build/);
    await expect(apply(await id('pickleball'))).rejects.toThrow(/to_build/);
    expect(await settings()).toEqual({});
  });
});

describe('Tennis (AC13, AC15, AC9)', () => {
  it('copies the PRD defaults: hold 15, claim 30, no offers within 2 hours, rest cap 6, groups 4 to 6, hours 06:00 to 24:00', async () => {
    const r = await apply(await id('tennis'));
    expect(r.template).toBe('tennis');
    expect(await settings()).toEqual({
      hold_minutes: 15, waitlist_claim_minutes: 30, waitlist_no_offer_hours: 2, rest_cap_hours: 6,
      group_min_players: 4, group_max_players: 6, package_expiry_reminder_days: [14, 3], package_qr_minutes: 15,
    });
    const hours = (await tdb.query(`select weekday, to_char(open, 'HH24:MI') as open, to_char(close, 'HH24:MI') as close from public.opening_hours order by weekday`)).rows;
    expect(hours).toHaveLength(7);
    expect(hours.every((h) => h.open === '06:00' && h.close === '24:00')).toBe(true);
    expect((await tdb.query('select template_id from public.club where id = $1', [A])).rows[0].template_id).toBe(await id('tennis'));
  });
  it('every TBD stays empty: no row for them, and the booking length is not a setting', async () => {
    await apply(await id('tennis'));
    const keys = Object.keys(await settings());
    for (const tbd of ['max_future_court_hours', 'below_min_alert_minutes', 'wallet_expiry_months', 'referral_reward', 'friend_discount', 'birthday_discount', 'coach_pay', 'head_coach_price']) {
      expect(keys, tbd).not.toContain(tbd);
    }
    expect(keys.some((k) => /booking_length|duration|minutes_per_booking/.test(k))).toBe(false);
  });
  it('the template holds no value the spec does not give: its items are exactly the seeded ones', async () => {
    const items = (await tdb.query(`select kind, count(*)::int as n from platform.template_item i join platform.template t on t.id = i.template_id where t.key = 'tennis' group by kind order by kind`)).rows;
    expect(items).toEqual([{ kind: 'opening_hours', n: 7 }, { kind: 'setting', n: 8 }, { kind: 'sport', n: 1 }]);
  });
});

describe('Blank (AC8)', () => {
  it('copies nothing: no setting, no hours, no product, and the template is still recorded', async () => {
    await apply(await id('blank'));
    expect(await settings()).toEqual({});
    expect((await tdb.query('select count(*)::int as n from public.opening_hours')).rows[0].n).toBe(0);
    expect((await tdb.query('select template_id from public.club where id = $1', [A])).rows[0].template_id).toBe(await id('blank'));
  });
});

describe('a copy, once (AC7, AC12)', () => {
  it('a later edit of the template changes no existing club; a new club gets the new value', async () => {
    await apply(await id('tennis'));
    await tdb.query(`update platform.template_item set value = '20'::jsonb where key = 'hold_minutes'`);
    expect((await settings()).hold_minutes).toBe(15);
    await apply(await id('tennis'), B);
    expect((await settings(B)).hold_minutes).toBe(20);
  });
  it('a club is started from a template once, and only in Draft', async () => {
    await apply(await id('tennis'));
    await expect(apply(await id('tennis'))).rejects.toThrow(/already_started/);
    await expect(apply(await id('blank'))).rejects.toThrow(/already_started/);
    await tdb.query(`update public.club set status = 'testing', template_id = null where id = $1`, [B]);
    await expect(apply(await id('tennis'), B)).rejects.toThrow(/already_started/);
  });
  it('the choice and the copy are audited in the club’s log and in P6, with the staff member', async () => {
    await apply(await id('tennis'));
    const note = (await tdb.query(`select actor_type, actor_label, new_value from public.audit_entry where action = 'template.applied'`)).rows;
    expect(note).toEqual([{ actor_type: 'platform_staff', actor_label: 'BOOQ staff: Ann', new_value: { template: 'tennis', items: { setting: 8, opening_hours: 7, sport: 1 } } }]);
    const p6 = (await tdb.query(`select staff_name_at_time, action, detail from platform.audit_log where action = 'club.template_applied'`)).rows;
    expect(p6).toHaveLength(1);
    expect(p6[0]).toMatchObject({ staff_name_at_time: 'Ann', detail: { template: 'tennis' } });
    expect((await tdb.query(`select count(*)::int as n from public.audit_entry where record_type = 'club_setting' and action = 'insert'`)).rows[0].n).toBe(8);
  });
});

describe('who may, and the handler registry', () => {
  it('an unassigned specialist gets "not found"; an assigned one can; a missing template is not found', async () => {
    await expect(apply(await id('tennis'), A, SPEC)).rejects.toThrow(/not_found/);
    await tdb.query('insert into platform.staff_assignment (staff_id, club_id) values ($1,$2)', [SPEC, A]);
    await apply(await id('tennis'), A, SPEC);
    await expect(apply('00000000-0000-4000-8000-00000000ffff', B)).rejects.toThrow(/not_found/);
  });
  it('the app roles cannot call it', async () => {
    for (const role of ['booq_app', 'booq_worker']) {
      expect((await tdb.query(`select has_function_privilege($1, 'platform.apply_template(uuid)', 'execute') as ok`, [role])).rows[0].ok, role).toBe(false);
    }
  });
  it('a later feature’s items go to its registered handler; an item with no handler stops the whole copy', async () => {
    await tdb.query(`
      create table public.t_copied (club_id uuid, key text, value jsonb);
      create function app.t_handler(p_club uuid, p_key text, p_value jsonb) returns void language sql as $$ insert into public.t_copied values (p_club, p_key, p_value) $$;
      grant insert on public.t_copied to booq_owner;
      insert into app.template_handlers (kind, handler) values ('t_kind', 'app.t_handler(uuid,text,jsonb)'::regprocedure);
      insert into platform.template (key, name) values ('t', 'T');
      insert into platform.template_item (template_id, kind, key, value) select id, 't_kind', 'k1', '{"p": 1}' from platform.template where key = 't';
      insert into platform.template (key, name) values ('u', 'U');
      insert into platform.template_item (template_id, kind, key, value) select id, 'unknown_kind', 'k', '1' from platform.template where key = 'u';`);
    const r = await apply(await id('t'));
    expect(r.items).toEqual({ t_kind: 1 });
    expect((await tdb.query('select key, value from public.t_copied')).rows).toEqual([{ key: 'k1', value: { p: 1 } }]);
    await expect(apply(await id('u'), B)).rejects.toThrow(/no_handler:unknown_kind/);
    expect((await tdb.query('select template_id from public.club where id = $1', [B])).rows[0].template_id).toBeNull();
  });
});
