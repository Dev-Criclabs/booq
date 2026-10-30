import type { Db } from '../../../db/src/tx';
import type { SignInDirectory } from './session';

// The sign-in directory over two SECURITY DEFINER functions (Architect, migration pending):
//   app.club_sign_in_target(slug)   -> club_id, status, liff_id, login_channel_id (no club in the context needed)
//   app.person_by_line_id(line_id)  -> id, active, for the club in the context; never an imported or merged record
// A guest cannot read the club or player tables, so these are the only way in.
const NO_CLUB = { clubId: '00000000-0000-0000-0000-000000000000', userId: null, roles: ['guest'] } as const;

export function createDbDirectory(db: Db): SignInDirectory {
  return {
    async clubBySlug(slug) {
      const row = (
        await db.withClubTx(NO_CLUB, (tx) => tx.query('select club_id, status, liff_id, login_channel_id from app.club_sign_in_target($1)', [slug]))
      ).rows[0] as { club_id: string; status: string; liff_id: string; login_channel_id: string } | undefined;
      return row ? { clubId: row.club_id, status: row.status, liffId: row.liff_id, loginChannelId: row.login_channel_id } : null;
    },
    async personByLineId(tx, lineUserId) {
      const row = (await tx.query('select id, active from app.person_by_line_id($1)', [lineUserId])).rows[0] as { id: string; active: boolean } | undefined;
      return row ? { id: row.id, active: row.active } : null;
    },
  };
}
