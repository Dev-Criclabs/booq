import { describe, expect, it } from 'vitest';
import { safeReturnPath } from './return-path';

// F02-T11 (AUTH-01-AC2, AC5): after LINE Login the player lands on the same path with the same choice.
describe('safeReturnPath', () => {
  it('keeps a slot, a package and a multi-hour list in the query', () => {
    expect(safeReturnPath('hunter', '/c/hunter/book/checkout?slot=2026-12-07T10:00&court=2')).toBe('/c/hunter/book/checkout?slot=2026-12-07T10:00&court=2');
    expect(safeReturnPath('hunter', '/c/hunter/packages/p1/checkout?package=p1')).toBe('/c/hunter/packages/p1/checkout?package=p1');
    expect(safeReturnPath('hunter', '/c/hunter/book/checkout?slots=a,b,c&court=1')).toBe('/c/hunter/book/checkout?slots=a,b,c&court=1');
  });
  it('a path of another club is not followed (a link for club A never signs in at club B)', () => {
    expect(safeReturnPath('hunter', '/c/other/book')).toBeNull();
    expect(safeReturnPath('hunter', '/c/hunterx/book')).toBeNull();
  });
  it.each(['https://evil.example/c/hunter/x', '//evil.example/c/hunter/x', '/c/hunter//evil', '/c/hunter/../other', '/c/hunter\\x', 'c/hunter/x', '/c/hunter/x\r\nSet-Cookie: a=b', 'javascript:alert(1)'])(
    'refuses %j',
    (raw) => expect(safeReturnPath('hunter', raw)).toBeNull(),
  );
  it('falls back to the club home when there is nothing to return to', () => {
    expect(safeReturnPath('hunter', undefined)).toBe('/c/hunter');
    expect(safeReturnPath('hunter', '')).toBe('/c/hunter');
    expect(safeReturnPath('hunter', 5)).toBe('/c/hunter');
  });
  it('a path that is too long is refused', () => {
    expect(safeReturnPath('hunter', `/c/hunter/x?${'a'.repeat(3000)}`)).toBeNull();
  });
});
