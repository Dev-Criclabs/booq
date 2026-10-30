import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createDb, type Db } from '../../../db/src/tx';
import { createTestDatabase, type TestDatabase } from '../../../db/src/testing/harness';
import { createImportService, ImportError, type ImportHandler } from './service';
import { normalizePhone } from '../phone';

// F01-T31 import service (PLAT-06-AC1 to AC4, AC6, AC8, AC10; D13, D105, SR-05). Real Postgres.
const A = '3f2b8f0e-7c1d-4a55-9d0a-1c2e3f4a5b6c';
const B = '9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d';
const OWNER = '11111111-1111-4111-8111-111111111111';
const DESK = '22222222-2222-4222-8222-222222222222';
const PLAYER = '33333333-3333-4333-8333-333333333333';

let tdb: TestDatabase;
let db: Db;
const owner = { clubId: A, userId: OWNER, roles: ['owner', 'player'], source: 'admin' as const };
const desk = { clubId: A, userId: DESK, roles: ['front_desk', 'player'], source: 'admin' as const };
const player = { clubId: A, userId: PLAYER, roles: ['player'], source: 'player_app' as const };
const svc = (extra: Record<string, ImportHandler> = {}, limits = { maxRows: 100, stagingHours: 24 }) =>
  createImportService({ limits, today: () => '2026-10-30', normalizePhone, handlers: extra });
const GOOD = 'full_name,phone,date_of_birth\nSomchai Jaidee,081-234-5678,1990-05-01\nMali Rakdee,0899999999,\n';

beforeEach(async () => {
  tdb = await createTestDatabase();
  await tdb.query(`insert into public.club (id, slug, name_th, name_en) values ($1,'a','ก','A'), ($2,'b','ข','B')`, [A, B]);
  for (const [id, line, roles] of [[OWNER, 'L1', ['owner', 'player']], [DESK, 'L2', ['front_desk', 'player']], [PLAYER, 'L3', ['player']]] as const) {
    const c = await tdb.pool.connect();
    try {
      await c.query('begin');
      await c.query('insert into public.app_user (club_id, id, line_user_id) values ($1,$2,$3)', [A, id, line]);
      for (const r of roles) await c.query('insert into public.app_user_role (club_id, user_id, role) values ($1,$2,$3)', [A, id, r]);
      await c.query('commit');
    } finally {
      c.release();
    }
  }
  db = createDb({ connectionString: tdb.url, max: 2 });
});
afterEach(async () => {
  await db.end();
  await tdb.close();
});
const imported = async () => (await tdb.query('select *, date_of_birth::text as dob from public.app_user where line_user_id is null order by full_name')).rows;
const start = (text: string, kind = 'players', s = svc(), ctx: typeof owner | typeof player = owner) => db.withClubTx(ctx, (tx) => s.start(tx, ctx, { kind, fileName: 'players.csv', text }));

describe('start (PLAT-06-AC1, AC2, AC5, AC8)', () => {
  it('a valid file is validated, counted and staged; nothing is created yet', async () => {
    const r = await start(GOOD);
    expect(r).toMatchObject({ status: 'validated', rowsRead: 2, rowsRejected: 0, errors: [] });
    expect(await imported()).toHaveLength(0);
    expect((await tdb.query('select count(*)::int n from public.import_row')).rows[0].n).toBe(2);
  });

  it('one bad row fails the file, lists the row with a code, and confirm is refused', async () => {
    const r = await start(`${GOOD},0811111111,\n`);
    expect(r).toMatchObject({ status: 'failed', rowsRejected: 1, errors: [{ rowNo: 4, codes: ['name_missing'] }] });
    await expect(db.withClubTx(owner, (tx) => svc().confirm(tx, owner, r.id))).rejects.toMatchObject({ code: 'not_confirmable' });
    expect(await imported()).toHaveLength(0);
  });

  it.each([['front_desk', desk], ['player', player]])('%s cannot import (PLAT-06-AC8)', async (_n, ctx) => {
    await expect(start(GOOD, 'players', svc(), ctx)).rejects.toMatchObject({ code: 'forbidden' });
  });

  it('a kind with no handler yet (packages, balances: F06) is refused', async () => {
    await expect(start(GOOD, 'balances')).rejects.toMatchObject({ code: 'kind_not_available' });
    await expect(start(GOOD, 'receipts')).rejects.toBeInstanceOf(ImportError);
  });

  it('too many rows is a file level refusal and stages nothing', async () => {
    await expect(start(GOOD, 'players', svc({}, { maxRows: 1, stagingHours: 24 }))).rejects.toMatchObject({ code: 'too_many_rows' });
    expect((await tdb.query('select count(*)::int n from public.import_job')).rows[0].n).toBe(0);
  });

  it('a club id column is ignored and never stored (AC5); the raw file is not kept (AC10)', async () => {
    const r = await start(`club_id,full_name,phone\n${B},Somchai Jaidee,081-234-5678\n`);
    expect(r.status).toBe('validated');
    const dump = JSON.stringify((await tdb.query('select * from public.import_row')).rows) + JSON.stringify((await tdb.query('select * from public.import_job')).rows);
    expect(dump).not.toContain(B);
    expect(dump).not.toContain('081-234-5678'); // only the parsed, normalised value is staged
  });
});

