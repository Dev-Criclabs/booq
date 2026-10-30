import { createHash, randomBytes } from 'node:crypto';
import type { OwnerTransactor } from '@booq/db';
import type { SupabaseAdmin } from './handler';

// The first BOOQ admin (D163). Nobody can invite the first admin, so a one-off operator script does it: DevOps runs it with
// the database owner and the provider's admin credentials, never through a web route. It creates the admin's provider user
// and their record, prints ONE enrolment link (set a password, add an authenticator: F01-T17c) and writes a P6 entry. It
// works only while no active admin exists, so a second run, or a run on a live team, changes nothing. The life of the link is
// a required argument: no default is shipped, and the setting console_enrolment_ttl_hours is left for the admins to set.

/** Runs `fn` in one transaction as the database owner (packages/db: createOwnerTransactor). */
export type OwnerDb = Pick<OwnerTransactor, 'transaction'>;

export type BootstrapResult =
  | { ok: true; staffId: string; enrolmentLink: string; expiresAt: string }
  | { ok: false; code: 'admin_exists' | 'email_taken' | 'bad_input' | 'provider_failed' };

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export interface BootstrapInput {
  email: string;
  displayName: string;
  /** How many hours the link lives. Required; whole or fractional, above zero. */
  ttlHours: number;
  /** The console's public address (https), for the link. */
  consoleBaseUrl: string;
}

export async function bootstrapFirstAdmin(deps: { db: OwnerDb; admin: SupabaseAdmin }, input: BootstrapInput): Promise<BootstrapResult> {
  const email = input.email.trim();
  const name = input.displayName.trim();
  if (!EMAIL.test(email) || email.length > 254 || name === '' || name.length > 100) return { ok: false, code: 'bad_input' };
  if (!Number.isFinite(input.ttlHours) || input.ttlHours <= 0 || input.ttlHours > 24 * 365) return { ok: false, code: 'bad_input' };
  if (!/^https:\/\/[^\s/]+(\/.*)?$/.test(input.consoleBaseUrl)) return { ok: false, code: 'bad_input' };

  const token = randomBytes(32).toString('base64url');
  const hash = createHash('sha256').update(token).digest('hex');

  // One transaction holds a lock, so two runs at once cannot both pass the check. The provider user is created inside it;
  // if anything after that fails the transaction rolls back and the user is removed again.
  let created: string | null = null;
  try {
    return await deps.db.transaction(async (tx): Promise<BootstrapResult> => {
      await tx.query(`select pg_advisory_xact_lock(hashtextextended('bootstrap_admin', 0))`);
      const existing = await tx.query(`select 1 from platform.platform_staff where role = 'platform_admin' and active`);
      if (existing.rows.length > 0) return { ok: false, code: 'admin_exists' };
      const taken = await tx.query(`select 1 from platform.platform_staff where lower(email) = lower($1)`, [email]);
      if (taken.rows.length > 0) return { ok: false, code: 'email_taken' };

      let authUserId: string;
      try {
        authUserId = (await deps.admin.inviteUser(email)).authUserId;
        created = authUserId;
      } catch {
        return { ok: false, code: 'provider_failed' };
      }
      const staffId = (await tx.query<{ id: string }>(`insert into platform.platform_staff (auth_user_id, email, display_name, role) values ($1,$2,$3,'platform_admin') returning id`, [authUserId, email, name])).rows[0]!.id;
      const expires = (await tx.query<{ e: Date }>(
        `insert into platform.staff_enrolment (token_hash, staff_id, purpose, created_by, expires_at)
         values ($1, $2, 'invite', $2, app.now() + make_interval(secs => $3::double precision)) returning expires_at as e`,
        [hash, staffId, input.ttlHours * 3600],
      )).rows[0]!.e;
      // The new admin is the actor of their own bootstrap, as the record says; the entry holds the facts, never the link.
      await tx.query(`select set_config('app.actor_platform_staff_id', $1, true), set_config('app.actor_label', $2, true)`, [staffId, name]);
      await tx.query(`select platform.write_audit('staff.bootstrapped', null, 'platform_staff', $1, $2::jsonb, null, null)`, [staffId, JSON.stringify({ role: 'platform_admin', ttl_hours: input.ttlHours })]);
      return { ok: true, staffId, enrolmentLink: `${input.consoleBaseUrl.replace(/\/+$/, '')}/enrol#${token}`, expiresAt: expires.toISOString() };
    }).then(async (r) => {
      if (!r.ok && created) await deps.admin.deleteUser(created).catch(() => undefined);
      return r;
    });
  } catch (e) {
    if (created) await deps.admin.deleteUser(created).catch(() => undefined);
    throw e;
  }
}

