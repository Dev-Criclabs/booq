// The new-club wizard's logic (P2, five steps), apart from the screen so it can be tested without a browser. Step 1 creates the
// club as a Draft (POST /clubs); every later save goes to the support view's section routes, so each step is a saved draft.
// The plan text on the board is display copy from the language files; no price is stored (the PRD leaves it TBD).

import { errorKey, type Failure } from './club';
import { LINE_USER_ID } from '../line-id';

type Fetch = typeof fetch;

export const STEPS = ['basics', 'plan', 'courts', 'line', 'payments'] as const;
export type Step = (typeof STEPS)[number];
export const stepFromQuery = (raw: string | null): Step => STEPS[Math.min(5, Math.max(1, Number.parseInt(raw ?? '', 10) || 1)) - 1]!;
export const stepNumber = (s: Step): number => STEPS.indexOf(s) + 1;
export const STEP_TITLE_KEY: Record<Step, string> = { basics: 'X-0035', plan: 'X-0036', courts: 'X-0037', line: 'X-0140', payments: 'X-0038' };
/** "Step n of 5 · name · saved as draft {time}" on each board. */
export const STEP_HEADER_KEY: Record<Step, string> = { basics: 'X-0033', plan: 'X-0062', courts: 'X-0072', line: 'X-0096', payments: 'X-0116' };

export const BASIC_FIELDS = ['name_th', 'name_en', 'slug', 'legal_name', 'tax_id', 'tax_branch', 'registered_address', 'owner_name', 'owner_phone', 'owner_line', 'owner_email', 'default_language'] as const;
export type BasicField = (typeof BASIC_FIELDS)[number];
export type BasicValues = Record<BasicField, string>;
export const FIELD_KEY: Record<BasicField, string> = {
  name_th: 'X-0040', name_en: 'X-0041', slug: 'X-new.wizard_slug', legal_name: 'X-0042', tax_id: 'X-0044', tax_branch: 'X-0046', registered_address: 'X-0048',
  owner_name: 'X-0050', owner_phone: 'X-0052', owner_line: 'X-0054', owner_email: 'X-0057', default_language: 'X-0059',
};
const REQUIRED: readonly BasicField[] = ['name_th', 'name_en', 'slug'];

export const emptyBasics = (): BasicValues => ({ ...Object.fromEntries(BASIC_FIELDS.map((k) => [k, ''])), default_language: 'th' }) as BasicValues;
export const basicsFrom = (club: Record<string, string | null>): BasicValues =>
  Object.fromEntries(BASIC_FIELDS.map((k) => [k, club[k] ?? (k === 'default_language' ? 'th' : '')])) as BasicValues;

/** A web address name from the English club name: lower case letters and digits joined by single dashes, at most 63 characters. */
export function slugify(name: string): string {
  return name.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 63).replace(/-+$/g, '');
}
const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;

export type Problem = { field: BasicField; key: string };
export function checkBasics(v: BasicValues, creating: boolean): Problem | null {
  for (const k of REQUIRED) if (v[k].trim() === '' && (creating || k !== 'slug')) return { field: k, key: 'X-new.wizard_required' };
  if (creating && (!SLUG.test(v.slug.trim()) || v.slug.trim().length > 63)) return { field: 'slug', key: 'X-new.wizard_slug_bad' };
  if (v.tax_id.trim() !== '' && !/^\d{13}$/.test(v.tax_id.trim())) return { field: 'tax_id', key: 'X-new.wizard_tax_id_bad' };
  if (v.owner_email.trim() !== '' && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v.owner_email.trim())) return { field: 'owner_email', key: 'X-new.wizard_email_bad' };
  if (v.owner_line.trim() !== '' && !LINE_USER_ID.test(v.owner_line.trim())) return { field: 'owner_line', key: 'X-new.wizard_line_bad' };
  if (v.default_language !== 'th' && v.default_language !== 'en') return { field: 'default_language', key: 'X-new.wizard_required' };
  return null;
}

