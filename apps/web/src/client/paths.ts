// Player app addresses. Every page lives under the club path /c/{slug} (D6, design 6.3), so the
// club is known before any data is read or sign in starts. Return paths are checked the same way
// the server checks them (packages/auth safeReturnPath): only a path inside this club's address.

const MAX = 2048;

export const clubHome = (slug: string) => `/c/${slug}`;

export function safeNext(slug: string, raw: string | null | undefined): string {
  const home = clubHome(slug);
  if (!raw || raw.length > MAX) return home;
  if (!(raw === home || raw.startsWith(`${home}/`) || raw.startsWith(`${home}?`))) return home;
  if (/[\\\r\n\0]/.test(raw) || raw.includes('//') || /(^|\/)\.\.?(\/|\?|$)/.test(raw.split('?')[0]!)) return home;
  return raw;
}

const withNext = (path: string, next: string) => `${path}?next=${encodeURIComponent(next)}`;

/** C1: the sign-in page that comes back to `next`. */
export const signInPath = (slug: string, next: string) => withNext(`${clubHome(slug)}/sign-in`, safeNext(slug, next));
/** C2: first sign-in profile, then on to `next`. */
export const profileSetupPath = (slug: string, next: string) => withNext(`${clubHome(slug)}/profile-setup`, safeNext(slug, next));

/** The chosen slot as the return path carries it, for the C1 line P-0002. Kept only as a choice (CC-4). */
export interface SlotChoice {
  court: string;
  date: string;
  startTime: string;
  endTime: string;
}

export function slotFromNext(next: string): SlotChoice | null {
  const q = new URLSearchParams(next.split('?')[1] ?? '');
  const court = q.get('court');
  const date = q.get('date');
  const startTime = q.get('from');
  const endTime = q.get('to');
  if (!court || !date || !startTime || !endTime) return null;
  return { court, date, startTime, endTime };
}
