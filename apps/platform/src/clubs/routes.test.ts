import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createClubService } from './clubs';
import { createStatusService } from '../status/status';
import { createPauseService, createStubOwnerNotifier, type OwnerNotice } from '../pause/pause';
import { createUsageService } from '../usage/usage';
import { clubRoutes } from './routes';
import { createHarness, type Harness } from '../http/testkit';
import { completeSetup, recordLaunchChecks } from '../../../../packages/db/src/setup-fixture';

// The club routes of the console (design 5.2; PLAT-01, PLAT-02, PLAT-03; ROLE-02): who may do what, over HTTP.
let h: Harness;
let notices: OwnerNotice[];
const NEW = { slug: 'riverside', name_th: 'ริเวอร์ไซด์', name_en: 'Riverside' };
const CLUB = '3f2b8f0e-7c1d-4a55-9d0a-1c2e3f4a5b6c';

beforeEach(async () => {
  notices = [];
  h = await createHarness((pdb) =>
    clubRoutes({
      clubs: createClubService({ db: pdb }),
      status: createStatusService({ db: pdb }),
      pause: createPauseService({ db: pdb, notifier: createStubOwnerNotifier(notices) }),
      usage: createUsageService({ db: pdb, today: () => '2026-10-30' }),
    }),
  );
  await h.tdb.query(`insert into public.club (id, slug, name_th, name_en) values ($1,'a','ก','A')`, [CLUB]);
  await h.tdb.query(`insert into platform.staff_assignment (staff_id, club_id) values ($1,$2)`, [h.ids.spec, CLUB]);
  await completeSetup(h.tdb, CLUB);
});
afterEach(async () => h.close());

describe('who may call what', () => {
  it('every club route needs a signed-in staff member', async () => {
    for (const [m, p] of [['GET', '/clubs'], ['POST', '/clubs'], ['GET', `/clubs/${CLUB}`], ['POST', `/clubs/${CLUB}/status`], ['POST', `/clubs/${CLUB}/pause`], ['POST', `/clubs/${CLUB}/resume`]] as const) {
      expect((await h.call(m, p, { body: m === 'POST' ? {} : undefined, as: null })).status, `${m} ${p}`).toBe(401);
    }
  });
  it('pause and resume are admin only: a specialist is 403 even on their own club (D15)', async () => {
    expect((await h.call('POST', `/clubs/${CLUB}/pause`, { body: { reason: 'x' }, as: 'spec' })).status).toBe(403);
    expect((await h.call('POST', `/clubs/${CLUB}/resume`, { body: { reason: 'x' }, as: 'spec' })).status).toBe(403);
  });
});

describe('create and read (PLAT-01-AC1, AC2, AC9)', () => {
  it('creates a Draft club; a specialist is assigned to it; a fresh second factor is required', async () => {
    const stale = await h.call('POST', '/clubs', { body: NEW, as: 'spec', fresh: false });
    expect([stale.status, stale.body]).toEqual([403, { code: 'step_up_required' }]);
    const made = await h.call('POST', '/clubs', { body: NEW, as: 'spec' });
    expect(made.status).toBe(200);
    expect(made.body.id).toMatch(/^[0-9a-f-]{36}$/);
    expect((await h.call('GET', `/clubs/${made.body.id}`, { as: 'spec' })).status).toBe(200);
    expect((await h.call('GET', `/clubs/${made.body.id}`, { as: 'loner' })).status).toBe(404);
    const row = (await h.tdb.query(`select status from public.club where id = $1`, [made.body.id])).rows[0];
    expect(row.status).toBe('draft');
  });
  it('a taken slug is 409, a bad body or an attempt to set the status is 400', async () => {
    expect((await h.call('POST', '/clubs', { body: { ...NEW, slug: 'a' }, as: 'admin' })).body).toEqual({ code: 'slug_taken' });
    expect((await h.call('POST', '/clubs', { body: { ...NEW, status: 'live' }, as: 'admin' })).status).toBe(400);
    expect((await h.call('POST', '/clubs', { body: { slug: 'x' }, as: 'admin' })).status).toBe(400);
  });
  it('the P3 view holds the checklist and aggregate counts only', async () => {
    await h.tdb.query(`update public.club set status = 'live' where id = $1`, [CLUB]);
    await h.tdb.query(`insert into platform.club_usage_daily (club_id, day, metric, value) values ($1,'2026-10-30','bookings_confirmed',4)`, [CLUB]);
    const r = await h.call('GET', `/clubs/${CLUB}`, { as: 'admin' });
    expect(r.status).toBe(200);
    expect(Object.keys(r.body).sort()).toEqual(['counts', 'progress']);
    expect(r.body.counts).toEqual({ bookingsConfirmed30d: 4, lineMessagesSent30d: 0 });
    expect(JSON.stringify(r.body)).not.toMatch(/phone|email|player|booking_id/i);
  });
  it('the P1 list shows each visible club with name, status and one number', async () => {
    const admin = await h.call('GET', '/clubs', { as: 'admin' });
    expect(admin.body.clubs).toEqual([expect.objectContaining({ clubId: CLUB, nameEn: 'A', bookingsConfirmed30d: 0 })]);
    expect((await h.call('GET', '/clubs', { as: 'spec' })).body.clubs).toHaveLength(1);
    expect((await h.call('GET', '/clubs', { as: 'loner' })).body.clubs).toEqual([]);
  });
});

