// The two seams of the outbox sender (F10 design 5.2). The sender decides what to send; a MessageBuilder turns a
// kind, its params and a language into LINE message objects from locales/* (F10-T10, no text in code); a
// LineTransport pushes them with the club's own token and the row's retry key (F10-T09). Tests use the fake LINE.

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
}

export interface MessageBuilder {
  build(message: OutgoingMessage): LineMessageObject[] | Promise<LineMessageObject[]>;
}

export interface PushInput {
  clubId: string;
  /** The recipient's LINE user id at this club. */
  to: string;
  messages: LineMessageObject[];
  /** X-Line-Retry-Key: stable per outbox row, so a retry after a timeout cannot double send (FA 5.3). */
  retryKey: string;
}

/** ok, or the failure as an HTTP status and a short code (never a message body). */
export type PushResult = { ok: true } | { ok: false; status: number; code: string };

export interface LineTransport {
  push(input: PushInput): Promise<PushResult>;
}
