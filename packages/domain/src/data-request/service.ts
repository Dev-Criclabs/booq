// Player data requests (F01-T33, part 1; PDPA-01-AC3 to AC7). A player asks for a copy of their
// data or for deletion; the owner or front desk handles it. Every step is a row change on
// data_request, which the audit trigger records with the actor (AC7); the staff note is a
// personal-value column and stays out of the plain audit columns. A player never sees another
// player's request and never handles one. Completing a delete request calls app.anonymise_user
// (migration 0019), which refuses while a future or held booking exists; the preview for staff
// comes from app.deletion_impact.

import { toCsv } from '../export/csv';

export type DataRequestErrorCode = 'forbidden' | 'not_found' | 'bad_transition' | 'future_booking' | 'already_erased';
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

    /**
     * The files of a copy request (PDPA-01-AC3): the player's profile and consents, and the coach's notes about them and the marks
     * of their bookings (F12, D171). Bookings, credits and receipts are added by F03, F06 and F13; the club staff's own notes
     * about a player are never included (A-17, AC6).
     * The caller sends them to the player by LINE (F10).
     */
    async copyFile(tx: DataRequestTx, actor: DataRequestActor, id: string): Promise<{ name: string; data: string }[]> {
      if (!isStaff(actor)) throw new DataRequestError('forbidden');
      const cur = (await tx.query('select kind, status, user_id from public.data_request where id = $1', [id])).rows[0];
      if (!cur) throw new DataRequestError('not_found');
      if (cur.kind !== 'copy' || cur.status === 'declined') throw new DataRequestError('bad_transition');
      const p = (
        await tx.query(
          `select id, full_name, phone, date_of_birth::text as date_of_birth, language, level,
                  to_char(created_at at time zone 'Asia/Bangkok', 'YYYY-MM-DD"T"HH24:MI:SS') as created_at
             from public.app_user where id = $1`,
          [cur.user_id],
        )
      ).rows;
      const c = (
        await tx.query(
          `select notice_version, language, to_char(accepted_at at time zone 'Asia/Bangkok', 'YYYY-MM-DD"T"HH24:MI:SS') as accepted_at
             from public.user_consent where user_id = $1 order by accepted_at`,
          [cur.user_id],
        )
      ).rows;
      // The coach's notes about the player and the marks of their bookings (F12, D171): the club holds them, so the right of access covers them.
      const coach = (await tx.query('select app.f12_export($1) as x', [cur.user_id])).rows[0]?.x as { notes: Array<Record<string, string>>; marks: Array<Record<string, string>> };
      const pc = ['id', 'full_name', 'phone', 'date_of_birth', 'language', 'level', 'created_at'];
      const cc = ['notice_version', 'language', 'accepted_at'];
      const nc = ['date', 'kind', 'note', 'written_at'];
      const mc = ['date', 'kind', 'mark'];
      return [
        { name: 'profile.csv', data: toCsv(pc, p.map((r) => pc.map((k) => r[k]))) },
        { name: 'consents.csv', data: toCsv(cc, c.map((r) => cc.map((k) => r[k]))) },
        { name: 'coach-notes.csv', data: toCsv(nc, coach.notes.map((r) => nc.map((k) => r[k]))) },
        { name: 'attendance.csv', data: toCsv(mc, coach.marks.map((r) => mc.map((k) => r[k]))) },
      ];
    },

    /** What the player will lose, shown before staff confirm a deletion (PDPA-01-AC5). Counts, plus what later features add (credits, wallet). */
    async deletionImpact(tx: DataRequestTx, actor: DataRequestActor, id: string): Promise<Record<string, number>> {
      if (!isStaff(actor)) throw new DataRequestError('forbidden');
      const cur = (await tx.query('select kind, status, user_id from public.data_request where id = $1', [id])).rows[0];
      if (!cur) throw new DataRequestError('not_found');
      if (cur.kind !== 'delete') throw new DataRequestError('bad_transition');
      const out = (await tx.query('select app.deletion_impact($1) as impact', [cur.user_id])).rows[0]?.impact as Record<string, number>;
      return out;
    },

    async handle(tx: DataRequestTx, actor: DataRequestActor, id: string, input: { action: DataRequestAction; note?: string }): Promise<DataRequest> {
      if (!isStaff(actor) || !actor.userId) throw new DataRequestError('forbidden');
      const cur = (await tx.query('select kind, status, user_id from public.data_request where id = $1 for update', [id])).rows[0];
      if (!cur) throw new DataRequestError('not_found');
      if (cur.status === 'done' || cur.status === 'declined') throw new DataRequestError('bad_transition');
      if (input.action === 'start' && cur.status !== 'requested') throw new DataRequestError('bad_transition');
      if (input.action === 'done' && cur.kind === 'delete') {
        try {
          await tx.query('select app.anonymise_user($1)', [cur.user_id]);
        } catch (e) {
          const code = (e as { code?: string } | null)?.code;
          const message = String((e as Error)?.message ?? '');
          if (code === '42501') throw new DataRequestError('forbidden');
          if (code === 'P0001' && /future booking/.test(message)) throw new DataRequestError('future_booking');
          if (code === 'P0001' && /already done/.test(message)) throw new DataRequestError('already_erased');
          throw e;
        }
      }
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