describe('confirm (PLAT-06-AC2, AC3, AC6, AC18; D105, SR-05)', () => {
  it('creates unclaimed players with no LINE id, a normalised phone and only the Player role', async () => {
    const r = await start(GOOD);
    const done = await db.withClubTx(owner, (tx) => svc().confirm(tx, owner, r.id));
    expect(done).toMatchObject({ status: 'confirmed', rowsSaved: 2 });
    const rows = await imported();
    expect(rows.map((x) => [x.full_name, x.line_user_id, x.phone_normalized, x.club_id])).toEqual([
      ['Mali Rakdee', null, '66899999999', A],
      ['Somchai Jaidee', null, '66812345678', A],
    ]);
    expect(rows[1].dob).toBe('1990-05-01');
    expect((await tdb.query(`select role from public.app_user_role where user_id = any($1)`, [rows.map((x) => x.id)])).rows).toEqual([{ role: 'player' }, { role: 'player' }]);
    expect((await tdb.query('select count(*)::int n from public.booking')).rows[0].n).toBe(0); // never bookings (AC18)
    expect((await tdb.query('select count(*)::int n from public.import_row')).rows[0].n).toBe(0); // staging cleared (AC10)
  });

  it('nobody else sees the imported records: a player reads only their own row', async () => {
    const r = await start(GOOD);
    await db.withClubTx(owner, (tx) => svc().confirm(tx, owner, r.id));
    const seen = await db.withClubTx(player, (tx) => tx.query('select id from public.app_user'));
    expect(seen.rows.map((x) => x.id)).toEqual([PLAYER]);
  });

  it('a second confirm and a cancelled job are refused', async () => {
    const r = await start(GOOD);
    await db.withClubTx(owner, (tx) => svc().confirm(tx, owner, r.id));
    await expect(db.withClubTx(owner, (tx) => svc().confirm(tx, owner, r.id))).rejects.toMatchObject({ code: 'not_confirmable' });
    const r2 = await start(GOOD);
    await db.withClubTx(owner, (tx) => svc().cancel(tx, owner, r2.id));
    await expect(db.withClubTx(owner, (tx) => svc().confirm(tx, owner, r2.id))).rejects.toMatchObject({ code: 'not_confirmable' });
    expect((await tdb.query('select count(*)::int n from public.import_row')).rows[0].n).toBe(0);
  });

  it('an expired job cannot be confirmed', async () => {
    const r = await start(GOOD);
    await tdb.query(`update public.import_job set created_at = now() - interval '2 days', expires_at = now() - interval '1 day'`);
    await expect(db.withClubTx(owner, (tx) => svc().confirm(tx, owner, r.id))).rejects.toMatchObject({ code: 'expired' });
  });

  it('another club’s job id is not found', async () => {
    const r = await start(GOOD);
    const other = { clubId: B, userId: OWNER, roles: ['owner'], source: 'admin' as const };
    await expect(db.withClubTx(other, (tx) => svc().confirm(tx, other, r.id))).rejects.toMatchObject({ code: 'not_found' });
  });

  it('duplicate phones are reported as flags and still import (D11)', async () => {
    const r = await start('full_name,phone\nA One,0811111111\nB Two,081 111 1111\n');
    expect(r.status).toBe('validated');
    expect(r.flags).toEqual([{ rowNo: 2, flags: ['duplicate_phone'] }, { rowNo: 3, flags: ['duplicate_phone'] }]);
    await db.withClubTx(owner, (tx) => svc().confirm(tx, owner, r.id));
    expect(await imported()).toHaveLength(2);
  });

  it('writes one audit entry for the import with counts and the file name, and no personal values in it', async () => {
    const r = await start(GOOD);
    await db.withClubTx(owner, (tx) => svc().confirm(tx, owner, r.id));
    const e = (await tdb.query(`select new_value, actor_user_id from public.audit_entry where record_type = 'import_job' and record_id = $1 order by seq`, [r.id])).rows;
    expect(e.length).toBeGreaterThanOrEqual(2); // created, then confirmed
    expect(e.at(-1).new_value).toMatchObject({ status: 'confirmed', rows_saved: 2 });
    expect(e.at(-1).actor_user_id).toBe(OWNER);
    expect(JSON.stringify(e)).not.toContain('Somchai');
  });

  it('a handler that fails midway saves nothing and leaves the job confirmable (one transaction)', async () => {
    const boom: ImportHandler = {
      validate: () => ({ ok: true, rowsRead: 1, fileErrors: [], rows: [{ rowNo: 2, values: { n: 1 }, errors: [], flags: [] }] }),
      confirm: async (tx) => {
        await tx.query(`insert into public.app_user (club_id, line_user_id) values ($1, 'PARTIAL')`, [A]);
        throw new Error('handler failed');
      },
    };
    const s = svc({ balances: boom });
    const r = await start('x\n1\n', 'balances', s);
    await expect(db.withClubTx(owner, (tx) => s.confirm(tx, owner, r.id))).rejects.toThrow('handler failed');
    expect((await tdb.query(`select count(*)::int n from public.app_user where line_user_id = 'PARTIAL'`)).rows[0].n).toBe(0);
    expect((await tdb.query('select status from public.import_job where id = $1', [r.id])).rows[0].status).toBe('validated');
  });
});
