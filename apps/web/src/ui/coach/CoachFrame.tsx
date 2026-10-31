'use client';
import type { ReactNode } from 'react';
import type { Lang, T } from '../../client/i18n';
import { useClub, useLiff } from '../../client/use-club';
import { LanguageToggle } from '../LanguageToggle';
import { Loading, StateScreen } from '../StateScreen';
import { PersonGate } from '../screens/PersonGate';
import { CoachNav, type CoachTab } from './CoachNav';
import type { CoachLoad } from './useCoachData';
import './coach.css';

// The coach portal shell (F12 design 7; F12-T11): the club config and the language (the coach's own: the LINE app language by default, D95),
// the sign in gate of every person page, and the bottom bar Today, Schedule, Availability, Leave, Earnings. The page inside gets the text
// function and the language. A person who is not a coach is told so by the page (the server answers 403), never shown another coach's data.

export interface CoachCtx {
  slug: string;
  t: T;
  lang: Lang;
  setLang(l: Lang): void;
}

export function CoachFrame({ slug, initialLang, tab, screen, children }: { slug: string; initialLang: Lang; tab: CoachTab; screen: string; children(ctx: CoachCtx): ReactNode }) {
  const liff = useLiff();
  const { load, t, lang, setLang, retry } = useClub(slug, initialLang, liff);
  if (load.state === 'not_found') return <StateScreen t={t} testId="not-found" textKey="P-new.page_not_found" />;
  if (load.state === 'offline') return <StateScreen t={t} offline testId="offline" titleKey="P-0326" textKey="P-0327" actionKey="P-0328" onAction={retry} />;
  if (load.state === 'loading') return <Loading />;
  return (
    <PersonGate slug={slug} t={t}>
      <div className="app coach" data-screen={screen}>
        {children({ slug, t, lang, setLang })}
        <CoachNav t={t} slug={slug} current={tab} />
      </div>
    </PersonGate>
  );
}

/** What a coach screen shows while its data is not ready: a spinner, the offline state with a retry, or "this is for coaches". */
export function CoachState({ load, t, reload }: { load: CoachLoad<unknown>; t: T; reload(): void }) {
  if (load.state === 'loading') return <Loading />;
  if (load.state === 'offline') return <StateScreen t={t} offline testId="offline" titleKey="P-0326" textKey="P-0327" actionKey="P-0328" onAction={reload} />;
  if (load.state === 'not_coach') return <StateScreen t={t} testId="not-coach" textKey="K-new.not_coach" />;
  if (load.state === 'error') return <StateScreen t={t} testId="error" titleKey="P-0326" textKey="K-new.error" actionKey="P-0328" onAction={reload} />;
  return null;
}

export function CoachLangToggle({ ctx }: { ctx: CoachCtx }) {
  return <LanguageToggle t={ctx.t} lang={ctx.lang} onChange={ctx.setLang} />;
}
