// The club page's logic (P3 and the support view), apart from the screen so it can be tested without a browser. It reads
// what the console API already gives about one club and turns every write into a result the screen shows by key. A step-up
// is asked for when the API says `step_up_required`; the screen then runs the same action again (D161).

type Fetch = typeof fetch;

export interface SetupItem { item: string; done: boolean; owed_by: 'booq' | 'owner' }
export interface LaunchItem { item: string; result: string; owed_by: 'booq' | 'owner' }
export interface SupportSetup {
  mode: 'edit' | 'look';
  club: Record<string, string | null>;
  hours: Array<{ weekday: number; open: string; close: string }>;
  locations: Array<{ id: string; name: string }>;
  resources: Array<{ id: string; location_id?: string; name: string; sport: string; type?: string | null; lights?: boolean; max_players?: number | null; active: boolean }>;
  settings: Array<{ key: string; value: unknown }>;
  features: Array<{ feature_key: string; enabled: boolean }>;
  featureKeys?: Array<{ feature_key: string; requires_payment_option: 'beam' | 'slip' | null }>;
  health?: Array<{ check_key: string; status: 'ok' | 'failed'; reason: string | null; checked_at: string }>;
  checkRequestedAt?: string | null;
}
export interface OwnerInvite { status: 'none' | 'pending' | 'expired' | 'redeemed'; expires_at?: string }
export interface ClubView {
  progress: { setup: SetupItem[]; launch: LaunchItem[] };
  counts: { bookingsConfirmed30d: number; lineMessagesSent30d: number } | null;
  support: SupportSetup;
  invite: OwnerInvite;
}

/** Item keys of the setup checklist and the live checks, and the text key of each. An unknown item shows its own key. */
export const SETUP_KEY: Record<string, string> = {
  basics: 'X-0137', plan: 'X-0138', courts_hours: 'X-0139', line: 'X-0140', payments: 'X-0142', legal_notice: 'X-new.setup_legal_notice',
};
export const LAUNCH_KEY: Record<string, string> = {
  line_test: 'X-new.launch_line_test', pay_tap_limit_set: 'X-new.launch_pay_tap_limit_set', receipt_prefix_set: 'X-new.launch_receipt_prefix_set',
  template_required_settings: 'X-new.launch_template_required_settings', no_open_launch_failure: 'X-new.launch_no_open_launch_failure',
  beam_key_swap: 'X-new.launch_beam_key_swap', owner_signed_in: 'X-new.launch_owner_signed_in', owner_verified: 'X-new.launch_owner_verified',
  product_priced: 'X-new.launch_product_priced', test_booking_completed: 'X-new.launch_test_booking_completed',
  required_launch_checks_not_configured: 'X-new.launch_required_launch_checks_not_configured',
};
export const RESULT_KEY: Record<string, string> = { pass: 'X-new.result_pass', fail: 'X-new.result_fail', pending: 'X-new.result_pending', missing: 'X-new.result_missing' };
export const itemKey = (map: Record<string, string>, item: string): string => map[item] ?? item;

/** The text of a refusal from the club routes. */
export function errorKey(status: number, code: string | undefined): string {
  if (status === 401) return 'X-new.staff_sign_in_required';
  if (code === 'step_up_required') return 'X-new.staff_step_up_required';
  if (status === 404) return 'X-new.club_not_found';
  if (code === 'forbidden' || status === 403) return 'X-new.staff_forbidden';
  const byCode: Record<string, string> = {
    look_only: 'X-new.club_look_only', section_unavailable: 'X-new.club_section_unavailable', invalid: 'X-new.club_invalid', bad_input: 'X-new.club_invalid',
    reason_required: 'X-new.club_reason_required', transition_not_allowed: 'X-new.club_transition_not_allowed', use_pause: 'X-new.club_use_pause',
    not_testing: 'X-new.launch_not_testing', not_recorded: 'X-new.launch_not_recorded',
    owner_contact_missing: 'X-new.club_owner_contact_missing', mail_failed: 'X-new.club_mail_failed', not_configured: 'X-new.club_not_configured',
  };
  return (code && byCode[code]) || 'X-new.club_unavailable';
}

export type Failure = { kind: 'error'; key: string; stepUp?: boolean; signIn?: boolean; notFound?: boolean };
const failure = (status: number, json: { code?: string } | null): Failure => ({
  kind: 'error',
  key: errorKey(status, json?.code),
  ...(json?.code === 'step_up_required' ? { stepUp: true } : {}),
  ...(status === 401 ? { signIn: true } : {}),
  ...(status === 404 ? { notFound: true } : {}),
});

async function call(f: Fetch, method: string, path: string, body?: unknown): Promise<{ status: number; json: Record<string, unknown> } | null> {
  try {
    const res = await f(`/api${path}`, { method, ...(body === undefined ? {} : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }) });
    return { status: res.status, json: ((await res.json().catch(() => ({}))) ?? {}) as Record<string, unknown> };
  } catch {
    return null;
  }
}
const down: Failure = { kind: 'error', key: 'X-new.club_unavailable' };

