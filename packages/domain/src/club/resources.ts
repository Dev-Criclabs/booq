import { route, RouteError, type RouteContext } from '@booq/auth';
import type { Db } from '@booq/db';

// POST /resources and PUT /resources/{id} (F01 design 5.1; PLAT-02 "Meets"; CC-4, BOOK-01-AC16, decision D50).
// A court is never deleted: taking it out of service sets active = false and keeps its id and history (CC-4).
// Taking one out of service is refused while it has a live booking or hold (F03's app.assert_resource_change_allowed,
// in the same transaction), with live_bookings_exist. There is no delete route.

const FIELDS = ['name', 'sport', 'type', 'lights', 'max_players'] as const;

type Fields = Partial<{ name: string; sport: string; type: string; lights: boolean; max_players: number }>;

function fields(body: Record<string, unknown>, allowed: readonly string[]): Fields {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(body)) {
    if (!allowed.includes(k)) throw new RouteError(400, 'invalid_input');
    if (k === 'lights') {
      if (typeof v !== 'boolean') throw new RouteError(400, 'invalid_input');
    } else if (k === 'max_players') {
      if (typeof v !== 'number' || !Number.isInteger(v) || v < 1) throw new RouteError(400, 'invalid_input');
    } else if (k === 'active') {
      if (typeof v !== 'boolean') throw new RouteError(400, 'invalid_input');
    } else if (k === 'location_id' || k === 'id') {
      if (typeof v !== 'string') throw new RouteError(400, 'invalid_input');
    } else if (typeof v !== 'string' || v.trim() === '' || v.length > 200) {
      throw new RouteError(400, 'invalid_input');
    }
    out[k] = typeof v === 'string' ? v.trim() : v;
  }
  return out as Fields;
}

const obj = (input: unknown): Record<string, unknown> => {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) throw new RouteError(400, 'invalid_input');
  return input as Record<string, unknown>;
};

function ctxOf(ctx: RouteContext) {
  return { clubId: ctx.clubId, userId: ctx.userId, roles: ctx.roles, source: 'admin' as const, ...(ctx.requestId ? { requestId: ctx.requestId } : {}) };
}

function mapDb(e: unknown): never {
  const err = e as { code?: string; message?: string };
  if (err.code === 'BK001') throw new RouteError(409, err.message ?? 'refused');
  if (typeof err.code === 'string' && /^(22|23)/.test(err.code)) throw new RouteError(400, 'invalid_input');   // a location of another club, a bad value
  throw e;
}

export function resourceRoutes(db: Db) {
  const create = route({ method: 'POST', path: '/resources', permission: 'resource.write' }, async (ctx) => {
    const body = obj(ctx.input);
    const f = fields(body, [...FIELDS, 'location_id']);
    const locationId = body['location_id'];
    if (typeof locationId !== 'string' || f.name === undefined || f.sport === undefined) throw new RouteError(400, 'invalid_input');
    const cols = Object.keys(f);
    try {
      return await db.withClubTx(ctxOf(ctx), async (tx) => {
        const r = await tx.query<{ id: string }>(
          `insert into public.resource (club_id, ${cols.join(', ')}) values ($1, ${cols.map((_, i) => `$${i + 2}`).join(', ')}) returning id`,
          [ctx.clubId, ...cols.map((c) => (f as Record<string, unknown>)[c] ?? locationId)],
        );
        return { id: r.rows[0]?.id as string };
      });
    } catch (e) {
      return mapDb(e);
    }
  });

  const update = route({ method: 'PUT', path: '/resources/:id', permission: 'resource.write' }, async (ctx) => {
    const body = obj(ctx.input);
    const id = body['id'];
    if (typeof id !== 'string') throw new RouteError(400, 'invalid_input');
    const { id: _id, ...rest } = body;
    const f = fields(rest, [...FIELDS, 'active']) as Fields & { active?: boolean };
    const cols = Object.keys(f);
    if (cols.length === 0) throw new RouteError(400, 'invalid_input');
    try {
      return await db.withClubTx(ctxOf(ctx), async (tx) => {
        const exists = await tx.query('select 1 from public.resource where club_id = $1 and id = $2', [ctx.clubId, id]);
        if (exists.rowCount !== 1) throw new RouteError(404, 'not_found');
        if (f.active === false) await tx.query('select app.assert_resource_change_allowed($1, false)', [id]);
        const sets = cols.map((c, i) => `${c} = $${i + 3}`).join(', ');
        await tx.query(`update public.resource set ${sets} where club_id = $1 and id = $2`, [ctx.clubId, id, ...cols.map((c) => (f as Record<string, unknown>)[c])]);
        return { id };
      });
    } catch (e) {
      if (e instanceof RouteError) throw e;
      return mapDb(e);
    }
  });

  return { create, update };
}
