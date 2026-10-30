// F03-T20 to T22: the typed refusals of the booking services. A code, never text (CC-5, TEXT-01);
// the route maps each code to a status and the client to a locale key.

export type BookingErrorCode =
  | 'bad_input'
  | 'not_found'
  | 'outside_window'
  | 'in_the_past'
  | 'not_releasable'
  | 'club_paused'
  | 'forbidden';

export class BookingError extends Error {
  constructor(readonly code: BookingErrorCode) {
    super(code);
  }
}
