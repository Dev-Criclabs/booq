import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createDb, type Db } from './tx';
import { createPlatformDb, type PlatformDb } from './platform-tx';
import { createTestDatabase, type TestDatabase } from './testing/harness';

// F01-T24 / migration 0039: templates and app.apply_template (PLAT-05-AC7 to AC15, AC16; design 9.1).
const CLUB = '3f2b8f0e-7c1d-4a55-9d0a-1c2e3f4a5b6c';
const OTHER = '9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d';
const USER = '11111111-2222-4333-8444-555555555555';

let tdb: TestDatabase;
let db: Db;
let pdb: PlatformDb;
let admin: string;
let spec: string;
let loner: string;

async function staff(email: string, role: string, auth: string, name: string): Promise<string> {
  return (await tdb.query(`insert into platform.platform_staff (auth_user_id, email, display_name, role) values ($1, $2, $3, $4) returning id`, [auth, email, name, role])).rows[0].id;
}
const tpl = async (key: string) => (await tdb.query(`select id from platform.template where key = $1`, [key])).rows[0].id as string;
const items = async (key: string, kind?: string) =>
  (await tdb.query(`select i.kind, i.key, i.value from platform.template_item i join platform.template t on t.id = i.template_id where t.key = $1 ${kind ? `and i.kind = '${kind}'` : ''} order by kind, i.key`, [key])).rows;
const apply = (who: string, key: string, club = CLUB) =>
  tdb.query(`select 1`).then(async () => pdb.withPlatformTx({ staffId: who, staffLabel: 'Staff', clubId: club }, async (tx) => (await tx.query(`select app.apply_template($1) as r`, [await tpl(key)])).rows[0]?.r));
const settings = async (club = CLUB) => Object.fromEntries((await tdb.query(`select key, value from public.club_setting where club_id = $1`, [club])).rows.map((r) => [r.key, r.value]));
const applyAsOwner = async (key: string, roles: string[] = ['owner', 'player'], club = CLUB) =>
  db.withClubTx({ clubId: club, userId: USER, roles, source: 'admin' }, async (tx) => (await tx.query(`select app.apply_template($1) as r`, [await tpl(key)])).rows[0]?.r);

beforeEach(async () => {
  tdb = await createTestDatabase();
  await tdb.query(`insert into public.club (id, slug, name_th, name_en) values ($1, 'a', 'ก', 'A'), ($2, 'b', 'ข', 'B')`, [CLUB, OTHER]);
  admin = await staff('admin@booq.example', 'platform_admin', '99999999-0000-4000-8000-000000000001', 'Ada Admin');
  spec = await staff('spec@booq.example', 'onboarding_specialist', '99999999-0000-4000-8000-000000000002', 'Sam Specialist');
  loner = await staff('loner@booq.example', 'onboarding_specialist', '99999999-0000-4000-8000-000000000003', 'Lee Loner');
  await tdb.query(`insert into platform.staff_assignment (staff_id, club_id) values ($1, $2)`, [spec, CLUB]);
  db = createDb({ connectionString: tdb.url, max: 1 });
  pdb = createPlatformDb({ connectionString: tdb.url, max: 1 });
});
afterEach(async () => {
  await db.end();
  await pdb.end();
  await tdb.close();
});

describe('the templates (PLAT-05-AC11)', () => {
  it('Tennis and Blank can be chosen; Padel and Pickleball exist and are marked to build', async () => {
    const r = await tdb.query(`select key, to_build from platform.template order by key`);
    expect(r.rows).toEqual([{ key: 'blank', to_build: false }, { key: 'padel', to_build: true }, { key: 'pickleball', to_build: true }, { key: 'tennis', to_build: false }]);
  });

  it('Padel, Pickleball and Blank carry no values; Blank copies nothing (AC8)', async () => {
    for (const k of ['blank', 'padel', 'pickleball']) expect(await items(k), k).toEqual([]);
  });
});

