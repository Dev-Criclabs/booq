import { describe, expect, it } from 'vitest';
import { chooseLanguage, LANG_COOKIE, parseLangCookie, parsePreferredLanguage, serializeLangCookie } from './language';

// F02-T16 (AUTH-02-AC25 to AC27; design 6.7, assumption A-9).
describe('parsePreferredLanguage', () => {
  it.each([
    ['th', 'th'], ['th-TH', 'th'], ['TH_th', 'th'], ['en', 'en'], ['en-US', 'en'], ['en_GB', 'en'],
    ['ja', null], ['zh-TW', null], ['', null], [undefined, null], [42, null],
  ])('LINE or browser language %j -> %s', (raw, want) => expect(parsePreferredLanguage(raw)).toBe(want));
  it('reads an Accept-Language header by quality, ignoring other languages', () => {
    expect(parsePreferredLanguage('fr;q=0.9, th;q=0.8, en;q=0.5')).toBe('th');
    expect(parsePreferredLanguage('en-US,en;q=0.9,th;q=0.8')).toBe('en');
    expect(parsePreferredLanguage('ja,zh;q=0.8')).toBeNull();
    expect(parsePreferredLanguage('th;q=0, en;q=0.4')).toBe('en');
  });
});

describe('chooseLanguage', () => {
  it('a guest’s own choice wins, then the LINE or browser language, then the club default', () => {
    expect(chooseLanguage({ guestChoice: 'en', preferred: 'th-TH', clubDefault: 'th' })).toBe('en');
    expect(chooseLanguage({ guestChoice: null, preferred: 'th-TH', clubDefault: 'en' })).toBe('th');
    expect(chooseLanguage({ guestChoice: null, preferred: 'ja', clubDefault: 'en' })).toBe('en');
    expect(chooseLanguage({ guestChoice: null, preferred: undefined, clubDefault: 'th' })).toBe('th');
  });
  it('a bad club default falls back to Thai, the product’s first language', () => {
    expect(chooseLanguage({ guestChoice: null, preferred: 'fr', clubDefault: 'xx' })).toBe('th');
  });
});

describe('the lang cookie (functional, first party, no tracking)', () => {
  it('is Path=/, Secure, SameSite=Lax and readable by the page (the toggle reads it), with a lifetime given by the caller', () => {
    const c = serializeLangCookie('en', 3600);
    expect(c).toBe(`${LANG_COOKIE}=en; Path=/; Secure; SameSite=Lax; Max-Age=3600`);
    expect(c).not.toContain('HttpOnly');
  });
  it('only th and en can be written', () => {
    expect(() => serializeLangCookie('fr' as never, 10)).toThrow();
  });
  it('parses from a Cookie header among others, and ignores anything else', () => {
    expect(parseLangCookie(`a=1; ${LANG_COOKIE}=th; b=2`)).toBe('th');
    expect(parseLangCookie(`${LANG_COOKIE}=fr`)).toBeNull();
    expect(parseLangCookie(`x${LANG_COOKIE}=th`)).toBeNull();
    expect(parseLangCookie(undefined)).toBeNull();
  });
});
