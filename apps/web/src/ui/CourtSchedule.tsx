'use client';
import { dayOfMonth, formatDate, formatMonthYear, weekdayKey } from '../client/format';
import type { Lang, T } from '../client/i18n';
import { endTime, startTime, type ScheduleDay, type Selection, type SlotState } from '../client/schedule';
import { BottomNav } from './BottomNav';

// C4 Book a court (V-C04-Book-a-court, T-C04-Book-a-court, S-C04-Day-full, S-C04-Loading; F03-T24).
// Every state has its own word and its own icon shape, so none depends on colour (BOOK-01-AC7).
// Held, Taken, Closed, Past and Yours are shown and cannot be chosen. The price is not shown here:
// it comes from checkout (F04), never from the screen.

export type CellState = SlotState | 'selected';

const LABEL: Record<CellState, string> = {
  open: 'P-0046',
  selected: 'P-0047',
  held: 'P-0055',
  taken: 'P-0049',
  closed: 'P-0050',
  past: 'P-new.slot_past',
  mine: 'P-0051',
};
const LEGEND: Array<[CellState, string]> = [
  ['open', 'P-0046'],
  ['selected', 'P-0047'],
  ['held', 'P-0048'],
  ['taken', 'P-0049'],
  ['closed', 'P-0050'],
  ['past', 'P-new.slot_past'],
  ['mine', 'P-0051'],
];

/** One icon shape per state: a dot, a tick, a clock, a bar, a lock, a dash and a star. */
export function StateIcon({ state }: { state: CellState }) {
  const common = { width: 12, height: 12, viewBox: '0 0 24 24', 'aria-hidden': true, focusable: false } as const;
  switch (state) {
    case 'open':
      return <svg {...common}><circle cx="12" cy="12" r="6" fill="currentColor" /></svg>;
    case 'selected':
      return <svg {...common}><path d="M4 12.5 9.5 18 20 7" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" /></svg>;
    case 'held':
      return <svg {...common}><circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeWidth="2.5" /><path d="M12 7v5l3 2" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" /></svg>;
    case 'taken':
      return <svg {...common}><rect x="4" y="9" width="16" height="6" rx="2" fill="currentColor" /></svg>;
    case 'closed':
      return <svg {...common}><rect x="5" y="11" width="14" height="10" rx="2" fill="currentColor" /><path d="M8 11V8a4 4 0 0 1 8 0v3" fill="none" stroke="currentColor" strokeWidth="2.5" /></svg>;
    case 'past':
      return <svg {...common}><path d="M5 12h14" stroke="currentColor" strokeWidth="3" strokeLinecap="round" /></svg>;
    case 'mine':
      return <svg {...common}><path d="m12 3 2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z" fill="currentColor" /></svg>;
  }
}

export interface CourtScheduleProps {
  t: T;
  lang: Lang;
  slug: string;
  dates: string[];
  date: string | null;
  onDate(date: string): void;
  day: ScheduleDay | null;
  loading: boolean;
  selection: Selection | null;
  onTap(courtId: string, start: string): void;
  onContinue(): void;
  onBack(): void;
  dayFull: { fromTime: string | null; next: { date: string; hours: number } | null } | null;
  /** The club has no booking window set: no date is offered (D42). */
  closedForBooking: boolean;
  paused: boolean;
}

export function cellState(selection: Selection | null, courtId: string, start: string, state: SlotState): CellState {
  return selection && selection.courtId === courtId && selection.starts.includes(start) ? 'selected' : state;
}

function Cell({ t, state, waitlist, dayFull, onTap, label }: { t: T; state: CellState; waitlist: boolean; dayFull: boolean; onTap(): void; label: string }) {
  const tappable = state === 'open' || state === 'selected';
  const content =
    state === 'taken' && waitlist ? (
      dayFull ? (
        <span className="waitlist">{t('P-0324')}</span>
      ) : (
        <>
          <span>{t('P-0053')}</span> <span className="waitlist">{t('P-0054')}</span>
        </>
      )
    ) : (
      <span>{t(LABEL[state])}</span>
    );
  if (!tappable) {
    return (
      <div className={`slot slot-${state}`} data-state={state} data-waitlist={waitlist || undefined} aria-label={label} role="img">
        <StateIcon state={state} />
        <span className="slot-text">{content}</span>
      </div>
    );
  }
  return (
    <button type="button" className={`slot slot-${state}`} data-state={state} aria-pressed={state === 'selected'} aria-label={label} onClick={onTap}>
      <StateIcon state={state} />
      <span className="slot-text">{content}</span>
    </button>
  );
}

