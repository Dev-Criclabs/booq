'use client';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { weekdayKey } from '../../client/format';
import {
  bookingPath, cellAt, createPath, dayCounts, hourLabel, isOpenAt, loadCells, loadCourts, lookOf, movable, moveBooking, moveErrorKey, rangeOf, rowHours, shift, staleAfter, startOf, whenOf, addDays,
  type Cell, type Courts,
} from '../../client/admin/calendar';
import { longDayOf, timeOf, weekdayLongOf } from '../../client/admin/time';
import { useAdmin } from './AdminFrame';

// A1 Calendar (F11-T13; ADMIN-03; boards H-A01-Calendar, F3-01-A01-Calendar): a day (one column per court) or a week (one column per day, for one court),
// one row per open hour, the colour key, click an empty hour to create (A2) and move a booking by drag or by the Move form (the form is for touch and keyboard).
// The server decides every move (the exclusion constraints and the coach rules); a refusal is named and the grid is read again. Today comes from the server.

type Load = { kind: 'loading' } | { kind: 'ready' } | { kind: 'error' } | { kind: 'forbidden' };
type Msg = { key: string; vars?: Record<string, string | number>; error: boolean } | null;
const TONES = ['online', 'staff', 'awaiting', 'solo', 'group', 'closed'] as const;
const TONE_KEY: Record<(typeof TONES)[number], string> = { online: 'A-0013', staff: 'A-0014', awaiting: 'A-0015', solo: 'A-0016', group: 'A-0017', closed: 'A-0018' };

