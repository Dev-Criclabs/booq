import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FileReply } from '@booq/auth';
import { createDb, type Db } from '@booq/db';
import { createTestDatabase, type TestDatabase } from '@booq/db/testing';
import { createReceiptPdf } from './pdf';
import { receiptRoutes } from './routes';

// F13-T12, T13: player and staff receipt routes (RCPT-01-AC9, AC11; RCPT-02-AC8; D35; design 5).
const A = '3f2b8f0e-7c1d-4a55-9d0a-1c2e3f4a5b6c';
const B = '9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d';
const PLAYER = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';
const DESK = '33333333-3333-4333-8333-333333333333';
const OWNER = '44444444-4444-4444-8444-444444444444';
const ACC = '55555555-5555-4555-8555-555555555555';
const COACH = '66666666-6666-4666-8666-666666666666';
const OWNER_B = '77777777-7777-4777-8777-777777777777';
const deps = { hasFeature: async () => true };
const LOCALES = join(__dirname, '..', '..', '..', '..', '..', 'locales');

let tdb: TestDatabase;
let db: Db;
let r1: string;
let r2: string;
let rB: string;
const sess = (userId: string, roles: string[], clubId = A) => ({ clubId, userId, roles: roles as never });
const routes = (pdf = createReceiptPdf(LOCALES)) => receiptRoutes({ db, pdf });
const find = (m: string, p: string) => routes().find((r) => r.def.method === m && r.def.path === p)!;
const run = (m: string, p: string, session: ReturnType<typeof sess> | null, input: Record<string, unknown> = {}, body?: unknown) =>
  find(m, p).handle({ session, input, ...(body === undefined ? {} : { body }) }, deps);
const text = (u: Uint8Array) => Buffer.from(u).toString('latin1');

beforeEach(async () => {
  tdb = await createTestDatabase();
  await tdb.query(`insert into public.club (id, slug, name_th, name_en, status, receipt_prefix, legal_name, tax_id, tax_branch, registered_address) values ($1,'a','ก','A','live','HTC','บริษัท เอ จำกัด','0135569018041','00000','99 ถนน'), ($2,'b','ข','B','live','BBB',null,null,null,null)`, [A, B]);
  for (const [club, u, roles, lang] of [[A, PLAYER, ['player'], 'th'], [A, OTHER, ['player'], 'en'], [A, DESK, ['front_desk', 'player'], null], [A, OWNER, ['owner', 'player'], null], [A, ACC, ['accountant', 'player'], null], [A, COACH, ['coach', 'player'], null], [B, OWNER_B, ['owner', 'player'], null]] as const) {
    const c = await tdb.pool.connect();
    try {
      await c.query('begin');
      await c.query('insert into public.app_user (club_id, id, line_user_id, full_name, language) values ($1,$2,$3,$4,$5)', [club, u, 'L' + u.slice(0, 2), 'Name ' + u.slice(0, 2), lang]);
      for (const r of roles) await c.query('insert into public.app_user_role (club_id, user_id, role) values ($1,$2,$3)', [club, u, r]);
      await c.query('commit');
    } finally {
      c.release();
    }
  }
  const mk = async (club: string, customer: string, n: number, name: string, at: string) => {
    const o = (await tdb.query(`insert into public.orders (club_id, customer_id, source, status) values ($1,$2,'online','paid') returning id`, [club, customer])).rows[0].id as string;
    return (await tdb.query(
      `insert into public.receipt (club_id, order_id, kind, series, seq_no, number, vat_flag, customer_id, customer_name_snapshot, lines, total_satang, issued_at)
       values ($1,$2,'sale','2026',$3,$4,false,$5,$6,$7::jsonb,50000,$8) returning id`,
      [club, o, n, `${club === A ? 'HTC' : 'BBB'}-2026-00000${n}`, customer, name, JSON.stringify({
        order: { subtotal_satang: 50000, discount_satang: 0, total_satang: 50000, credit_value_satang: 0, wallet_satang: 0, money_satang: 50000 },
        items: [{ position: 1, kind: 'court_hour', description_key: 'k', name_th: 'คอร์ต', name_en: 'Court', unit_price_satang: 50000, net_satang: 50000 }],
        payments: [{ method: 'beam', amount_satang: 50000 }] }), at])).rows[0].id as string;
  };
  r1 = await mk(A, PLAYER, 1, 'Somchai Jaidee', '2026-12-10T05:00:00Z');
  r2 = await mk(A, OTHER, 2, 'Nok Rattana', '2026-12-20T05:00:00Z');
  rB = await mk(B, OWNER_B, 1, 'Pim', '2026-12-12T05:00:00Z');
  db = createDb({ connectionString: tdb.url, max: 2 });
});
afterEach(async () => {
  await db.end();
  await tdb.close();
});

describe('route table', () => {
  it('declares who may call each route', () => {
    expect(routes().map((r) => `${r.def.method} ${r.def.path} ${r.def.permission ?? (r.def.needsPerson ? 'person' : '')}`).sort()).toEqual([
      'GET /me/receipts person',
      'GET /me/receipts/:id/pdf person',
      'GET /staff/receipts receipt.list',
      'GET /staff/receipts/:id/pdf receipt.print',
      'POST /staff/receipts/:id/void receipt.void',
    ]);
  });
});

