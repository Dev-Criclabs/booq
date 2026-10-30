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

export interface ClubContext {
  clubId: string;
  userId: string | null;
  roles: readonly ClubRole[] | readonly string[];
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
}

export function createDb(options: DbOptions): Db {
  const role = options.role ?? 'booq_app';
  if (!IDENT.test(role)) throw new Error('createDb: role must be a plain identifier');
  const maxRetries = options.maxRetries ?? 3;
  const pool = new pg.Pool({ connectionString: options.connectionString, max: options.max ?? 10 });
  pool.on('error', () => undefined); // an idle connection dropped by the server; the next checkout reconnects

  return {
    async withClubTx<T>(ctx: ClubContext, fn: (tx: Tx) => Promise<T>): Promise<T> {
      validate(ctx);
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
          await client.query(`set local role ${role}`);
          await client.query(
            "select set_config('app.club_id', $1, true), set_config('app.user_id', $2, true), set_config('app.roles', $3, true), set_config('app.request_id', $4, true)",
            [ctx.clubId, ctx.userId ?? '', ctx.roles.join(','), ctx.requestId ?? ''],
          );
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
    },
    async end() {
      await pool.end();
    },
  };
}
