import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createCopy, variablesOf } from './copy';
import { loadDictionary } from './locales';
import { buildReceiptDocument, type ClubLegal, type ReceiptSnapshot } from './model';

// F13-T06 (RCPT-01-AC11, AC12, AC15; RCPT-02; TEXT-01): what a receipt says, from the stored snapshot, by key.
const LOCALES = join(__dirname, '..', '..', '..', 'locales');
const dict = { th: loadDictionary('th', LOCALES), en: loadDictionary('en', LOCALES) };
const copy = { th: createCopy(dict.th), en: createCopy(dict.en) };

const CLUB: ClubLegal = { legalName: 'บริษัท ฮันเตอร์ เทนนิส คลับ จำกัด', nameTh: 'ฮันเตอร์', taxId: '0135569018041', taxBranch: '00000', registeredAddress: '99 ถนนสุขุมวิท\nกรุงเทพฯ 10110' };
const SALE: ReceiptSnapshot = {
  number: 'HTC-2026-000001', kind: 'sale', status: 'issued', issuedAt: '2026-12-29T03:00:00Z', vatFlag: false, isTest: false, customerName: 'Somchai Jaidee', totalSatang: 450000,
  lines: {
    order: { subtotal_satang: 450000, discount_satang: 50000, total_satang: 400000, credit_value_satang: 100000, wallet_satang: 50000, money_satang: 250000 },
    items: [
      { position: 2, kind: 'add_on', description_key: 'k', name_th: 'ลูกเทนนิส', name_en: 'Balls', unit_price_satang: 50000, net_satang: 50000 },
      { position: 1, kind: 'package', description_key: 'k', name_th: 'ชุด 10 ชั่วโมง', name_en: '10 hour bundle', unit_price_satang: 400000, net_satang: 350000 },
    ],
    payments: [{ method: 'beam', amount_satang: 250000 }],
  },
};
const build = (language: 'th' | 'en', over: Partial<Parameters<typeof buildReceiptDocument>[0]> = {}, receipt: ReceiptSnapshot = SALE) =>
  buildReceiptDocument({ receipt, club: CLUB, language, copy: false, t: copy[language], ...over });

describe('the same snapshot in both languages (RCPT-02)', () => {
  it('gives the same numbers, rows and order; only the words differ', () => {
    const th = build('th');
    const en = build('en');
    const shape = (d: typeof th) => ({
      numbers: d.table.rows.map((r) => r.slice(1)),
      summary: d.summary.map((s) => [s.value, s.strong]),
      paid: d.paidBy?.rows.map((r) => r.value),
      marks: d.marks.map((m) => m.kind),
      meta0: d.meta[0]!.value,
      lines: d.table.rows.length,
    });
    expect(shape(th)).toEqual(shape(en));
    expect(th.title).not.toBe(en.title);
    expect(th.table.rows[0]![0]).toBe('ชุด 10 ชั่วโมง');
    expect(en.table.rows[0]![0]).toBe('10 hour bundle');
  });

  it('lists the lines in order with unit price and amount, then subtotal, discount, credit, wallet and money paid', () => {
    const d = build('en');
    expect(d.table.rows).toEqual([['10 hour bundle', '1', '4,000.00', '3,500.00'], ['Balls', '1', '500.00', '500.00']]);
    expect(d.summary.map((s) => [s.label, s.value])).toEqual([['Subtotal', '4,500.00'], ['Discount', '-500.00'], ['Credit used', '-1,000.00'], ['Wallet used', '-500.00'], ['Total paid', '2,500.00']]);
    expect(d.paidBy).toEqual({ label: 'Paid by', rows: [{ label: 'PromptPay', value: '2,500.00' }] });
  });

  it('dates use the international year in both languages, never the Buddhist year', () => {
    for (const lang of ['th', 'en'] as const) {
      const text = JSON.stringify(build(lang));
      expect(text).toContain('2026');
      expect(text).not.toContain('2569');
    }
    expect(build('en').meta[1]!.value).toBe('29 Dec 2026');
    expect(build('th').meta[1]!.value).toMatch(/^29 .+ 2026$/);
  });

  it('the Bangkok day is the date: 17:00 UTC on 31 December is 1 January', () => {
    expect(build('en', {}, { ...SALE, issuedAt: '2026-12-31T17:00:00Z' }).meta[1]!.value).toBe('1 Jan 2027');
  });
});

describe('the club record and the customer (RCPT-02)', () => {
  it('the legal name, tax id, branch and address come from the club record, the name as Thai in both languages', () => {
    for (const lang of ['th', 'en'] as const) {
      const d = build(lang);
      expect(d.club.legalName).toBe('บริษัท ฮันเตอร์ เทนนิส คลับ จำกัด');
      expect(d.club.addressLines).toEqual(['99 ถนนสุขุมวิท', 'กรุงเทพฯ 10110']);
      expect(d.club.taxLine).toContain('0135569018041');
      expect(d.club.taxLine).toContain('00000');
    }
  });
  it('without a legal name it falls back to the Thai club name; without tax details there is no tax line', () => {
    const d = build('en', { club: { ...CLUB, legalName: null, taxId: null, taxBranch: null, registeredAddress: null } });
    expect(d.club).toEqual({ legalName: 'ฮันเตอร์', taxLine: null, addressLines: [] });
  });
  it('the customer name is the one in the snapshot; no name, no customer block', () => {
    expect(build('en').customer).toEqual({ label: 'CUSTOMER', value: 'Somchai Jaidee' });
    expect(build('en', {}, { ...SALE, customerName: null }).customer).toBeNull();
  });
});

