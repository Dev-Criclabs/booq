import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createDb, type Db } from './tx';
import * as api from './index';
import { createTestDatabase, type TestDatabase } from './testing/harness';

// F01-T04 withClubTx (FA 4.2; CC-1, ROLE-AC6). The fixture table has the policy shape every
// real club table will have (F01 design 6.3): a restrictive tenant policy, FORCE RLS.
const A = '3f2b8f0e-7c1d-4a55-9d0a-1c2e3f4a5b6c';
const B = '9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d';
const USER = '11111111-2222-4333-8444-555555555555';

let tdb: TestDatabase;
let db: Db;

beforeEach(async () => {
  tdb = await createTestDatabase();
  await tdb.query(`
    create table public.t_notes (id serial primary key, club_id uuid not null, body text not null);
    alter table public.t_notes enable row level security;
    alter table public.t_notes force row level security;
    create policy tenant on public.t_notes as restrictive for all to booq_app
      using (club_id = app.club_id()) with check (club_id = app.club_id());
    create policy allow on public.t_notes for all to booq_app using (true) with check (true);
    grant select, insert, update, delete on public.t_notes to booq_app;
    grant usage on all sequences in schema public to booq_app;
    insert into public.t_notes (club_id, body) values ('${A}', 'a1'), ('${A}', 'a2'), ('${B}', 'b1');
  `);
  await tdb.query("alter database \"" + tdb.name + "\" set deadlock_timeout = '100ms'");
  db = createDb({ connectionString: tdb.url, max: 1 });
});
afterEach(async () => {
  await db.end();
  await tdb.close();
});

const ctx = (clubId: string, roles: string[] = ['player']) => ({ clubId, userId: USER, roles, requestId: 'req-1' });

describe('withClubTx sets the request context (CC-1, ROLE-AC6)', () => {
  it('a query outside withClubTx sees no rows (fails closed)', async () => {
    const c = await tdb.pool.connect();
    try {
      await c.query('set role booq_app');
      const r = await c.query('select count(*)::int as n from public.t_notes');
      expect(r.rows[0].n).toBe(0);
    } finally {
      c.release();
    }
  });

  it('a context for club A reads only club A, a context for B only B', async () => {
    const a = await db.withClubTx(ctx(A), (tx) => tx.query('select body from public.t_notes order by body'));
    expect(a.rows.map((r) => r.body)).toEqual(['a1', 'a2']);
    const b = await db.withClubTx(ctx(B), (tx) => tx.query('select body from public.t_notes order by body'));
    expect(b.rows.map((r) => r.body)).toEqual(['b1']);
  });

  it("cannot write another club's rows", async () => {
    await expect(
      db.withClubTx(ctx(A), (tx) => tx.query("insert into public.t_notes (club_id, body) values ($1, 'x')", [B])),
    ).rejects.toThrow(/row-level security/i);
  });

  it('runs as booq_app, never as a superuser', async () => {
    const r = await db.withClubTx(ctx(A), (tx) =>
      tx.query('select current_user as u, (select rolsuper from pg_roles where rolname = current_user) as su'),
    );
    expect(r.rows[0]).toEqual({ u: 'booq_app', su: false });
  });

  it('exposes user, roles and request id to the helpers', async () => {
    const r = await db.withClubTx(ctx(A, ['coach', 'player']), (tx) =>
      tx.query("select app.user_id()::text as usr, app.roles() as roles, app.has_any_role('coach') as coach, app.has_any_role('owner') as owner, current_setting('app.request_id') as req"),
    );
    expect(r.rows[0]).toEqual({ usr: USER, roles: ['coach', 'player'], coach: true, owner: false, req: 'req-1' });
  });

  it('the context is transaction-local: the next request on the same connection starts empty', async () => {
    // max: 1, so every call below reuses the same physical connection.
    await db.withClubTx(ctx(A), (tx) => tx.query('select 1'));
    const leaked = await db.withClubTx(ctx(B), (tx) => tx.query('select app.club_id()::text as club'));
    expect(leaked.rows[0]?.club).toBe(B);
    const rows = await db.withClubTx(ctx(A), (tx) => tx.query('select distinct club_id::text from public.t_notes'));
    expect(rows.rows.map((r) => r.club_id)).toEqual([A]);
  });

  it('a guest context has no user id and the guest role', async () => {
    const r = await db.withClubTx({ clubId: A, userId: null, roles: ['guest'] }, (tx) =>
      tx.query('select app.user_id() as usr, app.roles() as roles'),
    );
    expect(r.rows[0]).toEqual({ usr: null, roles: ['guest'] });
  });
});

