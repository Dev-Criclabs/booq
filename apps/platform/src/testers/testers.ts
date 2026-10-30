import { hashInviteToken, newInviteToken } from '@booq/auth';
import type { PlatformDb } from '@booq/db';

// BOOQ testers (F01-T28; PLAT-07-AC5, AC6; D4, D100, D102; design 5.2 `GET/PUT /clubs/{id}/testers`).
// A tester link gives the player role only, so unlike the owner link it is returned to the staff member
// once, at creation, to hand to the tester; only its hash is stored and nothing can read it back.
// The tester signs in with LINE as an ordinary player: no BOOQ credential is involved (ROLE-02-AC2).

export type CreateTesterInviteResult = { ok: true; link: string } | { ok: false; code: 'not_found' | 'not_available' };
export type ListTestersResult =
  | { ok: true; testers: Array<{ id: string; added_at: string; removed_at: string | null; display_name: string | null }>; pendingInvites: number }
  | { ok: false; code: 'not_found' };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface Staff {
  id: string;
  display_name: string;
  role: string;
  active: boolean;
}

export function createTesterService(deps: { db: PlatformDb; baseUrl: string }) {
  const { db } = deps;
  const baseUrl = deps.baseUrl.replace(/\/+$/, '');

  async function loadStaff(staffId: string): Promise<Staff | null> {
    if (!UUID.test(staffId)) return null;
    const row = await db.withPlatformTx({ staffId: null }, async (tx) => (await tx.query<Staff>('select id, display_name, role, active from platform.staff_by_id($1)', [staffId])).rows[0] ?? null);
    return row && row.active ? row : null;
  }

  const ctx = (s: Staff, clubId: string) => ({ staffId: s.id, staffLabel: s.display_name, clubId });

  function mapError(e: unknown): 'not_found' | 'not_available' | null {
    const err = e as { code?: string; message?: string };
    const m = /^tester:(\w+)/.exec(err.message ?? '');
    if (err.code !== 'P0001' || !m) return null;
    if (m[1] === 'not_found') return 'not_found';
    if (m[1] === 'not_a_start') return 'not_available';
    return null;
  }

  async function createTesterInvite(staffId: string, clubId: string): Promise<CreateTesterInviteResult> {
    const staff = await loadStaff(staffId);
    if (!staff || !UUID.test(clubId)) return { ok: false, code: 'not_found' };
    const token = newInviteToken();
    try {
      const slug = await db.withPlatformTx(ctx(staff, clubId), async (tx) => {
        await tx.query('select platform.create_tester_invite($1, $2)', [clubId, hashInviteToken(token)]);
        return (await tx.query<{ slug: string }>('select slug from public.club where id = $1', [clubId])).rows[0]?.slug;
      });
      if (!slug) return { ok: false, code: 'not_found' };
      return { ok: true, link: `${baseUrl}/c/${slug}/join?invite=${token}` };
    } catch (e) {
      const code = mapError(e);
      if (!code) throw e;
      return { ok: false, code };
    }
  }

  async function listTesters(staffId: string, clubId: string): Promise<ListTestersResult> {
    const staff = await loadStaff(staffId);
    if (!staff || !UUID.test(clubId)) return { ok: false, code: 'not_found' };
    const r = await db.withPlatformTx(ctx(staff, clubId), async (tx) =>
      (await tx.query<{ r: { testers: Array<{ id: string; added_at: string; removed_at: string | null; display_name: string | null }>; pending_invites: number } | null }>('select platform.club_testers($1) as r', [clubId])).rows[0]?.r ?? null);
    return r ? { ok: true, testers: r.testers, pendingInvites: r.pending_invites } : { ok: false, code: 'not_found' };
  }

  async function removeTester(staffId: string, clubId: string, testerId: string): Promise<{ ok: true } | { ok: false; code: 'not_found' }> {
    const staff = await loadStaff(staffId);
    if (!staff || !UUID.test(clubId) || !UUID.test(testerId)) return { ok: false, code: 'not_found' };
    try {
      await db.withPlatformTx(ctx(staff, clubId), (tx) => tx.query('select platform.remove_tester($1, $2)', [clubId, testerId]));
      return { ok: true };
    } catch (e) {
      const code = mapError(e);
      if (code !== 'not_found') throw e;
      return { ok: false, code };
    }
  }

  return { createTesterInvite, listTesters, removeTester };
}
