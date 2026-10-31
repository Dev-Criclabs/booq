import { route, RouteError, type Route, type RouteContext } from '@booq/auth';
import type { Db, Tx } from '@booq/db';

// The owner's LINE routes (F10-T15; F10 design 5.5, 5.7 to 5.9, 6; LINE-02, LINE-06, D98, D114, D176):
//   GET /staff/line/status        state, percent, used, limit, plan and the token and usage health for the banners
//                                 (app.line_status, 0614): counts and codes only, never a token
//   GET /staff/rich-menu          the six tiles (an unset label is null and shows the default key, D54), the latest build
//                                 (status and error code) and whether a build is waiting
//   PUT /staff/rich-menu/labels   saves labels and asks for a build in one transaction (app.request_rich_menu_build, 0615).
//                                 The worker builds, since it alone reads the channel token (D149); the answer is
//                                 { build: 'queued' } and A16 reads the result from GET /staff/rich-menu. The links are
//                                 fixed in code and cannot be sent (D54).
// Labels are audited by the table's trigger, the request by its note.

export interface LineStaffRouteDeps {
  db: Db;
}

type Tile = { tile: number; th: string | null; en: string | null };

function readLabels(body: unknown): Tile[] {
  const bad = () => new RouteError(400, 'bad_input');
  if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).join() !== 'labels') throw bad();
  const list = (body as { labels: unknown }).labels;
  if (!Array.isArray(list) || list.length === 0 || list.length > 6) throw bad();
  const label = (v: unknown): string | null => {
    if (v === null) return null;
    if (typeof v !== 'string' || v.trim() === '') throw bad();
    return v.trim();
  };
  const tiles = list.map((x): Tile => {
    if (!x || typeof x !== 'object' || Array.isArray(x)) throw bad();
    const o = x as Record<string, unknown>;
    if (Object.keys(o).sort().join() !== 'en,th,tile' || !Number.isInteger(o['tile']) || (o['tile'] as number) < 1 || (o['tile'] as number) > 6) throw bad();
    return { tile: o['tile'] as number, th: label(o['th']), en: label(o['en']) };
  });
  if (new Set(tiles.map((t) => t.tile)).size !== tiles.length) throw bad();
  return tiles;
}

const inClub = <T>(deps: LineStaffRouteDeps, ctx: RouteContext, run: (tx: Tx) => Promise<T>) =>
  deps.db.withClubTx({ clubId: ctx.clubId, userId: ctx.userId, roles: ctx.roles, source: 'admin', ...(ctx.requestId ? { requestId: ctx.requestId } : {}) }, run);

export function lineStaffRoutes(deps: LineStaffRouteDeps): Route<unknown>[] {
  return [
    route({ method: 'GET', path: '/staff/line/status', permission: 'line.status.read' }, (ctx) =>
      inClub(deps, ctx, async (tx) => (await tx.query<{ s: unknown }>('select app.line_status() as s')).rows[0]!.s)),

    route({ method: 'GET', path: '/staff/rich-menu', permission: 'rich-menu.read' }, (ctx) =>
      inClub(deps, ctx, async (tx) => {
        const stored = (await tx.query<{ tile: number; label_th: string | null; label_en: string | null }>('select tile, label_th, label_en from public.rich_menu_label')).rows;
        const tiles = [1, 2, 3, 4, 5, 6].map((tile) => {
          const s = stored.find((r) => r.tile === tile);
          return { tile, th: s?.label_th ?? null, en: s?.label_en ?? null };
        });
        const latest = (await tx.query<{ status: string; error: string | null; uploaded_at: Date | null; created_at: Date }>(
          'select status, error, uploaded_at, created_at from public.rich_menu order by created_at desc, id limit 1')).rows[0];
        const requested = (await tx.query('select 1 from public.rich_menu_request')).rows.length > 0;
        return {
          tiles,
          build: latest ? { status: latest.status, error: latest.error, at: latest.created_at, uploadedAt: latest.uploaded_at } : null,
          requested,
        };
      })),

    route({ method: 'PUT', path: '/staff/rich-menu/labels', permission: 'rich-menu.write' }, (ctx) => {
      const tiles = readLabels(ctx.body);
      return inClub(deps, ctx, async (tx) => {
        for (const t of tiles) {
          await tx.query(
            `insert into public.rich_menu_label (club_id, tile, label_th, label_en) values (app.club_id(), $1, $2, $3)
             on conflict (club_id, tile) do update set label_th = excluded.label_th, label_en = excluded.label_en`, [t.tile, t.th, t.en]);
        }
        await tx.query('select app.request_rich_menu_build()');
        return { build: 'queued' as const };
      });
    }),
  ];
}
