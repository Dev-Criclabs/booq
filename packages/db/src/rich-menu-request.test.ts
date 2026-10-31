import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestDatabase, type TestDatabase } from './testing/harness';
import { createDb, type Db } from './tx';

// F10-T15 / migration 0615: the rich menu build request (D176). The owner's label save asks; the worker takes the request
// on its tick and builds (F10-T12). LINE-02-AC8, D114, D149.
const A = '3f2b8f0e-7c1d-4a55-9d0a-1c2e3f4a5b6c';
const B = '4a3c9f1f-8d2e-4b66-8e1b-2d3f4a5b6c7d';
const OWNER = '11111111-1111-4111-8111-111111111111';

let tdb: TestDatabase;
let app: Db;
let worker: Db;
beforeEach(async () => {
  tdb = await createTestDatabase();
  await tdb.query(`insert into public.club (id, slug, name_th, name_en, status) values ($1,'a','ก','A','draft'), ($2,'b','ข','B','live')`, [A, B]);
  const c = await tdb.pool.connect();
  try {
    await c.query('begin');
    await c.query(`insert into public.app_user (club_id, id, line_user_id) values ($1,$2,'L1')`, [A, OWNER]);
    await c.query(`insert into public.app_user_role (club_id, user_id, role) values ($1,$2,'player'), ($1,$2,'owner')`, [A, OWNER]);
    await c.query('commit');
  } finally {
    c.release();
  }
  app = createDb({ connectionString: tdb.url, max: 2 });
  worker = createDb({ connectionString: tdb.url, max: 2, role: 'booq_worker' });
});
afterEach(async () => {
  await app?.end();
  await worker?.end();
  await tdb?.close();
});

const ask = (roles: string[] = ['player', 'owner']) =>
  app.withClubTx({ clubId: A, userId: OWNER, roles: roles as never, source: 'admin' }, async (tx) => (await tx.query(`select app.request_rich_menu_build() as at`)).rows[0]!.at);
const due = () => worker.withClubTx({ clubId: '00000000-0000-0000-0000-000000000000', userId: null, roles: [], source: 'job', actorLabel: 't' }, async (tx) =>
  (await tx.query<{ id: string }>(`select id from app.due_rich_menu_clubs(10) as t(id)`)).rows.map((r) => r.id));
const take = (club = A) => worker.withClubTx({ clubId: club, userId: null, roles: [], source: 'job', actorLabel: 't' }, async (tx) =>
  (await tx.query(`select app.take_rich_menu_request() as f`)).rows[0]!.f as boolean | null);

describe('rich menu build requests (D176)', () => {
  it('two saves before the worker picks up make one request; the worker takes it once', async () => {
    await ask();
    await ask();
    expect((await tdb.query(`select count(*)::int as n from public.rich_menu_request`)).rows[0].n).toBe(1);
    expect(await due()).toEqual([A]);
    expect(await take()).toBe(false);
    expect(await take()).toBeNull();
    expect(await due()).toEqual([]);
  });

  it('a forced request (Redo, F10-T16) stays forced when a save follows it', async () => {
    await tdb.query(`insert into public.rich_menu_request (club_id, force) values ($1, true)`, [A]);
    await ask();
    expect(await take()).toBe(true);
  });

  it('is the owner’s; every request is audited', async () => {
    for (const roles of [['player'], ['player', 'front_desk'], ['player', 'accountant'], ['player', 'coach']]) {
      await expect(ask(roles)).rejects.toThrow(/for the club owner/);
    }
    await ask();
    expect((await tdb.query(`select action, actor_user_id from public.audit_entry where action = 'rich_menu.build_requested'`)).rows).toEqual([{ action: 'rich_menu.build_requested', actor_user_id: OWNER }]);
  });

  it('the owner reads the waiting request of their own club; no club role writes it directly; the worker takes only in its club', async () => {
    await ask();
    const seen = await app.withClubTx({ clubId: A, userId: OWNER, roles: ['player', 'owner'] as never, source: 'admin' }, async (tx) => (await tx.query(`select club_id from public.rich_menu_request`)).rows);
    expect(seen).toEqual([{ club_id: A }]);
    await expect(app.withClubTx({ clubId: A, userId: OWNER, roles: ['player', 'owner'] as never, source: 'admin' }, (tx) =>
      tx.query(`update public.rich_menu_request set force = true`))).rejects.toThrow(/permission denied/);
    expect(await take(B)).toBeNull();
    expect(await due()).toEqual([A]);
  });
});