describe('the Tennis template equals the spec (PLAT-05-AC13, AC15, AC16)', () => {
  const value = async (kind: string, key: string) => (await items('tennis', kind)).find((i) => i.key === key)?.value;

  it('carries the PRD default rules', async () => {
    const s = Object.fromEntries((await items('tennis', 'setting')).map((i) => [i.key, i.value]));
    expect(s).toMatchObject({
      hold_minutes: 15, waitlist_claim_minutes: 30, waitlist_no_offer_hours: 2, rest_cap_hours: 6,
      group_min_players: 4, group_max_players: 6, booking_window_days: 30, cancel_window_hours: 12,
      package_qr_minutes: 15, package_expiry_reminder_days: [14, 3], vat_enabled: false,
    });
  });

  it('every TBD value is empty, never a made-up number (AC9)', async () => {
    const s = Object.fromEntries((await items('tennis', 'setting')).map((i) => [i.key, i.value]));
    for (const k of ['max_future_court_hours', 'below_min_alert_minutes', 'wallet_expiry_months']) expect(s[k], k).toBeNull();
  });

  it('prices are the final offer, in integer satang (court 500 baht is 50000)', async () => {
    expect(await value('price', 'court_hour')).toEqual({ price_satang: 50000 });
    const p = Object.fromEntries((await items('tennis', 'product')).map((i) => [i.key, i.value]));
    expect(p).toEqual({
      bundle_10h: { type: 'court_hours', quantity: 10, validity_months: 3, price_satang: 450000 },
      bundle_20h: { type: 'court_hours', quantity: 20, validity_months: 5, price_satang: 800000 },
      solo_single_adult: { type: 'solo_class', audience: 'adult', quantity: 1, validity_months: null, price_satang: 80000 },
      solo_pack8_adult: { type: 'solo_class', audience: 'adult', quantity: 8, validity_months: 3, price_satang: 560000 },
      solo_single_student: { type: 'solo_class', audience: 'student', quantity: 1, validity_months: null, price_satang: 70000 },
      solo_pack8_student: { type: 'solo_class', audience: 'student', quantity: 8, validity_months: 3, price_satang: 480000 },
      group_single_adult: { type: 'group_class', audience: 'adult', quantity: 1, validity_months: null, price_satang: 60000 },
      group_pack8_adult: { type: 'group_class', audience: 'adult', quantity: 8, validity_months: 3, price_satang: 400000 },
      group_single_student: { type: 'group_class', audience: 'student', quantity: 1, validity_months: null, price_satang: 50000 },
      group_pack8_student: { type: 'group_class', audience: 'student', quantity: 8, validity_months: 3, price_satang: 320000 },
    });
    for (const v of Object.values(p)) expect(Number.isInteger((v as { price_satang: number }).price_satang)).toBe(true);
  });

  it('opens 06:00 to 24:00 every day, uses the court label, and has no booking length (fixed at 60 minutes, not a template value)', async () => {
    const h = await items('tennis', 'opening_hours');
    expect(h.map((x) => x.key)).toEqual(['1', '2', '3', '4', '5', '6', '7']);
    for (const x of h) expect(x.value).toEqual({ open: '06:00', close: '24:00' });
    expect(await value('label', 'resource')).toBe('court');
    const all = await tdb.query(`select key from platform.template_item`);
    expect(all.rows.filter((r) => /length|duration|booking_minutes|slot/i.test(r.key))).toEqual([]);
  });
});

