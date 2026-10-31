'use client';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { ConsoleNav } from './ConsoleNav';
import {
  BASICS_FIELDS, changeStatus, issueWebhookToken, itemKey, LAUNCH_KEY, loadClub, pauseClub, RESULT_KEY, resumeClub, saveBasics, sendOwnerInvite, SETUP_KEY, WEBHOOK_KINDS,
  type BasicsField, type ClubView, type Failure, type WebhookKind,
} from './club';
import { STATUS_KEY, type Status } from './clubs';
import { t } from './i18n';
import { StepUpPanel } from './StepUpPanel';
import { SupportEditor } from './SupportEditor';

// /clubs/{id} (P3 and the support view): status and the checklist, the owner's invite, webhook addresses, and the club basics.
// A specialist sees the clubs assigned to them; admin-only actions (pause, resume, webhook addresses) show for admins. Anything
// the API wants a fresh second factor for opens the step-up and then runs again (D161). English only; text by key.

type Load = { kind: 'loading' } | { kind: 'error'; key: string; signIn?: boolean } | { kind: 'ready'; club: ClubView };
const BASICS_KEY: Record<BasicsField, string> = {
  name_th: 'X-0040', name_en: 'X-0041', legal_name: 'X-0042', owner_name: 'X-0050', owner_phone: 'X-new.basics_owner_phone', owner_line: 'X-new.basics_owner_line', owner_email: 'X-0057',
};
const NEXT_STATUSES: Status[] = ['testing', 'live', 'draft'];

