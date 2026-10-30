import type { Db } from '@booq/db';
import type { LineTransport, MessageBuilder, MessageLanguage } from '@booq/line';
import { recordTaskRun } from '../heartbeat';

// outbox_sender (F10-T08, steps 1 to 4 of F10 design 5.2; FA 5.3). Runs every 30 seconds. One tick:
//  1. lists the clubs with due pending messages (app.due_message_clubs, Testing clubs included, D32);
//  2. for each club, in that club's context, claims due rows with FOR UPDATE SKIP LOCKED, so two sender processes
//     never take the same row; each row's lock is held until its result is written;
//  3. app.prepare_message_send applies the send time preconditions and the cap gate (void or undeliverable with
//     the reason) or returns the recipient's LINE id and the language read now (D93);
//  4. the builder makes the message from locales/* in that language and the transport pushes it with the club's
//     token and the row's retry key; success marks the row sent.
// The full result handling (429, token failure and backoff, other errors, the usage count) is F10-T09.
export const OUTBOX_SENDER = 'outbox_sender';

const SYSTEM_CONTEXT = { clubId: '00000000-0000-0000-0000-000000000000', userId: null, roles: [] } as const;
const DEFAULT_CLUBS = 100;
const DEFAULT_BATCH = 50;

export interface OutboxSenderDeps {
  builder: MessageBuilder;
  transport: LineTransport;
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
        for (const { id } of due.rows) {
          const prepared = (await tx.query<{ p: Prepared }>('select app.prepare_message_send($1) as p', [id])).rows[0]?.p;
          if (!prepared || prepared.action === 'skip') continue;
          if (prepared.action === 'void') { result.voided += 1; continue; }
          if (prepared.action === 'undeliverable') { result.undeliverable += 1; continue; }
          const messages = await deps.builder.build({ clubId, messageId: id, kind: prepared.kind, params: prepared.params, language: prepared.language });
          const pushed = await deps.transport.push({ clubId, to: prepared.to, messages, retryKey: prepared.retry_key });
          if (pushed.ok) {
            await tx.query(`update public.message_outbox set status = 'sent', sent_at = app.now(), attempts = attempts + 1 where id = $1`, [id]);
            result.sent += 1;
          } else {
            await tx.query(`update public.message_outbox set attempts = attempts + 1, last_error = $2 where id = $1`, [id, pushed.code]);
            result.failed += 1;
          }
        }
      });
    }
    return result;
  });
}
