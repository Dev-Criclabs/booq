import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadMessageDictionary } from '../messages/dictionary';
import { RICH_MENU_IMAGE, layoutRichMenu } from './render';
import { RICH_MENU_DEFAULT_KEYS, RICH_MENU_PAGES, richMenuObject, resolveLabels } from './menu';

// F10-T12: the rich menu object LINE gets (F10 design 5.5; LINE-02-AC1 to AC3, D54, D92): six tap areas over the six
// tiles of the image, each opening its fixed page of the club's LIFF app (the links are fixed in code, never stored).
const LOCALES = resolve(__dirname, '../../../../locales');
const dict = { th: loadMessageDictionary('th', LOCALES), en: loadMessageDictionary('en', LOCALES) };
const LIFF = '2012300015-WIi1jtLB';
const labels = resolveLabels([], dict);

describe('the rich menu object (LINE-02-AC1, AC2)', () => {
  const menu = richMenuObject({ labels, liffId: LIFF, dictionary: dict });

  it('is full size, with six areas and six distinct links; tile 1 opens C4 (Book a court) directly', () => {
    expect(menu.size).toEqual({ width: RICH_MENU_IMAGE.width, height: RICH_MENU_IMAGE.height });
    expect(menu.areas.length).toBe(6);
    const uris = menu.areas.map((a) => a.action.uri);
    expect(new Set(uris).size).toBe(6);
    expect(uris[0]).toBe(`https://liff.line.me/${LIFF}/book`);
    expect(uris).toEqual(RICH_MENU_PAGES.map((p) => `https://liff.line.me/${LIFF}${{ book: '/book', solo_classes: '/classes/solo', group_classes: '/classes/group', packages: '/packages', bookings: '/bookings', refer: '/refer' }[p]}`));
    expect(menu.areas.every((a) => a.action.type === 'uri')).toBe(true);
  });

  it('each area covers its tile of the image exactly', () => {
    const tiles = layoutRichMenu(labels).tiles;
    expect(menu.areas.map((a) => a.bounds)).toEqual(tiles.map((t) => ({ x: t.x, y: t.y, width: t.width, height: t.height })));
  });

  it('the chat bar text comes from the language files, both languages, within LINE’s 14 characters (G1)', () => {
    expect(menu.chatBarText).toBe(`${dict.th['L-new.rich_menu_chat_bar']} ${dict.en['L-new.rich_menu_chat_bar']}`);
    expect(menu.chatBarText.length).toBeLessThanOrEqual(14);
  });

  it('a club with no LIFF app cannot have a menu: the links would go nowhere', () => {
    expect(() => richMenuObject({ labels, liffId: null, dictionary: dict })).toThrow(/rich_menu_no_liff/);
  });
});

describe('labels (LINE-02-AC4, AC6)', () => {
  it('an unset label takes the default key of its tile in each language; a set label is the owner’s', () => {
    const r = resolveLabels([{ tile: 4, label_th: 'แพ็กเกจของฉัน', label_en: null }], dict);
    expect(r.find((l) => l.tile === 4)).toEqual({ tile: 4, th: 'แพ็กเกจของฉัน', en: dict.en[RICH_MENU_DEFAULT_KEYS[4]!] });
    expect(r.find((l) => l.tile === 1)).toEqual({ tile: 1, th: dict.th['L-0001'], en: dict.en['L-0001'] });
    expect(r.map((l) => l.tile)).toEqual([1, 2, 3, 4, 5, 6]);
  });
});
