// F03-T05: the hold time (BOOK-03-AC1, AC3; decisions D46, D52). The TypeScript side of
// `app.hold_minutes(club)`, the one place F16 will override. The value is a club setting
// with no default: an unset setting refuses a payment hold and nothing else.

/** The three values the setting may hold (D52). Any other value is a corrupt setting. */
export const HOLD_MINUTES_ALLOWED = [10, 15, 20] as const;
export type HoldMinutes = (typeof HOLD_MINUTES_ALLOWED)[number];

export type HoldMinutesRead = { ok: true; minutes: HoldMinutes } | { ok: false; code: 'hold_setting_unset' };

/**
 * Reads the raw setting. Empty means unset (a Blank template club). A stored value that is
 * not 10, 15 or 20 cannot be written through the settings route, so it throws rather than
 * being treated as unset or rounded.
 */
export function readHoldMinutes(raw: unknown): HoldMinutesRead {
  if (raw === null || raw === undefined || raw === '') return { ok: false, code: 'hold_setting_unset' };
  const n = typeof raw === 'string' && /^\d+$/.test(raw) ? Number(raw) : raw;
  if (typeof n === 'number' && (HOLD_MINUTES_ALLOWED as readonly number[]).includes(n)) {
    return { ok: true, minutes: n as HoldMinutes };
  }
  throw new RangeError(`hold_minutes must be one of ${HOLD_MINUTES_ALLOWED.join(', ')}`);
}

export type HoldResult = { ok: true; expiresAt: Date | null } | { ok: false; code: 'hold_setting_unset' };

/**
 * The end of the hold for a new order. Set once from the setting at that moment and never
 * moved (D46). A booking with nothing to pay (PAY-07, staff cash) takes no hold and does
 * not need the setting (BOOK-03-AC9).
 */
export function holdFor(input: { now: Date; setting: unknown; paymentDue: boolean }): HoldResult {
  if (!input.paymentDue) return { ok: true, expiresAt: null };
  const read = readHoldMinutes(input.setting);
  if (!read.ok) return read;
  return { ok: true, expiresAt: new Date(input.now.getTime() + read.minutes * 60_000) };
}
