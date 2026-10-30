import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createDb, type Db } from './tx';
import { createPlatformDb, type PlatformDb } from './platform-tx';
import { createTestDatabase, type TestDatabase } from './testing/harness';

// F10-T07 / migration 0606: policies and grants for the F10 tables. LINE-03, CC-2, D27, D149; F10 design 9.
// The sender role is booq_worker; the platform reader is booq_platform (counts and health only, setup tables of
// the clubs it may see); the app role reaches the owner's rich menu labels and nothing of the outbox.
const A = '3f2b8f0e-7c1d-4a55-9d0a-1c2e3f4a5b6c';
const B = '9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d';
const PA = '11111111-1111-4111-8111-111111111111';
const OWNER = '44444444-4444-4444-8444-444444444444';
const PB = '22222222-2222-4222-8222-222222222222';
const HASH = 'a'.repeat(64);

let tdb: TestDatabase;
let web: Db;
let wk: Db;
let pdb: PlatformDb;
let admin: string;
let spec: string;   // assigned to A
let loner: string;  // assigned to nothing

beforeEach(async () => {
  tdb = await createTestDatabase();
  await tdb.query(`insert into public.club (id, slug, name_th, name_en, status) values ($1,'a','ก','A','live'), ($2,'b','ข','B','live')`, [A, B]);
  for (const [club, u, roles] of [[A, PA, ['player']], [A, OWNER, ['owner', 'player']], [B, PB, ['player']]] as const) {
    const c = await tdb.pool.connect();
    try {
      await c.query('begin');
      await c.query('insert into public.app_user (club_id, id, line_user_id) values ($1,$2,$3)', [club, u, 'L' + u.slice(0, 2)]);
      for (const r of roles) await c.query('insert into public.app_user_role (club_id, user_id, role) values ($1,$2,$3)', [club, u, r]);
      await c.query('commit');
    } finally {
      c.release();
    }
  }
  for (const [club, u] of [[A, PA], [B, PB]] as const) {
    await tdb.query(`insert into public.message_outbox (club_id, user_id, kind, params, dedupe_key) values ($1,$2,'booking_confirmed','{}',$3)`, [club, u, 'confirmed:' + club]);
    await tdb.query(`insert into public.notification_pref (club_id, user_id) values ($1,$2)`, [club, u]);
    await tdb.query(`insert into public.rich_menu_label (club_id, tile, label_th, label_en) values ($1, 1, 'คอร์ต', 'Court')`, [club]);
    await tdb.query(`insert into public.rich_menu (club_id, image_sha256, labels_hash, status) values ($1,$2,$2,'building')`, [club, HASH]);
  }
  const staff = async (email: string, role: string, auth: string) =>
    (await tdb.query(`insert into platform.platform_staff (auth_user_id, email, display_name, role) values ($1,$2,$3,$4) returning id`, [auth, email, email.split('@')[0], role])).rows[0].id as string;
  admin = await staff('admin@booq.example', 'platform_admin', '99999999-0000-4000-8000-000000000001');
  spec = await staff('spec@booq.example', 'onboarding_specialist', '99999999-0000-4000-8000-000000000002');
  loner = await staff('loner@booq.example', 'onboarding_specialist', '99999999-0000-4000-8000-000000000003');
  await tdb.query(`insert into platform.staff_assignment (staff_id, club_id) values ($1,$2)`, [spec, A]);
  web = createDb({ connectionString: tdb.url, max: 2 });
  wk = createDb({ connectionString: tdb.url, max: 2, role: 'booq_worker' });
  pdb = createPlatformDb({ connectionString: tdb.url, max: 1 });
});
afterEach(async () => {
  await web.end();
  await wk.end();
  await pdb.end();
  await tdb.close();
});

const as = (user: string, roles: string[], club = A) => ({ clubId: club, userId: user, roles, source: 'admin' as const });
const job = (club = A) => ({ clubId: club, userId: null, roles: [] as never, source: 'job' as const });
const staffRows = (staffId: string, sql: string) =>
  pdb.withPlatformTx({ staffId, staffLabel: 'Test Staff', requestId: 'r1' }, async (tx) => (await tx.query(sql)).rows);

