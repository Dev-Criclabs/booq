// The club settings in the support view (P3b), apart from the screen so it can be tested without a browser. It reads
// GET /clubs/{id}/settings (every setting with its value or "not set") and writes one at a time with PUT /clubs/{id}/settings/{key}.
// Only the shape of each setting is known here, so a draft can be turned into a value; no value is ever supplied (a setting stays
// empty until someone sets it) and the API decides what is accepted.

import { errorKey, type Failure } from './club';

type Fetch = typeof fetch;

export type FieldKind = { kind: 'whole'; min: number } | { kind: 'choice'; options: readonly string[] } | { kind: 'bool' } | { kind: 'days' } | { kind: 'discount' };
export const FIELDS: Record<string, FieldKind> = {
  hold_minutes: { kind: 'choice', options: ['10', '15', '20'] },
  booking_window_days: { kind: 'whole', min: 1 },
  cancel_window_hours: { kind: 'whole', min: 0 },
  max_future_court_hours: { kind: 'whole', min: 1 },
  waitlist_claim_minutes: { kind: 'whole', min: 1 },
  waitlist_no_offer_hours: { kind: 'whole', min: 0 },
  rest_cap_hours: { kind: 'whole', min: 1 },
  group_min_players: { kind: 'whole', min: 1 },
  group_max_players: { kind: 'whole', min: 1 },
  below_min_alert_minutes: { kind: 'whole', min: 1 },
  package_expiry_reminder_days: { kind: 'days' },
  wallet_expiry_months: { kind: 'whole', min: 1 },
  package_qr_minutes: { kind: 'whole', min: 1 },
  vat_enabled: { kind: 'bool' },
  auto_slip_check: { kind: 'bool' },
  resource_label: { kind: 'choice', options: ['court', 'table', 'lane'] },
  birthday_discount: { kind: 'discount' },
};
export const DISCOUNT_KINDS = ['percent', 'fixed'] as const;

export interface SettingRow { key: string; value: unknown; unset: boolean; required: boolean; available: boolean }
export interface SettingsView { editable: boolean; settings: SettingRow[] }

/** The text of a setting's name; a key this console does not know shows its own key, not invented text. */
export const labelKey = (key: string): string => `X-new.setting_${key}`;

/** What a box starts with. A discount is two boxes (kind, value) joined by a space; days are numbers separated by commas. */
export function draftOf(row: SettingRow): string {
  if (row.unset || row.value === null || row.value === undefined) return '';
  const v = row.value;
  if (Array.isArray(v)) return v.join(', ');
  if (typeof v === 'object' && v !== null) {
    const o = v as { kind?: unknown; value?: unknown };
    return `${String(o.kind)} ${String(o.value)}`;
  }
  return String(v);
}

export type Parsed = { ok: true; value: unknown } | { ok: false; key: string };
const NEEDED = 'X-new.settings_needed';
const WHOLE = 'X-new.settings_whole';

/** A draft becomes the value to send: null unsets (only when the setting may be unset). The API checks it again. */
export function parseDraft(row: SettingRow, draft: string): Parsed {
  const f = FIELDS[row.key];
  const text = draft.trim();
  if (text === '') return row.required ? { ok: false, key: NEEDED } : { ok: true, value: null };
  if (!f) return { ok: false, key: 'X-new.settings_unknown' };
  switch (f.kind) {
    case 'whole': {
      if (!/^\d+$/.test(text) || !Number.isSafeInteger(Number(text)) || Number(text) < f.min) return { ok: false, key: WHOLE };
      return { ok: true, value: Number(text) };
    }
    case 'choice':
      return f.options.includes(text) ? { ok: true, value: /^\d+$/.test(text) ? Number(text) : text } : { ok: false, key: 'X-new.settings_choice' };
    case 'bool':
      return text === 'true' || text === 'false' ? { ok: true, value: text === 'true' } : { ok: false, key: 'X-new.settings_choice' };
    case 'days': {
      const parts = text.split(',').map((p) => p.trim());
      if (parts.some((p) => !/^\d+$/.test(p))) return { ok: false, key: 'X-new.settings_days' };
      const days = parts.map(Number);
      return new Set(days).size === days.length ? { ok: true, value: days } : { ok: false, key: 'X-new.settings_days' };
    }
    case 'discount': {
      const [kind, amount, ...rest] = text.split(/\s+/);
      if (rest.length > 0 || !(DISCOUNT_KINDS as readonly string[]).includes(kind ?? '') || !/^\d+$/.test(amount ?? '')) return { ok: false, key: 'X-new.settings_discount' };
      return { ok: true, value: { kind, value: Number(amount) } };
    }
  }
}

/** Refusals of the settings routes that have words of their own; the rest are the club routes' words. */
function settingsErrorKey(status: number, code: string | undefined): string {
  const own: Record<string, string> = {
    invalid_value: 'X-new.settings_refused', unknown_setting: 'X-new.settings_unknown', not_available: 'X-new.settings_not_available', cannot_unset: NEEDED,
  };
  return (code && own[code]) || errorKey(status, code);
}

async function call(f: Fetch, method: string, path: string, body?: unknown): Promise<{ status: number; json: Record<string, unknown> } | null> {
  try {
    const res = await f(`/api${path}`, { method, ...(body === undefined ? {} : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }) });
    return { status: res.status, json: ((await res.json().catch(() => ({}))) ?? {}) as Record<string, unknown> };
  } catch {
    return null;
  }
}
const down: Failure = { kind: 'error', key: 'X-new.club_unavailable' };
const failure = (r: { status: number; json: Record<string, unknown> }): Failure => {
  const code = typeof r.json['code'] === 'string' ? r.json['code'] : undefined;
  return { kind: 'error', key: settingsErrorKey(r.status, code), ...(code === 'step_up_required' ? { stepUp: true } : {}), ...(r.status === 401 ? { signIn: true } : {}) };
};

export async function loadSettings(f: Fetch, id: string): Promise<{ kind: 'ok'; view: SettingsView } | Failure> {
  const r = await call(f, 'GET', `/clubs/${encodeURIComponent(id)}/settings`);
  if (!r) return down;
  if (r.status !== 200) return failure(r);
  const settings = r.json['settings'];
  if (!Array.isArray(settings)) return down;
  return { kind: 'ok', view: { editable: r.json['editable'] === true, settings: settings as SettingRow[] } };
}

export async function saveSetting(f: Fetch, id: string, key: string, value: unknown): Promise<{ kind: 'saved' } | Failure> {
  const r = await call(f, 'PUT', `/clubs/${encodeURIComponent(id)}/settings/${encodeURIComponent(key)}`, { value });
  if (!r) return down;
  return r.status === 200 ? { kind: 'saved' } : failure(r);
}
