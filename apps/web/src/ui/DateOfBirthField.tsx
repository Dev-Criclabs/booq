'use client';
import { useEffect, useState } from 'react';
import { emptyParts, isoOf, monthNames, partsOf, type DobParts } from '../client/dob';
import { formatDayMonthYearLong } from '../client/format';
import type { Lang, T } from '../client/i18n';

// The date of birth field (AUTH-02-AC11, AC15, AC18): day, month and year, always editable, never
// locked, with no "ask the front desk" line (canvas bug, Gaps A9). The year is typed in the
// international calendar and the saved date is read back as 14 March 1994 in both languages.

export interface DateOfBirthFieldProps {
  t: T;
  lang: Lang;
  /** The saved or chosen date, YYYY-MM-DD, or null. */
  value: string | null;
  /** The ISO date, null when cleared, or 'invalid' while partly filled. */
  onChange(value: string | null | 'invalid'): void;
  helperKey?: string;
  errorKey?: string | undefined;
}

export function DateOfBirthField({ t, lang, value, onChange, helperKey, errorKey }: DateOfBirthFieldProps) {
  const [parts, setParts] = useState<DobParts>(() => partsOf(value));
  useEffect(() => {
    // A value from outside (the profile loading) replaces what is shown; typing keeps the parts.
    const current = isoOf(parts);
    if (current !== value && !(current === 'invalid' && value === null)) setParts(value ? partsOf(value) : emptyParts);
  }, [value]);
  const months = monthNames(lang);
  const set = (k: keyof DobParts, v: string) => {
    const next = { ...parts, [k]: v };
    setParts(next);
    onChange(isoOf(next));
  };
  const iso = isoOf(parts);
  const describedBy = [helperKey ? 'dob-help' : '', errorKey ? 'dob-error' : ''].filter(Boolean).join(' ') || undefined;
  return (
    <fieldset className="field dob" aria-describedby={describedBy}>
      <legend>{t('P-0405')}</legend>
      <div className="dob-parts">
        <select aria-label={t('P-new.dob_day')} name="dobDay" value={parts.day} onChange={(e) => set('day', e.target.value)} aria-invalid={errorKey ? true : undefined}>
          <option value="">{t('P-new.dob_day')}</option>
          {Array.from({ length: 31 }, (_, i) => String(i + 1)).map((d) => (
            <option key={d} value={d}>
              {d}
            </option>
          ))}
        </select>
        <select aria-label={t('P-new.dob_month')} name="dobMonth" value={parts.month} onChange={(e) => set('month', e.target.value)} aria-invalid={errorKey ? true : undefined}>
          <option value="">{t('P-new.dob_month')}</option>
          {months.map((m, i) => (
            <option key={m} value={String(i + 1)}>
              {m}
            </option>
          ))}
        </select>
        <input
          aria-label={t('P-new.dob_year')}
          placeholder={t('P-new.dob_year')}
          name="dobYear"
          inputMode="numeric"
          autoComplete="bday-year"
          maxLength={4}
          value={parts.year}
          onChange={(e) => set('year', e.target.value.replace(/\D/g, '').slice(0, 4))}
          aria-invalid={errorKey ? true : undefined}
        />
      </div>
      {typeof iso === 'string' && iso !== 'invalid' ? (
        <span className="dob-readout" data-testid="dob-readout">
          {t('P-0406', { dateOfBirth: formatDayMonthYearLong(lang, iso) })}
        </span>
      ) : null}
      {helperKey ? (
        <span className="field-help" id="dob-help">
          {t(helperKey)}
        </span>
      ) : null}
      {errorKey ? (
        <span className="field-error" id="dob-error" role="alert">
          {t(errorKey)}
        </span>
      ) : null}
    </fieldset>
  );
}
