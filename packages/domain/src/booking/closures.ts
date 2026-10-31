import type { Tx } from '../../../db/src/tx';
import { BookingError } from './errors';
import { toBangkokIso } from './time';

// F09-T13: the A12 closures (CANCEL-03; F09 design 4.6 to 4.8, 5). Front desk and owner (closure.write; the database checks
// the role again). Preview and create share one input: courtIds, start and end (ISO date-times; any minute range), and an
// optional repeat ({kind: 'daily'} or {kind: 'weekly', weekdays: [1..7]}, optional until 'YYYY-MM-DD') that the database
// validates. Create passes the platform's limit on bookings ended at once (app.closure_cancel_limit, null when unset, A-7).
// Refusals come back as 'closure:<code>'; 'closure:busy' after the retries is the route's 409.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,6})?)?(Z|[+-]\d{2}:\d{2})$/;

export interface ClosureInput {
  courtIds?: unknown;
  start?: unknown;
  end?: unknown;
  repeat?: unknown;
}

function parse(input: ClosureInput): [string[], string, string, string | null] {
  const { courtIds, start, end, repeat } = input;
  if (!Array.isArray(courtIds) || courtIds.length === 0 || courtIds.length > 100 || !courtIds.every((c) => typeof c === 'string' && UUID.test(c))) {
    throw new BookingError('bad_input');
  }
  for (const t of [start, end]) if (typeof t !== 'string' || !ISO.test(t) || Number.isNaN(Date.parse(t))) throw new BookingError('bad_input');
  if (repeat !== undefined && repeat !== null && (typeof repeat !== 'object' || Array.isArray(repeat))) throw new BookingError('bad_input');
  return [courtIds as string[], start as string, end as string, repeat === undefined || repeat === null ? null : JSON.stringify(repeat)];
}

const idOf = (id: unknown): string => {
  if (typeof id !== 'string' || !UUID.test(id)) throw new BookingError('not_found');
  return id;
};

export async function previewClosure(tx: Tx, input: ClosureInput) {
  const r = await tx.query<{ r: Record<string, unknown> }>('select app.closure_preview($1::uuid[], $2, $3, $4::jsonb) as r', parse(input));
  return r.rows[0]!.r;
}

export async function createClosure(tx: Tx, input: ClosureInput & { reason?: unknown }) {
  const args = parse(input);
  if (input.reason !== undefined && input.reason !== null && (typeof input.reason !== 'string' || input.reason.length > 500)) throw new BookingError('bad_input');
  const r = await tx.query<{ r: Record<string, unknown> }>(
    'select app.create_closure($1::uuid[], $2, $3, $4::jsonb, $5, app.closure_cancel_limit()) as r',
    [...args, input.reason ?? null],
  );
  return r.rows[0]!.r;
}

interface ClosureRow {
  id: string;
  reason: string;
  range_start: Date;
  range_end: Date;
  repeat_rule: unknown;
  status: string;
  created_by: string;
  created_at: Date;
  ended_at: Date | null;
  court_ids: string[];
}

/** The club's closures, newest first, with their courts (read under the staff policy of 1002). */
export async function listClosures(tx: Tx) {
  const r = await tx.query<ClosureRow>(
    `select c.id, c.reason, c.range_start, c.range_end, c.repeat_rule, c.status, c.created_by, c.created_at, c.ended_at,
            coalesce((select array_agg(cr.resource_id order by cr.resource_id) from public.closure_resource cr
                       where cr.club_id = c.club_id and cr.closure_id = c.id), '{}') as court_ids
       from public.closure c
      where c.club_id = app.club_id()
      order by c.created_at desc, c.id`,
  );
  return {
    closures: r.rows.map((c) => ({
      id: c.id, reason: c.reason, start: toBangkokIso(c.range_start), end: toBangkokIso(c.range_end), repeat: c.repeat_rule,
      status: c.status, courtIds: c.court_ids, createdBy: c.created_by, createdAt: toBangkokIso(c.created_at),
      endedAt: c.ended_at ? toBangkokIso(c.ended_at) : null,
    })),
  };
}

export async function endClosure(tx: Tx, id: unknown, input: { newEnd?: unknown; reason?: unknown }) {
  const closure = idOf(id);
  const { newEnd, reason } = input;
  if (newEnd !== undefined && newEnd !== null && (typeof newEnd !== 'string' || !ISO.test(newEnd) || Number.isNaN(Date.parse(newEnd)))) throw new BookingError('bad_input');
  if (reason !== undefined && reason !== null && (typeof reason !== 'string' || reason.length > 500)) throw new BookingError('bad_input');
  const r = await tx.query<{ r: Record<string, unknown> }>('select app.end_closure($1, $2, $3) as r', [closure, newEnd ?? null, reason ?? null]);
  return r.rows[0]!.r;
}

/** After the save (AC12): the expired packages whose credit the closure returned, for the owner to extend. */
export async function closureExpiredPackages(tx: Tx, id: unknown) {
  const r = await tx.query<{ r: unknown }>('select app.closure_cancelled_expired_packages($1) as r', [idOf(id)]);
  return { packages: r.rows[0]!.r };
}

/** The players the closure's message could not reach (AC15, D118), read from the outbox. */
export async function closureUnmessaged(tx: Tx, id: unknown) {
  const r = await tx.query<{ r: unknown }>('select app.closure_unmessaged($1) as r', [idOf(id)]);
  return { players: r.rows[0]!.r };
}
