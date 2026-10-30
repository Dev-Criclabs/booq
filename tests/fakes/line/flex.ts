// Flex Message inspector (LINE-04, LINE-03). Pure functions over the JSON the app pushes.
// It never needs the app: it reads the captured payload.
import type { Lang } from '../locale';
import { containsThai, findKeyFor } from '../locale';
import type { LineMessageObject } from './types';

export interface FlexAction {
  type: string;
  label?: string;
  uri?: string;
  data?: string;
}

/** Walk any JSON and collect every string found under a key called "text" (Flex text components). */
export function collectTexts(node: unknown, out: string[] = []): string[] {
  if (Array.isArray(node)) {
    for (const n of node) collectTexts(n, out);
  } else if (node && typeof node === 'object') {
    for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
      if (k === 'text' && typeof v === 'string') out.push(v);
      else collectTexts(v, out);
    }
  }
  return out;
}

/** Collect every "action" object (buttons, bubbles, boxes that are tappable). */
export function collectActions(node: unknown, out: FlexAction[] = []): FlexAction[] {
  if (Array.isArray(node)) {
    for (const n of node) collectActions(n, out);
  } else if (node && typeof node === 'object') {
    for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
      if (k === 'action' && v && typeof v === 'object') out.push(v as FlexAction);
      collectActions(v, out);
    }
  }
  return out;
}

export function isFlex(m: LineMessageObject): boolean {
  return m.type === 'flex';
}

/** All visible text of a message, including altText (shown in notifications and chat lists). */
export function allText(m: LineMessageObject): string[] {
  const texts = collectTexts(m);
  if (typeof m['altText'] === 'string') texts.push(m['altText'] as string);
  if (m.type === 'text' && typeof m['text'] === 'string') texts.push(m['text'] as string);
  return texts;
}

/**
 * Which language is this push written in? Counts texts that match a locale key in one language only.
 * Falls back to script detection (any Thai letter = th) when no text matches a key yet (copy still draft).
 * 'mixed' means texts from both languages are in one push, which is a bug (LINE-03).
 */
export function detectLanguage(messages: LineMessageObject[]): Lang | 'mixed' | 'none' {
  const texts = messages.flatMap(allText).filter((s) => /[A-Za-z\u0E00-\u0E7F]/.test(s));
  if (texts.length === 0) return 'none';
  let th = 0;
  let en = 0;
  for (const s of texts) {
    const inTh = findKeyFor('th', s) !== undefined;
    const inEn = findKeyFor('en', s) !== undefined;
    if (inTh && !inEn) th++;
    else if (inEn && !inTh) en++;
  }
  if (th > 0 && en > 0) return 'mixed';
  if (th > 0) return 'th';
  if (en > 0) return 'en';
  return texts.some((s) => containsThai(s)) ? 'th' : 'en';
}

/** Patterns of text that is pure data and is allowed not to come from a locale key. */
export const DATA_TEXT_PATTERNS: RegExp[] = [
  /^[฿]?\s?[\d,]+(\.\d{2})?$/, // money 1,300 or ฿1,300
  /^[A-Z]{2,4}-\d{4}-\d{6}$/, // receipt number HTC-2027-000001
  /^\d{1,2}:\d{2}(\s?[-–]\s?\d{1,2}:\d{2})?$/, // 18:00 or 18:00 - 19:00
  /^https?:\/\//, // links
];

/**
 * TEXT-01 for LINE: every text in the message must come from a locale key in the given language
 * (or be pure data). Returns the texts that did not. Empty array = pass.
 */
export function textsNotFromLocale(m: LineMessageObject, lang: Lang, extraAllowed: RegExp[] = []): string[] {
  const allowed = [...DATA_TEXT_PATTERNS, ...extraAllowed];
  return allText(m).filter((s) => !allowed.some((re) => re.test(s.trim())) && findKeyFor(lang, s) === undefined);
}

// ---- LINE platform limits. VERIFY against current LINE documentation (30 Oct 2026 values). ----
export const FLEX_LIMITS = {
  maxMessagesPerPush: 5,
  maxAltTextLength: 400,
  maxFlexJsonBytes: 50 * 1024,
} as const;

export function validateFlexLimits(messages: LineMessageObject[]): string[] {
  const problems: string[] = [];
  if (messages.length === 0) problems.push('push has no messages');
  if (messages.length > FLEX_LIMITS.maxMessagesPerPush) problems.push(`more than ${FLEX_LIMITS.maxMessagesPerPush} messages in one push`);
  for (const m of messages.filter(isFlex)) {
    const alt = m['altText'];
    if (typeof alt !== 'string' || alt.length === 0) problems.push('flex message has no altText');
    else if (alt.length > FLEX_LIMITS.maxAltTextLength) problems.push('altText too long');
    if (Buffer.byteLength(JSON.stringify(m['contents'] ?? {}), 'utf8') > FLEX_LIMITS.maxFlexJsonBytes) problems.push('flex contents over size limit');
    const c = m['contents'] as { type?: string } | undefined;
    if (!c || (c.type !== 'bubble' && c.type !== 'carousel')) problems.push('flex contents must be a bubble or carousel');
  }
  return problems;
}

export interface ConfirmedCardExpectation {
  lang: Lang;
  liffId: string;
  /** Strings that must appear as visible text, for example court name, date, time, amount, coach name. */
  mustContain: string[];
  /** Receipt number, if a receipt is issued (Q-25 decides the credit only case). */
  receiptNumber?: string;
  /** Names of the two buttons as locale keys. Resolved in `lang`. Fill when the canvas keys are known. */
  viewBookingKey?: string;
  addToCalendarKey?: string;
}

/**
 * LINE-04: Booking confirmed card. Returns problems; empty array = the card matches the requirement.
 * It checks content and structure, not pixels (the pixel check against L-Msg-Confirmed is manual).
 */
export function checkConfirmedCard(messages: LineMessageObject[], exp: ConfirmedCardExpectation): string[] {
  const problems = validateFlexLimits(messages);
  const flex = messages.find(isFlex);
  if (!flex) return [...problems, 'no flex message in push'];
  const text = collectTexts(flex).join(' | ');
  for (const needle of exp.mustContain) if (!text.includes(needle)) problems.push(`card text is missing "${needle}"`);
  if (exp.receiptNumber && !text.includes(exp.receiptNumber)) problems.push('card is missing the receipt number');
  const actions = collectActions(flex);
  const uris = actions.filter((a) => a.type === 'uri' && a.uri);
  if (uris.length < 2) problems.push('card needs two uri buttons (View booking, Add to calendar)');
  const view = uris.find((a) => a.uri?.includes(`liff.line.me/${exp.liffId}`));
  if (!view) problems.push("View booking does not open the club's own LIFF app");
  const lang = detectLanguage(messages);
  if (lang !== exp.lang) problems.push(`card language is ${lang}, expected ${exp.lang}`);
  problems.push(...textsNotFromLocale(flex, exp.lang).map((s) => `text not from a locale key: "${s}"`));
  return problems;
}
