import { route, RouteError, type Route } from '@booq/auth';
import type { Db } from '@booq/db';

// GET /customers/:id/dob-history (F02-T15; AUTH-02-AC21, AC24; decisions D12, D55). The owner reads the audited changes
// of a person's date of birth: the old and new value, who changed it and when. They come from the club audit log (the
// table trigger of F01-T10 wrote them), filtered to this one column; the player does not see them, and no other
// role is allowed by `customer.dob-history.read`. Path parameter: `input.id`.

export interface DobHistoryRouteDeps {
  db: Db;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function dobHistoryRoutes(deps: DobHistoryRouteDeps): Route<unknown>[] {
  return [
    route({ method: 'GET', path: '/customers/:id/dob-history', permission: 'customer.dob-history.read' }, async (ctx) => {
      const id = (ctx.input as { id?: unknown } | null)?.id;
      if (typeof id !== 'string' || !UUID.test(id)) throw new RouteError(400, 'bad_input');
      return deps.db.withClubTx(
        { clubId: ctx.clubId, userId: ctx.userId, roles: ctx.roles, source: 'admin', ...(ctx.requestId ? { requestId: ctx.requestId } : {}) },
        async (tx) => {
          if ((await tx.query('select 1 from public.app_user where id = $1', [id])).rows.length === 0) throw new RouteError(404, 'not_found');
          const r = await tx.query(
            `select occurred_at, actor_label, pii_old ->> 'date_of_birth' as old, pii_new ->> 'date_of_birth' as new
               from public.audit_entry
              where record_type = 'app_user' and record_id = $1
                and (pii_old ->> 'date_of_birth') is distinct from (pii_new ->> 'date_of_birth')
              order by occurred_at, seq`,
            [id],
          );
          return r.rows.map((e) => ({ at: new Date(e.occurred_at).toISOString(), actor: e.actor_label as string, old: (e.old ?? null) as string | null, new: (e.new ?? null) as string | null }));
        },
      );
    }),
  ];
}
