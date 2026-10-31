import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { CREDIT_REASONS, WALLET_REASONS, amountText, bangkokParts, emptyStream, extend, mergedHistory, reasonKey, type LedgerEntry, type OwnCredits } from '../../client/credits';
import { hasKey, translator, type Lang } from '../../client/i18n';
import { Credits } from './Credits';

// F06-T18 C14 Credits and wallet: PKG-01-AC10, PKG-03-AC3, CC-5. Amounts and names are test data, never values in code.
const LONG_TH = 'แพ็กเกจชั่วโมงคอร์ตสำหรับช่วงเช้าวันธรรมดา ช่วงเย็นวันหยุดสุดสัปดาห์ และช่วงเทศกาลวันหยุดยาวทุกคอร์ต';
const LONG_EN = 'Court hours bundle for weekday mornings, weekend evenings and the holiday season with every court';
const credits: OwnCredits = {
  walletSatang: 50000,
  packages: [
    { packageId: 'k1', nameTh: 'แพ็กเกจ 10 ชั่วโมง', nameEn: '10 hour bundle', creditType: 'court_hour', creditsLeft: 7, creditsTotal: 10, expiresAt: '2027-04-05T16:59:59.999Z', status: 'active' },
    { packageId: 'k2', nameTh: LONG_TH, nameEn: LONG_EN, creditType: 'group_session', creditsLeft: 7, creditsTotal: 8, expiresAt: '2027-04-05T16:59:59.999Z', status: 'active' },
    { packageId: 'k3', nameTh: 'เก่า', nameEn: 'Old bundle', creditType: 'court_hour', creditsLeft: 0, creditsTotal: 10, expiresAt: '2026-12-01T16:59:59.999Z', status: 'expired' },
  ],
};
const e = (id: string, at: string, reason: string, change: number, packageId: string | null = null): LedgerEntry => ({ id, at, reason, change, packageId, bookingId: null, orderId: null });
const history = [
  { kind: 'wallet' as const, entry: e('w1', '2027-01-08T02:14:00Z', 'refund', 50000) },
  { kind: 'credit' as const, entry: e('c2', '2027-01-07T13:02:00Z', 'use', -1, 'k1') },
  { kind: 'credit' as const, entry: e('c1', '2027-01-05T11:40:00Z', 'expire', -10, 'k3') },
];
const render = (lang: Lang, over: Partial<{ credits: OwnCredits; history: typeof history; more: boolean }> = {}) =>
  renderToStaticMarkup(createElement(Credits, { t: translator(lang), lang, slug: 'hunter', credits, history, more: false, loadingMore: false, onMore: () => {}, backHref: '/c/hunter/profile', ...over }));
const text = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');

describe('C14 reason labels (design 12)', () => {
  it('every credit and wallet reason has its own label in both languages', () => {
    for (const lang of ['en', 'th'] as const) {
      for (const r of CREDIT_REASONS) expect(hasKey(lang, reasonKey('credit', r)), `${lang} credit ${r}`).toBe(true);
      for (const r of WALLET_REASONS) expect(hasKey(lang, reasonKey('wallet', r)), `${lang} wallet ${r}`).toBe(true);
    }
  });
  it('a row shows its reason’s label, the package, the Bangkok date and time and the signed amount', () => {
    const html = text(render('en'));
    expect(html).toContain('Refund to your wallet 8 Jan 2027 · 09:14 +฿500 wallet');
    expect(html).toContain('Used for a booking 10 hour bundle 7 Jan 2027 · 20:02 −1 court hour');
    expect(html).toContain('Package expired Old bundle 5 Jan 2027 · 18:40 −10 court hours');
  });
});

