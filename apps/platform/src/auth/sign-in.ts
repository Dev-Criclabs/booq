import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import type { Clock } from '@booq/time';

// BOOQ staff sign in (F01-T17; ROLE-02-AC1 to AC5; review SR-16, SR-06).
// Email and password, then a TOTP code: a session exists only after both. The session is
// server side; the cookie carries its id and an HMAC under the platform's own signing key, so
// a club (LINE) session can never be read here. Identity (Supabase Auth), the staff table, the
// P6 log and the stores sit behind interfaces; this module holds only the rules.
//
// Limits are the values Security recommended in SR-16. They are options, not constants of the
// product, so the user can change them without code.

export const PLATFORM_COOKIE = '__Host-booq-platform';

export interface StaffRecord {
  id: string;
  authUserId: string;
  displayName: string;
  role: 'platform_admin' | 'onboarding_specialist';
  active: boolean;
}

export interface IdentityProvider {
  /**
   * Email plus password. Returns the auth user, or null when either is wrong. `state` is whatever the provider needs to
   * check the second factor afterwards (its first-step token and factor id); the console keeps it on the server under
   * the challenge id, sealed at rest, and never puts it in an answer or a log.
   */
  verifyPassword(email: string, password: string): Promise<{ authUserId: string; state?: string } | null>;
  /**
   * The same check for a person already known by their auth user (a step-up, D161): the password of that user, and a
   * fresh state for the code that follows. Null when the password is wrong. The console never holds an email for this.
   */
  verifyPasswordFor(authUserId: string, password: string): Promise<{ authUserId: string; state?: string } | null>;
  /** A time-based code from an authenticator app. Never SMS or email (SR-16). `state` is what the password step returned. */
  verifyTotp(authUserId: string, code: string, state?: string): Promise<boolean>;
}

export interface StaffDirectory {
  findByAuthUser(authUserId: string): Promise<StaffRecord | null>;
  findById(staffId: string): Promise<StaffRecord | null>;
}

export interface AuditEvent {
  action: string;
  staffId: string | null;
  staffName: string | null;
  /** Setup-level facts only: a reason, never a password, a code or a session id. */
  detail: Record<string, unknown>;
  at: Date;
}

export interface AuditSink {
  /** Writes one P6 entry. A rejection refuses the step that needed it. */
  write(event: AuditEvent): Promise<void>;
}

export interface SessionRecord {
  id: string;
  staffId: string;
  createdAt: number;
  lastSeenAt: number;
  stepUpAt: number;
}

export interface ChallengeRecord {
  id: string;
  staffId: string;
  expiresAt: number;
  /** The identity provider's first-step token, kept server side under the challenge id. Sealed at rest by the database store; never logged. */
  providerToken?: string;
}

export interface AuthStore {
  putChallenge(c: ChallengeRecord): Promise<void>;
  getChallenge(id: string): Promise<ChallengeRecord | null>;
  deleteChallenge(id: string): Promise<void>;
  putSession(s: SessionRecord): Promise<void>;
  getSession(id: string): Promise<SessionRecord | null>;
  deleteSession(id: string): Promise<void>;
  deleteSessionsFor(staffId: string): Promise<void>;
  /** Adds one failed code and returns the new count. */
  addFailure(staffId: string): Promise<number>;
  clearFailures(staffId: string): Promise<void>;
  setLockedUntil(staffId: string, until: number): Promise<void>;
  getLockedUntil(staffId: string): Promise<number | null>;
}

export function createMemoryAuthStore(): AuthStore {
  const challenges = new Map<string, ChallengeRecord>();
  const sessions = new Map<string, SessionRecord>();
  const failures = new Map<string, number>();
  const locks = new Map<string, number>();
  return {
    async putChallenge(c) { challenges.set(c.id, c); },
    async getChallenge(id) { return challenges.get(id) ?? null; },
    async deleteChallenge(id) { challenges.delete(id); },
    async putSession(s) { sessions.set(s.id, { ...s }); },
    async getSession(id) { const s = sessions.get(id); return s ? { ...s } : null; },
    async deleteSession(id) { sessions.delete(id); },
    async deleteSessionsFor(staffId) { for (const [k, v] of sessions) if (v.staffId === staffId) sessions.delete(k); },
    async addFailure(staffId) { const n = (failures.get(staffId) ?? 0) + 1; failures.set(staffId, n); return n; },
    async clearFailures(staffId) { failures.delete(staffId); },
    async setLockedUntil(staffId, until) { locks.set(staffId, until); },
    async getLockedUntil(staffId) { return locks.get(staffId) ?? null; },
  };
}

