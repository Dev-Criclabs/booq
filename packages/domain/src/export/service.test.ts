import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { inflateRawSync } from 'node:zlib';
import { createDb, type Db } from '../../../db/src/tx';
import { createTestDatabase, type TestDatabase } from '../../../db/src/testing/harness';
import { createExportService, ExportError } from './service';
import { createMemoryStorage } from './storage';

// F01-T32 export (PLAT-06-AC11 to AC17; D14, SR-05). Real Postgres.
const A = '3f2b8f0e-7c1d-4a55-9d0a-1c2e3f4a5b6c';
const B = '9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d';
const OWNER = '11111111-1111-4111-8111-111111111111';
const DESK = '22222222-2222-4222-8222-222222222222';
const P_A = '33333333-3333-4333-8333-333333333333';
const P_B = '55555555-5555-4555-8555-555555555555';
const OWNER_B = '44444444-4444-4444-8444-444444444444';

let tdb: TestDatabase;
let web: Db;
let worker: Db;
const owner = { clubId: A, userId: OWNER, roles: ['owner', 'player'], source: 'admin' as const };
const desk = { clubId: A, userId: DESK, roles: ['front_desk', 'player'], source: 'admin' as const };
const job = { clubId: A, userId: null, roles: [] as string[], source: 'job' as const, actorLabel: 'club_export' };
let storage = createMemoryStorage();
const svc = (ttl = 86400) => createExportService({ storage, linkSeconds: ttl });

function unzip(bytes: Uint8Array): Record<string, string> {
  const b = Buffer.from(bytes);
  const eocd = b.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  const out: Record<string, string> = {};
  let p = b.readUInt32LE(eocd + 16);
  for (let i = 0; i < b.readUInt16LE(eocd + 10); i += 1) {
    const method = b.readUInt16LE(p + 10);
    const size = b.readUInt32LE(p + 24);
    const nl = b.readUInt16LE(p + 28);
    const local = b.readUInt32LE(p + 42);
    const raw = b.subarray(local + 30 + b.readUInt16LE(local + 26) + b.readUInt16LE(local + 28), local + 30 + b.readUInt16LE(local + 26) + b.readUInt16LE(local + 28) + size);
    out[b.subarray(p + 46, p + 46 + nl).toString('utf8')] = (method === 8 ? inflateRawSync(raw) : raw).toString('utf8');
    p += 46 + nl + b.readUInt16LE(p + 30) + b.readUInt16LE(p + 32);
  }
  return out;
}

beforeEach(async () => {
  storage = createMemoryStorage();
  tdb = await createTestDatabase();
  await tdb.query(`insert into public.club (id, slug, name_th, name_en) values ($1,'a','ก','A'), ($2,'b','ข','B')`, [A, B]);
  for (const [club, id, line, roles] of [
    [A, OWNER, 'L1', ['owner', 'player']], [A, DESK, 'L2', ['front_desk', 'player']], [A, P_A, 'L3', ['player']], [B, OWNER_B, 'L4', ['owner', 'player']], [B, P_B, 'L5', ['player']],
  ] as const) {
    const c = await tdb.pool.connect();
    try {
      await c.query('begin');
      await c.query('insert into public.app_user (club_id, id, line_user_id) values ($1,$2,$3)', [club, id, line]);
      for (const r of roles) await c.query('insert into public.app_user_role (club_id, user_id, role) values ($1,$2,$3)', [club, id, r]);
      await c.query('commit');
    } finally {
      c.release();
    }
  }
  await tdb.query(`update public.app_user set full_name = 'สมชาย ใจดี', phone = '+66812345678', phone_normalized = '66812345678', date_of_birth = '1990-05-01' where id = $1`, [P_A]);
  await tdb.query(`update public.app_user set full_name = 'OTHER-CLUB-PLAYER', phone = '+66800000000', phone_normalized = '66800000000' where id = $1`, [P_B]);
  await tdb.query(`insert into public.user_staff_note (club_id, user_id, note, created_by) values ($1,$2,'MARKER-staff-note',$3)`, [A, P_A, DESK]);
  await tdb.query(`insert into public.location (club_id, id, name) values ($1,'aaaaaaaa-0000-4000-8000-000000000001','Main')`, [A]);
  await tdb.query(`insert into public.resource (club_id, location_id, name, sport) values ($1,'aaaaaaaa-0000-4000-8000-000000000001','1','tennis')`, [A]);
  web = createDb({ connectionString: tdb.url, max: 2 });
  worker = createDb({ connectionString: tdb.url, max: 2, role: 'booq_worker' });
});
afterEach(async () => {
  await web.end();
  await worker.end();
  await tdb.close();
});

