import type { PlatformDb } from '@booq/db';

// Admin writes of the console (PLAT-04 launch checks, P6 config, the legal notice; migrations 0046 and 0048).
// Each one calls the database function that owns the rule and writes P6 itself, so this module only
// validates the shape, maps the function's refusals to codes, and requires a fresh second factor.
// There is no "run check" operation: a recorded check is set by an admin, the others come from facts.

export interface AdminActor {
  staffId: string;
  stepUpFresh: boolean;
}

type Refusal = { ok: false; code: string } & Record<string, unknown>;
export type RecordCheckResult = { ok: true } | Refusal;
export type SetConfigResult = { ok: true } | Refusal;
export type PublishLegalResult = { ok: true; version: string } | Refusal;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

interface Staff {
  id: string;
  display_name: string;
  role: string;
  active: boolean;
}

export function createAdminService(deps: { db: PlatformDb }) {
  const { db } = deps;

  async function loadAdmin(actor: AdminActor): Promise<Staff | Refusal> {
    if (!UUID.test(actor.staffId)) return { ok: false, code: 'not_found' };
    const row = await db.withPlatformTx({ staffId: null }, async (tx) => (await tx.query<Staff>('select id, display_name, role, active from platform.staff_by_id($1)', [actor.staffId])).rows[0] ?? null);
    if (!row || !row.active) return { ok: false, code: 'not_found' };
    // The functions below check the role themselves; this answer only keeps a specialist from learning more.
    if (row.role !== 'platform_admin') return { ok: false, code: 'forbidden' };
    if (!actor.stepUpFresh) return { ok: false, code: 'step_up_required' };
    return row;
  }

  /** A raised refusal of the form `prefix:code[:a[:b]]`, or null for anything else (which is a real failure). */
  function parts(e: unknown, prefix: string): string[] | null {
    const err = e as { code?: string; message?: string };
    if (err.code !== 'P0001' && err.code !== '42501') return null;
    const m = new RegExp(`^${prefix}:(.+)$`).exec(err.message ?? '');
    return m ? m[1]!.split(':') : null;
  }

  async function recordLaunchCheck(actor: AdminActor, clubId: string, checkKey: unknown, body: unknown): Promise<RecordCheckResult> {
    const admin = await loadAdmin(actor);
    if ('ok' in admin) return admin;
    if (!UUID.test(clubId)) return { ok: false, code: 'not_found' };
    if (typeof checkKey !== 'string' || checkKey === '' || !isObject(body) || typeof body['result'] !== 'string' || Object.keys(body).length !== 1) return { ok: false, code: 'invalid' };
    try {
      await db.withPlatformTx({ staffId: admin.id, staffLabel: admin.display_name, clubId }, (tx) =>
        tx.query('select platform.record_launch_check($1, $2, $3)', [clubId, checkKey, body['result']]),
      );
      return { ok: true };
    } catch (e) {
      const p = parts(e, 'launch_check');
      const map: Record<string, string> = { not_found: 'not_found', forbidden: 'forbidden', not_testing: 'not_testing', not_recorded: 'not_recorded', invalid_result: 'invalid' };
      if (p && map[p[0]!]) return { ok: false, code: map[p[0]!]! };
      throw e;
    }
  }

  async function setConfig(actor: AdminActor, key: string, body: unknown): Promise<SetConfigResult> {
    const admin = await loadAdmin(actor);
    if ('ok' in admin) return admin;
    if (!isObject(body) || !('value' in body) || Object.keys(body).length !== 1 || body['value'] === null || body['value'] === undefined) return { ok: false, code: 'invalid' };
    try {
      await db.withPlatformTx({ staffId: admin.id, staffLabel: admin.display_name }, (tx) =>
        tx.query('select platform.set_config_value($1, $2::jsonb)', [key, JSON.stringify(body['value'])]),
      );
      return { ok: true };
    } catch (e) {
      const p = parts(e, 'config');
      if (p?.[0] === 'forbidden') return { ok: false, code: 'forbidden' };
      if (p?.[0] === 'invalid_value') return { ok: false, code: 'invalid' };
      throw e;
    }
  }

  async function publishLegalRelease(actor: AdminActor, body: unknown): Promise<PublishLegalResult> {
    const admin = await loadAdmin(actor);
    if ('ok' in admin) return admin;
    if (!isObject(body) || !isObject(body['texts']) || Object.keys(body).length !== 1) return { ok: false, code: 'invalid' };
    try {
      const r = await db.withPlatformTx({ staffId: admin.id, staffLabel: admin.display_name }, (tx) =>
        tx.query<{ v: string }>('select platform.publish_legal_release($1::jsonb) as v', [JSON.stringify(body['texts'])]),
      );
      return { ok: true, version: r.rows[0]!.v };
    } catch (e) {
      const p = parts(e, 'legal');
      if (p?.[0] === 'not_allowed') return { ok: false, code: 'forbidden' };
      if (p?.[0] === 'invalid_texts') return { ok: false, code: 'invalid', reason: 'invalid_texts' };
      // Which text is missing, or which {field} is unknown, goes back as plain values for the client to word.
      if (p?.[0] === 'missing_text') return { ok: false, code: 'invalid', reason: 'missing_text', kind: p[1] ?? '', language: p[2] ?? '' };
      if (p?.[0] === 'unknown_field') return { ok: false, code: 'invalid', reason: 'unknown_field', field: p[1] ?? '' };
      throw e;
    }
  }

  return { recordLaunchCheck, setConfig, publishLegalRelease };
}
