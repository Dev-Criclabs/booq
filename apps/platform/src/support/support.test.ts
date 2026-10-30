import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createPlatformDb, type PlatformDb } from '@booq/db';
import { createTestDatabase, type TestDatabase } from '@booq/db/testing';
import { createSupportService } from './support';

// F01-T19: the support view (PLAT-02-AC2 to AC7, AC9; design 5.2).
const LIVE = '3f2b8f0e-7c1d-4a55-9d0a-1c2e3f4a5b6c';
const TEST = '9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d';
const PAUSED = 'aaaaaaaa-0000-4000-8000-00000000000e';
const OTHER = 'aaaaaaaa-0000-4000-8000-0000000000ff';

let tdb: TestDatabase;
let pdb: PlatformDb;
let svc: ReturnType<typeof createSupportService>;
let admin: string;
let spec: string;
let loner: string;

async function staff(email: string, role: string, auth: string, name: string): Promise<string> {
  return (await tdb.query(`insert into platform.platform_staff (auth_user_id, email, display_name, role) values ($1, $2, $3, $4) returning id`, [auth, email, name, role])).rows[0].id;
}
const p6 = async () => (await tdb.query(`select action, staff_name_at_time as name, club_id, detail from platform.audit_log order by occurred_at, id`)).rows;
const clubLog = async (club: string) =>
  (await tdb.query(`select action, actor_type, actor_label, support_session_id from public.audit_entry where club_id = $1 and action like 'support.%' order by occurred_at, id`, [club])).rows;
const openWindow = (club: string) =>
  tdb.query(`update public.club set allow_booq_changes_set_at = app.now(), allow_booq_changes_until = app.now() + interval '24 hours' where id = $1`, [club]);

beforeEach(async () => {
  tdb = await createTestDatabase();
  await tdb.query(
    `insert into public.club (id, slug, name_th, name_en, status, owner_phone) values
       ($1, 'live', 'ก', 'Live', 'live', '0811111111'), ($2, 'testing', 'ข', 'Testing', 'testing', null), ($3, 'paused', 'ง', 'Paused', 'paused', null)`,
    [LIVE, TEST, PAUSED],
  );
  admin = await staff('admin@booq.example', 'platform_admin', '99999999-0000-4000-8000-000000000001', 'Ada Admin');
  spec = await staff('spec@booq.example', 'onboarding_specialist', '99999999-0000-4000-8000-000000000002', 'Sam Specialist');
  loner = await staff('loner@booq.example', 'onboarding_specialist', '99999999-0000-4000-8000-000000000003', 'Lee Loner');
  for (const c of [LIVE, TEST, PAUSED]) await tdb.query(`insert into platform.staff_assignment (staff_id, club_id) values ($1, $2)`, [spec, c]);
  await tdb.query(`insert into public.location (club_id, id, name) values ($1, 'cccccccc-0000-4000-8000-000000000001', 'Main')`, [TEST]);
  await tdb.query(`insert into public.club_setting (club_id, key, value) values ($1, 'hold_minutes', '15')`, [TEST]);
  pdb = createPlatformDb({ connectionString: tdb.url, max: 1 });
  svc = createSupportService({ db: pdb });
});
afterEach(async () => {
  await pdb.end();
  await tdb.close();
});

