'use client';
import { useState, type FormEvent } from 'react';
import { safeNext, signInWithCode, signInWithPassword } from './auth';
import { t } from './i18n';

// /sign-in?next=/staff (F01-T17): email and password, then the code from the authenticator app. The session cookie is set
// by the server and the page never sees it. Text is by key (English only).

export function SignInScreen({ next }: { next: string | null }) {
  const [step, setStep] = useState<'password' | 'code'>('password');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [challengeId, setChallengeId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onPassword(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    const r = await signInWithPassword(window.fetch.bind(window), email, password);
    setBusy(false);
    if (r.kind === 'challenge') {
      setPassword('');
      setChallengeId(r.challengeId);
      setStep('code');
    } else setError(r.key);
  }

  async function onCode(e: FormEvent) {
    e.preventDefault();
    if (busy || !challengeId) return;
    setBusy(true);
    setError(null);
    const r = await signInWithCode(window.fetch.bind(window), challengeId, code);
    if (r.kind === 'done') return window.location.replace(safeNext(next));
    setBusy(false);
    setError(r.key);
    setCode('');
    if (r.restart) {
      setChallengeId(null);
      setStep('password');
    }
  }

  return (
    <main className="page" data-testid="sign-in" data-step={step}>
      <h1>{t('X-new.signin_title')}</h1>
      {step === 'password' ? (
        <form onSubmit={onPassword} className="form" noValidate>
          <label htmlFor="email">{t('X-new.staff_email')}</label>
          <input id="email" name="email" type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} aria-invalid={error ? true : undefined} aria-describedby={error ? 'error' : undefined} />
          <label htmlFor="password">{t('X-new.step_up_password_label')}</label>
          <input id="password" name="password" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} aria-invalid={error ? true : undefined} aria-describedby={error ? 'error' : undefined} />
          {error ? <p id="error" role="alert" className="error" data-testid="error">{t(error)}</p> : null}
          <button type="submit" className="btn" disabled={busy || email.trim() === '' || password === ''} data-testid="continue">{t('X-new.enrol_password_submit')}</button>
        </form>
      ) : (
        <form onSubmit={onCode} className="form" noValidate>
          <p>{t('X-new.signin_code_hint')}</p>
          <label htmlFor="code">{t('X-new.enrol_code_label')}</label>
          <input id="code" name="code" inputMode="numeric" autoComplete="one-time-code" required value={code} onChange={(e) => setCode(e.target.value)} aria-invalid={error ? true : undefined} aria-describedby={error ? 'error' : undefined} />
          {error ? <p id="error" role="alert" className="error" data-testid="error">{t(error)}</p> : null}
          <button type="submit" className="btn" disabled={busy || code.trim() === ''} data-testid="sign-in-submit">{t('X-new.signin_submit')}</button>
        </form>
      )}
    </main>
  );
}
