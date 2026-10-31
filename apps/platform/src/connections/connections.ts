import { writeSecretAsStaff, type SecretKind } from '@booq/secrets';
import type { PlatformTx } from '@booq/db';

// The LINE and payment connections of a club, as BOOQ staff set them up (F01-T23 part c; P2 steps 4
// and 5; PLAT-02-AC8, D27, D32, SR-02, SR-03, SR-16). The platform app holds only the public key:
// it can write a secret and never read one back, so a connection test runs on the values typed in the
// same request, not on what is stored. Plaintext lives in memory for the length of the request and is
// never returned, logged or put in an audit entry; only the last four characters are kept (by the database).
//
// The network calls (LINE, Beam) are behind two small interfaces. The real adapters belong with the
// payments and LINE packages (F05, F10); this module needs only a pass or a failure code from them.

export interface LineProbe {
  /** One authenticated read of the messaging channel. Returns the official account's basic id when it has one. */
  check(input: { channelAccessToken: string; expectedBasicId?: string | undefined; loginChannelId?: string | undefined; liffId?: string | undefined }): Promise<{ ok: true; basicId?: string } | { ok: false; code: string }>;
}

export interface BeamProbe {
  /** One authenticated read-only call with that key set; no money moves. Returns the merchant id the key belongs to. */
  check(input: { apiKey: string; merchantId: string; mode: 'test' | 'live' }): Promise<{ ok: true; merchantId: string } | { ok: false; code: string }>;
}

export type TestOutcome = { result: 'pass' } | { result: 'fail'; code: string };

export interface ConnectionPlan {
  section: 'line' | 'payments';
  /** Non-secret columns of the connection table. */
  columns: Record<string, string | number | null>;
  /** Written to the club row (payments only). */
  paymentOption?: string;
  secrets: Array<{ kind: SecretKind; value: string }>;
  /** null when no test was asked for. */
  test: TestOutcome | null;
  /** The staff member chose to save although the test failed (D167); the failed check is recorded in club_health. */
  saveAnyway: boolean;
}

export interface AppliedConnection {
  changed: string[];
  detail: Record<string, unknown>;
  connectionTest?: TestOutcome;
}

const LINE_FIELDS = ['login_channel_id', 'messaging_channel_id', 'liff_id', 'oa_basic_id'] as const;
const LINE_SECRETS = ['line_channel_token', 'line_channel_secret', 'line_login_secret'] as const;
const PAY_FIELDS = ['merchant_id_test', 'merchant_id_live'] as const;
const PAY_SECRETS = ['beam_api_key_test', 'beam_hmac_key_test', 'beam_api_key_live', 'beam_hmac_key_live'] as const;
const MAX = 4096;

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const text = (v: unknown): v is string => typeof v === 'string' && v.trim() !== '' && v.length <= MAX;

export interface ConnectionsDeps {
  /** The public key of the secrets envelope (the platform app holds nothing that can decrypt). */
  encryptKey: string;
  line: LineProbe;
  beam: BeamProbe;
}

