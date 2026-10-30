import type { RouteDeps } from '@booq/auth';
import type { Db } from '@booq/db';

// The switch check behind route() (PLAT-05-AC2). The server decides: a route that declares a feature is
// refused with feature_disabled while the club's switch is off, whatever the screen shows.
// app.has_feature reads the context club only, so asking about club A from club B's session is not possible.
export function createFeatureChecker(db: Db): RouteDeps {
  return {
    async hasFeature(clubId, featureKey) {
      return db.withClubTx({ clubId, userId: null, roles: ['guest'] }, async (tx) => {
        const r = await tx.query<{ ok: boolean }>('select app.has_feature($1) as ok', [featureKey]);
        return r.rows[0]?.ok === true;
      });
    },
  };
}
