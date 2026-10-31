import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createDb, type Db } from '@booq/db';
import { createTestDatabase, type TestDatabase } from '@booq/db/testing';
import { beamGateway } from '@booq/beam';
import { generateKeyPair, writeSecret } from '@booq/secrets';
import { FakeBeam, FakeClock } from '../../../../../tests/fakes';
import { fakeReceiptAndMessagePorts, fixtureSources, IDS, seedHunter } from '../../../../../packages/domain/src/checkout/test-fixture';
import { checkoutRoutes } from './routes';

// F04-T22b: Pay for a group class seat (CLASS-01-AC14, AC17; F04 R4; D22, D157). Pay prices the seat, then F08's
// app.take_seat takes it. Hunter's prices and settings are test data here, never defaults in code.
const { A, COURT, ME, ADULT, STUDENT } = IDS;
const OWNER = '77777777-7777-4777-8777-777777777777';
const KID = '44444444-4444-4444-8444-444444444444';
const COACH = 'cccccccc-0000-4000-8000-0000000000c1';
const NOW = '2026-11-30T03:00:00Z';   // Monday 10:00 Bangkok
const KEY = 'sk_live_seat_test_0001';
const keys = generateKeyPair();
const deps = { hasFeature: async () => true };
type Session = { clubId: string; userId: string; roles: ['player'] };
const me: Session = { clubId: A, userId: ME, roles: ['player'] };

let tdb: TestDatabase;
let db: Db;
let beam: FakeBeam;
let server: { url: string; close: () => Promise<void> };
let adultClass: string;
let studentClass: string;

beforeEach(async () => {
  tdb = await createTestDatabase();
  await tdb.setNow(NOW);
  await seedHunter(tdb);
  await fakeReceiptAndMessagePorts(tdb);
  const c = await tdb.pool.connect();
  try {
    await c.query('begin');
    await c.query(`insert into public.app_user (club_id, id, line_user_id) values ($1,$2,'LO')`, [A, OWNER]);
    await c.query(`insert into public.app_user_role (club_id, user_id, role) values ($1,$2,'owner'), ($1,$2,'player')`, [A, OWNER]);
    await c.query(`insert into public.app_user (club_id, id, line_user_id, date_of_birth) values ($1,$2,'LK','2012-05-17')`, [A, KID]);
    await c.query(`insert into public.app_user_role (club_id, user_id, role) values ($1,$2,'player')`, [A, KID]);
    await c.query('commit');
  } finally {
    c.release();
  }
  await tdb.seedCoach(A, COACH);
  await tdb.query(`insert into public.class_template (club_id, name_th, name_en, audience, level, coach_id, resource_id, weekday, start_time, min_players, max_players, drop_in_price_satang, created_by)
                   values ($1,'ผู้ใหญ่','Adults','adult','Beginner',$2,$3,3,'18:00',1,2,30000,$4)`, [A, COACH, COURT, OWNER]);
  await tdb.query(`insert into public.class_template (club_id, name_th, name_en, audience, level, coach_id, resource_id, weekday, start_time, min_players, max_players, created_by)
                   values ($1,'เยาวชน','Juniors','student','Advanced',$2,$3,4,'16:00',1,4,$4)`, [A, COACH, COURT, OWNER]);
  await tdb.query(`insert into public.payment_connection (club_id, merchant_id_live) values ($1,'m-hunter')`, [A]);
  await tdb.query(`insert into platform.config (key, value) values ('qr_expiry_margin_seconds', '30') on conflict (key) do update set value = excluded.value`);
  db = createDb({ connectionString: tdb.url, max: 3 });
  const asOwner = { clubId: A, userId: OWNER, roles: ['owner', 'player'] as never, source: 'admin' as const };
  await db.withClubTx(asOwner, (tx) => writeSecret(tx, keys.publicKey, A, 'beam_api_key_live', KEY));
  await db.withClubTx(asOwner, (tx) => tx.query(`select app.generate_sessions('2026-11-30'::date, '2026-12-31'::date)`));
  adultClass = (await tdb.query(`select s.id from public.class_session s join public.class_template t on t.id = s.template_id where t.name_en = 'Adults' order by s.start_at limit 1`)).rows[0].id;
  studentClass = (await tdb.query(`select s.id from public.class_session s join public.class_template t on t.id = s.template_id where t.name_en = 'Juniors' order by s.start_at limit 1`)).rows[0].id;
  beam = new FakeBeam({ clock: new FakeClock(NOW), merchants: { 'm-hunter': { apiKey: KEY, webhookKeyBase64: Buffer.from('k').toString('base64') } } });
  server = await beam.serve();
});
afterEach(async () => {
  beam.assertNoRefunds();
  await server.close();
  await db.end();
  await tdb.close();
});

const routes = () =>
  checkoutRoutes({
    db,
    clubBySlug: async () => ({ clubId: A }),
    sources: fixtureSources(),
    payments: { privateKey: () => keys.privateKey, gateway: (cr) => beamGateway({ ...cr, baseUrl: server.url }), alerts: { p1: () => undefined }, now: () => new Date(NOW) },
  });
const call = (path: string, body: unknown, session: Session = me) =>
  routes().find((r) => r.def.path === path)!.handle({ session, input: { slug: 'club-a', ...(body as object) }, body }, deps);
