import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createDb, type Db } from '@booq/db';
import { createTestDatabase, type TestDatabase } from '@booq/db/testing';
import { businessRoute } from '@booq/domain';
import { createWebTable } from '../../server/context';

// PUT /club/business, mounted in the web table (F01 design 5.1; ADMIN-16; ROLE-01-AC8; D115): the owner's business and tax details and the VAT switch.
const A = '3f2b8f0e-7c1d-4a55-9d0a-1c2e3f4a5b6c';
const B = '9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d';
const PLAYER = '11111111-1111-4111-8111-111111111111';
const DESK = '33333333-3333-4333-8333-333333333333';
const OWNER = '44444444-4444-4444-8444-444444444444';
const ACC = '55555555-5555-4555-8555-555555555555';
const OWNER_B = '77777777-7777-4777-8777-777777777777';
const deps = { hasFeature: async () => true };

let tdb: TestDatabase;
let db: Db;
const sess = (userId: string, roles: string[], clubId = A) => ({ clubId, userId, roles: roles as never });
const table = () => createWebTable({ db, verifier: { verifyIdToken: async () => ({ ok: false as const, code: 'offline' as const }) }, now: () => new Date('2026-10-31T00:00:00Z'), config: { sessionSeconds: 60, maxBodyBytes: 1000, importLimits: null } }).table;
const run = (m: string, p: string, session: ReturnType<typeof sess> | null, input: Record<string, unknown> = {}) =>
  table().find((r) => r.def.method === m && r.def.path === p)!.handle({ session, input }, deps);
const owner = sess(OWNER, ['owner', 'player']);

beforeEach(async () => {
  tdb = await createTestDatabase();
  await tdb.query(`insert into public.club (id, slug, name_th, name_en, payment_option) values ($1,'a','ก','A','beam'), ($2,'b','ข','B','beam')`, [A, B]);
  for (const [club, u, roles] of [[A, PLAYER, ['player']], [A, DESK, ['front_desk', 'player']], [A, OWNER, ['owner', 'player']], [A, ACC, ['accountant', 'player']], [B, OWNER_B, ['owner', 'player']]] as const) {
    const c = await tdb.pool.connect();
    try {
      await c.query('begin');
      await c.query('insert into public.app_user (club_id, id, line_user_id, full_name) values ($1,$2,$3,$3)', [club, u, 'L' + u.slice(0, 2)]);
      for (const r of roles) await c.query('insert into public.app_user_role (club_id, user_id, role) values ($1,$2,$3)', [club, u, r]);
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

describe('PUT /club/business', () => {
  const put = (s: ReturnType<typeof sess> | null, input: Record<string, unknown>) => run('PUT', '/club/business', s, input);
  const club = async (id = A) => (await tdb.query(`select legal_name, tax_id, tax_branch, registered_address, receipt_prefix from public.club where id = $1`, [id])).rows[0];

  it('is in the web table for the owner only', () => {
    expect(table().map((r) => `${r.def.method} ${r.def.path} ${r.def.permission}`)).toContain('PUT /club/business club.business.write');
    expect(businessRoute(db).def.permission).toBe('club.business.write');
  });

  it('the owner sets the details a receipt shows; they come back, and the old and new values are audited with the owner as actor', async () => {
    const r = await put(owner, { legal_name: ' บริษัท ตัวอย่าง จำกัด ', tax_id: '0135569018041', tax_branch: 'สำนักงานใหญ่', registered_address: '1 ถนนตัวอย่าง กรุงเทพฯ' });
    expect(r).toMatchObject({ ok: true, body: { legal_name: 'บริษัท ตัวอย่าง จำกัด', tax_id: '0135569018041', tax_branch: 'สำนักงานใหญ่', registered_address: '1 ถนนตัวอย่าง กรุงเทพฯ', vat_enabled: null } });
    expect(await club()).toMatchObject({ legal_name: 'บริษัท ตัวอย่าง จำกัด', tax_id: '0135569018041' });
    await put(owner, { tax_id: '0105555555555' });
    const audit = (await tdb.query(`select old_value, new_value, actor_user_id from public.audit_entry where record_type = 'club' and record_id = $1 order by occurred_at desc, id desc limit 1`, [A])).rows[0];
    expect(JSON.stringify(audit.old_value)).toContain('0135569018041');
    expect(JSON.stringify(audit.new_value)).toContain('0105555555555');
    expect(audit.actor_user_id).toBe(OWNER);
  });

  it('the VAT switch goes through the same registry and row as PUT /settings/vat_enabled', async () => {
    expect(await put(owner, { vat_enabled: true })).toMatchObject({ ok: true, body: { vat_enabled: true } });
    const viaSettings = (await run('GET', '/settings', owner)) as { body: Array<{ key: string; value: unknown }> };
    expect(viaSettings.body.find((s) => s.key === 'vat_enabled')?.value).toBe(true);
    expect(await put(owner, { vat_enabled: 'yes' })).toMatchObject({ ok: false, status: 400, code: 'invalid_input' });
  });

  it('refuses the receipt prefix (read only), unknown fields, empty values, a short tax ID, an empty body and a body that is not an object', async () => {
    for (const bad of [{ receipt_prefix: 'XYZ' }, { name_en: 'Renamed' }, { slug: 'new' }, { legal_name: '   ' }, { legal_name: null }, { tax_id: '123' }, { tax_id: '01355690180411' }, { registered_address: 'x'.repeat(501) }, {}]) {
      expect(await put(owner, bad), JSON.stringify(bad)).toMatchObject({ ok: false, status: 400, code: 'invalid_input' });
    }
    expect(await put(owner, [] as never)).toMatchObject({ ok: false, status: 400 });
    expect(await club()).toMatchObject({ legal_name: null, tax_id: null, receipt_prefix: null });
  });

  it('the accountant, front desk, a player and a guest are refused and nothing changes', async () => {
    for (const s of [sess(ACC, ['accountant', 'player']), sess(DESK, ['front_desk', 'player']), sess(PLAYER, ['player'])]) {
      expect(await put(s, { legal_name: 'X' })).toMatchObject({ ok: false, status: 403 });
    }
    expect(await put(null, { legal_name: 'X' })).toMatchObject({ ok: false, status: 401 });
    expect(await club()).toMatchObject({ legal_name: null });
  });

  it('another club changes only its own details', async () => {
    await put(owner, { legal_name: 'Club A Co' });
    await put(sess(OWNER_B, ['owner', 'player'], B), { legal_name: 'Club B Co' });
    expect((await club(A)).legal_name).toBe('Club A Co');
    expect((await club(B)).legal_name).toBe('Club B Co');
  });
});
