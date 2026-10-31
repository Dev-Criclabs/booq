import type { Tx } from '../../../db/src/tx';
import { validateFullName, validatePhone } from '../phone';
import { toCsv, type CsvCell } from '../export/csv';
import { AdminError } from './errors';

// F11-T04: A5 Customers (ADMIN-06) and the walk in quick add of A2 (ADMIN-04; D168). The roles and the club scope are the database's; this layer
// validates input and maps rows. The date of birth is not read here. Anything typed is data, never text for the screen.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PAGE = 50;
const bad = (): never => {
  throw new AdminError('bad_input');
};

export interface CustomerRow {
  customerId: string;
  name: string | null;
  phone: string | null;
  tags: string[];
  claimState: 'unclaimed' | null;
  signedIn: boolean;
  lastBookingAt: string | null;
  bookingCount: number;
  createdAt: string;
  /** The price group the date of birth falls in (the board's Adult or Student); null without a date of birth or when not exactly one group fits. */
  group: { id: string; nameTh: string; nameEn: string } | null;
  /** The active package that ends soonest, with credits left; null when there is none. */
  activePackage: { nameTh: string; nameEn: string; creditsLeft: number; expiresAt: string } | null;
  walletSatang: number;
  /** The latest confirmed booking whose hour has started. */
  lastVisitAt: string | null;
}

export interface CustomerPage {
  customers: CustomerRow[];
  /** Pass back as `cursor` for the next page; null on the last page. */
  next: string | null;
}

interface Row {
  id: string; display_name: string | null; full_name: string | null; phone: string | null; tags: string[]; claim_state: 'unclaimed' | null;
  signed_in: boolean; last_booking_at: Date | null; booking_count: number; created_at: Date;
  group_id: string | null; group_name_th: string | null; group_name_en: string | null; package_name_th: string | null; package_name_en: string | null;
  package_credits_left: number | null; package_expires_at: Date | null; wallet_satang: string | number; last_visit_at: Date | null;
}
const map = (r: Row): CustomerRow => ({
  customerId: r.id, name: r.full_name ?? r.display_name, phone: r.phone, tags: r.tags, claimState: r.claim_state, signedIn: r.signed_in,
  lastBookingAt: r.last_booking_at ? r.last_booking_at.toISOString() : null, bookingCount: r.booking_count, createdAt: r.created_at.toISOString(),
  group: r.group_id ? { id: r.group_id, nameTh: r.group_name_th ?? '', nameEn: r.group_name_en ?? '' } : null,
  activePackage: r.package_expires_at
    ? { nameTh: r.package_name_th ?? '', nameEn: r.package_name_en ?? '', creditsLeft: r.package_credits_left ?? 0, expiresAt: r.package_expires_at.toISOString() }
    : null,
  walletSatang: Number(r.wallet_satang),
  lastVisitAt: r.last_visit_at ? r.last_visit_at.toISOString() : null,
});

const text = (v: unknown, max: number): string | null => {
  if (v === undefined || v === null || v === '') return null;
  if (typeof v !== 'string' || v.length > max) return bad();
  return v;
};

function decodeCursor(c: unknown): { name: string; id: string } | null {
  if (c === undefined || c === null || c === '') return null;
  if (typeof c !== 'string') return bad();
  try {
    const j = JSON.parse(Buffer.from(c, 'base64url').toString('utf8')) as { n?: unknown; i?: unknown };
    if (typeof j.n !== 'string' || typeof j.i !== 'string' || !UUID.test(j.i)) return bad();
    return { name: j.n, id: j.i };
  } catch {
    return bad();
  }
}

/**
 * GET /staff/customers?q=&tag=&status=&group=&cursor=: the club's customers by name, 50 a page. status is active_package, expiring_soon or
 * no_visit (the H-A05 chips); group is a price group id (Adult, Student).
 */
export async function listCustomers(tx: Tx, q: unknown, tag: unknown, cursor: unknown, status?: unknown, group?: unknown): Promise<CustomerPage> {
  const after = decodeCursor(cursor);
  const st = text(status, 20);
  if (st !== null && !['active_package', 'expiring_soon', 'no_visit'].includes(st)) return bad();
  const gr = text(group, 40);
  if (gr !== null && !UUID.test(gr)) return bad();
  const r = await tx.query<Row>(`select * from public.customer_list($1, $2, $3, $4, $5, $6, $7)`,
    [text(q, 100), text(tag, 40), after?.name ?? null, after?.id ?? null, PAGE + 1, st, gr ? gr.toLowerCase() : null]);
  const rows = r.rows.slice(0, PAGE);
  const last = rows[rows.length - 1];
  const more = r.rows.length > PAGE && last;
  return {
    customers: rows.map(map),
    next: more ? Buffer.from(JSON.stringify({ n: last.full_name ?? last.display_name ?? '', i: last.id })).toString('base64url') : null,
  };
}

/** POST /staff/customers: a walk in with a name and a phone; no consent is implied and the player confirms at first sign in (D168). */
export async function addCustomer(tx: Tx, body: { name?: unknown; phone?: unknown }): Promise<{ customerId: string }> {
  if (typeof body.name !== 'string' || typeof body.phone !== 'string') return bad();
  const name = validateFullName(body.name);
  if (!name.ok) throw new AdminError('bad_input', { field: 'name', problem: name.code });
  const phone = validatePhone(body.phone);
  if (!phone.ok) throw new AdminError('bad_input', { field: 'phone', problem: phone.code });
  const r = await tx.query<{ id: string }>(`select app.staff_add_customer($1, $2, $3) as id`, [name.value, phone.value, phone.value.replace(/^\+/, '')]);
  return { customerId: r.rows[0]!.id };
}

