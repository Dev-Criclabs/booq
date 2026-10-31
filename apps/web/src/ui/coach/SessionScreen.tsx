'use client';
import { useEffect, useMemo, useState } from 'react';
import { getSession, putAttendance, putNote, type RosterPlayer, type SessionDetail } from '../../client/coach/api';
import { bangkokDay, bangkokTime, className, initials, levelKey } from '../../client/coach/view';
import { formatDate } from '../../client/format';
import type { Lang } from '../../client/i18n';
import { CoachFrame, CoachState, type CoachCtx } from './CoachFrame';
import { coachPath } from './CoachNav';
import { useCoachData } from './useCoachData';

// K5 Session detail (CPORT-05; board H-K5-Session-detail; F12-T14): the roster of the coach's own session with Present and Absent, the
// private session note, and one save. A mark is a hint for the staff (D118): the screen says so and never touches a booking. Marking opens
// once the hour has ended and closes once the month is paid; a note opens when the session starts. Players are shown by initials.

const SHOWN = 3;

export function SessionScreen({ slug, initialLang, kind, id }: { slug: string; initialLang: Lang; kind: 'solo' | 'group'; id: string }) {
  return (
    <CoachFrame slug={slug} initialLang={initialLang} tab="today" screen="K5">
      {(ctx) => <Session ctx={ctx} kind={kind} id={id} />}
    </CoachFrame>
  );
}

function Session({ ctx, kind, id }: { ctx: CoachCtx; kind: 'solo' | 'group'; id: string }) {
  const { slug, t } = ctx;
  const { load, reload } = useCoachData(() => getSession(window.fetch.bind(window), slug, kind, id), [slug, kind, id]);
  if (load.state === 'error' && load.code === 'not_found') return <p className="coach-empty" data-testid="session-not-found" style={{ margin: 16 }}>{t('K-new.session_not_found')}</p>;
  if (load.state !== 'ready') return <CoachState load={load} t={t} reload={reload} />;
  return <Detail key={`${load.body.id}-${load.body.marked}-${load.body.session_note ?? ''}`} ctx={ctx} d={load.body} reload={reload} />;
}

