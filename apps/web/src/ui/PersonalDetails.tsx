'use client';
import type { FormEvent } from 'react';
import type { Lang, T } from '../client/i18n';
import { LEVEL_KEY, LEVELS, type Level, type ProfileErrors } from '../client/profile';
import { DateOfBirthField } from './DateOfBirthField';
import { LanguageToggle } from './LanguageToggle';

// C17 Personal details (G-C17-Personal-details, T-G-C17-Personal-details; AUTH-02-AC18 to AC23,
// AC26, AC29). Name, phone, date of birth, playing level and language, all editable by the player
// (A-11). The date of birth is never locked and never says "ask the front desk" (Gaps A9).

export interface PersonalDetailsForm {
  fullName: string;
  phone: string;
  dateOfBirth: string | null | 'invalid';
  level: Level | null;
}

export interface PersonalDetailsProps {
  t: T;
  lang: Lang;
  onLang(lang: Lang): void;
  form: PersonalDetailsForm;
  errors: ProfileErrors;
  lineName: string | null;
  status: 'idle' | 'saving' | 'saved';
  formError: string | null;
  onChange(change: Partial<PersonalDetailsForm>): void;
  onSave(): void;
  onBack(): void;
}

function Err({ t, id, k }: { t: T; id: string; k: string | undefined }) {
  return k ? (
    <span className="field-error" id={id} role="alert">
      {t(k)}
    </span>
  ) : null;
}

export function PersonalDetails(p: PersonalDetailsProps) {
  const { t, form, errors } = p;
  const submit = (e: FormEvent) => {
    e.preventDefault();
    p.onSave();
  };
  return (
    <main className="app form-screen" data-screen="C17-personal-details">
      <form className="form-screen" onSubmit={submit} noValidate>
        <header className="bar">
          <button type="button" className="icon-btn" aria-label={t('P-0058')} onClick={p.onBack}>
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
              <path d="m15 18-6-6 6-6" />
            </svg>
          </button>
          <h1 className="bar-title">{t('P-0250')}</h1>
          <LanguageToggle t={t} lang={p.lang} onChange={p.onLang} />
        </header>
        <div className="form-body">
          <label className="field">
            <span>{t('P-0012')}</span>
            <input name="fullName" type="text" autoComplete="name" value={form.fullName} aria-invalid={errors.fullName ? true : undefined} aria-describedby={errors.fullName ? 'err-fullName' : undefined} onChange={(e) => p.onChange({ fullName: e.target.value })} />
            <Err t={t} id="err-fullName" k={errors.fullName} />
          </label>
          <label className="field">
            <span>{t('P-0404')}</span>
            <input name="phone" type="tel" inputMode="tel" autoComplete="tel" value={form.phone} aria-invalid={errors.phone ? true : undefined} aria-describedby={errors.phone ? 'err-phone' : undefined} onChange={(e) => p.onChange({ phone: e.target.value })} />
            <Err t={t} id="err-phone" k={errors.phone} />
          </label>
          <DateOfBirthField
            t={t}
            lang={p.lang}
            value={form.dateOfBirth === 'invalid' ? null : form.dateOfBirth}
            onChange={(v) => p.onChange({ dateOfBirth: v })}
            helperKey="P-new.dob_helper"
            errorKey={errors.dateOfBirth}
          />
          <fieldset className="field">
            <legend>{t('P-0408')}</legend>
            <div className="chips" role="radiogroup" aria-label={t('P-0408')}>
              {LEVELS.map((l) => (
                <button key={l} type="button" role="radio" aria-checked={form.level === l} className="chip" onClick={() => p.onChange({ level: form.level === l ? null : l })}>
                  {t(LEVEL_KEY[l])}
                </button>
              ))}
            </div>
            <Err t={t} id="err-level" k={errors.level} />
          </fieldset>
          {p.lineName ? (
            <p className="info-card">
              {t('P-0410')} <b>{t('P-0411', { lineName: p.lineName })}</b>
            </p>
          ) : null}
        </div>
        <div className="form-foot">
          {p.formError ? (
            <p className="form-error" role="alert" data-testid="form-error">
              {t(p.formError)}
            </p>
          ) : null}
          {p.status === 'saved' ? (
            <p className="form-ok" role="status" data-testid="saved">
              {t('P-new.saved')}
            </p>
          ) : null}
          <button type="submit" className="btn btn-primary" data-testid="save" disabled={p.status === 'saving'}>
            <span>{t('P-0412')}</span>
          </button>
        </div>
      </form>
    </main>
  );
}
