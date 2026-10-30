import { Reply, RouteError } from '@booq/auth';

// Turns a service result ({ ok: true, ... } or { ok: false, code, ... }) into the console's answer.
// A refusal keeps its code and any structured extras (for example the list of missing launch items),
// with the status that code deserves. No text goes out: the client maps codes to messages.

const STATUS: Record<string, number> = {
  bad_input: 400,
  invalid: 400,
  reason_required: 400,
  unauthorized: 401,
  unauthenticated: 401,
  forbidden: 403,
  step_up_required: 403,
  same_admin: 403,
  not_found: 404,
  slug_taken: 409,
  transition_not_allowed: 409,
  use_pause: 409,
  blocked: 409,
  look_only: 409,
  not_available: 409,
  section_unavailable: 409,
  owner_contact_missing: 409,
  not_redeemed: 409,
  already_verified: 409,
  not_pending: 409,
  not_configured: 503,
  mail_failed: 502,
};

export function statusOf(code: string): number {
  return STATUS[code] ?? 400;
}

export function answer(result: { ok: boolean } & Record<string, unknown>): unknown {
  if (result.ok) {
    const { ok: _ok, ...rest } = result;
    return rest;
  }
  const { ok: _ok, code, ...extras } = result;
  const status = statusOf(String(code));
  if (Object.keys(extras).length === 0) throw new RouteError(status, String(code));
  return new Reply({ code, ...extras }, { status });
}
