import { createPlatformDb } from '@booq/db';
import { createStaffInviteHandler } from './handler';
import { createSupabaseAdmin } from './supabase-admin';

// The one place the deployment's settings are read. None has a default: a missing or malformed one stops the function
// before it answers anything. SUPABASE_SERVICE_ROLE_KEY is read here and passed to the adapter, and goes nowhere else.
const WHOLE = /^[1-9][0-9]*$/;

export function staffInviteFromEnv(env: Record<string, string | undefined> = process.env): (request: Request) => Promise<Response> {
  const required = ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'STAFF_INVITE_SIGNING_SECRET', 'PLATFORM_DATABASE_URL', 'STAFF_INVITE_MAX_SKEW_SECONDS', 'STAFF_INVITE_MAX_BODY_BYTES'] as const;
  const missing = required.filter((n) => !env[n]);
  if (missing.length) throw new Error(`staff-invite settings missing: ${missing.join(', ')}`);
  for (const n of ['STAFF_INVITE_MAX_SKEW_SECONDS', 'STAFF_INVITE_MAX_BODY_BYTES'] as const) {
    if (!WHOLE.test(env[n]!)) throw new Error(`${n} must be a whole number above zero`);
  }
  return createStaffInviteHandler({
    admin: createSupabaseAdmin({ url: env['SUPABASE_URL']!, serviceRoleKey: env['SUPABASE_SERVICE_ROLE_KEY']! }),
    db: createPlatformDb({ connectionString: env['PLATFORM_DATABASE_URL']! }),
    signingSecret: env['STAFF_INVITE_SIGNING_SECRET']!,
    maxSkewSeconds: Number(env['STAFF_INVITE_MAX_SKEW_SECONDS']),
    maxBodyBytes: Number(env['STAFF_INVITE_MAX_BODY_BYTES']),
    now: () => new Date(),
  });
}
