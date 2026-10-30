'use client';
import { useState, type FormEvent } from 'react';
import { stepUp } from './auth';
import { t } from './i18n';

// The step-up (D161): the password again and a fresh code, for an action that needs a recently checked second factor
// (SR-16). Used inside a page (the team page) and on its own at /step-up. On success `onDone` runs the action again.

export function StepUpPanel({ onDone, onCancel, signInHref }: { onDone(): void; onCancel?(): void; signInHref: string }) {
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [signedOut, setSignedOut] = useState(false);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    const r = await stepUp(window.fetch.bind(window), password, code);
    setBusy(false);
    setPassword('');
    setCode('');
    if (r.kind === 'done') return onDone();
    setError(r.key);
    if (r.signedOut) setSignedOut(true);
  }

  return (
    <section className="link-box" role="dialog" aria-modal="false" aria-labelledby="stepup-title" data-testid="step-up">
      <h2 id="stepup-title">{t('X-new.stepup_title')}</h2>
      <p>{t('X-new.stepup_hint')}</p>
      <form onSubmit={submit} className="form" noValidate>
        <label htmlFor="stepup-password">{t('X-new.step_up_password_label')}</label>
        <input id="stepup-password" name="password" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} aria-invalid={error ? true : undefined} aria-describedby={error ? 'stepup-error' : undefined} />
        <label htmlFor="stepup-code">{t('X-new.enrol_code_label')}</label>
        <input id="stepup-code" name="code" inputMode="numeric" autoComplete="one-time-code" required value={code} onChange={(e) => setCode(e.target.value)} />
        {error ? (
          <p id="stepup-error" role="alert" className="error" data-testid="step-up-error">
            {t(error)} {signedOut ? <a href={signInHref} data-testid="step-up-sign-in">{t('X-new.signin_link')}</a> : null}
          </p>
        ) : null}
        <div className="row">
          <button type="submit" className="btn" disabled={busy || password === '' || code.trim() === ''} data-testid="step-up-submit">{t('X-new.stepup_submit')}</button>
          {onCancel ? <button type="button" className="btn secondary" onClick={onCancel} data-testid="step-up-cancel">{t('X-new.stepup_cancel')}</button> : null}
        </div>
      </form>
    </section>
  );
}
