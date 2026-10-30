import type { PlatformDb, PlatformTx } from '@booq/db';

// POST /clubs/{id}/status {to, reason?} (F01-T21; PLAT-01-AC2, AC3, AC8, AC9, ROLE-AC5; design 5.2).
// Transport-neutral: the route passes the staff id and whether the second factor is fresh (the
// `stepUpFresh` flag from authenticate(), SR-16). The rules live in the database
// (app.set_club_status); this module adds the 404 for clubs the caller cannot see, the role
// answer for pause and resume, the body validation and the P6 log.
//
// Pause and resume are separate routes (F01-T22), admin only; this route points an admin there.

export interface StatusActor {
  staffId: string;
  /** True when the staff member passed a second factor within the step-up window. */
  stepUpFresh: boolean;
}

export type StatusResult =
  | { ok: true; from: string; to: string }
  | { ok: false; code: 'not_found' | 'forbidden' | 'use_pause' | 'invalid' | 'step_up_required' | 'transition_not_allowed' }
  | { ok: false; code: 'blocked'; missing: Array<{ item: string; owed_by?: string; result?: string }> };

const STATUSES = ['draft', 'testing', 'live', 'paused'];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_REASON = 500;

interface Staff {
  id: string;
  display_name: string;
  role: string;
  active: boolean;
}

export function createStatusService(deps: { db: PlatformDb }) {
  const { db } = deps;

  async function loadStaff(staffId: string): Promise<Staff | null> {
    if (!UUID.test(staffId)) return null;
    const row = await db.withPlatformTx({ staffId: null }, async (tx) => (await tx.query<Staff>('select id, display_name, role, active from platform.staff_by_id($1)', [staffId])).rows[0] ?? null);
    return row && row.active ? row : null;
  }

  const writeLog = (tx: PlatformTx, action: string, club: string | null, detail: Record<string, unknown>, reason: string | null) =>
    tx.query('select platform.write_audit($1, $2, $3, $4, $5::jsonb, $6, null)', [action, club, club ? 'club' : null, club, JSON.stringify(detail), reason]);

  /** A refusal is logged (P6) in its own transaction, because the refused one may have been rolled back. */
  async function refuse(staff: Staff, club: string | null, clubRef: string, to: unknown, result: StatusResult, code: string): Promise<StatusResult> {
    await db.withPlatformTx({ staffId: staff.id, staffLabel: staff.display_name }, (tx) =>
      writeLog(tx, 'club.status_refused', club, { code, to: typeof to === 'string' ? to : null, ...(club ? {} : { club_ref: clubRef }) }, null),
    );
    return result;
  }

  async function changeStatus(actor: StatusActor, clubId: string, body: unknown): Promise<StatusResult> {
    const staff = await loadStaff(actor.staffId);
    if (!staff) return { ok: false, code: 'not_found' };

    const input = typeof body === 'object' && body !== null && !Array.isArray(body) ? (body as Record<string, unknown>) : null;
    const keys = input ? Object.keys(input) : [];
    const to = input?.['to'];
    const reason = input?.['reason'];
    if (!input || keys.some((k) => k !== 'to' && k !== 'reason') || typeof to !== 'string' || !STATUSES.includes(to)
        || (reason !== undefined && (typeof reason !== 'string' || reason.length > MAX_REASON))) {
      return { ok: false, code: 'invalid' };
    }
    if (!actor.stepUpFresh) return { ok: false, code: 'step_up_required' };
    if (!UUID.test(clubId)) return refuse(staff, null, clubId, to, { ok: false, code: 'not_found' }, 'not_found');

    type Outcome = { kind: 'done'; from: string } | { kind: 'refused'; result: StatusResult; code: string; club: string | null };
    let outcome: Outcome;
    try {
      outcome = await db.withPlatformTx({ staffId: staff.id, staffLabel: staff.display_name, clubId }, async (tx): Promise<Outcome> => {
        // The club row is visible only to an admin or the assigned specialist (migration 0008).
        const seen = await tx.query<{ status: string }>('select status from public.club where id = $1', [clubId]);
        const from = seen.rows[0]?.status;
        if (!from) return { kind: 'refused', result: { ok: false, code: 'not_found' }, code: 'not_found', club: null };
        if (to === 'paused' || from === 'paused') {
          // Only a platform admin pauses or resumes (D15), and through its own route.
          const code = staff.role === 'platform_admin' ? 'use_pause' : 'forbidden';
          return { kind: 'refused', result: { ok: false, code }, code, club: clubId };
        }
        await tx.query('select app.set_club_status($1, $2)', [to, reason ?? null]);
        await writeLog(tx, 'club.status_changed', clubId, { from, to, ...(typeof reason === 'string' && reason ? { reason } : {}) }, typeof reason === 'string' && reason ? reason : null);
        return { kind: 'done', from };
      });
    } catch (e) {
      const err = e as { code?: string; message?: string; detail?: string };
      const m = /^club_status:(\w+)$/.exec(err.message ?? '');
      if (err.code !== 'P0001' || !m) throw e;
      const code = m[1] as string;
      if (code === 'blocked') {
        const missing = JSON.parse(err.detail ?? '[]') as Array<{ item: string; owed_by?: string; result?: string }>;
        return refuse(staff, clubId, clubId, to, { ok: false, code: 'blocked', missing }, 'blocked');
      }
      if (code === 'transition_not_allowed') return refuse(staff, clubId, clubId, to, { ok: false, code }, code);
      if (code === 'not_found' || code === 'actor_required') return refuse(staff, null, clubId, to, { ok: false, code: 'not_found' }, 'not_found');
      if (code === 'admin_only') return refuse(staff, clubId, clubId, to, { ok: false, code: 'forbidden' }, 'forbidden');
      if (code === 'use_pause') return refuse(staff, clubId, clubId, to, { ok: false, code: 'use_pause' }, 'use_pause');
      throw e;
    }
    if (outcome.kind === 'done') return { ok: true, from: outcome.from, to };
    return refuse(staff, outcome.club, clubId, to, outcome.result, outcome.code);
  }

  return { changeStatus };
}
