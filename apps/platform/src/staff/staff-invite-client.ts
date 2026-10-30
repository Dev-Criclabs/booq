import { signInternalCall } from '@booq/auth';

// apps/platform's side of F01-T17b (SR-06, D148): to invite a teammate, reset a second factor or deactivate a teammate it
// asks apps/staff-invite, with a signed call. This app holds the shared signing secret and the other app's address; it holds
// no identity provider key. The caller passes the actor and whether their second factor is fresh (`authenticate().stepUpFresh`).
// After a reset or a deactivation the caller also ends that teammate's open sessions here (ROLE-02-AC4).

export interface StaffInviteActor {
  staffId: string;
  stepUpFresh: boolean;
}
export type StaffInviteFailure = 'unauthorized' | 'forbidden' | 'step_up_required' | 'bad_input' | 'email_taken' | 'same_person' | 'last_admin' | 'not_found' | 'provider_failed' | 'unreachable' | 'not_configured' | 'internal';
export type InviteResult = { ok: true; staffId: string; enrolmentToken: string } | { ok: false; code: StaffInviteFailure };
export type Done = { ok: true } | { ok: false; code: StaffInviteFailure };
/** A reset also gives a new single-use enrolment token, so the teammate can enrol an authenticator again (F01-T17c). */
export type ResetResult = { ok: true; enrolmentToken: string } | { ok: false; code: StaffInviteFailure };

const KNOWN = new Set<string>(['unauthorized', 'forbidden', 'step_up_required', 'bad_input', 'email_taken', 'same_person', 'last_admin', 'not_found', 'provider_failed', 'not_configured', 'internal']);

export function createStaffInviteClient(deps: {
  url: string;
  signingSecret: string;
  fetch?: typeof fetch;
  now(): Date;
  /** Ends every open console session of one teammate (AuthStore.deleteSessionsFor, through the sign-in module). */
  endSessionsFor(staffId: string): Promise<void>;
}) {
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
      const j = r?.json as { staffId?: unknown; enrolmentToken?: unknown } | null;
      return r && r.status === 200 && typeof j?.staffId === 'string' && typeof j.enrolmentToken === 'string' ? { ok: true, staffId: j.staffId, enrolmentToken: j.enrolmentToken } : failure(r);
    },
    async resetFactor(actor: StaffInviteActor, targetStaffId: string): Promise<ResetResult> {
      const r = await post('/reset-factor', { ...base2(actor), targetStaffId });
      const token = (r?.json as { enrolmentToken?: unknown } | null)?.enrolmentToken;
      if (!r || r.status !== 200 || typeof token !== 'string') return failure(r);
      await deps.endSessionsFor(targetStaffId); // the old factor must not keep a session open (ROLE-02-AC4)
      return { ok: true, enrolmentToken: token };
    },
    async deactivate(actor: StaffInviteActor, targetStaffId: string): Promise<Done> {
      const r = await post('/deactivate', { ...base2(actor), targetStaffId });
      // A provider failure after the row was made inactive is still a deactivation here: sign in is refused, so end the sessions anyway.
      if (r && r.status === 502 && (r.json as { code?: unknown } | null)?.code === 'provider_failed') await deps.endSessionsFor(targetStaffId);
      if (!r || r.status !== 200) return failure(r);
      await deps.endSessionsFor(targetStaffId);
      return { ok: true };
    },
  };
}
