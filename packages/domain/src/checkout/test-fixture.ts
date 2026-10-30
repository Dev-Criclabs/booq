import type { TestDatabase } from '@booq/db/testing';
import { pendingFeatureSources, quoteSources, type QuoteSources } from './quote';

// Shared seed for the F04 checkout tests that run on the test database. Hunter's prices are test data.
export const IDS = {
  A: '3f2b8f0e-7c1d-4a55-9d0a-1c2e3f4a5b6c',
  B: '9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d',
  LOC: 'aaaaaaaa-0000-4000-8000-000000000001',
  COURT: 'c1c1c1c1-0000-4000-8000-000000000001',
  ADULT: 'a0a0a0a0-0000-4000-8000-000000000001',
  STUDENT: 'a0a0a0a0-0000-4000-8000-000000000002',
  TIER: 'b0b0b0b0-0000-4000-8000-000000000001',
  COACH: 'cccccccc-0000-4000-8000-000000000001',
  WATER: 'dddddddd-0000-4000-8000-000000000001',
  ME: '33333333-3333-4333-8333-333333333333',
} as const;

export async function seedHunter(tdb: TestDatabase): Promise<void> {
  const { A, B, LOC, COURT, ADULT, STUDENT, TIER, WATER, ME } = IDS;
  const c = await tdb.pool.connect();
  try {
    await c.query('begin');
    await c.query(`insert into public.club (id, slug, name_th, name_en, status) values ($1,'club-a','ก','A','live'), ($2,'club-b','ข','B','live')`, [A, B]);
    await c.query(`insert into public.location (club_id, id, name) values ($1,$2,'Main')`, [A, LOC]);
    await c.query(`insert into public.resource (club_id, id, location_id, name, sport) values ($1,$2,$3,'1','tennis')`, [A, COURT, LOC]);
    for (let d = 1; d <= 7; d += 1) await c.query(`insert into public.opening_hours (club_id, weekday, open, close) values ($1,$2,'06:00','24:00')`, [A, d]);
    await c.query(`insert into public.club_setting (club_id, key, value) values ($1,'booking_window_days','30'), ($1,'hold_minutes','15')`, [A]);
    await c.query(`insert into public.app_user (club_id, id, line_user_id, full_name, date_of_birth) values ($1,$2,'L1','Somchai','1990-05-20')`, [A, ME]);
    await c.query(`insert into public.app_user_role (club_id, user_id, role) values ($1,$2,'player')`, [A, ME]);
    await c.query(`insert into public.price_group (club_id, id, name_th, name_en, rule) values ($1,$2,'ผู้ใหญ่','Adult','{"min_age":18}'), ($1,$3,'นักเรียน','Student','{"max_age":17}')`, [A, ADULT, STUDENT]);
    await c.query(`insert into public.court_price_rule (club_id, price_group_id, price_satang) values ($1,$2,50000), ($1,$3,50000)`, [A, ADULT, STUDENT]);
    await c.query(`insert into public.coach_tier (club_id, id, name_th, name_en) values ($1,$2,'โค้ช','Coach')`, [A, TIER]);
    await c.query(`insert into public.coach_tier_price (club_id, tier_id, price_group_id, price_satang) values ($1,$2,$3,80000), ($1,$2,$4,70000)`, [A, TIER, ADULT, STUDENT]);
    await c.query(`insert into public.add_on (club_id, id, name_th, name_en, price_satang) values ($1,$2,'น้ำ','Water',2000)`, [A, WATER]);
    await c.query('commit');
  } finally {
    c.release();
  }
}

/** The club reads on the database, a coach port that knows IDS.COACH, and the other pending ports. */
export const fixtureSources = (over: Partial<QuoteSources> = {}): QuoteSources => ({
  ...pendingFeatureSources,
  ...quoteSources,
  coach: async (_tx, id) => (id === IDS.COACH ? { tierId: IDS.TIER, priceSatang: null } : null),
  ...over,
});

/** F13's issue_receipt and F10's enqueue_message ports replaced by fakes that log their calls in
 *  public.__f04_port_log, so a checkout test checks what Pay asks for, not the receipt or the message itself. */
export async function fakeReceiptAndMessagePorts(tdb: TestDatabase): Promise<void> {
  await tdb.query(`create table if not exists public.__f04_port_log (n serial, port text, args jsonb)`);
  await tdb.query(`grant all on public.__f04_port_log, public.__f04_port_log_n_seq to booq_owner`);
  await tdb.query(`create or replace function public.__f04_issue_receipt(o uuid, p uuid, k text) returns uuid language sql as $$
    insert into public.__f04_port_log (port, args) values ('issue_receipt', jsonb_build_array(o, p, k)); select gen_random_uuid() $$`);
  await tdb.query(`create or replace function public.__f04_enqueue_message(k text, u uuid, p jsonb, d text, s timestamptz) returns uuid language sql as $$
    insert into public.__f04_port_log (port, args) values ('enqueue_message', jsonb_build_array(k, u, d)); select gen_random_uuid() $$`);
  // A feature may already have registered its real port (F10 registers enqueue_message in 0605); the fake replaces it.
  await tdb.query(`delete from app.payment_ports where port in ('issue_receipt', 'enqueue_message')`);
  await tdb.query(`select app.register_payment_port('issue_receipt', 'public.__f04_issue_receipt(uuid, uuid, text)'::regprocedure)`);
  await tdb.query(`select app.register_payment_port('enqueue_message', 'public.__f04_enqueue_message(text, uuid, jsonb, text, timestamptz)'::regprocedure)`);
}
