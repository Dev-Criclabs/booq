// F03 acceptance criteria with no existing test: written by QA in the F03 sweep.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createPlatformDb, type PlatformDb } from '../../packages/db/src/platform-tx';
import { createTestDatabase, type TestDatabase } from '../../packages/db/src/testing/harness';
import { createDb, type Db } from '../../packages/db/src/tx';
import { repoRoot } from './spec-ids';

const A = '3f2b8f0e-7c1d-4a55-9d0a-1c2e3f4a5b6c';
const LOC = 'aaaaaaaa-0000-4000-8000-000000000001';
const COURT = 'c1c1c1c1-0000-4000-8000-000000000001';
const uid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const STAFF = uid(90);
const PLAYER = uid(1);
const PLAYER2 = uid(2);
const slot = (h: number) => new Date(`2026-12-02T${String(h).padStart(2, '0')}:00:00+07:00`).toISOString();

let tdb: TestDatabase;
let db: Db;
let pdb: PlatformDb;

async function person(id: string, line: string, roles: string[]) {
  const c = await tdb.pool.connect();
  try {
    await c.query('begin');
    await c.query(`insert into public.app_user (club_id, id, line_user_id, display_name) values ($1,$2,$3,$4)`, [A, id, line, `Name ${line}`]);
    for (const r of roles) await c.query(`insert into public.app_user_role (club_id, user_id, role) values ($1,$2,$3)`, [A, id, r]);
    await c.query('commit');
  } finally {
    c.release();
  }
}
const order = async (customer: string, source: 'online' | 'staff') =>
  (await tdb.query(`insert into public.orders (club_id, customer_id, source) values ($1,$2,$3) returning id`, [A, customer, source])).rows[0].id as string;
const reserve = (who: string, roles: string[], orderId: string, hour: number, src: 'player_app' | 'admin') =>
  db.withClubTx({ clubId: A, userId: who, roles: roles as never, source: src }, async (tx) =>
    (await tx.query(`select app.reserve_court($1, $2, $3::timestamptz[], null, null) as res`, [orderId, COURT, [slot(hour)]])).rows[0]!.res as { hold_expires_at: string; booking_ids: string[] });

beforeAll(async () => {
  tdb = await createTestDatabase();
  await tdb.setNow('2026-12-01T03:00:00Z'); // 1 Dec 10:00 Bangkok
  await tdb.query(`insert into public.club (id, slug, name_th, name_en, status) values ($1,'club-a','ก','A','live')`, [A]);
  await tdb.query(`insert into public.location (club_id, id, name) values ($1,$2,'Main')`, [A, LOC]);
  await tdb.query(`insert into public.resource (club_id, id, location_id, name, sport) values ($1,$2,$3,'1','tennis')`, [A, COURT, LOC]);
  for (let d = 1; d <= 7; d += 1) await tdb.query(`insert into public.opening_hours (club_id, weekday, open, close) values ($1,$2,'06:00','24:00')`, [A, d]);
  await tdb.query(`insert into public.club_setting (club_id, key, value) values ($1,'booking_window_days','30'), ($1,'hold_minutes','15')`, [A]);
  await person(PLAYER, 'L1', ['player']);
  await person(PLAYER2, 'L2', ['player']);
  await person(STAFF, 'L9', ['front_desk', 'player']);
  db = createDb({ connectionString: tdb.url, max: 4 });
  pdb = createPlatformDb({ connectionString: tdb.url, max: 2 });
});
afterAll(async () => {
  await db.end();
  await pdb.end();
  await tdb.close();
});

describe('F03/BOOK-03-AC17', () => {
  it('F03/BOOK-03-AC17 a staff booking awaiting payment holds the slot for the same hold time as an online booking', async () => {
    const online = await reserve(PLAYER, ['player'], await order(PLAYER, 'online'), 18, 'player_app');
    const staff = await reserve(STAFF, ['front_desk', 'player'], await order(PLAYER2, 'staff'), 19, 'admin');
    expect(staff.hold_expires_at).toBe(online.hold_expires_at);
    expect(new Date(staff.hold_expires_at).toISOString()).toBe('2026-12-01T03:15:00.000Z'); // now (10:00 Bangkok) plus the hold_minutes setting
    const b = (await tdb.query(`select status, source from public.booking where id = $1`, [staff.booking_ids[0]])).rows[0];
    expect(b).toMatchObject({ status: 'awaiting_payment', source: 'staff' });
    // The staff hold blocks the slot like any hold.
    await expect(reserve(PLAYER, ['player'], await order(PLAYER, 'online'), 19, 'player_app')).rejects.toMatchObject({ code: 'BK001' });
  });
});

describe('F03/BOOK-03-AC16', () => {
  it('F03/BOOK-03-AC16 a pause leaves an existing hold to run to its normal end, and starts no new hold for players or staff', async () => {
    const held = await reserve(PLAYER, ['player'], await order(PLAYER, 'online'), 20, 'player_app');
    const admin = (await tdb.query(`insert into platform.platform_staff (auth_user_id, email, display_name, role) values (gen_random_uuid(), 'admin@booq.example', 'Admin', 'platform_admin') returning id`)).rows[0].id as string;
    await pdb.withPlatformTx({ staffId: admin, staffLabel: 'Admin', clubId: A }, (tx) => tx.query(`select app.pause_club('qa test')`));
    expect((await tdb.query(`select status from public.club where id = $1`, [A])).rows[0].status).toBe('paused');

    const b = (await tdb.query(`select status, hold_expires_at from public.booking where id = $1`, [held.booking_ids[0]])).rows[0];
    expect(b.status).toBe('awaiting_payment');
    expect(new Date(b.hold_expires_at).toISOString()).toBe(new Date(held.hold_expires_at).toISOString());
    expect((await tdb.query(`select count(*)::int as n from public.occupancy where booking_id = $1 and state = 'held'`, [held.booking_ids[0]])).rows[0].n).toBe(1);

    await expect(reserve(PLAYER2, ['player'], await order(PLAYER2, 'online'), 21, 'player_app')).rejects.toThrow();
    await expect(reserve(STAFF, ['front_desk', 'player'], await order(PLAYER2, 'staff'), 21, 'admin')).rejects.toThrow();
    expect((await tdb.query(`select count(*)::int as n from public.booking where club_id = $1 and start_at = $2`, [A, slot(21)])).rows[0].n).toBe(0);
  });
});

describe('F03/BOOK-05-AC8', () => {
  it('F03/BOOK-05-AC8 the future hours message uses the named variable {hours} in both languages, from a P key', () => {
    const pending = JSON.parse(readFileSync(join(repoRoot(), 'locales', 'pending', 'f03.json'), 'utf8')) as Record<string, Record<string, string>>;
    const texts: string[] = [];
    const walk = (n: unknown) => {
      if (n && typeof n === 'object') for (const [k, v] of Object.entries(n as Record<string, unknown>)) {
        if (k === 'P-new.limit_reached' && typeof v === 'string') texts.push(v);
        else walk(v);
      }
    };
    walk(pending);
    expect(texts).toHaveLength(2);
    for (const t of texts) expect(t).toContain('{hours}');
    expect(texts.some((t) => /[ก-ฺ]/.test(t)), 'one of the two is Thai').toBe(true);
    expect(texts.some((t) => !/[ก-ฺ]/.test(t)), 'one of the two is English').toBe(true);
  });
});
