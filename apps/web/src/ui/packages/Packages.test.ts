import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { hasKey, translator, type Lang } from '../../client/i18n';
import { buyPath, card, loadProducts, productsOf, tabFrom, type PublicProduct, type Tab } from '../../client/packages';
import { Packages } from './Packages';

// F06-T17 C9 Packages: PKG-02-AC7 to AC9, D173, CC-5. Hunter's products are test data here, never values in code.
const LONG_EN = 'Court hours bundle for weekday mornings, weekend evenings and the holiday season with every court';
const LONG_TH = 'แพ็กเกจชั่วโมงคอร์ตสำหรับช่วงเช้าวันธรรมดา ช่วงเย็นวันหยุดสุดสัปดาห์ และช่วงเทศกาลวันหยุดยาวทุกคอร์ต';
const base = { coachTierId: null, priceGroupId: null, priceGroupNameTh: null, priceGroupNameEn: null } as const;
const products: PublicProduct[] = [
  { ...base, productId: 'p-10', nameTh: 'แพ็กเกจ 10 ชั่วโมง', nameEn: '10 hour bundle', creditType: 'court_hour', credits: 10, validityMonths: 3, priceSatang: 450000, pricePerCreditSatang: 45000, savingSatang: 50000 },
  { ...base, productId: 'p-long', nameTh: LONG_TH, nameEn: LONG_EN, creditType: 'court_hour', credits: 20, validityMonths: 5, priceSatang: 800000, pricePerCreditSatang: 40000, savingSatang: null },
  { ...base, productId: 'p-solo', nameTh: 'แพ็ก 8 คลาส', nameEn: '8 class pack', creditType: 'solo_class', credits: 8, validityMonths: 3, priceSatang: 560000, pricePerCreditSatang: 70000, savingSatang: 80000, coachTierId: 'tier', priceGroupId: 'g-a', priceGroupNameTh: 'ผู้ใหญ่', priceGroupNameEn: 'Adult' },
  { ...base, productId: 'p-grp-a', nameTh: 'แพ็กคลาสกลุ่ม 8 ครั้ง', nameEn: 'Group 8 session pack', creditType: 'group_session', credits: 8, validityMonths: 3, priceSatang: 400000, pricePerCreditSatang: 50000, savingSatang: 80000, priceGroupId: 'g-a', priceGroupNameTh: 'ผู้ใหญ่', priceGroupNameEn: 'Adult' },
  { ...base, productId: 'p-grp-s', nameTh: 'แพ็กคลาสกลุ่ม 8 ครั้ง', nameEn: 'Group 8 session pack', creditType: 'group_session', credits: 8, validityMonths: 3, priceSatang: 320000, pricePerCreditSatang: 40000, savingSatang: null, priceGroupId: 'g-s', priceGroupNameTh: 'นักเรียนและเยาวชนอายุต่ำกว่า 18 ปี', priceGroupNameEn: 'Students and juniors under 18' },
];
const render = (lang: Lang, tab: Tab, list: PublicProduct[] = products) =>
  renderToStaticMarkup(createElement(Packages, { t: translator(lang), lang, slug: 'hunter', products: list, tab, onTab: () => {} }));
const text = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');

describe('C9 cards', () => {
  it('a court bundle reads name, hours and validity, price, price an hour and the saving, in both languages', () => {
    expect(card(products[0]!, 'en', translator('en'))).toEqual({
      productId: 'p-10', name: '10 hour bundle', group: null, detail: '10 court hours · valid 3 months', price: '฿4,500', perCredit: '฿450 an hour', saving: 'Save ฿500',
    });
    expect(card(products[0]!, 'th', translator('th'))).toMatchObject({ name: 'แพ็กเกจ 10 ชั่วโมง', detail: 'คอร์ต 10 ชั่วโมง · ใช้ได้ 3 เดือน', perCredit: 'ชั่วโมงละ ฿450', saving: 'ประหยัด ฿500' });
  });
  it('solo and group packs use their own keys; the price group names which pack is whose', () => {
    expect(card(products[2]!, 'en', translator('en'))).toMatchObject({ group: 'Adult', detail: '8 solo classes · valid 3 months', perCredit: '฿700 a class', saving: 'Save ฿800' });
    expect(card(products[3]!, 'en', translator('en'))).toMatchObject({ group: 'Adult', detail: '8 group classes · valid 3 months', perCredit: '฿500 a class' });
    expect(card(products[4]!, 'th', translator('th'))).toMatchObject({ group: 'นักเรียนและเยาวชนอายุต่ำกว่า 18 ปี', detail: 'คลาสกลุ่ม 8 คลาส · ใช้ได้ 3 เดือน' });
  });
  it('D173: no saving from the server, or none above zero, shows no saving', () => {
    expect(card(products[1]!, 'en', translator('en')).saving).toBeNull();
    expect(card({ ...products[0]!, savingSatang: 0 }, 'en', translator('en')).saving).toBeNull();
  });
  it('every key the screen uses exists in both languages, with no variable left unfilled', () => {
    for (const lang of ['en', 'th'] as const) {
      for (const k of ['P-0027', 'P-0183', 'P-0025', 'P-0026', 'P-0187', 'P-0188', 'P-0189', 'P-0190', 'P-0295', 'P-0296', 'P-0297', 'P-0301', 'P-0302', 'P-new.packages_none']) expect(hasKey(lang, k), `${lang} ${k}`).toBe(true);
      for (const tab of ['court', 'solo', 'group'] as const) expect(render(lang, tab)).not.toMatch(/\{[A-Za-z]+\}|P-(new\.|\d{4})/);
    }
  });
});

