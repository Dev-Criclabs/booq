'use client';
import type { T } from '../client/i18n';
import { paragraphs, type NoticeDocument } from '../client/notice';

// The privacy notice and terms page (D152; AUTH-02-AC8, PDPA-01-AC11, AC12). It renders the
// document it is given as plain text; with no published version it says so plainly.

export function Notice({ t, nameKey, doc }: { t: T; nameKey: string; doc: NoticeDocument | null }) {
  if (!doc) {
    return (
      <main className="app notice" data-testid="notice-unavailable">
        <h1 className="notice-title">{t(nameKey)}</h1>
        <p className="notice-empty" role="status">
          {t('P-new.notice_unavailable')}
        </p>
      </main>
    );
  }
  return (
    <main className="app notice" data-testid="notice">
      <h1 className="notice-title">{doc.title}</h1>
      <p className="notice-version">{t('P-new.notice_version', { version: doc.version })}</p>
      <section className="notice-section">
        {paragraphs(doc.body).map((p, j) => (
          <p key={j}>{p}</p>
        ))}
      </section>
    </main>
  );
}
