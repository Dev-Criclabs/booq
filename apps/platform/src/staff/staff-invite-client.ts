import { signInternalCall } from '@booq/auth';

// apps/platform's side of F01-T17b (SR-06, D148): to invite a teammate, reset a second factor or deactivate a teammate it
// asks apps/staff-invite, with a signed call. This app holds the shared signing secret and the other app's address; it holds
// no identity provider key. The caller passes the actor and whether their second factor is fresh (`authenticate().stepUpFresh`).
// After a reset or a deactivation the caller also ends that teammate's open sessions here (ROLE-02-AC4).

export interface StaffInviteActor {
  staffId: string;
  stepUpFresh: boolean;
}
export type StaffInviteFailure = 'unauthorized' | 'forbidden' | 'step_up_required' | 'bad_input' | 'email_taken' | 'same_person' | 'last_admin' | 'not_found' | 'provider_failed' | 'unreachable' | 'internal';
export type InviteResult = { ok: true; staffId: string } | { ok: false; code: StaffInviteFailure };
export type Done = { ok: true } | { ok: false; code: StaffInviteFailure };

const KNOWN = new Set<string>(['unauthorized', 'forbidden', 'step_up_required', 'bad_input', 'email_taken', 'same_person', 'last_admin', 'not_found', 'provider_failed', 'internal']);

export function createStaffInviteClient(deps: { url: string; signingSecret: string; fetch?: typeof fetch; now(): Date }) {
  const base = deps.url.replace(/\/+$/, '');
  const doFetch = deps.fetch ?? fetch;
  async function post(path: string, body: Record<string, unknown>): Promise<{ status: number; json: unknown } | null> {
    const raw = JSON.stringify(body);
    try {
      const res = await doFetch(`${base}${path}`, { method: 'POST', body: raw, headers: { 'content-type': 'application/json', ...signInternalCall(deps.signingSecret, deps.now(), raw) } });
      return { status: res.status, json: await res.json().catch(() => null) };
    } catch {
      return null;
    }
  }
  const failure = (r: { status: number; json: unknown } | null): { ok: false; code: StaffInviteFailure } => {
    if (!r) return { ok: false, code: 'unreachable' };
    const c = (r.json as { code?: unknown } | null)?.code;
    return { ok: false, code: typeof c === 'string' && KNOWN.has(c) ? (c as StaffInviteFailure) : 'provider_failed' };
  };
  const base2 = (a: StaffInviteActor) => ({ actorStaffId: a.staffId, stepUpFresh: a.stepUpFresh });
  return {
    async invite(actor: StaffInviteActor, input: { email: string; displayName: string; role: string }): Promise<InviteResult> {
      const r = await post('/invite', { ...base2(actor), ...input });
      const id = (r?.json as { staffId?: unknown } | null)?.staffId;
      return r && r.status === 200 && typeof id === 'string' ? { ok: true, staffId: id } : failure(r);
    },
    async resetFactor(actor: StaffInviteActor, targetStaffId: string): Promise<Done> {
      const r = await post('/reset-factor', { ...base2(actor), targetStaffId });
      return r && r.status === 200 ? { ok: true } : failure(r);
    },
    async deactivate(actor: StaffInviteActor, targetStaffId: string): Promise<Done> {
      const r = await post('/deactivate', { ...base2(actor), targetStaffId });
      return r && r.status === 200 ? { ok: true } : failure(r);
    },
  };
}
