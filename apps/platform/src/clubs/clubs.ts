import { randomUUID } from 'node:crypto';
import type { PlatformDb } from '@booq/db';

// POST /clubs (P2 step 1) and GET /clubs/{id} progress (P3) (F01-T23 part a; PLAT-01-AC1, AC2, AC9;
// design 5.2 and 7.1). Transport-neutral, like the other platform services.
// A club always starts as Draft: status and the support window cannot be sent. The creator, when
// a specialist, is assigned to the club in the same transaction (an admin sees every club).

export interface ClubActor {
  staffId: string;
  /** True when the staff member passed a second factor within the step-up window (SR-16). */
  stepUpFresh: boolean;
}

export type CreateClubResult = { ok: true; id: string } | { ok: false; code: 'not_found' | 'invalid' | 'slug_taken' | 'step_up_required' };

export interface ClubProgress {
  setup: Array<{ item: string; done: boolean; owed_by: 'booq' | 'owner' }>;
  launch: Array<{ item: string; result: string; owed_by: 'booq' | 'owner' }>;
}
export type ProgressResult = { ok: true; progress: ClubProgress } | { ok: false; code: 'not_found' };

const REQUIRED = ['slug', 'name_th', 'name_en'] as const;
const OPTIONAL = ['legal_name', 'tax_id', 'tax_branch', 'registered_address', 'payment_option', 'template_id', 'receipt_prefix',
  'default_language', 'owner_name', 'owner_phone', 'owner_line', 'owner_email', 'plan_trial_ends_at', 'billing_starts_at'] as const;
const MAX = 200;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface Staff {
  id: string;
  display_name: string;
  role: string;
  active: boolean;
}

function validate(body: unknown): Record<string, string> | null {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) return null;
  const input = body as Record<string, unknown>;
  const allowed: readonly string[] = [...REQUIRED, ...OPTIONAL];
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(input)) {
    if (!allowed.includes(k) || typeof v !== 'string') return null;
    const t = v.trim();
    if (t === '' || t.length > MAX) return null;
    out[k] = t;
  }
  if (REQUIRED.some((k) => out[k] === undefined)) return null;
  if (out['owner_email'] !== undefined && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(out['owner_email'])) return null;
  if (out['template_id'] !== undefined && !UUID.test(out['template_id'])) return null;
  return out;
}

export function createClubService(deps: { db: PlatformDb }) {
  const { db } = deps;

  async function loadStaff(staffId: string): Promise<Staff | null> {
    if (!UUID.test(staffId)) return null;
    const row = await db.withPlatformTx({ staffId: null }, async (tx) => (await tx.query<Staff>('select id, display_name, role, active from platform.staff_by_id($1)', [staffId])).rows[0] ?? null);
    return row && row.active ? row : null;
  }

  async function createClub(actor: ClubActor, body: unknown): Promise<CreateClubResult> {
    const staff = await loadStaff(actor.staffId);
    if (!staff) return { ok: false, code: 'not_found' };
    const values = validate(body);
    if (!values) return { ok: false, code: 'invalid' };
    if (!actor.stepUpFresh) return { ok: false, code: 'step_up_required' };

    const id = randomUUID();
    const cols = ['id', ...Object.keys(values), 'created_by_staff'];
    const params = [id, ...Object.values(values), staff.id];
    try {
      await db.withPlatformTx({ staffId: staff.id, staffLabel: staff.display_name, clubId: id }, async (tx) => {
        await tx.query(`insert into public.club (${cols.join(', ')}) values (${cols.map((_, i) => `$${i + 1}`).join(', ')})`, params);
        if (staff.role !== 'platform_admin') {
          await tx.query('insert into platform.staff_assignment (staff_id, club_id) values ($1, $2)', [staff.id, id]);
        }
        await tx.query(`select platform.write_audit('club.created', $1, 'club', $2, $3::jsonb, null, null)`, [id, id, JSON.stringify({ slug: values['slug'] })]);
      });
    } catch (e) {
      const code = (e as { code?: string }).code ?? '';
      if (code === '23505') return { ok: false, code: 'slug_taken' };
      if (/^(22|23)/.test(code)) return { ok: false, code: 'invalid' };
      throw e;
    }
    return { ok: true, id };
  }

  async function getProgress(staffId: string, clubId: string): Promise<ProgressResult> {
    const staff = await loadStaff(staffId);
    if (!staff || !UUID.test(clubId)) return { ok: false, code: 'not_found' };
    const progress = await db.withPlatformTx({ staffId: staff.id, staffLabel: staff.display_name, clubId }, async (tx) =>
      (await tx.query<{ p: ClubProgress | null }>('select platform.club_progress($1) as p', [clubId])).rows[0]?.p ?? null,
    );
    return progress ? { ok: true, progress } : { ok: false, code: 'not_found' };
  }

  return { createClub, getProgress };
}
