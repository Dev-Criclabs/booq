import type { LineMessageObject } from '../sender/types';

// The Booking confirmed card style (board L-Msg-Confirmed), used by every message without its own board (D91).
// Layout only: every text arrives already resolved from locales/* by the builder; nothing here is user facing text.

export interface CardRow {
  label: string;
  /** One line per value, for example one per booked hour (BOOK-06). */
  values: string[];
}
export interface CardButton {
  label: string;
  uri: string;
}
export interface Card {
  /** The club's name in the message language (LINE-02-AC5: the club's own name). */
  clubName: string;
  title: string;
  subtitle?: string;
  body?: string;
  rows: CardRow[];
  buttons: CardButton[];
}

const MUTED = '#8A8F98';
const INK = '#14171C';
const ACCENT = '#1F6F4A';

export function renderCard(card: Card): LineMessageObject {
  const header: unknown[] = [
    { type: 'text', text: card.clubName, size: 'xs', color: MUTED },
    { type: 'text', text: card.title, size: 'lg', weight: 'bold', color: INK, wrap: true },
  ];
  if (card.subtitle) header.push({ type: 'text', text: card.subtitle, size: 'sm', color: ACCENT, wrap: true });
  const body: unknown[] = [];
  if (card.body) body.push({ type: 'text', text: card.body, size: 'sm', color: INK, wrap: true });
  for (const row of card.rows) {
    body.push({
      type: 'box',
      layout: 'horizontal',
      spacing: 'md',
      contents: [
        { type: 'text', text: row.label, size: 'sm', color: MUTED, flex: 2, wrap: true },
        { type: 'box', layout: 'vertical', flex: 5, contents: row.values.map((v) => ({ type: 'text', text: v, size: 'sm', color: INK, wrap: true, align: 'end' })) },
      ],
    });
  }
  const bubble: Record<string, unknown> = {
    type: 'bubble',
    header: { type: 'box', layout: 'vertical', spacing: 'xs', contents: header },
    body: { type: 'box', layout: 'vertical', spacing: 'md', contents: body.length > 0 ? body : [{ type: 'filler' }] },
  };
  if (card.buttons.length > 0) {
    bubble['footer'] = {
      type: 'box',
      layout: 'vertical',
      spacing: 'sm',
      contents: card.buttons.map((b, i) => ({
        type: 'button',
        style: i === 0 ? 'primary' : 'secondary',
        color: i === 0 ? ACCENT : undefined,
        height: 'sm',
        action: { type: 'uri', label: b.label, uri: b.uri },
      })),
    };
  }
  return { type: 'flex', altText: card.title, contents: bubble };
}
