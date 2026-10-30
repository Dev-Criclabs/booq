import { Reply, RouteError } from '@booq/auth';
import { platformRoute, type PlatformRoute } from '../http/server';
import { IdentityUnavailable } from './adapters';
import { PLATFORM_COOKIE, type createPlatformAuth } from './sign-in';

// Staff sign-in routes (F01-T17; ROLE-02-AC1 to AC5; SR-16; D148). Password, then a code from an
// authenticator app, then a cookie; step-up for the actions that need a fresh second factor;
// sign-out. The password check itself is the identity adapter (apps/staff-invite, T17b): this app
// holds no Supabase key of any kind (D148). Answers are codes only.

type Auth = ReturnType<typeof createPlatformAuth>;
export interface AuthRouteDeps {
  auth: Auth;
}

const COOKIE_ATTRS = 'Path=/; HttpOnly; Secure; SameSite=Strict';
const setCookie = (value: string) => `${PLATFORM_COOKIE}=${value}; ${COOKIE_ATTRS}`;
const clearCookie = () => `${PLATFORM_COOKIE}=; ${COOKIE_ATTRS}; Max-Age=0`;
const bad = () => new RouteError(400, 'bad_input');

/** The body must be exactly these string fields: nothing else is read and nothing is guessed. */
function strings<K extends string>(body: Record<string, unknown>, keys: readonly K[]): Record<K, string> {
  if (Object.keys(body).some((k) => !keys.includes(k as K))) throw bad();
  const out = {} as Record<K, string>;
  for (const k of keys) {
    const v = body[k];
    if (typeof v !== 'string' || v === '' || v.length > 1000) throw bad();
    out[k] = v;
  }
  return out;
}

/** The identity adapter being down is a 503, not a wrong password. */
async function guarded<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof IdentityUnavailable) throw new RouteError(503, 'identity_unavailable');
    throw e;
  }
}

export function authRoutes(deps: AuthRouteDeps): PlatformRoute[] {
  const { auth } = deps;
  return [
    platformRoute({ method: 'POST', path: '/auth/sign-in', access: 'public' }, async (ctx) => {
      const { email, password } = strings(ctx.body, ['email', 'password']);
      const r = await guarded(() => auth.signIn({ email, password }));
      if (!r.ok) throw new RouteError(401, r.code);
      return { challengeId: r.challengeId };
    }),

    platformRoute({ method: 'POST', path: '/auth/second-factor', access: 'public' }, async (ctx) => {
      const { challengeId, code } = strings(ctx.body, ['challengeId', 'code']);
      const r = await guarded(() => auth.verifySecondFactor({ challengeId, code }));
      if (!r.ok) throw new RouteError(r.code === 'locked' ? 423 : 401, r.code);
      return new Reply({ ok: true }, { setCookie: setCookie(r.cookie) });
    }),

    platformRoute({ method: 'POST', path: '/auth/step-up', access: 'staff' }, async (ctx) => {
      const { code } = strings(ctx.body, ['code']);
      const r = await guarded(() => auth.stepUp(ctx.cookie!, code));
      if (!r.ok) throw new RouteError(r.code === 'locked' ? 423 : 401, r.code);
      return { ok: true };
    }),

    platformRoute({ method: 'POST', path: '/auth/sign-out', access: 'staff' }, async (ctx) => {
      await auth.signOut(ctx.cookie!);
      return new Reply({ ok: true }, { setCookie: clearCookie() });
    }),

    platformRoute({ method: 'GET', path: '/auth/me', access: 'staff' }, async (ctx) => ({
      id: ctx.staff!.id,
      role: ctx.staff!.role,
      displayName: ctx.staff!.displayName,
      stepUpFresh: ctx.stepUpFresh,
    })),
  ];
}
