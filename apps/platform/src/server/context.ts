import { createPlatformAuth, type IdentityProvider } from '../auth/sign-in';
import { createDbAuditSink, createDbAuthStore, createDbStaffDirectory, IdentityUnavailable } from '../auth/adapters';
import { authRoutes } from '../auth/routes';
import { createRateLimiter, type RateLimiter } from '@booq/auth';
import type { PlatformDb } from '@booq/db';
import type { Clock } from '@booq/time';
import { bangkokDate } from '@booq/time';
import { createClubService } from '../clubs/clubs';
import { clubRoutes } from '../clubs/routes';
import { createPauseService, type OwnerNotifier } from '../pause/pause';
import { createStatusService } from '../status/status';
import { createUsageService } from '../usage/usage';
import { createHealthService } from '../health/health';
import { healthRoutes } from '../health/routes';
import { createOwnerService, type InviteMailer } from '../owner/owner';
import { ownerRoutes } from '../owner/routes';
import { createTesterService } from '../testers/testers';
import { testerRoutes } from '../testers/routes';
import { adminRoutes } from '../admin/routes';
import { createAdminService } from '../admin/admin';
import { staffRoutes } from '../staff/routes';
import { createStaffInviteClient } from '../staff/staff-invite-client';
import { supportRoutes } from '../support/routes';
import { createSupportService } from '../support/support';
import type { Connections } from '../connections/connections';
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
  /** The club app's public address (https), for owner and tester invite links. */
  appBaseUrl: string;
  /** The shared token of GET /health for the external monitor. Absent: the route is not mounted. */
  healthToken: string | null;
  /** apps/staff-invite, which checks passwords and codes at the identity provider (D148). Absent: sign-in answers 503 identity_unavailable. */
  staffInvite: { url: string; signingSecret: string } | null;
  /** Attempts per caller and window on the sign-in routes. Platform config; absent means no limit (set it before launch). */
  signInRateLimit: { limit: number; windowSeconds: number } | null;
}

const WHOLE = /^[1-9][0-9]*$/;

export function readPlatformConfig(env: Record<string, string | undefined>): PlatformConfig & { databaseUrl: string } {
  const required = ['DATABASE_URL', 'PLATFORM_SIGNING_KEY', 'PLATFORM_MAX_BODY_BYTES', 'APP_BASE_URL'] as const;
  const missing = required.filter((n) => !env[n]);
  if (missing.length) throw new Error(`platform settings missing: ${missing.join(', ')}`);
  if (env['PLATFORM_SIGNING_KEY']!.length < 32) throw new Error('PLATFORM_SIGNING_KEY must be at least 32 characters');
  if (!WHOLE.test(env['PLATFORM_MAX_BODY_BYTES']!)) throw new Error('PLATFORM_MAX_BODY_BYTES must be a whole number above zero');
  if (!/^https:\/\/[^\s/]+(\/.*)?$/.test(env['APP_BASE_URL']!)) throw new Error('APP_BASE_URL must be an https address');
  const health = env['HEALTH_TOKEN'];
  if (health !== undefined && health.length < 16) throw new Error('HEALTH_TOKEN must be at least 16 characters');
  const inviteUrl = env['STAFF_INVITE_URL'];
  const inviteSecret = env['STAFF_INVITE_SIGNING_SECRET'];
  if ((inviteUrl && !inviteSecret) || (!inviteUrl && inviteSecret)) throw new Error('STAFF_INVITE_URL and STAFF_INVITE_SIGNING_SECRET are set together or not at all');
  if (inviteUrl && !/^https?:\/\/[^\s/]+(\/.*)?$/.test(inviteUrl)) throw new Error('STAFF_INVITE_URL must be an http or https address');
  if (inviteSecret && inviteSecret.length < 32) throw new Error('STAFF_INVITE_SIGNING_SECRET must be at least 32 characters');
  const limit = env['PLATFORM_SIGNIN_RATE_LIMIT'];
  const window = env['PLATFORM_SIGNIN_RATE_WINDOW_SECONDS'];
  if ((limit && !window) || (!limit && window)) throw new Error('PLATFORM_SIGNIN_RATE_LIMIT and PLATFORM_SIGNIN_RATE_WINDOW_SECONDS are set together or not at all');
  if (limit && (!WHOLE.test(limit) || !WHOLE.test(window!))) throw new Error('PLATFORM_SIGNIN_RATE_LIMIT and PLATFORM_SIGNIN_RATE_WINDOW_SECONDS must be whole numbers above zero');
  return {
    databaseUrl: env['DATABASE_URL']!,
    signingKey: env['PLATFORM_SIGNING_KEY']!,
    maxBodyBytes: Number(env['PLATFORM_MAX_BODY_BYTES']),
    appBaseUrl: env['APP_BASE_URL']!.replace(/\/+$/, ''),
    healthToken: health ?? null,
    staffInvite: inviteUrl ? { url: inviteUrl, signingSecret: inviteSecret! } : null,
    signInRateLimit: limit ? { limit: Number(limit), windowSeconds: Number(window) } : null,
  };
}