describe('C9 tabs', () => {
  it('three tabs in board order; each shows only its own credit type', () => {
    const t = translator('en');
    const html = render('en', 'group');
    expect([...html.matchAll(/data-testid="tab-(\w+)"/g)].map((m) => m[1])).toEqual(['court', 'solo', 'group']);
    expect(html).toContain(`aria-selected="true" data-testid="tab-group"`);
    expect(text(html)).toContain(t('P-0026'));
    expect(productsOf(products, 'court').map((p) => p.productId)).toEqual(['p-10', 'p-long']);
    expect([...html.matchAll(/data-testid="product"/g)]).toHaveLength(2);
    expect(html).not.toContain('8 class pack');
  });
  it('PKG-02-AC7: a product with no price is not shown', () => {
    const unpriced = { ...products[0]!, productId: 'p-free', nameEn: 'No price yet', priceSatang: null as unknown as number };
    const html = render('en', 'court', [unpriced, products[1]!]);
    expect(html).not.toContain('No price yet');
    expect([...html.matchAll(/data-testid="product"/g)]).toHaveLength(1);
  });
  it('a tab with nothing on sale says so', () => {
    expect(render('th', 'solo', products.filter((p) => p.creditType !== 'solo_class'))).toContain('data-testid="none"');
  });
  it('Buy opens C10P for that product; ?tab= opens a tab, anything else is Court bundles', () => {
    expect(render('en', 'court')).toContain(`href="${buyPath('hunter', 'p-10')}"`);
    expect(buyPath('hunter', 'p-10')).toBe('/c/hunter/packages/p-10');
    expect([tabFrom('?tab=solo'), tabFrom('?tab=group'), tabFrom('?tab=x'), tabFrom('')]).toEqual(['solo', 'group', 'court', 'court']);
  });
});

describe('C9 longest strings (CC-5)', () => {
  it('the longest Thai and English names and group names render whole, and Buy stays one line of one key', () => {
    for (const lang of ['en', 'th'] as const) {
      const court = text(render(lang, 'court'));
      expect(court).toContain(lang === 'th' ? LONG_TH : LONG_EN);
      const group = text(render(lang, 'group'));
      expect(group).toContain(lang === 'th' ? 'นักเรียนและเยาวชนอายุต่ำกว่า 18 ปี' : 'Students and juniors under 18');
      expect([...render(lang, 'court').matchAll(/<a class="btn btn-primary pk-buy"[^>]*><span>([^<]*)<\/span><\/a>/g)].map((m) => m[1])).toEqual([translator(lang)('P-0190'), translator(lang)('P-0190')]);
    }
  });
});

describe('loadProducts (PKG-02-AC7, AC8)', () => {
  const answer = (status: number, body: unknown) => (async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;
  it('passes the route’s list through: the server offers only active products with a price', async () => {
    expect(await loadProducts('hunter', answer(200, products))).toEqual({ ok: true, value: products });
  });
  it('a missing club is not found; a network error is offline', async () => {
    expect(await loadProducts('hunter', answer(404, { code: 'not_found' }))).toEqual({ ok: false, status: 404, code: 'not_found' });
    expect(await loadProducts('hunter', (async () => { throw new Error('down'); }) as unknown as typeof fetch)).toEqual({ ok: false, status: 0, code: 'offline' });
  });
});