describe('message_outbox: the sender reads and moves rows; nobody else reads any (design 9)', () => {
  it('the sender sees its club’s rows only and can move a row on, but not create, delete or re-key one', async () => {
    const rows = await wk.withClubTx(job(), async (tx) => (await tx.query(`select club_id from public.message_outbox for update skip locked`)).rows);
    expect(rows).toEqual([{ club_id: A }]);
    const upd = await wk.withClubTx(job(), (tx) => tx.query(`update public.message_outbox set status = 'sent', sent_at = now(), attempts = 1 where status = 'pending'`));
    expect(upd.rowCount).toBe(1);
    expect((await tdb.query(`select status from public.message_outbox where club_id = $1`, [B])).rows[0].status).toBe('pending');
    await expect(wk.withClubTx(job(), (tx) => tx.query(`insert into public.message_outbox (club_id, user_id, kind, dedupe_key) values ($1,$2,'booking_confirmed','x')`, [A, PA]))).rejects.toThrow(/permission denied/);
    await expect(wk.withClubTx(job(), (tx) => tx.query(`delete from public.message_outbox`))).rejects.toThrow(/permission denied/);
    await expect(wk.withClubTx(job(), (tx) => tx.query(`update public.message_outbox set dedupe_key = 'y'`))).rejects.toThrow(/permission denied/);
  });

  it('no app role reads the outbox: not the player, not the owner (design 9)', async () => {
    for (const ctx of [as(PA, ['player']), as(OWNER, ['owner', 'player'])]) {
      await expect(web.withClubTx(ctx, (tx) => tx.query(`select 1 from public.message_outbox`))).rejects.toThrow(/permission denied/);
    }
  });

  it('BOOQ staff read no outbox row and no switch (CC-3, the blind rule)', async () => {
    for (const t of ['public.message_outbox', 'public.notification_pref']) {
      const p = await tdb.query(`select has_table_privilege('booq_platform', $1, 'select,insert,update,delete') as any`, [t]);
      expect(p.rows[0].any, t).toBe(false);
      await expect(staffRows(admin, `select 1 from ${t}`), t).rejects.toThrow(/permission denied/);
    }
  });
});

describe('notification_pref: the sender reads the switches of its club', () => {
  it('reads, never writes', async () => {
    const rows = await wk.withClubTx(job(), async (tx) => (await tx.query(`select user_id, reminders, promotions from public.notification_pref`)).rows);
    expect(rows).toEqual([{ user_id: PA, reminders: true, promotions: false }]);
    await expect(wk.withClubTx(job(), (tx) => tx.query(`update public.notification_pref set promotions = true`))).rejects.toThrow(/permission denied/);
  });
});

describe('the LINE token (D27, D149)', () => {
  beforeEach(async () => {
    await tdb.query(`insert into public.club_secret (club_id, kind, ciphertext, key_id, written_by_user) values ($1,'line_channel_token','booq1.cipher','k1',$2)`, [A, OWNER]);
  });

  it('only the sender role reads it', async () => {
    const got = await wk.withClubTx(job(), async (tx) => (await tx.query(`select app.read_secret_worker('line_channel_token') as c`)).rows[0]!.c);
    expect(got).toBe('booq1.cipher');
  });

  it('no club role can read it, and BOOQ staff cannot', async () => {
    await expect(web.withClubTx(as(OWNER, ['owner', 'player']), (tx) => tx.query(`select app.read_secret('line_channel_token')`))).rejects.toThrow(/not allowed/);
    await expect(web.withClubTx(as(OWNER, ['owner', 'player']), (tx) => tx.query(`select app.read_secret_worker('line_channel_token')`))).rejects.toThrow(/permission denied/);
    await expect(web.withClubTx(as(OWNER, ['owner', 'player']), (tx) => tx.query(`select ciphertext from public.club_secret`))).rejects.toThrow(/permission denied/);
    for (const f of ['app.read_secret(text)', 'app.read_secret_worker(text)']) {
      expect((await tdb.query(`select has_function_privilege('booq_platform', $1, 'execute') as ok`, [f])).rows[0].ok, f).toBe(false);
    }
  });
});

