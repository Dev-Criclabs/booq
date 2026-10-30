import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { translator, type Lang } from '../client/i18n';
import { ProfileSetup, type ProfileSetupProps } from './ProfileSetup';

// C2 (F02-T20): AUTH-02-AC1, AC7, AC8, LINE-01-AC12, CC-5.

const noop = () => {};
function render(lang: Lang, over: Partial<ProfileSetupProps> = {}) {
  const props: ProfileSetupProps = {
    t: translator(lang), lineName: 'ploy.s', fullName: '', phone: '', consent: false, errors: {}, formError: null, continueKey: 'P-0016',
    termsHref: '/c/hunter/terms', privacyHref: '/c/hunter/privacy', busy: false, onChange: noop, onConsent: noop, onSubmit: noop, ...over,
  };
  return renderToStaticMarkup(createElement(ProfileSetup, props));
}

describe('C2 Profile setup', () => {
  it('AUTH-02-AC1: asks only full name, phone and consent', () => {
    const html = render('en');
    const names = [...html.matchAll(/<input[^>]*name="([^"]+)"/g)].map((m) => m[1]);
    expect(names).toEqual(['fullName', 'phone', 'consent']);
    expect(html).not.toMatch(/type="date"|<select/);
  });

  it('AUTH-02-AC7, LINE-01-AC12: greets with the LINE name and does not fill the full name with it', () => {
    const html = render('th');
    expect(html).toContain(translator('th')('P-0010', { lineName: 'ploy.s' }));
    expect(html).toMatch(/name="fullName"[^>]*value=""/);
    expect(render('en', { lineName: null })).not.toContain('Hi,');
  });

  it('AUTH-02-AC8: the consent links to the terms and the privacy notice', () => {
    const html = render('th');
    expect(html).toContain(`href="/c/hunter/terms"`);
    expect(html).toContain(`href="/c/hunter/privacy"`);
    expect(html).toContain(translator('th')('P-0014'));
  });

  it('AUTH-02-AC2: shows what is missing next to the field', () => {
    const html = render('en', { errors: { consent: 'P-new.profile_consent_required', phone: 'P-new.profile_phone_missing' } });
    expect(html).toContain(translator('en')('P-new.profile_consent_required'));
    expect(html).toContain(translator('en')('P-new.profile_phone_missing'));
    expect(html).toMatch(/name="consent"[^>]*aria-invalid="true"|aria-invalid="true"[^>]*name="consent"/);
  });
});
