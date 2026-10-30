import { LANG_COOKIE_SECONDS, Reply, route, RouteError, hashToken, serializeLangCookie, type Route, type RouteContext, type createProfileService, type createPublicConfigService, type createSignInService } from '@booq/auth';

// Sign-in routes (F02-T05 to T12; design 5): the transport over the sign-in, profile and config
// services. All are `public`: they are how a guest becomes a person. The club comes from the
// address (`input.slug`), the cookie from the header (`ctx.cookie`), and the answer carries codes only.
// The ID token is read from the body, handed to the verifier and dropped (LINE-01-AC13).

export interface AuthRouteDeps {
  signIn: ReturnType<typeof createSignInService>;
  profile: ReturnType<typeof createProfileService>;
  publicConfig: ReturnType<typeof createPublicConfigService>;
}

const MAX_INVITE = 256;
const slugOf = (ctx: RouteContext) => String((ctx.input as { slug?: unknown }).slug ?? '');
const bad = () => new RouteError(400, 'bad_input');

/** An invite link's raw token becomes the sha-256 hex the database stores (create_tester_invite). */
function inviteHashOf(raw: unknown): string | undefined {
  if (raw === undefined) return undefined;
  if (typeof raw !== 'string' || raw === '' || raw.length > MAX_INVITE) throw bad();
  return hashToken(raw);
}

export function authRoutes(deps: AuthRouteDeps): Route<unknown>[] {
  return [
    route({ method: 'POST', path: '/auth/session', public: true }, async (ctx) => {
      const body = ctx.body as Record<string, unknown> | undefined;
      if (!body || typeof body !== 'object' || Object.keys(body).some((k) => k !== 'idToken' && k !== 'invite')) throw bad();
      const inviteHash = inviteHashOf(body['invite']);
      const result = await deps.signIn.signIn({ slug: slugOf(ctx), idToken: body['idToken'], ...(inviteHash ? { inviteHash } : {}) });
      if (!result.ok) throw new RouteError(result.status, result.code);
      return new Reply({ state: result.state, ...(result.invite ? { invite: result.invite } : {}) }, { setCookie: result.setCookie });
    }),

    route({ method: 'POST', path: '/auth/profile', public: true }, async (ctx) => {
      // The invite token for a new player rides in the query, so the body holds only the profile fields.
      const q = (ctx.input as { invite?: unknown }).invite;
      const inviteHash = Object.hasOwn((ctx.body as object) ?? {}, 'invite') ? undefined : inviteHashOf(q);
      const result = await deps.profile.complete({ slug: slugOf(ctx), cookieHeader: ctx.cookie, body: ctx.body, ...(inviteHash ? { inviteHash } : {}) });
      if (result.ok) return { state: result.state };
      if (result.fields) return new Reply({ code: result.code, fields: result.fields }, { status: result.status });
      throw new RouteError(result.status, result.code);
    }),

    route({ method: 'POST', path: '/auth/logout', public: true }, async (ctx) => {
      const result = await deps.signIn.logout({ slug: slugOf(ctx), cookieHeader: ctx.cookie });
      if (!result.ok) throw new RouteError(result.status, result.code);
      return new Reply({ ok: true }, { setCookie: result.setCookie });
    }),

    // The guest's TH | EN toggle (AUTH-02-AC27): kept in a first-party cookie and written to the player record at first sign in.
    route({ method: 'PUT', path: '/public/language', public: true }, async (ctx) => {
      const body = ctx.body as Record<string, unknown> | undefined;
      if (!body || typeof body !== 'object' || Object.keys(body).some((k) => k !== 'language') || (body['language'] !== 'th' && body['language'] !== 'en')) throw bad();
      return new Reply({ language: body['language'] }, { setCookie: serializeLangCookie(body['language'], LANG_COOKIE_SECONDS) });
    }),

    route({ method: 'GET', path: '/public/config', public: true }, async (ctx) => {
      const result = await deps.publicConfig.get(slugOf(ctx));
      if (!result.ok) throw new RouteError(result.status, result.code);
      return result.config;
    }),
  ];
}
