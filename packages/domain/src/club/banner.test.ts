import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createDb, type Db } from '@booq/db';
import { createTestDatabase, type TestDatabase } from '@booq/db/testing';
import { clubBannerState } from './banner';

// F01-T22: the banner state the player app and club admin read (PLAT-03-AC4, AC5, AC8).
const A = '3f2b8f0e-7c1d-4a55-9d0a-1c2e3f4a5b6c';
const B = '9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d';
const USER = '11111111-2222-4333-8444-555555555555';
const STAFF = '77777777-7777-4777-8777-777777777777';

let tdb: TestDatabase;
let db: Db;
const ctx = (clubId: string, roles = ['player']) => ({ clubId, userId: USER, roles, source: 'player_app' as const });

beforeEach(async () => {
  tdb = await createTestDatabase();
  await tdb.query(`insert into public.club (id, slug, name_th, name_en, status) values ($1, 'a', 'ก', 'A', 'paused'), ($2, 'b', 'ข', 'B', 'live')`, [A, B]);
  await tdb.query(`insert into platform.platform_staff (id, auth_user_id, email, display_name, role) values ($1, gen_random_uuid(), 'a@b.example', 'Ada', 'platform_admin')`, [STAFF]);
  await tdb.setNow('2026-12-29T03:00:00Z');
  await tdb.query(`insert into public.club_pause (club_id, pause_reason, paused_by) values ($1, 'payment problem', $2)`, [A, STAFF]);
  db = createDb({ connectionString: tdb.url, max: 1 });
});
afterEach(async () => {
  await db.end();
  await tdb.close();
});

describe('clubBannerState', () => {
  it('a Paused club shows the reason and the day it paused, to a player and to staff', async () => {
    for (const roles of [['player'], ['front_desk', 'player'], ['owner', 'player']]) {
      expect(await clubBannerState(db, ctx(A, roles)), roles.join()).toEqual({ status: 'paused', paused: { reason: 'payment problem', since: '2026-12-29T03:00:00.000Z' } });
    }
  });

  it('a Live club has no banner; a resumed club has none', async () => {
    expect(await clubBannerState(db, ctx(B))).toEqual({ status: 'live', paused: null });
    await tdb.query(`update public.club_pause set resumed_at = app.now(), resume_reason = 'ok', resumed_by = $1 where club_id = $2`, [STAFF, A]);
    await tdb.query(`update public.club set status = 'live' where id = $1`, [A]);
    expect(await clubBannerState(db, ctx(A))).toEqual({ status: 'live', paused: null });
  });

  it('reads only the caller\'s own club', async () => {
    expect((await clubBannerState(db, ctx(B))).paused).toBeNull();
    expect((await clubBannerState(db, ctx(A))).paused).not.toBeNull();
  });
});
