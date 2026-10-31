'use client';
import { useCallback, useEffect, useState } from 'react';
import { liffStateTarget } from '@booq/line';
import { addFriendUrl, checkFriendship, markAsked, shouldAsk } from '../../client/friend';
import { formatDateLong, greetingKey } from '../../client/home';
import type { Lang } from '../../client/i18n';
import { clubHome, signInPath } from '../../client/paths';
import { whoAmI } from '../../client/person';
import { clubName, useClub, useLiff } from '../../client/use-club';
import { Home } from '../Home';
import { Loading, StateScreen } from '../StateScreen';

// /c/{slug} (C3 Home). A public page: a guest browses with no sign in (AUTH-01-AC1, AC8). A signed in
// player who is not a friend of the Official Account sees the add-the-account ask once per session
// (LINE-01-AC9, A-7). Sign in starts only from the Sign in link or a booking or purchase.
// This address is the club's LIFF endpoint (design 4.1): a rich menu tile, a message button or a
// shared link arrives here with its page in `liff.state` (design 3.1). liff.init() moves on to that
// page; if it has not, the page goes there itself, only inside this club (AUTH-01-AC10, AC14).

const session = () => {
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
};

export function HomeScreen({ slug, initialLang }: { slug: string; initialLang: Lang }) {
  const liff = useLiff();
  const { load, lang, setLang, t, retry } = useClub(slug, initialLang, liff);
  const [signedIn, setSignedIn] = useState<boolean | null>(null);
  const [ask, setAsk] = useState(false);
  const [now] = useState(() => new Date());
  const [target] = useState(() => (typeof window === 'undefined' ? null : liffStateTarget(slug, window.location.search)));

  useEffect(() => {
    if (!target || load.state !== 'ready' || liff === undefined) return;
    const start = window.location.href;
    const go = () => {
      if (window.location.href === start) window.location.replace(target);
    };
    if (liff && load.config.liffId) void liff.init({ liffId: load.config.liffId }).then(go, go);
    else go();
  }, [target, load, liff]);

  useEffect(() => {
    if (load.state !== 'ready' || target) return;
    let live = true;
    void whoAmI(slug, window.fetch.bind(window)).then((w) => live && setSignedIn(w.kind === 'person'));
    return () => {
      live = false;
    };
  }, [load, slug, target]);

  // The friend state needs LINE: only for a signed in player, inside a LIFF session.
  useEffect(() => {
    if (!signedIn || !liff || load.state !== 'ready' || !load.config.liffId) return;
    let live = true;
    liff
      .init({ liffId: load.config.liffId })
      .then(() => (liff.isLoggedIn() ? checkFriendship(liff, slug, window.fetch.bind(window)) : null))
      .then((friend) => live && setAsk(shouldAsk(friend ?? null, session(), slug)))
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [signedIn, liff, load, slug]);

  const dismiss = useCallback(() => {
    markAsked(session(), slug);
    setAsk(false);
  }, [slug]);

  // Shown once: mark it as soon as it appears, so another page in this session does not ask again.
  useEffect(() => {
    if (ask) markAsked(session(), slug);
  }, [ask, slug]);

  if (load.state === 'not_found') return <StateScreen t={t} testId="not-found" textKey="P-new.page_not_found" />;
  if (load.state === 'offline') return <StateScreen t={t} offline testId="offline" titleKey="P-0326" textKey="P-0327" actionKey="P-0328" onAction={retry} />;
  if (load.state === 'loading' || target || signedIn === null) return <Loading />;
  const config = load.config;
  return (
    <Home
      t={t}
      lang={lang}
      onLang={setLang}
      slug={slug}
      wordmark={config.nameEn}
      clubName={clubName(config, lang)}
      dateLong={formatDateLong(lang, now)}
      greetingKey={greetingKey(now)}
      signedIn={signedIn}
      signInHref={signInPath(slug, clubHome(slug))}
      friendAsk={ask ? { url: addFriendUrl(config.oaBasicId), onDismiss: dismiss } : null}
    />
  );
}
