// The clubs list's logic (P1), apart from the screen so it can be tested without a browser. It reads GET /clubs (every club
// this staff member may see, with one number each) and turns the answer into rows, filter counts and refusals shown by key.

type Fetch = typeof fetch;

export type Status = 'draft' | 'testing' | 'live' | 'paused';
export interface ClubRow {
  clubId: string;
  nameTh: string;
  nameEn: string;
  status: Status;
  bookingsConfirmed30d: number;
  setup: { done: number; total: number };
  line: { used: number; limit: number | null };
  alerts: number;
}

export const STATUS_KEY: Record<Status, string> = { live: 'X-0021', testing: 'X-0026', draft: 'X-0029', paused: 'X-0163' };
export const FILTERS = ['all', 'live', 'testing', 'draft', 'paused'] as const;
export type Filter = (typeof FILTERS)[number];
/** The label of each filter tab, with its count (P1: "All · 4", "Live · 2" ...). */
export const FILTER_KEY: Record<Filter, string> = { all: 'X-0009', live: 'X-0010', testing: 'X-0011', draft: 'X-0012', paused: 'X-0013' };

export function counts(clubs: readonly ClubRow[]): Record<Filter, number> {
  const out: Record<Filter, number> = { all: clubs.length, live: 0, testing: 0, draft: 0, paused: 0 };
  for (const c of clubs) out[c.status] += 1;
  return out;
}
export const visible = (clubs: readonly ClubRow[], filter: Filter): ClubRow[] => (filter === 'all' ? [...clubs] : clubs.filter((c) => c.status === filter));

export type LoadOutcome = { kind: 'ok'; clubs: ClubRow[] } | { kind: 'error'; key: string; signIn?: boolean };
export async function loadClubs(f: Fetch): Promise<LoadOutcome> {
  try {
    const res = await f('/api/clubs');
    const json = (await res.json().catch(() => ({}))) as { clubs?: ClubRow[]; code?: string };
    if (res.status === 200 && Array.isArray(json.clubs)) return { kind: 'ok', clubs: json.clubs };
    if (res.status === 401) return { kind: 'error', key: 'X-new.staff_sign_in_required', signIn: true };
    if (res.status === 403) return { kind: 'error', key: 'X-new.staff_forbidden' };
    return { kind: 'error', key: 'X-new.clubs_unavailable' };
  } catch {
    return { kind: 'error', key: 'X-new.clubs_unavailable' };
  }
}
