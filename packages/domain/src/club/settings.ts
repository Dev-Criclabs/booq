import { can, route, RouteError, type RouteContext } from '@booq/auth';
import type { Db } from '@booq/db';
import { SETTINGS, settingByKey } from './settings-registry';

// GET /settings and PUT /settings/{key} (F01-T08; design 5.1, 6.2, 10; PLAT-05 settings, BOOK-03-AC3).
// The registry validates; the database refuses a key it does not know and a hold time that is not 10, 15 or 20
// (migration 0041). A write goes through the club's own transaction as the signed-in owner, so the audit entry
// carries the old and new value and the owner as actor (PLAT-04-AC1). Nothing here supplies a default value.

export interface SettingView {
  key: string;
  value: unknown;
  unset: boolean;
  /** Go live needs it set (design 9.3); a TBD setting and a slip-only setting are not required. */
  required: boolean;
  /** False for a setting that exists only for a slip checking club, when this club chose Beam. */
  available: boolean;
}

const tx = (ctx: RouteContext) => ({
  clubId: ctx.clubId,
  userId: ctx.userId,
  roles: ctx.roles,
  source: 'admin' as const,
  ...(ctx.requestId ? { requestId: ctx.requestId } : {}),
});

export function settingsRoutes(db: Db) {
  const list = route({ method: 'GET', path: '/settings', permission: 'settings.business.read' }, async (ctx): Promise<SettingView[]> => {
    const all = can(ctx.roles, 'settings.read');
    return db.withClubTx(tx(ctx), async (t) => {
      const rows = await t.query<{ key: string; value: unknown }>('select key, value from public.club_setting where club_id = $1', [ctx.clubId]);
      const values = new Map(rows.rows.map((r) => [r.key, r.value]));
      const pay = (await t.query<{ payment_option: string | null }>('select payment_option from public.club where id = $1', [ctx.clubId])).rows[0]?.payment_option;
      return SETTINGS.filter((s) => all || s.scope === 'business').map((s) => ({
        key: s.key,
        value: values.has(s.key) ? values.get(s.key) : null,
        unset: !values.has(s.key),
        required: !s.unsetAllowed && !s.slipOnly,
        available: !s.slipOnly || pay === 'slip',
      }));
    });
  });

  const put = route({ method: 'PUT', path: '/settings/:key', permission: 'settings.write' }, async (ctx) => {
    const input = ctx.input;
    if (typeof input !== 'object' || input === null || Array.isArray(input)) throw new RouteError(400, 'invalid_input');
    const body = input as Record<string, unknown>;
    const keys = Object.keys(body);
    if (keys.length !== 2 || !('key' in body) || !('value' in body) || typeof body['key'] !== 'string') throw new RouteError(400, 'invalid_input');
    const key = body['key'];
    const value = body['value'];
    const def = settingByKey(key);
    if (!def) throw new RouteError(404, 'unknown_setting');

    return db.withClubTx(tx(ctx), async (t) => {
      if (def.slipOnly) {
        const pay = (await t.query<{ payment_option: string | null }>('select payment_option from public.club where id = $1', [ctx.clubId])).rows[0]?.payment_option;
        if (pay !== 'slip') throw new RouteError(409, 'not_available');
      }
      if (value === null) {
        if (!def.unsetAllowed) throw new RouteError(400, 'cannot_unset');
        await t.query('delete from public.club_setting where club_id = $1 and key = $2', [ctx.clubId, key]);
        return { key, value: null };
      }
      const checked = def.validate(value);
      if (!checked.ok) throw new RouteError(400, checked.code);
      // The smallest group may not exceed the largest, whichever is written second.
      if (key === 'group_min_players' || key === 'group_max_players') {
        const other = key === 'group_min_players' ? 'group_max_players' : 'group_min_players';
        const o = (await t.query<{ value: number }>('select value from public.club_setting where club_id = $1 and key = $2', [ctx.clubId, other])).rows[0]?.value;
        if (typeof o === 'number' && (key === 'group_min_players' ? (checked.value as number) > o : o > (checked.value as number))) throw new RouteError(400, 'invalid_value');
      }
      await t.query(
        `insert into public.club_setting (club_id, key, value) values ($1, $2, $3::jsonb)
         on conflict (club_id, key) do update set value = excluded.value, updated_at = app.now()`,
        [ctx.clubId, key, JSON.stringify(checked.value)],
      );
      return { key, value: checked.value };
    });
  });

  return { list, put };
}
