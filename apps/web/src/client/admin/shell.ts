import type { Lang } from '../i18n';

// The club admin console's shell logic (F11-T12; ADMIN-01; design 4), apart from the screen so it can be tested without a browser.
// GET /staff/shell says which pages this person may open and which banners to show; the sidebar is only a convenience, the page's own
// routes still refuse (design 4). Nothing here decides a permission: it lays out what the server returned.

type Fetch = typeof fetch;

export interface ShellState {
  pages: string[];
  club: { nameTh: string; nameEn: string; status: string; defaultLanguage: string };
  paused: { reason: string; since: string } | null;
  lineCap: 'alert' | 'reminders_stopped' | 'over_limit' | null;
  lineTokenReason: string | null;
}

export type ShellLoad = { kind: 'ready'; shell: ShellState } | { kind: 'guest' } | { kind: 'forbidden' } | { kind: 'not_found' } | { kind: 'offline' };

export async function loadShell(slug: string, f: Fetch): Promise<ShellLoad> {
  try {
    const res = await f(`/api/c/${encodeURIComponent(slug)}/staff/shell`, { credentials: 'same-origin' });
    if (res.status === 401) return { kind: 'guest' };
    if (res.status === 403) return { kind: 'forbidden' };
    if (res.status === 404) return { kind: 'not_found' };
    if (!res.ok) return { kind: 'offline' };
    const body = (await res.json().catch(() => null)) as Partial<ShellState> | null;
    if (!body || !Array.isArray(body.pages) || !body.club) return { kind: 'offline' };
    return { kind: 'ready', shell: { pages: body.pages, club: body.club, paused: body.paused ?? null, lineCap: body.lineCap ?? null, lineTokenReason: body.lineTokenReason ?? null } };
  } catch {
    return { kind: 'offline' };
  }
}

export type NavGroup = 'top' | 'front' | 'setup' | 'finance';
export interface NavItem {
  /** The page ids it stands for (A9 and A9b are one entry, Products and pricing). */
  ids: readonly string[];
  /** The address segment under /c/{slug}/admin. */
  segment: string;
  labelKey: string;
  group: NavGroup;
}

/** The sidebar of the board (H-A0, H-A01, H-A07 ...), in its order. A2, A6 and A9b are reached from other pages, not from the sidebar. */
export const NAV: readonly NavItem[] = [
  { ids: ['A0'], segment: 'setup', labelKey: 'A-0488', group: 'top' },
  { ids: ['A1'], segment: 'calendar', labelKey: 'A-0002', group: 'front' },
  { ids: ['A5'], segment: 'customers', labelKey: 'A-0003', group: 'front' },
  { ids: ['A12'], segment: 'closures', labelKey: 'A-0004', group: 'front' },
  { ids: ['A7'], segment: 'coaches', labelKey: 'A-0158', group: 'setup' },
  { ids: ['A8'], segment: 'classes', labelKey: 'A-0159', group: 'setup' },
  { ids: ['A9', 'A9b'], segment: 'pricing', labelKey: 'A-0160', group: 'setup' },
  { ids: ['A10'], segment: 'promotions', labelKey: 'A-0161', group: 'setup' },
  { ids: ['A16'], segment: 'settings', labelKey: 'A-0162', group: 'setup' },
  { ids: ['A17'], segment: 'staff', labelKey: 'A-0163', group: 'setup' },
  { ids: ['A13'], segment: 'reports', labelKey: 'A-0165', group: 'finance' },
  { ids: ['A14'], segment: 'receipts', labelKey: 'A-0102', group: 'finance' },
];
export const GROUP_KEY: Record<Exclude<NavGroup, 'top'>, string> = { front: 'A-0156', setup: 'A-0157', finance: 'A-0164' };
/** Pages whose screen exists. A page the person may open but whose screen is not built yet is shown, not linked. Each page task adds its segment. */
export const BUILT: ReadonlySet<string> = new Set<string>(['customers', 'staff']);

export interface NavSection {
  group: NavGroup;
  items: NavItem[];
}
/** The entries this person may see, grouped, in the board's order. An entry shows when the server lists any of its pages. */
export function navFor(pages: readonly string[]): NavSection[] {
  const allowed = NAV.filter((n) => n.ids.some((id) => pages.includes(id)));
  return (['top', 'front', 'setup', 'finance'] as const)
    .map((group) => ({ group, items: allowed.filter((n) => n.group === group) }))
    .filter((s) => s.items.length > 0);
}

export const adminPath = (slug: string, segment = '') => `/c/${slug}/admin${segment ? `/${segment}` : ''}`;
/** Where the console opens: the first page of the sidebar that has a screen, else the shell itself. */
export function firstPage(slug: string, pages: readonly string[]): string {
  const first = navFor(pages).flatMap((s) => s.items).find((n) => BUILT.has(n.segment));
  return first ? adminPath(slug, first.segment) : adminPath(slug);
}

/** `{dayMonth}` of a moment, as a Bangkok calendar day: 13 Jan, 13 ม.ค. The year is never shown here and never a Thai year. */
export function dayMonthOf(lang: Lang, isoTimestamp: string): string {
  const d = new Date(isoTimestamp);
  if (Number.isNaN(d.getTime())) return '';
  const p = Object.fromEntries(
    new Intl.DateTimeFormat(`${lang === 'th' ? 'th-TH' : 'en-GB'}-u-ca-gregory-nu-latn`, { timeZone: 'Asia/Bangkok', day: 'numeric', month: 'short' }).formatToParts(d).map((x) => [x.type, x.value]),
  );
  return `${p['day']} ${p['month']}`;
}

export type Banner =
  | { kind: 'paused'; titleKey: string; vars: Record<string, string>; textKey: string }
  | { kind: 'line_cap'; titleKey: string; textKey: string }
  | { kind: 'line_token'; titleKey: string; textKey: string };

const CAP_KEY = { alert: 'A-new.shell_cap_alert', reminders_stopped: 'A-new.shell_cap_stopped', over_limit: 'A-new.shell_cap_over' } as const;

/** The banners of the board, top to bottom. The server sends the LINE ones to the owner only; the reason of a pause is shown as written. */
export function bannersOf(shell: ShellState, lang: Lang): Banner[] {
  const out: Banner[] = [];
  if (shell.paused) out.push({ kind: 'paused', titleKey: 'A-0519', vars: { dayMonth: dayMonthOf(lang, shell.paused.since), reason: shell.paused.reason }, textKey: 'A-0520' });
  if (shell.lineTokenReason) out.push({ kind: 'line_token', titleKey: 'A-new.shell_token_title', textKey: 'A-new.shell_token_text' });
  if (shell.lineCap) out.push({ kind: 'line_cap', titleKey: CAP_KEY[shell.lineCap], textKey: 'A-new.shell_cap_text' });
  return out;
}

/** The server marks the owner by what it lists: only the owner holds staff.manage, so only the owner gets A17. */
export const isOwnerShell = (shell: ShellState): boolean => shell.pages.includes('A17');
