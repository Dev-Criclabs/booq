// Player data requests (F01-T33, part 1; PDPA-01-AC3 to AC7). A player asks for a copy of their
// data or for deletion; the owner or front desk handles it. Every step is a row change on
// data_request, which the audit trigger records with the actor (AC7); the staff note is a
// personal-value column and stays out of the plain audit columns. A player never sees another
// player's request and never handles one. Completing a delete request needs app.anonymise_user
// (Architect, migration pending), so `done` on a delete request is refused until it exists.

export type DataRequestErrorCode = 'forbidden' | 'not_found' | 'bad_transition' | 'erasure_not_available';
export class DataRequestError extends Error {
  constructor(readonly code: DataRequestErrorCode) {
    super(code);
  }
}

export interface DataRequestTx {
  // Rows are untyped here: the caller's own transaction type fits this shape.
  query(text: string, params?: unknown[]): Promise<{ rows: any[]; rowCount?: number | null }>;
}
export interface DataRequestActor {
  clubId: string;
  userId: string | null;
  roles: readonly string[];
}
export type DataRequestKind = 'copy' | 'delete';
export type DataRequestAction = 'start' | 'done' | 'decline';

export interface DataRequest {
  id: string;
  kind: DataRequestKind;
  status: 'requested' | 'in_progress' | 'done' | 'declined';
  userId: string;
  requestedAt: string;
  handledBy: string | null;
  handledAt: string | null;
}
export interface OpenDataRequest extends DataRequest {
  fullName: string | null;
  note: string | null;
}

const COLUMNS = 'r.id, r.kind, r.status, r.user_id, r.requested_at, r.handled_by, r.handled_at';
const iso = (v: unknown) => (v ? new Date(v as string).toISOString() : null);
const toRequest = (r: any): DataRequest => ({
  id: r.id,
  kind: r.kind,
  status: r.status,
  userId: r.user_id,
  requestedAt: iso(r.requested_at)!,
  handledBy: r.handled_by,
  handledAt: iso(r.handled_at),
});

const isStaff = (a: DataRequestActor) => a.roles.includes('owner') || a.roles.includes('front_desk');

export function createDataRequestService() {
  return {
    async create(tx: DataRequestTx, actor: DataRequestActor, input: { kind: DataRequestKind }): Promise<DataRequest> {
      if (!actor.userId) throw new DataRequestError('forbidden');
      // One open request of a kind per player: a second tap returns the first.
      const open = (
        await tx.query(`select ${COLUMNS} from public.data_request r where r.user_id = $1 and r.kind = $2 and r.status in ('requested', 'in_progress') order by r.requested_at limit 1`, [actor.userId, input.kind])
      ).rows[0];
      if (open) return toRequest(open);
      const row = (
        await tx.query(`insert into public.data_request (club_id, user_id, kind) values (app.club_id(), $1, $2) returning id as id, kind, status, user_id, requested_at, handled_by, handled_at`, [actor.userId, input.kind])
      ).rows[0];
      return toRequest(row);
    },

    async listOwn(tx: DataRequestTx, actor: DataRequestActor): Promise<DataRequest[]> {
      if (!actor.userId) throw new DataRequestError('forbidden');
      return (await tx.query(`select ${COLUMNS} from public.data_request r where r.user_id = $1 order by r.requested_at desc`, [actor.userId])).rows.map(toRequest);
    },

    async listOpen(tx: DataRequestTx, actor: DataRequestActor): Promise<OpenDataRequest[]> {
      if (!isStaff(actor)) throw new DataRequestError('forbidden');
      const rows = (
        await tx.query(
          `select ${COLUMNS}, r.note, u.full_name from public.data_request r
             left join public.app_user u on u.club_id = r.club_id and u.id = r.user_id
            where r.status in ('requested', 'in_progress') order by r.requested_at`,
        )
      ).rows;
      return rows.map((r) => ({ ...toRequest(r), fullName: r.full_name ?? null, note: r.note ?? null }));
    },

    async handle(tx: DataRequestTx, actor: DataRequestActor, id: string, input: { action: DataRequestAction; note?: string }): Promise<DataRequest> {
      if (!isStaff(actor) || !actor.userId) throw new DataRequestError('forbidden');
      const cur = (await tx.query('select kind, status from public.data_request where id = $1 for update', [id])).rows[0];
      if (!cur) throw new DataRequestError('not_found');
      if (cur.status === 'done' || cur.status === 'declined') throw new DataRequestError('bad_transition');
      if (input.action === 'start' && cur.status !== 'requested') throw new DataRequestError('bad_transition');
      if (input.action === 'done' && cur.kind === 'delete') throw new DataRequestError('erasure_not_available');
      const status = input.action === 'start' ? 'in_progress' : input.action === 'done' ? 'done' : 'declined';
      const note = input.note?.trim() ? input.note.trim() : null;
      const row = (
        await tx.query(
          `update public.data_request set status = $2, handled_by = $3, handled_at = app.now(), note = coalesce($4, note)
            where id = $1 returning id, kind, status, user_id, requested_at, handled_by, handled_at`,
          [id, status, actor.userId, note],
        )
      ).rows[0];
      return toRequest(row);
    },
  };
}
