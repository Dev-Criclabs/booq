import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { translator } from '../client/i18n';
import { Notice } from './Notice';

// D152 page shell; AUTH-02-AC8. The document is data; nothing legal is written in code.

describe('privacy and terms page shell', () => {
  it('with no published version shows a labelled placeholder from the language files', () => {
    for (const lang of ['th', 'en'] as const) {
      const t = translator(lang);
      const html = renderToStaticMarkup(createElement(Notice, { t, nameKey: 'P-0009', doc: null }));
      expect(html).toContain(t('P-0009'));
      expect(html).toContain(t('P-new.notice_unavailable'));
      expect(html).toContain('data-testid="notice-unavailable"');
    }
  });

  it('renders a document passed in as plain text, with its version, and never as HTML', () => {
    const doc = { title: 'Doc title', version: '3', body: 'First para.\n\nSecond <b>para</b>.' };
    const html = renderToStaticMarkup(createElement(Notice, { t: translator('en'), nameKey: 'P-0009', doc }));
    expect(html).toContain('<h1 class="notice-title">Doc title</h1>');
    expect(html).toContain(translator('en')('P-new.notice_version', { version: '3' }));
    expect(html).toContain('<p>First para.</p>');
    expect(html).toContain('Second &lt;b&gt;para&lt;/b&gt;.');
  });
});