export function createConnections(deps: ConnectionsDeps) {
  async function runLine(token: string, expectedBasicId?: string, ids: { loginChannelId?: string; liffId?: string } = {}): Promise<TestOutcome> {
    try {
      const r = await deps.line.check({ channelAccessToken: token, expectedBasicId, ...ids });
      if (!r.ok) return { result: 'fail', code: r.code };
      if (expectedBasicId !== undefined && r.basicId !== undefined && r.basicId !== expectedBasicId) return { result: 'fail', code: 'oa_mismatch' };
      return { result: 'pass' };
    } catch {
      return { result: 'fail', code: 'unreachable' };
    }
  }

  async function runBeam(apiKey: string, merchantId: string, mode: 'test' | 'live'): Promise<TestOutcome> {
    try {
      const r = await deps.beam.check({ apiKey, merchantId, mode });
      if (!r.ok) return { result: 'fail', code: r.code };
      return r.merchantId === merchantId ? { result: 'pass' } : { result: 'fail', code: 'merchant_mismatch' };
    } catch {
      return { result: 'fail', code: 'unreachable' };
    }
  }

  /** Validates a section body and, when a test is asked for, runs it. No database is touched. */
  async function prepare(section: 'line' | 'payments', body: unknown): Promise<{ ok: true; plan: ConnectionPlan } | { ok: false }> {
    if (!isObject(body)) return { ok: false };
    const wantTest = body['test'];
    if (wantTest !== undefined && typeof wantTest !== 'boolean') return { ok: false };
    const saveAnyway = body['save_anyway'];
    if (saveAnyway !== undefined && (typeof saveAnyway !== 'boolean' || wantTest !== true)) return { ok: false };
    const fields: readonly string[] = section === 'line' ? LINE_FIELDS : PAY_FIELDS;
    const secretKinds: readonly string[] = section === 'line' ? LINE_SECRETS : PAY_SECRETS;
    const columns: ConnectionPlan['columns'] = {};
    const secrets: ConnectionPlan['secrets'] = [];
    let paymentOption: string | undefined;
    for (const [k, v] of Object.entries(body)) {
      if (k === 'test' || k === 'save_anyway') continue;
      if (fields.includes(k)) {
        if (!text(v)) return { ok: false };
        columns[k] = v.trim();
      } else if (secretKinds.includes(k)) {
        if (!text(v)) return { ok: false };
        secrets.push({ kind: k as SecretKind, value: v });
      } else if (k === 'line_plan_kind') {
        if (v !== 'free' && v !== 'paid') return { ok: false };
        columns[k] = v;
      } else if (k === 'plan_message_limit') {
        if (v !== null && !(Number.isInteger(v) && (v as number) > 0)) return { ok: false };
        columns[k] = v as number | null;
      } else if (k === 'payment_option') {
        if (v !== 'beam' && v !== 'slip') return { ok: false };
        paymentOption = v;
      } else if (k === 'test_mode') {
        if (v !== 'test' && v !== 'live') return { ok: false };
      } else {
        return { ok: false };
      }
    }
    if (Object.keys(body).filter((k) => k !== 'test' && k !== 'test_mode' && k !== 'save_anyway').length === 0) return { ok: false };

    let test: TestOutcome | null = null;
    if (wantTest === true) {
      if (section === 'line') {
        const token = body['line_channel_token'];
        if (!text(token)) return { ok: false };
        test = await runLine(token, typeof columns['oa_basic_id'] === 'string' ? (columns['oa_basic_id'] as string) : undefined, {
          ...(typeof columns['login_channel_id'] === 'string' ? { loginChannelId: columns['login_channel_id'] as string } : {}),
          ...(typeof columns['liff_id'] === 'string' ? { liffId: columns['liff_id'] as string } : {}),
        });
      } else {
        const mode = body['test_mode'];
        if (mode !== 'test' && mode !== 'live') return { ok: false };
        const key = body[`beam_api_key_${mode}`];
        const merchant = columns[`merchant_id_${mode}`];
        if (!text(key) || typeof merchant !== 'string') return { ok: false };
        test = await runBeam(key, merchant, mode);
      }
    } else if (body['test_mode'] !== undefined) {
      return { ok: false };
    }
    return { ok: true, plan: { section, columns, ...(paymentOption ? { paymentOption } : {}), secrets, test, saveAnyway: saveAnyway === true } };
  }

  /** Writes a prepared plan in the caller's transaction. The database checks the staff member, the club and the window. */
  async function apply(tx: PlatformTx, clubId: string, plan: ConnectionPlan): Promise<AppliedConnection> {
    const table = plan.section === 'line' ? 'public.line_connection' : 'public.payment_connection';
    const passed = plan.test?.result === 'pass';
    const cols = Object.keys(plan.columns);
    const names = ['club_id', ...cols, 'tested_at'];
    const values = [clubId, ...cols.map((c) => plan.columns[c])];
    const placeholders = [...values.map((_, i) => `$${i + 1}`), passed ? 'app.now()' : 'null'];
    const updates = [...cols, 'tested_at'].map((c) => `${c} = excluded.${c}`);
    // Any change makes the connection untested again unless this request's test passed.
    await tx.query(
      `insert into ${table} (${names.join(', ')}) values (${placeholders.join(', ')}) on conflict (club_id) do update set ${updates.join(', ')}`,
      values,
    );
    if (plan.paymentOption !== undefined) {
      const r = await tx.query('update public.club set payment_option = $2 where id = $1', [clubId, plan.paymentOption]);
      if (r.rowCount !== 1) throw new Error('connections: the club row was not updated');  // i18n-ignore internal assertion or start up error, logged, never shown to a user
    }
    for (const s of plan.secrets) await writeSecretAsStaff(tx, deps.encryptKey, clubId, s.kind, s.value);
    // A tested connection leaves its result in club_health: a pass clears an old failure, a failure that was saved anyway shows in P1 (D167).
    if (plan.test) {
      const check = healthCheck(plan.section, plan.test);
      if (check) await tx.query('select platform.record_connection_check($1, $2, $3)', [clubId, check.key, check.reason]);
    }

    const fields = [...cols, ...(plan.paymentOption !== undefined ? ['payment_option'] : [])];
    return {
      changed: [...fields, ...plan.secrets.map((s) => s.kind)],
      // Names only: the values of ids and secrets are not log content. Secret kinds are values, not keys.
      detail: {
        section: plan.section,
        fields,
        secrets: plan.secrets.map((s) => s.kind),
        tested: plan.test === null ? null : passed,
        ...(plan.test?.result === 'fail' ? { test_code: plan.test.code } : {}),
      },
      ...(plan.test ? { connectionTest: plan.test } : {}),
    };
  }

  /** "Test connection": the probe on the values given, nothing written. */
  async function test(kind: 'line' | 'beam', body: unknown): Promise<({ ok: true } & TestOutcome) | { ok: false; code: 'invalid' }> {
    if (!isObject(body)) return { ok: false, code: 'invalid' };
    const keys = Object.keys(body);
    if (kind === 'line') {
      const token = body['channel_access_token'];
      const basic = body['oa_basic_id'];
      const login = body['login_channel_id'];
      const liff = body['liff_id'];
      if (!text(token) || keys.some((k) => !['channel_access_token', 'oa_basic_id', 'login_channel_id', 'liff_id'].includes(k)) || (basic !== undefined && !text(basic)) || (login !== undefined && !text(login)) || (liff !== undefined && !text(liff))) return { ok: false, code: 'invalid' };
      return { ok: true, ...(await runLine(token, basic as string | undefined, { ...(login ? { loginChannelId: login as string } : {}), ...(liff ? { liffId: liff as string } : {}) })) };
    }
    const { mode, api_key: apiKey, merchant_id: merchant } = body;
    if ((mode !== 'test' && mode !== 'live') || !text(apiKey) || !text(merchant) || keys.length !== 3) return { ok: false, code: 'invalid' };
    return { ok: true, ...(await runBeam(apiKey, merchant, mode)) };
  }

  return { prepare, apply, test };
}

/** Which club_health row a probe result belongs to, and its reason (null: ok). A failure with no row of its own (an id of the wrong form) is only logged. */
export function healthCheck(section: 'line' | 'payments', test: TestOutcome): { key: string; reason: string | null } | null {
  if (test.result === 'pass') return { key: section === 'line' ? 'line_token' : 'beam_keys', reason: null };
  const code = test.code;
  if (section === 'line') return code.startsWith('messaging_api_') ? { key: 'line_token', reason: code.slice('messaging_api_'.length).slice(0, 40) } : null;
  if (code === 'not_configured') return { key: 'beam_keys', reason: 'keys_missing' };
  if (code === 'key_refused') return { key: 'beam_keys', reason: 'key_refused' };
  if (code === 'unreachable') return { key: 'beam_charge', reason: 'unreachable' };
  return null;
}

export type Connections = ReturnType<typeof createConnections>;