describe('applying a template (PLAT-05-AC7, AC8, AC10, AC12)', () => {
  it('Tennis: the settings, opening hours and label become the club\'s own values; the TBDs stay unset', async () => {
    const r = await apply(spec, 'tennis');
    expect(r).toMatchObject({ template: 'tennis', copied: { setting: 11, opening_hours: 7, label: 1 } });
    const s = await settings();
    expect(s).toMatchObject({ hold_minutes: 15, waitlist_claim_minutes: 30, rest_cap_hours: 6, group_max_players: 6, vat_enabled: false, resource_label: 'court' });
    for (const k of ['max_future_court_hours', 'below_min_alert_minutes', 'wallet_expiry_months']) expect(s).not.toHaveProperty(k);
    expect((await tdb.query(`select weekday, open::text, close::text from public.opening_hours where club_id = $1 order by weekday`, [CLUB])).rows).toHaveLength(7);
    const c = (await tdb.query(`select template_id, template_applied_at from public.club where id = $1`, [CLUB])).rows[0];
    expect(c.template_id).toBe(await tpl('tennis'));
    expect(c.template_applied_at).not.toBeNull();
  });

  it('products and prices wait for the handlers F04 and F06 register: they are listed as pending, and run once they exist', async () => {
    const r = await apply(spec, 'tennis');
    expect(r.pending.sort()).toEqual(['price', 'product']);
    await tdb.query(`create table public.__copied (club_id uuid, kind text, key text, value jsonb)`);
    await tdb.query(`grant all on public.__copied to booq_owner`);
    await tdb.query(`create function public.__copy(p_club uuid, p_key text, p_value jsonb) returns void language sql as $$ insert into public.__copied values (p_club, 'product', p_key, p_value) $$`);
    await tdb.query(`select app.register_template_handler('product', 'public.__copy(uuid, text, jsonb)'::regprocedure)`);
    const r2 = await apply(admin, 'tennis', OTHER);
    expect(r2).toMatchObject({ copied: { product: 10 }, pending: ['price'] });
    expect((await tdb.query(`select count(*)::int as n from public.__copied where club_id = $1`, [OTHER])).rows[0].n).toBe(10);
    expect((await tdb.query(`select value from public.__copied where key = 'bundle_10h'`)).rows[0].value.price_satang).toBe(450000);
  });

  it('Blank copies nothing: no settings, no hours, no products (AC8); the template is still recorded', async () => {
    const r = await apply(admin, 'blank');
    expect(r.copied).toEqual({});
    expect(await settings()).toEqual({});
    expect((await tdb.query(`select count(*)::int as n from public.opening_hours`)).rows[0].n).toBe(0);
    expect((await tdb.query(`select template_id from public.club where id = $1`, [CLUB])).rows[0].template_id).toBe(await tpl('blank'));
  });

  it('a later change to the template does not change a club that started from it (AC7)', async () => {
    await apply(spec, 'tennis');
    await tdb.query(`update platform.template_item set value = '99'::jsonb where key = 'hold_minutes'`);
    await tdb.query(`insert into platform.template_item (template_id, kind, key, value) select id, 'setting', 'extra', '1' from platform.template where key = 'tennis'`);
    const s = await settings();
    expect(s['hold_minutes']).toBe(15);
    expect(s).not.toHaveProperty('extra');
  });

  it('the copy is written to the club audit log, and the template recorded on the club (AC12)', async () => {
    await apply(spec, 'tennis');
    const notes = (await tdb.query(`select action, actor_type, new_value from public.audit_entry where club_id = $1 and action = 'template.applied'`, [CLUB])).rows;
    expect(notes).toHaveLength(1);
    expect(notes[0]).toMatchObject({ actor_type: 'platform_staff' });
    const rows = (await tdb.query(`select count(*)::int as n from public.audit_entry where club_id = $1 and record_type = 'club_setting'`, [CLUB])).rows[0].n;
    expect(rows).toBeGreaterThanOrEqual(11);
  });

  it('refuses Padel and Pickleball (to build), an unknown template, a second application, and a club that is already Live', async () => {
    await expect(apply(admin, 'padel')).rejects.toThrow(/template:to_build/);
    await expect(apply(admin, 'pickleball')).rejects.toThrow(/template:to_build/);
    await expect(pdb.withPlatformTx({ staffId: admin, staffLabel: 'S', clubId: CLUB }, (tx) => tx.query(`select app.apply_template(gen_random_uuid())`))).rejects.toThrow(/template:not_found/);
    await apply(admin, 'tennis');
    await expect(apply(admin, 'blank')).rejects.toThrow(/template:already_applied/);
    await tdb.query(`update public.club set status = 'live' where id = $1`, [OTHER]);
    await expect(apply(admin, 'tennis', OTHER)).rejects.toThrow(/template:not_a_start/);
    expect(await settings(OTHER)).toEqual({});
  });

  it('a handler that fails undoes the whole copy', async () => {
    await tdb.query(`create function public.__bad(p_club uuid, p_key text, p_value jsonb) returns void language plpgsql as $$ begin raise exception 'handler broke'; end $$`);
    await tdb.query(`select app.register_template_handler('product', 'public.__bad(uuid, text, jsonb)'::regprocedure)`);
    await expect(apply(admin, 'tennis')).rejects.toThrow(/handler broke/);
    expect(await settings()).toEqual({});
    expect((await tdb.query(`select template_id from public.club where id = $1`, [CLUB])).rows[0].template_id).toBeNull();
  });
});

