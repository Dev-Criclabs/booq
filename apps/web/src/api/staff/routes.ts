import { hashInviteToken, newInviteToken, route, RouteError, type Route, type RouteContext } from '@booq/auth';
import type { Db } from '@booq/db';

// POST /staff/invites/:id/cancel ends a pending staff or coach invite (F11 A17). An Owner is never invited here: the owner role comes only from the
// platform's owner invite (ROLE-02-AC8, D122) and is fixed (staff:owner_fixed).
// Staff routes (F01-T14; ROLE-01-AC1, AC5, AC6, AC7; design 5.1). The owner lists staff, creates staff and coach
// invites, sets a person's roles and deactivates a person. The rules live in the database functions of migration 0050,
// which check the owner role from the context and write the club audit notes; the route reads the body as sent
// (`ctx.body`), refuses unknown fields and turns `staff:<code>` refusals into typed codes. A BOOQ account is never a
// person of a club, so none of these can give one a club role (ROLE-01-AC6). Path parameter: `input.userId`.

export interface StaffRouteDeps {
  db: Db;
}

const STATUS: Record<string, number> = { forbidden: 403, not_found: 404, invalid_roles: 400, invalid_invite: 400, owner_fixed: 409, self: 409, not_configured: 503 };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const bad = () => new RouteError(400, 'bad_input');

const only = (body: unknown, allowed: string[]): Record<string, unknown> => {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) throw bad();
  const o = body as Record<string, unknown>;
  if (Object.keys(o).some((k) => !allowed.includes(k))) throw bad();
  return o;
};
const userIdOf = (ctx: RouteContext): string => {
  const id = (ctx.input as { userId?: unknown } | null)?.userId;
  if (typeof id !== 'string' || !UUID.test(id)) throw bad();
  return id;
};
const roleList = (v: unknown): string[] => {
  if (!Array.isArray(v) || !v.every((x) => typeof x === 'string')) throw bad();
  return v as string[];
};

export function staffRoutes(deps: StaffRouteDeps): Route<unknown>[] {
  const inClub = async <T>(ctx: RouteContext, fn: (query: (sql: string, params?: unknown[]) => Promise<{ rows: any[] }>) => Promise<T>): Promise<T> => {
    try {
      return await deps.db.withClubTx(
        { clubId: ctx.clubId, userId: ctx.userId, roles: ctx.roles, source: 'admin', ...(ctx.requestId ? { requestId: ctx.requestId } : {}) },
        (tx) => fn((sql, params) => tx.query(sql, params)),
      );
    } catch (e) {
      const m = /^staff:(\w+)/.exec((e as { message?: string }).message ?? '');
      if (m && (e as { code?: string }).code === 'P0001' && STATUS[m[1]!] !== undefined) throw new RouteError(STATUS[m[1]!]!, m[1]!);
      throw e;
    }
  };

  return [
    route({ method: 'GET', path: '/staff', permission: 'staff.manage' }, (ctx) => inClub(ctx, async (q) => (await q('select app.list_staff() as r')).rows[0]?.r)),
    route({ method: 'GET', path: '/staff/invites', permission: 'staff.manage' }, (ctx) => inClub(ctx, async (q) => (await q('select app.list_staff_invites() as r')).rows[0]?.r)),
    route({ method: 'POST', path: '/staff/invites', permission: 'staff.manage' }, (ctx) => {
      const b = only(ctx.body, ['kind', 'roles']);
      if (typeof b['kind'] !== 'string') throw bad();
      const roles = b['roles'] === undefined ? [] : roleList(b['roles']);
      const token = newInviteToken();
      return inClub(ctx, async (q) => {
        const id = (await q('select app.create_staff_invite($1, $2, $3) as id', [b['kind'], roles, hashInviteToken(token)])).rows[0]?.id as string;
        return { id, token };
      });
    }),
    route({ method: 'POST', path: '/staff/invites/:id/cancel', permission: 'staff.manage' }, (ctx) => {
      const id = (ctx.input as { id?: unknown } | null)?.id;
      if (typeof id !== 'string' || !UUID.test(id)) throw bad();
      return inClub(ctx, async (q) => {
        await q('select app.cancel_staff_invite($1)', [id]);
        return { ok: true };
      });
    }),
    route({ method: 'PUT', path: '/staff/:userId/roles', permission: 'roles.assign' }, (ctx) => {
      const id = userIdOf(ctx);
      const roles = roleList(only(ctx.body, ['roles'])['roles']);
      return inClub(ctx, async (q) => (await q('select app.set_user_roles($1, $2) as r', [id, roles])).rows[0]?.r);
    }),
    route({ method: 'POST', path: '/staff/:userId/deactivate', permission: 'staff.manage' }, (ctx) => {
      const id = userIdOf(ctx);
      return inClub(ctx, async (q) => {
        await q('select app.deactivate_user($1)', [id]);
        return { ok: true };
      });
    }),
  ];
}
