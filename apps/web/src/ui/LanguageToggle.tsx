'use client';
import type { Lang, T } from '../client/i18n';

// The one shared language toggle (design 6.7; assumption A-10: "ไทย | EN", labels from the language
// files). The choice applies at once; the caller keeps it (guest cookie, or the player record).
export function LanguageToggle({ t, lang, onChange }: { t: T; lang: Lang; onChange(lang: Lang): void }) {
  return (
    <div className="lang-toggle" role="group" aria-label={t('P-new.language')}>
      <button type="button" lang="th" aria-pressed={lang === 'th'} onClick={() => onChange('th')}>
        {t('P-new.language_toggle_th')}
      </button>
      <span className="sep" aria-hidden="true">|</span>
      <button type="button" lang="en" aria-pressed={lang === 'en'} onClick={() => onChange('en')}>
        {t('P-new.language_toggle_en')}
      </button>
    </div>
  );
}