export function ClubDetailScreen({ id }: { id: string }) {
  const [load, setLoad] = useState<Load>({ kind: 'loading' });
  const [isAdmin, setIsAdmin] = useState(false);
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<{ run(): Promise<void> } | null>(null);
  const [notice, setNotice] = useState<{ key: string; error: boolean } | null>(null);
  const [blocked, setBlocked] = useState<Array<{ item: string }> | null>(null);
  const [address, setAddress] = useState<{ url: string; replaced: boolean } | null>(null);
  const [copied, setCopied] = useState(false);
  const [to, setTo] = useState<Status>('testing');
  const [reason, setReason] = useState('');
  const [form, setForm] = useState<Record<BasicsField, string> | null>(null);

  const reload = useCallback(async () => {
    const r = await loadClub(window.fetch.bind(window), id);
    if (r.kind === 'ok') {
      setLoad({ kind: 'ready', club: r.club });
      setForm(Object.fromEntries(BASICS_FIELDS.map((k) => [k, r.club.support.club[k] ?? ''])) as Record<BasicsField, string>);
    } else setLoad({ kind: 'error', key: r.key, ...(r.signIn ? { signIn: true } : {}) });
  }, [id]);
  useEffect(() => {
    void reload();
    void window.fetch('/api/auth/me').then(async (res) => setIsAdmin(res.status === 200 && ((await res.json()) as { role?: string }).role === 'platform_admin')).catch(() => undefined);
  }, [reload]);

  /** Runs an action; a stale second factor opens the step-up and the same action runs again once it passes. */
  async function perform<T extends { kind: string }>(run: () => Promise<T | Failure>, onOk: (r: T) => Promise<void> | void) {
    const attempt = async (): Promise<void> => {
      setBusy(true);
      const r = await run();
      setBusy(false);
      if (r.kind === 'error') {
        const f = r as Failure;
        if (f.stepUp) return setPending({ run: attempt });
        setPending(null);
        return setNotice({ key: f.key, error: true });
      }
      setPending(null);
      setNotice(null);
      await onOk(r as T);
    };
    await attempt();
  }

  const status = (load.kind === 'ready' ? (load.club.support.club['status'] as Status | undefined) : undefined) ?? 'draft';
  const mode = load.kind === 'ready' ? load.club.support.mode : 'look';

  function onChangeStatus(e: FormEvent) {
    e.preventDefault();
    setBlocked(null);
    void perform(
      async () => {
        const r = await changeStatus(window.fetch.bind(window), id, to, reason);
        if (r.kind === 'blocked') {
          setBlocked(r.missing);
          return { kind: 'blockedShown' } as const;
        }
        return r;
      },
      async (r) => {
        if (r.kind === 'done') {
          setReason('');
          setNotice({ key: 'X-new.club_status_done', error: false });
          await reload();
        }
      },
    );
  }
  function onPauseResume(kind: 'pause' | 'resume') {
    void perform(() => (kind === 'pause' ? pauseClub : resumeClub)(window.fetch.bind(window), id, reason), async () => {
      setReason('');
      setNotice({ key: 'X-new.club_status_done', error: false });
      await reload();
    });
  }
  function onInvite() {
    void perform(() => sendOwnerInvite(window.fetch.bind(window), id), async () => {
      setNotice({ key: 'X-new.owner_invite_sent', error: false });
      await reload();
    });
  }
  function onWebhook(kind: WebhookKind) {
    void perform(() => issueWebhookToken(window.fetch.bind(window), id, kind), (r) => {
      if (r.kind === 'token') setAddress({ url: r.url, replaced: r.replaced });
    });
  }
  function onSaveBasics(e: FormEvent) {
    e.preventDefault();
    if (load.kind !== 'ready' || !form) return;
    void perform(() => saveBasics(window.fetch.bind(window), id, form, load.club.support.club), async (r) => {
      if (r.kind === 'saved') setNotice({ key: r.pendingOwnerContact ? 'X-new.basics_pending_owner' : 'X-new.basics_saved', error: false });
      await reload();
    });
  }
  async function copy() {
    if (!address) return;
    try {
      await navigator.clipboard.writeText(address.url);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  const club = load.kind === 'ready' ? load.club : null;
  const name = club?.support.club['name_en'] ?? '';

  return (
    <>
      <ConsoleNav current="clubs" />
      <main className="page wide" data-testid="club">
        <p><a href="/clubs" data-testid="back">{t('X-new.club_back')}</a></p>
        {load.kind === 'loading' ? <p aria-busy="true">…</p> : null}
        {load.kind === 'error' ? (
          <p role="alert" data-testid="load-error">
            {t(load.key)} {load.signIn ? <a href={`/sign-in?next=/clubs/${encodeURIComponent(id)}`} data-testid="sign-in-link">{t('X-new.signin_link')}</a> : null}
          </p>
        ) : null}

        {pending ? (
          <StepUpPanel signInHref={`/sign-in?next=/clubs/${encodeURIComponent(id)}`} onCancel={() => setPending(null)} onDone={() => { const again = pending.run; setPending(null); void again(); }} />
        ) : null}
        {notice ? <p role={notice.error ? 'alert' : 'status'} className={notice.error ? 'error' : 'ok'} data-testid="notice">{t(notice.key)}</p> : null}

        {address ? (
          <section className="link-box" role="dialog" aria-modal="false" aria-labelledby="address-title" data-testid="address-box">
            <h2 id="address-title">{t('X-new.webhook_title')}</h2>
            <p>{t('X-new.webhook_once')}{address.replaced ? ` ${t('X-new.webhook_replaced')}` : ''}</p>
            <input readOnly value={address.url} aria-label={t('X-new.webhook_title')} data-testid="address" onFocus={(e) => e.currentTarget.select()} />
            <div className="row">
              <button type="button" className="btn" onClick={copy} data-testid="address-copy">{copied ? t('X-new.staff_link_copied') : t('X-new.webhook_copy')}</button>
              <button type="button" className="btn secondary" onClick={() => { setAddress(null); setCopied(false); }} data-testid="address-done">{t('X-new.staff_link_done')}</button>
            </div>
          </section>
        ) : null}

        {club ? (
          <>
            <div className="head">
              <div>
                <h1>{name}</h1>
                <p className="lede" data-testid="mode">{t(mode === 'edit' ? 'X-new.club_mode_edit' : 'X-new.club_mode_look')}</p>
                {club.counts ? <p className="lede">{t('X-new.club_bookings', { count: club.counts.bookingsConfirmed30d })} · {t('X-new.club_messages', { count: club.counts.lineMessagesSent30d })}</p> : null}
              </div>
              <div className="tools">
                <span className={`pill ${status}`} data-testid="status">{t(STATUS_KEY[status])}</span>
                <a className="btn secondary small" href={`/clubs/${encodeURIComponent(id)}/launch`} data-testid="launch-link-top">{t('X-new.launch_link')}</a>
              </div>
            </div>
            <div className="grid2">
            <section aria-labelledby="status-title">
              <h2 id="status-title">{t('X-0135')}</h2>
              {status !== 'paused' ? (
                <form onSubmit={onChangeStatus} className="form inline" data-testid="status-form">
                  <label htmlFor="to">{t('X-new.club_status_to')}</label>
                  <select id="to" value={to} onChange={(e) => setTo(e.target.value as Status)}>
                    {NEXT_STATUSES.filter((s) => s !== status).map((s) => <option key={s} value={s}>{t(STATUS_KEY[s])}</option>)}
                  </select>
                  <label htmlFor="reason">{t('X-new.club_reason_optional')}</label>
                  <input id="reason" value={reason} onChange={(e) => setReason(e.target.value)} />
                  <button type="submit" className="btn" disabled={busy} data-testid="change-status">{t('X-0135')}</button>
                </form>
              ) : null}
              {blocked ? (
                <div role="alert" data-testid="blocked">
                  <p className="error">{t('X-new.club_blocked')}</p>
                  <ul>{blocked.map((m) => <li key={m.item}>{t(itemKey({ ...SETUP_KEY, ...LAUNCH_KEY }, m.item))}</li>)}</ul>
                </div>
              ) : null}
              {isAdmin && (status === 'live' || status === 'paused') ? (
                <div className="form inline" data-testid="pause-form">
                  <label htmlFor="pause-reason">{t('X-new.club_reason')}</label>
                  <input id="pause-reason" value={reason} onChange={(e) => setReason(e.target.value)} />
                  {status === 'live' ? (
                    <button type="button" className="btn secondary" disabled={busy || reason.trim() === ''} onClick={() => onPauseResume('pause')} data-testid="pause">{t('X-new.club_pause')}</button>
                  ) : (
                    <button type="button" className="btn" disabled={busy || reason.trim() === ''} onClick={() => onPauseResume('resume')} data-testid="resume">{t('X-new.club_resume')}</button>
                  )}
                </div>
              ) : null}
            </section>

            <section aria-labelledby="setup-title">
              <h2 id="setup-title">{t('X-new.club_setup_title', { done: club.progress.setup.filter((i) => i.done).length, total: club.progress.setup.length })}</h2>
              <ul className="checks" data-testid="setup">
                {club.progress.setup.map((i) => (
                  <li key={i.item} data-testid={`setup-${i.item}`} data-state={i.done ? 'done' : 'open'}>
                    {t(itemKey(SETUP_KEY, i.item))} · {i.done ? t('X-new.club_item_done') : t('X-new.club_item_open')} · {t(i.owed_by === 'owner' ? 'X-0215' : 'X-new.club_owed_booq')}
                  </li>
                ))}
              </ul>
            </section>

            <section aria-labelledby="live-title">
              <h2 id="live-title">{t('X-0154')}</h2>
              <p><a href={`/clubs/${encodeURIComponent(id)}/launch`} data-testid="launch-link">{t('X-new.launch_link')}</a></p>
              <ul className="checks" data-testid="launch">
                {club.progress.launch.map((i) => (
                  <li key={i.item} data-testid={`launch-${i.item}`} data-state={i.result === 'pass' ? 'done' : i.result === 'fail' ? 'fail' : 'wait'}>
                    {t(itemKey(LAUNCH_KEY, i.item))} · {t(RESULT_KEY[i.result] ?? 'X-new.result_pending')} · {t(i.owed_by === 'owner' ? 'X-0215' : 'X-new.club_owed_booq')}
                  </li>
                ))}
              </ul>
            </section>

            <section aria-labelledby="owner-title">
              <h2 id="owner-title">{t('X-0150')}</h2>
              <p data-testid="owner-contact">
                {t('X-new.owner_contact')}: {[club.support.club['owner_name'], club.support.club['owner_phone'], club.support.club['owner_email']].filter(Boolean).join(' · ') || t('X-new.owner_none')}
              </p>
              <p data-testid="invite-status">{t(`X-new.owner_invite_${club.invite.status}`)}</p>
              {club.invite.status !== 'redeemed' ? (
                <button type="button" className="btn" disabled={busy} onClick={onInvite} data-testid="send-invite">{t(club.invite.status === 'none' ? 'X-new.owner_invite_send' : 'X-0153')}</button>
              ) : null}
            </section>

            {isAdmin ? (
              <section aria-labelledby="webhook-title">
                <h2 id="webhook-title">{t('X-new.webhook_title')}</h2>
                <div className="row">
                  {WEBHOOK_KINDS.map((k) => (
                    <button key={k} type="button" className="btn secondary" disabled={busy || mode === 'look'} onClick={() => onWebhook(k)} data-testid={`webhook-${k}`}>{t(`X-new.webhook_${k}`)}</button>
                  ))}
                </div>
                <p className="sub">{t('X-new.support_connections_note')}</p>
              </section>
            ) : null}

            {form ? (
              <section aria-labelledby="basics-title">
                <h2 id="basics-title">{t('X-new.basics_title')}</h2>
                <form onSubmit={onSaveBasics} className="form inline" data-testid="basics-form">
                  {BASICS_FIELDS.map((k) => (
                    <div key={k} className="field">
                      <label htmlFor={`b-${k}`}>{t(BASICS_KEY[k])}</label>
                      <input id={`b-${k}`} name={k} value={form[k]} readOnly={mode === 'look'} onChange={(e) => setForm({ ...form, [k]: e.target.value })} />
                    </div>
                  ))}
                  {mode === 'edit' ? <button type="submit" className="btn" disabled={busy} data-testid="save-basics">{t('X-new.basics_save')}</button> : null}
                </form>
              </section>
            ) : null}

            <section aria-labelledby="support-title">
              <h2 id="support-title">{t('X-0134')}</h2>
              {mode === 'edit' ? (
                <SupportEditor id={id} support={club.support} busy={busy} onSaved={async () => { setNotice({ key: 'X-new.support_saved', error: false }); await reload(); }} onError={(key) => setNotice({ key, error: true })} />
              ) : (
                <>
              <h3>{t('X-new.support_hours')}</h3>
                  {club.support.hours.length === 0 ? <p>{t('X-new.support_none')}</p> : (
                    <ul data-testid="hours">{club.support.hours.map((h) => <li key={h.weekday}>{t(`X-new.weekday_${h.weekday}`)} {h.open}–{h.close}</li>)}</ul>
                  )}
                  <h3>{t('X-new.support_courts')}</h3>
                  {club.support.resources.length === 0 ? <p>{t('X-new.support_none')}</p> : (
                    <ul data-testid="courts">{club.support.resources.map((r) => <li key={r.id}>{r.name} · {r.sport}</li>)}</ul>
                  )}
                  <h3>{t('X-new.support_features')}</h3>
                  {club.support.features.length === 0 ? <p>{t('X-new.support_none')}</p> : (
                    <ul data-testid="features">{club.support.features.map((f) => <li key={f.feature_key}>{f.feature_key} · {t(f.enabled ? 'X-new.feature_on' : 'X-new.feature_off')}</li>)}</ul>
                  )}
    
                </>
              )}
            </section>
            </div>
          </>
        ) : null}
      </main>
    </>
  );
}
