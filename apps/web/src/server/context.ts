import { createClaimService } from '@booq/domain';
import { createDbRateLimiter } from '@booq/auth';
import { createDbDirectory, createProfileService, createPublicConfigService, createSignInService, type LineVerifier, type RouteSession, type ServeDeps } from '@booq/auth';
import type { Db } from '@booq/db';
import type { Route } from '@booq/auth';
import { authRoutes } from '../api/auth/routes';
import { mounts, type Mount } from './mounts';

// The web app's composition root (F02, F01): the one place that wires the database, the LINE
// verifier and the clock into the services and the route table. Settings are read from the
// environment when the first request arrives (not at build), with no defaults.
// Not wired yet: the export routes, until DevOps picks the storage provider and the queue
// credential for adding the export job (see docs/ops/worker.md).

export interface WebConfig {
  /** The folder with the language files (en.json, th.json, pending/), for the receipt PDF. Absent: the PDF routes answer 503 not_configured. */
  localesDir?: string | null;
  sessionSeconds: number;
  maxBodyBytes: number;
  /** Import limits are platform config; until both are set the import answers 503 import_not_configured. */
  importLimits: { maxRows: number; stagingHours: number } | null;
  /** Attempts allowed per caller and club in a window, on sign-in and profile, counted in the database (migration 0027). `hmacKey` keys the hash of the caller's address. Platform config; absent means no limit (set it before launch). */
  signInRateLimit?: { limit: number; windowSeconds: number; hmacKey: string } | null;
}

const WHOLE = /^[1-9][0-9]*$/;

export function readWebConfig(env: Record<string, string | undefined>): WebConfig & { databaseUrl: string } {
  const required = ['DATABASE_URL', 'WEB_SESSION_SECONDS', 'WEB_MAX_BODY_BYTES'] as const;
  const missing = required.filter((n) => !env[n]);
  if (missing.length) throw new Error(`web settings missing: ${missing.join(', ')}`);  // i18n-ignore start up setting error, read by the operator in the log, never shown to a user
  for (const n of ['WEB_SESSION_SECONDS', 'WEB_MAX_BODY_BYTES'] as const) {
    if (!WHOLE.test(env[n]!)) throw new Error(`${n} must be a whole number above zero`);  // i18n-ignore start up setting error, read by the operator in the log, never shown to a user
  }
  const rows = env['IMPORT_MAX_ROWS'];
  const hours = env['IMPORT_STAGING_HOURS'];
  if ((rows && !hours) || (!rows && hours)) throw new Error('IMPORT_MAX_ROWS and IMPORT_STAGING_HOURS are set together or not at all');  // i18n-ignore start up setting error, read by the operator in the log, never shown to a user
  if (rows && (!WHOLE.test(rows) || !WHOLE.test(hours!))) throw new Error('IMPORT_MAX_ROWS and IMPORT_STAGING_HOURS must be whole numbers above zero');  // i18n-ignore start up setting error, read by the operator in the log, never shown to a user
  const rl = env['WEB_SIGNIN_RATE_LIMIT'];
  const rw = env['WEB_SIGNIN_RATE_WINDOW_SECONDS'];
  if ((rl && !rw) || (!rl && rw)) throw new Error('WEB_SIGNIN_RATE_LIMIT and WEB_SIGNIN_RATE_WINDOW_SECONDS are set together or not at all');  // i18n-ignore start up setting error, read by the operator in the log, never shown to a user
  if (rl && (!WHOLE.test(rl) || !WHOLE.test(rw!))) throw new Error('WEB_SIGNIN_RATE_LIMIT and WEB_SIGNIN_RATE_WINDOW_SECONDS must be whole numbers above zero');  // i18n-ignore start up setting error, read by the operator in the log, never shown to a user
  // The caller's address is hashed with this key before it is counted; no default, and never printed.
  const rk = env['WEB_RATE_LIMIT_KEY'];
  if (rl && !rk) throw new Error('WEB_RATE_LIMIT_KEY is required when the sign-in rate limit is set');  // i18n-ignore start up setting error, read by the operator in the log, never shown to a user
  if (rk && rk.length < 32) throw new Error('WEB_RATE_LIMIT_KEY must be at least 32 characters');  // i18n-ignore start up setting error, read by the operator in the log, never shown to a user
  return {
    signInRateLimit: rl ? { limit: Number(rl), windowSeconds: Number(rw), hmacKey: rk! } : null,
    databaseUrl: env['DATABASE_URL']!,
    sessionSeconds: Number(env['WEB_SESSION_SECONDS']),
    maxBodyBytes: Number(env['WEB_MAX_BODY_BYTES']),
    importLimits: rows ? { maxRows: Number(rows), stagingHours: Number(hours) } : null,
    localesDir: env['LOCALES_DIR'] ?? null,
  };
}

export interface WebParts {
  db: Db;
  verifier: LineVerifier;
  now(): Date;
  config: WebConfig;
  /** Extra mounts, for tests. The real ones are in mounts.ts. */
  extraMounts?: readonly Mount[];
}

export function createWebTable(parts: WebParts): { table: Route<unknown>[]; deps: ServeDeps } {
  const { db, verifier, now, config } = parts;
  const directory = createDbDirectory(db);
  const signIn = createSignInService({ db, verifier, directory, now, sessionSeconds: config.sessionSeconds });
  const clubBySlug = async (slug: string) => {
    const club = await directory.clubBySlug(slug);
    return club ? { clubId: club.clubId } : null;
  };
  const claims = createClaimService();
  const profile = createProfileService({ db, directory, signIn, requestClaim: (tx, input) => claims.requestFromProfile(tx, input) });
  const publicConfig = createPublicConfigService({ db, directory });

  const table: Route<unknown>[] = [
    ...authRoutes({ signIn, profile, publicConfig }),
    ...[...mounts, ...(parts.extraMounts ?? [])].flatMap((mount) => mount({ db, now, config, clubBySlug })),
  ];

  return {
    table,
    deps: {
      routeDeps: { hasFeature: async () => true }, // club feature switches arrive with F01's feature reader
      maxBodyBytes: config.maxBodyBytes,
      ...(config.signInRateLimit
        ? {
            rateLimit: {
              limiter: createDbRateLimiter({
                db,
                clubIdBySlug: async (slug) => (await clubBySlug(slug))?.clubId ?? null,
                hmacKey: config.signInRateLimit.hmacKey,
                limit: config.signInRateLimit.limit,
                windowSeconds: config.signInRateLimit.windowSeconds,
                now,
              }),
              routes: ['POST /auth/session', 'POST /auth/profile'],
            },
          }
        : {}),
      async resolveSession(slug, cookie): Promise<RouteSession | null | 'not_found'> {
        const r = await signIn.authenticate({ slug, cookieHeader: cookie });
        if (r.ok) return r.state === 'active' ? { clubId: r.clubId, userId: r.userId, roles: r.roles as RouteSession['roles'] } : null;
        return r.status === 404 ? 'not_found' : null;
      },
    },
  };
}
