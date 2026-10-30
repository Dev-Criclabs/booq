import { createHash, randomBytes } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import pg from 'pg';
import { applyMigrations } from '../migrate';

// Test databases (decision D30: a real Postgres in tests, a controllable clock).
//  - createTestDatabase(): a fresh database cloned from a template that already has
//    every migration applied and the test clock installed.
//  - createScratchDatabase(): an empty database with nothing installed.
// The server is whatever BOOQ_TEST_DATABASE_URL points at (the Vitest global setup
// starts a throwaway one if it is not set).

const MIGRATIONS_DIR = join(__dirname, '..', '..', 'migrations');

// Test only. The production app.now() is plain now() (migration 0001); the harness
// replaces it after the migrations, so no production database can have an override.
const TEST_CLOCK_SQL = `
create schema if not exists app;
create table if not exists app.test_clock (
  id boolean primary key default true check (id),
  now_override timestamptz
);
insert into app.test_clock (id) values (true) on conflict do nothing;
create or replace function app.now() returns timestamptz
language sql stable as $$ select coalesce((select now_override from app.test_clock), now()) $$;
grant select on app.test_clock to booq_owner, booq_app, booq_worker, booq_platform, booq_audit, booq_anonymiser;
`;

export interface TestDatabase {
  name: string;
  url: string;
  pool: pg.Pool;
  query: pg.Pool['query'];
  setNow(at: Date | string): Promise<void>;
  advance(interval: string): Promise<void>;
  clearNow(): Promise<void>;
  /** Publishes a placeholder privacy and terms release v1 (D152), so sign-up has a current notice version. */
  seedNotice(): Promise<void>;
  /** Makes `id` a coach of `club` (F07, migration 0801): the person with the coach and player roles, the coach row and a weekly rule for every hour of every day. Safe to repeat. */
  seedCoach(club: string, id: string): Promise<void>;
  /** Makes a class session (F08, migrations 0901 and 0902) of `club` on `resource`: its own owner, coach and template are created, nothing is claimed in occupancy. Returns the session id; every class_seat booking names one (0903). */
  seedClassSession(club: string, resource: string, start?: string): Promise<string>;
  close(): Promise<void>;
}

function adminUrl(): string {
  const url = process.env.BOOQ_TEST_DATABASE_URL;
  if (!url) {
    throw new Error(process.env.BOOQ_TEST_DB_ERROR ?? 'No test database: set BOOQ_TEST_DATABASE_URL or run the tests through Vitest (its global setup starts one).');
  }
  return url;
}

function urlFor(name: string): string {
  const u = new URL(adminUrl());
  u.pathname = `/${name}`;
  return u.toString();
}

let admin: pg.Pool | undefined;
function adminPool(): pg.Pool {
  admin ??= new pg.Pool({ connectionString: adminUrl(), max: 4 });
  admin.on('error', () => undefined);
  return admin;
}

// Hosted Supabase ships the REST roles anon and authenticated; migration 0001 must lock
// them out. A plain test cluster has neither, so the harness creates them first.
const ROLES_LOCK = 7_244_003;
// Migration 0001 creates and alters cluster-wide roles, and advisory locks are per database, so
// the runner's own lock cannot stop two test databases migrating at the same moment. The harness
// serialises its migrations with a lock taken on the admin database.
const MIGRATE_LOCK = 7_244_004;
async function withClusterMigrationLock<T>(fn: () => Promise<T>): Promise<T> {
  const c = await adminPool().connect();
  try {
    await c.query('select pg_advisory_lock($1)', [MIGRATE_LOCK]);
    return await fn();
  } finally {
    await c.query('select pg_advisory_unlock($1)', [MIGRATE_LOCK]).catch(() => undefined);
    c.release();
  }
}
async function ensureSupabaseRoles(): Promise<void> {
  const c = await adminPool().connect();
  try {
    await c.query('select pg_advisory_lock($1)', [ROLES_LOCK]);
    for (const r of ['anon', 'authenticated']) {
      await c.query(`do $$ begin if not exists (select 1 from pg_roles where rolname = '${r}') then create role ${r} nologin; end if; end $$`);
    }
  } finally {
    await c.query('select pg_advisory_unlock($1)', [ROLES_LOCK]).catch(() => undefined);
    c.release();
  }
}

async function createDatabase(name: string, template?: string): Promise<void> {
  const t = template ? ` template "${template}"` : '';
  await adminPool().query(`create database "${name}"${t}`);
}

