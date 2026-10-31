import type { Db } from '../../../db/src/tx';
import type { SignInDirectory } from './session';

// GET /public/config (F02-T06; AUTH-01-AC1, AC7, AC11; D102, D103). What a caller who is not
// signed in may learn about a club: name, default language, status and LIFF id (so liff.init can
// run), and the languages offered. It is the same minimal answer for Draft, Testing, Live and
// Paused; the catalogue behind it is a separate gate. No secrets, no player data, no owner contact.
// It also carries the current privacy notice and terms release (D152, migration 0048), which a new
// player's consent names in POST /auth/profile; null when none is published.

export interface PublicConfig {
  nameTh: string;
  nameEn: string;
  defaultLanguage: string;
  status: string;
  liffId: string | null;
  /** The LINE Official Account's basic id for the Add on LINE button (public by nature); null when unset. */
  oaBasicId: string | null;
  languages: ['th', 'en'];
  noticeVersion: string | null;
}
export type PublicConfigResult = { ok: true; config: PublicConfig } | { ok: false; status: 404; code: 'not_found' };

const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;

export function createPublicConfigService(deps: { db: Db; directory: SignInDirectory }) {
  return {
    async get(slug: string): Promise<PublicConfigResult> {
      if (typeof slug !== 'string' || !SLUG.test(slug)) return { ok: false, status: 404, code: 'not_found' };
      const club = await deps.directory.clubBySlug(slug);
      if (!club) return { ok: false, status: 404, code: 'not_found' };
      const row = (
        await deps.db.withClubTx({ clubId: club.clubId, userId: null, roles: ['guest'], source: 'player_app' }, (tx) =>
          tx.query('select name_th, name_en, default_language, status, liff_id, notice_version, oa_basic_id from public.public_club_config'),
        )
      ).rows[0] as { name_th: string; name_en: string; default_language: string; status: string; liff_id: string | null; notice_version: string | null; oa_basic_id: string | null } | undefined;
      if (!row) return { ok: false, status: 404, code: 'not_found' };
      return {
        ok: true,
        config: { nameTh: row.name_th, nameEn: row.name_en, defaultLanguage: row.default_language, status: row.status, liffId: row.liff_id, oaBasicId: row.oa_basic_id, languages: ['th', 'en'], noticeVersion: row.notice_version },
      };
    },
  };
}
