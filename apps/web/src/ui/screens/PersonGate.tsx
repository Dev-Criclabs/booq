'use client';
import { useEffect, useState, type ReactNode } from 'react';
import type { T } from '../../client/i18n';
import { signInFor, whoAmI } from '../../client/person';
import { Loading, StateScreen } from '../StateScreen';

// A page that needs a person (AUTH-01-AC9; design 6.2): a guest is sent to sign in and comes back to
// this same address; a person sees the page. The server decides who is a person.
export function PersonGate({ slug, t, children }: { slug: string; t: T; children: ReactNode }) {
  const [who, setWho] = useState<'checking' | 'person' | 'error'>('checking');
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let live = true;
    void whoAmI(slug, window.fetch.bind(window)).then((w) => {
      if (!live) return;
      if (w.kind === 'guest') return window.location.replace(signInFor(slug, window.location.pathname + window.location.search));
      setWho(w.kind === 'person' ? 'person' : 'error');
    });
    return () => {
      live = false;
    };
  }, [slug, attempt]);
  if (who === 'error') return <StateScreen t={t} offline testId="offline" titleKey="P-0326" textKey="P-0327" actionKey="P-0328" onAction={() => { setWho('checking'); setAttempt((n) => n + 1); }} />;
  if (who === 'checking') return <Loading />;
  return <>{children}</>;
}
