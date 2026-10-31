import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { hashInviteToken, route, RouteError, type Route } from '@booq/auth';
import type { ClubContext, Db, Tx } from '@booq/db';
import { keySetFor, type KeySet, type PaymentAlertKind, type PaymentGateway } from '@booq/domain';
import { readSecret } from '@booq/secrets';

// POST /api/webhooks/beam/{token} (F05-T08a to T08c; F05 design 5.3; FA 6.5; PAY-02-AC4 to AC15; D24, D32, D36,
// D71, D73, D75, D76). The token selects the club and the key set; it authenticates nothing.
//   1. The raw body is verified first: base64 HMAC-SHA256 under that set's key, compared in constant time. A bad or
//      missing signature answers 401, writes nothing and raises the P1 alert (D24). No event row is written for it,
//      since its dedupe key (charge, event) would block the real event of that charge later.
//   2. A callback on the key set that is not the club's active one (a test callback after Go live) is recorded
//      `ignored` and answered 200; nothing else changes (design 5.3).
//   3. A charge we do not know: recorded `unknown_charge`, P1 alert, 200 (D71).
//   A bad signature and an unknown charge also fail the beam_webhook check on the console health tile (0799); a
//   verified callback for a known charge sets it ok again. The rows carry codes only (PAY-02-AC14).
//   4. Decide from Beam's own record, never the body: GET /charges/{id}. Beam unreachable answers 500 so Beam
//      retries (D73). The amount, currency and reference must match the payment; a validly signed wrong amount is
//      flagged for the owner, recorded `mismatch`, 200, never confirmed (D36, D77).
//   5. A failed charge fails the payment and keeps the hold (D72). A succeeded charge goes to app.apply_payment; the event row and the outcome are one transaction, and a
//      duplicate (the same charge and event) leaves nothing changed and answers 200 (FA 6.5 step 4).
// Nothing personal is read or stored: the body is kept only as a hash (D76).

export interface BeamWebhookDeps {
  /** The web role, for the token lookup before any club is known. */
  db: Db;
  /** The worker role: apply_payment, the event log and the wrong amount flag run as the worker. */
  worker: Db;
  privateKey(): string;
  gateway(creds: { set: KeySet; merchantId: string; apiKey: string }): PaymentGateway;
  alerts: { p1(kind: PaymentAlertKind | 'beam_bad_signature' | 'beam_unknown_charge', clubId: string): void };
}

const NO_CLUB = { clubId: '00000000-0000-0000-0000-000000000000', userId: null, roles: ['guest'] } as const;
const MAX_TOKEN = 256;
const EVENTS = new Set(['charge.succeeded', 'charge.failed']);

class Duplicate extends Error {}

function signatureOk(keyBase64: string, rawBody: string, given: string | undefined): boolean {
  if (!given) return false;
  const want = createHmac('sha256', Buffer.from(keyBase64, 'base64')).update(rawBody).digest();
  const got = Buffer.from(given, 'base64');
  return got.length === want.length && timingSafeEqual(got, want);
}

interface Event {
  chargeId: string;
  eventType: string;
  bodyHash: string;
}

async function record(tx: Tx, e: Event, outcome: string, payment: string | null = null, lookedUp: object | null = null): Promise<void> {
  const r = await tx.query<{ id: string | null }>('select app.record_payment_event($1, $2, $3, true, $4, $5, $6::jsonb) as id', [
    e.chargeId, e.eventType, e.bodyHash, outcome, payment, lookedUp === null ? null : JSON.stringify(lookedUp),
  ]);
  if (r.rows[0]?.id === null || r.rows[0]?.id === undefined) throw new Duplicate();
}

