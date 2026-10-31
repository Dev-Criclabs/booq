import { describe, expect, it } from 'vitest';
import type { LinkTarget, MessageLinks } from '../messages/builder';
import { clubPath, createDeepLinks, DeepLinkError, liffLink, playerPath, type PlayerPage } from './deep-link';

// F02 design 3.1, 6.3; AUTH-01-AC10, AC14; BOOK-02-AC1 to AC3; D6.
const LIFF_A = '2012300015-WIi1jtLB';
const LIFF_B = '2012300099-Bbbbbbbb';

describe('deep links (F02 design 3.1)', () => {
  it('a LIFF link carries the path below the club endpoint, so LINE opens /c/{slug}/... of that club', () => {
    expect(liffLink(LIFF_A, { page: 'book' })).toBe(`https://liff.line.me/${LIFF_A}/book`);
    expect(liffLink(LIFF_A, { page: 'booking', bookingId: 'b-123' })).toBe(`https://liff.line.me/${LIFF_A}/bookings/b-123`);
    expect(liffLink(LIFF_A, { page: 'calendar', bookingId: 'b-123' })).toBe(`https://liff.line.me/${LIFF_A}/bookings/b-123/calendar`);
    expect(liffLink(LIFF_A, { page: 'packages' })).toBe(`https://liff.line.me/${LIFF_A}/packages`);
    expect(liffLink(LIFF_A, { page: 'home' })).toBe(`https://liff.line.me/${LIFF_A}`);
  });

  it('the same pages inside the app are under the club path', () => {
    expect(clubPath('hunter', { page: 'book' })).toBe('/c/hunter/book');
    expect(clubPath('hunter', { page: 'home' })).toBe('/c/hunter');
    expect(clubPath('hunter', { page: 'refer' })).toBe('/c/hunter/refer');
    expect(() => clubPath('Hunter Club', { page: 'book' })).toThrow(DeepLinkError);
  });

  it('BOOK-02-AC1: the rich menu tiles each have their own page, and Book a court is C4', () => {
    const tiles: PlayerPage[] = [{ page: 'book' }, { page: 'solo_classes' }, { page: 'group_classes' }, { page: 'packages' }, { page: 'bookings' }, { page: 'refer' }];
    const paths = tiles.map(playerPath);
    expect(new Set(paths).size).toBe(6);
    expect(paths[0]).toBe('/book');
  });

  it('an offer carries its parameters as a sorted query of plain values', () => {
    expect(liffLink(LIFF_A, { page: 'offer', params: { offerId: 'o1', expires: 1700000000 } })).toBe(`https://liff.line.me/${LIFF_A}/offer?expires=1700000000&offerId=o1`);
    expect(playerPath({ page: 'offer', params: {} })).toBe('/offer');
    expect(() => playerPath({ page: 'offer', params: { offerId: { nested: 1 } } })).toThrow('deep_link_bad_param');
    expect(() => playerPath({ page: 'offer', params: { 'a&b': 'x' } })).toThrow('deep_link_bad_param');
  });

  it('an id cannot climb out of its path or add a query', () => {
    for (const bad of ['../admin', 'a/b', 'x?y=1', '', 'a b']) expect(() => playerPath({ page: 'booking', bookingId: bad })).toThrow('deep_link_bad_id');
    expect(() => liffLink('not a liff id', { page: 'book' })).toThrow('deep_link_bad_liff_id');
  });
});

describe('links port for the message builder (F10 LinkTarget)', () => {
  const links = createDeepLinks({ club: (id) => ({ A: { liffId: LIFF_A }, B: { liffId: LIFF_B }, C: { liffId: null } })[id] ?? null });

  it('AUTH-01-AC14, CC-1: each club gets its own LIFF app, so a link for club A never opens club B', () => {
    expect(links.link('A', { page: 'booking', bookingId: 'b1' })).toBe(`https://liff.line.me/${LIFF_A}/bookings/b1`);
    expect(links.link('B', { page: 'booking', bookingId: 'b1' })).toBe(`https://liff.line.me/${LIFF_B}/bookings/b1`);
  });

  it('a club with no LIFF app, or an unknown club, has no link (the button is left out)', () => {
    expect(links.link('C', { page: 'book' })).toBeNull();
    expect(links.link('Z', { page: 'book' })).toBeNull();
  });
});

// F10's message builder takes this port: a change on either side fails the type check.
describe('fits the F10 builder', () => {
  it('createDeepLinks is a MessageLinks for every LinkTarget', () => {
    const port: MessageLinks = createDeepLinks({ club: () => ({ liffId: LIFF_A }) });
    const targets: LinkTarget[] = [{ page: 'booking', bookingId: 'b1' }, { page: 'calendar', bookingId: 'b1' }, { page: 'book' }, { page: 'packages' }, { page: 'offer', params: { offerId: 'o1' } }];
    expect(targets.map((t) => port.link('A', t))).toEqual([
      `https://liff.line.me/${LIFF_A}/bookings/b1`,
      `https://liff.line.me/${LIFF_A}/bookings/b1/calendar`,
      `https://liff.line.me/${LIFF_A}/book`,
      `https://liff.line.me/${LIFF_A}/packages`,
      `https://liff.line.me/${LIFF_A}/offer?offerId=o1`,
    ]);
  });
});
