// The settings registry (F01-T08; design 10): the shape of every club setting. It describes what a value
// may be and whether it may be unset; it holds no default value (the template supplies values, the
// spec's TBDs stay empty). The database has its own guard (migration 0041: the list of keys and the
// hold time), and a test keeps the two lists equal.

export type SettingScope = 'rules' | 'business';
export type SettingCheck = { ok: true; value: unknown } | { ok: false; code: 'invalid_value' };

export interface SettingDef {
  key: string;
  /** Unset allowed: the PRD leaves the value for the club to decide, so no value means "not set" (or no limit). */
  unsetAllowed: boolean;
  /** `business` settings are read by the accountant too (settings.business.read); the rest by the owner only. */
  scope: SettingScope;
  /** Exists only for a club that chose slip checking (design 10). */
  slipOnly?: boolean;
  validate(value: unknown): SettingCheck;
}

const bad: SettingCheck = { ok: false, code: 'invalid_value' };
const good = (value: unknown): SettingCheck => ({ ok: true, value });

const wholeAtLeast = (min: number) => (v: unknown): SettingCheck =>
  typeof v === 'number' && Number.isSafeInteger(v) && v >= min ? good(v) : bad;
const oneOf = (allowed: readonly unknown[]) => (v: unknown): SettingCheck => (allowed.includes(v) ? good(v) : bad);
const bool = (v: unknown): SettingCheck => (typeof v === 'boolean' ? good(v) : bad);
const dayList = (v: unknown): SettingCheck => {
  if (!Array.isArray(v) || v.length === 0) return bad;
  if (!v.every((d) => typeof d === 'number' && Number.isSafeInteger(d) && d >= 0)) return bad;
  return new Set(v).size === v.length ? good(v) : bad;
};

// The birthday discount (F04 R5-AC1): { kind, value }, empty until the club (F14) sets it. Same kinds as a promo
// code: percent in basis points, or a fixed amount in satang.
const birthdayDiscount = (v: unknown): SettingCheck => {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return bad;
  const o = v as Record<string, unknown>;
  if (Object.keys(o).sort().join() !== 'kind,value') return bad;
  if (typeof o.value !== 'number' || !Number.isSafeInteger(o.value) || o.value < 0) return bad;
  if (o.kind === 'percent') return o.value <= 10000 ? good(v) : bad;
  return o.kind === 'fixed' ? good(v) : bad;
};

export const SETTINGS: readonly SettingDef[] = [
  { key: 'hold_minutes', unsetAllowed: false, scope: 'rules', validate: oneOf([10, 15, 20]) },
  { key: 'booking_window_days', unsetAllowed: false, scope: 'rules', validate: wholeAtLeast(1) },
  { key: 'cancel_window_hours', unsetAllowed: false, scope: 'rules', validate: wholeAtLeast(0) },
  { key: 'max_future_court_hours', unsetAllowed: true, scope: 'rules', validate: wholeAtLeast(1) },
  { key: 'waitlist_claim_minutes', unsetAllowed: false, scope: 'rules', validate: wholeAtLeast(1) },
  { key: 'waitlist_no_offer_hours', unsetAllowed: false, scope: 'rules', validate: wholeAtLeast(0) },
  { key: 'rest_cap_hours', unsetAllowed: false, scope: 'rules', validate: wholeAtLeast(1) },
  { key: 'group_min_players', unsetAllowed: false, scope: 'rules', validate: wholeAtLeast(1) },
  { key: 'group_max_players', unsetAllowed: false, scope: 'rules', validate: wholeAtLeast(1) },
  { key: 'below_min_alert_minutes', unsetAllowed: true, scope: 'rules', validate: wholeAtLeast(1) },
  { key: 'package_expiry_reminder_days', unsetAllowed: false, scope: 'rules', validate: dayList },
  { key: 'wallet_expiry_months', unsetAllowed: true, scope: 'rules', validate: wholeAtLeast(1) },
  { key: 'package_qr_minutes', unsetAllowed: false, scope: 'rules', validate: wholeAtLeast(1) },
  { key: 'vat_enabled', unsetAllowed: false, scope: 'business', validate: bool },
  { key: 'auto_slip_check', unsetAllowed: false, scope: 'rules', slipOnly: true, validate: bool },
  { key: 'resource_label', unsetAllowed: false, scope: 'rules', validate: oneOf(['court', 'table', 'lane']) },
  { key: 'birthday_discount', unsetAllowed: true, scope: 'rules', validate: birthdayDiscount },
];

const BY_KEY = new Map(SETTINGS.map((s) => [s.key, s]));

export function settingByKey(key: string): SettingDef | undefined {
  return BY_KEY.get(key);
}

export function validateSetting(key: string, value: unknown): SettingCheck | { ok: false; code: 'unknown_setting' } {
  const def = BY_KEY.get(key);
  return def ? def.validate(value) : { ok: false, code: 'unknown_setting' };
}

export type SettingWrite =
  | { ok: true; action: 'set'; value: unknown }
  | { ok: true; action: 'unset' }
  | { ok: false; status: 400 | 404 | 409; code: 'unknown_setting' | 'not_available' | 'cannot_unset' | 'invalid_value' };

/**
 * The one rule for writing a club setting, shared by the owner's route and the console's (F01; PLAT-05). `null` unsets, only where the
 * registry allows it; nothing here supplies a default. `paymentOption` is the club's choice (a slip-only setting needs `slip`);
 * `otherGroupLimit` is the stored value of the other one of group_min_players and group_max_players (the smallest group may not exceed the largest).
 */
export function checkSettingWrite(input: { key: string; value: unknown; paymentOption: string | null; otherGroupLimit: unknown }): SettingWrite {
  const def = BY_KEY.get(input.key);
  if (!def) return { ok: false, status: 404, code: 'unknown_setting' };
  if (def.slipOnly && input.paymentOption !== 'slip') return { ok: false, status: 409, code: 'not_available' };
  if (input.value === null) return def.unsetAllowed ? { ok: true, action: 'unset' } : { ok: false, status: 400, code: 'cannot_unset' };
  const checked = def.validate(input.value);
  if (!checked.ok) return { ok: false, status: 400, code: checked.code };
  const o = input.otherGroupLimit;
  if ((input.key === 'group_min_players' || input.key === 'group_max_players') && typeof o === 'number') {
    const v = checked.value as number;
    if (input.key === 'group_min_players' ? v > o : o > v) return { ok: false, status: 400, code: 'invalid_value' };
  }
  return { ok: true, action: 'set', value: checked.value };
}

/** The other group limit of a group limit key, or null for any other key. */
export function otherGroupLimitKey(key: string): string | null {
  return key === 'group_min_players' ? 'group_max_players' : key === 'group_max_players' ? 'group_min_players' : null;
}