export function beamWebhookRoute(deps: BeamWebhookDeps): Route<unknown> {
  return route({ method: 'POST', path: '/webhooks/beam/:token', public: true }, async (ctx) => {
    const token = (ctx.input as { token?: unknown } | null)?.token;
    if (typeof token !== 'string' || token === '' || token.length > MAX_TOKEN) throw new RouteError(404, 'not_found');
    const hit = (await deps.db.withClubTx(NO_CLUB, (tx) => tx.query<{ c: { club_id: string; key_set: KeySet; merchant_id: string | null } | null }>(
      'select app.club_by_beam_webhook($1) as c', [hashInviteToken(token)]))).rows[0]?.c;
    if (!hit) throw new RouteError(404, 'not_found');
    const clubId = hit.club_id;
    const set = hit.key_set;
    const wctx: ClubContext = { clubId, userId: null, roles: [], source: 'webhook', actorLabel: 'beam_webhook' };

    const raw = ctx.rawBody ?? '';
    const hmacKey = await deps.worker.withClubTx(wctx, (tx) =>
      readSecret(tx, deps.privateKey(), clubId, set === 'live' ? 'beam_hmac_key_live' : 'beam_hmac_key_test', 'worker'));
    if (!hmacKey || !signatureOk(hmacKey, raw, ctx.headers?.['x-beam-signature'])) {
      deps.alerts.p1('beam_bad_signature', clubId);
      await deps.worker.withClubTx(wctx, (tx) => tx.query(`select app.report_payment_health('beam_webhook', 'bad_signature')`));
      throw new RouteError(401, 'bad_signature');
    }

    let body: { chargeId?: unknown };
    try {
      body = JSON.parse(raw) as { chargeId?: unknown };
    } catch {
      throw new RouteError(400, 'bad_input');
    }
    const eventType = ctx.headers?.['x-beam-event'] ?? '';
    if (typeof body.chargeId !== 'string' || body.chargeId === '' || !EVENTS.has(eventType)) throw new RouteError(400, 'bad_input');
    const event: Event = { chargeId: body.chargeId, eventType, bodyHash: createHash('sha256').update(raw).digest('hex') };

    try {
      return await deps.worker.withClubTx(wctx, async (tx) => {
        const club = (await tx.query<{ status: string }>('select status from public.club where id = app.club_id()')).rows[0];
        if (!club || keySetFor(club.status) !== set) {
          await record(tx, event, 'ignored');
          return { outcome: 'ignored' };
        }
        const payment = (await tx.query<{ id: string; amount_satang: number; environment: KeySet }>(
          `select id, amount_satang, environment from public.payment
            where club_id = app.club_id() and gateway = 'beam' and gateway_charge_id = $1`,
          [event.chargeId],
        )).rows[0];
        if (!payment || payment.environment !== set) {
          await record(tx, event, 'unknown_charge');
          await tx.query(`select app.report_payment_health('beam_webhook', 'unknown_charge')`);
          return { outcome: 'unknown_charge', alert: true as const };
        }
        // A validly signed callback for a charge we know: the webhook check is ok again (0799).
        await tx.query(`select app.report_payment_health('beam_webhook', null)`);
        // F05-T08b: the lookup, the amount check and apply_payment.
        return decide(deps, tx, clubId, set, hit.merchant_id, event, payment);
      }).then((r) => {
        if ((r as { alert?: boolean }).alert) deps.alerts.p1('beam_unknown_charge', clubId);
        return { outcome: (r as { outcome: string }).outcome };
      });
    } catch (e) {
      if (e instanceof Duplicate) return { outcome: 'duplicate' };
      throw e;
    }
  });
}

async function decide(
  deps: BeamWebhookDeps,
  tx: Tx,
  clubId: string,
  set: KeySet,
  merchantId: string | null,
  event: Event,
  payment: { id: string; amount_satang: number },
): Promise<{ outcome: string }> {
  const apiKey = await readSecret(tx, deps.privateKey(), clubId, set === 'live' ? 'beam_api_key_live' : 'beam_api_key_test', 'worker');
  if (merchantId === null || apiKey === null) return lookupFailed(deps, clubId, 'beam_keys_missing', 'beam_keys', 'keys_missing');
  let looked;
  try {
    looked = await deps.gateway({ set, merchantId, apiKey }).getCharge(event.chargeId);
  } catch (e) {
    return (e as { kind?: string }).kind === 'unauthorized'
      ? lookupFailed(deps, clubId, 'beam_key_check_failed', 'beam_keys', 'key_refused')
      : lookupFailed(deps, clubId, 'beam_unreachable', 'beam_charge', 'unreachable');
  }
  const seen = { status: looked.status, amount_satang: looked.amountSatang, reference: looked.referenceId };
  if (looked.status === 'FAILED') {
    // A failed charge inside the hold (D72): the payment fails and the hold keeps running, so a second tap makes
    // a new payment and a new charge in the same hold.
    await tx.query('select app.fail_payment($1, $2)', [payment.id, 'beam_failed']);
    await record(tx, event, 'failed', payment.id, seen);
    return { outcome: 'failed' };
  }
  if (looked.status !== 'SUCCEEDED') {
    await record(tx, event, 'ignored', payment.id, seen);
    return { outcome: 'ignored' };
  }
  if (looked.currency !== 'THB' || looked.referenceId !== payment.id || looked.amountSatang !== payment.amount_satang) {
    if (looked.referenceId === payment.id && looked.currency === 'THB' && looked.amountSatang > 0) {
      await tx.query('select app.flag_wrong_amount($1, $2)', [payment.id, looked.amountSatang]);
    }
    await record(tx, event, 'mismatch', payment.id, seen);
    return { outcome: 'mismatch' };
  }
  const applied = (await tx.query<{ r: { outcome: string } }>('select app.apply_payment($1, $2) as r', [payment.id, looked.amountSatang])).rows[0]!.r;
  await record(tx, event, applied.outcome, payment.id, seen);
  return { outcome: applied.outcome };
}

/** The lookup could not be made: the P1 alert, the failed check on the health tile in its own worker transaction (the
 *  callback's own one is rolled back), and 500 so Beam retries (up to 10 times, stated; D73). */
async function lookupFailed(deps: BeamWebhookDeps, clubId: string, alert: PaymentAlertKind, check: 'beam_keys' | 'beam_charge', reason: string): Promise<never> {
  deps.alerts.p1(alert, clubId);
  await deps.worker.withClubTx({ clubId, userId: null, roles: [], source: 'webhook', actorLabel: 'beam_webhook' }, (tx) =>
    tx.query('select app.report_payment_health($1, $2)', [check, reason]));
  throw new RouteError(500, 'lookup_failed');
}
