import pg from 'pg';

// withPlatformTx (FA 4.4, F01-T18): the only way apps/platform reaches the database. Every call
// runs in a transaction as booq_platform with the staff member as a transaction-local setting,
// so the row policies in migration 0008 can decide per staff member and a pooled connection
// never carries one request's identity into the next. With no staff the policies see nothing.
//
// The pool is never exported. The role has no privilege on club data (D tables) at all.

export interface PlatformContext {
  /** The signed-in BOOQ staff member, or null where none is known yet (sign in). */
  staffId: string | null;
  requestId?: string;
  /** Reason for the audited change, when the screen asked for one. */
  reason?: string;
  supportSessionId?: string;
  /** The club being visited, so a note in the club's own audit log can name it (audit.note reads app.club_id). */
  clubId?: string;
  /** Shown in the club's audit log as the actor, for example the staff member's name. */
  actorLabel?: string;
}

export interface PlatformTx {
  query<R extends pg.QueryResultRow = pg.QueryResultRow>(text: string, params?: unknown[]): Promise<pg.QueryResult<R>>;
}

export interface PlatformDbOptions {
  connectionString: string;
  max?: number;
  maxRetries?: number;
}

export interface PlatformDb {
  /** The handler may run more than once (deadlock retry), so it must be safe to repeat. */
  withPlatformTx<T>(ctx: PlatformContext, fn: (tx: PlatformTx) => Promise<T>): Promise<T>;
  end(): Promise<void>;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const RETRYABLE = new Set(['40P01', '40001']);

export function createPlatformDb(options: PlatformDbOptions): PlatformDb {
  const maxRetries = options.maxRetries ?? 3;
  const pool = new pg.Pool({ connectionString: options.connectionString, max: options.max ?? 5 });
  pool.on('error', () => undefined);

  return {
    async withPlatformTx<T>(ctx: PlatformContext, fn: (tx: PlatformTx) => Promise<T>): Promise<T> {
      if (ctx.staffId !== null && !UUID.test(ctx.staffId)) throw new Error('withPlatformTx: staff id must be a uuid or null');
      if (ctx.supportSessionId !== undefined && !UUID.test(ctx.supportSessionId)) throw new Error('withPlatformTx: support session id must be a uuid');
      if (ctx.clubId !== undefined && !UUID.test(ctx.clubId)) throw new Error('withPlatformTx: club id must be a uuid');
      for (let attempt = 0; ; attempt += 1) {
        const client = await pool.connect();
        let ended = false;
        const tx: PlatformTx = {
          async query(text, params) {
            if (ended) throw new Error('withPlatformTx: this transaction has ended');
            return client.query(text, params as unknown[]);
          },
        };
        try {
          await client.query('begin');
          await client.query('set local role booq_platform');
          // actor_platform_staff_id makes the audit writer record a BOOQ staff actor (audit.write).
          await client.query(
            `select set_config('app.platform_staff_id', $1, true), set_config('app.actor_platform_staff_id', $1, true),
                    set_config('app.support_session_id', $2, true), set_config('app.reason', $3, true), set_config('app.request_id', $4, true),
                    set_config('app.club_id', $5, true), set_config('app.actor_label', $6, true)`,
            [ctx.staffId ?? '', ctx.supportSessionId ?? '', ctx.reason ?? '', ctx.requestId ?? '', ctx.clubId ?? '', ctx.actorLabel ?? ''],
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
