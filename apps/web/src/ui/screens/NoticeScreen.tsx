'use client';
import { useEffect, useMemo, useState } from 'react';
import type { Lang } from '../../client/i18n';
import { liffPort } from '../../client/liff';
import { NOTICE_NAME_KEY, noPublishedNotice, type NoticeDocument, type NoticeKind, type NoticeSource } from '../../client/notice';
import { useClub } from '../../client/use-club';
import { Notice } from '../Notice';
import { Loading, StateScreen } from '../StateScreen';

// /c/{slug}/privacy and /c/{slug}/terms (D152). Public pages: a guest reads them before consent.

export function NoticeScreen({ slug, kind, initialLang, source = noPublishedNotice }: { slug: string; kind: NoticeKind; initialLang: Lang; source?: NoticeSource }) {
  const liff = useMemo(() => liffPort(), []);
  const { load, lang, t, retry } = useClub(slug, initialLang, liff);
  const [doc, setDoc] = useState<NoticeDocument | null | undefined>(undefined);

  useEffect(() => {
    if (load.state !== 'ready') return;
    let live = true;
    setDoc(undefined);
    source(slug, kind, lang)
      .then((d) => live && setDoc(d))
      .catch(() => live && setDoc(null));
    return () => {
      live = false;
    };
  }, [load, slug, kind, lang, source]);

  if (load.state === 'not_found') return <StateScreen t={t} testId="not-found" textKey="P-new.page_not_found" />;
  if (load.state === 'offline') return <StateScreen t={t} offline testId="offline" titleKey="P-0326" textKey="P-0327" actionKey="P-0328" onAction={retry} />;
  if (load.state === 'loading' || doc === undefined) return <Loading />;
  return <Notice t={t} nameKey={NOTICE_NAME_KEY[kind]} doc={doc} />;
}
