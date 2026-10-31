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
}

export interface CustomerPage {
  customers: CustomerRow[];
  /** Pass back as `cursor` for the next page; null on the last page. */
  next: string | null;
}

interface Row {
  id: string; display_name: string | null; full_name: string | null; phone: string | null; tags: string[]; claim_state: 'unclaimed' | null;
  signed_in: boolean; last_booking_at: Date | null; booking_count: number; created_at: Date;
}
const map = (r: Row): CustomerRow => ({
  customerId: r.id, name: r.full_name ?? r.display_name, phone: r.phone, tags: r.tags, claimState: r.claim_state, signedIn: r.signed_in,
  lastBookingAt: r.last_booking_at ? r.last_booking_at.toISOString() : null, bookingCount: r.booking_count, createdAt: r.created_at.toISOString(),
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

/** GET /staff/customers?q=&tag=&cursor=: the club's customers by name, 50 a page. */
export async function listCustomers(tx: Tx, q: unknown, tag: unknown, cursor: unknown): Promise<CustomerPage> {
  const after = decodeCursor(cursor);
  const r = await tx.query<Row>(`select * from public.customer_list($1, $2, $3, $4, $5)`,
    [text(q, 100), text(tag, 40), after?.name ?? null, after?.id ?? null, PAGE + 1]);
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
