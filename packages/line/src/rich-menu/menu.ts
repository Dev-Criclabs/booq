import { liffLink, type PlayerPage } from '../links/deep-link';
import type { Dictionary } from '../messages/builder';
import type { MessageLanguage } from '../sender/types';
import { RICH_MENU_IMAGE, RichMenuLayoutError, layoutRichMenu, type RichMenuLabel } from './render';

// The rich menu object LINE gets (F10-T12; F10 design 5.5; LINE-02-AC1 to AC4, D54): six tap areas over the six tiles of
// the image, each opening its fixed page of the club's own LIFF app through F02's deep link helper. The pages are fixed
// here and never stored (D54); the owner changes only the labels (D114).

/** The page of each tile, 1 to 6 (LINE-02-AC1): Book a court (C4), Solo classes, Group classes, Packages, My bookings,
 *  Refer a friend. */
export const RICH_MENU_PAGES = ['book', 'solo_classes', 'group_classes', 'packages', 'bookings', 'refer'] as const satisfies readonly PlayerPage['page'][];

/** The label key of each tile when the owner has set none. The six keys of D54 replace these when Content merges them
 *  (Gaps A6: the Thai terms คลาสเดี่ยว and คลาสกลุ่ม, F10-T20). */
export const RICH_MENU_DEFAULT_KEYS: Readonly<Record<number, string>> = { 1: 'L-0001', 2: 'L-0002', 3: 'L-0003', 4: 'L-0004', 5: 'L-0005', 6: 'L-0006' };

export interface StoredLabel {
  tile: number;
  label_th: string | null;
  label_en: string | null;
}

/** The six labels to draw: the owner's where set, else the default key of the tile in each language. */
export function resolveLabels(rows: readonly StoredLabel[], dictionary: Record<MessageLanguage, Dictionary>): RichMenuLabel[] {
  return [1, 2, 3, 4, 5, 6].map((tile) => {
    const row = rows.find((r) => r.tile === tile);
    const key = RICH_MENU_DEFAULT_KEYS[tile]!;
    const th = row?.label_th ?? dictionary.th[key];
    const en = row?.label_en ?? dictionary.en[key];
    if (th === undefined || en === undefined) throw new RichMenuLayoutError(`rich_menu_default_missing:${tile}`);
    return { tile, th, en };
  });
}

export interface RichMenuArea {
  bounds: { x: number; y: number; width: number; height: number };
  action: { type: 'uri'; uri: string };
}
export interface RichMenuObject {
  size: { width: number; height: number };
  selected: boolean;
  /** LINE's own name for the menu, never shown to players. */
  name: string;
  /** The text on the chat bar that opens the menu: both languages, one menu for everyone (D92). */
  chatBarText: string;
  areas: RichMenuArea[];
}

export function richMenuObject(input: { labels: readonly RichMenuLabel[]; liffId: string | null; dictionary: Record<MessageLanguage, Dictionary>; name?: string }): RichMenuObject {
  if (!input.liffId) throw new RichMenuLayoutError('rich_menu_no_liff');
  const { tiles } = layoutRichMenu(input.labels);
  const bar = (lang: MessageLanguage) => {
    const v = input.dictionary[lang]['L-new.rich_menu_chat_bar'];
    if (v === undefined) throw new RichMenuLayoutError('rich_menu_chat_bar_missing');
    return v;
  };
  const liffId = input.liffId;
  return {
    size: { width: RICH_MENU_IMAGE.width, height: RICH_MENU_IMAGE.height },
    selected: true,
    name: input.name ?? 'booq',
    chatBarText: `${bar('th')} ${bar('en')}`,
    areas: tiles.map((t, i) => ({
      bounds: { x: t.x, y: t.y, width: t.width, height: t.height },
      action: { type: 'uri', uri: liffLink(liffId, { page: RICH_MENU_PAGES[i]! } as PlayerPage) },
    })),
  };
}