function wrap(name: string): TestDatabase {
  const pool = new pg.Pool({ connectionString: urlFor(name), max: 10 });
  // Dropping the database with FORCE can kill a connection that is still closing; that is
  // expected at teardown and must not surface as an unhandled error.
  pool.on('error', () => undefined);
  return {
    name,
    url: urlFor(name),
    pool,
    query: pool.query.bind(pool) as pg.Pool['query'],
    async setNow(at) {
      await pool.query('update app.test_clock set now_override = $1', [new Date(at).toISOString()]);
    },
    async advance(interval) {
      await pool.query('update app.test_clock set now_override = coalesce(now_override, clock_timestamp()) + $1::interval', [interval]);
    },
    async clearNow() {
      await pool.query('update app.test_clock set now_override = null');
    },
    async seedCoach(club, id) {
      const c = await pool.connect();
      try {
        await c.query('begin');
        await c.query('insert into public.app_user (club_id, id, line_user_id) values ($1, $2, $3) on conflict do nothing', [club, id, 'coach:' + id]);
        await c.query(`insert into public.app_user_role (club_id, user_id, role) values ($1, $2, 'coach'), ($1, $2, 'player') on conflict do nothing`, [club, id]);
        await c.query('insert into public.coach (club_id, id) values ($1, $2) on conflict do nothing', [club, id]);
        // Works every hour of every day, so a test that books a coach is not about the coach's calendar (F07 rules, 0803).
        await c.query(`insert into public.coach_availability_rule (club_id, coach_id, kind, weekday, start_time, end_time)
                       select $1, $2, 'weekly', d, '00:00', '24:00' from generate_series(0, 6) d
                        where not exists (select 1 from public.coach_availability_rule where club_id = $1 and coach_id = $2)`, [club, id]);
        await c.query('commit');
      } catch (e) {
        await c.query('rollback');
        throw e;
      } finally {
        c.release();
      }
    },
    async seedClassSession(club, resource, start = '2027-03-03T18:00:00+07:00') {
      const c = await pool.connect();
      try {
        await c.query('begin');
        const owner = (await c.query(`insert into public.app_user (club_id, line_user_id) values ($1, 'cs:' || gen_random_uuid()::text) returning id`, [club])).rows[0].id as string;
        await c.query(`insert into public.app_user_role (club_id, user_id, role) values ($1, $2, 'owner'), ($1, $2, 'player')`, [club, owner]);
        const coach = (await c.query(`insert into public.app_user (club_id, line_user_id) values ($1, 'cc:' || gen_random_uuid()::text) returning id`, [club])).rows[0].id as string;
        await c.query(`insert into public.app_user_role (club_id, user_id, role) values ($1, $2, 'coach'), ($1, $2, 'player')`, [club, coach]);
        await c.query(`insert into public.coach (club_id, id) values ($1, $2)`, [club, coach]);
        const tpl = (await c.query(`insert into public.class_template (club_id, name_th, name_en, audience, coach_id, resource_id, weekday, start_time, min_players, max_players, created_by)
                                    values ($1,'ก','Test class','adult',$2,$3,0,'18:00',1,6,$4) returning id`, [club, coach, resource, owner])).rows[0].id as string;
        const session = (await c.query(`insert into public.class_session (club_id, template_id, start_at, end_at, name_th, name_en, audience, coach_id, resource_id, min_players, max_players)
                                        values ($1,$2,$3::timestamptz,$3::timestamptz + interval '1 hour','ก','Test class','adult',$4,$5,1,6) returning id`, [club, tpl, start, coach, resource])).rows[0].id as string;
        await c.query('commit');
        return session;
      } catch (e) {
        await c.query('rollback');
        throw e;
      } finally {
        c.release();
      }
    },
    async seedNotice() {
      if ((await pool.query('select 1 from platform.legal_release')).rowCount) return;
      const st = (await pool.query(`insert into platform.platform_staff (auth_user_id, email, display_name, role) values (gen_random_uuid(), 'notice-' || gen_random_uuid()::text || '@booq.example', 'Notice', 'platform_admin') returning id`)).rows[0].id;
      await pool.query('insert into platform.legal_release (seq, published_by) values (1, $1)', [st]);
      for (const kind of ['privacy', 'terms']) for (const lang of ['th', 'en']) {
        await pool.query(`insert into platform.legal_text (seq, kind, language, title, body) values (1, $1, $2, 't', 'b')`, [kind, lang]);
      }
    },
    async close() {
      await pool.end();
      await adminPool().query(`drop database if exists "${name}" with (force)`);
    },
  };
}

function migrationsFingerprint(): string {
  const h = createHash('sha256').update(TEST_CLOCK_SQL);
  for (const f of readdirSync(MIGRATIONS_DIR).filter((x) => x.endsWith('.sql')).sort()) {
    h.update(f).update(readFileSync(join(MIGRATIONS_DIR, f)));
  }
  return h.digest('hex').slice(0, 12);
}

const TEMPLATE_LOCK = 7_244_002;
let templateName: Promise<string> | undefined;

// One template per migration set; safe when several Vitest workers ask at once.
function ensureTemplate(): Promise<string> {
  templateName ??= (async () => {
    const name = `booq_tpl_${migrationsFingerprint()}`;
    await ensureSupabaseRoles();
    const lock = await adminPool().connect();
    try {
      await lock.query('select pg_advisory_lock($1)', [TEMPLATE_LOCK]);
      const exists = await lock.query('select 1 from pg_database where datname = $1', [name]);
      if (exists.rowCount === 0) {
        const building = `${name}_building`;
        await lock.query(`drop database if exists "${building}" with (force)`);
        await lock.query(`create database "${building}"`);
        const p = new pg.Pool({ connectionString: urlFor(building), max: 2 });
        try {
          await withClusterMigrationLock(() => applyMigrations(p, MIGRATIONS_DIR));
          await p.query(TEST_CLOCK_SQL);
        } finally {
          await p.end();
        }
        await lock.query(`alter database "${building}" rename to "${name}"`);
      }
    } finally {
      await lock.query('select pg_advisory_unlock($1)', [TEMPLATE_LOCK]).catch(() => undefined);
      lock.release();
    }
    return name;
  })();
  return templateName;
}

function newName(): string {
  return `booq_t_${randomBytes(6).toString('hex')}`;
}

export async function createTestDatabase(): Promise<TestDatabase> {
  const tpl = await ensureTemplate();
  const name = newName();
  await createDatabase(name, tpl);
  return wrap(name);
}

export async function createScratchDatabase(): Promise<TestDatabase> {
  const name = newName();
  await createDatabase(name);
  return wrap(name);
}

/** Built from the migrations only, with no test clock: what production looks like. */
export async function createProductionDatabase(): Promise<TestDatabase> {
  await ensureSupabaseRoles();
  const db = await createScratchDatabase();
  await withClusterMigrationLock(() => applyMigrations(db.pool, MIGRATIONS_DIR));
  return db;
}
