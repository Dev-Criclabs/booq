// The two seams of the outbox sender (F10 design 5.2). The sender decides what to send; a MessageBuilder turns a
// kind, its params and a language into LINE message objects from locales/* (F10-T10, no text in code); a
// LineTransport pushes them with the club's own token and the row's retry key (F10-T09, http-transport.ts).
// Tests use the fake LINE.

import type { MessageFacts } from '../messages/facts';

export type MessageLanguage = 'th' | 'en';

/** A LINE message object (text or Flex), as the Messaging API push takes it. */
export interface LineMessageObject {
  type: string;
  [key: string]: unknown;
}

export interface OutgoingMessage {
  clubId: string;
  messageId: string;
  kind: string;
  /** Ids and values only (CC-3); names and texts are looked up by the builder. */
  params: Record<string, unknown>;
  /** Read at send time (D93). */
  language: MessageLanguage;
  /** Names, times and amounts looked up at send time from the ids in params (app.message_facts). */
  facts: MessageFacts;
}

export interface MessageBuilder {
  build(message: OutgoingMessage): LineMessageObject[] | Promise<LineMessageObject[]>;
}

export interface PushInput {
  clubId: string;
  /** The club's own channel access token (club_secret, read by the worker only, D149). */
  channelAccessToken: string;
  /** The recipient's LINE user id at this club. */
  to: string;
  messages: LineMessageObject[];
  /** X-Line-Retry-Key: stable per outbox row, so a retry after a timeout cannot double send (FA 5.3). */
  retryKey: string;
}

/**
 * What the sender does with a failed push (F10 design 5.2 step 6):
 *   retry          a timeout, a network error, a 5xx or a rate limit: try again later with the same retry key
 *   token          the token was refused (401 class): club_health and the owner banner, then retry with backoff
 *   cap            the monthly limit is reached (429 "monthly limit"): undeliverable, never retried (FA 5.6 step 4)
 *   failed         any other refusal: the row is failed
 */
export type PushOutcome = 'retry' | 'token' | 'cap' | 'failed';

/** ok, or the failure as an outcome, the HTTP status (0 when none came back) and a short code (never a message body). */
export type PushResult = { ok: true } | { ok: false; outcome: PushOutcome; status: number; code: string };

export interface LineTransport {
  push(input: PushInput): Promise<PushResult>;
}
