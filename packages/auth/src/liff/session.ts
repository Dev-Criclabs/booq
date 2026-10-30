import type { Db } from '../../../db/src/tx';
import type { LineVerifier } from './verify';
import type { Logger } from './log-redaction';
import { clearSessionCookie, clubOfToken, hashToken, newSessionToken, parseSessionCookie, serializeSessionCookie } from './cookie';

// POST /auth/session and per-request authentication (F02-T07; LINE-01-AC1 to AC5, AC10, AC11,
// AC13; AUTH-01-AC13 to AC15; design 4.2, 4.4, 6.3, 6.4). The ID token is checked with LINE against
// the club's own Login channel, used once and dropped: it is never stored or logged. The browser
// gets a random token in a `__Host-` cookie and the database keeps only its hash. Roles are read
// from the database on every request, so a removed role takes effect on the next one.
// Results are codes, never text.

export interface ClubTarget {
  clubId: string;
  status: string;
  liffId: string;
  /** The club's default language (th or en), for a first sign-in that brings no language of its own. */
  defaultLanguage?: string | undefined;
  /** Server side only: the channel an ID token must have been issued for. Never in a response. */
  loginChannelId: string;
}
export interface SignInTx {
  query(text: string, params?: unknown[]): Promise<{ rows: any[]; rowCount?: number | null }>;
}
/** The two lookups a guest cannot do under row security (Architect: app.club_sign_in_target, app.person_by_line_id). */
export interface SignInDirectory {
  clubBySlug(slug: string): Promise<ClubTarget | null>;
  /** An ordinary (not imported or merged) person of the club in the context, by verified LINE id. */
  personByLineId(tx: SignInTx, lineUserId: string): Promise<{ id: string; active: boolean } | null>;
}

export interface SignInOptions {
  db: Db;
  verifier: LineVerifier;
  directory: SignInDirectory;
  now(): Date;
  /** Session life, in seconds. A setting: no default here. */
  sessionSeconds: number;
  logger?: Logger;
}

export type SignInResult =
  | { ok: true; state: 'active' | 'pending_profile'; clubId: string; setCookie: string; invite?: 'redeemed' | 'invalid' }
  | { ok: false; status: 400 | 401 | 403 | 404 | 503; code: 'bad_input' | 'invalid_token' | 'account_inactive' | 'not_found' | 'offline' };

export type AuthenticateResult =
  | { ok: true; state: 'active'; clubId: string; userId: string; roles: string[] }
  | { ok: true; state: 'pending_profile'; clubId: string; lineUserId: string; pendingDisplayName: string | null; pendingLanguage: string | null }
  | { ok: false; status: 401 | 404; code: 'unauthenticated' | 'not_found' };

const MAX_TOKEN = 8192;
const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;

