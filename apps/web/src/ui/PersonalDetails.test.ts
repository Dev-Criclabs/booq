import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import en from '../../../../locales/en.json';
import th from '../../../../locales/th.json';
import { translator, type Lang } from '../client/i18n';
import { DobStep } from './DobStep';
import { PersonalDetails, type PersonalDetailsProps } from './PersonalDetails';

// F02-T21: AUTH-02-AC15, AC18, AC22, AC23; Gaps A9 (no locked date of birth, no "ask the front desk").

const noop = () => {};
function details(lang: Lang, over: Partial<PersonalDetailsProps> = {}) {
  const props: PersonalDetailsProps = {
    t: translator(lang), lang, onLang: noop, form: { fullName: 'Ploy Srisuk', phone: '081 234 5678', dateOfBirth: '1994-03-14', level: 'beginner' },
    errors: {}, lineName: 'ploy.s', status: 'idle', formError: null, onChange: noop, onSave: noop, onBack: noop, ...over,
  };
  return renderToStaticMarkup(createElement(PersonalDetails, props));
}

describe('C17 Personal details', () => {
  it('AUTH-02-AC18, Gaps A9: the date of birth is an editable field and never says ask the front desk', () => {
    for (const lang of ['en', 'th'] as const) {
      const html = details(lang);
      expect(html).not.toContain((lang === 'en' ? en : th)['P-0407']);
      expect(html).not.toMatch(/front desk|เคาน์เตอร์/);
      for (const name of ['dobDay', 'dobMonth', 'dobYear']) {
        expect(html).toMatch(new RegExp(`name="${name}"`));
        expect(html).not.toMatch(new RegExp(`name="${name}"[^>]*(disabled|readonly)`));
      }
    }
  });

  it('AUTH-02-AC15: the date reads with the international year in both languages', () => {
    expect(details('en')).toContain('14 March 1994');
    expect(details('th')).toContain('14 มีนาคม 1994');
    expect(details('th')).not.toContain('2537');
  });

  it('AUTH-02-AC22, AC23: name, phone, date of birth, level (optional) and language are all editable', () => {
    const html = details('en');
    for (const name of ["fullName", "phone"]) expect(html).toMatch(new RegExp(`<input[^>]*name="${name}"`));
    expect(html.match(/role="radio"/g)).toHaveLength(4);
    expect(html).toMatch(/aria-checked="true"[^>]*>Beginner</);
    expect(html).toContain('role="group"'); // the language toggle
    expect(details('en', { form: { fullName: '', phone: '', dateOfBirth: null, level: null } })).not.toContain('aria-checked="true"');
  });
});

describe('the date of birth step', () => {
  it('AUTH-02-AC11: asks for the date with the lead line; AC12: too old shows the under 18 line and no Continue', () => {
    const t = translator('en');
    const base = { t, lang: 'en' as const, value: null, errorKey: undefined, busy: false, onChange: noop, onContinue: noop, onBack: noop };
    const ask = renderToStaticMarkup(createElement(DobStep, { ...base, tooOld: false }));
    expect(ask).toContain(t('P-new.dob_step_lead'));
    expect(ask).toContain('data-testid="continue"');
    const old = renderToStaticMarkup(createElement(DobStep, { ...base, value: '1990-01-01', tooOld: true }));
    expect(old).toContain(t('P-new.student_too_old'));
    expect(old).not.toContain('data-testid="continue"');
  });
});
