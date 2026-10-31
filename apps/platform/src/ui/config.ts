import { errorKey, type Failure } from './club';

// The platform settings page's logic (P6 config): read the values that are set, change one (PUT /config/{key}). Apart from the
// screen so it can be tested without a browser. Nothing here has a default: a setting that is not set shows as not set.

type Fetch = typeof fetch;
export type Kind = 'number' | 'list';
/** The settings the system reads, in the order they are shown, with the kind of value each takes and its text key. */
/** `fixed`: a product constant (LINE-07, the PRD); the database refuses any change, so the page shows it and offers no control. */
export const KNOWN: ReadonlyArray<{ key: string; kind: Kind; fixed?: true }> = [
  { key: 'console_enrolment_ttl_hours', kind: 'number' },
  { key: 'invite_ttl_hours', kind: 'number' },
  { key: 'tester_invite_ttl_hours', kind: 'number' },
  { key: 'staff_invite_ttl_hours', kind: 'number' },
  { key: 'pay_tap_limit_count', kind: 'number' },
  { key: 'pay_tap_limit_window_seconds', kind: 'number' },
  { key: 'qr_expiry_margin_seconds', kind: 'number' },
  { key: 'line_send_max_attempts', kind: 'number' },
  { key: 'line_send_retry_seconds', kind: 'number' },
  { key: 'line_cap_alert_percent', kind: 'number', fixed: true },
  { key: 'line_cap_reminders_stop_percent', kind: 'number', fixed: true },
  { key: 'line_cap_over_limit_percent', kind: 'number', fixed: true },
  { key: 'required_launch_checks', kind: 'list' },
];
export const labelKey = (key: string): string => `X-new.config_${key}`;
export const isKnown = (key: string): boolean => KNOWN.some((k) => k.key === key);

/** How a value is written in its box: a number as it is, anything else as JSON. */
export const show = (value: unknown): string => (typeof value === 'number' || typeof value === 'string' ? String(value) : JSON.stringify(value));

export type Parsed = { ok: true; value: unknown } | { ok: false; key: string };
export function parse(kind: Kind, raw: string): Parsed {
  const text = raw.trim();
  if (kind === 'number') return /^[0-9]+(\.[0-9]+)?$/.test(text) && Number(text) > 0 ? { ok: true, value: Number(text) } : { ok: false, key: 'X-new.config_number_needed' };
  try {
    const v: unknown = JSON.parse(text);
    return Array.isArray(v) ? { ok: true, value: v } : { ok: false, key: 'X-new.config_json_needed' };
  } catch {
    return { ok: false, key: 'X-new.config_json_needed' };
  }
}

const down: Failure = { kind: 'error', key: 'X-new.club_unavailable' };
export async function loadConfig(f: Fetch): Promise<{ kind: 'ok'; values: Record<string, unknown> } | Failure> {
  try {
    const res = await f('/api/config');
    const json = (await res.json().catch(() => ({}))) as { config?: Array<{ key: string; value: unknown }>; code?: string };
    if (res.status === 200 && Array.isArray(json.config)) return { kind: 'ok', values: Object.fromEntries(json.config.map((c) => [c.key, c.value])) };
    return { kind: 'error', key: errorKey(res.status, json.code), ...(res.status === 401 ? { signIn: true } : {}) };
  } catch {
    return down;
  }
}

export async function saveValue(f: Fetch, key: string, kind: Kind, raw: string): Promise<{ kind: 'saved' } | Failure> {
  const parsed = parse(kind, raw);
  if (!parsed.ok) return { kind: 'error', key: parsed.key };
  try {
    const res = await f(`/api/config/${encodeURIComponent(key)}`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ value: parsed.value }) });
    if (res.status === 200) return { kind: 'saved' };
    const json = (await res.json().catch(() => ({}))) as { code?: string };
    if (json.code === 'invalid') return { kind: 'error', key: 'X-new.config_invalid' };
    return { kind: 'error', key: errorKey(res.status, json.code), ...(json.code === 'step_up_required' ? { stepUp: true } : {}), ...(res.status === 401 ? { signIn: true } : {}) };
  } catch {
    return down;
  }
}
