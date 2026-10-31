'use client';
import type { Lang } from '../../client/i18n';
import { useClub, useLiff } from '../../client/use-club';
import { BottomNav } from '../BottomNav';
import { Loading, StateScreen } from '../StateScreen';

// /c/{slug}/book, C4 Book a court. A public page: the rich menu tile Book a court opens it directly
// as a guest, with no sign in and without Home (BOOK-02-AC1, AC2, AC5; AUTH-01-AC10). This is the
// page shell; the schedule grid is F03-T24.
export function BookScreen({ slug, initialLang }: { slug: string; initialLang: Lang }) {
  const liff = useLiff();
  const { load, t, retry } = useClub(slug, initialLang, liff);
  if (load.state === 'not_found') return <StateScreen t={t} testId="not-found" textKey="P-new.page_not_found" />;
  if (load.state === 'offline') return <StateScreen t={t} offline testId="offline" titleKey="P-0326" textKey="P-0327" actionKey="P-0328" onAction={retry} />;
  if (load.state === 'loading') return <Loading />;
  return (
    <div className="app person-page" data-screen="C4">
      <header className="bar">
        <h1 className="bar-title">{t('P-0024')}</h1>
      </header>
      <main className="form-body" />
      <BottomNav t={t} slug={slug} current="courts" />
    </div>
  );
}
