import { call, type Outcome } from './api';

// A5 Customers (F11-T15; ADMIN-06; board H-A05-Customers), apart from the screen. GET /staff/customers?q=&tag=&status=&group=&cursor= pages the club's
// customers by name, 50 a page, with their tags, price group, active package, wallet balance and last visit. Nothing here decides who may see a phone
// number: the server sends it to front desk and owner only.

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
  /** The price group the date of birth falls in (the board's Adult or Student); null when none or not exactly one fits. */
  group: { id: string; nameTh: string; nameEn: string } | null;
  /** The active package that ends soonest, with credits left; null when there is none. */
  activePackage: { nameTh: string; nameEn: string; creditsLeft: number; expiresAt: string } | null;
  walletSatang: number;
  /** The latest confirmed booking whose hour has started. */
  lastVisitAt: string | null;
}
export interface CustomerPage {
  customers: CustomerRow[];
  next: string | null;
}

export const STATUSES = ['active_package', 'expiring_soon', 'no_visit'] as const;
export type Status = (typeof STATUSES)[number];
/** The words of each status chip of the board. */
export const STATUS_KEY: Record<Status, string> = { active_package: 'A-0071', expiring_soon: 'A-0072', no_visit: 'A-0073' };

export interface Query {
  q: string;
  tag: string;
  status?: Status | '';
  group?: string;
  cursor?: string | null;
}

export function listPath(query: Query): string {
  const p = new URLSearchParams();
  if (query.q.trim()) p.set('q', query.q.trim());
  if (query.tag.trim()) p.set('tag', query.tag.trim());
  if (query.status) p.set('status', query.status);
  if (query.group) p.set('group', query.group);
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

/** The price groups to offer as chips: those the club has, else those seen on the rows (a role that may not read prices still sees the groups of its customers). */
export function chipGroups(known: ReadonlyArray<{ id: string; nameTh: string; nameEn: string }>, rows: readonly CustomerRow[]): Array<{ id: string; nameTh: string; nameEn: string }> {
  if (known.length > 0) return [...known];
  const seen = new Map<string, { id: string; nameTh: string; nameEn: string }>();
  for (const r of rows) if (r.group && !seen.has(r.group.id)) seen.set(r.group.id, r.group);
  return [...seen.values()];
}

export const loadPriceGroups = async (slug: string, f: Fetch) => {
  const r = await call<Array<{ id: string; nameTh: string; nameEn: string }>>(slug, '/staff/setup/price-groups', f);
  return r.kind === 'ok' ? r.body.map((g) => ({ id: g.id, nameTh: g.nameTh, nameEn: g.nameEn })) : [];
};