describe('player routes (RCPT-02-AC8)', () => {
  it('lists only the player\'s own receipts, newest first, with no other person\'s data', async () => {
    const r = await run('GET', '/me/receipts', sess(PLAYER, ['player']));
    expect(r).toMatchObject({ ok: true });
    const body = (r as { body: Array<Record<string, unknown>> }).body;
    expect(body.map((x) => x['number'])).toEqual(['HTC-2026-000001']);
    expect(Object.keys(body[0]!).sort()).toEqual(['id', 'issued_at', 'kind', 'number', 'status', 'total_satang']);
  });
  it('a staff member asking for their own list gets their own receipts only, not the club\'s', async () => {
    expect((await run('GET', '/me/receipts', sess(OWNER, ['owner', 'player']))) as { body: unknown[] }).toMatchObject({ body: [] });
  });
  it('a guest gets sign_in_required', async () => {
    expect(await run('GET', '/me/receipts', null)).toEqual({ ok: false, status: 401, code: 'sign_in_required' });
  });
  it('the PDF is in the player\'s language, the first one is the original and the next is a copy', async () => {
    const first = await run('GET', '/me/receipts/:id/pdf', sess(PLAYER, ['player']), { id: r1 });
    expect(first).toMatchObject({ ok: true });
    const f1 = (first as { body: FileReply }).body;
    expect(f1).toBeInstanceOf(FileReply);
    expect(f1.options).toEqual({ contentType: 'application/pdf', filename: 'receipt-HTC-2026-000001.pdf' });
    expect(text(f1.bytes).startsWith('%PDF-')).toBe(true);
    const second = ((await run('GET', '/me/receipts/:id/pdf', sess(PLAYER, ['player']), { id: r1 })) as { body: FileReply }).body;
    expect(Buffer.from(second.bytes).equals(Buffer.from(f1.bytes))).toBe(false);     // the copy differs from the original by its mark
    const th = ((await run('GET', '/me/receipts/:id/pdf', sess(OTHER, ['player']), { id: r2 })) as { body: FileReply }).body;   // OTHER saved English
    expect(th.bytes.byteLength).toBeGreaterThan(1000);
  });
  it('another player\'s receipt, another club\'s, an unknown id and a bad id are 404 or 400; a staff member cannot print a customer\'s through the player route', async () => {
    expect(await run('GET', '/me/receipts/:id/pdf', sess(PLAYER, ['player']), { id: r2 })).toMatchObject({ ok: false, status: 404, code: 'not_found' });
    expect(await run('GET', '/me/receipts/:id/pdf', sess(PLAYER, ['player']), { id: rB })).toMatchObject({ ok: false, status: 404 });
    expect(await run('GET', '/me/receipts/:id/pdf', sess(PLAYER, ['player']), { id: 'aaaaaaaa-0000-4000-8000-0000000000ff' })).toMatchObject({ ok: false, status: 404 });
    expect(await run('GET', '/me/receipts/:id/pdf', sess(PLAYER, ['player']), { id: 'nope' })).toMatchObject({ ok: false, status: 400, code: 'bad_input' });
    expect(await run('GET', '/me/receipts/:id/pdf', sess(OWNER, ['owner', 'player']), { id: r1 })).toMatchObject({ ok: false, status: 404 });
  });
  it('without the language files configured the PDF is 503 not_configured, and nothing is recorded as printed', async () => {
    const r = await receiptRoutes({ db, pdf: null }).find((x) => x.def.path === '/me/receipts/:id/pdf')!.handle({ session: sess(PLAYER, ['player']), input: { id: r1 } }, deps);
    expect(r).toMatchObject({ ok: false, status: 503, code: 'not_configured' });
    expect((await tdb.query(`select count(*)::int as n from public.receipt_print`)).rows[0].n).toBe(0);
  });
});

