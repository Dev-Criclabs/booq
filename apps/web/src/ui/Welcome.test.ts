import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { translator, type Lang } from '../client/i18n';
import { Welcome, type WelcomeProps } from './Welcome';

// C1 (F02-T19): AUTH-01-AC6, LINE-01-AC2, AC6, CC-5.

const noop = () => {};
function render(lang: Lang, over: Partial<WelcomeProps> = {}) {
  const props: WelcomeProps = {
    t: translator(lang),
    lang,
    onLang: noop,
    clubName: 'Hunter Tennis Club',
    wordmark: 'Hunter Tennis Club',
    slot: { court: '2', date: 'Sat 9 Jan', startTime: '18:00', endTime: '19:00' },
    termsHref: '/c/hunter/terms',
    privacyHref: '/c/hunter/privacy',
    busy: false,
    onLogin: noop,
    onKeepBrowsing: noop,
    ...over,
  };
  return renderToStaticMarkup(createElement(Welcome, props));
}
const unescape = (html: string) => html.replace(/&amp;/g, '&').replace(/&#x27;/g, "'").replace(/&quot;/g, '"');

describe('C1 Welcome', () => {
  it('LINE-01-AC6, D38: no checkbox, only a plain note about booking updates', () => {
    for (const lang of ['en', 'th'] as const) {
      const html = render(lang);
      expect(html).not.toMatch(/type="checkbox"/);
      expect(html).not.toMatch(/<input/);
      expect(unescape(html)).toContain(translator(lang)('P-0003', { clubName: 'Hunter Tennis Club' }));
    }
  });

  it('LINE-01-AC2: one Log in with LINE button and Keep browsing, in both languages', () => {
    for (const lang of ['en', 'th'] as const) {
      const t = translator(lang);
      const html = unescape(render(lang));
      for (const key of ['P-0001', 'P-0004', 'P-0005', 'P-0006', 'P-0007', 'P-0008', 'P-0009']) expect(html).toContain(t(key));
      expect(html.match(/data-testid="line-login"/g)).toHaveLength(1);
    }
  });

  it('CC-5: the slot line fills the named variables', () => {
    expect(unescape(render('en'))).toContain('Court 2 · Sat 9 Jan · 18:00 to 19:00.');
    expect(render('en', { slot: null })).not.toContain('welcome-slot');
  });

  it('the terms and privacy notice links go to the club path', () => {
    const html = render('th');
    expect(html).toContain('href="/c/hunter/terms"');
    expect(html).toContain('href="/c/hunter/privacy"');
  });

  it('CC-5: nothing on the screen is text outside the language files', () => {
    for (const lang of ['en', 'th'] as const) {
      const t = translator(lang);
      const allowed = ['P-0001', 'P-0004', 'P-0005', 'P-0006', 'P-0007', 'P-0008', 'P-0009', 'P-new.lang_th', 'P-new.lang_en'].map((k) => t(k));
      allowed.push(t('P-0002', { court: '2', date: 'Sat 9 Jan', startTime: '18:00', endTime: '19:00' }), t('P-0003', { clubName: 'Hunter Tennis Club' }), 'Hunter', 'Tennis Club', '|');
      const texts = unescape(render(lang)).replace(/<[^>]+>/g, '\n').split('\n').map((s) => s.trim()).filter(Boolean);
      for (const s of texts) expect(allowed).toContain(s);
    }
  });
});
