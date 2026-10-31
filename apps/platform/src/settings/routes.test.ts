import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createSettingsService } from './settings';
import { settingsRoutes } from './routes';
import { createHarness, type Harness } from '../http/testkit';

// F01 (PLAT-05, PLAT-04-AC1, PLAT-02): BOOQ staff write a club's settings in the console, checked by the settings registry, never with
// a default, audited in the club's log, only while the club is Draft or Testing or the owner opened the support window.
let h: Harness;
const CLUB = '3f2b8f0e-7c1d-4a55-9d0a-1c2e3f4a5b6c';
const OTHER = '9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d';
const put = (key: string, value: unknown, init: { as?: 'admin' | 'spec' | 'loner' | null; fresh?: boolean; club?: string } = {}) =>
  h.call('PUT', `/clubs/${init.club ?? CLUB}/settings/${key}`, { body: { value }, as: init.as === undefined ? 'spec' : init.as, ...(init.fresh === undefined ? {} : { fresh: init.fresh }) });
const stored = async (club = CLUB) => Object.fromEntries((await h.tdb.query(`select key, value from public.club_setting where club_id = $1`, [club])).rows.map((r) => [r.key, r.value]));
const club = (status: string) => h.tdb.query(`update public.club set status = $2 where id = $1`, [CLUB, status]);

beforeEach(async () => {
  h = await createHarness((pdb) => settingsRoutes({ settings: createSettingsService({ db: pdb }) }));
  await h.tdb.query(`insert into public.club (id, slug, name_th, name_en, payment_option) values ($1,'a','ก','A','beam'), ($2,'b','ข','B','beam')`, [CLUB, OTHER]);
  await h.tdb.query(`insert into platform.staff_assignment (staff_id, club_id) values ($1,$2)`, [h.ids.spec, CLUB]);
});
afterEach(async () => h.close());

describe('who may call', () => {
  it('needs a signed-in staff member, an assigned specialist or an admin, and a fresh second factor to write', async () => {
    expect((await h.call('GET', `/clubs/${CLUB}/settings`, { as: null })).status).toBe(401);
    expect((await put('hold_minutes', 15, { as: null })).status).toBe(401);
    expect((await put('hold_minutes', 15, { as: 'loner' })).status).toBe(404);          // not assigned: the club does not exist for them
    expect((await h.call('GET', `/clubs/${CLUB}/settings`, { as: 'loner' })).status).toBe(404);
    const stale = await put('hold_minutes', 15, { fresh: false });
    expect([stale.status, stale.body]).toEqual([403, { code: 'step_up_required' }]);
    expect((await put('hold_minutes', 15, { as: 'admin' })).status).toBe(200);
    expect(await stored()).toEqual({ hold_minutes: 15 });
  });
});