export function CalendarScreen() {
  const { slug, lang, t } = useAdmin();
  const f = () => window.fetch.bind(window);
  const [load, setLoad] = useState<Load>({ kind: 'loading' });
  const [courts, setCourts] = useState<Courts | null>(null);
  const [cells, setCells] = useState<Cell[]>([]);
  const [view, setView] = useState<'day' | 'week'>('day');
  const [day, setDay] = useState('');
  const [weekCourt, setWeekCourt] = useState('');
  const [picked, setPicked] = useState<Cell | null>(null);
  const [msg, setMsg] = useState<Msg>(null);
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState<Cell | null>(null);

  useEffect(() => {
    let live = true;
    void loadCourts(slug, f()).then((r) => {
      if (!live) return;
      if (r.kind === 'forbidden') return setLoad({ kind: 'forbidden' });
      if (r.kind !== 'ok') return setLoad({ kind: 'error' });
      setCourts(r.body);
      setDay(r.body.today);
      setWeekCourt(r.body.courts[0]?.id ?? '');
    });
    return () => {
      live = false;
    };
  }, [slug]);

  const range = useMemo(() => (day ? rangeOf(view, day) : null), [view, day]);
  const read = useCallback(async () => {
    if (!range) return;
    const r = await loadCells(slug, range.from, range.to, f());
    if (r.kind === 'forbidden') return setLoad({ kind: 'forbidden' });
    if (r.kind !== 'ok') return setLoad({ kind: 'error' });
    setCells(r.body ?? []);
    setLoad({ kind: 'ready' });
  }, [slug, range]);
  useEffect(() => {
    void read();
  }, [read]);

  async function move(c: Cell, courtId: string, toDay: string, hour: number) {
    if (!c.bookingId) return;
    setBusy(true);
    setMsg(null);
    const r = await moveBooking(slug, c.bookingId, courtId, startOf(toDay, hour), f());
    setBusy(false);
    if (r.kind === 'ok') {
      setPicked(null);
      setMsg({ key: 'A-new.cal_moved', error: false });
      return read();
    }
    setMsg({ ...moveErrorKey(r), error: true });
    if (staleAfter(r)) await read();
  }

  if (load.kind === 'forbidden') return <p role="alert" data-testid="cal-forbidden">{t('A-new.cal_err_forbidden')}</p>;
  if (load.kind === 'error') return <div role="alert" data-testid="cal-error"><p>{t('A-new.cal_load_failed')}</p><button type="button" className="adm-btn" onClick={() => window.location.reload()}>{t('A-new.set_retry')}</button></div>;
  if (!courts || !range || !day) return <p aria-busy="true" className="adm-muted">…</p>;

  const rows = rowHours(courts, range.days);
  const columns: Array<{ key: string; head: string; sub: string; courtId: string; day: string }> =
    view === 'day'
      ? courts.courts.map((c) => ({ key: c.id, head: t('A-0019', { court: c.name }), sub: '', courtId: c.id, day }))
      : range.days.map((d) => ({ key: d, head: t(weekdayKey(d)), sub: longDayOf(lang, d), courtId: weekCourt, day: d }));
  const counts = dayCounts(cells, day);

  return (
    <section data-testid="calendar" aria-labelledby="cal-title">
      <header className="adm-head">
        <h1 id="cal-title">{t('A-0002')}</h1>
        <a className="adm-btn" href={`/c/${slug}/admin/bookings/new`} data-testid="cal-new">{t('A-0012')}</a>
      </header>
      <p className="adm-muted" data-testid="cal-summary">{t('A-0008', { dateLongYear: `${weekdayLongOf(lang, day)} ${longDayOf(lang, day)}` })} · {t('A-0007', { count: counts.count, closedCount: counts.closed })}</p>

      <div className="adm-filters">
        <div className="adm-inline">
          <button type="button" className="adm-btn adm-btn-ghost" onClick={() => setDay(shift(view, day, -1))} aria-label={t('A-0034')} data-testid="cal-prev">‹</button>
          <button type="button" className="adm-btn adm-btn-ghost" onClick={() => setDay(courts.today)} data-testid="cal-today">{t('A-0009')}</button>
          <button type="button" className="adm-btn adm-btn-ghost" onClick={() => setDay(shift(view, day, 1))} aria-label={t('A-0035')} data-testid="cal-next">›</button>
        </div>
        <div role="group" aria-label={t('A-new.cal_view_label')} className="adm-chips">
          {(['day', 'week'] as const).map((v) => <button key={v} type="button" className="adm-chip-btn" aria-pressed={view === v} onClick={() => setView(v)} data-testid={`cal-${v}`}>{t(v === 'day' ? 'A-0010' : 'A-0011')}</button>)}
        </div>
        {view === 'week' ? (
          <label className="adm-field"><span className="adm-sr">{t('A-new.cal_court_pick')}</span>
            <select value={weekCourt} aria-label={t('A-new.cal_court_pick')} onChange={(e) => setWeekCourt(e.target.value)} data-testid="cal-court">
              {courts.courts.map((c) => <option key={c.id} value={c.id}>{t('A-0019', { court: c.name })}</option>)}
            </select>
          </label>
        ) : null}
      </div>

      <ul className="adm-key" aria-label={t('A-new.cal_key_label')} data-testid="cal-key">
        {TONES.map((x) => <li key={x}><span className={`adm-cal-dot adm-cal-${x}`} aria-hidden="true" />{t(TONE_KEY[x])}</li>)}
      </ul>

      <div aria-live="polite">{msg ? <p role={msg.error ? 'alert' : 'status'} className={msg.error ? 'adm-error' : 'adm-ok'} data-testid="cal-msg">{t(msg.key, msg.vars)}</p> : null}</div>

      {load.kind === 'loading' ? <p aria-busy="true" className="adm-muted">…</p> : null}
      {rows.length === 0 ? <p className="adm-muted" data-testid="cal-closed">{t('A-new.cal_closed_day')}</p> : (
        <div className="adm-table-wrap">
          <table className="adm-table adm-cal" aria-label={t('A-0002')} data-testid="cal-grid">
            <thead>
              <tr>
                <th scope="col"><span className="adm-sr">{t('A-new.cal_hour')}</span></th>
                {columns.map((c) => <th key={c.key} scope="col">{c.head}{c.sub ? <span className="adm-cal-sub"> {c.sub}</span> : null}</th>)}
              </tr>
            </thead>
            <tbody>
              {rows.map((h) => (
                <tr key={h}>
                  <th scope="row" className="adm-nowrap">{hourLabel(h)}</th>
                  {columns.map((col) => {
                    const cell = col.courtId ? cellAt(cells, col.courtId, col.day, h) : undefined;
                    const open = isOpenAt(courts, col.day, h);
                    if (!open) return <td key={col.key} className="adm-cal-off" data-testid={`off-${col.key}-${h}`} />;
                    if (cell) {
                      const look = lookOf(cell, lang);
                      return (
                        <td key={col.key} className={`adm-cal-cell adm-cal-${look.tone}`}>
                          <button
                            type="button" className="adm-cal-btn" aria-pressed={picked === cell} draggable={movable(cell)} disabled={busy}
                            onClick={() => { setPicked(cell); setMsg(null); }}
                            onDragStart={() => setDragging(cell)} onDragEnd={() => setDragging(null)}
                            data-testid={`cell-${cell.bookingId ?? cell.closureId ?? cell.resourceId}-${h}`}
                          >{t(look.key, look.vars)}</button>
                        </td>
                      );
                    }
                    return (
                      <td key={col.key} className="adm-cal-free" onDragOver={(e) => dragging && e.preventDefault()} onDrop={(e) => { e.preventDefault(); const d = dragging; setDragging(null); if (d) void move(d, col.courtId, col.day, h); }} data-testid={`free-${col.key}-${h}`}>
                        {col.courtId ? <a className="adm-cal-add" href={createPath(slug, col.courtId, col.day, h)} aria-label={t('A-0027', { time: hourLabel(h) })} data-testid={`new-${col.key}-${h}`}>+</a> : null}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {picked ? <Panel cell={picked} courts={courts} busy={busy} onClose={() => setPicked(null)} onMove={(courtId, d, h) => void move(picked, courtId, d, h)} /> : null}
    </section>
  );
}

function Panel({ cell, courts, busy, onClose, onMove }: { cell: Cell; courts: Courts; busy: boolean; onClose(): void; onMove(courtId: string, day: string, hour: number): void }) {
  const { slug, lang, t } = useAdmin();
  const when = whenOf(cell);
  const look = lookOf(cell, lang);
  const [courtId, setCourtId] = useState(cell.resourceId);
  const [toDay, setToDay] = useState(when?.day ?? '');
  const [hour, setHour] = useState(when?.hour ?? 0);
  useEffect(() => {
    setCourtId(cell.resourceId);
    setToDay(when?.day ?? '');
    setHour(when?.hour ?? 0);
  }, [cell, when?.day, when?.hour]);
  const hours = rowHours(courts, toDay ? [toDay] : []);
  return (
    <aside className="adm-card" role="region" aria-label={t('A-new.cal_details')} data-testid="cal-panel">
      <h2>{t(look.key, look.vars)}</h2>
      <p className="adm-muted">{t('A-0019', { court: cell.resourceName })} · {when ? `${longDayOf(lang, when.day)} ${hourLabel(when.hour)}` : ''} · {timeOf(cell.startAt)}–{timeOf(cell.endAt)}</p>
      {cell.coachName && cell.kind !== 'closure' ? <p>{t('A-new.cal_coach', { coachName: cell.coachName })}</p> : null}
      {cell.customerName ? <p>{t('A-new.cal_player_line', { playerName: cell.customerName })}</p> : null}
      {cell.state === 'held' ? <p className="adm-muted">{t('A-0015')}</p> : cell.bookingSource ? <p className="adm-muted">{t(cell.bookingSource === 'staff' ? 'A-0014' : 'A-0013')}</p> : null}
      {cell.bookingId ? <a className="adm-btn adm-btn-ghost" href={bookingPath(slug, cell.bookingId)} data-testid="cal-open">{t('A-new.cal_open_booking')}</a> : null}
      {movable(cell) ? (
        <form className="adm-form" onSubmit={(e) => { e.preventDefault(); onMove(courtId, toDay, hour); }} data-testid="cal-move">
          <h3>{t('A-new.cal_move_title')}</h3>
          <label className="adm-field"><span>{t('A-new.cal_court_pick')}</span>
            <select value={courtId} onChange={(e) => setCourtId(e.target.value)} data-testid="move-court">{courts.courts.map((c) => <option key={c.id} value={c.id}>{t('A-0019', { court: c.name })}</option>)}</select>
          </label>
          <label className="adm-field"><span>{t('A-new.cal_move_day')}</span>
            <input type="date" value={toDay} min={courts.today} max={addDays(courts.today, 366)} onChange={(e) => setToDay(e.target.value)} data-testid="move-day" />
          </label>
          <label className="adm-field"><span>{t('A-new.cal_hour')}</span>
            <select value={hour} onChange={(e) => setHour(Number(e.target.value))} data-testid="move-hour">{hours.map((h) => <option key={h} value={h}>{hourLabel(h)}</option>)}</select>
          </label>
          <span className="adm-inline">
            <button type="submit" className="adm-btn" disabled={busy || hours.length === 0} data-testid="move-do">{t('A-new.cal_move_do')}</button>
            <button type="button" className="adm-btn adm-btn-ghost" onClick={onClose} data-testid="cal-close">{t('A-new.cal_close')}</button>
          </span>
        </form>
      ) : <button type="button" className="adm-btn adm-btn-ghost" onClick={onClose} data-testid="cal-close">{t('A-new.cal_close')}</button>}
    </aside>
  );
}
