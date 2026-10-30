// F04 checkout refusals (design 5.1) and the locale key each one shows. Code never builds text (CC-5).
// `P-new.*` keys are in locales/pending/f04.json until Content merges them and assigns numbers; then only
// this table changes. Reused: P-0442 (paused).
export const CHECKOUT_TEXT_KEYS = {
  bad_input: 'P-new.checkout_bad_input',
  club_paused: 'P-0442',
  club_not_available: 'P-new.club_not_available',
  resource_inactive: 'P-new.resource_inactive',
  selection_invalid: 'P-new.not_on_the_hour',
  price_not_set: 'P-new.price_not_set',
  coach_price_not_set: 'P-new.coach_price_not_set',
  add_on_not_for_sale: 'P-new.add_on_not_for_sale',
  code_not_valid: 'P-new.code_not_valid',
  code_expired: 'P-new.code_expired',
  code_wrong_audience: 'P-new.code_wrong_audience',
  code_out_of_scope: 'P-new.code_out_of_scope',
  code_below_minimum: 'P-new.code_below_minimum',
  code_first_booking_only: 'P-new.code_first_booking_only',
  code_used_up: 'P-new.code_used_up',
  code_not_for_solo_class: 'P-new.code_not_for_solo_class',
} as const;

export type CheckoutErrorCode = keyof typeof CHECKOUT_TEXT_KEYS;

export class CheckoutError extends Error {
  constructor(
    readonly code: CheckoutErrorCode,
    /** Values for the text's variables, such as `{ amount }` for code_below_minimum. */
    readonly detail: Record<string, string | number> = {},
  ) {
    super(code);
  }
}