describe('rich_menu_label: the owner edits the six labels (D114); the worker and the platform reader read', () => {
  it('the owner reads and writes their club’s labels; a player reads none and writes none', async () => {
    const owner = as(OWNER, ['owner', 'player']);
    await web.withClubTx(owner, (tx) => tx.query(`insert into public.rich_menu_label (club_id, tile, label_th, label_en) values ($1, 2, 'คลาสเดี่ยว', 'Solo')`, [A]));
    await web.withClubTx(owner, (tx) => tx.query(`update public.rich_menu_label set label_en = 'Courts' where tile = 1`));
    expect((await web.withClubTx(owner, (tx) => tx.query(`select tile, label_en from public.rich_menu_label order by tile`))).rows)
      .toEqual([{ tile: 1, label_en: 'Courts' }, { tile: 2, label_en: 'Solo' }]);
    const player = as(PA, ['player']);
    expect((await web.withClubTx(player, (tx) => tx.query(`select 1 from public.rich_menu_label`))).rowCount).toBe(0);
    await expect(web.withClubTx(player, (tx) => tx.query(`insert into public.rich_menu_label (club_id, tile) values ($1, 3)`, [A]))).rejects.toThrow(/row-level security/);
    await expect(web.withClubTx(owner, (tx) => tx.query(`delete from public.rich_menu_label`))).rejects.toThrow(/permission denied/);
  });

  it('the worker reads its club’s labels; the platform reader reads the clubs it may see and writes nothing', async () => {
    expect((await wk.withClubTx(job(), (tx) => tx.query(`select club_id from public.rich_menu_label`))).rows).toEqual([{ club_id: A }]);
    expect(await staffRows(spec, `select club_id from public.rich_menu_label`)).toEqual([{ club_id: A }]);
    expect(await staffRows(loner, `select club_id from public.rich_menu_label`)).toEqual([]);
    await expect(staffRows(admin, `update public.rich_menu_label set label_en = 'x'`)).rejects.toThrow(/permission denied/);
  });
});

describe('rich_menu: the worker builds; the owner and the platform reader read', () => {
  it('the worker inserts and moves its club’s rows on', async () => {
    await wk.withClubTx(job(), (tx) => tx.query(`update public.rich_menu set status = 'failed', error = 'upload_413'`));
    await wk.withClubTx(job(), (tx) => tx.query(`insert into public.rich_menu (club_id, image_sha256, labels_hash, status) values ($1,$2,$2,'building')`, [A, HASH]));
    expect((await tdb.query(`select count(*)::int as n from public.rich_menu where club_id = $1`, [A])).rows[0].n).toBe(2);
    expect((await tdb.query(`select status from public.rich_menu where club_id = $1`, [B])).rows[0].status).toBe('building');
    await expect(wk.withClubTx(job(), (tx) => tx.query(`delete from public.rich_menu`))).rejects.toThrow(/permission denied/);
  });

  it('the owner reads the build status; a player reads nothing; the platform reader reads the clubs it may see', async () => {
    expect((await web.withClubTx(as(OWNER, ['owner', 'player']), (tx) => tx.query(`select status from public.rich_menu`))).rows).toEqual([{ status: 'building' }]);
    expect((await web.withClubTx(as(PA, ['player']), (tx) => tx.query(`select 1 from public.rich_menu`))).rowCount).toBe(0);
    await expect(web.withClubTx(as(OWNER, ['owner', 'player']), (tx) => tx.query(`update public.rich_menu set status = 'active'`))).rejects.toThrow(/permission denied/);
    expect(await staffRows(spec, `select club_id, status from public.rich_menu`)).toEqual([{ club_id: A, status: 'building' }]);
    await expect(staffRows(admin, `update public.rich_menu set status = 'failed'`)).rejects.toThrow(/permission denied/);
  });
});
