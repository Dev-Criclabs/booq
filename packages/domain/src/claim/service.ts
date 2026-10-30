// Claim handling (F01-T31b; PLAT-06-AC7; D105, SR-05). An imported player is claimed only after
// the front desk or owner confirms at the counter. The new player's request is made by F02's
// profile transaction (app.request_claim); this service is the staff side: list the open claims
// with the imported name beside what was typed (A6), confirm or reject. The rules, the merge,
// the rival rejection and the F06 balance transfer handlers live in the database functions
// app.claim_confirm and app.claim_reject (migration 0103), all in the caller's transaction.

export type ClaimErrorCode = 'forbidden' | 'not_found' | 'not_open';
export class ClaimError extends Error {
  constructor(readonly code: ClaimErrorCode) {
    super(code);
  }
}

export interface ClaimTx {
  // Rows are untyped here: the caller's own transaction type fits this shape.
  query(text: string, params?: unknown[]): Promise<{ rows: any[]; rowCount?: number | null }>;
}
export interface ClaimActor {
  clubId: string;
  userId: string | null;
  roles: readonly string[];
}

export interface OpenClaim {
  id: string;
  importedUserId: string;
  importedFullName: string | null;
  claimantUserId: string;
  typedFullName: string;
  typedPhone: string;
  status: 'open';
  requestedAt: string;
}

const isStaff = (a: ClaimActor) => Boolean(a.userId) && (a.roles.includes('owner') || a.roles.includes('front_desk'));

/** The database raises 42501 for a refusal and P0001 for a state problem; nothing else is translated. */
function translate(e: unknown): never {
  const code = (e as { code?: string } | null)?.code;
  if (code === '42501') throw new ClaimError('forbidden');
  if (code === 'P0001' && /no open request/.test(String((e as Error).message))) throw new ClaimError('not_open');
  throw e;
}

export function createClaimService() {
  async function load(tx: ClaimTx, id: string) {
    const row = (await tx.query('select imported_user_id, claimant_user_id, status from public.claim_request where id = $1', [id])).rows[0];
    if (!row) throw new ClaimError('not_found');
    if (row.status !== 'open') throw new ClaimError('not_open');
    return row as { imported_user_id: string; claimant_user_id: string };
  }

  return {
    async listOpen(tx: ClaimTx, actor: ClaimActor): Promise<OpenClaim[]> {
      if (!isStaff(actor)) throw new ClaimError('forbidden');
      const rows = (
        await tx.query(
          `select c.id, c.imported_user_id, i.full_name as imported_full_name, c.claimant_user_id, c.typed_full_name, c.typed_phone, c.requested_at
             from public.claim_request c
             left join public.app_user i on i.club_id = c.club_id and i.id = c.imported_user_id
            where c.status = 'open' order by c.requested_at, c.id`,
        )
      ).rows;
      return rows.map((r) => ({
        id: r.id,
        importedUserId: r.imported_user_id,
        importedFullName: r.imported_full_name ?? null,
        claimantUserId: r.claimant_user_id,
        typedFullName: r.typed_full_name,
        typedPhone: r.typed_phone,
        status: 'open' as const,
        requestedAt: new Date(r.requested_at).toISOString(),
      }));
    },

    async confirm(tx: ClaimTx, actor: ClaimActor, requestId: string): Promise<void> {
      if (!isStaff(actor)) throw new ClaimError('forbidden');
      const r = await load(tx, requestId);
      try {
        await tx.query('select app.claim_confirm($1, $2)', [r.imported_user_id, r.claimant_user_id]);
      } catch (e) {
        translate(e);
      }
    },

    async reject(tx: ClaimTx, actor: ClaimActor, requestId: string): Promise<void> {
      if (!isStaff(actor)) throw new ClaimError('forbidden');
      await load(tx, requestId);
      try {
        await tx.query('select app.claim_reject($1)', [requestId]);
      } catch (e) {
        translate(e);
      }
    },
  };
}