describe('marks (RCPT-01-AC11, AC15; AC9)', () => {
  it('an original says Original; a reprint says Copy and keeps the original number and date', () => {
    const o = build('en');
    const c = build('en', { copy: true });
    expect(o.marks.map((m) => m.kind)).toEqual(['original']);
    expect(c.marks.map((m) => m.kind)).toEqual(['copy']);
    expect(c.meta).toEqual(o.meta);
    expect(c.table).toEqual(o.table);
    expect(c.summary).toEqual(o.summary);
  });
  it('a test receipt is marked as a test, in both languages', () => {
    for (const lang of ['th', 'en'] as const) expect(build(lang, {}, { ...SALE, isTest: true }).marks.map((m) => m.kind)).toEqual(['original', 'test']);
    expect(build('en').marks.some((m) => m.kind === 'test')).toBe(false);
  });
  it('a voided receipt shows Void with the reason and keeps its number and amounts', () => {
    const d = build('en', { voidReason: ' wrong item ' }, { ...SALE, status: 'void' });
    expect(d.marks.find((m) => m.kind === 'void')!.text).toBe('VOID · wrong item');
    expect(d.meta[0]!.value).toBe('HTC-2026-000001');
    expect(d.summary.at(-1)!.value).toBe('2,500.00');
  });
});

describe('what the receipt does not claim', () => {
  it('a non VAT club says it is not a tax invoice; a VAT club says nothing about VAT until the layout is supplied (Q4)', () => {
    expect(build('en').notes).toEqual([dict.en['L-0060'], dict.en['L-0061']]);
    expect(build('en', {}, { ...SALE, vatFlag: true }).notes).toEqual([dict.en['L-0061']]);
  });
  it('an order paid with no money shows how it was paid by credit and wallet and a zero total, with no paid by line (D64)', () => {
    const zero: ReceiptSnapshot = { ...SALE, lines: { ...SALE.lines, order: { subtotal_satang: 450000, discount_satang: 0, total_satang: 450000, credit_value_satang: 400000, wallet_satang: 50000, money_satang: 0 }, payments: [] } };
    const d = build('en', {}, zero);
    expect(d.paidBy).toBeNull();
    expect(d.summary.map((s) => s.value)).toEqual(['4,500.00', '-4,000.00', '-500.00', '0.00']);
  });
  it('cash is labelled cash', () => {
    const cash: ReceiptSnapshot = { ...SALE, lines: { ...SALE.lines, payments: [{ method: 'cash', amount_satang: 250000 }] } };
    expect(build('en', {}, cash).paidBy!.rows).toEqual([{ label: 'Cash', value: '2,500.00' }]);
    expect(build('th', {}, cash).paidBy!.rows[0]!.label).toBe('เงินสด');
  });
});

describe('a wallet credit receipt (RCPT-02-AC11)', () => {
  const credit: ReceiptSnapshot = {
    ...SALE, kind: 'wallet_credit', totalSatang: 50000,
    lines: {
      order: { subtotal_satang: 50000, discount_satang: 0, total_satang: 50000, credit_value_satang: 0, wallet_satang: 0, money_satang: 50000 },
      items: [{ position: 1, kind: 'wallet_credit', description_key: 'L-new.wallet_credit_line', name_th: 'L-new.wallet_credit_line', name_en: 'L-new.wallet_credit_line', unit_price_satang: 50000, net_satang: 50000 }],
      payments: [{ method: 'beam', amount_satang: 50000 }],
    },
  };
  it('states what it is for in words from the language file, never from the name columns', () => {
    const en = build('en', {}, credit);
    expect(en.statement).toBe('Money received and credited to the wallet');
    expect(en.table.rows[0]![0]).toBe('Credit to your wallet');
    expect(build('th', {}, credit).table.rows[0]![0]).toBe('เครดิตเข้ากระเป๋าเงิน');
    expect(en.summary.map((s) => s.label)).toEqual(['Total paid']);
    expect(en.summary[0]!.value).toBe('500.00');
  });
});

describe('no text in the template (TEXT-01)', () => {
  it('every key the template uses is in both language files with the same variables', () => {
    const used = new Set<string>();
    const spy = (lang: 'th' | 'en') => ((key: string, vars?: Record<string, string | number>) => (used.add(key), copy[lang](key, vars)));
    for (const lang of ['th', 'en'] as const) {
      build(lang, { t: spy(lang), copy: true, voidReason: 'x' }, { ...SALE, isTest: true, status: 'void' });
      build(lang, { t: spy(lang) }, { ...SALE, vatFlag: true, lines: { ...SALE.lines, payments: [{ method: 'cash', amount_satang: 1 }] } });
    }
    expect(used.size).toBeGreaterThan(15);
    for (const k of used) {
      expect(dict.en[k], `en ${k}`).toBeDefined();
      expect(dict.th[k], `th ${k}`).toBeDefined();
      expect(variablesOf(dict.th[k]!), k).toEqual(variablesOf(dict.en[k]!));
    }
  });
  it('a missing key or a missing variable stops the receipt instead of printing a hole', () => {
    expect(() => copy.en('L-9999')).toThrow(/not in the language file/);
    expect(() => copy.en('L-0048')).toThrow(/needs variables/);
    expect(() => copy.en('L-0017', { extra: 1 })).toThrow(/needs variables/);
  });
});