export interface AuthPolicy {
  maxFailedCodes: number;
  lockoutMs: number;
  idleMs: number;
  absoluteMs: number;
  stepUpMs: number;
  challengeMs: number;
}

const MIN = 60_000;
export const DEFAULT_POLICY: AuthPolicy = {
  maxFailedCodes: 5,
  lockoutMs: 15 * MIN,
  idleMs: 30 * MIN,
  absoluteMs: 8 * 60 * MIN,
  stepUpMs: 5 * MIN,
  challengeMs: 5 * MIN,
};

export interface PlatformAuthDeps {
  identity: IdentityProvider;
  staff: StaffDirectory;
  audit: AuditSink;
  store: AuthStore;
  clock: Clock;
  /** Signs session cookies. Separate from every club signing key. At least 32 characters. */
  signingKey: string;
  policy?: Partial<AuthPolicy>;
}

export type SignInResult = { ok: true; challengeId: string } | { ok: false; code: 'invalid_credentials' };
export type SecondFactorResult =
  | { ok: true; cookie: string }
  | { ok: false; code: 'bad_code' | 'locked' | 'challenge_invalid' };
export type AuthenticateResult =
  | { ok: true; staff: { id: string; role: StaffRecord['role']; displayName: string }; stepUpFresh: boolean }
  | { ok: false; code: 'session_invalid' };
export type StepUpResult = { ok: true } | { ok: false; code: 'bad_code' | 'locked' | 'session_invalid' };

