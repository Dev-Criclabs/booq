import { call, type Outcome } from './api';

// A5 Customers (F11-T15; ADMIN-06; board H-A05-Customers), apart from the screen. GET /staff/customers?q=&tag=&cursor= pages the club's
// customers by name, 50 a page, with their tags, the last booking and how many bookings. Nothing here decides who may see a phone number:
// the server sends it to front desk and owner only.

type Fetch = typeof fetch;

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
  next: string | null;
}

export interface Query {
  q: string;
  tag: string;
  cursor?: string | null;
}

export function listPath(query: Query): string {
  const p = new URLSearchParams();
  if (query.q.trim()) p.set('q', query.q.trim());
  if (query.tag.trim()) p.set('tag', query.tag.trim());
  if (query.cursor) p.set('cursor', query.cursor);
  const s = p.toString();
  return `/staff/customers${s ? `?${s}` : ''}`;
}

export const loadCustomers = (slug: string, query: Query, f: Fetch): Promise<Outcome<CustomerPage>> => call<CustomerPage>(slug, listPath(query), f);

/** The page of customers after the one already shown: the rows join, the cursor moves on. */
export function appendPage(shown: CustomerRow[], page: CustomerPage): CustomerRow[] {
  const seen = new Set(shown.map((c) => c.customerId));
  return [...shown, ...page.customers.filter((c) => !seen.has(c.customerId))];
}

export const csvHref = (slug: string): string => `/api/c/${encodeURIComponent(slug)}/staff/customers/csv`;
export const profilePath = (slug: string, id: string): string => `/c/${slug}/admin/customers/${id}`;
/** A name to show: the one the customer gave, else nothing (the screen then shows the phone alone). */
export const nameOf = (c: Pick<CustomerRow, 'name'>): string => c.name?.trim() ?? '';
