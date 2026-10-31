import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createDb, type Db } from './tx';
import { createTestDatabase, type TestDatabase } from './testing/harness';

// F10 / migration 0899: app.coach_message_hook, the no op of F07 (0805) that F07 and F08 call for leave_decision,
// coach_changed, session_change, cancellation_result, waitlist_ended and class_session_changed, now enqueues the message
// (F10 design 5.1; LINE-05, D96). The two F08 kinds join the catalogue; message_facts reads a class session. Numbered 0899
// under D159: above 0805, which defines the hook (orchestrator, 30 Oct).
const A = '3f2b8f0e-7c1d-4a55-9d0a-1c2e3f4a5b6c';
const P = '11111111-1111-4111-8111-111111111111';
const COACH = '55555555-5555-4555-8555-555555555555';

let tdb: TestDatabase;
let wk: Db;
const job = { clubId: A, userId: null, roles: [] as never, source: 'job' as const };

async function replica(fn: (q: (sql: string, p?: unknown[]) => Promise<{ rows: Array<Record<string, unknown>> }>) => Promise<void>) {
  const c = await tdb.pool.connect();
  try {
    await c.query('begin');
    await c.query('set local session_replication_role = replica');   // fixture rows without the business triggers
    await fn((sql, p) => c.query(sql, p));
    await c.query('commit');
  } finally {
    c.release();
  }
}
/** As the F07 and F08 definer functions call it: as booq_owner, with the club in the context (no role has a grant). */
async function hook(kind: string, user: string | null, params: object, key: string) {
  const c = await tdb.pool.connect();
  try {
    await c.query('begin');
    await c.query(`select set_config('app.club_id', $1, true)`, [A]);
    await c.query('set local role booq_owner');
    await c.query(`select app.coach_message_hook($1, $2, $3::jsonb, $4)`, [kind, user, JSON.stringify(params), key]);
    await c.query('commit');
  } finally {
    c.release();
  }
}
const rows = async () => (await tdb.query(`select kind, user_id, params, dedupe_key, status, send_at <= now() as due from public.message_outbox order by created_at, kind`)).rows;

beforeEach(async () => {
  tdb = await createTestDatabase();
  await tdb.query(`insert into public.club (id, slug, name_th, name_en, status) values ($1,'a','ก','A','live')`, [A]);
  await replica(async (q) => {
    for (const [id, name, role] of [[P, 'Nok Somsri', 'player'], [COACH, 'Bee Chai', 'coach']] as const) {
      await q(`insert into public.app_user (club_id, id, line_user_id, full_name, display_name) values ($1,$2,$3,$4,$4)`, [A, id, 'L' + id.slice(0, 3), name]);
      await q(`insert into public.app_user_role (club_id, user_id, role) values ($1,$2,$3)`, [A, id, role]);
    }
  });
  wk = createDb({ connectionString: tdb.url, max: 2, role: 'booq_worker' });
});
afterEach(async () => {
  await wk?.end();
  await tdb?.close();
});

