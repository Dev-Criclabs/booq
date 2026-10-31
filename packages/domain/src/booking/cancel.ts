import type { Tx } from '../../../db/src/tx';
import { readBooking } from './player';

// F09-T12: the player's cancel (CANCEL-01-AC1 to AC12, AC14; F09 design 4.1, 4.2, 5). The rule lives in the database:
// app.cancel_outcome answers the C13b sheet and app.cancel_booking applies the same rule under its locks, so the sheet
// and the result agree and the client never sends an outcome. Own bookings only: another player's, another club's or a
// malformed id is not found (ROLE-01-AC4). A staff member cancels their own booking here as a player (D115). Refusals come
// from the database as 'cancel:<code>'; the route maps them. The answers hold codes, ids and numbers only (no staff reason).

interface Reader {
  userId: string | null;
  roles: readonly string[];
}

export interface CancelPreview {
  bookingId: string;
  /** in_time, late or full (a club cancel, a changed coach or an edited session). */
  outcome: string;
  windowHours: number;
  [part: string]: unknown;
}

export interface CancelResult {
  bookingId: string;
  outcome: string;
  version: number;
  returned: unknown;
  /** A second tap or a second device: the earlier cancel, unchanged (AC14). */
  repeated: boolean;
}

export async function previewOwnCancel(tx: Tx, reader: Reader, id: unknown): Promise<CancelPreview> {
  const row = await readBooking(tx, reader, id, false);
  const r = await tx.query<{ r: { outcome: string; windowHours: number } & Record<string, unknown> }>('select app.cancel_outcome($1) as r', [row.id]);
  return { bookingId: row.id, ...r.rows[0]!.r };
}

export async function cancelOwnBooking(tx: Tx, reader: Reader, id: unknown): Promise<CancelResult> {
  const row = await readBooking(tx, reader, id, false);
  const r = await tx.query<{ r: { outcome: string; version: number; returned: unknown; repeated: boolean } }>(
    'select app.cancel_booking($1) as r',
    [row.id],
  );
  const x = r.rows[0]!.r;
  return { bookingId: row.id, outcome: x.outcome, version: x.version, returned: x.returned, repeated: x.repeated };
}
