import { SETTINGS, checkSettingWrite, otherGroupLimitKey } from '@booq/domain';
import type { PlatformDb } from '@booq/db';

// GET /clubs/{id}/settings and PUT /clubs/{id}/settings/{key} (F01; PLAT-05, PLAT-04-AC1, PLAT-02; design 5.1, 10).
// BOOQ staff set up a club's settings in the console: Hunter's setup (D108) is these writes. Transport-neutral, like the other
// platform services. The same rule as the owner's route decides what a value may be (the settings registry through
// checkSettingWrite): a key outside the registry, a value of the wrong shape, an unset of a required setting and a slip-only setting
// for a Beam club are all refused, and no value is ever supplied here (a setting stays empty until someone sets it).
//   * Who: an active staff member who can see the club (an admin, or the assigned specialist). A club they may not see is not_found.
//   * When: the club is Draft or Testing, or its owner opened the support window (platform.club_editable, migration 0008); the
//     database refuses the write too. Otherwise look_only, and the owner's own PUT /settings/:key remains the way to change it.
//   * Step up: a write needs a fresh second factor (SR-16), like creating a club.
//   * Audit: the club's own audit log gets the old and new value with the staff member as actor (trigger on club_setting, migration
//     0005), and the console log (P6) gets the key as the target, never the value.

export interface SettingsActor {
  staffId: string;
  /** True when the staff member passed a second factor within the step-up window (SR-16). */
  stepUpFresh: boolean;
}
export interface SettingRow {
  key: string;
  value: unknown;
  unset: boolean;
  /** Go live needs it set (design 9.3); a setting the PRD leaves open, and a slip-only one, are not required. */
  required: boolean;
  /** False for a setting that exists only for a slip checking club, when this club chose Beam. */
  available: boolean;
}
export type ListSettingsResult = { ok: true; settings: SettingRow[]; editable: boolean } | { ok: false; code: 'not_found' };
export type SetSettingResult =
  | { ok: true; key: string; value: unknown }
  | { ok: false; code: 'not_found' | 'invalid' | 'step_up_required' | 'look_only' | 'unknown_setting' | 'not_available' | 'cannot_unset' | 'invalid_value' };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface Staff {
  id: string;
  display_name: string;
  role: string;
  active: boolean;
}

export function createSettingsService(deps: { db: PlatformDb }) {
  const { db } = deps;

  async function loadStaff(staffId: string): Promise<Staff | null> {
    if (!UUID.test(staffId)) return null;
    const row = await db.withPlatformTx({ staffId: null }, async (tx) => (await tx.query<Staff>('select id, display_name, role, active from platform.staff_by_id($1)', [staffId])).rows[0] ?? null);
    return row && row.active ? row : null;
  }

  async function list(staffId: string, clubId: string): Promise<ListSettingsResult> {
    const staff = await loadStaff(staffId);
    if (!staff || !UUID.test(clubId)) return { ok: false, code: 'not_found' };
    return db.withPlatformTx({ staffId: staff.id, staffLabel: staff.display_name, clubId }, async (tx): Promise<ListSettingsResult> => {
      const club = (await tx.query<{ payment_option: string | null }>('select payment_option from public.club where id = $1', [clubId])).rows[0];
      if (!club) return { ok: false, code: 'not_found' };
      const stored = new Map((await tx.query<{ key: string; value: unknown }>('select key, value from public.club_setting where club_id = $1', [clubId])).rows.map((r) => [r.key, r.value]));
      const editable = (await tx.query<{ e: boolean }>('select platform.club_editable($1) as e', [clubId])).rows[0]?.e === true;
      return {
        ok: true,
        editable,
        settings: SETTINGS.map((s) => ({
          key: s.key,
          value: stored.has(s.key) ? stored.get(s.key) : null,
          unset: !stored.has(s.key),
          required: !s.unsetAllowed && !s.slipOnly,
          available: !s.slipOnly || club.payment_option === 'slip',
        })),
      };
    });
  }

  async function set(actor: SettingsActor, clubId: string, key: string, body: unknown): Promise<SetSettingResult> {
    const staff = await loadStaff(actor.staffId);
    if (!staff) return { ok: false, code: 'not_found' };
    const input = typeof body === 'object' && body !== null && !Array.isArray(body) ? (body as Record<string, unknown>) : null;
    if (!input || Object.keys(input).length !== 1 || !('value' in input)) return { ok: false, code: 'invalid' };
    if (!actor.stepUpFresh) return { ok: false, code: 'step_up_required' };
    if (!UUID.test(clubId)) return { ok: false, code: 'not_found' };
    const value = input['value'];

    return db.withPlatformTx({ staffId: staff.id, staffLabel: staff.display_name, clubId }, async (tx): Promise<SetSettingResult> => {
      const club = (await tx.query<{ payment_option: string | null }>('select payment_option from public.club where id = $1', [clubId])).rows[0];
      if (!club) return { ok: false, code: 'not_found' };
      const otherKey = otherGroupLimitKey(key);
      const other = otherKey ? (await tx.query<{ value: unknown }>('select value from public.club_setting where club_id = $1 and key = $2', [clubId, otherKey])).rows[0]?.value : undefined;
      const w = checkSettingWrite({ key, value, paymentOption: club.payment_option, otherGroupLimit: other });
      if (!w.ok) return { ok: false, code: w.code };
      if (!(await tx.query<{ e: boolean }>('select platform.club_editable($1) as e', [clubId])).rows[0]?.e) return { ok: false, code: 'look_only' };
      if (w.action === 'unset') {
        await tx.query('delete from public.club_setting where club_id = $1 and key = $2', [clubId, key]);
      } else {
        await tx.query(
          `insert into public.club_setting (club_id, key, value) values ($1, $2, $3::jsonb)
           on conflict (club_id, key) do update set value = excluded.value, updated_at = app.now()`,
          [clubId, key, JSON.stringify(w.value)],
        );
      }
      await tx.query('select platform.write_audit($1, $2, $3, $4, $5::jsonb, null, null)', ['club.setting_changed', clubId, 'club_setting', key, JSON.stringify({ unset: w.action === 'unset' })]);
      return { ok: true, key, value: w.action === 'unset' ? null : w.value };
    });
  }

  return { list, set };
}