describe('items whose handler arrives later (review gap 1)', () => {
  async function registerProduct(sink = '__copied') {
    await tdb.query(`create table if not exists public.${sink} (club_id uuid, key text, value jsonb)`);
    await tdb.query(`grant all on public.${sink} to booq_owner`);
    await tdb.query(`create or replace function public.__copy(p_club uuid, p_key text, p_value jsonb) returns void language sql as $$ insert into public.${sink} values (p_club, p_key, p_value) $$`);
    await tdb.query(`select app.register_template_handler('product', 'public.__copy(uuid, text, jsonb)'::regprocedure)`);
  }
  const copied = async (club: string) => (await tdb.query(`select count(*)::int as n from public.__copied where club_id = $1`, [club])).rows[0].n as number;
  const pendingNow = (who: string, club = CLUB) =>
    pdb.withPlatformTx({ staffId: who, staffLabel: 'Staff', clubId: club }, async (tx) => (await tx.query(`select app.apply_pending_template_items() as r`)).rows[0]?.r);

  it('a club started before the handler existed gets its products when the club asks for the catch-up, once', async () => {
    await apply(spec, 'tennis');
    await registerProduct();
    expect(await copied(CLUB)).toBe(0);
    const r = await pendingNow(spec);
    expect(r).toMatchObject({ copied: { product: 10 }, pending: ['price'] });
    expect(await copied(CLUB)).toBe(10);
    expect(await pendingNow(spec)).toMatchObject({ copied: {}, pending: ['price'] });      // nothing is copied twice
    expect(await copied(CLUB)).toBe(10);
  });

  it('items copied when the club started are not copied again by the catch-up', async () => {
    await registerProduct();
    await apply(spec, 'tennis');
    expect(await copied(CLUB)).toBe(10);
    expect(await pendingNow(spec)).toMatchObject({ copied: {} });
    expect(await copied(CLUB)).toBe(10);
  });

  it('registering a handler can catch up every club already started from a template: each once; Blank and clubs with no template get nothing', async () => {
    await apply(admin, 'tennis', CLUB);
    await apply(admin, 'blank', OTHER);
    await tdb.query(`insert into public.club (id, slug, name_th, name_en) values ('cccccccc-0000-4000-8000-000000000003', 'c', 'ค', 'C')`);   // never started from a template
    await registerProduct();
    expect((await tdb.query(`select app.catch_up_template_handler('product') as n`)).rows[0].n).toBe(10);
    expect(await copied(CLUB)).toBe(10);
    expect(await copied(OTHER)).toBe(0);
    expect((await tdb.query(`select app.catch_up_template_handler('product') as n`)).rows[0].n).toBe(0);
  });

  it('a kind with no handler stays pending and is reported; the catch-up is for the club\'s staff or owner only', async () => {
    await apply(spec, 'tennis');
    expect(await pendingNow(spec)).toMatchObject({ copied: {}, pending: ['price', 'product'] });
    await expect(pendingNow(loner)).rejects.toThrow(/template:not_found/);
    await expect(applyAsOwner('tennis', ['player'])).rejects.toThrow(/template:already_applied|template:not_allowed/);
    const asOwner = (roles: string[]) => db.withClubTx({ clubId: CLUB, userId: USER, roles, source: 'admin' }, async (tx) => (await tx.query(`select app.apply_pending_template_items() as r`)).rows[0]?.r);
    await expect(asOwner(['front_desk', 'player'])).rejects.toThrow(/template:not_allowed/);
    expect(await asOwner(['owner', 'player'])).toMatchObject({ pending: ['price', 'product'] });
  });

  it('the catch-up functions: the club one is not callable by the app roles, and the maintenance one only by the owner role', async () => {
    const q = (fn: string, role: string) => tdb.query(`select has_function_privilege($1, $2, 'execute') as ok`, [role, fn]).then((r) => r.rows[0].ok);
    expect(await q('app.apply_pending_template_items()', 'booq_platform')).toBe(true);
    expect(await q('app.apply_pending_template_items()', 'booq_app')).toBe(true);
    for (const role of ['booq_worker', 'anon', 'authenticated']) expect(await q('app.apply_pending_template_items()', role), role).toBe(false);
    for (const role of ['booq_platform', 'booq_app', 'booq_worker', 'anon', 'authenticated']) expect(await q('app.catch_up_template_handler(text)', role), role).toBe(false);
  });
});

