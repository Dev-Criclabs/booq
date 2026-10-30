import { createHmac } from 'node:crypto';
import type { Db } from '../../db/src/tx';
import type { RateLimiter, RateScope } from './rate-limit';

// The shared sign-in rate limit (migration 0027; DevOps docs/ops/web.md). The web servers are many short-lived
// processes, so the counter lives in the database: app.hit_rate_limit counts a hit atomically for the club in the
// context. The caller's address is personal data: it is turned into an HMAC (with a key from configuration, no
// default) before it leaves this process, and the database refuses anything that is not a 64 character hex hash.
// The key covers the route and the address, so sign-in and profile attempts are counted apart.

const GUEST = (clubId: string) => ({ clubId, userId: null, roles: ['guest'], source: 'player_app' }) as const;

export interface DbRateLimiterOptions {
  db: Db;
  /** The club behind a club address, or null when there is none (the route then answers 404 itself). */
  clubIdBySlug(slug: string): Promise<string | null>;
  /** The HMAC key. A setting; at least 32 characters. */
  hmacKey: string;
  limit: number;
  windowSeconds: number;
  now(): Date;
}

export function createDbRateLimiter(options: DbRateLimiterOptions): RateLimiter {
  const { db, limit, windowSeconds } = options;
  if (options.hmacKey.length < 32) throw new Error('rate limit: the HMAC key must be at least 32 characters');
  if (!Number.isInteger(limit) || limit < 1) throw new Error('rate limit: limit must be a whole number above zero');
  if (!Number.isInteger(windowSeconds) || windowSeconds < 1) throw new Error('rate limit: windowSeconds must be a whole number above zero');
  return {
    async hit(key: string, scope?: RateScope) {
      if (!scope) throw new Error('rate limit: the shared limiter needs the club address and the caller');
      const clubId = await options.clubIdBySlug(scope.slug);
      if (!clubId) return { allowed: true }; // no such club: the route answers 404 and nothing is counted
      const keyHash = createHmac('sha256', options.hmacKey).update(`${scope.route}|${scope.caller}`).digest('hex');
      const allowed = await db.withClubTx(GUEST(clubId), async (tx) =>
        (await tx.query<{ ok: boolean }>('select app.hit_rate_limit($1, $2, $3) as ok', [keyHash, limit, windowSeconds])).rows[0]?.ok === true,
      );
      if (allowed) return { allowed: true };
      // Windows are fixed and aligned to the epoch, as in the function.
      const nowSeconds = options.now().getTime() / 1000;
      return { allowed: false, retryAfterSeconds: Math.max(1, Math.ceil(windowSeconds - (nowSeconds % windowSeconds))) };
    },
    size: () => 0,
  };
}
