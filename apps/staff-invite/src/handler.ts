import { createHash, randomBytes } from 'node:crypto';
import { INTERNAL_SIGNATURE, INTERNAL_TIMESTAMP, verifyInternalCall } from '@booq/auth';
import type { PlatformDb } from '@booq/db';

// apps/staff-invite (F01-T17b; ROLE-02-AC4 to AC6; SR-06; D123, D124 option 1, D148). The one small function that can
// invite a BOOQ teammate, reset a teammate's second factor and deactivate a teammate at the identity provider. It is
// the only code that may hold the provider's admin key, and it does nothing else. apps/platform calls it with a signed
// request; the signature, the actor and the rules are all checked here, and every call is written to P6 (ROLE-02-AC5).
//
//   POST /invite        { actorStaffId, stepUpFresh, email, displayName, role }   -> { staffId, enrolmentToken }
//   POST /reset-factor  { actorStaffId, stepUpFresh, targetStaffId }     by another platform admin (D123)   -> { ok, enrolmentToken }
//   POST /deactivate    { actorStaffId, stepUpFresh, targetStaffId }
//   POST /identity/password      { email, password }              -> { authUserId, state? }   (D148, D160)
//   POST /identity/password-for  { authUserId, password }         -> { authUserId, state? }   (D161: a step-up)
//   POST /identity/totp          { authUserId, state, code }      -> { ok: true }
//   POST /identity/enrol-start   { authUserId, password }         -> { state, secret, uri }   (first factor, F01-T17c)
// First factor (F01-T17c): an invite or a reset also issues a single-use enrolment token (its hash is stored, migration
// 0055). The token is returned once, to the admin who asked, to hand to the teammate; whoever holds it sets a password and
// enrols an authenticator with enrol-start and then totp. apps/platform checks the token and binds authUserId to it.
// The identity routes are for sign-in, which happens before any staff member is known: they carry no actor, only the
// signature of apps/platform. `state` is the provider's first-step token, opaque to everyone but this app; apps/platform
// keeps it sealed on the server under the challenge id and sends it back with the code. Wrong credentials are 401.
//
// `stepUpFresh` is the platform app's word that the actor passed the second factor recently (SR-16); the request is
// signed, so only that app can say it. The actor must be an active platform admin in the database. Answers are codes.

export interface SupabaseAdmin {
  /** Sends the invite email and creates the auth user. Returns the new auth user id. */
  inviteUser(email: string): Promise<{ authUserId: string }>;
  /** Removes the person's enrolled second factors so they enrol again. */
  resetFactors(authUserId: string): Promise<void>;
  /** Stops the person signing in and ends their provider sessions. */
  banUser(authUserId: string): Promise<void>;
  /** Sets the person's password. 'weak' when the project's own rule refuses it. */
  setPassword(authUserId: string, password: string): Promise<'ok' | 'weak'>;
  /** Removes the authenticators that were started and never confirmed, so a retry starts clean. */
  removeUnverifiedFactors(authUserId: string): Promise<void>;
  /** The email of an auth user, for a step-up that knows the person only by their auth user id. Null when there is none. */
  emailOf(authUserId: string): Promise<string | null>;
  /** Removes a user created by an invite whose record could not be saved. */
  deleteUser(authUserId: string): Promise<void>;
}

/** The provider's sign-in side (the anon key lives only behind this). */
export interface SupabaseIdentity {
  /** Email and password. Null when wrong. `state` is present when the person has an enrolled authenticator. */
  passwordGrant(email: string, password: string): Promise<{ authUserId: string; state?: string } | null>;
  /** Password, then the start of an authenticator: its secret and address for the QR code, and the state for the code. Null when the password is wrong. */
  startEnrolment(email: string, password: string): Promise<{ authUserId: string; state: string; secret: string; uri: string } | null>;
  /** Checks the code from the authenticator against the state of the password step. False when it is wrong. */
  verifyCode(authUserId: string, state: string, code: string): Promise<boolean>;
}

