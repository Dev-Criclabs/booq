import { call, type Outcome } from './api';

// A16 Settings: the club's rules (F11-T22; ADMIN-16; PLAT-05). GET /settings lists every setting the role may read with its value or "not set"; PUT
// /settings/{key} changes one (null unsets one that may be empty). The shape of each setting is known here only to turn what was typed into a value;
// the server checks it again and refuses a wrong one. No value is ever supplied: a setting nobody has set stays empty.

type Fetch = typeof fetch;

export interface SettingRow { key: string; value: unknown; unset: boolean; required: boolean; available: boolean }

export type Field =
  | { kind: 'whole'; min: number; unit: string | null }
  | { kind: 'choice'; options: ReadonlyArray<{ value: string; labelKey: string }> }
  | { kind: 'bool' }
  | { kind: 'days' }
  | { kind: 'discount' };

interface Def { group: 'booking' | 'payment' | 'coaches' | 'packages' | 'other'; labelKey: string; field: Field }
const mins = 'A-new.set_unit_minutes';
const hrs = 'A-new.set_unit_hours';
/** The groups and labels of the board (H-A16-Settings): A keys where the board has the text, new keys for the rest. */
export const DEFS: Record<string, Def> = {
  booking_window_days: { group: 'booking', labelKey: 'A-0324', field: { kind: 'whole', min: 1, unit: 'A-new.set_unit_days_ahead' } },
  cancel_window_hours: { group: 'booking', labelKey: 'A-0326', field: { kind: 'whole', min: 0, unit: 'A-new.set_unit_hours_before' } },
  max_future_court_hours: { group: 'booking', labelKey: 'A-0328', field: { kind: 'whole', min: 1, unit: hrs } },
  hold_minutes: { group: 'payment', labelKey: 'A-0331', field: { kind: 'choice', options: [{ value: '10', labelKey: 'A-0332' }, { value: '15', labelKey: 'A-0333' }, { value: '20', labelKey: 'A-0334' }] } },
  package_qr_minutes: { group: 'payment', labelKey: 'A-0338', field: { kind: 'whole', min: 1, unit: mins } },
  waitlist_claim_minutes: { group: 'payment', labelKey: 'A-0339', field: { kind: 'whole', min: 1, unit: mins } },
  waitlist_no_offer_hours: { group: 'payment', labelKey: 'A-0341', field: { kind: 'whole', min: 0, unit: 'A-new.set_unit_hours_of_start' } },
  auto_slip_check: { group: 'payment', labelKey: 'A-new.set_auto_slip_check', field: { kind: 'bool' } },
  rest_cap_hours: { group: 'coaches', labelKey: 'A-0344', field: { kind: 'whole', min: 1, unit: hrs } },
  group_min_players: { group: 'coaches', labelKey: 'A-new.set_group_min_players', field: { kind: 'whole', min: 1, unit: null } },
  group_max_players: { group: 'coaches', labelKey: 'A-new.set_group_max_players', field: { kind: 'whole', min: 1, unit: null } },
  below_min_alert_minutes: { group: 'coaches', labelKey: 'A-0347', field: { kind: 'whole', min: 1, unit: 'A-new.set_unit_minutes_before' } },
  package_expiry_reminder_days: { group: 'packages', labelKey: 'A-0350', field: { kind: 'days' } },
  wallet_expiry_months: { group: 'packages', labelKey: 'A-0352', field: { kind: 'whole', min: 1, unit: 'A-new.set_unit_months' } },
  resource_label: { group: 'other', labelKey: 'A-new.set_resource_label', field: { kind: 'choice', options: [{ value: 'court', labelKey: 'A-new.set_label_court' }, { value: 'table', labelKey: 'A-new.set_label_table' }, { value: 'lane', labelKey: 'A-new.set_label_lane' }] } },
  birthday_discount: { group: 'other', labelKey: 'A-new.set_birthday_discount', field: { kind: 'discount' } },
};
/** vat_enabled is the VAT switch of the Business and tax card, not a row of the rules. */
export const BUSINESS_KEYS: ReadonlySet<string> = new Set(['vat_enabled']);
export const GROUPS: ReadonlyArray<{ id: Def['group']; titleKey: string }> = [
  { id: 'booking', titleKey: 'A-0322' }, { id: 'payment', titleKey: 'A-0330' }, { id: 'coaches', titleKey: 'A-0343' }, { id: 'packages', titleKey: 'A-0349' }, { id: 'other', titleKey: 'A-new.set_group_other' },
];
export const DISCOUNT_KINDS = ['percent', 'fixed'] as const;

