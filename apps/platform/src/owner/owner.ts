import { hashInviteToken, newInviteToken } from '@booq/auth';
import type { PlatformDb, PlatformTx } from '@booq/db';
import { LINE_USER_ID } from '../line-id';

// The owner invite and the owner contact (F01-T23 part b; SR-01, D122, ROLE-02-AC8; review T18 R5;
// design 5.2 and 7.1). Transport-neutral, like the other platform services.
//
// The link is created here and emailed to club.owner_email by the system: it is never returned to the
// staff member and never logged. Only its SHA-256 hash is stored. The console shows status only.

export interface OwnerActor {
  staffId: string;
  /** True when the staff member passed a second factor within the step-up window (SR-16). */
  stepUpFresh: boolean;
}

/** An email the system sends to the owner. The wording is two locale keys with these values; the mailer renders them. */
export interface InviteMail {
  to: string;
  language: 'th' | 'en';
  subjectKey: 'L-new.owner_invite_subject';
  bodyKey: 'L-new.owner_invite_body';
  params: { clubName: string; link: string };
}

export interface InviteMailer {
  sendOwnerInvite(mail: InviteMail): Promise<void>;
}

export function createStubInviteMailer(sink: InviteMail[]): InviteMailer {
  return { sendOwnerInvite: async (m) => void sink.push(m) };
}

type Code = 'not_found' | 'forbidden' | 'invalid' | 'step_up_required' | 'owner_contact_missing' | 'look_only' | 'same_admin' | 'not_redeemed' | 'already_verified' | 'not_pending';
type Failure = { ok: false; code: Code };
export type CreateInviteResult = { ok: true; status: 'sent' } | Failure | { ok: false; code: 'mail_failed' };
export type InviteStatusResult = { ok: true; invite: Record<string, unknown> } | { ok: false; code: 'not_found' };
export type OwnerContactResult = { ok: true; applied: true } | { ok: true; applied: false; requestId: string } | Failure;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const OWNER_FIELDS = ['owner_name', 'owner_phone', 'owner_line', 'owner_email'];
const MAX = 200;

interface Staff {
  id: string;
  display_name: string;
  role: string;
  active: boolean;
}