export function createPlatformAuth(deps: PlatformAuthDeps) {
  if (deps.signingKey.length < 32) throw new Error('platform auth: signing key must be at least 32 characters');  // i18n-ignore internal assertion or start up error, logged, never shown to a user
  const { identity, staff, audit, store, clock } = deps;
  const policy: AuthPolicy = { ...DEFAULT_POLICY, ...deps.policy };
  const now = () => clock.now().getTime();

  const log = (action: string, who: StaffRecord | null, detail: Record<string, unknown> = {}) =>
    audit.write({ action, staffId: who?.id ?? null, staffName: who?.displayName ?? null, detail, at: clock.now() });
  const failed = (reason: string, who: StaffRecord | null) => log('auth.sign_in_failed', who, { reason });

  const sign = (id: string) => createHmac('sha256', deps.signingKey).update(id).digest('base64url');
  const newId = () => randomBytes(32).toString('base64url');

  function sessionIdFrom(cookie: string): string | null {
    const dot = cookie.indexOf('.');
    if (dot < 1) return null;
    const id = cookie.slice(0, dot);
    const given = Buffer.from(cookie.slice(dot + 1));
    const want = Buffer.from(sign(id));
    return given.length === want.length && timingSafeEqual(given, want) ? id : null;
  }

  async function isLocked(staffId: string): Promise<boolean> {
    const until = await store.getLockedUntil(staffId);
    return until !== null && until > now();
  }

  /** Checks a code for a staff member; counts failures and applies the lockout. */
  async function checkCode(who: StaffRecord, verify: () => Promise<boolean>): Promise<'ok' | 'bad_code' | 'locked'> {
    if (await isLocked(who.id)) return 'locked';
    if (await verify()) {
      await store.clearFailures(who.id);
      return 'ok';
    }
    const count = await store.addFailure(who.id);
    if (count >= policy.maxFailedCodes) {
      await store.clearFailures(who.id);
      await store.setLockedUntil(who.id, now() + policy.lockoutMs);
      await log('auth.locked', who, { minutes: policy.lockoutMs / MIN });
    }
    return 'bad_code';
  }

  async function endSessionsFor(staffId: string): Promise<void> {
    await store.deleteSessionsFor(staffId);
  }

  async function signIn(input: { email: string; password: string }): Promise<SignInResult> {
    const found = await identity.verifyPassword(input.email, input.password);
    if (!found) {
      await failed('bad_credentials', null);
      return { ok: false, code: 'invalid_credentials' };
    }
    const who = await staff.findByAuthUser(found.authUserId);
    if (!who || !who.active) {
      await failed(who ? 'deactivated' : 'bad_credentials', who);
      return { ok: false, code: 'invalid_credentials' };
    }
    const challengeId = newId();
    await store.putChallenge({ id: challengeId, staffId: who.id, expiresAt: now() + policy.challengeMs, ...(found.state === undefined ? {} : { providerToken: found.state }) });
    return { ok: true, challengeId };
  }

  async function verifySecondFactor(input: { challengeId: string; code: string }): Promise<SecondFactorResult> {
    const challenge = await store.getChallenge(input.challengeId);
    if (!challenge || challenge.expiresAt <= now()) {
      if (challenge) await store.deleteChallenge(challenge.id);
      await failed('challenge_invalid', null);
      return { ok: false, code: 'challenge_invalid' };
    }
    const who = await staff.findById(challenge.staffId);
    if (!who || !who.active) {
      await store.deleteChallenge(challenge.id);
      await failed('deactivated', who);
      return { ok: false, code: 'challenge_invalid' };
    }
    const result = await checkCode(who, () => identity.verifyTotp(who.authUserId, input.code, challenge.providerToken));
    if (result === 'locked') {
      await failed('locked', who);
      return { ok: false, code: 'locked' };
    }
    if (result === 'bad_code') {
      await failed('bad_code', who);
      return { ok: false, code: 'bad_code' };
    }
    await log('auth.sign_in', who);
    await store.deleteChallenge(challenge.id);
    const id = newId();
    const t = now();
    await store.putSession({ id, staffId: who.id, createdAt: t, lastSeenAt: t, stepUpAt: t });
    return { ok: true, cookie: `${id}.${sign(id)}` };
  }

  async function load(cookie: string): Promise<{ session: SessionRecord; who: StaffRecord } | null> {
    const id = sessionIdFrom(cookie);
    if (!id) return null;
    const session = await store.getSession(id);
    if (!session) return null;
    const t = now();
    if (t - session.createdAt >= policy.absoluteMs || t - session.lastSeenAt >= policy.idleMs) {
      await store.deleteSession(id);
      return null;
    }
    const who = await staff.findById(session.staffId);
    if (!who || !who.active) {
      // Deactivated: every open session of this account ends (ROLE-02-AC4).
      await endSessionsFor(session.staffId);
      await log('auth.session_ended', who, { reason: 'deactivated' });
      return null;
    }
    session.lastSeenAt = t;
    await store.putSession(session);
    return { session, who };
  }

  async function authenticate(cookie: string): Promise<AuthenticateResult> {
    const loaded = await load(cookie);
    if (!loaded) return { ok: false, code: 'session_invalid' };
    const { session, who } = loaded;
    return {
      ok: true,
      staff: { id: who.id, role: who.role, displayName: who.displayName },
      stepUpFresh: now() - session.stepUpAt <= policy.stepUpMs,
    };
  }

  /**
   * A fresh second factor (D161): the password again, which gives the provider a fresh first step, then the code. A
   * wrong password and a wrong code are one answer and count the same toward the lockout.
   */
  async function stepUp(cookie: string, input: { code: string; password: string }): Promise<StepUpResult> {
    const loaded = await load(cookie);
    if (!loaded) return { ok: false, code: 'session_invalid' };
    const result = await checkCode(loaded.who, async () => {
      const first = await identity.verifyPasswordFor(loaded.who.authUserId, input.password);
      if (!first || first.authUserId !== loaded.who.authUserId) return false;
      return identity.verifyTotp(loaded.who.authUserId, input.code, first.state);
    });
    if (result === 'locked') return { ok: false, code: 'locked' };
    if (result === 'bad_code') {
      await log('auth.step_up_failed', loaded.who);
      return { ok: false, code: 'bad_code' };
    }
    loaded.session.stepUpAt = now();
    await store.putSession(loaded.session);
    await log('auth.step_up', loaded.who);
    return { ok: true };
  }

  async function signOut(cookie: string): Promise<void> {
    const loaded = await load(cookie);
    if (!loaded) return;
    await store.deleteSession(loaded.session.id);
    await log('auth.sign_out', loaded.who);
  }

  return { signIn, verifySecondFactor, authenticate, stepUp, signOut, endSessionsFor };
}