describe('reading the setup projection', () => {
  it('shows setup only: club, hours, courts, settings, switches, with a mode', async () => {
    await tdb.query(`insert into public.opening_hours (club_id, weekday, open, close) values ($1, 1, '06:00', '24:00')`, [TEST]);
    await tdb.query(`insert into public.club_feature (club_id, feature_key, enabled) values ($1, 'coaching', true)`, [TEST]);
    const r = await svc.getSetup(spec, TEST);
    if (!r.ok) throw new Error(r.code);
    expect(r.setup.mode).toBe('edit');
    expect(r.setup.club).toMatchObject({ id: TEST, slug: 'testing', status: 'testing', name_en: 'Testing' });
    expect(r.setup.hours).toHaveLength(1);
    expect(r.setup.settings).toEqual([{ key: 'hold_minutes', value: 15 }]);
    expect(r.setup.features).toEqual([{ feature_key: 'coaching', enabled: true }]);
    expect(r.setup.locations).toHaveLength(1);
    expect(Object.keys(r.setup).sort()).toEqual(['club', 'features', 'hours', 'locations', 'mode', 'resources', 'settings']);
  });

  it('shows the owner contact (D2) and never the support window columns', async () => {
    const r = await svc.getSetup(admin, LIVE);
    if (!r.ok) throw new Error(r.code);
    expect(r.setup.club['owner_phone']).toBe('0811111111');
    expect(Object.keys(r.setup.club)).not.toContain('allow_booq_changes_until');
  });

  it('Live and Paused are look only; the owner window makes them editable until it ends', async () => {
    await tdb.setNow('2026-12-29T03:00:00Z');
    expect(((await svc.getSetup(spec, LIVE)) as { setup: { mode: string } }).setup.mode).toBe('look');
    expect(((await svc.getSetup(spec, PAUSED)) as { setup: { mode: string } }).setup.mode).toBe('look');
    await openWindow(LIVE);
    expect(((await svc.getSetup(spec, LIVE)) as { setup: { mode: string } }).setup.mode).toBe('edit');
    await tdb.advance('24 hours 1 minute');
    expect(((await svc.getSetup(spec, LIVE)) as { setup: { mode: string } }).setup.mode).toBe('look');
  });

  it('an unassigned specialist and an unknown club get not_found, the same answer', async () => {
    expect(await svc.getSetup(loner, TEST)).toEqual({ ok: false, code: 'not_found' });
    expect(await svc.getSetup(spec, OTHER)).toEqual({ ok: false, code: 'not_found' });
    expect(await svc.getSetup('aaaaaaaa-1111-4111-8111-111111111111', TEST)).toEqual({ ok: false, code: 'not_found' });
  });
});

describe('logging every visit and change (PLAT-02-AC6)', () => {
  it('a visit opens one session and is written to P6 and the club log with the staff name', async () => {
    await svc.getSetup(spec, TEST);
    await svc.getSetup(spec, TEST);
    const sessions = await tdb.query(`select staff_id, club_id, mode, closed_at from platform.support_session`);
    expect(sessions.rows).toEqual([{ staff_id: spec, club_id: TEST, mode: 'edit', closed_at: null }]);
    expect((await p6()).map((r) => [r.action, r.name, r.club_id])).toEqual([['support.session_opened', 'Sam Specialist', TEST]]);
    const log = await clubLog(TEST);
    expect(log).toHaveLength(1);
    expect(log[0]).toMatchObject({ action: 'support.session_opened', actor_type: 'platform_staff', actor_label: 'Sam Specialist' });
    expect(log[0]?.support_session_id).toBeTruthy();
  });

  it('a refused visit is logged too, without naming a club that does not exist', async () => {
    await svc.getSetup(loner, TEST);
    await svc.getSetup(spec, OTHER);
    const rows = await p6();
    expect(rows.map((r) => [r.action, r.name, r.club_id])).toEqual([
      ['support.access_refused', 'Lee Loner', null],
      ['support.access_refused', 'Sam Specialist', null],
    ]);
  });

  it('closing the session logs it and a later visit opens a new one', async () => {
    await svc.getSetup(spec, TEST);
    expect(await svc.closeSession(spec, TEST)).toEqual({ ok: true });
    expect((await tdb.query(`select closed_at from platform.support_session`)).rows[0].closed_at).not.toBeNull();
    expect((await p6()).map((r) => r.action)).toEqual(['support.session_opened', 'support.session_closed']);
    await svc.getSetup(spec, TEST);
    expect((await tdb.query(`select count(*)::int as n from platform.support_session`)).rows[0].n).toBe(2);
  });

  it('a session opened as look is replaced by an edit session when the window opens', async () => {
    await svc.getSetup(spec, LIVE);
    await openWindow(LIVE);
    const r = await svc.putSetup(spec, LIVE, 'basics', { name_en: 'New name' });
    expect(r.ok).toBe(true);
    const modes = await tdb.query(`select mode, closed_at is not null as closed from platform.support_session order by opened_at, id`);
    expect(modes.rows).toEqual([{ mode: 'look', closed: true }, { mode: 'edit', closed: false }]);
  });
});

