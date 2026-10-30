import { createHmac, timingSafeEqual } from 'node:crypto';
import { hashInviteToken, route, RouteError, type Route } from '@booq/auth';
import type { Db } from '@booq/db';
import { readSecret } from '@booq/secrets';

// POST /api/webhooks/line/{token} (F02-T17; LINE-01-AC7, AC8, AC14; F02 design 5.4; FA 5.3; D149).
// 1. The token in the path selects the club (a hash lookup before any club is known). It authenticates nothing.
// 2. The call is believed only if `x-line-signature` is the base64 HMAC-SHA256 of the exact raw body under that club's
//    channel secret, which the web role may read (D149). A bad or missing signature is 401 and nothing is read or changed.
// 3. `follow` and `unfollow` from a user set `app_user.line_friend` for that club's person with that LINE id; every other
//    event is ignored (F10 extends this route). A person who has not signed in yet has no row, so nothing happens.
// The friend state never blocks booking or payment.

export interface LineWebhookDeps {
  db: Db;
  /** The decryption key, read when a call arrives (the loader is in @booq/secrets). */
  privateKey(): string;
}

const NO_CLUB = { clubId: '00000000-0000-0000-0000-000000000000', userId: null, roles: ['guest'] } as const;
const MAX_TOKEN = 256;

function signatureOk(secret: string, rawBody: string, given: string | undefined): boolean {
  if (!given) return false;
  const want = createHmac('sha256', secret).update(rawBody).digest();
  const got = Buffer.from(given, 'base64');
  return got.length === want.length && timingSafeEqual(got, want);
}

export function lineWebhookRoute(deps: LineWebhookDeps): Route<unknown> {
  return route({ method: 'POST', path: '/webhooks/line/:token', public: true }, async (ctx) => {
    const token = (ctx.input as { token?: unknown } | null)?.token;
    if (typeof token !== 'string' || token === '' || token.length > MAX_TOKEN) throw new RouteError(404, 'not_found');
    const clubId = (await deps.db.withClubTx(NO_CLUB, (tx) => tx.query('select app.club_by_line_webhook($1) as c', [hashInviteToken(token)]))).rows[0]?.c as string | null | undefined;
    if (!clubId) throw new RouteError(404, 'not_found');

    const secret = await deps.db.withClubTx({ clubId, userId: null, roles: [], source: 'webhook', actorLabel: 'line_webhook' }, (tx) =>
      readSecret(tx, deps.privateKey(), clubId, 'line_channel_secret'));
    const raw = ctx.rawBody ?? '';
    if (!secret || !signatureOk(secret, raw, ctx.headers?.['x-line-signature'])) throw new RouteError(401, 'bad_signature');

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new RouteError(400, 'bad_input');
    }
    const list = (parsed as { events?: unknown } | null)?.events;
    if (!Array.isArray(list)) throw new RouteError(400, 'bad_input');

    const changes: Array<{ userId: string; friend: boolean }> = [];
    for (const e of list) {
      const ev = e as { type?: unknown; source?: { type?: unknown; userId?: unknown } } | null;
      if (!ev || typeof ev !== 'object') continue;
      if (ev.type !== 'follow' && ev.type !== 'unfollow') continue;
      if (ev.source?.type !== 'user' || typeof ev.source.userId !== 'string' || ev.source.userId === '') continue;
      changes.push({ userId: ev.source.userId, friend: ev.type === 'follow' });
    }
    if (changes.length > 0) {
      await deps.db.withClubTx({ clubId, userId: null, roles: [], source: 'webhook', actorLabel: 'line_webhook' }, async (tx) => {
        for (const c of changes) await tx.query('select app.set_line_friend($1, $2)', [c.userId, c.friend]);
      });
    }
    return {};
  });
}