describe('status (PLAT-01-AC8)', () => {
  it('Draft to Testing by the assigned specialist; an unassigned one gets 404; an invalid target is 400', async () => {
    expect((await h.call('POST', `/clubs/${CLUB}/status`, { body: { to: 'testing' }, as: 'loner' })).status).toBe(404);
    expect((await h.call('POST', `/clubs/${CLUB}/status`, { body: { to: 'nonsense' }, as: 'spec' })).status).toBe(400);
    const ok = await h.call('POST', `/clubs/${CLUB}/status`, { body: { to: 'testing', reason: 'setup done' }, as: 'spec' });
    expect([ok.status, ok.body]).toEqual([200, { from: 'draft', to: 'testing' }]);
  });
  it('going Live with launch checks missing is 409 blocked, and lists what is missing', async () => {
    await h.call('POST', `/clubs/${CLUB}/status`, { body: { to: 'testing' }, as: 'spec' });
    const blocked = await h.call('POST', `/clubs/${CLUB}/status`, { body: { to: 'live' }, as: 'spec' });
    expect(blocked.status).toBe(409);
    expect(blocked.body.code).toBe('blocked');
    expect(Array.isArray(blocked.body.missing)).toBe(true);
    await recordLaunchChecks(h.tdb, CLUB);
    expect((await h.call('POST', `/clubs/${CLUB}/status`, { body: { to: 'live' }, as: 'spec' })).body).toEqual({ from: 'testing', to: 'live' });
  });
  it('a stale second factor is refused for a status change', async () => {
    expect((await h.call('POST', `/clubs/${CLUB}/status`, { body: { to: 'testing' }, as: 'spec', fresh: false })).body).toEqual({ code: 'step_up_required' });
  });
  it('pause and resume go to the admin with a reason; the owner is told', async () => {
    await h.tdb.query(`update public.club set status = 'live' where id = $1`, [CLUB]);
    expect((await h.call('POST', `/clubs/${CLUB}/pause`, { body: {}, as: 'admin' })).status).toBe(400);
    const paused = await h.call('POST', `/clubs/${CLUB}/pause`, { body: { reason: 'payment dispute' }, as: 'admin' });
    expect([paused.status, paused.body.ownerNotified]).toEqual([200, true]);
    expect(notices.map((n) => n.kind)).toEqual(['club_paused']);
    const resumed = await h.call('POST', `/clubs/${CLUB}/resume`, { body: { reason: 'resolved' }, as: 'admin' });
    expect(resumed.status).toBe(200);
    expect((await h.call('POST', `/clubs/${CLUB}/resume`, { body: { reason: 'again' }, as: 'admin' })).status).toBe(409);
  });
});