describe('transaction behaviour', () => {
  it('commits on success and rolls back on error', async () => {
    await db.withClubTx(ctx(A), (tx) => tx.query("insert into public.t_notes (club_id, body) values ($1, 'kept')", [A]));
    await expect(
      db.withClubTx(ctx(A), async (tx) => {
        await tx.query("insert into public.t_notes (club_id, body) values ($1, 'lost')", [A]);
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    const r = await db.withClubTx(ctx(A), (tx) => tx.query('select body from public.t_notes order by body'));
    expect(r.rows.map((x) => x.body)).toEqual(['a1', 'a2', 'kept']);
  });

  it('refuses a query on a transaction that has ended', async () => {
    let leaked: Parameters<Parameters<Db['withClubTx']>[1]>[0] | undefined;
    await db.withClubTx(ctx(A), async (tx) => {
      leaked = tx;
    });
    await expect(leaked!.query('select 1')).rejects.toThrow(/ended/i);
  });

  it('does not retry an ordinary error', async () => {
    let attempts = 0;
    await expect(
      db.withClubTx(ctx(A), async () => {
        attempts += 1;
        throw new Error('plain');
      }),
    ).rejects.toThrow('plain');
    expect(attempts).toBe(1);
  });

  it('retries a deadlock once and succeeds, for both parties', async () => {
    const dbs = createDb({ connectionString: tdb.url, max: 4 });
    try {
      await tdb.query("insert into public.t_notes (club_id, body) values ('" + A + "', 'r1'), ('" + A + "', 'r2')");
      const ids = (await tdb.query("select id from public.t_notes where body in ('r1','r2') order by body")).rows.map((r) => r.id as number);
      let arrived = 0;
      let release!: () => void;
      const barrier = new Promise<void>((r) => (release = r));
      const attempts = { x: 0, y: 0 };
      const run = (key: 'x' | 'y', first: number, second: number) =>
        dbs.withClubTx(ctx(A), async (tx) => {
          attempts[key] += 1;
          await tx.query('select id from public.t_notes where id = $1 for update', [first]);
          if (attempts[key] === 1) {
            arrived += 1;
            if (arrived === 2) release();
            await barrier; // both hold their first lock before asking for the second
          }
          await tx.query('select id from public.t_notes where id = $1 for update', [second]);
          return key;
        });
      const results = await Promise.all([run('x', ids[0]!, ids[1]!), run('y', ids[1]!, ids[0]!)]);
      expect(results.sort()).toEqual(['x', 'y']);
      expect(attempts.x + attempts.y).toBe(3); // exactly one party was the deadlock victim and ran twice
    } finally {
      await dbs.end();
    }
  });

  it('gives up after three retries of a deadlock', async () => {
    let attempts = 0;
    await expect(
      db.withClubTx(ctx(A), async () => {
        attempts += 1;
        throw Object.assign(new Error('deadlock detected'), { code: '40P01' });
      }),
    ).rejects.toThrow(/deadlock/);
    expect(attempts).toBe(4);
  });

  it('retries a serialization failure too', async () => {
    let attempts = 0;
    const r = await db.withClubTx(ctx(A), async () => {
      attempts += 1;
      if (attempts < 2) throw Object.assign(new Error('could not serialize'), { code: '40001' });
      return 'ok';
    });
    expect(r).toBe('ok');
    expect(attempts).toBe(2);
  });
});

describe('context validation happens before the database is touched', () => {
  it('rejects a club id that is not a uuid', async () => {
    await expect(db.withClubTx(ctx('not-a-uuid'), (tx) => tx.query('select 1'))).rejects.toThrow(/club/i);
  });
  it('rejects a user id that is not a uuid', async () => {
    await expect(db.withClubTx({ clubId: A, userId: 'x', roles: ['player'] }, (tx) => tx.query('select 1'))).rejects.toThrow(/user/i);
  });
  it('rejects an unknown role and a role containing a comma', async () => {
    await expect(db.withClubTx(ctx(A, ['superuser']), (tx) => tx.query('select 1'))).rejects.toThrow(/role/i);
    await expect(db.withClubTx(ctx(A, ['owner,player']), (tx) => tx.query('select 1'))).rejects.toThrow(/role/i);
  });
  it('rejects an unsafe database role name in the options', () => {
    expect(() => createDb({ connectionString: tdb.url, role: 'booq_app; drop table x' })).toThrow(/role/i);
  });
});

describe('the package hands out no raw pool (lint rule and design)', () => {
  it('exports createDb and types only, no Pool or pool', () => {
    const names = Object.keys(api);
    expect(names).toContain('createDb');
    expect(names.filter((n) => /pool/i.test(n))).toEqual([]);
  });
});