export const unavailableIdentity: IdentityProvider = {
  async verifyPassword() {
    throw new IdentityUnavailable();
  },
  async verifyPasswordFor() {
    throw new IdentityUnavailable();
  },
  async verifyTotp() {
    throw new IdentityUnavailable();
  },
};

/** The owner's LINE message goes through F10's outbox, which does not exist yet: the notice fails, is counted in P6, and the change stands. */
export const outboxNotConnected: OwnerNotifier = {
  async notifyOwner() {
    throw new Error('owner notice outbox is not connected (F10)');
  },
};

/** The owner invite email goes through a mail provider that is not chosen yet: the invite is made, the send fails, the route answers 502 mail_failed. */
export const mailerNotConnected: InviteMailer = {
  async sendOwnerInvite() {
    throw new Error('invite mailer is not connected');
  },
};

export interface PlatformParts {
  db: PlatformDb;
  clock: Clock;
  identity: IdentityProvider;
  config: PlatformConfig;
  notifier?: OwnerNotifier;
  mailer?: InviteMailer;
  /** LINE and Beam probes and the secrets public key. Absent until the provider clients exist: the connection sections answer section_unavailable. */
  connections?: Connections;
  /** For tests: the transport to apps/staff-invite. */
  staffInviteFetch?: typeof fetch;
  /** Extra route groups, for tests and for the parts added next. */
  extraRoutes?: readonly PlatformRoute[];
}

export function createPlatformTable(parts: PlatformParts): PlatformSource {
  const { db, clock, identity, config } = parts;
  const auth = createPlatformAuth({
    identity,
    staff: createDbStaffDirectory(db),
    audit: createDbAuditSink(db),
    store: createDbAuthStore(db, { sealKey: config.signingKey }), // shared by every console process (migration 0051)
    clock,
    signingKey: config.signingKey,
  });
  const limiter: RateLimiter | undefined = config.signInRateLimit ? createRateLimiter({ ...config.signInRateLimit, now: () => clock.now() }) : undefined;
  return {
    table: [
      ...authRoutes({ auth }),
      ...clubRoutes({
        clubs: createClubService({ db }),
        status: createStatusService({ db }),
        pause: createPauseService({ db, notifier: parts.notifier ?? outboxNotConnected }),
        usage: createUsageService({ db, today: () => bangkokDate(clock.now()) }),
      }),
      ...ownerRoutes({ owner: createOwnerService({ db, mailer: parts.mailer ?? mailerNotConnected, baseUrl: config.appBaseUrl }) }),
      ...testerRoutes({ testers: createTesterService({ db, baseUrl: config.appBaseUrl }) }),
      ...staffRoutes({
        staff: config.staffInvite
          ? createStaffInviteClient({ ...config.staffInvite, now: () => clock.now(), endSessionsFor: (staffId) => auth.endSessionsFor(staffId), ...(parts.staffInviteFetch ? { fetch: parts.staffInviteFetch } : {}) })
          : null,
      }),
      ...adminRoutes({ admin: createAdminService({ db }) }),
      ...supportRoutes({ support: createSupportService({ db, ...(parts.connections ? { connections: parts.connections } : {}) }) }),
      ...(config.healthToken ? healthRoutes({ health: createHealthService({ db, token: config.healthToken }) }) : []),
      ...(parts.extraRoutes ?? []),
    ],
    deps: {
      authenticate: (cookie) => auth.authenticate(cookie),
      maxBodyBytes: config.maxBodyBytes,
      ...(limiter ? { rateLimit: { limiter, routes: ['POST /auth/sign-in', 'POST /auth/second-factor', 'POST /auth/step-up'] } } : {}),
    },
  };
}
