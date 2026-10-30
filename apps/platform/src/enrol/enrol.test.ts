import { createHash } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createPlatformDb, type PlatformDb } from '@booq/db';
import { createTestDatabase, type TestDatabase } from '@booq/db/testing';
import { ControllableClock } from '@booq/time';
import { createDbAuthStore } from '../auth/adapters';
import { IdentityUnavailable } from '../auth/adapters';
import { createEnrolmentService, type EnrolmentProvider } from './enrol';
import { enrolRoutes } from './routes';
import { createHarness, type Harness } from '../http/testkit';

// First-factor enrolment on the console side (F01-T17c): the link is checked against the database, the provider is a fake
// that behaves like apps/staff-invite, and the first-step state stays on the server.
const SEAL = 's'.repeat(48);
const TOKEN = 'A-single-use-enrolment-token-0123456789';
const hash = (t: string) => createHash('sha256').update(t).digest('hex');
let h: Harness;
let clock: ControllableClock;
let provider: EnrolmentProvider & { started: string[]; finished: Array<{ state: string; code: string }>; down: boolean };
let staffId: string;

beforeEach(async () => {
  clock = new ControllableClock('2026-12-01T03:00:00Z');
  provider = {
    started: [],
    finished: [],
    down: false,
    async startEnrolment(authUserId, password) {
      if (this.down) throw new IdentityUnavailable();
      if (password.length < 8) return { ok: false, code: 'weak_password' };
      this.started.push(authUserId);
      return { ok: true, state: 'provider-first-step-state', secret: 'BASE32SECRET', uri: 'otpauth://totp/BOOQ' };
    },
    async finishEnrolment(_id, state, code) {
      if (this.down) throw new IdentityUnavailable();
      this.finished.push({ state, code });
      return state === 'provider-first-step-state' && code === '123456';
    },
  };
  h = await createHarness((pdb: PlatformDb) =>
    enrolRoutes({ enrol: createEnrolmentService({ db: pdb, provider, store: createDbAuthStore(pdb, { sealKey: SEAL }), now: () => clock.now().getTime(), enrolmentMs: 5 * 60_000, maxFailedCodes: 3 }) }),
  );
  staffId = h.ids.spec;
  await h.tdb.setNow('2026-12-01T03:00:00Z');
  await h.tdb.query(`insert into platform.staff_enrolment (token_hash, staff_id, purpose, created_by, expires_at) values ($1,$2,'invite',$3, app.now() + interval '24 hours')`, [hash(TOKEN), staffId, h.ids.admin]);
});
afterEach(async () => h.close());

const start = (token = TOKEN, password = 'a-long-enough-password') => h.call('POST', '/enrol/start', { body: { token, password }, as: null });
const finish = (enrolmentId: string, code: string) => h.call('POST', '/enrol/finish', { body: { enrolmentId, code }, as: null });
const p6 = async () => (await h.tdb.query(`select action, detail from platform.audit_log where action like 'staff.enrol%' order by occurred_at, id`)).rows;

describe('the link', () => {
  it('check greets the person by name and says nothing more', async () => {
    const r = await h.call('POST', '/enrol/check', { body: { token: TOKEN }, as: null });
    expect([r.status, r.body]).toEqual([200, { displayName: 'Sam Specialist' }]);
  });
  it('an unknown, malformed or expired link is 404 invalid_link, the same for all', async () => {
    for (const token of ['Z'.repeat(40), 'short', TOKEN + '!']) expect((await h.call('POST', '/enrol/check', { body: { token }, as: null })).body).toEqual({ code: 'invalid_link' });
    await h.tdb.advance('24 hours 1 minute');
    expect((await h.call('POST', '/enrol/check', { body: { token: TOKEN }, as: null })).status).toBe(404);
    expect((await start()).status).toBe(404);
    expect(provider.started).toEqual([]);
  });
});

