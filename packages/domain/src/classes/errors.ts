// F08-T12 to T14: the typed refusals of the class services. A code, never text (CC-5, TEXT-01); the route maps each code to a
// status and the client to a locale key.
export type ClassErrorCode = 'bad_input' | 'not_found' | 'spot_gone' | 'forbidden' | 'template_clash';

export class ClassError extends Error {
  constructor(readonly code: ClassErrorCode, readonly detail: Record<string, unknown> = {}) {
    super(code);
  }
}
