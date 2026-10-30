import pg from 'pg';

// withClubTx (FA 4.2, F01-T04): the only way application code reaches club data.
// Every query runs in a transaction that (1) switches to the restricted database role and
// (2) sets the request context as transaction-local settings, so a pooled connection never
// carries one request's club into the next. With no context the RLS helpers return null and
// every club_id = app.club_id() comparison is false (fail closed).
//
// The raw pool is never exported: callers get Db.withClubTx and a Tx with query() only.

const CLUB_ROLES = ['player', 'coach', 'front_desk', 'accountant', 'owner', 'guest'] as const;
export type ClubRole = (typeof CLUB_ROLES)[number];

/** Where a change came from (audit_entry.source). A platform change is always 'platform'. */
export const AUDIT_SOURCES = ['player_app', 'admin', 'coach_portal', 'job', 'webhook'] as const;
export type AuditSource = (typeof AUDIT_SOURCES)[number];

export interface ClubContext {
  clubId: string;
  userId: string | null;
  roles: readonly ClubRole[] | readonly string[];
  requestId?: string;
  /** Required by the database for any change by a club user (the audit entry needs it); reads need none. */
  source?: AuditSource;
  /** The name shown in the audit log, kept as written at the time (a job passes its name). */
  actorLabel?: string;
  /** The business reason the screen asked for (price change, wallet adjust, closure ...). */
  reason?: string;
}

/** A BOOQ staff member acting on one club (support view, setup). Runs as booq_platform. */
export interface PlatformContext {
  staffId: string;
  staffLabel: string;
  clubId: string;
  supportSessionId?: string;
  reason?: string;
  requestId?: string;
}

export interface Tx {
  query<R extends pg.QueryResultRow = pg.QueryResultRow>(text: string, params?: unknown[]): Promise<pg.QueryResult<R>>;
}

export interface DbOptions {
  connectionString: string;
  /** Pool size. */
  max?: number;
  /** The database role every transaction switches to. Must be an unquoted identifier. */
  role?: string;
  /** Extra attempts after a deadlock or serialization failure. */
  maxRetries?: number;
}

export interface Db {
  /** Handlers may run more than once (deadlock retry), so they must be safe to repeat. */
  withClubTx<T>(ctx: ClubContext, fn: (tx: Tx) => Promise<T>): Promise<T>;

  end(): Promise<void>;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const IDENT = /^[a-z_][a-z0-9_]*$/;
const RETRYABLE = new Set(['40P01', '40001']); // deadlock detected, serialization failure

function validate(ctx: ClubContext): void {
  if (!UUID.test(ctx.clubId)) throw new Error('withClubTx: club id must be a uuid');
  if (ctx.userId !== null && !UUID.test(ctx.userId)) throw new Error('withClubTx: user id must be a uuid or null');
  for (const r of ctx.roles) {
    if (!(CLUB_ROLES as readonly string[]).includes(r)) throw new Error(`withClubTx: unknown role "${r}"`);
  }
  if (ctx.source !== undefined && !(AUDIT_SOURCES as readonly string[]).includes(ctx.source)) {
    throw new Error(`withClubTx: unknown audit source "${String(ctx.source)}"`);
  }
}

function validatePlatform(ctx: PlatformContext): void {
  if (!UUID.test(ctx.clubId)) throw new Error('withPlatformTx: club id must be a uuid');
  if (!UUID.test(ctx.staffId)) throw new Error('withPlatformTx: staff id must be a uuid');
  if (ctx.supportSessionId !== undefined && !UUID.test(ctx.supportSessionId)) throw new Error('withPlatformTx: support session id must be a uuid');
  if (ctx.staffLabel.trim() === '') throw new Error('withPlatformTx: staff label is required');
}

/** The platform console's way in (kept apart from Db so club code cannot reach it by type). */
export interface PlatformDb {
  /** Runs as booq_platform with the staff member as the audit actor. */
  withPlatformTx<T>(ctx: PlatformContext, fn: (tx: Tx) => Promise<T>): Promise<T>;
  end(): Promise<void>;
}

export function createDb(options: DbOptions): Db & PlatformDb {
  const role = options.role ?? 'booq_app';
  if (!IDENT.test(role)) throw new Error('createDb: role must be a plain identifier');
  const maxRetries = options.maxRetries ?? 3;
  const pool = new pg.Pool({ connectionString: options.connectionString, max: options.max ?? 10 });
  pool.on('error', () => undefined); // an idle connection dropped by the server; the next checkout reconnects

  /** One transaction as `asRole` with the given transaction-local settings. */
  async function run<T>(asRole: string, settings: Record<string, string>, fn: (tx: Tx) => Promise<T>): Promise<T> {
    const names = Object.keys(settings);
    const sql = `select ${names.map((_, i) => `set_config('${names[i]}', $${i + 1}, true)`).join(', ')}`;
    for (let attempt = 0; ; attempt += 1) {
      const client = await pool.connect();
      let ended = false;
      const tx: Tx = {
        async query(text, params) {
          if (ended) throw new Error('withClubTx: this transaction has ended');
          return client.query(text, params as unknown[]);
        },
      };
      try {
        await client.query('begin');
        await client.query(`set local role ${asRole}`);
        await client.query(sql, names.map((n) => settings[n]!));
        const result = await fn(tx);
        await client.query('commit');
        ended = true;
        client.release();
        return result;
      } catch (e) {
        ended = true;
        await client.query('rollback').catch(() => undefined);
        client.release();
        const code = (e as { code?: string }).code;
        if (code && RETRYABLE.has(code) && attempt < maxRetries) {
          await new Promise((r) => setTimeout(r, 10 * (attempt + 1)));
          continue;
        }
        throw e;
      }
    }
  }

  return {
    async withClubTx(ctx, fn) {
      validate(ctx);
      return await run(
        role,
        {
          'app.club_id': ctx.clubId,
          'app.user_id': ctx.userId ?? '',
          'app.roles': ctx.roles.join(','),
          'app.request_id': ctx.requestId ?? '',
          'app.source': ctx.source ?? '',
          'app.actor_label': ctx.actorLabel ?? '',
          'app.reason': ctx.reason ?? '',
        },
        fn,
      );
    },
    async withPlatformTx(ctx, fn) {
      validatePlatform(ctx);
      return await run(
        'booq_platform',
        {
          'app.club_id': ctx.clubId,
          'app.user_id': '',
          'app.roles': '',
          'app.request_id': ctx.requestId ?? '',
          'app.actor_platform_staff_id': ctx.staffId,
          'app.actor_label': ctx.staffLabel,
          'app.support_session_id': ctx.supportSessionId ?? '',
          'app.reason': ctx.reason ?? '',
        },
        fn,
      );
    },
    async end() {
      await pool.end();
    },
  };
}
