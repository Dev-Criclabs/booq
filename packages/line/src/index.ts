// @booq/line, browser safe: the player app imports this in the browser (next dev bundles it), so nothing here may pull a
// node: module or a native package. Server only parts (the message dictionary, the sender's transport and builder, the
// rich menu renderer, the LINE probe) are in '@booq/line/server' (server.ts); index-boundary.test.ts keeps them apart.
export const packageName = '@booq/line';
export { createLiffClient, type LiffClientOptions, type LiffLike, type SessionOutcome } from './liff/client';
export type { LineMessageObject, LineTransport, MessageBuilder, MessageLanguage, OutgoingMessage, PushInput, PushOutcome, PushResult } from './sender/types';
export type { Dictionary, LinkTarget, MessageBuilderOptions, MessageLinks } from './messages/builder';
export type { MessageFacts, MessageHour } from './messages/facts';
export type { RenderedRichMenu, RichMenuLabel, RichMenuLabels } from './rich-menu/render';
export type { LineProbeCheck, LineProbeKey, LineProbeOptions, LineProbeResult, LineSetup } from './probe/probe';
export { clubPath, createDeepLinks, DeepLinkError, liffLink, playerPath, type LinkClub, type PlayerPage } from './links/deep-link';
