'use client';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { ConsoleNav } from './ConsoleNav';
import { check, fromCurrent, kindKey, KINDS, languageKey, LANGUAGES, loadLegal, partKey, PARTS, publish, when, type LegalView, type Problem, type Texts } from './legal';
import { t } from './i18n';
import { StepUpPanel } from './StepUpPanel';

// /legal: the privacy notice and the terms, each in Thai and English, and publishing a new version. Anyone signed in reads what
// is published; an admin publishes, with the step-up when asked (D161). A published version cannot be changed or deleted
// (append-only), so there is a confirmation first. English only for the page itself; the notice texts are typed content.

export function LegalScreen() {
  const [state, setState] = useState<{ kind: 'loading' } | { kind: 'error'; key: string; signIn?: boolean } | { kind: 'ready'; view: LegalView }>({ kind: 'loading' });
  const [isAdmin, setIsAdmin] = useState(false);
  const [texts, setTexts] = useState<Texts | null>(null);
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<{ run(): Promise<void> } | null>(null);
  const [message, setMessage] = useState<{ key: string; vars?: Record<string, string>; error: boolean } | null>(null);

  const reload = useCallback(async () => {
    const r = await loadLegal(window.fetch.bind(window));
    if (r.kind === 'ok') {
      setState({ kind: 'ready', view: r.view });
      setTexts(fromCurrent(r.view));
    } else setState({ kind: 'error', key: r.key, ...(r.signIn ? { signIn: true } : {}) });
  }, []);
  useEffect(() => {
    void reload();
    void window.fetch('/api/auth/me').then(async (res) => setIsAdmin(res.status === 200 && ((await res.json()) as { role?: string }).role === 'platform_admin')).catch(() => undefined);
  }, [reload]);

  const describe = (p: Problem): { key: string; vars: Record<string, string> } =>
    p.key === 'X-new.legal_missing'
      ? { key: p.key, vars: { what: t('X-new.legal_field', { kind: t(kindKey(p.kind)), language: t(languageKey(p.language)), part: t(partKey(p.part)) }) } }
      : { key: p.key, vars: { field: `{${p.field}}`, clubName: '{clubName}', legalName: '{legalName}' } };

  function onPublish(e: FormEvent) {
    e.preventDefault();
    if (!texts || busy) return;
    const problem = check(texts);
    if (problem) return setMessage({ ...describe(problem), error: true });
    if (!window.confirm(t('X-new.legal_confirm'))) return;
    const attempt = async (): Promise<void> => {
      setBusy(true);
      const r = await publish(window.fetch.bind(window), texts);
      setBusy(false);
      if (r.kind === 'error') {
        if (r.stepUp) return setPending({ run: attempt });
        setPending(null);
        return setMessage({ ...(r.problem ? describe(r.problem) : { key: r.key, vars: {} }), error: true });
      }
      setPending(null);
      setMessage({ key: 'X-new.legal_published', vars: { version: r.version }, error: false });
      await reload();
    };
    void attempt();
  }

  const view = state.kind === 'ready' ? state.view : null;

  return (
    <>
      <ConsoleNav current="legal" />
      <main className="page wide" data-testid="legal">
        <h1>{t('X-new.legal_title')}</h1>
        <p>{t('X-new.legal_intro', { clubName: '{clubName}', legalName: '{legalName}' })}</p>
        {state.kind === 'loading' ? <p aria-busy="true">…</p> : null}
        {state.kind === 'error' ? (
          <p role="alert" data-testid="load-error">
            {t(state.key)} {state.signIn ? <a href="/sign-in?next=/legal" data-testid="sign-in-link">{t('X-new.signin_link')}</a> : null}
          </p>
        ) : null}
        {pending ? <StepUpPanel signInHref="/sign-in?next=/legal" onCancel={() => setPending(null)} onDone={() => { const again = pending.run; setPending(null); void again(); }} /> : null}
        {message ? <p role={message.error ? 'alert' : 'status'} className={message.error ? 'error' : 'ok'} data-testid="message">{t(message.key, message.vars)}</p> : null}

        {view ? (
          <>
            {view.current ? (
              <p data-testid="current">{t('X-new.legal_current', { version: view.current.version, when: when(view.releases[0]!.publishedAt) })}</p>
            ) : (
              <p role="status" data-testid="none">{t('X-new.legal_none')}</p>
            )}
            {view.releases.length > 1 ? (
              <details>
                <summary>{t('X-new.legal_history')}</summary>
                <ul data-testid="history">
                  {view.releases.slice(1).map((r) => <li key={r.version}>{t('X-new.legal_history_row', { version: r.version, when: when(r.publishedAt), who: r.publishedBy ?? '' })}</li>)}
                </ul>
              </details>
            ) : null}

            {texts ? (
              <form onSubmit={onPublish} className="form" data-testid="legal-form" noValidate>
                <h2>{t('X-new.legal_new')}</h2>
                {view.current ? <p className="sub">{t('X-new.legal_prefill')}</p> : null}
                {!isAdmin ? <p data-testid="admin-only">{t('X-new.legal_admin_only')}</p> : null}
                {KINDS.map((k) =>
                  LANGUAGES.map((l) => (
                    <fieldset key={`${k}-${l}`} className="notice" data-testid={`notice-${k}-${l}`}>
                      <legend>{t(kindKey(k))} · {t(languageKey(l))}</legend>
                      {PARTS.map((p) => (
                        <div key={p} className="field">
                          <label htmlFor={`${k}-${l}-${p}`}>{t(partKey(p))}</label>
                          {p === 'body' ? (
                            <textarea id={`${k}-${l}-${p}`} rows={8} lang={l} readOnly={!isAdmin} value={texts[k][l][p]} onChange={(e) => setTexts({ ...texts, [k]: { ...texts[k], [l]: { ...texts[k][l], [p]: e.target.value } } })} />
                          ) : (
                            <input id={`${k}-${l}-${p}`} lang={l} readOnly={!isAdmin} value={texts[k][l][p]} onChange={(e) => setTexts({ ...texts, [k]: { ...texts[k], [l]: { ...texts[k][l], [p]: e.target.value } } })} />
                          )}
                        </div>
                      ))}
                    </fieldset>
                  )),
                )}
                {isAdmin ? <button type="submit" className="btn" disabled={busy} data-testid="publish">{t('X-new.legal_publish')}</button> : null}
              </form>
            ) : null}
          </>
        ) : null}
      </main>
    </>
  );
}