describe('staff routes (D35, R1)', () => {
  it('owner and accountant list and search by number, name and Bangkok date; front desk, coach and player are refused', async () => {
    const list = async (input: Record<string, unknown>, s = sess(OWNER, ['owner', 'player'])) => ((await run('GET', '/staff/receipts', s, input)) as { body: Array<{ number: string }> }).body.map((x) => x.number);
    expect(await list({})).toEqual(['HTC-2026-000002', 'HTC-2026-000001']);
    expect(await list({ q: 'htc-2026-000001' })).toEqual(['HTC-2026-000001']);
    expect(await list({ q: 'nok' })).toEqual(['HTC-2026-000002']);
    expect(await list({ q: '%' })).toEqual([]);
    expect(await list({ from: '2026-12-15', to: '2026-12-31' })).toEqual(['HTC-2026-000002']);
    expect(await list({ from: '2026-12-10', to: '2026-12-10' })).toEqual(['HTC-2026-000001']);
    expect(await list({ limit: '1', offset: '1' })).toEqual(['HTC-2026-000001']);
    expect(await list({ customer: PLAYER })).toEqual(['HTC-2026-000001']);
    expect(await list({ customer: OTHER })).toEqual(['HTC-2026-000002']);
    expect(await run('GET', '/staff/receipts', sess(OWNER, ['owner', 'player']), { customer: 'nope' })).toMatchObject({ ok: false, status: 400 });
    expect(await list({}, sess(ACC, ['accountant', 'player']))).toHaveLength(2);
    for (const s of [sess(DESK, ['front_desk', 'player']), sess(COACH, ['coach', 'player']), sess(PLAYER, ['player'])]) {
      expect(await run('GET', '/staff/receipts', s)).toMatchObject({ ok: false, status: 403 });
    }
  });
  it('the list carries the name and no contact details', async () => {
    const r = (await run('GET', '/staff/receipts', sess(ACC, ['accountant', 'player']))) as { body: Array<Record<string, unknown>> };
    expect(Object.keys(r.body[0]!).sort()).toEqual(['customer_name', 'id', 'is_test', 'issued_at', 'kind', 'number', 'status', 'total_satang']);
  });
  it('bad search inputs are 400', async () => {
    for (const input of [{ from: 'yesterday' }, { to: '2026-13-40' }, { limit: '0' }, { limit: '1000' }, { offset: '-1' }, { q: 'x'.repeat(101) }]) {
      expect(await run('GET', '/staff/receipts', sess(OWNER, ['owner', 'player']), input), JSON.stringify(input)).toMatchObject({ ok: false, status: 400, code: 'bad_input' });
    }
  });
  it('front desk, accountant and owner print a customer\'s receipt as a copy in either language, and it is audited', async () => {
    for (const s of [sess(DESK, ['front_desk', 'player']), sess(ACC, ['accountant', 'player']), sess(OWNER, ['owner', 'player'])]) {
      for (const lang of ['th', 'en']) {
        const r = (await run('GET', '/staff/receipts/:id/pdf', s, { id: r1, lang })) as { ok: boolean; body: FileReply };
        expect(r.ok).toBe(true);
        expect(text(r.body.bytes).startsWith('%PDF-')).toBe(true);
      }
    }
    expect((await tdb.query(`select count(*)::int as n from public.audit_entry where action = 'receipt.printed'`)).rows[0].n).toBe(6);
    expect((await tdb.query(`select count(*)::int as n from public.receipt_print`)).rows[0].n).toBe(0);     // the customer's original is still unused
    expect(await run('GET', '/staff/receipts/:id/pdf', sess(OWNER, ['owner', 'player']), { id: r1, lang: 'fr' })).toMatchObject({ ok: false, status: 400 });
    for (const s of [sess(COACH, ['coach', 'player']), sess(PLAYER, ['player'])]) expect(await run('GET', '/staff/receipts/:id/pdf', s, { id: r1 })).toMatchObject({ ok: false, status: 403 });
    expect(await run('GET', '/staff/receipts/:id/pdf', sess(OWNER_B, ['owner', 'player'], B), { id: r1 })).toMatchObject({ ok: false, status: 404 });
  });
  it('only the owner voids, with a reason; the answer is the void and the receipt reads Void', async () => {
    expect(await run('POST', '/staff/receipts/:id/void', sess(DESK, ['front_desk', 'player']), { id: r1 }, { reason: 'x' })).toMatchObject({ ok: false, status: 403 });
    expect(await run('POST', '/staff/receipts/:id/void', sess(ACC, ['accountant', 'player']), { id: r1 }, { reason: 'x' })).toMatchObject({ ok: false, status: 403 });
    expect(await run('POST', '/staff/receipts/:id/void', sess(OWNER, ['owner', 'player']), { id: r1 }, { reason: '  ' })).toMatchObject({ ok: false, status: 400, code: 'reason_required' });
    expect(await run('POST', '/staff/receipts/:id/void', sess(OWNER, ['owner', 'player']), { id: r1 }, { reason: 'x', extra: 1 })).toMatchObject({ ok: false, status: 400, code: 'bad_input' });
    expect(await run('POST', '/staff/receipts/:id/void', sess(OWNER, ['owner', 'player']), { id: r1 }, { reason: 'wrong item' })).toMatchObject({ ok: true, body: { ok: true } });
    expect(await run('POST', '/staff/receipts/:id/void', sess(OWNER, ['owner', 'player']), { id: r1 }, { reason: 'again' })).toMatchObject({ ok: false, status: 409, code: 'already_void' });
    expect(await run('POST', '/staff/receipts/:id/void', sess(OWNER, ['owner', 'player']), { id: rB }, { reason: 'x' })).toMatchObject({ ok: false, status: 404 });
    const printed = (await run('GET', '/staff/receipts/:id/pdf', sess(ACC, ['accountant', 'player']), { id: r1, lang: 'en' })) as { body: FileReply };
    expect(text(printed.body.bytes)).toContain('Sarabun');
    expect((await tdb.query(`select status from public.receipt where id = $1`, [r1])).rows[0].status).toBe('void');
  });
});
