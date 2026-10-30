// The team page's logic (P6, F01-T17b/T17c), apart from the screen so it can be tested without a browser. It calls the
// console's admin routes with the staff cookie (same origin) and turns every answer into a result the screen shows by key.

type Fetch = typeof fetch;

export interface Member {
  id: string;
  displayName: string;
  email: string;
  role: 'platform_admin' | 'onboarding_specialist';
  active: boolean;
}

export const ROLE_KEY: Record<Member['role'], string> = { platform_admin: 'X-0006', onboarding_specialist: 'X-0267' };

/** What each refusal code of the staff routes is shown as. */
export function errorKey(status: number, code: string | undefined): string {
  if (status === 401) return 'X-new.staff_sign_in_required';
  if (code === 'step_up_required') return 'X-new.staff_step_up_required';
  if (status === 403) return 'X-new.staff_forbidden';
  if (code === 'email_taken') return 'X-new.staff_email_taken';
  if (code === 'last_admin') return 'X-new.staff_last_admin';
  if (code === 'same_person') return 'X-new.staff_same_person';
  if (code === 'not_configured') return 'X-new.staff_enrolment_not_configured';
  if (status === 400) return 'X-new.staff_bad_input';
  return 'X-new.staff_unavailable';
}

async function call(f: Fetch, method: string, path: string, body?: unknown): Promise<{ status: number; json: Record<string, unknown> } | null> {
  try {
    const res = await f(`/api${path}`, { method, ...(body === undefined ? {} : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }) });
    return { status: res.status, json: ((await res.json().catch(() => ({}))) ?? {}) as Record<string, unknown> };
  } catch {
    return null;
  }
}

export type ListOutcome = { kind: 'ok'; team: Member[] } | { kind: 'error'; key: string };
export async function loadTeam(f: Fetch): Promise<ListOutcome> {
  const r = await call(f, 'GET', '/staff');
  if (!r) return { kind: 'error', key: 'X-new.staff_unavailable' };
  if (r.status === 200 && Array.isArray(r.json['team'])) return { kind: 'ok', team: r.json['team'] as Member[] };
  return { kind: 'error', key: errorKey(r.status, r.json['code'] as string | undefined) };
}

/** An invite or a reset: the enrolment link comes back once, to be shown once. */
export type LinkOutcome = { kind: 'link'; link: string } | { kind: 'done' } | { kind: 'error'; key: string };
function linked(r: Awaited<ReturnType<typeof call>>): LinkOutcome {
  if (!r) return { kind: 'error', key: 'X-new.staff_unavailable' };
  if (r.status === 200) return typeof r.json['enrolmentLink'] === 'string' ? { kind: 'link', link: r.json['enrolmentLink'] } : { kind: 'done' };
  return { kind: 'error', key: errorKey(r.status, r.json['code'] as string | undefined) };
}
export const invite = async (f: Fetch, input: { email: string; displayName: string; role: Member['role'] }) => linked(await call(f, 'POST', '/staff', input));
export const resetFactor = async (f: Fetch, id: string) => linked(await call(f, 'POST', `/staff/${encodeURIComponent(id)}/reset-factor`, {}));
export const deactivate = async (f: Fetch, id: string) => linked(await call(f, 'POST', `/staff/${encodeURIComponent(id)}/deactivate`, {}));
