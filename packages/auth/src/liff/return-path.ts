// The path a player returns to after LINE Login (F02-T11; AUTH-01-AC2, AC5, AC9; design 6.2). The
// chosen slot, package or list of hours travels in the query and is kept only as a choice. The
// path must be inside the same club's address: another club, another site or anything that could
// split a header or climb out of /c/{slug} is refused, so the sign-in redirect cannot be bent
// into an open redirect.

const MAX_LENGTH = 2048;

export function safeReturnPath(slug: string, raw: unknown): string | null {
  const home = `/c/${slug}`;
  if (raw === undefined || raw === '' || typeof raw !== 'string') return home;
  if (raw.length > MAX_LENGTH) return null;
  if (!(raw === home || raw.startsWith(`${home}/`) || raw.startsWith(`${home}?`))) return null;
  if (/[\\\r\n\0]/.test(raw) || raw.includes('//') || /(^|\/)\.\.?(\/|\?|$)/.test(raw.split('?')[0]!)) return null;
  return raw;
}
