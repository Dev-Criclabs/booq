'use client';
import { useEffect, useMemo, useState } from 'react';
import type { Lang } from '../../client/i18n';
import { NOTICE_NAME_KEY, noticeFrom, type NoticeDocument, type NoticeKind, type NoticeSource } from '../../client/notice';
import { useClub, useLiff } from '../../client/use-club';
import { Notice } from '../Notice';
import { Loading, StateScreen } from '../StateScreen';

// /c/{slug}/privacy and /c/{slug}/terms (D152). Public pages: a guest reads them before consent.

export function NoticeScreen({ slug, kind, initialLang, source }: { slug: string; kind: NoticeKind; initialLang: Lang; source?: NoticeSource }) {
  const liff = useLiff();
  const { load, lang, t, retry } = useClub(slug, initialLang, liff);
  const [doc, setDoc] = useState<NoticeDocument | null | undefined>(undefined);
  const [failed, setFailed] = useState(false);
  const read = useMemo(() => source ?? noticeFrom(window.fetch.bind(window)), [source]);

  useEffect(() => {
    if (load.state !== 'ready') return;
    let live = true;
    setDoc(undefined);
    setFailed(false);
    read(slug, kind, lang)
      .then((d) => live && setDoc(d))
      .catch(() => live && setFailed(true));
    return () => {
      live = false;
    };
  }, [load, slug, kind, lang, read]);

  if (load.state === 'not_found') return <StateScreen t={t} testId="not-found" textKey="P-new.page_not_found" />;
  if (load.state === 'offline' || failed) return <StateScreen t={t} offline testId="offline" titleKey="P-0326" textKey="P-0327" actionKey="P-0328" onAction={retry} />;
  if (load.state === 'loading' || doc === undefined) return <Loading />;
  return <Notice t={t} nameKey={NOTICE_NAME_KEY[kind]} doc={doc} />;
}