describe('what is written (PLAT-05)', () => {
  it('lists every setting of the registry with its value or unset, and nothing has a default', async () => {
    const r = await h.call('GET', `/clubs/${CLUB}/settings`, { as: 'spec' });
    expect(r.status).toBe(200);
    expect(r.body.editable).toBe(true);
    expect(r.body.settings.every((s: { unset: boolean; value: unknown }) => s.unset && s.value === null)).toBe(true);
    expect(r.body.settings.find((s: { key: string }) => s.key === 'hold_minutes')).toEqual({ key: 'hold_minutes', value: null, unset: true, required: true, available: true });
    expect(r.body.settings.find((s: { key: string }) => s.key === 'auto_slip_check')).toMatchObject({ available: false, required: false });
    await put('rest_cap_hours', 6);
    expect((await h.call('GET', `/clubs/${CLUB}/settings`, { as: 'spec' })).body.settings.find((s: { key: string }) => s.key === 'rest_cap_hours')).toMatchObject({ value: 6, unset: false });
  });
  it('checks the value against the registry: unknown key 404, wrong value 400, hold time 10, 15 or 20 only', async () => {
    expect((await put('booking_length_minutes', 90)).status).toBe(404);
    expect((await put('hold_minutes', 12)).body).toEqual({ code: 'invalid_value' });
    expect((await put('hold_minutes', '15')).status).toBe(400);
    expect((await put('cancel_window_hours', -1)).status).toBe(400);
    expect((await put('resource_label', 'pitch')).status).toBe(400);
    expect((await put('hold_minutes', 20)).status).toBe(200);
    expect(await stored()).toEqual({ hold_minutes: 20 });
  });
  it('a body must hold exactly {value}; null unsets only a setting the PRD leaves open; a slip-only setting needs a slip club; the smallest group may not exceed the largest', async () => {
    for (const body of [undefined, {}, { value: 1, extra: 2 }, { val: 1 }, [1]]) {
      expect((await h.call('PUT', `/clubs/${CLUB}/settings/hold_minutes`, { body: body ?? [], as: 'spec' })).status, JSON.stringify(body)).toBe(400);
    }
    await put('max_future_court_hours', 4);
    expect((await put('max_future_court_hours', null)).status).toBe(200);
    expect(await stored()).toEqual({});
    await put('hold_minutes', 15);
    expect((await put('hold_minutes', null)).body).toEqual({ code: 'cannot_unset' });
    expect(await stored()).toEqual({ hold_minutes: 15 });
    expect((await put('auto_slip_check', true)).body).toEqual({ code: 'not_available' });
    await h.tdb.query(`update public.club set payment_option = 'slip' where id = $1`, [CLUB]);
    expect((await put('auto_slip_check', true)).status).toBe(200);
    await put('group_max_players', 6);
    expect((await put('group_min_players', 8)).status).toBe(400);
    expect((await put('group_min_players', 4)).status).toBe(200);
  });
});

describe('when (the club must be open for BOOQ changes)', () => {
  it('Draft and Testing are open; Live and Paused are look only unless the owner opened the window', async () => {
    await club('testing');
    expect((await put('hold_minutes', 10)).status).toBe(200);
    await club('live');
    expect((await put('hold_minutes', 15)).body).toEqual({ code: 'look_only' });
    expect(await stored()).toEqual({ hold_minutes: 10 });
    expect((await h.call('GET', `/clubs/${CLUB}/settings`, { as: 'spec' })).body.editable).toBe(false);
    await h.tdb.query(`update public.club set allow_booq_changes_set_at = app.now(), allow_booq_changes_until = app.now() + interval '24 hours' where id = $1`, [CLUB]);
    expect((await put('hold_minutes', 15)).status).toBe(200);
    await club('paused');
    await h.tdb.query(`update public.club set allow_booq_changes_until = null, allow_booq_changes_set_at = null where id = $1`, [CLUB]);
    expect((await put('hold_minutes', 20)).body).toEqual({ code: 'look_only' });
  });
  it("one club's settings are never reached through another's path", async () => {
    expect((await put('hold_minutes', 15, { club: OTHER, as: 'spec' })).status).toBe(404);
    expect(await stored(OTHER)).toEqual({});
  });
});

describe('audit (PLAT-04-AC1)', () => {
  it("the club's log holds the old and new value with the staff member as actor; the console log holds the key and never the value", async () => {
    await put('hold_minutes', 15);
    await put('hold_minutes', 20);
    const rows = (await h.tdb.query(`select action, actor_type, actor_label, old_value, new_value from public.audit_entry where record_type = 'club_setting' order by seq`)).rows;
    expect(rows.map((r) => [r.action, r.actor_type, r.actor_label])).toEqual([['insert', 'platform_staff', 'Sam Specialist'], ['update', 'platform_staff', 'Sam Specialist']]);
    expect(rows[1]!.old_value).toMatchObject({ value: 15 });
    expect(rows[1]!.new_value).toMatchObject({ value: 20 });
    const p6 = (await h.tdb.query(`select action, target_id, detail from platform.audit_log where action = 'club.setting_changed' order by occurred_at, id`)).rows;
    expect(p6.map((r) => [r.target_id, r.detail])).toEqual([['hold_minutes', { unset: false }], ['hold_minutes', { unset: false }]]);
    expect(JSON.stringify(p6)).not.toMatch(/\b20\b|\b15\b/);
  });
});
