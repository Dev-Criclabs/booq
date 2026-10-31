import { describe, expect, it, vi } from 'vitest';
import { addFriendUrl, checkFriendship, markAsked, shouldAsk } from './friend';
import { bangkokHour, formatDateLong, greetingKey } from './home';
import { whoAmI } from './person';

// F02-T22: AUTH-01-AC8, AC9; LINE-01-AC8, AC9 (A-7); CC-6.

describe('Home header on the Bangkok clock', () => {
  it('greets by the Bangkok hour, whatever the device zone', () => {
    expect(bangkokHour(new Date('2027-01-09T01:30:00Z'))).toBe(8);
    expect(greetingKey(new Date('2027-01-09T01:30:00Z'))).toBe('P-new.greeting_morning');
    expect(greetingKey(new Date('2027-01-09T06:00:00Z'))).toBe('P-new.greeting_afternoon');
    expect(greetingKey(new Date('2027-01-09T11:00:00Z'))).toBe('P-0448');
    expect(greetingKey(new Date('2027-01-08T20:00:00Z'))).toBe('P-0448'); // 03:00 in Bangkok
  });
  it('{dateLong} is the Bangkok date in each language, Gregorian', () => {
    const late = new Date('2027-01-08T18:30:00Z'); // 01:30 on Saturday 9 January in Bangkok
    expect(formatDateLong('en', late)).toBe('Saturday 9 January');
    expect(formatDateLong('th', late)).toBe('วันเสาร์ที่ 9 มกราคม');
  });
});

describe('the add-the-account ask (LINE-01-AC8, AC9; A-7)', () => {
  const store = () => {
    const m = new Map<string, string>();
    return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) };
  };
  it('asks a known non-friend once per session and club, never a friend or an unknown', () => {
    const s = store();
    expect(shouldAsk(true, s, 'hunter')).toBe(false);
    expect(shouldAsk(null, s, 'hunter')).toBe(false);
    expect(shouldAsk(false, s, 'hunter')).toBe(true);
    markAsked(s, 'hunter');
    expect(shouldAsk(false, s, 'hunter')).toBe(false);
    expect(shouldAsk(false, s, 'other')).toBe(true);
  });
  it('reads the friend state from LINE and reports it; LINE failing means no ask', async () => {
    const f = vi.fn(async () => new Response('{}')) as unknown as typeof fetch;
    expect(await checkFriendship({ getFriendship: async () => ({ friendFlag: false }) }, 'hunter', f)).toBe(false);
    const [url, init] = (f as unknown as { mock: { calls: [string, RequestInit][] } }).mock.calls[0]!;
    expect([url, init.method, init.body]).toEqual(['/api/c/hunter/me/line-friend', 'POST', JSON.stringify({ friendFlag: false })]);
    expect(await checkFriendship({ getFriendship: async () => Promise.reject(new Error('x')) }, 'hunter', f)).toBeNull();
  });
  it('the add-friend link is LINE\'s own address for a basic id, else none', () => {
    expect(addFriendUrl('@hunter')).toBe('https://line.me/R/ti/p/%40hunter');
    expect(addFriendUrl(null)).toBeNull();
    expect(addFriendUrl('javascript:alert(1)')).toBeNull();
  });
});

describe('who is on a person page (AUTH-01-AC9)', () => {
  it('the server decides: 401 is a guest, 200 a person', async () => {
    expect(await whoAmI('hunter', (async () => new Response('{}', { status: 401 })) as unknown as typeof fetch)).toEqual({ kind: 'guest' });
    expect(await whoAmI('hunter', (async () => new Response('{}', { status: 200 })) as unknown as typeof fetch)).toEqual({ kind: 'person' });
    expect(await whoAmI('hunter', (async () => Promise.reject(new TypeError('net'))) as unknown as typeof fetch)).toEqual({ kind: 'error' });
  });
});
