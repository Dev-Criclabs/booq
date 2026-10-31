// F07-T11: the typed refusals of the coach services. A code, never text (CC-5, TEXT-01); the route maps each code to a status and the
// client to a locale key.
export type CoachErrorCode = 'bad_input' | 'not_found' | 'club_paused' | 'forbidden';

export class CoachError extends Error {
  constructor(readonly code: CoachErrorCode, readonly detail: Record<string, unknown> = {}) {
    super(code);
  }
}