async function call(f: Fetch, method: string, path: string, body: unknown): Promise<{ status: number; json: Record<string, unknown> } | null> {
  try {
    const res = await f(`/api${path}`, { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    return { status: res.status, json: ((await res.json().catch(() => ({}))) ?? {}) as Record<string, unknown> };
  } catch {
    return null;
  }
}
const down: Failure = { kind: 'error', key: 'X-new.club_unavailable' };
function failure(r: { status: number; json: Record<string, unknown> }): Failure {
  const code = typeof r.json['code'] === 'string' ? r.json['code'] : undefined;
  const key = code === 'slug_taken' ? 'X-new.wizard_slug_taken' : errorKey(r.status, code);
  return { kind: 'error', key, ...(code === 'step_up_required' ? { stepUp: true } : {}), ...(r.status === 401 ? { signIn: true } : {}) };
}

/** Only filled fields are sent: an empty value is not a value (POST /clubs refuses it). */
export const createBody = (v: BasicValues): Record<string, string> =>
  Object.fromEntries(BASIC_FIELDS.map((k) => [k, v[k].trim()] as const).filter(([, x]) => x !== ''));

export async function createClub(f: Fetch, v: BasicValues): Promise<{ kind: 'created'; id: string } | Failure> {
  const r = await call(f, 'POST', '/clubs', createBody(v));
  if (!r) return down;
  const id = r.json['id'];
  return r.status === 201 || r.status === 200 ? (typeof id === 'string' ? { kind: 'created', id } : down) : failure(r);
}

/** An existing draft: only what changed is sent; clearing a field sends null. The address name (slug) cannot change after creation. */
export async function saveBasics(f: Fetch, id: string, now: BasicValues, was: BasicValues): Promise<{ kind: 'saved' } | Failure> {
  const changed: Record<string, string | null> = {};
  for (const k of BASIC_FIELDS) {
    if (k === 'slug') continue;
    const next = now[k].trim();
    if (next !== was[k].trim()) changed[k] = next === '' ? null : next;
  }
  return Object.keys(changed).length === 0 ? { kind: 'saved' } : put(f, id, 'basics', changed);
}

async function put(f: Fetch, id: string, section: string, body: unknown): Promise<{ kind: 'saved' } | Failure> {
  const r = await call(f, 'PUT', `/clubs/${encodeURIComponent(id)}/support/setup/${section}`, body);
  if (!r) return down;
  return r.status === 200 ? { kind: 'saved' } : failure(r);
}

const DAY = /^\d{4}-\d{2}-\d{2}$/;
export type PlanProblem = 'X-new.wizard_date_bad' | 'X-new.wizard_date_order';
export function checkPlan(trial: string, billing: string): PlanProblem | null {
  for (const d of [trial, billing]) if (d.trim() !== '' && (!DAY.test(d.trim()) || Number.isNaN(Date.parse(`${d.trim()}T00:00:00Z`)))) return 'X-new.wizard_date_bad';
  if (trial.trim() !== '' && billing.trim() !== '' && billing.trim() < trial.trim()) return 'X-new.wizard_date_order';
  return null;
}
export async function savePlan(f: Fetch, id: string, now: { trial: string; billing: string }, was: { trial: string; billing: string }): Promise<{ kind: 'saved' } | Failure> {
  const body: Record<string, string | null> = {};
  if (now.trial.trim() !== was.trial.trim()) body['plan_trial_ends_at'] = now.trial.trim() === '' ? null : stampOf(now.trial);
  if (now.billing.trim() !== was.billing.trim()) body['billing_starts_at'] = now.billing.trim() === '' ? null : stampOf(now.billing);
  return Object.keys(body).length === 0 ? { kind: 'saved' } : put(f, id, 'plan', body);
}

export const PAYMENT_OPTIONS = ['beam', 'slip'] as const;
export type PaymentOption = (typeof PAYMENT_OPTIONS)[number];
// X-0120 says refunds go back by PromptPay (QA-F09-1): value never returns as cash, so the wizard uses its own wording.
export const OPTION_KEY: Record<PaymentOption, { title: string; text: string }> = { beam: { title: 'X-0119', text: 'X-new.wizard_option_beam_text' }, slip: { title: 'X-0121', text: 'X-0122' } };
export const savePaymentOption = (f: Fetch, id: string, option: PaymentOption) => put(f, id, 'basics', { payment_option: option });

/** The day part of a stored timestamp, for the date boxes. */
export const dayOf = (v: string | null | undefined): string => (v && !Number.isNaN(Date.parse(v)) ? new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Bangkok' }).format(new Date(v)) : '');
/** A day typed in the box is a day in Bangkok: the start of it. */
export const stampOf = (day: string): string => `${day.trim()}T00:00:00+07:00`;
/** "14:20" in Bangkok time, for "saved as draft {time}". */
export const clockTime = (d: Date): string => new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Bangkok' }).format(d);
