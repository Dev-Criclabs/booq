import { createMemoryAuthStore, createPlatformAuth, type IdentityProvider } from '../auth/sign-in';
import { createDbAuditSink, createDbStaffDirectory, IdentityUnavailable } from '../auth/adapters';
import { authRoutes } from '../auth/routes';
import { createRateLimiter, type RateLimiter } from '@booq/auth';
import type { PlatformDb } from '@booq/db';
import type { Clock } from '@booq/time';
import type { PlatformRoute, PlatformSource } from '../http/server';

// The platform console's composition root (F01-T17, T18; D148): wires the database role
// `booq_platform`, the clock and the staff auth into the route table. Settings are read from the
// environment on the first request, with no defaults. No Supabase key of any kind is read here:
// the password check is the identity adapter of apps/staff-invite (T17b). Until that exists the
// sign-in route answers 503 identity_unavailable.

export interface PlatformConfig {
  /** Signs the session cookie. At least 32 characters; separate from every club key. */
  signingKey: string;
  maxBodyBytes: number;
  /** Attempts per caller and window on the sign-in routes. Platform config; absent means no limit (set it before launch). */
  signInRateLimit: { limit: number; windowSeconds: number } | null;
}

const WHOLE = /^[1-9][0-9]*$/;

export function readPlatformConfig(env: Record<string, string | undefined>): PlatformConfig & { databaseUrl: string } {
  const required = ['DATABASE_URL', 'PLATFORM_SIGNING_KEY', 'PLATFORM_MAX_BODY_BYTES'] as const;
  const missing = required.filter((n) => !env[n]);
  if (missing.length) throw new Error(`platform settings missing: ${missing.join(', ')}`);
  if (env['PLATFORM_SIGNING_KEY']!.length < 32) throw new Error('PLATFORM_SIGNING_KEY must be at least 32 characters');
  if (!WHOLE.test(env['PLATFORM_MAX_BODY_BYTES']!)) throw new Error('PLATFORM_MAX_BODY_BYTES must be a whole number above zero');
  const limit = env['PLATFORM_SIGNIN_RATE_LIMIT'];
  const window = env['PLATFORM_SIGNIN_RATE_WINDOW_SECONDS'];
  if ((limit && !window) || (!limit && window)) throw new Error('PLATFORM_SIGNIN_RATE_LIMIT and PLATFORM_SIGNIN_RATE_WINDOW_SECONDS are set together or not at all');
  if (limit && (!WHOLE.test(limit) || !WHOLE.test(window!))) throw new Error('PLATFORM_SIGNIN_RATE_LIMIT and PLATFORM_SIGNIN_RATE_WINDOW_SECONDS must be whole numbers above zero');
  return {
    databaseUrl: env['DATABASE_URL']!,
    signingKey: env['PLATFORM_SIGNING_KEY']!,
    maxBodyBytes: Number(env['PLATFORM_MAX_BODY_BYTES']),
    signInRateLimit: limit ? { limit: Number(limit), windowSeconds: Number(window) } : null,
  };
}

export const unavailableIdentity: IdentityProvider = {
  async verifyPassword() {
    throw new IdentityUnavailable();
  },
  async verifyTotp() {
    throw new IdentityUnavailable();
  },
};

export interface PlatformParts {
  db: PlatformDb;
  clock: Clock;
  identity: IdentityProvider;
  config: PlatformConfig;
  /** Extra route groups, for tests and for the parts added next. */
  extraRoutes?: readonly PlatformRoute[];
}

export function createPlatformTable(parts: PlatformParts): PlatformSource {
  const { db, clock, identity, config } = parts;
  const auth = createPlatformAuth({
    identity,
    staff: createDbStaffDirectory(db),
    audit: createDbAuditSink(db),
    store: createMemoryAuthStore(), // sessions live in this process: a durable shared store comes with the hosting choice
    clock,
    signingKey: config.signingKey,
  });
  const limiter: RateLimiter | undefined = config.signInRateLimit ? createRateLimiter({ ...config.signInRateLimit, now: () => clock.now() }) : undefined;
  return {
    table: [...authRoutes({ auth }), ...(parts.extraRoutes ?? [])],
    deps: {
      authenticate: (cookie) => auth.authenticate(cookie),
      maxBodyBytes: config.maxBodyBytes,
      ...(limiter ? { rateLimit: { limiter, routes: ['POST /auth/sign-in', 'POST /auth/second-factor', 'POST /auth/step-up'] } } : {}),
    },
  };
}