export function createSignInService(options: SignInOptions) {
  const { db, verifier, directory, logger } = options;
  const guest = (clubId: string) => ({ clubId, userId: null, roles: ['guest'], source: 'player_app' as const });

  return {
    async signIn(input: { slug: unknown; idToken: unknown; inviteHash?: string }): Promise<SignInResult> {
      if (typeof input.slug !== 'string' || !SLUG.test(input.slug) || typeof input.idToken !== 'string' || input.idToken === '' || input.idToken.length > MAX_TOKEN) {
        return { ok: false, status: 400, code: 'bad_input' };
      }
      const club = await directory.clubBySlug(input.slug);
      if (!club) return { ok: false, status: 404, code: 'not_found' };

      const verified = await verifier.verifyIdToken({ idToken: input.idToken, loginChannelId: club.loginChannelId });
      if (!verified.ok) {
        logger?.warn('auth.session refused', { clubId: club.clubId, code: verified.code });
        return verified.code === 'offline' ? { ok: false, status: 503, code: 'offline' } : { ok: false, status: 401, code: 'invalid_token' };
      }

      const token = newSessionToken(club.clubId);
      const expiresAt = new Date(options.now().getTime() + options.sessionSeconds * 1000);
      let invite: 'redeemed' | 'invalid' | undefined;
      const outcome = await db.withClubTx(guest(club.clubId), async (tx): Promise<'active' | 'pending_profile' | 'not_found' | 'account_inactive'> => {
        const gate = (await tx.query('select app.sign_in_gate($1, $2) as gate', [verified.lineUserId, input.inviteHash ?? null])).rows[0]?.gate as string;
        if (gate === 'account_inactive') return 'account_inactive';
        if (gate !== 'open') return 'not_found'; // not a tester, or the club is not available: shown as not found
        const person = await directory.personByLineId(tx, verified.lineUserId);
        if (person && !person.active) return 'account_inactive';
        await tx.query('select app.create_session($1, $2, $3, $4, $5, $6, $7)', [
          hashToken(token),
          person ? 'active' : 'pending_profile',
          person?.id ?? null,
          verified.lineUserId,
          person ? null : verified.displayName,
          null,
          expiresAt,
        ]);
        // An existing person opening an invite link: the roles it carries are added in this transaction
        // (single use, one winner; SR-01, D122). A new person redeems it in the profile step (F02-T09).
        // A link that does not apply (used, expired, unknown, bound to another LINE id) adds nothing and
        // the answer does not say which; the person still signs in as they were.
        if (person && input.inviteHash) {
          await tx.query(`select set_config('app.user_id', $1, true)`, [person.id]);
          const redeemed = await tx.query('select * from app.redeem_invite($1, $2, $3)', [input.inviteHash, verified.lineUserId, person.id]);
          invite = redeemed.rows.length > 0 ? 'redeemed' : 'invalid';
        }
        return person ? 'active' : 'pending_profile';
      });
      logger?.info('auth.session', { clubId: club.clubId, outcome });
      if (outcome === 'not_found') return { ok: false, status: 404, code: 'not_found' };
      if (outcome === 'account_inactive') return { ok: false, status: 403, code: 'account_inactive' };
      return { ok: true, state: outcome, clubId: club.clubId, setCookie: serializeSessionCookie(token, options.sessionSeconds), ...(invite ? { invite } : {}) };
    },

    /**
     * POST /auth/logout (ROLE-02-AC4 club side, AUTH-02-AC5). Revokes this session only and clears the
     * cookie. No cookie, or one already revoked, is fine. A token issued for another club is not touched.
     * Deactivating a person ends all their sessions in the database (trigger), so no call is needed for that.
     */
    async logout(input: { slug: string; cookieHeader: string | undefined }): Promise<{ ok: true; setCookie: string } | { ok: false; status: 404; code: 'not_found' }> {
      if (typeof input.slug !== 'string' || !SLUG.test(input.slug)) return { ok: false, status: 404, code: 'not_found' };
      const club = await directory.clubBySlug(input.slug);
      if (!club) return { ok: false, status: 404, code: 'not_found' };
      const token = parseSessionCookie(input.cookieHeader);
      if (token) {
        if (clubOfToken(token) !== club.clubId) return { ok: false, status: 404, code: 'not_found' };
        await db.withClubTx(guest(club.clubId), (tx) => tx.query('select app.revoke_session($1)', [hashToken(token)]));
      }
      return { ok: true, setCookie: clearSessionCookie() };
    },

    async authenticate(input: { slug: string; cookieHeader: string | undefined }): Promise<AuthenticateResult> {
      if (typeof input.slug !== 'string' || !SLUG.test(input.slug)) return { ok: false, status: 404, code: 'not_found' };
      const club = await directory.clubBySlug(input.slug);
      if (!club) return { ok: false, status: 404, code: 'not_found' };
      const token = parseSessionCookie(input.cookieHeader);
      if (!token) return { ok: false, status: 401, code: 'unauthenticated' };
      // The session's club is the truth: another club's token on this address is not found (design 6.3).
      if (clubOfToken(token) !== club.clubId) return { ok: false, status: 404, code: 'not_found' };

      const s = await db.withClubTx(guest(club.clubId), async (tx) => (await tx.query('select * from app.touch_session($1)', [hashToken(token)])).rows[0]);
      if (!s) return { ok: false, status: 401, code: 'unauthenticated' };
      if (s.state === 'pending_profile') {
        return { ok: true, state: 'pending_profile', clubId: club.clubId, lineUserId: s.line_user_id, pendingDisplayName: s.pending_display_name ?? null, pendingLanguage: s.pending_language ?? null };
      }
      const roles = await db.withClubTx({ clubId: club.clubId, userId: s.user_id, roles: ['player'], source: 'player_app' }, async (tx) =>
        (await tx.query('select role from public.app_user_role where user_id = $1 order by role', [s.user_id])).rows.map((r) => r.role as string),
      );
      return { ok: true, state: 'active', clubId: club.clubId, userId: s.user_id, roles };
    },
  };
}
