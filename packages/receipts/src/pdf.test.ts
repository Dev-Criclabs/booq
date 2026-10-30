import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createCopy } from './copy';
import { loadDictionary } from './locales';
import type { ClubLegal, ReceiptSnapshot } from './model';
import { renderReceipt } from './pdf';

// F13-T06: the A4 PDF (RCPT-01-AC11, AC12; RCPT-02). The words are tested in model.test.ts; here the file itself.
const LOCALES = join(__dirname, '..', '..', '..', 'locales');
const t = { th: createCopy(loadDictionary('th', LOCALES)), en: createCopy(loadDictionary('en', LOCALES)) };
const CLUB: ClubLegal = { legalName: 'บริษัท ฮันเตอร์ เทนนิส คลับ จำกัด', nameTh: 'ฮันเตอร์', taxId: '0135569018041', taxBranch: '00000', registeredAddress: '99 ถนนสุขุมวิท\nกรุงเทพฯ 10110' };
const base = (name_th: string, name_en: string, n = 2): ReceiptSnapshot => ({
  number: 'HTC-2026-000001', kind: 'sale', status: 'issued', issuedAt: '2026-12-29T03:00:00Z', vatFlag: false, isTest: false, customerName: 'สมชาย ใจดี', totalSatang: 100000 * n,
  lines: {
    order: { subtotal_satang: 100000 * n, discount_satang: 0, total_satang: 100000 * n, credit_value_satang: 0, wallet_satang: 0, money_satang: 100000 * n },
    items: Array.from({ length: n }, (_, i) => ({ position: i + 1, kind: 'package', description_key: 'k', name_th, name_en, unit_price_satang: 100000, net_satang: 100000 })),
    payments: [{ method: 'beam', amount_satang: 100000 * n }],
  },
});
const render = (language: 'th' | 'en', receipt: ReceiptSnapshot, copy = false) => renderReceipt({ receipt, club: CLUB, language, copy, t: t[language] });
const text = (b: Uint8Array) => Buffer.from(b).toString('latin1');
const pages = (b: Uint8Array) => (text(b).match(/\/Type \/Page\n/g) ?? []).length;

describe('renderReceipt', () => {
  it('draws one A4 page with the Sarabun font embedded, in either language', async () => {
    for (const language of ['th', 'en'] as const) {
      const pdf = await render(language, base('ชุด 10 ชั่วโมง', '10 hour bundle'));
      expect(text(pdf).startsWith('%PDF-')).toBe(true);
      expect(pages(pdf)).toBe(1);
      expect(text(pdf)).toMatch(/\/MediaBox \[0 0 595\.28 841\.89\]/);
      expect(text(pdf)).toContain('Sarabun');
    }
  });

  it('the same snapshot draws the same file, byte for byte (a lost file is a regenerated file)', async () => {
    const a = await render('th', base('ชุด', 'Bundle'));
    const b = await render('th', base('ชุด', 'Bundle'));
    expect(Buffer.from(a).equals(Buffer.from(b))).toBe(true);
    expect(Buffer.from(a).equals(Buffer.from(await render('en', base('ชุด', 'Bundle'))))).toBe(false);
  });

  it('a reprint is a different file only by its Copy mark: same number, same date', async () => {
    const o = await render('en', base('ชุด', 'Bundle'));
    const c = await render('en', base('ชุด', 'Bundle'), true);
    expect(Buffer.from(o).equals(Buffer.from(c))).toBe(false);
    expect(pages(c)).toBe(pages(o));
  });

  it('the longest Thai and English names wrap inside their column and the receipt still fits; many lines go to a second page, not off the page', async () => {
    const th = 'ชุด 10 ชั่วโมง โปรช่วงเปิดตัว ราคาพิเศษสำหรับสมาชิกใหม่เท่านั้น ใช้ได้ทุกคอร์ตทุกวันตลอดสามเดือน ไม่รวมค่าโค้ช และไม่สามารถใช้ร่วมกับโปรโมชันอื่นได้'.repeat(2);
    const en = '10 hour bundle · soft opening special for new members only on every court every day for three months, coaching not included'.repeat(2);
    expect(pages(await render('th', base(th, en, 2)))).toBe(1);
    expect(pages(await render('th', base(th, en, 40)))).toBeGreaterThan(1);
  });

  it('the file carries the issue time as its date, not the time it was drawn', async () => {
    const pdf = text(await render('en', base('ชุด', 'Bundle')));
    expect(pdf).toContain('D:20261229030000Z');
  });
});