describe('coach_message_hook now enqueues (F07, F08 callers)', () => {
  it('each kind the callers send becomes one outbox row, due now, with the caller’s params and key', async () => {
    await hook('leave_decision', COACH, { leave_id: P, status: 'approved' }, `leave:${P}:approved`);
    await hook('coach_changed', P, { booking_id: P, coach_id: COACH }, `coach_changed:${P}:${COACH}`);
    await hook('session_change', COACH, { session_id: P }, `session_change:${P}:cancelled`);
    await hook('cancellation_result', P, { booking_id: P }, `cancellation_result:${P}`);
    await hook('waitlist_ended', P, { entry_id: P, session_id: P }, `waitlist_ended:${P}`);
    await hook('class_session_changed', P, { booking_id: P, session_id: P }, `class_session_changed:${P}:${P}:abc`);
    const r = await rows();
    expect(r.map((x) => x.kind).sort()).toEqual(['cancellation_result', 'class_session_changed', 'coach_changed', 'leave_decision', 'session_change', 'waitlist_ended']);
    expect(r.every((x) => x.status === 'pending' && x.due)).toBe(true);
    expect(r.find((x) => x.kind === 'leave_decision')).toMatchObject({ user_id: COACH, params: { leave_id: P, status: 'approved' }, dedupe_key: `leave:${P}:approved` });
  });

  it('a repeat of the key is one message; no recipient is no message, and the caller goes on', async () => {
    await hook('waitlist_ended', P, { entry_id: P }, `waitlist_ended:${P}`);
    await hook('waitlist_ended', P, { entry_id: P }, `waitlist_ended:${P}`);
    await hook('cancellation_result', null, { booking_id: P }, 'cancellation_result:walk-in');
    expect((await rows()).length).toBe(1);
  });

  it('the two F08 kinds are in the catalogue, sent at every cap level but the free plan at 100 percent (A)', async () => {
    const k = await tdb.query(`select kind, cap_class, switch_key, hours_before from app.message_kinds where kind in ('waitlist_ended', 'class_session_changed') order by kind`);
    expect(k.rows).toEqual([
      { kind: 'class_session_changed', cap_class: 'A', switch_key: null, hours_before: null },
      { kind: 'waitlist_ended', cap_class: 'A', switch_key: null, hours_before: null },
    ]);
  });

  it('only the definer functions call it: no app, worker or platform role has a grant (as 0805)', async () => {
    for (const role of ['booq_app', 'booq_worker', 'booq_platform']) {
      const r = await tdb.query(`select has_function_privilege($1, 'app.coach_message_hook(text,uuid,jsonb,text)', 'execute') as ok`, [role]);
      expect(r.rows[0].ok, role).toBe(false);
    }
  });
});

describe('message_facts for a class session (F08)', () => {
  it('a session id gives its hour, court, coach and the class name in both languages; a seat gives the same through its booking', async () => {
    let session = '';
    let seat = '';
    await replica(async (q) => {
      const loc = (await q(`insert into public.location (club_id, name) values ($1,'M') returning id`, [A])).rows[0]!.id;
      const res = (await q(`insert into public.resource (club_id, location_id, name, sport) values ($1,$2,'2','tennis') returning id`, [A, loc])).rows[0]!.id;
      session = (await q(`insert into public.class_session (club_id, template_id, start_at, end_at, name_th, name_en, audience, coach_id, resource_id, min_players, max_players)
                          values ($1, gen_random_uuid(), '2026-12-10T11:00:00Z', '2026-12-10T12:00:00Z', 'ดริลกลาง', 'Mid drill', 'adult', $2, $3, 2, 6) returning id`, [A, COACH, res])).rows[0]!.id as string;
      const o = (await q(`insert into public.orders (club_id, customer_id, source) values ($1,$2,'online') returning id`, [A, P])).rows[0]!.id;
      seat = (await q(`insert into public.booking (club_id, order_id, type, resource_id, coach_id, class_session_id, start_at, end_at, customer_id, status, source, created_by, confirmed_at)
                       values ($1,$2,'class_seat',$3,$4,$5,'2026-12-10T11:00:00Z','2026-12-10T12:00:00Z',$6,'confirmed','online',$6, now()) returning id`, [A, o, res, COACH, session, P])).rows[0]!.id as string;
    });
    await hook('session_change', COACH, { session_id: session }, `session_change:${session}:cancelled`);
    await hook('class_session_changed', P, { booking_id: seat, session_id: session }, `class_session_changed:${session}:${seat}:x`);
    for (const kind of ['session_change', 'class_session_changed']) {
      const id = (await tdb.query(`select id from public.message_outbox where kind = $1`, [kind])).rows[0].id;
      const f = await wk.withClubTx(job, async (tx) => (await tx.query<{ f: Record<string, unknown> }>(`select app.message_facts($1) as f`, [id])).rows[0]!.f);
      expect(f['className'], kind).toEqual({ th: 'ดริลกลาง', en: 'Mid drill' });
      const h = (f['hours'] as Array<Record<string, unknown>>)[0]!;
      expect([h['court'], h['coachName'], new Date(String(h['startAt'])).toISOString()], kind).toEqual(['2', 'Bee Chai', '2026-12-10T11:00:00.000Z']);
    }
  });
});
