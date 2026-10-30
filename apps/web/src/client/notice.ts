// The privacy notice and the terms (D152): one template per club and language, versioned. The
// Architect designs where versions are stored and how the app reads them; until then no version
// is published, so the pages show the unavailable state. No legal text lives in code or keys: the
// document arrives as data (title, sections, version) written by the writers and approved by people.

export type NoticeKind = 'privacy' | 'terms';

export interface NoticeSection {
  heading: string;
  /** Plain text; a blank line starts a new paragraph. Never HTML. */
  body: string;
}

export interface NoticeDocument {
  title: string;
  version: string;
  sections: NoticeSection[];
}

/** The published document for this club, kind and language, or null when none is published. */
export type NoticeSource = (slug: string, kind: NoticeKind, lang: string) => Promise<NoticeDocument | null>;

/** The source until the Architect's design lands: nothing is published yet. */
export const noPublishedNotice: NoticeSource = async () => null;

/** The language key for each kind's name (P-0009 privacy notice, P-0007 terms). */
export const NOTICE_NAME_KEY: Record<NoticeKind, string> = { privacy: 'P-0009', terms: 'P-0007' };

export function paragraphs(body: string): string[] {
  return body
    .split(/\r?\n\s*\r?\n/)
    .map((p) => p.trim())
    .filter(Boolean);
}