export function CourtSchedule(p: CourtScheduleProps) {
  const { t, lang, day, selection } = p;
  const chosenCourt = selection && day ? day.courts.find((c) => c.id === selection.courtId) : undefined;
  const rows = day?.courts[0]?.hours.map((h) => h.start) ?? [];
  return (
    <div className="app schedule" data-screen="C4">
      <header className="top-bar">
        <button type="button" className="icon-btn on-dark" aria-label={t('P-0058')} onClick={p.onBack}>
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
            <path d="m15 18-6-6 6-6" />
          </svg>
        </button>
        <h1>{t('P-0024')}</h1>
      </header>

      {p.paused ? (
        <main className="schedule-body">
          <section className="notice-card" data-testid="paused" role="status">
            <b>{t('P-0442')}</b>
            <p>{t('P-0443')}</p>
          </section>
        </main>
      ) : p.closedForBooking ? (
        <main className="schedule-body">
          <section className="notice-card" data-testid="not-open" role="status">
            <p>{t('P-new.club_not_available')}</p>
          </section>
        </main>
      ) : (
        <>
          <div className="schedule-head">
            <p className="month">{p.date ? t('P-0039', { monthYear: formatMonthYear(lang, p.date) }) : null}</p>
            <div className="date-strip" role="tablist">
              {p.dates.map((d) => (
                <button key={d} type="button" role="tab" aria-selected={d === p.date} className="date-chip" data-date={d} onClick={() => p.onDate(d)}>
                  <span>{t(weekdayKey(d))}</span>
                  <b>{dayOfMonth(d)}</b>
                </button>
              ))}
            </div>
            <ul className="legend">
              {LEGEND.map(([s, k]) => (
                <li key={s} className={`legend-${s}`}>
                  <StateIcon state={s} />
                  {t(k)}
                </li>
              ))}
            </ul>
          </div>

          <main className="schedule-body" aria-busy={p.loading}>
            {p.loading || !day ? (
              <div className="grid skeleton" data-testid="loading">
                {Array.from({ length: 7 }, (_, i) => (
                  <div key={i} className="grid-row">
                    <span className="sk sk-time" />
                    <span className="sk" />
                    <span className="sk" />
                  </div>
                ))}
              </div>
            ) : (
              <>
                {day.dayFull && p.dayFull ? (
                  <section className="day-full" data-testid="day-full" role="status">
                    <p>
                      {p.dayFull.fromTime ? t('P-0322', { date: formatDate(lang, day.date), time: p.dayFull.fromTime }) : null}{' '}
                      {p.dayFull.next ? <b>{t('P-0323', { date: formatDate(lang, p.dayFull.next.date), hours: p.dayFull.next.hours })}</b> : null}
                    </p>
                    {p.dayFull.next ? (
                      <button type="button" className="btn btn-ghost btn-small" data-testid="see-next" onClick={() => p.onDate(p.dayFull!.next!.date)}>
                        <span>{t('P-0325', { date: formatDate(lang, p.dayFull.next.date) })}</span>
                      </button>
                    ) : null}
                  </section>
                ) : null}
                <div className="grid" style={{ gridTemplateColumns: `52px repeat(${day.courts.length}, minmax(0, 1fr))` }} data-testid="grid">
                  <span />
                  {day.courts.map((c) => (
                    <b key={c.id} className="court-head">
                      {t('P-0021', { court: c.name })}
                    </b>
                  ))}
                  {rows.map((start, r) => (
                    <div key={start} className="grid-row-contents">
                      <span className="time">{startTime(start)}</span>
                      {day.courts.map((c) => {
                        const h = c.hours[r]!;
                        const state = cellState(selection, c.id, h.start, h.state);
                        const label = `${t('P-0021', { court: c.name })} · ${startTime(h.start)} · ${state === 'taken' && h.waitlist ? t('P-0053') + ' ' + t('P-0054') : t(LABEL[state])}`;
                        return <Cell key={c.id} t={t} state={state} waitlist={h.waitlist} dayFull={day.dayFull} label={label} onTap={() => p.onTap(c.id, h.start)} />;
                      })}
                    </div>
                  ))}
                </div>
              </>
            )}
          </main>

          {selection && chosenCourt && day ? (
            <div className="summary-bar" data-testid="summary">
              <span>
                {t('P-0347', {
                  court: chosenCourt.name,
                  date: formatDate(lang, day.date),
                  startTime: startTime(selection.starts[0]!),
                  endTime: endTime(selection.starts[selection.starts.length - 1]!),
                })}
              </span>
              <button type="button" className="btn btn-accent" data-testid="continue" onClick={p.onContinue}>
                <span>{t('P-0057')}</span>
              </button>
            </div>
          ) : null}
        </>
      )}
      <BottomNav t={t} slug={p.slug} current="courts" />
    </div>
  );
}