describe('C14 balance and packages (PKG-01-AC10)', () => {
  it('the wallet balance shown is the route’s, with the not-as-cash line', () => {
    for (const lang of ['en', 'th'] as const) {
      const t = translator(lang);
      const html = render(lang);
      expect(html).toContain('data-testid="wallet-balance">฿500<');
      expect(text(html)).toContain(t('P-0224'));
      expect(text(render(lang, { credits: { ...credits, walletSatang: 123456 } }))).toContain('฿1,234.56');
    }
  });
  it('active packages show credits left of total and the expiry with the international year; expired ones only in history', () => {
    const en = text(render('en'));
    expect(en).toContain('7 of 10 hours');
    expect(en).toContain('7 of 8 sessions');
    expect(en).toContain('Expires 5 Apr 2027');
    expect([...render('en').matchAll(/data-testid="package"/g)]).toHaveLength(2);
    expect(text(render('th'))).toContain('หมดอายุ 5 เม.ย. 2027');
    expect(text(render('th'))).not.toContain('2570');
  });
  it('empty: no packages and no movements each say so', () => {
    const html = render('th', { credits: { walletSatang: 0, packages: [] }, history: [] });
    expect(html).toContain('data-testid="no-packages"');
    expect(html).toContain('data-testid="no-history"');
  });
});

describe('amounts', () => {
  const t = translator('en');
  it('singular and plural are separate keys; wallet in and out', () => {
    expect([amountText('credit', 1, 'court_hour', 'en', t), amountText('credit', 10, 'court_hour', 'en', t), amountText('credit', -1, 'court_hour', 'en', t), amountText('credit', -3, 'court_hour', 'en', t)])
      .toEqual(['+1 court hour', '+10 court hours', '−1 court hour', '−3 court hours']);
    expect([amountText('credit', 1, 'solo_class', 'en', t), amountText('credit', 8, 'group_session', 'en', t), amountText('credit', -1, 'group_session', 'en', t), amountText('credit', -2, 'solo_class', 'en', t)])
      .toEqual(['+1 class', '+8 classes', '−1 class', '−2 classes']);
    expect([amountText('wallet', 50000, null, 'en', t), amountText('wallet', -20000, null, 'en', t)]).toEqual(['+฿500 wallet', '−฿200 wallet']);
  });
  it('Bangkok date and time from the instant', () => {
    expect(bangkokParts('en', '2027-01-08T17:30:00Z')).toEqual({ dayMonthYear: '9 Jan 2027', time: '00:30' });
  });
});

describe('history of both ledgers', () => {
  const page = (entries: LedgerEntry[], nextCursor: string | null) => ({ entries, nextCursor });
  it('merges newest first and stops at the oldest loaded row of a ledger with more to load', () => {
    const credit = extend(emptyStream(), page([e('c3', '2027-01-09T00:00:00Z', 'use', -1), e('c2', '2027-01-05T00:00:00Z', 'use', -1)], 'next'));
    const wallet = extend(emptyStream(), page([e('w2', '2027-01-08T00:00:00Z', 'refund', 1), e('w1', '2027-01-01T00:00:00Z', 'refund', 1)], null));
    const m = mergedHistory(credit, wallet);
    expect(m.rows.map((r) => r.entry.id)).toEqual(['c3', 'w2', 'c2']);
    expect(m.more).toBe(true);
    const all = mergedHistory(extend(credit, page([e('c1', '2026-12-31T00:00:00Z', 'use', -1)], null)), wallet);
    expect(all.rows.map((r) => r.entry.id)).toEqual(['c3', 'w2', 'c2', 'w1', 'c1']);
    expect(all.more).toBe(false);
  });
  it('See full history shows while either ledger has more', () => {
    expect(render('en', { more: true })).toContain('data-testid="more"');
    expect(render('en')).not.toContain('data-testid="more"');
  });
});

describe('C14 longest strings (CC-5)', () => {
  it('the longest package names render whole in both languages with every key filled', () => {
    for (const lang of ['en', 'th'] as const) {
      const html = render(lang);
      expect(text(html)).toContain(lang === 'th' ? LONG_TH : LONG_EN);
      expect(html).not.toMatch(/\{[A-Za-z]+\}|P-(new\.|\d{4})/);
    }
  });
});
