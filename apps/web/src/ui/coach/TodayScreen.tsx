'use client';
import { useEffect, useState } from 'react';
import { coachCall, getToday, type SessionRow } from '../../client/coach/api';
import { bangkokDay, bangkokTime, className, countKinds, levelKey, phases, playerTotal } from '../../client/coach/view';
import { formatDate } from '../../client/format';
import type { Lang } from '../../client/i18n';
import { CoachFrame, CoachLangToggle, CoachState, type CoachCtx } from './CoachFrame';
import { coachPath } from './CoachNav';
import { useCoachData } from './useCoachData';

// K1 Today (CPORT-01; board H-K1-Today; F12-T12): the coach's own sessions today in time order, Done and Next from the clock, the three
// counts, and the rest rule line. Every text is a key; no sample value is typed here.

export function TodayScreen({ slug, initialLang }: { slug: string; initialLang: Lang }) {
  return (
    <CoachFrame slug={slug} initialLang={initialLang} tab="today" screen="K1">
      {(ctx) => <Today ctx={ctx} />}
    </CoachFrame>
  );
}

function Today({ ctx }: { ctx: CoachCtx }) {
  const { slug, t, lang } = ctx;
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(id);
  }, []);
  const day = bangkokDay(new Date(now).toISOString());
  const { load, reload } = useCoachData(() => getToday(window.fetch.bind(window), slug, day), [slug, day]);
  const cap = useCoachData(() => coachCall<{ restCapHours: number }>(window.fetch.bind(window), slug, 'GET', '/coach/rest-cap'), [slug]);
  if (load.state !== 'ready') return <CoachState load={load} t={t} reload={reload} />;
  const rows = load.body.sessions;
  const kinds = countKinds(rows);
  const ph = phases(rows, now);
  return (
    <>
      <header className="coach-head">
        <div className="coach-head-top">
          <div>
            <p className="coach-eyebrow">{t('K-0001', { date: formatDate(lang, day) })}</p>
            <h1 className="coach-title">{t('K-0002')}</h1>
          </div>
          <CoachLangToggle ctx={ctx} />
        </div>
        <div className="coach-tiles">
          <div className="coach-tile" data-testid="tile-solo"><b>{kinds.solo}</b><span>{t(kinds.solo === 1 ? 'K-new.solo_class_one' : 'K-0003')}</span></div>
          <div className="coach-tile" data-testid="tile-group"><b>{kinds.group}</b><span>{t(kinds.group === 1 ? 'K-0004' : 'K-new.group_classes')}</span></div>
          <div className="coach-tile" data-testid="tile-players"><b>{playerTotal(rows)}</b><span>{t('K-0005')}</span></div>
        </div>
      </header>
      <main className="coach-body">
        {rows.length === 0 ? (
          <p className="coach-empty" data-testid="empty">{t('K-new.today_empty')}</p>
        ) : (
          rows.map((r, i) => <Row key={`${r.kind}-${r.ref_id}`} slug={slug} r={r} phase={ph[i]!} ctx={ctx} />)
        )}
        {rows.length > 0 && cap.load.state === 'ready' ? (
          <p className="coach-note" data-testid="rest-note">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false"><path d="m5 12 5 5 9-10" /></svg>
            <span>{t('K-0018', { hours: load.body.hours, maxHoursInRow: cap.load.body.restCapHours })}</span>
          </p>
        ) : null}
      </main>
    </>
  );
}

function Row({ slug, r, phase, ctx }: { slug: string; r: SessionRow; phase: 'done' | 'next' | 'later'; ctx: CoachCtx }) {
  const { t, lang } = ctx;
  const group = r.kind === 'group';
  const lk = levelKey(r.level);
  const level = lk ? t(lk) : '';
  const sub = group
    ? t(level ? 'K-new.group_players_level' : 'K-new.group_players', { booked: r.players ?? 0, maxPlayers: r.capacity ?? 0, level })
    : level;
  const chip = r.needs_attention ? { k: 'K-new.needs_attention', cls: 'warn' } : r.held ? { k: 'K-new.held', cls: '' } : phase === 'done' ? { k: 'K-0010', cls: 'quiet' } : phase === 'next' ? { k: 'K-0016', cls: '' } : null;
  return (
    <a className={`srow ${phase}`} href={coachPath(slug, `/session/${r.kind}/${r.ref_id}`)} data-testid="session-row" data-kind={r.kind} data-phase={phase}>
      <span className="srow-time"><b>{bangkokTime(r.start_at)}</b><span>{t('K-0006')}</span></span>
      <span className="srow-main">
        <span className="srow-kind">{t(group ? 'K-0045' : 'K-0043')} · {r.court}</span>
        <span className="srow-title">{group ? className(lang, r) : r.student_name}</span>
        {sub ? <span className="srow-sub">{sub}</span> : null}
      </span>
      <span className="srow-end">{chip ? <span className={`pill ${chip.cls}`}>{t(chip.k)}</span> : <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false"><path d="m9 18 6-6-6-6" /></svg>}</span>
    </a>
  );
}
