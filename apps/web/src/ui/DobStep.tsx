'use client';
import type { FormEvent } from 'react';
import type { Lang, T } from '../client/i18n';
import { DateOfBirthField } from './DateOfBirthField';

// The date of birth step for a Student item (AUTH-02-AC11, AC12; design 6.6). It shows only when
// the checkout answers dob_required for an item sold at a Student price; an Adult item never asks
// (AC10). A date that makes the player 18 or older is told the item is for under 18.

export interface DobStepProps {
  t: T;
  lang: Lang;
  value: string | null | 'invalid';
  errorKey: string | undefined;
  tooOld: boolean;
  busy: boolean;
  onChange(value: string | null | 'invalid'): void;
  onContinue(): void;
  onBack(): void;
}

export function DobStep(p: DobStepProps) {
  const { t } = p;
  const submit = (e: FormEvent) => {
    e.preventDefault();
    p.onContinue();
  };
  return (
    <main className="app form-screen" data-screen="dob-step">
      <form className="form-screen" onSubmit={submit} noValidate>
        <header className="bar">
          <button type="button" className="icon-btn" aria-label={t('P-0058')} onClick={p.onBack}>
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
              <path d="m15 18-6-6 6-6" />
            </svg>
          </button>
          <h1 className="bar-title">{t('P-0405')}</h1>
        </header>
        <div className="form-body">
          <p className="lead-text">{t('P-new.dob_step_lead')}</p>
          <DateOfBirthField t={t} lang={p.lang} value={p.value === 'invalid' ? null : p.value} onChange={p.onChange} errorKey={p.errorKey} />
          {p.tooOld ? (
            <p className="form-error" role="alert" data-testid="too-old">
              {t('P-new.student_too_old')}
            </p>
          ) : null}
        </div>
        <div className="form-foot">
          {p.tooOld ? (
            <button type="button" className="btn btn-primary" data-testid="back" onClick={p.onBack}>
              <span>{t('P-0058')}</span>
            </button>
          ) : (
            <button type="submit" className="btn btn-primary" data-testid="continue" disabled={p.busy}>
              <span>{t('P-0057')}</span>
            </button>
          )}
        </div>
      </form>
    </main>
  );
}
