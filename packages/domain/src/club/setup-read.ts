import { can, route, type RouteContext } from '@booq/auth';
import type { Db } from '@booq/db';

// GET /club/setup (F01 design 5.1, F11 design 5.14; ADMIN-16; D115): what the Settings page (A16) shows besides the settings list. The business and tax
// details with the VAT switch (the Accountant reads these, and only these), and for the owner the opening hours, the locations and every court
// (inactive ones too) and whether BOOQ may change the setup now. Business columns are read through public.club_business (the app role has no select
// on them, migration 0026). The platform's own columns (plan, billing) are not here. Nothing is supplied for an empty value: it comes back null.

interface Hours { weekday: number; open: string; close: string }
interface Court { id: string; location_id: string; name: string; sport: string; type: string | null; lights: boolean; max_players: number | null; active: boolean }

export function clubSetupRoute(db: Db) {
  return route({ method: 'GET', path: '/club/setup', permission: 'settings.business.read' }, async (ctx: RouteContext) => {
    const owner = can(ctx.roles, 'settings.read');
    return db.withClubTx(
      { clubId: ctx.clubId, userId: ctx.userId, roles: ctx.roles, source: 'admin', ...(ctx.requestId ? { requestId: ctx.requestId } : {}) },
      async (tx) => {
        const b = (await tx.query<{ legal_name: string | null; tax_id: string | null; tax_branch: string | null; registered_address: string | null; allow_booq_changes_until: Date | null }>(
          'select legal_name, tax_id, tax_branch, registered_address, allow_booq_changes_until from public.club_business where club_id = $1', [ctx.clubId])).rows[0];
        const prefix = (await tx.query<{ receipt_prefix: string | null }>('select receipt_prefix from public.club where id = $1', [ctx.clubId])).rows[0]?.receipt_prefix ?? null;
        const vat = (await tx.query<{ value: unknown }>(`select value from public.club_setting where club_id = $1 and key = 'vat_enabled'`, [ctx.clubId])).rows[0]?.value ?? null;
        const business = {
          legal_name: b?.legal_name ?? null, tax_id: b?.tax_id ?? null, tax_branch: b?.tax_branch ?? null, registered_address: b?.registered_address ?? null,
          receipt_prefix: prefix, vat_enabled: vat,
        };
        if (!owner) return { business };
        const hours = (await tx.query<Hours>(
          `select weekday, to_char(open, 'HH24:MI') as open, case when close = time '24:00' then '24:00' else to_char(close, 'HH24:MI') end as close from public.opening_hours where club_id = $1 order by weekday`,
          [ctx.clubId])).rows;
        const locations = (await tx.query<{ id: string; name: string }>('select id, name from public.location where club_id = $1 order by name, id', [ctx.clubId])).rows;
        const resources = (await tx.query<Court>('select id, location_id, name, sport, type, lights, max_players, active from public.resource where club_id = $1 order by name, id', [ctx.clubId])).rows;
        return { business, hours, locations, resources, supportWindowUntil: b?.allow_booq_changes_until ? b.allow_booq_changes_until.toISOString() : null };
      },
    );
  });
}