/** The settings of a group the server listed, in the board's order. A key this page does not know is not drawn (it has no label to show). */
export const rowsOf = (rows: readonly SettingRow[], group: Def['group']): SettingRow[] =>
  Object.keys(DEFS).filter((k) => DEFS[k]!.group === group).map((k) => rows.find((r) => r.key === k)).filter((r): r is SettingRow => !!r);

/** What a box starts with: the value as typed, a list as `7, 3`, the discount as `percent 1000`; empty for a setting nobody set. */
export function draftOf(row: SettingRow): string {
  if (row.unset || row.value === null || row.value === undefined) return '';
  const v = row.value;
  if (Array.isArray(v)) return v.join(', ');
  if (typeof v === 'object') return `${String((v as { kind?: unknown }).kind)} ${String((v as { value?: unknown }).value)}`;
  return String(v);
}

export type Parsed = { ok: true; value: unknown } | { ok: false; key: string };
export function parseDraft(row: SettingRow, draft: string): Parsed {
  const def = DEFS[row.key];
  const text = draft.trim();
  if (text === '') return row.required ? { ok: false, key: 'A-new.set_err_empty' } : { ok: true, value: null };
  if (!def) return { ok: false, key: 'A-new.set_err_unknown' };
  const f = def.field;
  switch (f.kind) {
    case 'whole':
      return /^\d+$/.test(text) && Number.isSafeInteger(Number(text)) && Number(text) >= f.min ? { ok: true, value: Number(text) } : { ok: false, key: 'A-new.set_err_whole' };
    case 'choice':
      return f.options.some((o) => o.value === text) ? { ok: true, value: /^\d+$/.test(text) ? Number(text) : text } : { ok: false, key: 'A-new.set_err_choice' };
    case 'bool':
      return text === 'true' || text === 'false' ? { ok: true, value: text === 'true' } : { ok: false, key: 'A-new.set_err_choice' };
    case 'days': {
      const parts = text.split(',').map((p) => p.trim());
      if (parts.some((p) => !/^\d+$/.test(p))) return { ok: false, key: 'A-new.set_err_days' };
      const days = parts.map(Number);
      return new Set(days).size === days.length ? { ok: true, value: days } : { ok: false, key: 'A-new.set_err_days' };
    }
    case 'discount': {
      const [kind, amount, ...rest] = text.split(/\s+/);
      if (rest.length > 0 || !(DISCOUNT_KINDS as readonly string[]).includes(kind ?? '') || !/^\d+$/.test(amount ?? '')) return { ok: false, key: 'A-new.set_err_discount' };
      return { ok: true, value: { kind, value: Number(amount) } };
    }
  }
}

export const loadRules = async (slug: string, f: Fetch): Promise<Outcome<SettingRow[]>> => call<SettingRow[]>(slug, '/settings', f);
export const saveRule = (slug: string, key: string, value: unknown, f: Fetch) => call<{ key: string; value: unknown }>(slug, `/settings/${encodeURIComponent(key)}`, f, { method: 'PUT', body: { value } });

export const RULE_ERROR_KEY: Record<string, string> = {
  invalid_value: 'A-new.set_err_refused', unknown_setting: 'A-new.set_err_unknown', not_available: 'A-new.set_err_not_available', cannot_unset: 'A-new.set_err_empty', invalid_input: 'A-new.set_err_input',
};
export function ruleErrorKey(o: Outcome<unknown>): string {
  if (o.kind === 'forbidden') return 'A-new.set_err_forbidden';
  if (o.kind === 'refused') return RULE_ERROR_KEY[o.code] ?? 'A-new.set_err_general';
  return 'A-new.set_err_general';
}
