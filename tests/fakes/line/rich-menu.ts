// LINE-02 / BOOK-02: the rich menu has 6 tiles, each a deep link to its own page, tile "Book a court" opens C4.
import type { RichMenu } from './types';

export interface RichMenuExpectation {
  liffId: string;
  /** Substring of the deep link of the Book a court tile that identifies C4 (design.md decides the route). */
  bookCourtLinkContains: string;
  /** Index of the Book a court tile. The hand-off lists it first. */
  bookCourtIndex?: number;
}

/** Returns problems; empty array = pass. */
export function richMenuProblems(menu: RichMenu | undefined, exp: RichMenuExpectation): string[] {
  if (!menu) return ['club has no default rich menu'];
  const problems: string[] = [];
  if (menu.areas.length !== 6) problems.push(`rich menu has ${menu.areas.length} tiles, expected 6`);
  const uris = menu.areas.map((a) => a.action.uri);
  if (uris.some((u) => !u)) problems.push('a tile is not a uri action');
  const defined = uris.filter((u): u is string => !!u);
  if (new Set(defined).size !== defined.length) problems.push('two tiles open the same page (each tile has its own page)');
  for (const u of defined) if (!u.includes(`liff.line.me/${exp.liffId}`)) problems.push(`tile does not open the club's own LIFF app: ${u}`);
  const book = defined[exp.bookCourtIndex ?? 0];
  if (book && !book.includes(exp.bookCourtLinkContains)) problems.push('Book a court tile does not open C4 directly');
  return problems;
}
