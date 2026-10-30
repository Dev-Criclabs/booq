import { createClaimService } from '@booq/domain';
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
  sessionSeconds: number;
  maxBodyBytes: number;
  /** Import limits are platform config; until both are set the import answers 503 import_not_configured. */
  importLimits: { maxRows: number; stagingHours: number } | null;
}

const WHOLE = /^[1-9][0-9]*$/;

export function readWebConfig(env: Record<string, string | undefined>): WebConfig & { databaseUrl: string } {
  const required = ['DATABASE_URL', 'WEB_SESSION_SECONDS', 'WEB_MAX_BODY_BYTES'] as const;
  const missing = required.filter((n) => !env[n]);
  if (missing.length) throw new Error(`web settings missing: ${missing.join(', ')}`);
  for (const n of ['WEB_SESSION_SECONDS', 'WEB_MAX_BODY_BYTES'] as const) {
    if (!WHOLE.test(env[n]!)) throw new Error(`${n} must be a whole number above zero`);
  }
  const rows = env['IMPORT_MAX_ROWS'];
  const hours = env['IMPORT_STAGING_HOURS'];
  if ((rows && !hours) || (!rows && hours)) throw new Error('IMPORT_MAX_ROWS and IMPORT_STAGING_HOURS are set together or not at all');
  if (rows && (!WHOLE.test(rows) || !WHOLE.test(hours!))) throw new Error('IMPORT_MAX_ROWS and IMPORT_STAGING_HOURS must be whole numbers above zero');
  return {
    databaseUrl: env['DATABASE_URL']!,
    sessionSeconds: Number(env['WEB_SESSION_SECONDS']),
    maxBodyBytes: Number(env['WEB_MAX_BODY_BYTES']),
    importLimits: rows ? { maxRows: Number(rows), stagingHours: Number(hours) } : null,
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
  const claims = createClaimService();
  const profile = createProfileService({ db, directory, signIn, requestClaim: (tx, input) => claims.requestFromProfile(tx, input) });
  const publicConfig = createPublicConfigService({ db, directory });

  const table: Route<unknown>[] = [
    ...authRoutes({ signIn, profile, publicConfig }),
    ...[...mounts, ...(parts.extraMounts ?? [])].flatMap((mount) => mount({ db, now, config })),
  ];

  return {
    table,
    deps: {
      routeDeps: { hasFeature: async () => true }, // club feature switches arrive with F01's feature reader
      maxBodyBytes: config.maxBodyBytes,
      async resolveSession(slug, cookie): Promise<RouteSession | null | 'not_found'> {
        const r = await signIn.authenticate({ slug, cookieHeader: cookie });
        if (r.ok) return r.state === 'active' ? { clubId: r.clubId, userId: r.userId, roles: r.roles as RouteSession['roles'] } : null;
        return r.status === 404 ? 'not_found' : null;
      },
    },
  };
}