describe('the journey', () => {
  it('password, then the code: the secret goes out once, the state never leaves the server, the link is used up and logged', async () => {
    const s = await start();
    expect(s.status).toBe(200);
    expect(s.body).toMatchObject({ secret: 'BASE32SECRET', uri: 'otpauth://totp/BOOQ' });
    expect(JSON.stringify(s.body)).not.toContain('provider-first-step-state');
    const id = s.body.enrolmentId as string;
    expect(JSON.stringify((await h.tdb.query('select * from platform.console_challenge')).rows)).not.toContain('provider-first-step-state'); // sealed at rest
    const f = await finish(id, '123456');
    expect([f.status, f.body]).toEqual([200, { ok: true }]);
    expect(provider.finished).toEqual([{ state: 'provider-first-step-state', code: '123456' }]);
    expect((await h.tdb.query('select count(*)::int as n from platform.console_challenge')).rows[0].n).toBe(0);
    expect((await h.call('POST', '/enrol/check', { body: { token: TOKEN }, as: null })).status).toBe(404); // single use
    expect((await start()).status).toBe(404);
    expect((await p6()).map((r) => r.action).sort()).toEqual(['staff.enrolled', 'staff.enrolment_started']); // the test clock is frozen, so the order of equal times is not fixed
    expect(JSON.stringify(await p6())).not.toMatch(/a-long-enough|123456|BASE32|first-step/);
  });
  it('a password the provider refuses is 400 weak_password and the link stays good', async () => {
    const r = await start(TOKEN, 'short');
    expect([r.status, r.body]).toEqual([400, { code: 'weak_password' }]);
    expect((await h.call('POST', '/enrol/check', { body: { token: TOKEN }, as: null })).status).toBe(200);
  });
  it('the password step can be repeated before the code is confirmed', async () => {
    const a = (await start()).body.enrolmentId;
    const b = (await start()).body.enrolmentId;
    expect(a).not.toBe(b);
    expect((await finish(b, '123456')).status).toBe(200);
  });
  it('a wrong code is 401 bad_code; after the allowed number the started enrolment is dropped and the password step is needed again', async () => {
    const id = (await start()).body.enrolmentId as string;
    expect((await finish(id, '000000')).body).toEqual({ code: 'bad_code' });
    expect((await finish(id, '111111')).body).toEqual({ code: 'bad_code' });
    const last = await finish(id, '222222');
    expect([last.status, last.body]).toEqual([429, { code: 'too_many_attempts' }]);
    expect((await finish(id, '123456')).status).toBe(404); // gone, even with the right code
    expect((await h.call('POST', '/enrol/check', { body: { token: TOKEN }, as: null })).status).toBe(200); // the link itself is still unused
    expect((await p6()).filter((r) => r.action === 'staff.enrolment_failed')).toHaveLength(3);
  });
  it('a started enrolment expires with the clock', async () => {
    const id = (await start()).body.enrolmentId as string;
    clock.advance(6 * 60_000);
    expect((await finish(id, '123456')).status).toBe(404);
  });
  it('an invented enrolment id is 404, and a deactivated member cannot finish', async () => {
    expect((await finish('x'.repeat(43), '123456')).status).toBe(404);
    const id = (await start()).body.enrolmentId as string;
    await h.tdb.query(`update platform.platform_staff set active = false where id = $1`, [staffId]);
    expect((await finish(id, '123456')).status).toBe(404);
  });
  it('an unreachable staff-invite is 503 identity_unavailable, not a wrong password or code', async () => {
    provider.down = true;
    expect((await start()).body).toEqual({ code: 'identity_unavailable' });
    provider.down = false;
    const id = (await start()).body.enrolmentId as string;
    provider.down = true;
    expect((await finish(id, '123456')).status).toBe(503);
  });
  it('unknown fields or missing ones are 400', async () => {
    expect((await h.call('POST', '/enrol/start', { body: { token: TOKEN }, as: null })).status).toBe(400);
    expect((await h.call('POST', '/enrol/finish', { body: { enrolmentId: 'x', code: '1', extra: 1 }, as: null })).status).toBe(400);
  });
});
