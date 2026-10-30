import { RouteError } from '@booq/auth';
import { answer } from '../http/answer';
import { platformRoute, type PlatformRoute } from '../http/server';
import { IdentityUnavailable } from '../auth/adapters';
import type { createEnrolmentService } from './enrol';

// Enrolment routes (F01-T17c): public, because the person has no account to sign in to yet; the link is the credential,
// single use and short lived. Rate limited like the sign-in routes. An outage of apps/staff-invite is 503 identity_unavailable.

export interface EnrolRouteDeps {
  enrol: ReturnType<typeof createEnrolmentService>;
}

function strings<K extends string>(body: Record<string, unknown>, keys: readonly K[]): Record<K, string> {
  if (Object.keys(body).some((k) => !keys.includes(k as K))) throw new RouteError(400, 'bad_input');
  const out = {} as Record<K, string>;
  for (const k of keys) {
    const v = body[k];
    if (typeof v !== 'string' || v === '' || v.length > 1000) throw new RouteError(400, 'bad_input');
    out[k] = v;
  }
  return out;
}

async function guarded<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof IdentityUnavailable) throw new RouteError(503, 'identity_unavailable');
    throw e;
  }
}

export const ENROL_RATE_LIMITED = ['POST /enrol/check', 'POST /enrol/start', 'POST /enrol/finish'];

export function enrolRoutes(deps: EnrolRouteDeps): PlatformRoute[] {
  const { enrol } = deps;
  return [
    // A POST, not a GET with the token in the address: it stays out of access logs and referrers.
    platformRoute({ method: 'POST', path: '/enrol/check', access: 'public' }, async (ctx) => {
      const { token } = strings(ctx.body, ['token']);
      const r = await enrol.peek(token);
      if (!r.ok) throw new RouteError(404, r.code);
      return { displayName: r.displayName };
    }),
    platformRoute({ method: 'POST', path: '/enrol/start', access: 'public' }, async (ctx) => {
      const { token, password } = strings(ctx.body, ['token', 'password']);
      const r = await guarded(() => enrol.start(token, password));
      if (!r.ok) throw new RouteError(r.code === 'invalid_link' ? 404 : 400, r.code);
      return answer(r);
    }),
    platformRoute({ method: 'POST', path: '/enrol/finish', access: 'public' }, async (ctx) => {
      const { enrolmentId, code } = strings(ctx.body, ['enrolmentId', 'code']);
      const r = await guarded(() => enrol.finish(enrolmentId, code));
      if (!r.ok) throw new RouteError(r.code === 'invalid_enrolment' ? 404 : r.code === 'too_many_attempts' ? 429 : 401, r.code);
      return { ok: true };
    }),
  ];
}