const pay = async (body: Record<string, unknown>, session: Session = me) => {
  const q = await call('/checkout/quote', body, session);
  if (!q.ok) return q;
  return call('/checkout/pay', { ...body, quoteHash: (q.body as { quoteHash: string }).quoteHash }, session);
};
/** A group session pack of the price group, with credits left (F06's tables, as a sale would write them). */
const givePack = async (customer: string, group: string) => {
  const p = (await tdb.query(`insert into public.package_product (club_id, name_th, name_en, credit_type, credits, validity_months, price_group_id, price_satang)
                              values ($1,'แพ็ก','Pack','group_session',8,3,$2,200000) returning id`, [A, group])).rows[0].id;
  await tdb.query(`insert into public.customer_package (club_id, customer_id, product_id, product_snapshot, credits_total, purchased_at, purchase_date, expires_at)
                   values ($1,$2,$3, jsonb_build_object('credit_type','group_session','price_group_id',$4::text,'coach_tier_id',null,'credits',8,'validity_months',3,'price_satang',200000),
                           8, now(), '2026-11-30', '2027-03-01T16:59:59Z')`, [A, customer, p, group]);
};
const seats = async (session: string) => (await tdb.query(`select status from public.booking where class_session_id = $1 order by created_at`, [session])).rows.map((r) => r.status);

describe('paying a group class seat (F04-T22b)', () => {
  it('money at the drop in price: one seat held, one class_seat line, a QR (CLASS-01-AC14, AC17)', async () => {
    const r = await pay({ sessionId: adultClass });
    expect(r).toMatchObject({ ok: true, body: { confirmed: false, payment: { amountSatang: 30000 } } });
    const id = (r as { body: { orderId: string } }).body.orderId;
    expect(await seats(adultClass)).toEqual(['awaiting_payment']);
    expect((await tdb.query(`select kind, description_key, name_en, booking_id is not null as linked from public.order_line where order_id = $1`, [id])).rows)
      .toEqual([{ kind: 'class_seat', description_key: 'P-0213', name_en: 'Adults', linked: true }]);
  });

  it('a group credit pays first: confirmed at once, no charge (D22)', async () => {
    await givePack(ME, ADULT);
    const r = await pay({ sessionId: adultClass });
    expect(r).toMatchObject({ ok: true, body: { confirmed: true, payment: null } });
    expect(await seats(adultClass)).toEqual(['confirmed']);
    expect(Number((await tdb.query(`select count(*) from public.credit_ledger where reason = 'reserve'`)).rows[0].count)).toBe(1);
    expect(beam.createRequests).toHaveLength(0);
  });

  it('a credit of the wrong audience does not pay: the Student pack is not used for an Adult class', async () => {
    await givePack(ME, STUDENT);
    expect(await pay({ sessionId: adultClass })).toMatchObject({ ok: true, body: { confirmed: false, payment: { amountSatang: 30000 } } });
  });

  it('a null drop in price needs a credit: without one it is price_not_set; with one it is booked (D157)', async () => {
    expect(await call('/checkout/quote', { sessionId: studentClass }, { clubId: A, userId: KID, roles: ['player'] })).toEqual({ ok: false, status: 409, code: 'price_not_set' });
    await givePack(KID, STUDENT);
    expect(await pay({ sessionId: studentClass }, { clubId: A, userId: KID, roles: ['player'] })).toMatchObject({ ok: true, body: { confirmed: true } });
  });

  it('a class not for the player is session_not_available (an adult and a Student class)', async () => {
    expect(await call('/checkout/quote', { sessionId: studentClass })).toEqual({ ok: false, status: 409, code: 'session_not_available' });
  });

  it('a full session refuses the seat and nothing is used up', async () => {
    const others = ['55555555-5555-4555-8555-555555555551', '55555555-5555-4555-8555-555555555552'];
    const c = await tdb.pool.connect();
    try {
      await c.query('begin');
      for (const [i, u] of others.entries()) {
        await c.query(`insert into public.app_user (club_id, id, line_user_id) values ($1,$2,$3)`, [A, u, `LX${i}`]);
        await c.query(`insert into public.app_user_role (club_id, user_id, role) values ($1,$2,'player')`, [A, u]);
      }
      await c.query('commit');
    } finally {
      c.release();
    }
    for (const u of others) await pay({ sessionId: adultClass }, { clubId: A, userId: u, roles: ['player'] });
    await tdb.query(`insert into public.promo_code (club_id, code_upper, kind, value, applies_to) values ($1,'CLASS','percent',1000,array['group_class'])`, [A]);
    const r = await pay({ sessionId: adultClass, code: 'CLASS' });
    expect(r).toMatchObject({ ok: false, status: 409, code: 'session_full' });
    expect(Number((await tdb.query(`select count(*) from public.promo_redemption`)).rows[0].count)).toBe(0);
    expect(Number((await tdb.query(`select count(*) from public.orders where customer_id = $1`, [ME])).rows[0].count)).toBe(0);
  });

  it('a second tap returns the same held seat and QR (D47)', async () => {
    const a = await pay({ sessionId: adultClass });
    const b = await call('/checkout/pay', { sessionId: adultClass, quoteHash: 'f'.repeat(64) });
    expect(b).toEqual(a);
    expect(await seats(adultClass)).toEqual(['awaiting_payment']);
  });
});