export interface StaffInviteDeps {
  admin: SupabaseAdmin;
  identity: SupabaseIdentity;
  db: PlatformDb;
  /** Shared with apps/platform only. */
  signingSecret: string;
  /** How far a signed request's time may be from now, in seconds. A setting, no default. */
  maxSkewSeconds: number;
  /** Largest request body in bytes. A setting, no default. */
  maxBodyBytes: number;
  now(): Date;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const ROLES = ['platform_admin', 'onboarding_specialist'];
const JSON_HEADERS = { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' };
const reply = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
const code = (status: number, c: string) => reply(status, { code: c });

interface Staff { id: string; auth_user_id: string; display_name: string; role: string; active: boolean }

export function createStaffInviteHandler(deps: StaffInviteDeps): (request: Request) => Promise<Response> {
  const { db, admin, identity } = deps;
  const staffById = (id: string): Promise<Staff | null> =>
    db.withPlatformTx({ staffId: null }, async (tx) => (await tx.query<Staff>('select id, auth_user_id, display_name, role, active from platform.staff_by_id($1)', [id])).rows[0] ?? null);
  const as = (a: Staff) => ({ staffId: a.id, staffLabel: a.display_name });
  const audit = (tx: { query(text: string, params?: unknown[]): Promise<unknown> }, action: string, target: string, detail: Record<string, unknown>) =>
    tx.query(`select platform.write_audit($1, null, 'platform_staff', $2, $3::jsonb, null, null)`, [action, target, JSON.stringify(detail)]);

  async function invite(actor: Staff, b: Record<string, unknown>): Promise<Response> {
    const keys = Object.keys(b).filter((k) => !['actorStaffId', 'stepUpFresh'].includes(k));
    if (keys.some((k) => !['email', 'displayName', 'role'].includes(k))) return code(400, 'bad_input');
    const email = typeof b['email'] === 'string' ? b['email'].trim() : '';
    const name = typeof b['displayName'] === 'string' ? b['displayName'].trim() : '';
    if (!EMAIL.test(email) || email.length > 254 || name === '' || name.length > 100 || typeof b['role'] !== 'string' || !ROLES.includes(b['role'])) return code(400, 'bad_input');
    const role = b['role'];
    if (!(await enrolmentConfigured(actor))) return code(503, 'not_configured');
    const taken = await db.withPlatformTx(as(actor), async (tx) => (await tx.query('select 1 from platform.platform_staff where lower(email) = lower($1)', [email])).rows.length > 0);
    if (taken) return code(409, 'email_taken');
    let authUserId: string;
    try {
      authUserId = (await admin.inviteUser(email)).authUserId;
    } catch {
      return code(502, 'provider_failed');
    }
    const link = newToken();
    try {
      const staffId = await db.withPlatformTx(as(actor), async (tx) => {
        const id = (await tx.query<{ id: string }>('insert into platform.platform_staff (auth_user_id, email, display_name, role) values ($1,$2,$3,$4) returning id', [authUserId, email, name, role])).rows[0]!.id;
        await audit(tx, 'staff.invited', id, { role });
        await issue(tx, id, link.hash, 'invite');
        return id;
      });
      return reply(200, { staffId, enrolmentToken: link.token });
    } catch {
      await admin.deleteUser(authUserId).catch(() => undefined);
      return code(500, 'internal');
    }
  }

  async function targetOf(actor: Staff, b: Record<string, unknown>, refusalAction: string): Promise<Staff | Response> {
    if (Object.keys(b).some((k) => !['actorStaffId', 'stepUpFresh', 'targetStaffId'].includes(k)) || typeof b['targetStaffId'] !== 'string' || !UUID.test(b['targetStaffId'])) return code(400, 'bad_input');
    if (b['targetStaffId'] === actor.id) {
      await db.withPlatformTx(as(actor), (tx) => audit(tx, refusalAction, actor.id, { reason: 'same_person' }));
      return code(409, 'same_person');
    }
    const target = await staffById(b['targetStaffId']);
    return target && target.active ? target : code(404, 'not_found');
  }

  async function resetFactor(actor: Staff, b: Record<string, unknown>): Promise<Response> {
    const target = await targetOf(actor, b, 'staff.factor_reset_refused');
    if (target instanceof Response) return target;
    if (!(await enrolmentConfigured(actor))) return code(503, 'not_configured');
    try {
      await admin.resetFactors(target.auth_user_id);
    } catch {
      return code(502, 'provider_failed');
    }
    // The reset leads straight to a new enrolment: without an authenticator the teammate could not sign in at all.
    const link = newToken();
    await db.withPlatformTx(as(actor), async (tx) => {
      await audit(tx, 'staff.factor_reset', target.id, { target_name: target.display_name });
      await issue(tx, target.id, link.hash, 'reset');
    });
    return reply(200, { ok: true, enrolmentToken: link.token });
  }

  async function deactivate(actor: Staff, b: Record<string, unknown>): Promise<Response> {
    const target = await targetOf(actor, b, 'staff.deactivate_refused');
    if (target instanceof Response) return target;
    const done = await db.withPlatformTx(as(actor), async (tx) => {
      if (target.role === 'platform_admin') {
        const n = (await tx.query<{ n: number }>("select count(*)::int as n from platform.platform_staff where role = 'platform_admin' and active")).rows[0]!.n;
        if (n <= 1) return false;
      }
      await tx.query('update platform.platform_staff set active = false where id = $1', [target.id]);
      await audit(tx, 'staff.deactivated', target.id, { target_name: target.display_name });
      return true;
    });
    if (!done) return code(409, 'last_admin');
    try {
      await admin.banUser(target.auth_user_id);
    } catch {
      return code(502, 'provider_failed');   // already inactive here, so sign in is refused (ROLE-02-AC4)
    }
    return reply(200, { ok: true });
  }

  // Enrolment links. Only the hash of the token is stored; the platform setting for their life must be set first.
  const newToken = () => {
    const token = randomBytes(32).toString('base64url');
    return { token, hash: createHash('sha256').update(token).digest('hex') };
  };
  const enrolmentConfigured = (actor: Staff): Promise<boolean> =>
    db.withPlatformTx(as(actor), async (tx) => {
      const v = (await tx.query<{ value: unknown }>(`select value from platform.config where key = 'console_enrolment_ttl_hours'`)).rows[0]?.value;
      return typeof v === 'number' && v > 0;
    });
  const issue = (tx: { query(text: string, params?: unknown[]): Promise<unknown> }, staffId: string, hash: string, purpose: 'invite' | 'reset') =>
    tx.query('select platform.issue_staff_enrolment($1, $2, $3)', [staffId, hash, purpose]);

  const text = (v: unknown, max: number): v is string => typeof v === 'string' && v !== '' && v.length <= max;

  // Sign-in routes. Failures that mean "these are not the right credentials" are one answer; a provider that cannot
  // be reached is another, so the console can tell a wrong password from an outage.
  async function identityRoute(path: string, b: Record<string, unknown>): Promise<Response> {
    const only = (...keys: string[]) => Object.keys(b).every((k) => keys.includes(k));
    try {
      if (path === '/identity/password') {
        if (!only('email', 'password') || !text(b['email'], 254) || !text(b['password'], 1000)) return code(400, 'bad_input');
        const r = await identity.passwordGrant(b['email'].trim(), b['password']);
        return r ? reply(200, r) : code(401, 'invalid_credentials');
      }
      if (path === '/identity/password-for') {
        if (!only('authUserId', 'password') || !text(b['authUserId'], 64) || !UUID.test(b['authUserId']) || !text(b['password'], 1000)) return code(400, 'bad_input');
        const email = await admin.emailOf(b['authUserId']);
        if (!email) return code(401, 'invalid_credentials');
        const r = await identity.passwordGrant(email, b['password']);
        return r && r.authUserId === b['authUserId'] ? reply(200, r) : code(401, 'invalid_credentials');
      }
      if (path === '/identity/enrol-start') {
        if (!only('authUserId', 'password') || !text(b['authUserId'], 64) || !UUID.test(b['authUserId']) || !text(b['password'], 1000)) return code(400, 'bad_input');
        const email = await admin.emailOf(b['authUserId']);
        if (!email) return code(404, 'not_found');
        await admin.removeUnverifiedFactors(b['authUserId']);
        if ((await admin.setPassword(b['authUserId'], b['password'])) === 'weak') return code(400, 'weak_password');
        const started = await identity.startEnrolment(email, b['password']);
        return started && started.authUserId === b['authUserId'] ? reply(200, { state: started.state, secret: started.secret, uri: started.uri }) : code(502, 'provider_failed');
      }
      if (!only('authUserId', 'state', 'code') || !text(b['authUserId'], 64) || !UUID.test(b['authUserId']) || !text(b['state'], 8000) || !text(b['code'], 32)) return code(400, 'bad_input');
      return (await identity.verifyCode(b['authUserId'], b['state'], b['code'])) ? reply(200, { ok: true }) : code(401, 'bad_code');
    } catch {
      return code(502, 'provider_failed');
    }
  }
  const IDENTITY_PATHS = ['/identity/password', '/identity/password-for', '/identity/totp', '/identity/enrol-start'];

  return async (request) => {
    try {
      const path = new URL(request.url).pathname;
      const routes: Record<string, (a: Staff, b: Record<string, unknown>) => Promise<Response>> = { '/invite': invite, '/reset-factor': resetFactor, '/deactivate': deactivate };
      const handle = routes[path];
      if (!handle && !IDENTITY_PATHS.includes(path)) return code(404, 'not_found');
      if (request.method !== 'POST') return code(405, 'method_not_allowed');
      const raw = await request.text();
      if (new TextEncoder().encode(raw).length > deps.maxBodyBytes) return code(413, 'payload_too_large');
      const signed = verifyInternalCall(deps.signingSecret, deps.now(), deps.maxSkewSeconds, { timestamp: request.headers.get(INTERNAL_TIMESTAMP), signature: request.headers.get(INTERNAL_SIGNATURE) }, raw);
      if (!signed) return code(401, 'unauthorized');
      let body: unknown;
      try {
        body = JSON.parse(raw);
      } catch {
        return code(400, 'bad_input');
      }
      if (body === null || typeof body !== 'object' || Array.isArray(body)) return code(400, 'bad_input');
      const b = body as Record<string, unknown>;
      if (!handle) return await identityRoute(path, b);
      if (typeof b['actorStaffId'] !== 'string' || !UUID.test(b['actorStaffId']) || typeof b['stepUpFresh'] !== 'boolean') return code(400, 'bad_input');
      const actor = await staffById(b['actorStaffId']);
      if (!actor || !actor.active || actor.role !== 'platform_admin') return code(403, 'forbidden');
      if (b['stepUpFresh'] !== true) return code(401, 'step_up_required');
      return await handle(actor, b);
    } catch {
      return code(500, 'internal');
    }
  };
}