function customerId(v: unknown): string {
  if (typeof v !== 'string' || !UUID.test(v)) throw new AdminError('not_found');
  return v.toLowerCase();
}

/** POST /staff/customers/:id/tags {tag} and DELETE /staff/customers/:id/tags/:tag. */
export async function setTag(tx: Tx, id: unknown, tag: unknown, on: boolean): Promise<{ ok: true }> {
  if (typeof tag !== 'string' || tag.trim() === '') return bad();
  await tx.query(`select app.customer_tag_set($1, $2, $3)`, [customerId(id), tag, on]);
  return { ok: true };
}

const CSV_COLUMNS = ['name', 'phone', 'tags', 'signed_in', 'bookings', 'last_booking', 'created'] as const;

/** GET /staff/customers/csv: every customer of the club, audited with the row count (ADMIN-06). */
export async function customersCsv(tx: Tx): Promise<{ csv: string; rows: number }> {
  const out: CsvCell[][] = [];
  let cursor: string | null = null;
  for (;;) {
    const page: CustomerPage = await listCustomers(tx, null, null, cursor);
    for (const c of page.customers) {
      out.push([c.name, c.phone, c.tags.join('; '), c.signedIn, c.bookingCount, c.lastBookingAt, c.createdAt]);
    }
    if (!page.next) break;
    cursor = page.next;
  }
  await tx.query(`select app.audit_customer_export($1)`, [out.length]);
  return { csv: toCsv(CSV_COLUMNS, out), rows: out.length };
}

// ---- A6 Customer profile (ADMIN-07) -----------------------------------------------------------------------------------------

export interface CustomerProfile {
  customerId: string;
  displayName: string | null;
  fullName: string | null;
  phone: string | null;
  language: string | null;
  level: string | null;
  /** YYYY-MM-DD; shown to front desk and owner (D55). Its change history is the owner's own route. */
  dateOfBirth: string | null;
  claimState: 'unclaimed' | null;
  signedIn: boolean;
  active: boolean;
  tags: string[];
  createdAt: string;
}

/** GET /staff/customers/:id */
export async function customerProfile(tx: Tx, id: unknown): Promise<CustomerProfile> {
  const r = await tx.query(`select id, display_name, full_name, phone, language, level, to_char(date_of_birth, 'YYYY-MM-DD') as dob, claim_state, signed_in, active, tags, created_at
                              from public.customer_profile($1)`, [customerId(id)]);
  const x = r.rows[0];
  if (!x) throw new AdminError('not_found');
  return {
    customerId: x.id, displayName: x.display_name, fullName: x.full_name, phone: x.phone, language: x.language, level: x.level, dateOfBirth: x.dob,
    claimState: x.claim_state, signedIn: x.signed_in, active: x.active, tags: x.tags, createdAt: new Date(x.created_at).toISOString(),
  };
}

/** GET /staff/customers/:id/bookings */
export async function customerBookings(tx: Tx, id: unknown) {
  await customerProfile(tx, id);
  const r = await tx.query(`select * from public.customer_bookings($1)`, [customerId(id)]);
  return r.rows.map((b) => ({
    bookingId: b.booking_id as string, orderId: b.order_id as string, type: b.type as string, courtName: b.resource_name as string | null,
    coachName: b.coach_name as string | null, classNameTh: b.class_name_th as string | null, classNameEn: b.class_name_en as string | null,
    startAt: new Date(b.start_at).toISOString(), endAt: new Date(b.end_at).toISOString(), status: b.status as string, source: b.source as string,
    cancelKind: b.cancel_kind as string | null, cancelOutcome: b.cancel_outcome as string | null,
  }));
}

/** GET /staff/customers/:id/orders */
export async function customerOrders(tx: Tx, id: unknown) {
  await customerProfile(tx, id);
  const r = await tx.query(`select * from public.customer_orders($1)`, [customerId(id)]);
  return r.rows.map((o) => ({
    orderId: o.order_id as string, status: o.status as string, source: o.source as string, kind: o.kind as string, totalSatang: o.total_satang as number,
    moneySatang: o.money_satang as number, creditValueSatang: o.credit_value_satang as number, walletSatang: o.wallet_satang as number,
    createdAt: new Date(o.created_at).toISOString(), receipts: o.receipts as string[],
  }));
}

export interface StaffNote {
  noteId: string;
  note: string;
  by: string | null;
  at: string;
}

/** GET /staff/customers/:id/notes: staff notes, never shown to the player (PDPA). */
export async function customerNotes(tx: Tx, id: unknown): Promise<StaffNote[]> {
  await customerProfile(tx, id);
  const r = await tx.query(
    `select n.id, n.note, u.display_name as by, n.created_at from public.user_staff_note n left join public.app_user u on u.club_id = n.club_id and u.id = n.created_by
      where n.user_id = $1 order by n.created_at desc, n.id`, [customerId(id)]);
  return r.rows.map((n) => ({ noteId: n.id, note: n.note, by: n.by, at: new Date(n.created_at).toISOString() }));
}

const NOTE_MAX = 2000;

/** POST /staff/customers/:id/notes {note} */
export async function addCustomerNote(tx: Tx, id: unknown, note: unknown): Promise<{ noteId: string }> {
  if (typeof note !== 'string' || note.trim() === '' || note.length > NOTE_MAX) return bad();
  await customerProfile(tx, id);
  const r = await tx.query<{ id: string }>(
    `insert into public.user_staff_note (club_id, user_id, note, created_by) values (app.club_id(), $1, $2, app.user_id()) returning id`, [customerId(id), note.trim()]);
  return { noteId: r.rows[0]!.id };
}
