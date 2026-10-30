import { createDb, type Db } from '../tx';
import { createTestDatabase, type TestDatabase } from './harness';

// Shared fixtures for the apply_payment tests (F05-T05): a club, a player, orders in the three hold states,
// payments, and the four F06 and F13 ports as fakes that log their calls (docs/architecture/apply-payment.md).
export const A = '3f2b8f0e-7c1d-4a55-9d0a-1c2e3f4a5b6c';
export const PLAYER = '11111111-1111-4111-8111-111111111111';
export const LOC = '00000000-0000-4000-8000-0000000000a1';
export const RES = '00000000-0000-4000-8000-0000000000c1';

export let tdb: TestDatabase;
export let worker: Db;
let slot = 60;   // hours ahead; each booking gets its own hour

export const ctx = () => ({ clubId: A, userId: null, roles: [] as never, source: 'webhook' as const });

async function fakePorts(missing: string[] = [], reserveOk = true) {
  await tdb.query(`create table public.__log (n serial, port text, args jsonb)`);
  await tdb.query(`grant all on public.__log, public.__log_n_seq to booq_owner`);
  const defs: Record<string, [string, string]> = {
    reserve_credit_and_wallet: ['(o uuid) returns boolean', `insert into public.__log (port, args) values ('reserve_credit_and_wallet', to_jsonb(o)); select ${reserveOk}`],
    grant_package: ['(o uuid) returns void', `insert into public.__log (port, args) values ('grant_package', to_jsonb(o))`],
    credit_wallet: ['(k text, c uuid, a integer, r text, d text, p uuid) returns uuid', `insert into public.__log (port, args) values ('credit_wallet', jsonb_build_array(k, c, a, r, d, p)); select gen_random_uuid()`],
    issue_receipt: ['(o uuid, p uuid, k text) returns uuid', `insert into public.__log (port, args) values ('issue_receipt', jsonb_build_array(o, p, k)); select gen_random_uuid()`],
  };
  for (const [port, [sig, body]] of Object.entries(defs)) {
    if (missing.includes(port)) continue;
    await tdb.query(`create function public.__${port}${sig.split(' returns')[0]} ${sig.slice(sig.indexOf('returns'))} language sql as $$ ${body} $$`);
    await tdb.query(`select app.register_payment_port($1, $2::regprocedure)`, [port, `public.__${port}(${sig.slice(1, sig.indexOf(')')).split(', ').map((x) => x.split(' ')[1]).join(', ')})`]);
  }
}
export const log = async () => (await tdb.query(`select port, args from public.__log order by n`)).rows;

export async function setup(opts: { missing?: string[]; reserveOk?: boolean; status?: string } = {}) {
  tdb = await createTestDatabase();
  await tdb.query(`insert into public.club (id, slug, name_th, name_en, status) values ($1,'a','ก','A',$2)`, [A, opts.status ?? 'live']);
  await tdb.query(`insert into public.location (club_id, id, name) values ($1,$2,'M')`, [A, LOC]);
  await tdb.query(`insert into public.resource (club_id, id, location_id, name, sport) values ($1,$2,$3,'1','tennis')`, [A, RES, LOC]);
  const c = await tdb.pool.connect();
  try {
    await c.query('begin');
    await c.query('insert into public.app_user (club_id, id, line_user_id) values ($1,$2,$3)', [A, PLAYER, 'L1']);
    await c.query(`insert into public.app_user_role (club_id, user_id, role) values ($1,$2,'player')`, [A, PLAYER]);
    await c.query('commit');
  } finally {
    c.release();
  }
  await fakePorts(opts.missing, opts.reserveOk ?? true);
  worker = createDb({ connectionString: tdb.url, max: 2, role: 'booq_worker' });
}

/** A priced order with one court hour. state: 'held' (hold running), 'expired' (hold ended, not yet released),
 *  'released' (released by the job). */
