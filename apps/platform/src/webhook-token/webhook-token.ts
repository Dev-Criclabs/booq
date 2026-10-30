import { hashInviteToken, newInviteToken } from '@booq/auth';
import type { PlatformDb } from '@booq/db';

// Webhook tokens for a club's LINE and Beam connections (F02 design 5.4, FA 6.5, decision D32, SR-16).
// The address LINE or Beam calls carries a long random token that picks the club; it authenticates nothing (the
// signature does). BOOQ staff make it here: the plain token and the full address are shown once, only the hash is stored,
// and making a new one replaces the old (the old address stops working). Admin only, a fresh second factor, a club that
// is Draft or Testing or inside the owner's window. Beam has a test set and a live set, each with its own token.

export type WebhookKind = 'line' | 'beam_test' | 'beam_live';
export type IssueResult =
  | { ok: true; token: string; url: string; replaced: boolean }
  | { ok: false; code: 'not_found' | 'forbidden' | 'step_up_required' | 'invalid' | 'look_only' };

const KINDS: Record<WebhookKind, { table: 'line_connection' | 'payment_connection'; column: string; path: string }> = {
  line: { table: 'line_connection', column: 'webhook_token_hash', path: '/api/webhooks/line/' },
  beam_test: { table: 'payment_connection', column: 'webhook_token_hash_test', path: '/api/webhooks/beam/' },
  beam_live: { table: 'payment_connection', column: 'webhook_token_hash_live', path: '/api/webhooks/beam/' },
};
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function createWebhookTokenService(deps: { db: PlatformDb; baseUrl: string }) {
  const { db } = deps;
  const base = deps.baseUrl.replace(/\/+$/, '');

  async function issue(actor: { staffId: string; stepUpFresh: boolean }, clubId: string, kind: unknown): Promise<IssueResult> {
    if (!UUID.test(actor.staffId)) return { ok: false, code: 'not_found' };
    const staff = await db.withPlatformTx({ staffId: null }, async (tx) => (await tx.query<{ id: string; display_name: string; role: string; active: boolean }>('select id, display_name, role, active from platform.staff_by_id($1)', [actor.staffId])).rows[0] ?? null);
    if (!staff || !staff.active) return { ok: false, code: 'not_found' };
    if (!UUID.test(clubId)) return { ok: false, code: 'not_found' };
    if (staff.role !== 'platform_admin') return { ok: false, code: 'forbidden' };
    if (typeof kind !== 'string' || !(kind in KINDS)) return { ok: false, code: 'invalid' };
    if (!actor.stepUpFresh) return { ok: false, code: 'step_up_required' };
    const k = KINDS[kind as WebhookKind];
    const token = newInviteToken();
    const hash = hashInviteToken(token);

    const outcome = await db.withPlatformTx({ staffId: staff.id, staffLabel: staff.display_name, clubId }, async (tx) => {
      if ((await tx.query('select 1 from public.club where id = $1', [clubId])).rows.length === 0) return 'not_found' as const;
      if ((await tx.query<{ ok: boolean }>('select platform.club_editable($1) as ok', [clubId])).rows[0]?.ok !== true) return 'look_only' as const;
      const had = (await tx.query<{ h: string | null }>(`select ${k.column} as h from public.${k.table} where club_id = $1`, [clubId])).rows[0]?.h != null;
      await tx.query(
        `insert into public.${k.table} (club_id, ${k.column}) values ($1, $2) on conflict (club_id) do update set ${k.column} = excluded.${k.column}`,
        [clubId, hash],
      );
      const detail = { connection: kind, replaced: had };
      await tx.query(`select platform.write_audit('club.webhook_token_issued', $1::uuid, 'club', $2::text, $3::jsonb, null, null)`, [clubId, clubId, JSON.stringify(detail)]);
      await tx.query(`select audit.note('support.webhook_token_issued', 'club', $1, $2::jsonb, null)`, [clubId, JSON.stringify({ connection: kind, replaced: had })]);
      return had;
    });
    if (outcome === 'not_found' || outcome === 'look_only') return { ok: false, code: outcome };
    return { ok: true, token, url: `${base}${k.path}${token}`, replaced: outcome };
  }

  return { issue };
}