const start = (kind: 'club' | 'customers' = 'club', ctx = owner) => web.withClubTx(ctx, (tx) => svc().start(tx, ctx, { kind }));
const run = (id: string, s = svc()) => worker.withClubTx(job, (tx) => s.run(tx, id));

describe('start (PLAT-06-AC12; D14)', () => {
  it('the owner starts an export; front desk does not', async () => {
    expect(await start()).toMatchObject({ status: 'requested', kind: 'club' });
    await expect(start('club', desk)).rejects.toMatchObject({ code: 'forbidden' });
  });
});

describe('run in the club context (PLAT-06-AC11, AC15, AC16)', () => {
  it('builds a ZIP of CSVs holding only that club, stores it under the club id, and records the row count', async () => {
    const { id } = await start();
    await run(id);
    const row = (await tdb.query('select * from public.data_export where id = $1', [id])).rows[0];
    expect(row).toMatchObject({ status: 'done', storage_path: `${A}/${id}.zip`, row_count: 4 });
    const files = unzip(storage.read(`${A}/${id}.zip`)!);
    expect(Object.keys(files).sort()).toEqual(['opening_hours.csv', 'players.csv', 'resources.csv', 'settings.csv']);
    expect(files['players.csv']).toContain('สมชาย ใจดี');
    expect(files['players.csv']).toContain('1990-05-01');
    expect(Object.values(files).join('')).not.toContain('OTHER-CLUB-PLAYER');
    expect(Object.values(files).join('')).not.toContain('+66800000000');
    expect(files['resources.csv']).toContain('tennis');
  });

  it('leaves out slips and staff notes (A-15, PDPA-01)', async () => {
    const { id } = await start();
    await run(id);
    expect(Object.values(unzip(storage.read(`${A}/${id}.zip`)!)).join('')).not.toContain('MARKER-staff-note');
  });

  it('the customers kind is the customer list only', async () => {
    const { id } = await start('customers');
    await run(id);
    expect(Object.keys(unzip(storage.read(`${A}/${id}.zip`)!))).toEqual(['players.csv']);
  });

  it('writes an audit entry with who started it, and the finished export with its row count', async () => {
    const { id } = await start();
    await run(id);
    const e = (await tdb.query(`select actor_user_id, actor_label, new_value from public.audit_entry where record_type = 'data_export' and record_id = $1 order by seq`, [id])).rows;
    expect(e[0].actor_user_id).toBe(OWNER);
    expect(e.at(-1)).toMatchObject({ actor_label: 'club_export', new_value: expect.objectContaining({ status: 'done', row_count: 4 }) });
  });

  it('a storage failure marks the export failed and leaves no file', async () => {
    const { id } = await start();
    const broken = createExportService({ storage: { ...storage, put: async () => { throw new Error('bucket down'); } }, linkSeconds: 60 });
    await run(id, broken);
    expect((await tdb.query('select status, storage_path from public.data_export where id = $1', [id])).rows[0]).toEqual({ status: 'failed', storage_path: null });
  });

  it('an export already done is not built twice', async () => {
    const { id } = await start();
    await run(id);
    const first = storage.read(`${A}/${id}.zip`)!;
    await run(id);
    expect(storage.read(`${A}/${id}.zip`)).toBe(first);
  });
});

describe('get and the signed link (PLAT-06-AC12; D14)', () => {
  it('only the owner gets a link, and it dies with the export', async () => {
    const { id } = await start();
    expect(await web.withClubTx(owner, (tx) => svc().get(tx, owner, id))).toMatchObject({ status: 'requested', link: null });
    await run(id);
    const done = await web.withClubTx(owner, (tx) => svc(3600).get(tx, owner, id));
    expect(done.status).toBe('done');
    expect(done.link).toMatch(new RegExp(`${A}/${id}\\.zip`));
    await expect(web.withClubTx(desk, (tx) => svc().get(tx, desk, id))).rejects.toMatchObject({ code: 'forbidden' });
    expect(storage.lastLinkSeconds).toBeLessThanOrEqual(3600);
  });

  it('after the export expires there is no link', async () => {
    const { id } = await start();
    await run(id);
    await tdb.query(`update public.data_export set expires_at = now() - interval '1 minute' where id = $1`, [id]);
    await expect(web.withClubTx(owner, (tx) => svc().get(tx, owner, id))).rejects.toMatchObject({ code: 'expired' });
  });

  it('another club’s export id is not found', async () => {
    const { id } = await start();
    const other = { clubId: B, userId: OWNER_B, roles: ['owner', 'player'], source: 'admin' as const };
    await expect(web.withClubTx(other, (tx) => svc().get(tx, other, id))).rejects.toBeInstanceOf(ExportError);
    await expect(web.withClubTx(other, (tx) => svc().get(tx, other, id))).rejects.toMatchObject({ code: 'not_found' });
  });
});