export async function order(state: 'held' | 'expired' | 'released', opts: { credit?: number; promo?: boolean; hour?: number } = {}) {
  const h = opts.hour ?? slot++;
  const money = 50000;
  const credit = opts.credit ?? 0;
  const o = (await tdb.query(`insert into public.orders (club_id, customer_id, source) values ($1,$2,'online') returning id`, [A, PLAYER])).rows[0].id as string;
  const c = await tdb.pool.connect();
  try {
    await c.query('begin');
    await c.query('set local session_replication_role = replica');
    await c.query(`update public.orders set price_group_snapshot='{}', subtotal_satang=$2, discount_satang=0, total_satang=$2, credit_value_satang=$3, wallet_satang=0, money_satang=$4, quote_hash=repeat('a',64), priced_at=now() where id=$1`, [o, money, credit, money - credit]);
    const start = `date_trunc('hour', now()) + interval '${h} hours'`;
    const hold = state === 'held' ? `now() + interval '10 minutes'` : state === 'expired' ? `now() - interval '1 minute'` : 'null';
    await c.query(`insert into public.booking (club_id, order_id, type, resource_id, start_at, end_at, customer_id, status, source, created_by, hold_expires_at, release_reason, released_at)
                   values ($1,$2,'court',$3, ${start}, ${start} + interval '1 hour', $4, $5,'online',$4, ${hold}, $6, $7)`,
      [A, o, RES, PLAYER, state === 'released' ? 'released' : 'awaiting_payment', state === 'released' ? 'expired' : null, state === 'released' ? new Date().toISOString() : null]);
    await c.query(`insert into public.order_line (club_id, order_id, position, kind, booking_id, description_key, name_th, name_en, unit_price_satang, discount_satang, net_satang, credit_value_satang, wallet_satang, money_satang)
                   select $1, $2, 1, 'court_hour', id, 'court_hour', 'คอร์ต', 'Court', $3, 0, $3, $4, 0, $5 from public.booking where order_id = $2`, [A, o, money, credit, money - credit]);
    if (state !== 'released') {
      await c.query(`insert into public.occupancy (club_id, kind, resource_id, start_at, end_at, state, hold_expires_at, booking_id)
                     select club_id, 'court_booking', resource_id, start_at, end_at, 'held', hold_expires_at, id from public.booking where order_id = $1`, [o]);
    }
    if (opts.promo) {
      const code = (await c.query(`insert into public.promo_code (club_id, code_upper, kind, value, applies_to) values ($1,'SAVE','percent',1000,'{court_hour}') returning id`, [A])).rows[0].id;
      await c.query(`insert into public.promo_redemption (club_id, code_id, order_id, customer_id, status, restored_at, restore_reason) values ($1,$2,$3,$4, $5, case when $5 = 'restored' then now() end, case when $5 = 'restored' then 'expired' end)`, [A, code, o, PLAYER, state === 'released' ? 'restored' : 'counted']);
    }
    await c.query('commit');
  } finally {
    c.release();
  }
  return o;
}
export const payment = async (o: string, amount = 50000 - 0) =>
  (await tdb.query(`insert into public.payment (club_id, order_id, method, status, environment, gateway, gateway_charge_id, amount_satang) values ($1,$2,'beam','pending','live','beam','chg_'||gen_random_uuid(), (select money_satang from public.orders where id = $2)) returning id`, [A, o])).rows[0].id as string;
export const apply = async (p: string, amount?: number) => {
  const due = amount ?? (await tdb.query(`select amount_satang from public.payment where id = $1`, [p])).rows[0].amount_satang;
  return worker.withClubTx(ctx(), async (tx) => (await tx.query(`select app.apply_payment($1, $2) as r`, [p, due])).rows[0]?.r as Record<string, unknown>);
};
export const bookingStatus = async (o: string) => (await tdb.query(`select status from public.booking where order_id = $1`, [o])).rows[0].status;
export const pay = async (id: string) => (await tdb.query(`select status, outcome, qr_image, confirmed_at is not null as confirmed from public.payment where id = $1`, [id])).rows[0];
export const orderStatus = async (o: string) => (await tdb.query(`select status from public.orders where id = $1`, [o])).rows[0].status;


export async function teardown(): Promise<void> {
  await worker.end();
  await tdb.close();
}
