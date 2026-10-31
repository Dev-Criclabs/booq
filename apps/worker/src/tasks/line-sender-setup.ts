import type { Db } from '@booq/db';
import { createDeepLinks, type LinkClub } from '@booq/line';
import { createLineHttpTransport, createMessageBuilder, loadMessageDictionary } from '@booq/line/server';
import { readSecret } from '@booq/secrets';
import { runOutboxSender, type OutboxSenderDeps, type OutboxSenderResult } from './line-outbox-sender';

// The real outbox sender for main.ts (F10-T08 to T10): the message dictionary (locales/* and pending, D81), the builder
// with F02's deep links (the club's LIFF id, loaded once per club per tick through app.club_liff_id), the Messaging API
// transport and the club's token, decrypted with the worker's private key (club_secret, read by the worker only, D149).
// Every value comes from the worker's config; nothing has a default.

export interface LineSenderSettings {
  lineApiBaseUrl: string;
  linePushTimeoutMs: number;
  /** The folder holding en.json, th.json and pending/. */
  localesDir: string;
  /** The PEM private key that opens club secrets (loadDecryptKey from @booq/secrets). */
  privateKey: string;
}

export function createLineSender(db: Db, settings: LineSenderSettings): { deps: OutboxSenderDeps; run(): Promise<OutboxSenderResult> } {
  const dictionary = { th: loadMessageDictionary('th', settings.localesDir), en: loadMessageDictionary('en', settings.localesDir) };
  const clubs = new Map<string, LinkClub>();
  const links = createDeepLinks({ club: (clubId) => clubs.get(clubId) ?? null });
  const deps: OutboxSenderDeps = {
    builder: createMessageBuilder({ dictionary: (language) => dictionary[language], links }),
    transport: createLineHttpTransport({ baseUrl: settings.lineApiBaseUrl, timeoutMs: settings.linePushTimeoutMs }),
    readToken: (tx, clubId) => readSecret(tx, settings.privateKey, clubId, 'line_channel_token', 'worker'),
    prepareClub: async (tx, clubId) => {
      const liffId = (await tx.query<{ l: string | null }>('select app.club_liff_id() as l')).rows[0]?.l ?? null;
      clubs.set(clubId, { liffId });
    },
  };
  return { deps, run: () => runOutboxSender(db, deps) };
}