export function createOwnerService(deps: { db: PlatformDb; mailer: InviteMailer; baseUrl: string }) {
  const { db, mailer } = deps;
  const baseUrl = deps.baseUrl.replace(/\/+$/, '');

  async function loadStaff(staffId: string): Promise<Staff | null> {
    if (!UUID.test(staffId)) return null;
    const row = await db.withPlatformTx({ staffId: null }, async (tx) => (await tx.query<Staff>('select id, display_name, role, active from platform.staff_by_id($1)', [staffId])).rows[0] ?? null);
    return row && row.active ? row : null;
  }

  /** Maps a database refusal ('owner_invite:<code>') to the code the route answers with. */
  function mapError(e: unknown): Code | null {
    const err = e as { code?: string; message?: string };
    const m = /^owner_invite:(\w+)/.exec(err.message ?? '');
    if (err.code !== 'P0001' || !m) return null;
    switch (m[1]) {
      case 'not_found': case 'club_context': return 'not_found';
      case 'admin_only': return 'forbidden';
      case 'owner_contact_missing': case 'look_only': case 'same_admin': case 'not_redeemed': case 'already_verified': case 'not_pending':
        return m[1];
      case 'invalid_field': return 'invalid';
      default: return null;
    }
  }

  const ctx = (staff: Staff, clubId: string) => ({ staffId: staff.id, staffLabel: staff.display_name, clubId });
  const log = (tx: PlatformTx, action: string, club: string, detail: Record<string, unknown> = {}) =>
    tx.query('select platform.write_audit($1, $2, $3, $4, $5::jsonb, null, null)', [action, club, 'club', club, JSON.stringify(detail)]);

  async function createOwnerInvite(actor: OwnerActor, clubId: string): Promise<CreateInviteResult> {
    const staff = await loadStaff(actor.staffId);
    if (!staff) return { ok: false, code: 'not_found' };
    if (!actor.stepUpFresh) return { ok: false, code: 'step_up_required' };
    if (!UUID.test(clubId)) return { ok: false, code: 'not_found' };
    const token = newInviteToken();
    let mail: InviteMail;
    try {
      mail = await db.withPlatformTx(ctx(staff, clubId), async (tx) => {
        await tx.query('select platform.create_owner_invite($1, $2)', [clubId, hashInviteToken(token)]);
        const c = (await tx.query<{ slug: string; name_th: string; name_en: string; default_language: 'th' | 'en'; owner_email: string }>(
          'select slug, name_th, name_en, default_language, owner_email from public.club where id = $1', [clubId])).rows[0];
        if (!c) throw Object.assign(new Error('owner_invite:not_found'), { code: 'P0001' });
        await log(tx, 'club.owner_invite_created', clubId);
        return {
          to: c.owner_email,
          language: c.default_language,
          subjectKey: 'L-new.owner_invite_subject',
          bodyKey: 'L-new.owner_invite_body',
          params: { clubName: c.default_language === 'th' ? c.name_th : c.name_en, link: `${baseUrl}/c/${c.slug}/join?invite=${token}` },
        } satisfies InviteMail;
      });
    } catch (e) {
      const code = mapError(e);
      if (!code) throw e;
      return { ok: false, code };
    }
    try {
      await mailer.sendOwnerInvite(mail);
    } catch {
      // Nobody holds the link, so the invite is harmless; a fresh one replaces it.
      await db.withPlatformTx(ctx(staff, clubId), (tx) => log(tx, 'club.owner_invite_mail_failed', clubId));
      return { ok: false, code: 'mail_failed' };
    }
    return { ok: true, status: 'sent' };
  }

  async function getOwnerInvite(staffId: string, clubId: string): Promise<InviteStatusResult> {
    const staff = await loadStaff(staffId);
    if (!staff || !UUID.test(clubId)) return { ok: false, code: 'not_found' };
    const invite = await db.withPlatformTx(ctx(staff, clubId), async (tx) =>
      (await tx.query<{ s: Record<string, unknown> | null }>('select platform.owner_invite_status($1) as s', [clubId])).rows[0]?.s ?? null);
    return invite ? { ok: true, invite } : { ok: false, code: 'not_found' };
  }

  async function confirmOwnerVerified(actor: OwnerActor, clubId: string): Promise<{ ok: true } | Failure> {
    const staff = await loadStaff(actor.staffId);
    if (!staff) return { ok: false, code: 'not_found' };
    if (!actor.stepUpFresh) return { ok: false, code: 'step_up_required' };
    if (!UUID.test(clubId)) return { ok: false, code: 'not_found' };
    try {
      await db.withPlatformTx(ctx(staff, clubId), (tx) => tx.query('select platform.confirm_owner_verified($1)', [clubId]));
      return { ok: true };
    } catch (e) {
      const code = mapError(e);
      if (!code) throw e;
      return { ok: false, code };
    }
  }

  async function changeOwnerContact(actor: OwnerActor, clubId: string, body: unknown): Promise<OwnerContactResult> {
    const staff = await loadStaff(actor.staffId);
    if (!staff) return { ok: false, code: 'not_found' };
    const input = typeof body === 'object' && body !== null && !Array.isArray(body) ? (body as Record<string, unknown>) : null;
    const keys = input ? Object.keys(input) : [];
    if (!input || keys.length === 0 || keys.some((k) => !OWNER_FIELDS.includes(k) || typeof input[k] !== 'string' || (input[k] as string).trim() === '' || (input[k] as string).length > MAX)) {
      return { ok: false, code: 'invalid' };
    }
    if (input['owner_email'] !== undefined && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(input['owner_email'] as string)) return { ok: false, code: 'invalid' };
    if (input['owner_line'] !== undefined && !LINE_USER_ID.test(input['owner_line'] as string)) return { ok: false, code: 'invalid' };
    if (!actor.stepUpFresh) return { ok: false, code: 'step_up_required' };
    if (!UUID.test(clubId)) return { ok: false, code: 'not_found' };
    try {
      const r = await db.withPlatformTx(ctx(staff, clubId), async (tx) =>
        (await tx.query<{ r: { applied: boolean; request_id?: string } }>('select platform.change_owner_contact($1, $2::jsonb) as r', [clubId, JSON.stringify(input)])).rows[0]?.r);
      if (!r) throw new Error('change_owner_contact returned nothing');
      return r.applied ? { ok: true, applied: true } : { ok: true, applied: false, requestId: r.request_id as string };
    } catch (e) {
      const code = mapError(e);
      if (!code) throw e;
      return { ok: false, code };
    }
  }

  async function decideOwnerContactChange(actor: OwnerActor, clubId: string, requestId: string, approve: boolean): Promise<{ ok: true } | Failure> {
    const staff = await loadStaff(actor.staffId);
    if (!staff) return { ok: false, code: 'not_found' };
    if (!actor.stepUpFresh) return { ok: false, code: 'step_up_required' };
    if (!UUID.test(clubId) || !UUID.test(requestId)) return { ok: false, code: 'not_found' };
    try {
      await db.withPlatformTx(ctx(staff, clubId), (tx) => tx.query('select platform.decide_owner_contact_change($1, $2)', [requestId, approve]));
      return { ok: true };
    } catch (e) {
      const code = mapError(e);
      if (!code) throw e;
      return { ok: false, code };
    }
  }

  return { createOwnerInvite, getOwnerInvite, confirmOwnerVerified, changeOwnerContact, decideOwnerContactChange };
}
