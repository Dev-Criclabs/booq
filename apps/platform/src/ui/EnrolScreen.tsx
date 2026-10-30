'use client';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { checkLink, finishEnrolment, groupSecret, startEnrolment, tokenFromHash, type CheckOutcome, type Step } from './enrol';
import { t } from './i18n';

// /enrol#token (F01-T17c): set a password, add an authenticator app, confirm with its code. Reached from the single-use
// link an admin hands over after an invite or a factor reset. The token is read from the fragment once and the fragment is
// cleared; the password is sent once and not kept; the setup key is shown only here. Text is by key (English only).

export function EnrolScreen() {
  const token = useRef<string | null | undefined>(undefined);
  const checked = useRef<Promise<CheckOutcome> | null>(null);
  const [step, setStep] = useState<Step>('checking');
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [enrolment, setEnrolment] = useState<{ id: string; secret: string; uri: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    // Strict mode runs effects twice; the first run already cleared the fragment, so the token is kept in a ref.
    if (token.current === undefined) {
      token.current = tokenFromHash(window.location.hash);
      if (window.location.hash) window.history.replaceState(null, '', window.location.pathname);
    }
    if (!token.current) return setStep('invalid');
    let live = true;
    // One request even when strict mode runs this effect twice.
    checked.current ??= checkLink(window.fetch.bind(window), token.current);
    void checked.current.then((r) => {
      if (!live) return;
      if (r.kind === 'ok') {
        setName(r.displayName);
        setStep('password');
      } else setStep(r.kind === 'invalid' ? 'invalid' : 'unavailable');
    });
    return () => {
      live = false;
    };
  }, []);

  async function onPassword(e: FormEvent) {
    e.preventDefault();
    if (!token.current || busy) return;
    setBusy(true);
    setError(null);
    const r = await startEnrolment(window.fetch.bind(window), token.current, password);
    setBusy(false);
    if (r.kind === 'ok') {
      setPassword('');
      setEnrolment({ id: r.enrolmentId, secret: r.secret, uri: r.uri });
      setStep('code');
    } else if (r.link) setStep('invalid');
    else setError(r.key);
  }

  async function onCode(e: FormEvent) {
    e.preventDefault();
    if (!enrolment || busy) return;
    setBusy(true);
    setError(null);
    const r = await finishEnrolment(window.fetch.bind(window), enrolment.id, code);
    setBusy(false);
    if (r.kind === 'done') {
      setEnrolment(null);
      setCode('');
      return setStep('done');
    }
    setError(r.key);
    setCode('');
    if (r.restart) {
      setEnrolment(null);
      setStep('password');
    }
  }

  return (
    <main className="page" data-testid="enrol" data-step={step} aria-busy={step === 'checking'}>
      <h1>{t('X-new.enrol_title')}</h1>
      {step === 'checking' ? <p data-testid="checking">{t('X-new.enrol_checking')}</p> : null}
      {step === 'invalid' ? <p role="alert" data-testid="invalid">{t('X-new.enrol_invalid_link')}</p> : null}
      {step === 'unavailable' ? <p role="alert" data-testid="unavailable">{t('X-new.enrol_unavailable')}</p> : null}
      {step === 'password' ? (
        <form onSubmit={onPassword} className="form" noValidate>
          <p>{t('X-new.enrol_greeting', { name })}</p>
          <label htmlFor="password">{t('X-new.enrol_password_label')}</label>
          <input id="password" name="password" type="password" autoComplete="new-password" required value={password} onChange={(e) => setPassword(e.target.value)} aria-invalid={error ? true : undefined} aria-describedby={error ? 'error' : undefined} />
          {error ? <p id="error" role="alert" className="error" data-testid="error">{t(error)}</p> : null}
          <button type="submit" className="btn" disabled={busy || password === ''} data-testid="continue">{t('X-new.enrol_password_submit')}</button>
        </form>
      ) : null}
      {step === 'code' && enrolment ? (
        <form onSubmit={onCode} className="form" noValidate>
          <p>{t('X-new.enrol_secret_hint')}</p>
          <p>
            <span className="label">{t('X-new.enrol_secret_label')}</span>
            <code data-testid="secret" className="secret">{groupSecret(enrolment.secret)}</code>
          </p>
          {enrolment.uri.startsWith('otpauth://') ? <p><a href={enrolment.uri} data-testid="open-app">{t('X-new.enrol_open_app')}</a></p> : null}
          <label htmlFor="code">{t('X-new.enrol_code_label')}</label>
          <input id="code" name="code" inputMode="numeric" autoComplete="one-time-code" required value={code} onChange={(e) => setCode(e.target.value)} aria-invalid={error ? true : undefined} aria-describedby={error ? 'error' : undefined} />
          {error ? <p id="error" role="alert" className="error" data-testid="error">{t(error)}</p> : null}
          <button type="submit" className="btn" disabled={busy || code.trim() === ''} data-testid="finish">{t('X-new.enrol_code_submit')}</button>
        </form>
      ) : null}
      {step === 'done' ? <p role="status" data-testid="done">{t('X-new.enrol_done')}</p> : null}
    </main>
  );
}
