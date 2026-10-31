import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { translator, type Lang } from '../client/i18n';
import { Home, type HomeProps } from './Home';

// C3 Home (S-C03-Guest; AUTH-01-AC8; LINE-01-AC9; D6).
const noop = () => {};
function home(lang: Lang, over: Partial<HomeProps> = {}) {
  const props: HomeProps = {
    t: translator(lang), lang, onLang: noop, slug: 'hunter', wordmark: 'Hunter Tennis Club', clubName: 'Hunter Tennis Club',
    dateLong: 'Saturday 9 January', greetingKey: 'P-0448', signedIn: false, signInHref: '/c/hunter/sign-in?next=%2Fc%2Fhunter', friendAsk: null, ...over,
  };
  return renderToStaticMarkup(createElement(Home, props));
}

describe('Home', () => {
  it('AUTH-01-AC8: a guest sees Find a court time and Sign in, with no booking card and no credits', () => {
    for (const lang of ['en', 'th'] as const) {
      const t = translator(lang);
      const html = home(lang);
      expect(html).toContain(t('P-0452'));
      expect(html).toContain(t('P-0447'));
      expect(html).toContain('href="/c/hunter/sign-in?next=%2Fc%2Fhunter"');
      expect(html).not.toContain(t('P-0019')); // Next booking
      expect(html).not.toContain(t('P-0028')); // credits strip
    }
  });
  it('D6: every link carries the club', () => {
    const hrefs = [...home('en').matchAll(/href="([^"]+)"/g)].map((m) => m[1]!);
    expect(hrefs.length).toBeGreaterThan(8);
    for (const h of hrefs) expect(h.startsWith('/c/hunter')).toBe(true);
    expect(hrefs).toContain('/c/hunter/book');
  });
  it('a signed in player has no guest card and no Sign in; a non-friend sees the ask (LINE-01-AC9)', () => {
    const t = translator('en');
    const html = home('en', { signedIn: true, friendAsk: { url: null, onDismiss: noop } });
    expect(html).not.toContain('data-testid="guest-card"');
    expect(html).not.toContain('data-testid="sign-in"');
    expect(html).toContain(t('P-0003', { clubName: 'Hunter Tennis Club' }));
    expect(html).not.toContain(t('P-new.add_friend_button')); // no basic id: the note alone
    expect(home('en', { signedIn: true, friendAsk: { url: 'https://line.me/R/ti/p/%40hunter', onDismiss: noop } })).toContain('href="https://line.me/R/ti/p/%40hunter"');
  });
});
