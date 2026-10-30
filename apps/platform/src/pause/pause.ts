import type { PlatformDb, PlatformTx } from '@booq/db';

// POST /clubs/{id}/pause and /resume {reason} (F01-T22; PLAT-03-AC1 to AC3, AC10, AC11, PLAT-01-AC8,
// AC10; design 5.2). Only a platform admin pauses or resumes (D15). The rules, the history and the
// pause row are in app.pause_club and app.resume_club; this module checks the caller, validates
// the body, writes P6 and tells the owner. Transport-neutral, like the other platform services.

export interface PauseActor {
  staffId: string;
  /** True when the staff member passed a second factor within the step-up window (SR-16). */
  stepUpFresh: boolean;
}

/** What the owner is told. The text is a locale key (L-new.club_paused, L-new.club_resumed) with these values. */
export interface OwnerNotice {
  clubId: string;
  kind: 'club_paused' | 'club_resumed';
  templateKey: 'L-new.club_paused' | 'L-new.club_resumed';
  params: { clubName: string; reason?: string };
  /** The owner's LINE contact from setup step 1; F10 resolves it to a LINE user. */
  ownerLine: string | null;
}

/** The outbox interface (a stub until F10 builds the LINE outbox). */
export interface OwnerNotifier {
  notifyOwner(notice: OwnerNotice): Promise<void>;
}

export function createStubOwnerNotifier(sink: OwnerNotice[]): OwnerNotifier {
  return { notifyOwner: async (n) => void sink.push(n) };
}

type Refusal = 'not_found' | 'forbidden' | 'invalid' | 'reason_required' | 'step_up_required' | 'transition_not_allowed';
export type PauseResult = { ok: true; ownerNotified: boolean } | { ok: false; code: Refusal };
export type ResumeResult =
  | { ok: true; pausedAt: string; resumedAt: string; handlersRun: number; ownerNotified: boolean }
  | { ok: false; code: Refusal };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_REASON = 500;

interface Staff {
  id: string;
  display_name: string;
  role: string;
  active: boolean;
}

interface ClubRow {
  name_th: string;
  name_en: string;
  default_language: string;
  owner_line: string | null;
}

