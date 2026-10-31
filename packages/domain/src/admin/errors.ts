// F11: the typed refusals of the admin services. A code, never text (CC-5, TEXT-01); the route maps each code to a status.
export type AdminErrorCode = 'bad_input' | 'not_found' | 'forbidden' | 'reason_required' | 'below_zero' | 'customer_not_claimed' | 'duplicate' | 'in_use';

export class AdminError extends Error {
  constructor(readonly code: AdminErrorCode, readonly detail: Record<string, unknown> = {}) {
    super(code);
  }
}
