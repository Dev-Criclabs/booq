'use client';
import { useCallback, useEffect, useState } from 'react';
import { itemKey, LAUNCH_KEY, RESULT_KEY, SETUP_KEY, changeStatus, type Failure } from './club';
import { ConsoleNav } from './ConsoleNav';
import { loadLaunch, MARK_KEY, openChecks, RECORD_RESULTS, recordResult, type Launch, type RecordResult } from './launch';
import { t } from './i18n';
import { StepUpPanel } from './StepUpPanel';

// /clubs/{id}/launch (P4): the checks a club must pass to go live and their results. An admin records the ones that are
// recorded by hand, while the club is in Testing; the step-up runs first when the API asks (D161). Go live moves the club
// to Live, and the API names anything still missing. English only; text by key.

export function LaunchScreen({ id }: { id: string }) {
  const [state, setState] = useState<{ kind: 'loading' } | { kind: 'error'; key: string; signIn?: boolean } | { kind: 'ready'; launch: Launch }>({ kind: 'loading' });
  const [isAdmin, setIsAdmin] = useState(false);
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<{ run(): Promise<void> } | null>(null);
  const [notice, setNotice] = useState<{ key: string; error: boolean } | null>(null);
  const [blocked, setBlocked] = useState<Array<{ item: string }> | null>(null);

  const reload = useCallback(async () => {
    const r = await loadLaunch(window.fetch.bind(window), id);
    setState(r.kind === 'ok' ? { kind: 'ready', launch: r.launch } : { kind: 'error', key: r.key, ...(r.signIn ? { signIn: true } : {}) });
  }, [id]);
  useEffect(() => {
    void reload();
    void window.fetch('/api/auth/me').then(async (res) => setIsAdmin(res.status === 200 && ((await res.json()) as { role?: string }).role === 'platform_admin')).catch(() => undefined);
  }, [reload]);

  async function perform(run: () => Promise<{ kind: string } | Failure>, onOk: () => Promise<void>) {
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
      if (r.kind === 'blocked') return;
      setNotice(null);
      await onOk();
    };
    await attempt();
  }

  function onRecord(item: string, result: RecordResult) {
    void perform(() => recordResult(window.fetch.bind(window), id, item, result), async () => {
      setNotice({ key: 'X-new.launch_recorded', error: false });
      await reload();
    });
  }
  function onGoLive() {
    setBlocked(null);
    void perform(
      async () => {
        const r = await changeStatus(window.fetch.bind(window), id, 'live', '');
        if (r.kind === 'blocked') setBlocked(r.missing);
        return r;
      },
      async () => {
        setNotice({ key: 'X-new.club_status_done', error: false });
        await reload();
      },
    );
  }

  const launch = state.kind === 'ready' ? state.launch : null;
  const canRecord = isAdmin && launch?.clubStatus === 'testing';

  return (
    <>
      <ConsoleNav current="clubs" />
      <main className="page wide" data-testid="launch-page">
        <p><a href={`/clubs/${encodeURIComponent(id)}`} data-testid="back">{t('X-new.launch_back')}</a></p>
        {state.kind === 'loading' ? <p aria-busy="true">…</p> : null}
        {state.kind === 'error' ? (
          <p role="alert" data-testid="load-error">
            {t(state.key)} {state.signIn ? <a href={`/sign-in?next=/clubs/${encodeURIComponent(id)}/launch`} data-testid="sign-in-link">{t('X-new.signin_link')}</a> : null}
          </p>
        ) : null}
        {pending ? <StepUpPanel signInHref={`/sign-in?next=/clubs/${encodeURIComponent(id)}/launch`} onCancel={() => setPending(null)} onDone={() => { const again = pending.run; setPending(null); void again(); }} /> : null}
        {notice ? <p role={notice.error ? 'alert' : 'status'} className={notice.error ? 'error' : 'ok'} data-testid="notice">{t(notice.key)}</p> : null}

        {launch ? (
          <>
            <h1>{t('X-new.launch_title', { clubName: launch.clubName })}</h1>
            {launch.clubStatus !== 'testing' ? <p data-testid="not-testing">{t('X-new.launch_not_testing')}</p> : !isAdmin ? <p data-testid="admin-only">{t('X-new.launch_admin_only')}</p> : null}
            <h2>{t('X-0178')}</h2>
            {launch.items.length === 0 ? <p data-testid="empty">{t('X-new.launch_empty')}</p> : (
              <ul className="checks" data-testid="checks">
                {launch.items.map((i) => (
                  <li key={i.item} data-testid={`check-${i.item}`}>
                    <strong>{t(itemKey({ ...LAUNCH_KEY, ...SETUP_KEY }, i.item))}</strong> · <span data-testid={`result-${i.item}`}>{t(RESULT_KEY[i.result] ?? 'X-new.result_pending')}</span> · {t(i.owed_by === 'owner' ? 'X-0215' : 'X-new.club_owed_booq')} · {t(i.recorded ? 'X-new.launch_by_hand' : 'X-new.launch_derived')}
                    {canRecord && i.recorded ? (
                      <span className="row">
                        {RECORD_RESULTS.filter((r) => r !== i.result).map((r) => (
                          <button key={r} type="button" className="btn small secondary" disabled={busy} onClick={() => onRecord(i.item, r)} data-testid={`mark-${i.item}-${r}`}>{t(MARK_KEY[r])}</button>
                        ))}
                      </span>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
            <p data-testid="summary">{openChecks(launch.items) === 0 && launch.items.length > 0 ? t('X-new.launch_all_pass') : t('X-new.launch_some_open', { count: openChecks(launch.items) })}</p>
            {blocked ? (
              <div role="alert" data-testid="blocked">
                <p className="error">{t('X-new.club_blocked')}</p>
                <ul>{blocked.map((m) => <li key={m.item}>{t(itemKey({ ...SETUP_KEY, ...LAUNCH_KEY }, m.item))}</li>)}</ul>
              </div>
            ) : null}
            {launch.clubStatus === 'testing' ? (
              <p>
                <button type="button" className="btn" disabled={busy} onClick={onGoLive} data-testid="go-live">{t('X-0187')}</button>
                <span className="sub">{t('X-0188')}</span>
              </p>
            ) : null}
          </>
        ) : null}
      </main>
    </>
  );
}
