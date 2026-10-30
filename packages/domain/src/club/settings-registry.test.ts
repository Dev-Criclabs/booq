import { describe, expect, it } from 'vitest';
import { SETTINGS, settingByKey, validateSetting } from './settings-registry';

// F01-T08: the settings registry (design 10). Shapes only: no default value lives in code.
const ok = (key: string, value: unknown) => validateSetting(key, value);

describe('the registry', () => {
  it('has the keys of design 10 and the sport label, each once, and no booking length', () => {
    expect(SETTINGS.map((s) => s.key)).toEqual([
      'hold_minutes', 'booking_window_days', 'cancel_window_hours', 'max_future_court_hours', 'waitlist_claim_minutes',
      'waitlist_no_offer_hours', 'rest_cap_hours', 'group_min_players', 'group_max_players', 'below_min_alert_minutes',
      'package_expiry_reminder_days', 'wallet_expiry_months', 'package_qr_minutes', 'vat_enabled', 'auto_slip_check', 'resource_label',
      'birthday_discount',
    ]);
    expect(new Set(SETTINGS.map((s) => s.key)).size).toBe(SETTINGS.length);
    expect(SETTINGS.filter((s) => /length|duration|slot|booking_minutes/.test(s.key))).toEqual([]);
    expect(settingByKey('booking_minutes')).toBeUndefined();
  });

  it('only the PRD TBD settings and the birthday discount (empty until F14 sets it) may be unset', () => {
    expect(SETTINGS.filter((s) => s.unsetAllowed).map((s) => s.key)).toEqual(['max_future_court_hours', 'below_min_alert_minutes', 'wallet_expiry_months', 'birthday_discount']);
  });

  it('carries no default value', () => {
    for (const s of SETTINGS) expect(Object.keys(s)).not.toContain('default');
  });
});

describe('validation', () => {
  it('hold time is 10, 15 or 20 and a number (BOOK-03-AC3)', () => {
    for (const v of [10, 15, 20]) expect(ok('hold_minutes', v)).toEqual({ ok: true, value: v });
    for (const v of [12, 5, 60, 0, '15', 15.5, null, true, [15]]) expect(ok('hold_minutes', v), String(v)).toEqual({ ok: false, code: 'invalid_value' });
  });

  it('whole numbers with their lower bound', () => {
    const cases: Array<[string, number, number]> = [
      ['booking_window_days', 1, 0], ['cancel_window_hours', 0, -1], ['max_future_court_hours', 1, 0], ['waitlist_claim_minutes', 1, 0],
      ['waitlist_no_offer_hours', 0, -1], ['rest_cap_hours', 1, 0], ['group_min_players', 1, 0], ['group_max_players', 1, 0],
      ['below_min_alert_minutes', 1, 0], ['wallet_expiry_months', 1, 0], ['package_qr_minutes', 1, 0],
    ];
    for (const [key, min, below] of cases) {
      expect(ok(key, min), key).toEqual({ ok: true, value: min });
      expect(ok(key, below), key).toEqual({ ok: false, code: 'invalid_value' });
      for (const bad of [1.5, '3', null, NaN, Infinity, true]) expect(ok(key, bad), `${key} ${String(bad)}`).toEqual({ ok: false, code: 'invalid_value' });
    }
  });

  it('reminder days are a non-empty list of distinct whole numbers of days, 0 or more', () => {
    expect(ok('package_expiry_reminder_days', [14, 3])).toEqual({ ok: true, value: [14, 3] });
    for (const bad of [[], [14, 14], [-1], [1.5], ['3'], 14, null, [14, null]]) expect(ok('package_expiry_reminder_days', bad), JSON.stringify(bad)).toEqual({ ok: false, code: 'invalid_value' });
  });

  it('switches are booleans, and the label is court, table or lane', () => {
    expect(ok('vat_enabled', false)).toEqual({ ok: true, value: false });
    expect(ok('auto_slip_check', true)).toEqual({ ok: true, value: true });
    for (const bad of ['true', 0, null]) expect(ok('vat_enabled', bad)).toEqual({ ok: false, code: 'invalid_value' });
    for (const v of ['court', 'table', 'lane']) expect(ok('resource_label', v)).toEqual({ ok: true, value: v });
    expect(ok('resource_label', 'pitch')).toEqual({ ok: false, code: 'invalid_value' });
  });

  it('an unknown key is refused', () => {
    expect(ok('booking_minutes', 60)).toEqual({ ok: false, code: 'unknown_setting' });
    expect(ok('__proto__', 1)).toEqual({ ok: false, code: 'unknown_setting' });
    expect(ok('toString', 1)).toEqual({ ok: false, code: 'unknown_setting' });
  });

  it('the birthday discount is {kind, value}: percent in basis points up to 10000, or fixed satang; it may stay unset (R5-AC1)', () => {
    expect(ok('birthday_discount', { kind: 'percent', value: 1000 })).toEqual({ ok: true, value: { kind: 'percent', value: 1000 } });
    expect(ok('birthday_discount', { kind: 'fixed', value: 5000 })).toEqual({ ok: true, value: { kind: 'fixed', value: 5000 } });
    for (const v of [{ kind: 'percent', value: 10001 }, { kind: 'percent', value: -1 }, { kind: 'free', value: 1 }, { kind: 'fixed', value: 1.5 }, { kind: 'fixed' }, { value: 5 }, { kind: 'fixed', value: 5, extra: 1 }, 10, null, 'x'])
      expect(ok('birthday_discount', v), JSON.stringify(v)).toEqual({ ok: false, code: 'invalid_value' });
    expect(settingByKey('birthday_discount')?.unsetAllowed).toBe(true);
  });
});
