import { createCipheriv, createDecipheriv, createHash, hkdfSync, randomBytes } from 'node:crypto';
import type { PlatformDb } from '@booq/db';
import type { AuditSink, AuthStore, StaffDirectory, StaffRecord } from './sign-in';

// The database sides of staff sign-in (F01-T17, T18): the staff lookup through the two definer
// functions that return one row each (sign-in runs before any identity is known), and the P6 writer
// through platform.write_audit, which takes the staff member from the transaction and refuses
// player data in the detail.

interface Row {
  id: string;
  auth_user_id: string;
  display_name: string;
  role: StaffRecord['role'];
  active: boolean;
}
const toRecord = (r: Row): StaffRecord => ({ id: r.id, authUserId: r.auth_user_id, displayName: r.display_name, role: r.role, active: r.active });
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function createDbStaffDirectory(db: PlatformDb): StaffDirectory {
  const one = async (sql: string, id: string) => {
    if (!UUID.test(id)) return null;
    const row = await db.withPlatformTx({ staffId: null }, async (tx) => (await tx.query<Row>(sql, [id])).rows[0]);
    return row ? toRecord(row) : null;
  };
  return {
    findByAuthUser: (authUserId) => one('select id, auth_user_id, display_name, role, active from platform.staff_by_auth_user($1)', authUserId),
    findById: (staffId) => one('select id, auth_user_id, display_name, role, active from platform.staff_by_id($1)', staffId),
  };
}

export function createDbAuditSink(db: PlatformDb): AuditSink {
  const write = (staffId: string | null, staffName: string | null, action: string, detail: Record<string, unknown>) =>
    db.withPlatformTx({ staffId, ...(staffId ? { staffLabel: staffName ?? 'staff' } : {}) }, (tx) =>
      tx.query('select platform.write_audit($1, null, null, null, $2::jsonb, null, null)', [action, JSON.stringify(detail)]),
    );
  return {
    async write(event) {
      try {
        await write(event.staffId, event.staffName, event.action, event.detail);
      } catch (e) {
        // P6 names only active staff. An event about a deactivated account (its sessions ending, a refused
        // sign-in) is still written, with no actor and the name kept in the detail, so it is never lost.
        if (!event.staffId || !/unknown or inactive staff member/.test(String((e as Error).message))) throw e;
        await write(null, null, event.action, { ...event.detail, staff: event.staffName });
      }
    },
  };
}

/** Thrown by the placeholder identity: the password adapter (apps/staff-invite, T17b) is not connected. The routes answer 503. */
export class IdentityUnavailable extends Error {
  constructor() {
    super('identity_unavailable');
  }
}

/**
 * The shared console store over the definer functions of migration 0051. Session and challenge ids are
 * hashed here before they leave the process, so the tables never hold a usable cookie. Times are
 * milliseconds since the epoch, from the application clock.
 */
export function createDbAuthStore(db: PlatformDb, options: { sealKey: string }): AuthStore {
  if (options.sealKey.length < 32) throw new Error('console store: the sealing key must be at least 32 characters');
  const hash = (id: string) => createHash('sha256').update(id).digest('hex');
  // The provider's token is sealed with AES-256-GCM under a key derived from the console signing key, so a copy
  // of the table alone does not yield it. Format: v1.<iv>.<tag>.<ciphertext>, base64url.
  const sealKey = Buffer.from(hkdfSync('sha256', options.sealKey, 'booq-console', 'challenge-provider-token', 32));
  const seal = (plain: string) => {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', sealKey, iv);
    const ct = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
    return `v1.${iv.toString('base64url')}.${cipher.getAuthTag().toString('base64url')}.${ct.toString('base64url')}`;
  };
  const unseal = (sealed: string): string | null => {
    const [v, iv, tag, ct] = sealed.split('.');
    if (v !== 'v1' || !iv || !tag || !ct) return null;
    try {
      const d = createDecipheriv('aes-256-gcm', sealKey, Buffer.from(iv, 'base64url'));
      d.setAuthTag(Buffer.from(tag, 'base64url'));
      return Buffer.concat([d.update(Buffer.from(ct, 'base64url')), d.final()]).toString('utf8');
    } catch {
      return null; // a different key or a changed value: as if there were no token
    }
  };
  const tx = <T>(run: (q: (sql: string, args: unknown[]) => Promise<Record<string, unknown>[]>) => Promise<T>) =>
    db.withPlatformTx({ staffId: null }, (t) => run(async (sql, args) => (await t.query(sql, args)).rows as Record<string, unknown>[]));
  const call = (sql: string, args: unknown[]) => tx((q) => q(sql, args));
  const num = (v: unknown) => Number(v);
  return {
    async putChallenge(c) {
      await call('select platform.console_challenge_put($1, $2, $3, $4)', [hash(c.id), c.staffId, c.expiresAt, c.providerToken === undefined ? null : seal(c.providerToken)]);
    },
    async getChallenge(id) {
      const r = (await call('select staff_id, expires_at, provider_token_enc from platform.console_challenge_get($1)', [hash(id)]))[0];
      if (!r) return null;
      const token = r['provider_token_enc'] === null ? null : unseal(String(r['provider_token_enc']));
      return { id, staffId: String(r['staff_id']), expiresAt: num(r['expires_at']), ...(token === null ? {} : { providerToken: token }) };
    },
    async deleteChallenge(id) {
      await call('select platform.console_challenge_delete($1)', [hash(id)]);
    },
    async putSession(s) {
      await call('select platform.console_session_put($1, $2, $3, $4, $5)', [hash(s.id), s.staffId, s.createdAt, s.lastSeenAt, s.stepUpAt]);
    },
    async getSession(id) {
      const r = (await call('select staff_id, created_at, last_seen_at, step_up_at from platform.console_session_get($1)', [hash(id)]))[0];
      return r ? { id, staffId: String(r['staff_id']), createdAt: num(r['created_at']), lastSeenAt: num(r['last_seen_at']), stepUpAt: num(r['step_up_at']) } : null;
    },
    async deleteSession(id) {
      await call('select platform.console_session_delete($1)', [hash(id)]);
    },
    async deleteSessionsFor(staffId) {
      await call('select platform.console_sessions_delete_for($1)', [staffId]);
    },
    async addFailure(staffId) {
      return num((await call('select platform.console_failure_add($1) as n', [staffId]))[0]!['n']);
    },
    async clearFailures(staffId) {
      await call('select platform.console_failure_clear($1)', [staffId]);
    },
    async setLockedUntil(staffId, until) {
      await call('select platform.console_lock_set($1, $2)', [staffId, until]);
    },
    async getLockedUntil(staffId) {
      const v = (await call('select platform.console_lock_get($1) as v', [staffId]))[0]?.['v'];
      return v === null || v === undefined ? null : num(v);
    },
  };
}
