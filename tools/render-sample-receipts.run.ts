// Sample receipts for review (F13-T06). Renders the real renderer over made-up sample data (not a club's data and not a price list)
// in Thai and English: the original, a Copy, a Test receipt and a Void receipt. Output goes to the gitignored folder .samples/receipts/
// (override with the first argument), as PDFs and, when pdftoppm is installed, as PNGs.
//   pnpm receipts:samples [outDir]
import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createCopy, loadDictionary, renderReceipt, type ClubLegal, type Language, type ReceiptSnapshot } from '../packages/receipts/src';

const root = resolve(__dirname, '..');
const out = resolve(process.argv[2] ?? join(root, '.samples', 'receipts'));
const localesDir = join(root, 'locales');

const club: ClubLegal = { legalName: 'บริษัท ตัวอย่าง คลับ จำกัด', nameTh: 'ตัวอย่าง', taxId: '0000000000000', taxBranch: '00000', registeredAddress: '1 ถนนตัวอย่าง\nกรุงเทพฯ 10000' };
const sample = (over: Partial<ReceiptSnapshot> = {}): ReceiptSnapshot => ({
  number: 'SAM-2026-000001', kind: 'sale', status: 'issued', issuedAt: '2026-12-29T03:00:00Z', vatFlag: false, isTest: false, customerName: 'สมชาย ใจดี', totalSatang: 290000,
  lines: {
    order: { subtotal_satang: 300000, discount_satang: 10000, total_satang: 290000, credit_value_satang: 0, wallet_satang: 40000, money_satang: 250000 },
    items: [
      { position: 1, kind: 'package', description_key: 'sample', name_th: 'ชุด 10 ชั่วโมง', name_en: '10 hour bundle', unit_price_satang: 200000, net_satang: 190000 },
      { position: 2, kind: 'court_hour', description_key: 'sample', name_th: 'คอร์ต 1 ชั่วโมง', name_en: 'Court, 1 hour', unit_price_satang: 100000, net_satang: 100000 },
    ],
    payments: [{ method: 'beam', amount_satang: 250000 }],
  },
  ...over,
});

const variants: Array<{ name: string; receipt: ReceiptSnapshot; copy: boolean; voidReason?: string }> = [
  { name: 'original', receipt: sample(), copy: false },
  { name: 'copy', receipt: sample(), copy: true },
  { name: 'test', receipt: sample({ number: 'TEST-2026-000001', isTest: true }), copy: false },
  { name: 'void', receipt: sample({ status: 'void' }), copy: false, voidReason: 'Entered in error' },
];

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
const dictionaries = { th: loadDictionary('th', localesDir), en: loadDictionary('en', localesDir) };
let pngs = true;
for (const language of ['th', 'en'] as Language[]) {
  const t = createCopy(dictionaries[language]);
  for (const v of variants) {
    const file = join(out, `receipt-${language}-${v.name}`);
    const bytes = await renderReceipt({ receipt: v.receipt, club, language, copy: v.copy, voidReason: v.voidReason ?? null, t });
    writeFileSync(`${file}.pdf`, bytes);
    if (pngs) {
      try {
        execFileSync('pdftoppm', ['-png', '-r', '110', '-singlefile', `${file}.pdf`, file]);
      } catch {
        pngs = false;
      }
    }
    console.log(`${file}.pdf${pngs ? ' + .png' : ''}`);
  }
}
if (!pngs) console.log('pdftoppm not found: PDFs only');
