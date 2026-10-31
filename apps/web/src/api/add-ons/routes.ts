import { route, RouteError, type Route } from '@booq/auth';
import type { Db } from '@booq/db';

// F04 R3 / C10: the add-ons a player may add at checkout. Active add-ons with a price set; one with no price is not offered (R3-AC1, an empty
// setting is not free) and an inactive one is not offered (R3-AC4). Named columns only. A signed in person reads them (the row policy admits
// a player of a Live club, or a tester of a Testing one); the price is only what the screen shows, Pay prices again on the server (R5-AC6).

export interface AddOnRouteDeps {
  db: Db;
}

export interface AddOnView {
  id: string;
  nameTh: string;
  nameEn: string;
  priceSatang: number;
}

export function addOnRoutes(deps: AddOnRouteDeps): Route<AddOnView[]>[] {
  return [
    {
      ...route({ method: 'GET', path: '/add-ons', needsPerson: true }, async (ctx) => {
        try {
          return await deps.db.withClubTx({ clubId: ctx.clubId, userId: ctx.userId, roles: ctx.roles, source: 'player_app', ...(ctx.requestId ? { requestId: ctx.requestId } : {}) }, async (tx) => {
            const r = await tx.query<{ id: string; name_th: string; name_en: string; price_satang: number }>(
              `select id, name_th, name_en, price_satang from public.add_on where active and price_satang is not null order by position, name_en, id`);
            return r.rows.map((x) => ({ id: x.id, nameTh: x.name_th, nameEn: x.name_en, priceSatang: x.price_satang }));
          });
        } catch (e) {
          if ((e as { code?: string }).code === '42501') throw new RouteError(403, 'forbidden');
          throw e;
        }
      }),
      headers: { 'Cache-Control': 'no-store' },
    },
  ];
}
