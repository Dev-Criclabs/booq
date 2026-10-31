import type { Tx } from '../../../db/src/tx';
import { AdminError } from './errors';

// F11-T08: A17's audit log and A2's booking history (ADMIN-17, ADMIN-04; PLAT-04, D28). Read only: there is no write path. The owner reads
// the log through the table policy; front desk reads one booking's history through public.booking_history. Personal values are never returned:
// only the names of the personal fields that changed (SR-04, FA 8.2).

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const RECORD_TYPE = /^[a-z][a-z0-9_]{0,60}$/;
const PAGE = 50;
const bad = (): never => {
  throw new AdminError('bad_input');
};
const opt = (v: unknown): string | null => (v === undefined || v === null || v === '' ? null : typeof v === 'string' ? v : bad());

export interface AuditRow {
  entryId: string;
  at: string;
  actorType: string;
  actorUserId: string | null;
  actorLabel: string;
  source: string;
  action: string;
  recordType: string;
  recordId: string;
  recordKey: string | null;
  oldValue: unknown;
  newValue: unknown;
  piiFields: string[];
  reason: string | null;
}

/** GET /staff/audit?staff=&type=&record=&from=&to=&cursor= (owner): newest first, 50 a page; the days are Bangkok days. */
export async function auditLog(tx: Tx, q: Record<string, unknown>): Promise<{ entries: AuditRow[]; next: string | null }> {
  const staff = opt(q['staff']);
  const type = opt(q['type']);
  const record = opt(q['record']);
  const from = opt(q['from']);
  const to = opt(q['to']);
  const cursor = opt(q['cursor']);
  if ((staff && !UUID.test(staff)) || (record && !UUID.test(record)) || (type && !RECORD_TYPE.test(type))) return bad();
  if ((from && !DAY.test(from)) || (to && !DAY.test(to)) || (from && to && to < from)) return bad();
  let after: { t: string; s: string } | null = null;
  if (cursor) {
    try {
      const j = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as { t?: unknown; s?: unknown };
      if (typeof j.t !== 'string' || typeof j.s !== 'string' || !/^\d{1,18}$/.test(j.s) || Number.isNaN(Date.parse(j.t))) return bad();
      after = { t: j.t, s: j.s };
    } catch {
      return bad();
    }
  }
  const r = await tx.query(
    `select id, seq, occurred_at, actor_type, actor_user_id, actor_label, source, action, record_type, record_id, record_key, old_value, new_value,
            coalesce(array(select jsonb_object_keys(coalesce(pii_new, pii_old, '{}'::jsonb))), '{}'::text[]) as pii_fields, reason
       from public.audit_entry
      where ($1::uuid is null or actor_user_id = $1) and ($2::text is null or record_type = $2) and ($3::uuid is null or record_id = $3)
        and ($4::date is null or occurred_at >= ($4::date)::timestamp at time zone 'Asia/Bangkok')
        and ($5::date is null or occurred_at < (($5::date + 1)::timestamp at time zone 'Asia/Bangkok'))
        and ($6::timestamptz is null or (occurred_at, seq) < ($6::timestamptz, $7::bigint))
      order by occurred_at desc, seq desc limit ${PAGE + 1}`,
    [staff, type, record, from, to, after?.t ?? null, after?.s ?? null]);
  const rows = r.rows.slice(0, PAGE);
  const last = rows[rows.length - 1];
  return {
    entries: rows.map((x) => ({
      entryId: x.id, at: new Date(x.occurred_at).toISOString(), actorType: x.actor_type, actorUserId: x.actor_user_id, actorLabel: x.actor_label,
      source: x.source, action: x.action, recordType: x.record_type, recordId: x.record_id, recordKey: x.record_key, oldValue: x.old_value,
      newValue: x.new_value, piiFields: x.pii_fields, reason: x.reason,
    })),
    next: r.rows.length > PAGE && last ? Buffer.from(JSON.stringify({ t: new Date(last.occurred_at).toISOString(), s: String(last.seq) })).toString('base64url') : null,
  };
}

export interface BookingHistoryRow {
  at: string;
  kind: 'audit' | 'cancel';
  action: string;
  actor: string | null;
  source: string | null;
  reason: string | null;
  detail: unknown;
  piiFields: string[];
}

/** GET /staff/bookings/:id/history (front desk, owner) */
export async function bookingHistory(tx: Tx, id: unknown): Promise<BookingHistoryRow[]> {
  if (typeof id !== 'string' || !UUID.test(id)) throw new AdminError('not_found');
  const exists = await tx.query(`select 1 from public.booking where id = $1`, [id.toLowerCase()]);
  if (!exists.rows[0]) throw new AdminError('not_found');
  const r = await tx.query(`select * from public.booking_history($1)`, [id.toLowerCase()]);
  return r.rows.map((x) => ({
    at: new Date(x.at).toISOString(), kind: x.source_kind, action: x.action, actor: x.actor_name, source: x.source, reason: x.reason, detail: x.detail, piiFields: x.pii_fields,
  }));
}
