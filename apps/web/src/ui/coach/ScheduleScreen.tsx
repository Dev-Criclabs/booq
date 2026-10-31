'use client';
import { useState } from 'react';
import { getSchedule, type ScheduleItem } from '../../client/coach/api';
import { addDays, bangkokDay, bangkokTime, className, groupByDay, isFullDay, mondayOf, weekRange } from '../../client/coach/view';
import { formatDate } from '../../client/format';
import type { Lang } from '../../client/i18n';
import { CoachFrame, CoachLangToggle, CoachState, type CoachCtx } from './CoachFrame';
import { coachPath } from './CoachNav';
import { useCoachData } from './useCoachData';

// K2 Schedule (CPORT-02; board H-K2-Schedule; F12-T13): a week, Monday to Sunday, of the coach's own solo and group classes, leave and
// blocked times, with the counts and the week arrows. The leave and blocked rows are the coach's own and the club's closed court hours.

export function ScheduleScreen({ slug, initialLang }: { slug: string; initialLang: Lang }) {
  return (
    <CoachFrame slug={slug} initialLang={initialLang} tab="schedule" screen="K2">
      {(ctx) => <Schedule ctx={ctx} />}
    </CoachFrame>
  );
}

const Arrow = ({ dir }: { dir: 'prev' | 'next' }) => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
    <path d={dir === 'prev' ? 'm15 18-6-6 6-6' : 'm9 18 6-6-6-6'} />
  </svg>
);

function Schedule({ ctx }: { ctx: CoachCtx }) {
  const { slug, t, lang } = ctx;
  const [monday, setMonday] = useState(() => mondayOf(bangkokDay(new Date().toISOString())));
  const { load, reload } = useCoachData(() => getSchedule(window.fetch.bind(window), slug, monday, addDays(monday, 6)), [slug, monday]);
  const range = weekRange(lang, monday);
  return (
    <>
      <h1 className="coach-plain-title">{t('K-0019')}</h1>
      <div className="coach-body" style={{ paddingTop: 4 }}>
        <div className="week-nav">
          <button type="button" className="icon-btn" aria-label={t('K-0055')} data-testid="prev-week" onClick={() => setMonday(addDays(monday, -7))}><Arrow dir="prev" /></button>
          <span className="range" data-testid="range">{range.sameMonth ? t('K-0038', range.vars) : t('K-new.week_range_months', range.vars)}</span>
          <button type="button" className="icon-btn" aria-label={t('K-0056')} data-testid="next-week" onClick={() => setMonday(addDays(monday, 7))}><Arrow dir="next" /></button>
        </div>
        {load.state !== 'ready' ? (
          <CoachState load={load} t={t} reload={reload} />
        ) : (
          <>
            <div className="chips-row" data-testid="counts">
              <span className="count-chip">{t('K-0039', { count: load.body.counts.solo })}</span>
              <span className="count-chip group">{t('K-0040', { count: load.body.counts.group })}</span>
              <span className="count-chip leave">{t('K-0041', { count: load.body.counts.leave })}</span>
            </div>
            {load.body.items.length === 0 ? <p className="coach-empty" data-testid="empty">{t('K-new.week_empty')}</p> : null}
            {groupByDay(load.body.items).map((g) => (
              <section key={g.day} data-testid="day" data-day={g.day}>
                <h2 className="day-label">{formatDate(lang, g.day)}</h2>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 6 }}>
                  {g.items.map((it) => <Item key={`${it.item}-${it.ref_id}-${it.start_at}`} it={it} ctx={ctx} />)}
                </div>
              </section>
            ))}
          </>
        )}
      </div>
    </>
  );
}

function Item({ it, ctx }: { it: ScheduleItem; ctx: CoachCtx }) {
  const { slug, t, lang } = ctx;
  if (it.item === 'session' && it.kind) {
    const group = it.kind === 'group';
    const full = group && it.capacity !== null && (it.players ?? 0) >= it.capacity;
    const text = group
      ? full
        ? t('K-new.schedule_group_full', { className: className(lang, it) })
        : t('K-new.schedule_group', { className: className(lang, it), booked: it.players ?? 0, maxPlayers: it.capacity ?? 0 })
      : t('K-new.schedule_solo', { studentName: it.student_name ?? '', court: it.court });
    return (
      <a className="item" href={coachPath(slug, `/session/${it.kind}/${it.ref_id}`)} data-testid="item" data-item="session" data-kind={it.kind}>
        <span className="item-time">{bangkokTime(it.start_at)}</span>
        <span className={`tag ${group ? 'group' : ''}`}>{t(group ? 'K-0045' : 'K-0043')}</span>
        <span className="item-main">{text}</span>
      </a>
    );
  }
  if (it.item === 'leave') {
    const status = t(it.status === 'approved' ? 'K-0092' : 'K-new.leave_pending');
    const text = it.note ? t('K-new.schedule_leave', { leaveType: it.note, status }) : status;
    return (
      <div className="item" data-testid="item" data-item="leave">
        <span className="item-time">{isFullDay(it.start_at, it.end_at) ? '–' : bangkokTime(it.start_at)}</span>
        <span className="tag leave">{t('K-0021')}</span>
        <span className="item-main">{text}</span>
      </div>
    );
  }
  const until = bangkokTime(it.end_at);
  return (
    <div className="item blocked" data-testid="item" data-item="blocked">
      <span className="item-time">{bangkokTime(it.start_at)}</span>
      <span className="tag blocked">{t('K-0051')}</span>
      <span className="item-main">{it.court ? t('K-new.blocked_court', { court: it.court, reason: it.note ?? '', time: until }) : t('K-0067')}</span>
    </div>
  );
}
