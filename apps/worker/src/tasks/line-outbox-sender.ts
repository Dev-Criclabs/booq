import type { Db, Tx } from '@booq/db';
import type { LineTransport, MessageBuilder, MessageFacts, MessageLanguage, PushResult } from '@booq/line';
import { recordTaskRun } from '../heartbeat';

// outbox_sender (F10-T08 and T09, steps 1 to 7 of F10 design 5.2; FA 5.3). Runs every 30 seconds. One tick:
//  1. lists the clubs with due pending messages (app.due_message_clubs, Testing clubs included, D32);
//  2. for each club, in that club's context, claims due rows with FOR UPDATE SKIP LOCKED, so two sender processes
//     never take the same row; each row's lock is held until its result is written;
//  3. app.prepare_message_send applies the send time preconditions and the cap gate (void or undeliverable with
//     the reason) or returns the recipient's LINE id and the language read now (D93);
//  4. app.message_facts reads the names, hours and amounts the ids in params lead to (never stored, CC-3); the builder
//     (F10-T10) makes the card from locales/* in that language and the transport pushes it with the club's
//     token (club_secret, read by the worker only) and the row's retry key (F10-T09);
//  5. app.record_send_result writes what the push did: sent (and the usage counts), a 429 monthly limit
//     (undeliverable), a token failure (club_health, then retried), a retry (the same retry key next time, after the
//     configured wait) or a failure. A non friend is pushed anyway: LINE answers 200 and does not deliver (D9).
export const OUTBOX_SENDER = 'outbox_sender';

const SYSTEM_CONTEXT = { clubId: '00000000-0000-0000-0000-000000000000', userId: null, roles: [] } as const;
const DEFAULT_CLUBS = 100;
const DEFAULT_BATCH = 50;

export interface OutboxSenderDeps {
  builder: MessageBuilder;
  transport: LineTransport;
  /** The club's decrypted channel access token, read in the club's transaction; null when none is configured. */
  readToken(tx: Tx, clubId: string): Promise<string | null>;
  /** Clubs per tick. */
  clubs?: number;
  /** Rows per club per tick. */
  batch?: number;
}

export interface OutboxSenderResult {
  clubs: number;
  sent: number;
  voided: number;
  undeliverable: number;
  /** Pushes that did not go: left pending for a retry, or failed. */
  failed: number;
}

type Prepared =
  | { action: 'skip' }
  | { action: 'void'; reason: string }
  | { action: 'undeliverable'; error: string }
  | { action: 'send'; to: string; language: MessageLanguage; kind: string; params: Record<string, unknown>; retry_key: string };

/** `db` must connect as booq_worker. */
export async function runOutboxSender(db: Db, deps: OutboxSenderDeps): Promise<OutboxSenderResult> {
  return recordTaskRun(db, OUTBOX_SENDER, async () => {
    const clubs = (await db.withClubTx(SYSTEM_CONTEXT, (tx) =>
      tx.query<{ id: string }>('select id from app.due_message_clubs($1) as t(id)', [deps.clubs ?? DEFAULT_CLUBS]))).rows.map((r) => r.id);
    const result: OutboxSenderResult = { clubs: clubs.length, sent: 0, voided: 0, undeliverable: 0, failed: 0 };
    for (const clubId of clubs) {
      await db.withClubTx({ clubId, userId: null, roles: [], source: 'job', actorLabel: OUTBOX_SENDER }, async (tx) => {
        const due = await tx.query<{ id: string }>(
          `select id from public.message_outbox where status = 'pending' and send_at <= app.now()
            order by send_at, id limit $1 for update skip locked`, [deps.batch ?? DEFAULT_BATCH]);
        let token: string | null | undefined;
        for (const { id } of due.rows) {
          const prepared = (await tx.query<{ p: Prepared }>('select app.prepare_message_send($1) as p', [id])).rows[0]?.p;
          if (!prepared || prepared.action === 'skip') continue;
          if (prepared.action === 'void') { result.voided += 1; continue; }
          if (prepared.action === 'undeliverable') { result.undeliverable += 1; continue; }
          if (token === undefined) token = await deps.readToken(tx, clubId);
          const pushed: PushResult = token === null
            ? { ok: false, outcome: 'token', status: 0, code: 'no_token' }
            : await deps.transport.push({
                clubId,
                channelAccessToken: token,
                to: prepared.to,
                messages: await deps.builder.build({
                  clubId, messageId: id, kind: prepared.kind, params: prepared.params, language: prepared.language,
                  facts: (await tx.query<{ f: MessageFacts }>('select app.message_facts($1) as f', [id])).rows[0]!.f,
                }),
                retryKey: prepared.retry_key,
              });
          const status = (await tx.query<{ s: string }>('select app.record_send_result($1, $2, $3) as s',
            [id, pushed.ok ? 'sent' : pushed.outcome, pushed.ok ? null : pushed.code])).rows[0]?.s;
          if (status === 'sent') result.sent += 1;
          else if (status === 'undeliverable') result.undeliverable += 1;
          else result.failed += 1;
        }
      });
    }
    return result;
  });
}
