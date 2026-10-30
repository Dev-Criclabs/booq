import type { Db } from '../../../db/src/tx';
import { validateFullName, validatePhone, type NameErrorCode, type PhoneErrorCode } from '../../../domain/src/phone';
import { clubOfToken, hashToken, parseSessionCookie } from './cookie';
import { chooseLanguage, parseLangCookie } from './language';
import type { SignInDirectory, SignInTx, createSignInService } from './session';

// POST /auth/profile (F02-T09; AUTH-02-AC1 to AC8, AC28, AC30; D11, D100, D105; design 4.3).
// A pending LINE user gives a full name, a phone and consent; one database transaction then makes
// the player, the Player role and the consent (app.sign_up_player, which also upgrades the session),
// redeems an invite if one came with the link, and records a claim request when the typed phone
// matches exactly one unclaimed import. Without consent nothing is created and the pending session
// simply expires. Only these fields are accepted: roles, ids and test flags are never taken from the
// body. The answer is the same whether or not a record matched.

export type ProfileResult =
  | { ok: true; state: 'active' }
  | {
      ok: false;
      status: 400 | 401 | 404 | 409;
      code: 'bad_input' | 'consent_required' | 'invalid' | 'unauthenticated' | 'not_found' | 'not_pending' | 'already_registered' | 'invite_invalid' | 'notice_version_stale' | 'no_notice';
      fields?: { fullName?: NameErrorCode; phone?: PhoneErrorCode };
    };

export interface ProfileOptions {
  db: Db;
  directory: SignInDirectory;
  signIn: ReturnType<typeof createSignInService>;
  /** F01 claim service: records a claim request on a single phone match. Returns nothing. */
  requestClaim(tx: SignInTx, input: { claimantUserId: string; fullName: string; phone: string }): Promise<void>;
}

const ALLOWED = new Set(['fullName', 'phone', 'consent', 'noticeVersion', 'language']);
const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const MAX_VERSION = 64;
const MAX_TEXT = 200;

class Refused extends Error {
  constructor(readonly result: Extract<ProfileResult, { ok: false }>) {
    super(result.code);
  }
}

export function createProfileService(options: ProfileOptions) {
  const { db, directory } = options;

  return {
    async complete(input: { slug: string; cookieHeader: string | undefined; body: unknown; inviteHash?: string }): Promise<ProfileResult> {
      if (typeof input.slug !== 'string' || !SLUG.test(input.slug)) return { ok: false, status: 404, code: 'not_found' };
      const club = await directory.clubBySlug(input.slug);
      if (!club) return { ok: false, status: 404, code: 'not_found' };
      const token = parseSessionCookie(input.cookieHeader);
      if (!token) return { ok: false, status: 401, code: 'unauthenticated' };
      if (clubOfToken(token) !== club.clubId) return { ok: false, status: 404, code: 'not_found' };

      const auth = await options.signIn.authenticate({ slug: input.slug, cookieHeader: input.cookieHeader });
      if (!auth.ok) return { ok: false, status: auth.status === 404 ? 404 : 401, code: auth.code };
      if (auth.state !== 'pending_profile') return { ok: false, status: 409, code: 'not_pending' }; // a returning player never reaches this step

      const body = input.body;
      if (typeof body !== 'object' || body === null || Array.isArray(body) || Object.keys(body).some((k) => !ALLOWED.has(k))) {
        return { ok: false, status: 400, code: 'bad_input' };
      }
      const b = body as Record<string, unknown>;
      if (typeof b['fullName'] !== 'string' || typeof b['phone'] !== 'string' || b['fullName'].length > MAX_TEXT || b['phone'].length > MAX_TEXT) {
        return { ok: false, status: 400, code: 'bad_input' };
      }
      const noticeVersion = b['noticeVersion'];
      // The language is the one the client sends; without one, the guest's own toggle choice (cookie `lang`),
      // then the club's default (AUTH-02-AC27). The sign-in request carried no usable LINE or browser language.
      const sent = b['language'];
      if (sent !== undefined && sent !== 'th' && sent !== 'en') return { ok: false, status: 400, code: 'bad_input' };
      const language = sent ?? chooseLanguage({ guestChoice: parseLangCookie(input.cookieHeader), preferred: undefined, clubDefault: club.defaultLanguage });
      if (typeof noticeVersion !== 'string' || noticeVersion.trim() === '' || noticeVersion.length > MAX_VERSION) {
        return { ok: false, status: 400, code: 'bad_input' };
      }
      if (b['consent'] !== true) return { ok: false, status: 400, code: 'consent_required' };

      const name = validateFullName(b['fullName']);
      const phone = validatePhone(b['phone']);
      if (!name.ok || !phone.ok) {
        return { ok: false, status: 400, code: 'invalid', fields: { ...(name.ok ? {} : { fullName: name.code }), ...(phone.ok ? {} : { phone: phone.code }) } };
      }
      const typedPhone = b['phone'].trim();

      try {
        await db.withClubTx({ clubId: club.clubId, userId: null, roles: ['guest'], source: 'player_app' }, async (tx) => {
          let userId: string;
          try {
            userId = (
              await tx.query('select app.sign_up_player($1, $2, $3, $4, $5, $6, $7, $8) as id', [
                hashToken(token), name.value, typedPhone, phone.value.replace(/^\+/, ''), language, noticeVersion.trim(), language, input.inviteHash ?? null,
              ])
            ).rows[0]!.id as string;
          } catch (e) {
            const m = String((e as Error).message);
            if (/sign_up:no_pending_session/.test(m)) throw new Refused({ ok: false, status: 401, code: 'unauthenticated' });
            if (/sign_up:already_registered/.test(m)) throw new Refused({ ok: false, status: 409, code: 'already_registered' });
            if (/sign_up:not_a_tester/.test(m)) throw new Refused({ ok: false, status: 404, code: 'not_found' });
            // D152: the consent must name the current notice release; the client reloads the config and asks again.
            if (/sign_up:notice_version_stale/.test(m)) throw new Refused({ ok: false, status: 409, code: 'notice_version_stale' });
            if (/sign_up:no_notice/.test(m)) throw new Refused({ ok: false, status: 409, code: 'no_notice' });
            throw e;
          }
          // From here the new person is the actor of the rest of this transaction.
          await tx.query(`select set_config('app.user_id', $1, true)`, [userId]);
          if (input.inviteHash) {
            const redeemed = await tx.query('select * from app.redeem_invite($1, $2, $3)', [input.inviteHash, auth.lineUserId, userId]);
            if (redeemed.rows.length === 0) throw new Refused({ ok: false, status: 400, code: 'invite_invalid' });
          }
          await options.requestClaim(tx, { claimantUserId: userId, fullName: name.value, phone: typedPhone });
        });
      } catch (e) {
        if (e instanceof Refused) return e.result;
        throw e;
      }
      return { ok: true, state: 'active' };
    },
  };
}