describe('editing (PLAT-02-AC2 to AC5, AC7)', () => {
  const name = async (club: string) => (await tdb.query(`select name_en from public.club where id = $1`, [club])).rows[0].name_en;

  it('Testing: a change saves, with P6 and club log entries naming the staff member and the changed columns', async () => {
    const r = await svc.putSetup(spec, TEST, 'basics', { name_en: 'Renamed', owner_phone: '0899999999' });
    expect(r).toEqual({ ok: true, changed: ['name_en', 'owner_phone'] });
    expect(await name(TEST)).toBe('Renamed');
    const row = (await p6()).find((x) => x.action === 'support.setup_changed');
    expect(row).toMatchObject({ name: 'Sam Specialist', club_id: TEST });
    expect(row?.detail).toEqual({ section: 'basics', changed: { name_en: 'Renamed', owner_phone: '0899999999' } });
    expect((await clubLog(TEST)).map((x) => x.action).sort()).toEqual(['support.session_opened', 'support.setup_changed']);
  });

  it('an owner contact change after an owner invite waits for another admin: the other columns save, the contact does not', async () => {
    await tdb.query(`update public.club set owner_line = 'U1', owner_email = 'o@example.com' where id = $1`, [TEST]);
    await tdb.query(`insert into public.club_invite (club_id, token_hash, kind, roles, bound_line_user_id, created_by_staff, expires_at) values ($1, $2, 'owner', '{owner,player}', 'U1', $3, now() + interval '1 day')`, [TEST, 'c'.repeat(64), admin]);
    const r = await svc.putSetup(spec, TEST, 'basics', { name_en: 'Renamed', owner_phone: '0899999999' });
    expect(r).toMatchObject({ ok: true, changed: ['name_en'], pendingOwnerContact: expect.stringMatching(/^[0-9a-f-]{36}$/) });
    expect(await name(TEST)).toBe('Renamed');
    expect((await tdb.query(`select owner_phone from public.club where id = $1`, [TEST])).rows[0].owner_phone).toBeNull();
  });

  it('Live with the window off: refused as look only, nothing changes, the attempt is logged', async () => {
    expect(await svc.putSetup(admin, LIVE, 'basics', { name_en: 'Nope' })).toEqual({ ok: false, code: 'look_only' });
    expect(await name(LIVE)).toBe('Live');
    expect((await p6()).map((x) => x.action)).toContain('support.edit_refused');
  });

  it('Paused is look only too, unless the owner allows changes', async () => {
    expect(await svc.putSetup(admin, PAUSED, 'basics', { name_en: 'Nope' })).toEqual({ ok: false, code: 'look_only' });
    await openWindow(PAUSED);
    expect((await svc.putSetup(admin, PAUSED, 'basics', { name_en: 'Yes' })).ok).toBe(true);
  });

  it('the window lets edits through for 24 hours, then they stop by themselves; an early off stops them at once', async () => {
    await tdb.setNow('2026-12-29T03:00:00Z');
    await openWindow(LIVE);
    expect((await svc.putSetup(spec, LIVE, 'basics', { name_en: 'A' })).ok).toBe(true);
    await tdb.advance('23 hours 59 minutes');
    expect((await svc.putSetup(spec, LIVE, 'basics', { name_en: 'B' })).ok).toBe(true);
    await tdb.advance('2 minutes');
    expect(await svc.putSetup(spec, LIVE, 'basics', { name_en: 'C' })).toEqual({ ok: false, code: 'look_only' });
    expect(await name(LIVE)).toBe('B');
    await openWindow(LIVE);
    await tdb.query(`update public.club set allow_booq_changes_until = null, allow_booq_changes_set_at = null where id = $1`, [LIVE]);
    expect(await svc.putSetup(spec, LIVE, 'basics', { name_en: 'D' })).toEqual({ ok: false, code: 'look_only' });
  });

  it('an unassigned specialist gets not_found and changes nothing', async () => {
    expect(await svc.putSetup(loner, TEST, 'basics', { name_en: 'X' })).toEqual({ ok: false, code: 'not_found' });
    expect(await name(TEST)).toBe('Testing');
  });

  it('refuses unknown sections, unknown or protected fields, wrong types and values the database rejects', async () => {
    expect(await svc.putSetup(spec, TEST, 'nope', {})).toEqual({ ok: false, code: 'invalid' });
    for (const body of [{ status: 'live' }, { allow_booq_changes_until: '2030-01-01' }, { name_en: 5 }, { default_language: 'de' }, {}, null, []]) {
      expect(await svc.putSetup(spec, TEST, 'basics', body), JSON.stringify(body)).toEqual({ ok: false, code: 'invalid' });
    }
    expect(await name(TEST)).toBe('Testing');
  });

  it('the connection sections wait for the secrets task', async () => {
    expect(await svc.putSetup(spec, TEST, 'line', {})).toEqual({ ok: false, code: 'section_unavailable' });
    expect(await svc.putSetup(spec, TEST, 'payments', {})).toEqual({ ok: false, code: 'section_unavailable' });
  });

  it('saves opening hours (close may be 24:00), courts, feature switches, plan dates and the template link', async () => {
    expect((await svc.putSetup(spec, TEST, 'resources-hours', { hours: [{ weekday: 1, open: '06:00', close: '24:00' }, { weekday: 2, open: '07:00', close: '22:00' }] })).ok).toBe(true);
    expect((await svc.putSetup(spec, TEST, 'resources-hours', { hours: [{ weekday: 2, open: '08:00', close: '21:00' }] })).ok).toBe(true);
    const h = await tdb.query(`select weekday, open::text, close::text from public.opening_hours order by weekday`);
    expect(h.rows).toEqual([{ weekday: 1, open: '06:00:00', close: '24:00:00' }, { weekday: 2, open: '08:00:00', close: '21:00:00' }]);
    expect(await svc.putSetup(spec, TEST, 'resources-hours', { hours: [{ weekday: 3, open: '10:00', close: '09:00' }] })).toEqual({ ok: false, code: 'invalid' });

    const loc = 'cccccccc-0000-4000-8000-000000000001';
    expect((await svc.putSetup(spec, TEST, 'resources-hours', { resources: [{ location_id: loc, name: 'Court 1', sport: 'tennis', lights: true }] })).ok).toBe(true);
    const id = (await tdb.query(`select id from public.resource`)).rows[0].id;
    expect((await svc.putSetup(spec, TEST, 'resources-hours', { resources: [{ id, active: false }] })).ok).toBe(true);
    expect((await tdb.query(`select active, lights from public.resource`)).rows).toEqual([{ active: false, lights: true }]);

    expect((await svc.putSetup(spec, TEST, 'features', { features: { coaching: true, waitlist: false } })).ok).toBe(true);
    expect((await tdb.query(`select feature_key, enabled from public.club_feature order by 1`)).rows).toEqual([{ feature_key: 'coaching', enabled: true }, { feature_key: 'waitlist', enabled: false }]);

    expect((await svc.putSetup(spec, TEST, 'plan', { plan_trial_ends_at: '2027-01-31T00:00:00Z' })).ok).toBe(true);
    const t = await tdb.query(`insert into platform.template (key, name) values ('tennis', 'Tennis') returning id`);
    expect((await svc.putSetup(spec, TEST, 'template', { template_id: t.rows[0].id })).ok).toBe(true);
    expect((await tdb.query(`select template_id from public.club where id = $1`, [TEST])).rows[0].template_id).toBe(t.rows[0].id);
  });

  it('a P6 detail never carries player, booking or secret data', async () => {
    await svc.putSetup(spec, TEST, 'basics', { name_en: 'Renamed' });
    const text = JSON.stringify(await p6());
    expect(text).not.toMatch(/booking|player|wallet|receipt|slip/i);
  });
});
