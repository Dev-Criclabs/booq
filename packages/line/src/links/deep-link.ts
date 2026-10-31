// Deep links into the player app (F02 design 3.1, 4.1, 6.3; AUTH-01-AC10, AC14; BOOK-02-AC1 to AC3;
// D6). Every link that leaves the app (a LINE message button, a rich menu tile, a shared link) is
// built here, so it always names the club: the link opens the club's own LIFF app, whose endpoint is
// https://{domain}/c/{slug}, and LINE appends the extra path and query to that endpoint (it also
// passes them as `liff.state`, which liff.init() on the endpoint page turns into the final address).
// So the extra path here is relative to the club path: `https://liff.line.me/{liffId}/book` opens
// /c/{slug}/book. A link for club A can only open club A's app (CC-1).

/** A page a link can open. `page` names match F10's message builder targets (LinkTarget). */
export type PlayerPage =
  | { page: 'home' }
  | { page: 'book' }
  | { page: 'solo_classes' }
  | { page: 'group_classes' }
  | { page: 'packages' }
  | { page: 'bookings' }
  | { page: 'booking'; bookingId: string }
  | { page: 'calendar'; bookingId: string }
  | { page: 'offer'; params: Readonly<Record<string, unknown>> }
  | { page: 'refer' }
  | { page: 'profile' };

const ID = /^[A-Za-z0-9_-]{1,64}$/;
const LIFF_ID = /^[0-9]+-[A-Za-z0-9]+$/;
const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const PARAM = /^[A-Za-z][A-Za-z0-9_]{0,40}$/;

export class DeepLinkError extends Error {
  constructor(code: string) {
    super(code);
    this.name = 'DeepLinkError';
  }
}

function id(v: string): string {
  if (!ID.test(v)) throw new DeepLinkError('deep_link_bad_id');
  return v;
}

/** The query of an offer link: plain string, number or boolean values only, in key order. */
function query(params: Readonly<Record<string, unknown>>): string {
  const q = new URLSearchParams();
  for (const k of Object.keys(params).sort()) {
    const v = params[k];
    if (!PARAM.test(k) || !(typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean')) throw new DeepLinkError('deep_link_bad_param');
    q.set(k, String(v));
  }
  const s = q.toString();
  return s ? `?${s}` : '';
}

/** The path of a page below the club path /c/{slug}: '' for the club home, else '/book', '/bookings/{id}', ... */
export function playerPath(target: PlayerPage): string {
  switch (target.page) {
    case 'home':
      return '';
    case 'book':
      return '/book';
    case 'solo_classes':
      return '/classes/solo';
    case 'group_classes':
      return '/classes/group';
    case 'packages':
      return '/packages';
    case 'bookings':
      return '/bookings';
    case 'booking':
      return `/bookings/${id(target.bookingId)}`;
    case 'calendar':
      return `/bookings/${id(target.bookingId)}/calendar`;
    case 'offer':
      return `/offer${query(target.params)}`;
    case 'refer':
      return '/refer';
    case 'profile':
      return '/profile';
  }
}

/** The address inside the app, /c/{slug}/..., for links on the app's own pages. */
export function clubPath(slug: string, target: PlayerPage): string {
  if (!SLUG.test(slug) || slug.length > 63) throw new DeepLinkError('deep_link_bad_slug');
  return `/c/${slug}${playerPath(target)}`;
}

/** The LIFF deep link that opens a page of the club's LIFF app, inside LINE or in a browser. */
export function liffLink(liffId: string, target: PlayerPage): string {
  if (!LIFF_ID.test(liffId)) throw new DeepLinkError('deep_link_bad_liff_id');
  return `https://liff.line.me/${liffId}${playerPath(target)}`;
}

/** What the sender knows of a club when it builds a message. */
export interface LinkClub {
  liffId: string | null;
}

/**
 * The links port for F10's message builder: `link(clubId, target)` gives the club's LIFF deep link,
 * or null when the club has no LIFF app yet (the button is then left out). `club` reads from what
 * the sender already loaded for the club; no query runs here.
 */
export function createDeepLinks(deps: { club(clubId: string): LinkClub | null }) {
  return {
    link(clubId: string, target: PlayerPage): string | null {
      const club = deps.club(clubId);
      if (!club?.liffId) return null;
      return liffLink(club.liffId, target);
    },
  };
}

/**
 * The six rich menu tiles, in tile order (F10 design 5.5, LINE-02-AC1; D54: fixed, not editable).
 * Tile 1 Book a court opens C4 directly as a guest page (BOOK-02-AC1, AUTH-01-AC10); My bookings and
 * Refer a friend need a person, so those pages start sign in first (AUTH-01-AC9).
 */
export const RICH_MENU_PAGES: readonly PlayerPage[] = [
  { page: 'book' },
  { page: 'solo_classes' },
  { page: 'group_classes' },
  { page: 'packages' },
  { page: 'bookings' },
  { page: 'refer' },
];

/** The six tile links for a club's LIFF app, in tile order. */
export function richMenuLinks(liffId: string): string[] {
  return RICH_MENU_PAGES.map((p) => liffLink(liffId, p));
}

/**
 * Where a LIFF link lands (design 3.1): LINE opens the endpoint /c/{slug} with the extra path and
 * query in `liff.state`. The address it names, inside this club only, or null when there is none or
 * it would leave the club's path (then the endpoint page itself is shown).
 */
export function liffStateTarget(slug: string, search: string): string | null {
  const state = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search).get('liff.state');
  if (!state) return null;
  if (!state.startsWith('/') || state.startsWith('//') || /[\\\r\n\0]/.test(state) || state.length > 2048) return null;
  const [path = ''] = state.split('?');
  if (/(^|\/)\.\.?(\/|$)/.test(path) || path.includes('//')) return null;
  return `${clubPath(slug, { page: 'home' })}${state}`;
}
