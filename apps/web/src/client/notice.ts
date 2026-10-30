// The privacy notice and the terms (D152; docs/architecture/legal-notice.md): one template per
// language, versioned by release, with the club's name filled by the server (app.render_notice).
// No legal text lives in code or keys: the document arrives as data from
// GET /api/c/{slug}/public/notice/{kind}?lang=..., written by the writers and approved by people.

export type NoticeKind = 'privacy' | 'terms';

export interface NoticeDocument {
  title: string;
  version: string;
  /** Plain text; a blank line starts a new paragraph. Never HTML. */
  body: string;
}

/** The published document for this club, kind and language; null when none is published. Throws when unreachable. */
export type NoticeSource = (slug: string, kind: NoticeKind, lang: string) => Promise<NoticeDocument | null>;

export function noticeFrom(f: typeof fetch): NoticeSource {
  return async (slug, kind, lang) => {
    const res = await f(`/api/c/${encodeURIComponent(slug)}/public/notice/${kind}?lang=${encodeURIComponent(lang)}`, { credentials: 'same-origin' });
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`notice ${res.status}`); // i18n-ignore: internal, shown as the offline state
    const d = (await res.json()) as Partial<NoticeDocument>;
    return typeof d.title === 'string' && typeof d.body === 'string' && typeof d.version === 'string' ? { title: d.title, version: d.version, body: d.body } : null;
  };
}

/** The language key for each kind's name (P-0009 privacy notice, P-0007 terms). */
export const NOTICE_NAME_KEY: Record<NoticeKind, string> = { privacy: 'P-0009', terms: 'P-0007' };

export function paragraphs(body: string): string[] {
  return body
    .split(/\r?\n\s*\r?\n/)
    .map((p) => p.trim())
    .filter(Boolean);
}
