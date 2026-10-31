import { route, RouteError, type Route } from '@booq/auth';
import type { Db, Tx } from '@booq/db';

// GET and PUT /me/notification-prefs (F10-T14; F10 design 5.10, 6; LINE-05, D94). The two switches on the player
// Profile (C17): Booking reminders (the 24 and 2 hour reminders) and Promotions (the birthday discount and referral
// reward). Confirmations, payment results and cancellation results are always sent and have no switch (CC-3). No row
// means the defaults of migration 0602 (reminders on, promotions off, A-2). Only the signed-in person's own row is read
// or written: the row policy notification_pref_self (user_id = app.user_id()) in the person's club context; the
// sender reads the switches at send time (D94). A change is audited (the Promotions opt in, PDPA).

export interface NotificationPrefRouteDeps {
  db: Db;
}

const SWITCHES = ['reminders', 'promotions'] as const;
type Prefs = { reminders: boolean; promotions: boolean };

function readBody(body: unknown): Partial<Prefs> {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new RouteError(400, 'bad_input');
  const keys = Object.keys(body);
  const b = body as Record<string, unknown>;
  if (keys.length === 0 || keys.some((k) => !(SWITCHES as readonly string[]).includes(k)) || keys.some((k) => typeof b[k] !== 'boolean')) {
    throw new RouteError(400, 'bad_input');
  }
  return b as Partial<Prefs>;
}

const current = async (tx: Tx): Promise<Prefs> => {
  const r = (await tx.query<Prefs>('select reminders, promotions from public.notification_pref where user_id = app.user_id()')).rows[0];
  // The column defaults of 0602, read from the table rather than repeated here.
  return r ?? (await tx.query<Prefs>(
    `select (select column_default from information_schema.columns where table_schema = 'public' and table_name = 'notification_pref' and column_name = 'reminders')::boolean as reminders,
            (select column_default from information_schema.columns where table_schema = 'public' and table_name = 'notification_pref' and column_name = 'promotions')::boolean as promotions`)).rows[0]!;
};

export function notificationPrefRoutes(deps: NotificationPrefRouteDeps): Route<unknown>[] {
  return [
    route({ method: 'GET', path: '/me/notification-prefs', needsPerson: true }, async (ctx) =>
      deps.db.withClubTx(
        { clubId: ctx.clubId, userId: ctx.userId, roles: ctx.roles, source: 'player_app', ...(ctx.requestId ? { requestId: ctx.requestId } : {}) },
        (tx) => current(tx),
      )),
    route({ method: 'PUT', path: '/me/notification-prefs', needsPerson: true }, async (ctx) => {
      const change = readBody(ctx.body);
      return deps.db.withClubTx(
        { clubId: ctx.clubId, userId: ctx.userId, roles: ctx.roles, source: 'player_app', ...(ctx.requestId ? { requestId: ctx.requestId } : {}) },
        async (tx) => {
        const next = { ...(await current(tx)), ...change };
        return (await tx.query<Prefs>(
          `insert into public.notification_pref (club_id, user_id, reminders, promotions) values (app.club_id(), app.user_id(), $1, $2)
           on conflict (club_id, user_id) do update set reminders = excluded.reminders, promotions = excluded.promotions
           returning reminders, promotions`, [next.reminders, next.promotions])).rows[0]!;
        },
      );
    }),
  ];
}
