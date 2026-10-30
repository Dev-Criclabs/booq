import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createSupportService } from './support';
import { createConnections } from '../connections/connections';
import { supportRoutes } from './routes';
import { createHarness, type Harness } from '../http/testkit';

// Support routes over HTTP (PLAT-02-AC2 to AC7, AC9; SR-16).
const CLUB = '3f2b8f0e-7c1d-4a55-9d0a-1c2e3f4a5b6c';
let h: Harness;

beforeEach(async () => {
  h = await createHarness((pdb) =>
    supportRoutes({
      support: createSupportService({
        db: pdb,
        connections: createConnections({
          encryptKey: 'unused-in-these-tests',
          line: { check: async () => ({ ok: true as const }) },
          beam: { check: async () => ({ ok: true as const }) },
        } as never),
      }),
    }),
  );
  await h.tdb.query(`insert into public.club (id, slug, name_th, name_en, status) values ($1,'a','ก','A','testing')`, [CLUB]);
  await h.tdb.query(`insert into platform.staff_assignment (staff_id, club_id) values ($1,$2)`, [h.ids.spec, CLUB]);
});
afterEach(async () => h.close());

describe('support setup', () => {
  it('shows setup with a mode, and a change is applied by section', async () => {
    const got = await h.call('GET', `/clubs/${CLUB}/support/setup`, { as: 'spec' });
    expect(got.status).toBe(200);
    expect(got.body.setup.mode).toBe('edit');
    const put = await h.call('PUT', `/clubs/${CLUB}/support/setup/basics`, { body: { name_en: 'Renamed' }, as: 'spec' });
    expect([put.status, put.body.changed]).toEqual([200, ['name_en']]);
  });
  it('an unknown section or a bad body is 400; an unassigned specialist gets 404; a guest 401', async () => {
    expect((await h.call('PUT', `/clubs/${CLUB}/support/setup/nope`, { body: { a: 'b' }, as: 'spec' })).body).toEqual({ code: 'invalid' });
    expect((await h.call('PUT', `/clubs/${CLUB}/support/setup/basics`, { body: { bogus: 'x' }, as: 'spec' })).status).toBe(400);
    expect((await h.call('GET', `/clubs/${CLUB}/support/setup`, { as: 'loner' })).status).toBe(404);
    expect((await h.call('GET', `/clubs/${CLUB}/support/setup`, { as: null })).status).toBe(401);
    expect((await h.call('GET', `/clubs/not-an-id/support/setup`, { as: 'spec' })).status).toBe(404);
  });
  it('a Live club is look only: the change is refused 409 look_only', async () => {
    await h.tdb.query(`update public.club set status = 'live' where id = $1`, [CLUB]);
    const r = await h.call('PUT', `/clubs/${CLUB}/support/setup/basics`, { body: { name_en: 'X' }, as: 'spec' });
    expect([r.status, r.body]).toEqual([409, { code: 'look_only' }]);
  });
  it('the connection sections need a fresh second factor (SR-16)', async () => {
    const r = await h.call('PUT', `/clubs/${CLUB}/support/setup/line`, { body: {}, as: 'spec', fresh: false });
    expect([r.status, r.body]).toEqual([403, { code: 'step_up_required' }]);
  });
  it('closing ends the open session', async () => {
    await h.call('GET', `/clubs/${CLUB}/support/setup`, { as: 'spec' });
    expect((await h.call('POST', `/clubs/${CLUB}/support/close`, { body: {}, as: 'spec' })).status).toBe(200);
    expect((await h.tdb.query(`select closed_at from platform.support_session`)).rows[0].closed_at).not.toBeNull();
  });
});

describe('connection test', () => {
  it('needs a fresh second factor, a known kind, and a club the caller can see', async () => {
    expect((await h.call('POST', `/clubs/${CLUB}/connections/line/test`, { body: {}, as: 'spec', fresh: false })).body).toEqual({ code: 'step_up_required' });
    expect((await h.call('POST', `/clubs/${CLUB}/connections/sms/test`, { body: {}, as: 'spec' })).status).toBe(404);
    expect((await h.call('POST', `/clubs/${CLUB}/connections/line/test`, { body: {}, as: 'loner' })).status).toBe(404);
  });
  it('bad values are 400; nothing is written for the test', async () => {
    expect((await h.call('POST', `/clubs/${CLUB}/connections/line/test`, { body: {}, as: 'spec' })).status).toBe(400);
    expect((await h.tdb.query(`select count(*)::int as n from public.club_secret`)).rows[0].n).toBe(0);
  });
});
