'use client';
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { Lang } from '../../client/i18n';
import { clubHome } from '../../client/paths';
import {
  checkoutPath,
  dayFullInfo,
  loadCourts,
  loadDay,
  loadDays,
  stillOpen,
  tap,
  windowDates,
  type CourtsInfo,
  type DayCount,
  type ScheduleDay,
  type Selection,
} from '../../client/schedule';
import { useClub, useLiff } from '../../client/use-club';
import { CourtSchedule } from '../CourtSchedule';
import { Loading, StateScreen } from '../StateScreen';

// /c/{slug}/book, C4 Book a court (F03-T24). A public page: the Book a court tile opens it directly as
// a guest (BOOK-02-AC1, AC2, AC5; AUTH-01-AC10). The date in the address (?date=) is kept, so a shared
// or message link opens that day. Continue goes to checkout with the choice; sign in starts there.

type Failure = 'offline' | 'not_found' | null;

export function BookScreen({ slug, initialLang }: { slug: string; initialLang: Lang }) {
  const liff = useLiff();
  const { load, lang, t, retry } = useClub(slug, initialLang, liff);
  const [info, setInfo] = useState<CourtsInfo | null>(null);
  const [days, setDays] = useState<DayCount[]>([]);
  const [date, setDate] = useState<string | null>(null);
  const [day, setDay] = useState<ScheduleDay | null>(null);
  const [loadingDay, setLoadingDay] = useState(false);
  const [selection, setSelection] = useState<Selection | null>(null);
  const [failure, setFailure] = useState<Failure>(null);
  const [attempt, setAttempt] = useState(0);
  const f = useMemo(() => (typeof window === 'undefined' ? fetch : window.fetch.bind(window)), []);

  // The courts, today and the window; then the counts for the strip and Day full.
  useEffect(() => {
    if (load.state !== 'ready') return;
    let live = true;
    void loadCourts(slug, f).then(async (r) => {
      if (!live) return;
      if (!r.ok) return setFailure(r.status === 404 ? 'not_found' : 'offline');
      setInfo(r.value);
      const dates = windowDates(r.value.today, r.value.bookingWindowDays);
      if (dates.length === 0) return;
      const asked = new URLSearchParams(window.location.search).get('date');
      setDate((d) => d ?? (asked && dates.includes(asked) ? asked : r.value.today));
      const counts = await loadDays(slug, f);
      if (live && counts.ok) setDays(counts.value.days);
    });
    return () => {
      live = false;
    };
  }, [load, slug, f, attempt]);

  // The chosen day's grid. A failed read is the offline state; nothing is booked or charged (AC13).
  useEffect(() => {
    if (!date) return;
    let live = true;
    setLoadingDay(true);
    void loadDay(slug, date, f).then((r) => {
      if (!live) return;
      setLoadingDay(false);
      if (!r.ok) return setFailure(r.status === 404 ? 'not_found' : 'offline');
      setDay(r.value);
      setSelection((s) => stillOpen(s, r.value));
    });
    return () => {
      live = false;
    };
  }, [date, slug, f, attempt]);

  const onDate = useCallback((d: string) => {
    setSelection(null);
    setDay(null);
    setDate(d);
    const url = new URL(window.location.href);
    url.searchParams.set('date', d);
    window.history.replaceState(null, '', url);
  }, []);

  const onTap = useCallback((courtId: string, start: string) => setSelection((s) => (day ? tap(s, day, courtId, start) : s)), [day]);

  const onContinue = useCallback(() => {
    if (!selection || !day || !date) return;
    const court = day.courts.find((c) => c.id === selection.courtId);
    if (court) window.location.assign(checkoutPath(slug, court, date, selection));
  }, [selection, day, date, slug]);

  const onBack = useCallback(() => {
    if (window.history.length > 1) window.history.back();
    else window.location.assign(clubHome(slug));
  }, [slug]);

  const again = useCallback(() => {
    setFailure(null);
    setAttempt((n) => n + 1);
    retry();
  }, [retry]);

  if (load.state === 'not_found' || failure === 'not_found') return <StateScreen t={t} testId="not-found" textKey="P-new.page_not_found" />;
  if (load.state === 'offline' || failure === 'offline') return <StateScreen t={t} offline testId="offline" titleKey="P-0326" textKey="P-0327" actionKey="P-0328" onAction={again} />;
  if (load.state === 'loading' || !info) return <Loading />;

  const dates = windowDates(info.today, info.bookingWindowDays);
  return (
    <CourtSchedule
      t={t}
      lang={lang}
      slug={slug}
      dates={dates}
      date={date}
      onDate={onDate}
      day={day}
      loading={loadingDay || !day}
      selection={selection}
      onTap={onTap}
      onContinue={onContinue}
      onBack={onBack}
      dayFull={day?.dayFull ? dayFullInfo(day, days) : null}
      closedForBooking={dates.length === 0}
      paused={info.status === 'paused' || load.config.status === 'paused'}
    />
  );
}
