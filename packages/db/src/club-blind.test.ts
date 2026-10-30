import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createDb, type Db } from './tx';
import { collectRegistry } from './registry/index';
import { createTestDatabase, type TestDatabase } from './testing/harness';

// Security fix / migration 0026 (D2, D103, F01-T06): a guest or a player must not read a club's business
// columns (owner contact, tax, billing). Only owner, front desk and accountant read them, through
// public.club_business; everyone else reads public.public_club_config. The blind suite at the end walks every
// class S table: whatever a guest can read must be on the list below, so a new readable column fails a test.
const A = '3f2b8f0e-7c1d-4a55-9d0a-1c2e3f4a5b6c';
const B = '9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d';
let tdb: TestDatabase;
let db: Db;

const BUSINESS = ['legal_name', 'tax_id', 'tax_branch', 'registered_address', 'owner_name', 'owner_phone', 'owner_line', 'owner_email',
  'plan_trial_ends_at', 'billing_starts_at', 'allow_booq_changes_until', 'allow_booq_changes_set_at', 'created_by_staff'];
const PUBLIC = ['id', 'slug', 'name_th', 'name_en', 'status', 'payment_option', 'template_id', 'receipt_prefix', 'default_language', 'created_at'];

const ctx = (roles: string[], club = A) => ({ clubId: club, userId: null, roles: roles as never, source: 'player_app' as const });
const as = (roles: string[], sql: string, club = A) => db.withClubTx(ctx(roles, club), async (tx) => (await tx.query(sql)).rows);

beforeEach(async () => {
  tdb = await createTestDatabase();
  db = createDb({ connectionString: tdb.url, max: 1 });
  await tdb.query(
    `insert into public.club (id, slug, name_th, name_en, status, legal_name, tax_id, tax_branch, registered_address, owner_name, owner_phone, owner_line, owner_email, billing_starts_at)
     values ($1, 'a', 'ก', 'A', 'live', 'Legal Co', '0135569018041', '00000', 'secret street', 'Owner', '0812345678', 'U${'a'.repeat(32)}', 'o@example.com', now()),
            ($2, 'b', 'ข', 'B', 'live', 'Other Co', '999', '00001', 'x', 'O2', '0899999999', null, 'p@example.com', now())`, [A, B]);
});
afterEach(async () => {
  await db.end();
  await tdb.close();
});

describe('public.club business columns', () => {
  it('a guest and a player are refused every business column, and select * is refused', async () => {
    for (const roles of [['guest'], ['player'], ['coach', 'player'], []]) {
      for (const col of BUSINESS) {
        await expect(as(roles, `select ${col} from public.club`), `${roles} ${col}`).rejects.toThrow(/permission denied/);
      }
      await expect(as(roles, 'select * from public.club'), `${roles} *`).rejects.toThrow(/permission denied/);
    }
  });

  it('the public columns still read, for the club in context only', async () => {
    const r = await as(['guest'], `select ${PUBLIC.join(', ')} from public.club`);
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ id: A, slug: 'a', status: 'live' });
  });

  it('owner, front desk and accountant read the business facts through public.club_business', async () => {
    for (const role of ['owner', 'front_desk', 'accountant']) {
      const r = await as([role, 'player'], 'select tax_id, owner_phone, legal_name from public.club_business');
      expect(r, role).toEqual([{ tax_id: '0135569018041', owner_phone: '0812345678', legal_name: 'Legal Co' }]);
    }
  });

  it('a guest, a player and a coach get no row from public.club_business, and no other club’s row', async () => {
    for (const roles of [['guest'], ['player'], ['coach', 'player'], []]) {
      expect(await as(roles, 'select * from public.club_business'), String(roles)).toEqual([]);
    }
    expect(await as(['owner', 'player'], `select 1 from public.club_business where club_id = '${B}'`)).toEqual([]);
  });

  it('the owner can still change the contact details; a player cannot', async () => {
    await as(['owner', 'player'], `update public.club set owner_phone = '0800000000' where id = '${A}'`);
    expect((await as(['owner', 'player'], 'select owner_phone from public.club_business'))[0]).toEqual({ owner_phone: '0800000000' });
    expect(await as(['player'], `update public.club set owner_phone = '1' where id = '${A}' returning id`)).toEqual([]);
  });

  it('the definer public view still works for a guest', async () => {
    expect(await as(['guest'], 'select name_en, status from public.public_club_config')).toEqual([{ name_en: 'A', status: 'live' }]);
  });
});

// What a guest may read from a class S table is listed here on purpose. Anything else readable is a leak.
const GUEST_READABLE: Record<string, string[]> = {
  'public.club': PUBLIC,
  'public.club_feature': [],            // switches: a guest sees which features exist (hidden screens are not the guard)
  'public.location': [],
  'public.resource': [],
  'public.opening_hours': [],
  'public.club_pause': [],              // the banner shows the pause reason to everyone (PLAT-03-AC4)
};

describe('blind suite: class S tables and a guest', () => {
  it('a guest reads nothing from a class S table except what is listed', async () => {
    const registry = await collectRegistry();
    const sTables = Object.entries(registry).filter(([, e]) => e.class === 'S').map(([t]) => t);
    expect(sTables.length).toBeGreaterThan(5);
    for (const t of sTables) {
      if (t in GUEST_READABLE) continue;
      let rows: unknown[] = [];
      try {
        rows = await as(['guest'], `select to_jsonb(x) as j from ${t} x`);
      } catch (e) {
        expect(String((e as Error).message), t).toMatch(/permission denied/);
        continue;
      }
      expect(rows, `a guest read rows from ${t}`).toEqual([]);
    }
  });

  it('for the listed tables, a guest can read no column outside the list', async () => {
    const registry = await collectRegistry();
    for (const t of Object.keys(GUEST_READABLE)) {
      if (!(t in registry)) continue;
      const [schema, name] = t.split('.');
      const cols = (await tdb.query(`select column_name from information_schema.columns where table_schema = $1 and table_name = $2`, [schema, name])).rows.map((r) => r.column_name as string);
      const readable: string[] = [];
      for (const col of cols) {
        const ok = (await tdb.query(`select has_column_privilege('booq_app', $1, $2, 'select') as ok`, [t, col])).rows[0].ok;
        if (ok) readable.push(col);
      }
      if (t === 'public.club') expect(readable.sort(), t).toEqual([...PUBLIC].sort());
    }
  });
});
