'use client';
import type { FormEvent } from 'react';
import type { T } from '../client/i18n';
import type { FieldErrors } from '../client/profile-setup';

// C2 Profile setup (H-C02-Profile-setup, T-C02-Profile-setup; AUTH-02-AC1 to AC8). Shown once, at
// the first sign in at this club. Three things only: full name, phone and consent; no date of birth,
// level or email. The full name is not filled from LINE (A-11, LINE-01-AC12). The consent text is
// pending a legal check for players under 18 (D10, AUTH-02-AC9): that is tracked outside the screen.

export interface ProfileSetupProps {
  t: T;
  lineName: string | null;
  fullName: string;
  phone: string;
  consent: boolean;
  errors: FieldErrors;
  /** A key for a refusal that is not about one field (offline, not found). */
  formError: string | null;
  continueKey: string;
  termsHref: string;
  privacyHref: string;
  busy: boolean;
  onChange(field: 'fullName' | 'phone', value: string): void;
  onConsent(value: boolean): void;
  onSubmit(): void;
}

function FieldError({ id, t, k }: { id: string; t: T; k: string | undefined }) {
  return k ? (
    <span className="field-error" id={id} role="alert">
      {t(k)}
    </span>
  ) : null;
}

export function ProfileSetup(p: ProfileSetupProps) {
  const { t, errors } = p;
  const submit = (e: FormEvent) => {
    e.preventDefault();
    p.onSubmit();
  };
  return (
    <main className="app form-screen" data-screen="C2">
      <form className="form-screen" onSubmit={submit} noValidate>
        <header className="form-head">
          <span className="avatar" aria-hidden="true" />
          <div>
            {p.lineName ? <h1 className="form-title">{t('P-0010', { lineName: p.lineName })}</h1> : null}
            <p className={p.lineName ? 'form-sub' : 'form-title'}>{t('P-0011')}</p>
          </div>
        </header>
        <div className="form-body">
          <label className="field">
            <span>{t('P-0012')}</span>
            <input
              name="fullName"
              type="text"
              autoComplete="name"
              value={p.fullName}
              aria-invalid={errors.fullName ? true : undefined}
              aria-describedby={errors.fullName ? 'err-fullName' : undefined}
              onChange={(e) => p.onChange('fullName', e.target.value)}
            />
            <FieldError id="err-fullName" t={t} k={errors.fullName} />
          </label>
          <label className="field">
            <span>{t('P-0013')}</span>
            <input
              name="phone"
              type="tel"
              inputMode="tel"
              autoComplete="tel"
              value={p.phone}
              aria-invalid={errors.phone ? true : undefined}
              aria-describedby={errors.phone ? 'err-phone' : undefined}
              onChange={(e) => p.onChange('phone', e.target.value)}
            />
            <FieldError id="err-phone" t={t} k={errors.phone} />
          </label>
          <div className="consent">
            <label className="consent-line">
              <input
                name="consent"
                type="checkbox"
                checked={p.consent}
                aria-invalid={errors.consent ? true : undefined}
                aria-describedby={errors.consent ? 'err-consent' : undefined}
                onChange={(e) => p.onConsent(e.target.checked)}
              />
              <span>{t('P-0014')}</span>
            </label>
            <p className="consent-links">
              <a href={p.termsHref} target="_blank" rel="noopener">
                {t('P-0007')}
              </a>
              <span aria-hidden="true">·</span>
              <a href={p.privacyHref} target="_blank" rel="noopener">
                {t('P-0009')}
              </a>
            </p>
            <FieldError id="err-consent" t={t} k={errors.consent} />
          </div>
          <p className="info-card">{t('P-0015')}</p>
        </div>
        <div className="form-foot">
          {p.formError ? (
            <p className="form-error" role="alert" data-testid="form-error">
              {t(p.formError)}
            </p>
          ) : null}
          <button type="submit" className="btn btn-primary" data-testid="continue" disabled={p.busy}>
            <span>{t(p.continueKey)}</span>
          </button>
        </div>
      </form>
    </main>
  );
}
