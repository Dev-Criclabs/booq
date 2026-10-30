import { describe, expect, it } from 'vitest';
import { REFUSAL_TEXT_KEYS, refusalTextKey, type BookingRefusal } from './refusal';
import pending from '../../../../locales/pending/f03.json';
import en from '../../../../locales/en.json';

// CC-5: every typed refusal code maps to a locale key that exists in both languages
// (the pending file, or an existing key); no text is built in code.
describe('refusal codes map to locale keys (CC-5, design 4.2)', () => {
  const known = (key: string, lang: 'en' | 'th') =>
    key in (pending[lang] as Record<string, string>) || (lang === 'en' && key in en);

  it.each(Object.entries(REFUSAL_TEXT_KEYS))('%s -> %s exists in both languages', (_code, key) => {
    expect(known(key, 'en')).toBe(true);
    if (!key.startsWith('P-0')) expect(known(key, 'th')).toBe(true);
  });

  it('covers every code of design 4.2', () => {
    const codes: BookingRefusal[] = [
      'sign_in_required', 'club_paused', 'club_not_available', 'hold_setting_unset', 'not_on_the_hour',
      'not_consecutive', 'outside_hours', 'outside_window', 'in_the_past', 'hour_started', 'resource_inactive',
      'limit_reached', 'slot_unavailable', 'coach_unavailable', 'rest_rule', 'coach_rules_not_installed',
      'too_many_attempts',
    ];
    for (const c of codes) expect(REFUSAL_TEXT_KEYS).toHaveProperty(c);
  });
});

describe('refusalTextKey', () => {
  it('a coach clash shows the coach text, a court clash the court text', () => {
    expect(refusalTextKey('slot_unavailable', 'coach')).toBe('P-new.slot_unavailable_coach');
    expect(refusalTextKey('slot_unavailable', 'resource')).toBe('P-new.slot_unavailable_court');
    expect(pending.en).toHaveProperty('P-new.slot_unavailable_coach');
  });
});