export function createPauseService(deps: { db: PlatformDb; notifier: OwnerNotifier }) {
  const { db, notifier } = deps;

  async function loadStaff(staffId: string): Promise<Staff | null> {
    if (!UUID.test(staffId)) return null;
    const row = await db.withPlatformTx({ staffId: null }, async (tx) => (await tx.query<Staff>('select id, display_name, role, active from platform.staff_by_id($1)', [staffId])).rows[0] ?? null);
    return row && row.active ? row : null;
  }

  const writeLog = (tx: PlatformTx, action: string, club: string | null, detail: Record<string, unknown>, reason: string | null = null) =>
    tx.query('select platform.write_audit($1, $2, $3, $4, $5::jsonb, $6, null)', [action, club, club ? 'club' : null, club, JSON.stringify(detail), reason]);

  async function refuse(staff: Staff, action: string, club: string | null, clubRef: string, code: Refusal): Promise<{ ok: false; code: Refusal }> {
    await db.withPlatformTx({ staffId: staff.id, staffLabel: staff.display_name }, (tx) =>
      writeLog(tx, action, club, { code, ...(club ? {} : { club_ref: clubRef }) }),
    );
    return { ok: false, code };
  }

  /** The checks both routes share, in order. Returns the reason, or the refusal to give. */
  async function gate(actor: PauseActor, clubId: string, body: unknown, refusedAction: string): Promise<{ staff: Staff; reason: string } | { done: { ok: false; code: Refusal } }> {
    const staff = await loadStaff(actor.staffId);
    if (!staff) return { done: { ok: false, code: 'not_found' } };
    // A specialist may not pause or resume any club (D15); this answer says nothing about the club.
    if (staff.role !== 'platform_admin') return { done: await refuse(staff, refusedAction, null, clubId, 'forbidden') };
    const input = typeof body === 'object' && body !== null && !Array.isArray(body) ? (body as Record<string, unknown>) : null;
    if (!input || Object.keys(input).some((k) => k !== 'reason')) return { done: { ok: false, code: 'invalid' } };
    const reason = input['reason'];
    if (reason !== undefined && typeof reason !== 'string') return { done: { ok: false, code: 'invalid' } };
    if (reason === undefined || reason.trim() === '') return { done: await refuse(staff, refusedAction, null, clubId, 'reason_required') };
    if (reason.length > MAX_REASON) return { done: { ok: false, code: 'invalid' } };
    if (!actor.stepUpFresh) return { done: { ok: false, code: 'step_up_required' } };
    if (!UUID.test(clubId)) return { done: await refuse(staff, refusedAction, null, clubId, 'not_found') };
    return { staff, reason: reason.trim() };
  }

  function mapError(e: unknown): Refusal | null {
    const err = e as { code?: string; message?: string };
    const m = /^club_status:(\w+)$/.exec(err.message ?? '');
    if (err.code !== 'P0001' || !m) return null;
    switch (m[1]) {
      case 'transition_not_allowed': return 'transition_not_allowed';
      case 'admin_only': return 'forbidden';
      case 'reason_required': return 'reason_required';
      case 'not_found': case 'actor_required': return 'not_found';
      default: return null;
    }
  }

  async function tellOwner(staff: Staff, clubId: string, notice: OwnerNotice): Promise<boolean> {
    try {
      await notifier.notifyOwner(notice);
      return true;
    } catch {
      // The status change stands; the failed message is a fact for P6 (and F10's retry).
      await db.withPlatformTx({ staffId: staff.id, staffLabel: staff.display_name }, (tx) => writeLog(tx, 'club.owner_notice_failed', clubId, { kind: notice.kind }));
      return false;
    }
  }

  const clubName = (c: ClubRow) => (c.default_language === 'th' ? c.name_th : c.name_en);

  async function pauseClub(actor: PauseActor, clubId: string, body: unknown): Promise<PauseResult> {
    const g = await gate(actor, clubId, body, 'club.pause_refused');
    if ('done' in g) return g.done;
    const { staff, reason } = g;
    let club: ClubRow;
    try {
      const found = await db.withPlatformTx({ staffId: staff.id, staffLabel: staff.display_name, clubId, reason }, async (tx) => {
        const seen = await tx.query<ClubRow>('select name_th, name_en, default_language, owner_line from public.club where id = $1', [clubId]);
        const c = seen.rows[0];
        if (!c) return null;
        await tx.query('select app.pause_club($1)', [reason]);
        await writeLog(tx, 'club.paused', clubId, { reason }, reason);
        return c;
      });
      if (!found) return refuse(staff, 'club.pause_refused', null, clubId, 'not_found');
      club = found;
    } catch (e) {
      const code = mapError(e);
      if (!code) throw e;
      return refuse(staff, 'club.pause_refused', code === 'not_found' ? null : clubId, clubId, code);
    }
    const notified = await tellOwner(staff, clubId, {
      clubId, kind: 'club_paused', templateKey: 'L-new.club_paused', params: { clubName: clubName(club), reason }, ownerLine: club.owner_line,
    });
    return { ok: true, ownerNotified: notified };
  }

  async function resumeClub(actor: PauseActor, clubId: string, body: unknown): Promise<ResumeResult> {
    const g = await gate(actor, clubId, body, 'club.resume_refused');
    if ('done' in g) return g.done;
    const { staff, reason } = g;
    let club: ClubRow;
    let result: { paused_at: string; resumed_at: string; handlers_run: number };
    try {
      const found = await db.withPlatformTx({ staffId: staff.id, staffLabel: staff.display_name, clubId, reason }, async (tx) => {
        const seen = await tx.query<ClubRow>('select name_th, name_en, default_language, owner_line from public.club where id = $1', [clubId]);
        const c = seen.rows[0];
        if (!c) return null;
        const r = await tx.query<{ r: { paused_at: string; resumed_at: string; handlers_run: number } }>('select app.resume_club($1) as r', [reason]);
        const out = r.rows[0]?.r as { paused_at: string; resumed_at: string; handlers_run: number };
        await writeLog(tx, 'club.resumed', clubId, { reason, handlers_run: out.handlers_run }, reason);
        return { c, out };
      });
      if (!found) return refuse(staff, 'club.resume_refused', null, clubId, 'not_found');
      club = found.c;
      result = found.out;
    } catch (e) {
      const code = mapError(e);
      if (!code) throw e;
      return refuse(staff, 'club.resume_refused', code === 'not_found' ? null : clubId, clubId, code);
    }
    const notified = await tellOwner(staff, clubId, {
      clubId, kind: 'club_resumed', templateKey: 'L-new.club_resumed', params: { clubName: clubName(club) }, ownerLine: club.owner_line,
    });
    return {
      ok: true,
      pausedAt: new Date(result.paused_at).toISOString(),
      resumedAt: new Date(result.resumed_at).toISOString(),
      handlersRun: result.handlers_run,
      ownerNotified: notified,
    };
  }

  return { pauseClub, resumeClub };
}