function Detail({ ctx, d, reload }: { ctx: CoachCtx; d: SessionDetail; reload(): void }) {
  const { slug, t, lang } = ctx;
  const f = window.fetch.bind(window);
  const group = d.kind === 'group';
  const [marks, setMarks] = useState<Record<string, 'present' | 'absent' | null>>(() => Object.fromEntries(d.roster.map((p) => [p.booking_id, p.mark])));
  const [note, setNote] = useState(d.session_note ?? '');
  const [all, setAll] = useState(d.roster.length <= SHOWN);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<{ kind: 'ok' | 'bad'; key: string } | null>(null);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const idt = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(idt);
  }, []);
  const started = Date.parse(d.start_at) <= now;
  const canMark = d.can_mark === 'ok' && Date.parse(d.end_at) <= now;
  const markReason = d.can_mark === 'month_paid' ? 'K-new.mark_month_paid' : !canMark ? 'K-new.mark_not_ended' : null;
  const changedMarks = d.roster.filter((p) => marks[p.booking_id] && marks[p.booking_id] !== p.mark);
  const noteChanged = note.trim() !== (d.session_note ?? '');
  const dirty = changedMarks.length > 0 || noteChanged;
  const day = bangkokDay(d.start_at);
  const title = group ? className(lang, { class_name_th: d.class_name_th ?? null, class_name_en: d.class_name_en ?? null }) : d.roster[0]?.name ?? '';
  const shown = all ? d.roster : d.roster.slice(0, SHOWN);

  async function save() {
    setSaving(true);
    setStatus(null);
    for (const p of changedMarks) {
      const r = await putAttendance(f, slug, d.kind, d.id, p.booking_id, marks[p.booking_id]!);
      if (!r.ok) {
        setSaving(false);
        return setStatus({ kind: 'bad', key: r.code === 'month_paid' ? 'K-new.mark_month_paid' : r.code === 'not_ended' ? 'K-new.mark_not_ended' : r.code === 'offline' ? 'P-0327' : 'K-new.save_failed' });
      }
    }
    if (noteChanged) {
      const r = await putNote(f, slug, d.kind, d.id, null, note.trim() === '' ? null : note.trim());
      if (!r.ok) {
        setSaving(false);
        return setStatus({ kind: 'bad', key: r.code === 'not_started' ? 'K-new.note_not_started' : r.code === 'body_too_long' ? 'K-new.note_too_long' : r.code === 'offline' ? 'P-0327' : 'K-new.save_failed' });
      }
    }
    setSaving(false);
    setStatus({ kind: 'ok', key: 'K-new.saved' });
    reload();
  }

  return (
    <>
      <header className="sess-head">
        <button type="button" className="sess-back" aria-label={t('K-0037')} data-testid="back" onClick={() => (window.history.length > 1 ? window.history.back() : window.location.assign(coachPath(slug)))}>
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false"><path d="m15 18-6-6 6-6" /></svg>
        </button>
        <p className="sess-kind" data-testid="kind">{t(group ? 'K-0045' : 'K-0043')} · {d.court}</p>
        <h1 className="sess-title" data-testid="title">{title}</h1>
        <p className="sess-when">{t('K-0023', { dateYear: `${formatDate(lang, day)} ${day.slice(0, 4)}`, startTime: bangkokTime(d.start_at), endTime: bangkokTime(d.end_at) })}</p>
      </header>
      <main className="coach-body">
        <section className="card" data-testid="roster">
          <div className="card-head">
            <h2 className="card-title">{group ? t('K-0024', { count: d.players }) : t('K-new.student')}</h2>
            {d.listed > 0 ? <span className="pill" data-testid="marked">{t('K-0025', { marked: d.roster.filter((p) => marks[p.booking_id]).length, total: d.listed })}</span> : null}
          </div>
          {d.roster.length === 0 ? <p className="coach-lead" data-testid="no-roster">{t(d.held ? 'K-new.held_no_roster' : 'K-new.no_roster')}</p> : null}
          {shown.map((p) => <PlayerRow key={p.booking_id} p={p} mark={marks[p.booking_id] ?? null} canMark={canMark} ctx={ctx} onMark={(m) => setMarks({ ...marks, [p.booking_id]: m })} />)}
          {!all ? <button type="button" className="link-btn" data-testid="show-more" onClick={() => setAll(true)}>{t('K-0032', { count: d.roster.length - SHOWN })}</button> : null}
          {d.roster.length > 0 ? <p className="coach-lead" style={{ fontSize: 12 }} data-testid="hint">{t(markReason ?? 'K-new.mark_hint')}</p> : null}
        </section>
        <section className="card" data-testid="note-card">
          <div className="card-head">
            <h2 className="card-title">{t('K-0033')}</h2>
            <span className="card-aside">{t('K-0034')}</span>
          </div>
          <textarea className="textarea" data-testid="note" value={note} maxLength={2000} disabled={!started || saving} placeholder={t('K-0035')} aria-label={t('K-0033')} onChange={(e) => setNote(e.target.value)} />
          {!started ? <p className="coach-lead" style={{ fontSize: 12 }} data-testid="note-hint">{t('K-new.note_not_started')}</p> : null}
        </section>
      </main>
      <div className="coach-foot">
        {status ? <p className={`status-line ${status.kind}`} role="status" data-testid="status">{t(status.key)}</p> : null}
        <button type="button" className="btn btn-primary" data-testid="save" disabled={!dirty || saving} onClick={() => void save()}>
          <span>{t('K-0036')}</span>
        </button>
      </div>
    </>
  );
}

function PlayerRow({ p, mark, canMark, onMark, ctx }: { p: RosterPlayer; mark: 'present' | 'absent' | null; canMark: boolean; onMark(m: 'present' | 'absent'): void; ctx: CoachCtx }) {
  const { t } = ctx;
  const lk = levelKey(p.level);
  const level = lk ? t(lk) : '';
  const sub = p.last_note
    ? t(level ? 'K-new.player_last_note' : 'K-new.player_last_note_only', { level, note: p.last_note.body })
    : level;
  return (
    <div className="player" data-testid="player" data-mark={mark ?? ''}>
      <div className="player-top">
        <span className="avatar-sm" aria-hidden="true">{initials(p.name)}</span>
        <span className="player-text">
          <span className="player-name">{p.name}</span>
          {sub ? <span className="player-sub">{sub}</span> : null}
        </span>
      </div>
      <div className="seg" role="group" aria-label={p.name}>
        <button type="button" data-mark="present" aria-pressed={mark === 'present'} disabled={!canMark} onClick={() => onMark('present')}>{t('K-0027')}</button>
        <button type="button" data-mark="absent" aria-pressed={mark === 'absent'} disabled={!canMark} onClick={() => onMark('absent')}>{t('K-0028')}</button>
      </div>
    </div>
  );
}
