'use client';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { ConsoleNav } from './ConsoleNav';
import { isKnown, KNOWN, labelKey, loadConfig, saveValue, show, type Kind } from './config';
import { t } from './i18n';
import { StepUpPanel } from './StepUpPanel';

// /config (P6 config): the platform values every club shares. Anyone signed in reads them; an admin changes one, with a fresh
// second factor when the API asks (D161). A setting that is not set says so: none has a default. English only; text by key.

export function ConfigScreen() {
  const [state, setState] = useState<{ kind: 'loading' } | { kind: 'error'; key: string; signIn?: boolean } | { kind: 'ready'; values: Record<string, unknown> }>({ kind: 'loading' });
  const [isAdmin, setIsAdmin] = useState(false);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<{ run(): Promise<void> } | null>(null);
  const [message, setMessage] = useState<{ key: string; error: boolean; for?: string } | null>(null);

  const reload = useCallback(async () => {
    const r = await loadConfig(window.fetch.bind(window));
    if (r.kind === 'ok') {
      setState({ kind: 'ready', values: r.values });
      setDrafts(Object.fromEntries(Object.entries(r.values).map(([k, v]) => [k, show(v)])));
    } else setState({ kind: 'error', key: r.key, ...(r.signIn ? { signIn: true } : {}) });
  }, []);
  useEffect(() => {
    void reload();
    void window.fetch('/api/auth/me').then(async (res) => setIsAdmin(res.status === 200 && ((await res.json()) as { role?: string }).role === 'platform_admin')).catch(() => undefined);
  }, [reload]);

  function onSave(e: FormEvent, key: string, kind: Kind) {
    e.preventDefault();
    const attempt = async (): Promise<void> => {
      setBusy(true);
      const r = await saveValue(window.fetch.bind(window), key, kind, drafts[key] ?? '');
      setBusy(false);
      if (r.kind === 'error') {
        if (r.stepUp) return setPending({ run: attempt });
        setPending(null);
        return setMessage({ key: r.key, error: true, for: key });
      }
      setPending(null);
      setMessage({ key: 'X-new.config_saved', error: false, for: key });
      await reload();
    };
    void attempt();
  }

  const values = state.kind === 'ready' ? state.values : {};
  const others = Object.keys(values).filter((k) => !isKnown(k));

  return (
    <>
      <ConsoleNav current="config" />
      <main className="page wide" data-testid="config">
        <h1>{t('X-new.config_title')}</h1>
        <p>{t('X-new.config_intro')}</p>
        {state.kind === 'loading' ? <p aria-busy="true">…</p> : null}
        {state.kind === 'error' ? (
          <p role="alert" data-testid="load-error">
            {t(state.key)} {state.signIn ? <a href="/sign-in?next=/config" data-testid="sign-in-link">{t('X-new.signin_link')}</a> : null}
          </p>
        ) : null}
        {pending ? <StepUpPanel signInHref="/sign-in?next=/config" onCancel={() => setPending(null)} onDone={() => { const again = pending.run; setPending(null); void again(); }} /> : null}
        {state.kind === 'ready' ? (
          <>
            {!isAdmin ? <p data-testid="admin-only">{t('X-new.config_admin_only')}</p> : null}
            <ul className="settings" data-testid="settings">
              {KNOWN.map(({ key, kind, fixed }) => (
                <li key={key} data-testid={`setting-${key}`}>
                  <form onSubmit={(e) => onSave(e, key, kind)} className="form inline">
                    <label htmlFor={`v-${key}`}>{t(labelKey(key))}</label>
                    {Object.hasOwn(values, key) ? null : <span className="sub" data-testid={`unset-${key}`}>{t('X-new.config_not_set')}</span>}
                    {fixed ? (
                      <>
                        <input id={`v-${key}`} value={drafts[key] ?? ''} readOnly aria-describedby={`fixed-${key}`} />
                        <span className="sub" id={`fixed-${key}`} data-testid={`fixed-${key}`}>{t('X-new.config_fixed')}</span>
                      </>
                    ) : kind === 'list' ? (
                      <textarea id={`v-${key}`} rows={4} value={drafts[key] ?? ''} readOnly={!isAdmin} onChange={(e) => setDrafts({ ...drafts, [key]: e.target.value })} />
                    ) : (
                      <input id={`v-${key}`} inputMode="decimal" value={drafts[key] ?? ''} readOnly={!isAdmin} onChange={(e) => setDrafts({ ...drafts, [key]: e.target.value })} />
                    )}
                    {isAdmin && !fixed ? <button type="submit" className="btn small" disabled={busy} data-testid={`save-${key}`}>{t('X-new.config_save')}</button> : null}
                    {message?.for === key ? <p role={message.error ? 'alert' : 'status'} className={message.error ? 'error' : 'ok'} data-testid={`message-${key}`}>{t(message.key)}</p> : null}
                  </form>
                </li>
              ))}
            </ul>
            {others.length > 0 ? (
              <>
                <h2>{t('X-new.config_other')}</h2>
                <ul data-testid="others">{others.map((k) => <li key={k}><code>{k}</code>: <code>{show(values[k])}</code></li>)}</ul>
              </>
            ) : null}
          </>
        ) : null}
      </main>
    </>
  );
}