describe('the P6 entry on the staff path (review gap 2)', () => {
  it('applying a template as BOOQ staff writes one P6 entry with the staff name and the counts; the owner path writes none', async () => {
    await apply(spec, 'tennis');
    const p6 = (await tdb.query(`select action, staff_name_at_time as n, club_id, detail from platform.audit_log where action = 'club.template_applied'`)).rows;
    expect(p6).toHaveLength(1);
    expect(p6[0]).toMatchObject({ n: 'Sam Specialist', club_id: CLUB, detail: { template: 'tennis', copied: { setting: 11, opening_hours: 7, label: 1 }, pending: ['price', 'product'] } });
    await applyAsOwner('blank', ['owner', 'player'], OTHER);
    expect((await tdb.query(`select count(*)::int as n from platform.audit_log where action = 'club.template_applied'`)).rows[0].n).toBe(1);
  });
});

describe('who may apply one', () => {
  it('an unassigned specialist gets not found; an assigned one and an admin can', async () => {
    await expect(apply(loner, 'tennis')).rejects.toThrow(/template:not_found/);
    expect(await settings()).toEqual({});
    await apply(spec, 'blank');
  });

  it('a club owner can pick the template in A0; other club roles and no role cannot', async () => {
    for (const roles of [['player'], ['front_desk', 'player'], ['accountant', 'player'], ['coach', 'player'], []]) {
      await expect(applyAsOwner('tennis', roles), roles.join()).rejects.toThrow(/template:not_allowed/);
    }
    expect(await applyAsOwner('tennis')).toMatchObject({ template: 'tennis' });
    expect((await settings())['hold_minutes']).toBe(15);
  });

  it('is not callable by anon, authenticated or the worker, and takes no club argument', async () => {
    const q = (role: string) => tdb.query(`select has_function_privilege($1, 'app.apply_template(uuid)', 'execute') as ok`, [role]).then((r) => r.rows[0].ok);
    expect(await q('booq_platform')).toBe(true);
    expect(await q('booq_app')).toBe(true);
    for (const role of ['booq_worker', 'anon', 'authenticated']) expect(await q(role), role).toBe(false);
    await expect(tdb.query(`select app.apply_template((select id from platform.template where key = 'blank'))`)).rejects.toThrow(/template:no_club_context/);
  });

  it('the platform role cannot write templates (read-only in the console, A-1)', async () => {
    await expect(pdb.withPlatformTx({ staffId: admin, staffLabel: 'S', clubId: CLUB }, (tx) => tx.query(`update platform.template_item set value = '1'`))).rejects.toThrow(/permission denied/i);
    await expect(pdb.withPlatformTx({ staffId: admin, staffLabel: 'S', clubId: CLUB }, (tx) => tx.query(`insert into platform.template (key, name) values ('x', 'x')`))).rejects.toThrow(/permission denied/i);
  });
});
