import { formatMoney } from './format';
import type { Lang, T } from './i18n';

// C14 Credits and wallet (F06-T18; PKG-01-AC10, PKG-03-AC3; H-C14-Credits-wallet). The balance, the packages and every
// movement come from GET /me/credits and /me/ledger: this module computes no balance (the ledgers are the record,
// PKG-01-AC1), it only labels and orders what the server sends. Each ledger reason has its own label (design 12).

export interface OwnPackage {
  packageId: string;
  nameTh: string | null;
  nameEn: string | null;
  creditType: string;
  creditsLeft: number;
  creditsTotal: number;
  expiresAt: string;
  status: 'active' | 'used_up' | 'expired';
}
export interface OwnCredits {
  packages: OwnPackage[];
  walletSatang: number;
}
export interface LedgerEntry {
  id: string;
  at: string;
  reason: string;
  change: number;
  packageId: string | null;
  bookingId: string | null;
  orderId: string | null;
}
export interface LedgerPage {
  entries: LedgerEntry[];
  nextCursor: string | null;
}
export type Kind = 'credit' | 'wallet';
export type Fetched<V> = { ok: true; value: V } | { ok: false; status: number; code: string };

async function get<V>(f: typeof fetch, url: string): Promise<Fetched<V>> {
  try {
    const res = await f(url, { credentials: 'same-origin', cache: 'no-store' });
    const body = (await res.json().catch(() => ({}))) as V & { code?: unknown };
    if (res.ok) return { ok: true, value: body };
    return { ok: false, status: res.status, code: typeof body.code === 'string' ? body.code : 'offline' };
  } catch {
    return { ok: false, status: 0, code: 'offline' };
  }
}
const api = (slug: string) => `/api/c/${encodeURIComponent(slug)}`;
export const loadCredits = (slug: string, f: typeof fetch) => get<OwnCredits>(f, `${api(slug)}/me/credits`);
export const loadLedger = (slug: string, kind: Kind, cursor: string | null, f: typeof fetch) =>
  get<LedgerPage>(f, `${api(slug)}/me/ledger?kind=${kind}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`);

/** The ledger reasons (0510 CHECKs): one label key each. */
export const CREDIT_REASONS = ['reserve', 'return', 'use', 'forfeit', 'expire', 'adjust', 'import', 'import_transfer'] as const;
export const WALLET_REASONS = ['refund', 'late_payment', 'wrong_amount', 'duplicate_payment', 'referral_reward', 'spend', 'return', 'adjust', 'import', 'import_transfer', 'expire'] as const;
export const reasonKey = (kind: Kind, reason: string) => `P-new.ledger_${kind}_${reason}`;

/** The packages shown on C14: those with credits left and not expired (the history keeps the rest). */
export const activePackages = (c: OwnCredits) => c.packages.filter((p) => p.status === 'active');

const BANGKOK: Record<Lang, string> = { en: 'en-GB', th: 'th-TH' };
/** `{dayMonthYear}` and `{time}` of an instant in Asia/Bangkok, international year in both languages. */
export function bangkokParts(lang: Lang, iso: string): { dayMonthYear: string; time: string } {
  const d = new Date(iso);
  const p = Object.fromEntries(
    new Intl.DateTimeFormat(`${BANGKOK[lang]}-u-ca-gregory-nu-latn`, { timeZone: 'Asia/Bangkok', day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
      .formatToParts(d).map((x) => [x.type, x.value]),
  );
  return { dayMonthYear: `${p['day']} ${p['month']} ${p['year']}`, time: `${p['hour']}:${p['minute']}` };
}

/** A package's count line: court hours (P-0225) or class sessions (P-0228). */
export function countLine(p: OwnPackage, t: T): string {
  return t(p.creditType === 'court_hour' ? 'P-0225' : 'P-0228', { remaining: p.creditsLeft, total: p.creditsTotal });
}

/** The signed amount of a movement, in the package's unit or the wallet's baht. */
export function amountText(kind: Kind, change: number, unit: string | null, lang: Lang, t: T): string {
  const n = Math.abs(change);
  if (kind === 'wallet') return t(change >= 0 ? 'P-0232' : 'P-new.ledger_wallet_out', { amount: formatMoney(lang, n) });
  if (unit === 'court_hour') {
    if (change >= 0) return t(n === 1 ? 'P-new.ledger_hour_in' : 'P-0238', { hours: n });
    return t(n === 1 ? 'P-0235' : 'P-new.ledger_hours_out', { hours: n });
  }
  if (change >= 0) return t(n === 1 ? 'P-new.ledger_class_in' : 'P-new.ledger_classes_in', { sessions: n });
  return t(n === 1 ? 'P-new.ledger_class_out' : 'P-new.ledger_classes_out', { sessions: n });
}

/** One stream of movements as loaded so far. */
export interface Stream {
  entries: LedgerEntry[];
  cursor: string | null;
  done: boolean;
}
export const emptyStream = (): Stream => ({ entries: [], cursor: null, done: false });

export interface HistoryRow {
  kind: Kind;
  entry: LedgerEntry;
}

/**
 * Both ledgers as one list, newest first. A stream that has more to load stops the list at its oldest loaded row: an
 * older row of the other stream could still be followed by unloaded rows of this one, so it waits for the next page.
 */
export function mergedHistory(credit: Stream, wallet: Stream): { rows: HistoryRow[]; more: boolean } {
  const all: HistoryRow[] = [
    ...credit.entries.map((entry) => ({ kind: 'credit' as const, entry })),
    ...wallet.entries.map((entry) => ({ kind: 'wallet' as const, entry })),
  ].sort((a, b) => (a.entry.at === b.entry.at ? (a.entry.id < b.entry.id ? 1 : -1) : a.entry.at < b.entry.at ? 1 : -1));
  const floors = [credit, wallet].filter((s) => !s.done && s.entries.length > 0).map((s) => s.entries[s.entries.length - 1]!.at);
  const floor = floors.length ? floors.reduce((a, b) => (a > b ? a : b)) : null;
  return { rows: floor === null ? all : all.filter((r) => r.entry.at >= floor), more: !credit.done || !wallet.done };
}

/** Append a loaded page to its stream. */
export const extend = (s: Stream, page: LedgerPage): Stream => ({ entries: [...s.entries, ...page.entries], cursor: page.nextCursor, done: page.nextCursor === null });
