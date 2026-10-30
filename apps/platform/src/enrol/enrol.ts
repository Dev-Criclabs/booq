import { createHash, randomBytes } from 'node:crypto';
import type { PlatformDb } from '@booq/db';
import type { AuthStore } from '../auth/sign-in';

// First-factor enrolment for BOOQ staff (F01-T17c; ROLE-02-AC1, AC4; D123, D148). A teammate who was invited, or whose
// second factor an admin reset, opens a single-use link, sets a password and enrols an authenticator. The link is
// checked here against the database (migration 0055; only its hash is stored). The password and the authenticator are
// handled by apps/staff-invite, which this app asks with signed calls. The provider's first-step token never reaches
// the browser: it is kept sealed on the server under an opaque enrolment id (the shared console challenge table) and
// the browser holds only that id. The secret of the authenticator goes to the browser once, to be shown as a QR code.
// Everything here is before sign-in: no cookie, so the routes are rate limited. P6 holds who, when and the purpose,
// never the token, the password or a code.

export interface EnrolmentProvider {
  /** Sets the person's password and starts an authenticator. `weak_password` when the provider's own rule refuses it. */
  startEnrolment(authUserId: string, password: string): Promise<{ ok: true; state: string; secret: string; uri: string } | { ok: false; code: 'weak_password' }>;
  /** Confirms the authenticator with a code from it. False when the code is wrong. */
  finishEnrolment(authUserId: string, state: string, code: string): Promise<boolean>;
}

export type PeekResult = { ok: true; displayName: string } | { ok: false; code: 'invalid_link' };
export type StartResult = { ok: true; enrolmentId: string; secret: string; uri: string } | { ok: false; code: 'invalid_link' | 'weak_password' };
export type FinishResult = { ok: true } | { ok: false; code: 'invalid_enrolment' | 'bad_code' | 'too_many_attempts' };

export interface EnrolmentDeps {
  db: PlatformDb;
  provider: EnrolmentProvider;
  store: AuthStore;
  now(): number;
  /** How long a started enrolment (between the password and the code) stays open, in ms. A setting. */
  enrolmentMs: number;
  /** Wrong codes allowed before the started enrolment is dropped and the password step must be done again. A setting. */
  maxFailedCodes: number;
}

const hashOf = (token: string) => createHash('sha256').update(token).digest('hex');
const TOKEN = /^[A-Za-z0-9_-]{20,200}$/;

interface Open {
  staff_id: string;
  auth_user_id: string;
  display_name: string;
}

interface Pending {
  /** The provider's state for the code step. */
  s: string;
  /** The hash of the link token, to mark the link used at the end. */
  h: string;
  /** Wrong codes so far. */
  n: number;
}

export function createEnrolmentService(deps: EnrolmentDeps) {
  const { db, provider, store } = deps;

  async function open(token: string): Promise<Open | null> {
    if (!TOKEN.test(token)) return null;
    return db.withPlatformTx({ staffId: null }, async (tx) => (await tx.query<Open>('select staff_id, auth_user_id, display_name from platform.staff_enrolment_open($1)', [hashOf(token)])).rows[0] ?? null);
  }

  const log = (staffId: string, label: string, action: string, detail: Record<string, unknown>) =>
    db.withPlatformTx({ staffId, staffLabel: label }, (tx) => tx.query(`select platform.write_audit($1, null, 'platform_staff', $2, $3::jsonb, null, null)`, [action, staffId, JSON.stringify(detail)]));

  /** Is this link good? Nothing about the person is shown beyond the name, to greet them. */
  async function peek(token: string): Promise<PeekResult> {
    const o = await open(token);
    return o ? { ok: true, displayName: o.display_name } : { ok: false, code: 'invalid_link' };
  }

  async function start(token: string, password: string): Promise<StartResult> {
    const o = await open(token);
    if (!o) return { ok: false, code: 'invalid_link' };
    const r = await provider.startEnrolment(o.auth_user_id, password);
    if (!r.ok) return r;
    const enrolmentId = randomBytes(32).toString('base64url');
    const pending: Pending = { s: r.state, h: hashOf(token), n: 0 };
    await store.putChallenge({ id: enrolmentId, staffId: o.staff_id, expiresAt: deps.now() + deps.enrolmentMs, providerToken: JSON.stringify(pending) });
    await log(o.staff_id, o.display_name, 'staff.enrolment_started', {});
    return { ok: true, enrolmentId, secret: r.secret, uri: r.uri };
  }

  async function finish(enrolmentId: string, code: string): Promise<FinishResult> {
    const c = await store.getChallenge(enrolmentId);
    if (!c || c.expiresAt <= deps.now() || !c.providerToken) {
      if (c) await store.deleteChallenge(enrolmentId);
      return { ok: false, code: 'invalid_enrolment' };
    }
    let pending: Pending;
    try {
      pending = JSON.parse(c.providerToken) as Pending;
    } catch {
      await store.deleteChallenge(enrolmentId);
      return { ok: false, code: 'invalid_enrolment' };
    }
    const who = await db.withPlatformTx({ staffId: null }, async (tx) => (await tx.query<{ id: string; auth_user_id: string; display_name: string; active: boolean }>('select id, auth_user_id, display_name, active from platform.staff_by_id($1)', [c.staffId])).rows[0] ?? null);
    if (!who || !who.active) {
      await store.deleteChallenge(enrolmentId);
      return { ok: false, code: 'invalid_enrolment' };
    }
    if (!(await provider.finishEnrolment(who.auth_user_id, pending.s, code))) {
      pending.n += 1;
      await log(who.id, who.display_name, 'staff.enrolment_failed', { attempt: pending.n });
      if (pending.n >= deps.maxFailedCodes) {
        await store.deleteChallenge(enrolmentId);
        return { ok: false, code: 'too_many_attempts' };
      }
      await store.putChallenge({ ...c, providerToken: JSON.stringify(pending) });
      return { ok: false, code: 'bad_code' };
    }
    // The authenticator is confirmed. Marking the link used is the last step: it can be done once, by this member, and is logged.
    const used = await db.withPlatformTx({ staffId: who.id, staffLabel: who.display_name }, async (tx) => (await tx.query<{ ok: boolean }>('select platform.staff_enrolment_finish($1) as ok', [pending.h])).rows[0]?.ok === true);
    await store.deleteChallenge(enrolmentId);
    return used ? { ok: true } : { ok: false, code: 'invalid_enrolment' };
  }

  return { peek, start, finish };
}
