import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createDb, createPlatformDb, type Db, type PlatformDb } from '@booq/db';
import { createTestDatabase, type TestDatabase } from '@booq/db/testing';
import { createUsageService } from './usage';

// F01-T35 aggregate counts for P1 and P3 (PLAT-02-AC10, AC11, PLAT-07-AC7; D2, D33):
// numbers only, no list behind a count, test activity not counted.
const CLUB = '3f2b8f0e-7c1d-4a55-9d0a-1c2e3f4a5b6c';
const OTHER = '9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d';
const TODAY = '2026-10-30';

let tdb: TestDatabase;
let pdb: PlatformDb;
let web: Db;
let admin: string;
let spec: string;
let loner: string;
let svc: ReturnType<typeof createUsageService>;

const staff = async (email: string, role: string, auth: string, name: string) =>
  (await tdb.query(`insert into platform.platform_staff (auth_user_id, email, display_name, role) values ($1,$2,$3,$4) returning id`, [auth, email, name, role])).rows[0].id as string;
const usage = (club: string, day: string, metric: string, value: number) =>
  tdb.query(`insert into platform.club_usage_daily (club_id, day, metric, value) values ($1,$2,$3,$4)`, [club, day, metric, value]);

beforeEach(async () => {
  tdb = await createTestDatabase();
  await tdb.query(`insert into public.club (id, slug, name_th, name_en, status) values ($1,'a','ก','A','live'), ($2,'b','ข','B','live')`, [CLUB, OTHER]);
  admin = await staff('admin@booq.example', 'platform_admin', '99999999-0000-4000-8000-000000000001', 'Ada');
  spec = await staff('spec@booq.example', 'onboarding_specialist', '99999999-0000-4000-8000-000000000002', 'Sam');
  loner = await staff('loner@booq.example', 'onboarding_specialist', '99999999-0000-4000-8000-000000000003', 'Lee');
  await tdb.query(`insert into platform.staff_assignment (staff_id, club_id) values ($1,$2)`, [spec, CLUB]);
  pdb = createPlatformDb({ connectionString: tdb.url, max: 1 });
  web = createDb({ connectionString: tdb.url, max: 1 });
  svc = createUsageService({ db: pdb, today: () => TODAY });
});
afterEach(async () => {
  await pdb.end();
  await web.end();
  await tdb.close();
});

describe('counts for one club (P3)', () => {
  it('sums the last 30 days to a number: today and 29 days ago count, 30 days ago does not', async () => {
    await usage(CLUB, '2026-10-30', 'bookings_confirmed', 4);
    await usage(CLUB, '2026-10-01', 'bookings_confirmed', 3); // 29 days ago
    await usage(CLUB, '2026-09-30', 'bookings_confirmed', 100); // 30 days ago
    await usage(CLUB, '2026-10-15', 'line_messages_sent', 9);
    expect(await svc.clubCounts(admin, CLUB)).toEqual({ ok: true, counts: { bookingsConfirmed30d: 7, lineMessagesSent30d: 9 } });
  });

  it('a club with no activity has zeros, not an error', async () => {
    expect(await svc.clubCounts(admin, OTHER)).toEqual({ ok: true, counts: { bookingsConfirmed30d: 0, lineMessagesSent30d: 0 } });
  });

  it('the answer holds numbers only: no ids, rows or days behind a count (AC11)', async () => {
    await usage(CLUB, '2026-10-30', 'bookings_confirmed', 4);
    const r = await svc.clubCounts(admin, CLUB);
    expect(JSON.stringify(r)).toBe('{"ok":true,"counts":{"bookingsConfirmed30d":4,"lineMessagesSent30d":0}}');
  });

  it('test activity is not counted: a Testing club adds nothing, a Live club adds to the day (D33)', async () => {
    const tester = { clubId: CLUB, userId: null, roles: [], source: 'job' as const, actorLabel: 'test' };
    await tdb.query(`update public.club set status = 'testing' where id = $1`, [CLUB]);
    expect((await web.withClubTx(tester, (tx) => tx.query(`select app.bump_usage('bookings_confirmed', 5) as counted`))).rows[0]?.counted).toBe(false);
    expect(await svc.clubCounts(admin, CLUB)).toMatchObject({ counts: { bookingsConfirmed30d: 0 } });
    await tdb.query(`update public.club set status = 'live' where id = $1`, [CLUB]);
    await web.withClubTx(tester, (tx) => tx.query(`select app.bump_usage('bookings_confirmed', 2)`));
    expect((await tdb.query(`select count(*)::int n from platform.club_usage_daily`)).rows[0].n).toBe(1);
  });

  it('a specialist sees an assigned club; an unassigned club and a missing club are both not_found', async () => {
    await usage(CLUB, '2026-10-30', 'bookings_confirmed', 1);
    expect(await svc.clubCounts(spec, CLUB)).toMatchObject({ ok: true });
    expect(await svc.clubCounts(spec, OTHER)).toEqual({ ok: false, code: 'not_found' });
    expect(await svc.clubCounts(loner, CLUB)).toEqual({ ok: false, code: 'not_found' });
    expect(await svc.clubCounts(admin, 'aaaaaaaa-0000-4000-8000-0000000000ff')).toEqual({ ok: false, code: 'not_found' });
    expect(await svc.clubCounts(admin, 'not-a-uuid')).toEqual({ ok: false, code: 'not_found' });
  });

  it('an unknown or deactivated staff member gets nothing', async () => {
    expect(await svc.clubCounts('aaaaaaaa-0000-4000-8000-0000000000aa', CLUB)).toEqual({ ok: false, code: 'not_found' });
    await tdb.query(`update platform.platform_staff set active = false where id = $1`, [admin]);
    expect(await svc.clubCounts(admin, CLUB)).toEqual({ ok: false, code: 'not_found' });
  });
});

describe('the club list (P1)', () => {
  it('lists the clubs the staff member can see, each with one number', async () => {
    await usage(CLUB, '2026-10-30', 'bookings_confirmed', 4);
    await usage(OTHER, '2026-10-29', 'bookings_confirmed', 2);
    expect(await svc.portfolio(admin)).toEqual(expect.arrayContaining([{ clubId: CLUB, nameTh: 'ก', nameEn: 'A', status: 'live', bookingsConfirmed30d: 4 }, { clubId: OTHER, nameTh: 'ข', nameEn: 'B', status: 'live', bookingsConfirmed30d: 2 }]));
    expect(await svc.portfolio(spec)).toEqual([{ clubId: CLUB, nameTh: 'ก', nameEn: 'A', status: 'live', bookingsConfirmed30d: 4 }]);
    expect(await svc.portfolio(loner)).toEqual([]);
  });
});
