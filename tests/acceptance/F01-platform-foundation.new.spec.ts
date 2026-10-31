// F01 acceptance criteria with no existing test: written by QA in the sweep (F01-T37). Findings are marked with it.fails,
// which passes while the product is wrong and turns red the moment it is fixed, so the marker must then be removed.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { collectRegistry } from '../../packages/db/src/registry/index';
import { createPlatformDb, type PlatformDb } from '../../packages/db/src/platform-tx';
import { createTestDatabase, type TestDatabase } from '../../packages/db/src/testing/harness';
import { createDb, type Db } from '../../packages/db/src/tx';
import { repoRoot } from './spec-ids';

const A = '3f2b8f0e-7c1d-4a55-9d0a-1c2e3f4a5b6c';
let tdb: TestDatabase;
let db: Db;
let pdb: PlatformDb;
let admin: string;

beforeAll(async () => {
  tdb = await createTestDatabase();
  db = createDb({ connectionString: tdb.url, max: 2 });
  pdb = createPlatformDb({ connectionString: tdb.url, max: 2 });
  await tdb.query(
    `insert into public.club (id, slug, name_th, name_en, status, legal_name, tax_id, tax_branch, registered_address, owner_name, owner_phone, owner_line, owner_email, billing_starts_at)
     values ($1, 'a', 'ก', 'A', 'live', 'Legal Co', '0135569018041', '00000', 'addr', 'Owner', '0812345678', null, 'o@example.com', now())`,
    [A],
  );
  admin = (
    await tdb.query(
      `insert into platform.platform_staff (auth_user_id, email, display_name, role) values (gen_random_uuid(), 'admin@booq.example', 'Admin', 'platform_admin') returning id`,
    )
  ).rows[0]!.id as string;
});
afterAll(async () => {
  await db.end();
  await pdb.end();
  await tdb.close();
});

const as = (roles: string[], sql: string, params: unknown[] = []) =>
  db.withClubTx({ clubId: A, userId: null, roles, source: 'admin', reason: 'qa' }, async (tx) => (await tx.query(sql, params)).rows);

describe('F01/ROLE-02-AC3', () => {
  it('F01/ROLE-02-AC3 a club session (LINE sign in) cannot reach the platform console data or functions', async () => {
    for (const roles of [['owner', 'player'], ['front_desk', 'player'], ['player'], ['guest'], []]) {
      await expect(as(roles, 'select * from platform.platform_staff'), `[${roles}] platform_staff`).rejects.toMatchObject({ code: '42501' });
      await expect(as(roles, 'select * from platform.audit_log'), `[${roles}] P6`).rejects.toMatchObject({ code: '42501' });
      await expect(as(roles, `select platform.issue_staff_enrolment(gen_random_uuid(), repeat('a', 64), 'reset')`), `[${roles}] enrolment`).rejects.toMatchObject({ code: '42501' });
    }
  });
});

describe('F01/ROLE-02-AC7', () => {
  // FINDING QA-F01-1: platform.issue_staff_enrolment (migration 0055) lets an admin issue a 'reset' for their own account.
  // D123 / ROLE-02-AC7: a second factor is reset only by ANOTHER platform admin.
  it.fails('F01/ROLE-02-AC7 an admin cannot reset their own second factor', async () => {
    await tdb.query(`insert into platform.config (key, value) values ('console_enrolment_ttl_hours', '24') on conflict (key) do update set value = excluded.value`);
    await expect(
      pdb.withPlatformTx({ staffId: admin, staffLabel: 'Admin' }, (tx) => tx.query(`select platform.issue_staff_enrolment($1, repeat('c', 64), 'reset')`, [admin])),
    ).rejects.toThrow();
  });
});

describe('F01/ROLE-01-AC8', () => {
  // FINDING QA-F01-2: policy club_setting_read (migration 0002) lets owner, front desk AND accountant read every club setting.
  // D115 / ROLE-01-AC8: the Accountant reads business and tax settings only.
  it.fails('F01/ROLE-01-AC8 the accountant reads no operational setting', async () => {
    await tdb.query(
      `insert into public.club_setting (club_id, key, value) values ($1, 'hold_minutes', '15'), ($1, 'cancel_window_hours', '12'), ($1, 'rest_cap_hours', '6'), ($1, 'vat_enabled', 'false')
       on conflict (club_id, key) do nothing`,
      [A],
    );
    const keys = (await as(['accountant', 'player'], 'select key from public.club_setting')).map((r) => r.key as string);
    expect(keys.filter((k) => k !== 'vat_enabled'), 'operational settings visible to the accountant').toEqual([]);
  });
});

describe('F01/PLAT-02-AC12', () => {
  it('F01/PLAT-02-AC12 the support view holds setup only: staff, coaches, closures and promo codes are club data BOOQ cannot read', async () => {
    const registry = await collectRegistry(join(repoRoot(), 'packages', 'db', 'src', 'registry'));
    const mustBeClubData = ['public.app_user', 'public.app_user_role', 'public.closure', 'public.promo_code'];
    // coach_tier holds prices per tier: it is part of products and pricing (setup), not of the coaches' own data.
    const coach = Object.keys(registry).filter((t) => /(^|\.)coach/.test(t) && !t.startsWith('public.coach_tier') && registry[t]!.class !== 'infra');
    expect(coach.length, 'coach tables exist').toBeGreaterThan(0);
    for (const t of [...mustBeClubData, ...coach]) {
      expect(registry[t]?.class, `${t} must be class D`).toBe('D');
      const r = await tdb.query(`select has_table_privilege('booq_platform', $1, 'select') as ok`, [t]);
      expect(r.rows[0]!.ok, `${t}: booq_platform must not be able to select`).toBe(false);
    }
    const setup = ['public.resource', 'public.opening_hours', 'public.club_setting', 'public.line_connection', 'public.payment_connection', 'public.price_group'];
    for (const t of setup) expect(registry[t]?.class, `${t} is setup data (class S)`).toBe('S');
  });
});

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === 'generated' || name.startsWith('.')) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) sourceFiles(p, out);
    else if (/\.(ts|tsx)$/.test(name) && !/\.(test|spec)\.tsx?$/.test(name) && !/test-fixture|fixtures?\.ts$/.test(name)) out.push(p);
  }
  return out;
}
const stripComments = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
const productSources = () => ['apps', 'packages'].flatMap((d) => readdirSync(resolve(repoRoot(), d)).flatMap((p) => { try { return sourceFiles(resolve(repoRoot(), d, p, 'src')); } catch { return []; } }));

describe('F01/PLAT-05-AC5', () => {
  it('F01/PLAT-05-AC5 nothing is written only for Hunter: no product code outside comments names the club', () => {
    const hits = productSources().filter((f) => /hunter/i.test(stripComments(readFileSync(f, 'utf8'))));
    expect(hits).toEqual([]);
  });
});

describe('F01/PLAT-07-AC9', () => {
  it('F01/PLAT-07-AC9 there is no in app simulate payment action in code or in the database', async () => {
    const hits = productSources().filter((f) => /simulat/i.test(stripComments(readFileSync(f, 'utf8'))));
    expect(hits, 'product code that simulates a payment').toEqual([]);
    const fns = await tdb.query(`select n.nspname || '.' || p.proname as f from pg_proc p join pg_namespace n on n.oid = p.pronamespace where p.proname ilike '%simulat%' and n.nspname in ('public','app','platform')`);
    expect(fns.rows, 'database functions that simulate a payment').toEqual([]);
  });
});
