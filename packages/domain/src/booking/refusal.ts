// The typed refusal codes of `reserve_court` (design 4.2) and the locale key each one
// shows. Code never builds text (CC-5). `P-new.*` keys are in locales/pending/f03.json
// until Content merges them and assigns numbers; then only this table changes.
export const REFUSAL_TEXT_KEYS = {
  sign_in_required: 'P-0001',
  club_paused: 'P-0442',
  club_not_available: 'P-new.club_not_available',
  hold_setting_unset: 'P-new.hold_setting_unset',
  not_on_the_hour: 'P-new.not_on_the_hour',
  not_consecutive: 'P-new.not_consecutive',
  outside_hours: 'P-new.outside_hours',
  outside_window: 'P-new.outside_window',
  in_the_past: 'P-new.in_the_past',
  hour_started: 'P-new.hour_started',
  resource_inactive: 'P-new.resource_inactive',
  limit_reached: 'P-new.limit_reached',
  slot_unavailable: 'P-new.slot_unavailable_court',
  coach_unavailable: 'P-new.coach_unavailable',
  rest_rule: 'P-new.rest_rule',
  coach_rules_not_installed: 'P-new.coach_rules_not_installed',
  too_many_attempts: 'P-new.too_many_attempts',
  order_not_found: 'P-new.order_not_found',
  forbidden: 'P-new.forbidden',
  idempotency_key_reused: 'P-new.idempotency_key_reused',
} as const;

export type BookingRefusal = keyof typeof REFUSAL_TEXT_KEYS;

/** `slot_unavailable` shows the coach text when the coach was the clash (`by: 'coach'`). */
export function refusalTextKey(code: BookingRefusal, by?: 'resource' | 'coach'): string {
  return code === 'slot_unavailable' && by === 'coach' ? 'P-new.slot_unavailable_coach' : REFUSAL_TEXT_KEYS[code];
}
