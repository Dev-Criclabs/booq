'use client';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { clubPath } from '@booq/line';
import { emptyStream, extend, loadCredits, loadLedger, mergedHistory, type Kind, type OwnCredits, type Stream } from '../../client/credits';
import type { Lang, T } from '../../client/i18n';
import { useClub, useLiff } from '../../client/use-club';
import { Credits } from '../credits/Credits';
import { Loading, StateScreen } from '../StateScreen';
import { PersonGate } from './PersonGate';

// /c/{slug}/credits, C14 Credits and wallet (F06-T18). Needs a person (a guest signs in and comes back). The balance and
// packages load with the first page of each ledger; See full history loads the next page of whichever has more.

export function CreditsScreen({ slug, initialLang }: { slug: string; initialLang: Lang }) {
  const liff = useLiff();
  const { load, lang, t, retry } = useClub(slug, initialLang, liff);
  if (load.state === 'not_found') return <StateScreen t={t} testId="not-found" textKey="P-new.page_not_found" />;
  if (load.state === 'offline') return <StateScreen t={t} offline testId="offline" titleKey="P-0326" textKey="P-0327" actionKey="P-0328" onAction={retry} />;
  if (load.state === 'loading') return <Loading />;
  return (
    <PersonGate slug={slug} t={t}>
      <CreditsLoaded slug={slug} lang={lang} t={t} />
    </PersonGate>
  );
}

function CreditsLoaded({ slug, lang, t }: { slug: string; lang: Lang; t: T }) {
  const f = useMemo(() => window.fetch.bind(window), []);
  const [credits, setCredits] = useState<OwnCredits | null>(null);
  const [streams, setStreams] = useState<Record<Kind, Stream>>({ credit: emptyStream(), wallet: emptyStream() });
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [attempt, setAttempt] = useState(0);

  const next = useCallback(
    async (current: Record<Kind, Stream>): Promise<Record<Kind, Stream> | null> => {
      const out = { ...current };
      for (const kind of ['credit', 'wallet'] as const) {
        if (current[kind].done) continue;
        const r = await loadLedger(slug, kind, current[kind].cursor, f);
        if (!r.ok) return null;
        out[kind] = extend(current[kind], r.value);
      }
      return out;
    },
    [slug, f],
  );

  useEffect(() => {
    let live = true;
    setFailed(false);
    void (async () => {
      const c = await loadCredits(slug, f);
      const s = c.ok ? await next({ credit: emptyStream(), wallet: emptyStream() }) : null;
      if (!live) return;
      if (!c.ok || !s) return setFailed(true);
      setCredits(c.value);
      setStreams(s);
    })();
    return () => {
      live = false;
    };
  }, [slug, f, next, attempt]);

  const onMore = () => {
    setBusy(true);
    void next(streams).then((s) => {
      setBusy(false);
      if (s) setStreams(s);
      else setFailed(true);
    });
  };

  if (failed) return <StateScreen t={t} offline testId="offline" titleKey="P-0326" textKey="P-0327" actionKey="P-0328" onAction={() => setAttempt((n) => n + 1)} />;
  if (!credits) return <Loading />;
  const { rows, more } = mergedHistory(streams.credit, streams.wallet);
  return <Credits t={t} lang={lang} slug={slug} credits={credits} history={rows} more={more} loadingMore={busy} onMore={onMore} backHref={clubPath(slug, { page: 'profile' })} />;
}