export type ReissueResult =
  | { ok: true; staffId: string; enrolmentLink: string; expiresAt: string }
  | { ok: false; code: 'nothing_to_reissue' | 'bad_input' };

/**
 * A new link for the bootstrap admin who never enrolled (D163 follow-up). Allowed only while NO admin has ever enrolled:
 * there is exactly one active admin, they were made by the bootstrap, and P6 holds no `staff.enrolled` for anyone. It voids
 * the old link, issues one fresh single-use link, and writes `staff.bootstrap_reissued`. The provider user is not touched.
 */
export async function reissueFirstAdminLink(deps: { db: OwnerDb }, input: { ttlHours: number; consoleBaseUrl: string }): Promise<ReissueResult> {
  if (!Number.isFinite(input.ttlHours) || input.ttlHours <= 0 || input.ttlHours > 24 * 365) return { ok: false, code: 'bad_input' };
  if (!/^https:\/\/[^\s/]+(\/.*)?$/.test(input.consoleBaseUrl)) return { ok: false, code: 'bad_input' };
  const token = randomBytes(32).toString('base64url');
  const hash = createHash('sha256').update(token).digest('hex');
  return deps.db.transaction(async (tx): Promise<ReissueResult> => {
    await tx.query(`select pg_advisory_xact_lock(hashtextextended('bootstrap_admin', 0))`);
    const admins = (await tx.query<{ id: string; display_name: string }>(`select id, display_name from platform.platform_staff where role = 'platform_admin' and active`)).rows;
    const enrolled = (await tx.query(`select 1 from platform.audit_log where action = 'staff.enrolled' limit 1`)).rows.length > 0;
    const admin = admins[0];
    if (!admin || admins.length !== 1 || enrolled) return { ok: false, code: 'nothing_to_reissue' };
    const bootstrapped = (await tx.query(`select 1 from platform.audit_log where action = 'staff.bootstrapped' and target_id = $1 limit 1`, [admin.id])).rows.length > 0;
    if (!bootstrapped) return { ok: false, code: 'nothing_to_reissue' };
    await tx.query(`delete from platform.staff_enrolment where staff_id = $1 and used_at is null`, [admin.id]);
    const expires = (await tx.query<{ e: Date }>(
      `insert into platform.staff_enrolment (token_hash, staff_id, purpose, created_by, expires_at)
       values ($1, $2, 'invite', $2, app.now() + make_interval(secs => $3::double precision)) returning expires_at as e`,
      [hash, admin.id, input.ttlHours * 3600],
    )).rows[0]!.e;
    await tx.query(`select set_config('app.actor_platform_staff_id', $1, true), set_config('app.actor_label', $2, true)`, [admin.id, admin.display_name]);
    await tx.query(`select platform.write_audit('staff.bootstrap_reissued', null, 'platform_staff', $1, $2::jsonb, null, null)`, [admin.id, JSON.stringify({ ttl_hours: input.ttlHours })]);
    return { ok: true, staffId: admin.id, enrolmentLink: `${input.consoleBaseUrl.replace(/\/+$/, '')}/enrol#${token}`, expiresAt: expires.toISOString() };
  });
}
