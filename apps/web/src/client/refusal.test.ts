import { describe, expect, it } from 'vitest';
import { REFUSAL_TEXT_KEYS, type BookingRefusal } from '@booq/domain/src/booking/refusal';
import { hasKey, translator } from './i18n';
import { backToGrid, refusalFrom, refusalInSearch, refusalMessage, refusalReturnPath } from './refusal';

// F03-T25: BOOK-01-AC15, BOOK-04-AC4, BOOK-05-AC8, D61. Each typed code shows its key in both languages.

const vars = (s: string) => [...s.matchAll(/\{([A-Za-z][A-Za-z0-9]*)\}/g)].map((m) => m[1]).sort();
const playerCodes = (Object.keys(REFUSAL_TEXT_KEYS) as BookingRefusal[]).filter((c) => REFUSAL_TEXT_KEYS[c].startsWith('P-'));
const full = { hours: 4, seconds: 30 };

describe('refusal text', () => {
  it('every player refusal has its key in both languages, with only the variables the answer carries', () => {
    for (const code of playerCodes) {
      const m = refusalMessage({ code, ...full }, { bookingWindowDays: 14 })!;
      expect(m, code).not.toBeNull();
      for (const lang of ['en', 'th'] as const) {
        expect(hasKey(lang, m.key), `${code} ${lang}`).toBe(true);
        const text = translator(lang)(m.key, m.vars);
        expect(text, `${code} ${lang}`).not.toMatch(/\{[A-Za-z]/);
      }
      expect(vars(translator('en')(m.key))).toEqual(Object.keys(m.vars).sort());
    }
  });

  it('BOOK-05-AC8: the limit message fills {hours}; too many attempts fills {seconds} (D61)', () => {
    expect(translator('en')(refusalMessage({ code: 'limit_reached', hours: 4 })!.key, { hours: 4 })).toContain('4 hours');
    expect(translator('th')(refusalMessage({ code: 'too_many_attempts', seconds: 30 })!.key, { seconds: 30 })).toContain('30');
    expect(refusalMessage({ code: 'limit_reached' })).toBeNull(); // never a raw {hours}
  });

  it('BOOK-04-AC4: a slot taken meanwhile says so and that nothing was charged; the coach clash has its own text', () => {
    const t = translator('en');
    expect(t(refusalMessage({ code: 'slot_unavailable' })!.key)).toMatch(/no longer available.*Nothing was booked or charged/);
    expect(refusalMessage({ code: 'slot_unavailable', by: 'coach' })!.key).toBe('P-new.slot_unavailable_coach');
  });
});

describe('reading a refusal', () => {
  it('takes only known codes and plain whole numbers', () => {
    expect(refusalFrom({ code: 'limit_reached', hours: 4 })).toEqual({ code: 'limit_reached', hours: 4 });
    expect(refusalFrom({ code: 'made_up' })).toBeNull();
    expect(refusalFrom({ code: 'limit_reached', hours: -1 })).toEqual({ code: 'limit_reached' });
    expect(refusalFrom({ code: 'limit_reached', hours: '4<b>' })).toEqual({ code: 'limit_reached' });
    expect(refusalFrom({ code: 'slot_unavailable', by: 'x' })).toEqual({ code: 'slot_unavailable' });
    expect(refusalFrom('slot_unavailable')).toBeNull();
  });

  it('BOOK-01-AC15: slot refusals go back to the grid on the same date, and the address carries them there', () => {
    const r = { code: 'slot_unavailable' as const, by: 'resource' as const };
    expect(backToGrid(r)).toBe(true);
    expect(backToGrid({ code: 'limit_reached' })).toBe(false);
    const path = refusalReturnPath('hunter', '2027-01-09', r);
    expect(path).toBe('/c/hunter/book?date=2027-01-09&refused=slot_unavailable&by=resource');
    expect(refusalInSearch(path.split('?')[1]!)).toEqual(r);
    expect(refusalInSearch('date=2027-01-09')).toBeNull();
  });
});