export async function loadClub(f: Fetch, id: string): Promise<{ kind: 'ok'; club: ClubView } | Failure> {
  const e = encodeURIComponent(id);
  const [detail, support, invite] = await Promise.all([call(f, 'GET', `/clubs/${e}`), call(f, 'GET', `/clubs/${e}/support/setup`), call(f, 'GET', `/clubs/${e}/owner-invite`)]);
  if (!detail || !support) return down;
  if (detail.status !== 200) return failure(detail.status, detail.json);
  if (support.status !== 200) return failure(support.status, support.json);
  const progress = detail.json['progress'] as ClubView['progress'] | undefined;
  const setup = support.json['setup'] as SupportSetup | undefined;
  if (!progress || !setup) return down;
  const inv = invite?.status === 200 ? (invite.json['invite'] as OwnerInvite | undefined) : undefined;
  return { kind: 'ok', club: { progress, counts: (detail.json['counts'] as ClubView['counts']) ?? null, support: setup, invite: inv ?? { status: 'none' } } };
}

export type StatusOutcome = { kind: 'done' } | { kind: 'blocked'; missing: Array<{ item: string; owed_by?: string; result?: string }> } | Failure;
function statusOutcome(r: Awaited<ReturnType<typeof call>>): StatusOutcome {
  if (!r) return down;
  if (r.status === 200) return { kind: 'done' };
  if (r.json['code'] === 'blocked' && Array.isArray(r.json['missing'])) return { kind: 'blocked', missing: r.json['missing'] as Array<{ item: string }> };
  return failure(r.status, r.json);
}
export const changeStatus = async (f: Fetch, id: string, to: string, reason: string) =>
  statusOutcome(await call(f, 'POST', `/clubs/${encodeURIComponent(id)}/status`, { to, ...(reason.trim() ? { reason: reason.trim() } : {}) }));
export const pauseClub = async (f: Fetch, id: string, reason: string) => statusOutcome(await call(f, 'POST', `/clubs/${encodeURIComponent(id)}/pause`, { reason: reason.trim() }));
export const resumeClub = async (f: Fetch, id: string, reason: string) => statusOutcome(await call(f, 'POST', `/clubs/${encodeURIComponent(id)}/resume`, { reason: reason.trim() }));

export type SimpleOutcome = { kind: 'done' } | Failure;
export async function sendOwnerInvite(f: Fetch, id: string): Promise<SimpleOutcome> {
  const r = await call(f, 'POST', `/clubs/${encodeURIComponent(id)}/owner-invite`, {});
  return !r ? down : r.status === 200 ? { kind: 'done' } : failure(r.status, r.json);
}

export const WEBHOOK_KINDS = ['line', 'beam_test', 'beam_live'] as const;
export type WebhookKind = (typeof WEBHOOK_KINDS)[number];
export type WebhookOutcome = { kind: 'token'; url: string; replaced: boolean } | Failure;
export async function issueWebhookToken(f: Fetch, id: string, kind: WebhookKind): Promise<WebhookOutcome> {
  const r = await call(f, 'POST', `/clubs/${encodeURIComponent(id)}/webhook-tokens/${kind}`, {});
  if (!r) return down;
  if (r.status === 200 && typeof r.json['url'] === 'string') return { kind: 'token', url: r.json['url'], replaced: r.json['replaced'] === true };
  return failure(r.status, r.json);
}

/** The fields of the club basics a specialist or admin edits here. */
export const BASICS_FIELDS = ['name_th', 'name_en', 'legal_name', 'owner_name', 'owner_phone', 'owner_line', 'owner_email'] as const;
export type BasicsField = (typeof BASICS_FIELDS)[number];
export type BasicsOutcome = { kind: 'saved'; pendingOwnerContact: boolean } | Failure;
export async function saveBasics(f: Fetch, id: string, values: Record<BasicsField, string>, was: Record<string, string | null>): Promise<BasicsOutcome> {
  // Only what changed is sent. An empty value clears the field (null), so a mistake can be undone.
  const changed: Record<string, string | null> = {};
  for (const k of BASICS_FIELDS) {
    const next = values[k].trim();
    if (next !== (was[k] ?? '')) changed[k] = next === '' ? null : next;
  }
  if (Object.keys(changed).length === 0) return { kind: 'saved', pendingOwnerContact: false };
  const r = await call(f, 'PUT', `/clubs/${encodeURIComponent(id)}/support/setup/basics`, changed);
  if (!r) return down;
  if (r.status === 200) return { kind: 'saved', pendingOwnerContact: typeof r.json['pendingOwnerContact'] === 'string' };
  return failure(r.status, r.json);
}
