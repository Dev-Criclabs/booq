import type { Language, Translate } from './copy';
import { baht, dayMonthYear } from './format';

// The content of a receipt, decided once from the stored snapshot (F13 design 4.4, 4.5; RCPT-01-AC11, AC12; RCPT-02).
// Nothing here is drawn: this is the list of what the page says and in what order, with every word taken from the language
// file by key. The same snapshot gives the same numbers, rows and order in Thai and English; only the words differ. A reprint
// is the same document with the Copy mark: the number and date are the original's, and nothing is written anywhere.

export interface ReceiptItem {
  position: number;
  kind: string;
  description_key: string;
  name_th: string;
  name_en: string;
  unit_price_satang: number;
  net_satang: number;
}
export interface ReceiptSnapshot {
  number: string;
  kind: 'sale' | 'wallet_credit';
  status: 'issued' | 'void';
  issuedAt: Date | string;
  vatFlag: boolean;
  isTest: boolean;
  customerName: string | null;
  totalSatang: number;
  lines: {
    order: { subtotal_satang: number; discount_satang: number; total_satang: number; credit_value_satang: number; wallet_satang: number; money_satang: number };
    items: ReceiptItem[];
    payments: Array<{ method: string; amount_satang: number }>;
  };
}
/** From the club record (setup data, not keys): the legal name stays Thai on both languages. */
export interface ClubLegal {
  legalName: string | null;
  nameTh: string;
  taxId: string | null;
  taxBranch: string | null;
  registeredAddress: string | null;
}
export interface RenderInput {
  receipt: ReceiptSnapshot;
  club: ClubLegal;
  language: Language;
  /** A reprint: marked as a copy, same number and date. */
  copy: boolean;
  /** The written reason, for a voided receipt. */
  voidReason?: string | null;
  t: Translate;
}

export type MarkKind = 'original' | 'copy' | 'test' | 'void';
export interface ReceiptDocument {
  language: Language;
  club: { legalName: string; taxLine: string | null; addressLines: string[] };
  title: string;
  marks: Array<{ kind: MarkKind; text: string }>;
  meta: Array<{ label: string; value: string }>;
  customer: { label: string; value: string } | null;
  table: { headers: [string, string, string, string]; rows: Array<[string, string, string, string]> };
  summary: Array<{ label: string; value: string; strong: boolean }>;
  paidBy: { label: string; rows: Array<{ label: string; value: string }> } | null;
  statement: string | null;
  notes: string[];
}

const WALLET_CREDIT_LINE_KEY = 'L-new.wallet_credit_line';

export function buildReceiptDocument(input: RenderInput): ReceiptDocument {
  const { receipt: r, club, language, t } = input;
  const o = r.lines.order;
  const isCredit = r.kind === 'wallet_credit';

  const marks: ReceiptDocument['marks'] = [];
  marks.push(input.copy ? { kind: 'copy', text: t('L-new.receipt_copy_mark') } : { kind: 'original', text: t('L-0044') });
  if (r.isTest) marks.push({ kind: 'test', text: t('L-new.receipt_test_mark') });
  if (r.status === 'void') marks.push({ kind: 'void', text: t('L-new.receipt_void_mark', { reason: (input.voidReason ?? '').trim() }) });

  const taxParts: string[] = [];
  if (club.taxId) taxParts.push(t('L-new.receipt_tax_id', { taxId: club.taxId }));
  if (club.taxBranch) taxParts.push(t('L-new.receipt_branch', { branch: club.taxBranch }));

  const rows: ReceiptDocument['table']['rows'] = r.lines.items
    .slice()
    .sort((a, b) => a.position - b.position)
    .map((i) => [
      // A wallet credit line states what it is from the language file; every other line carries the name it was sold under.
      i.kind === 'wallet_credit' ? t(WALLET_CREDIT_LINE_KEY) : language === 'th' ? i.name_th : i.name_en,
      '1',
      baht(i.unit_price_satang),
      baht(i.net_satang),
    ]);

  const summary: ReceiptDocument['summary'] = [];
  if (!isCredit) {
    summary.push({ label: t('L-0056'), value: baht(o.subtotal_satang), strong: false });
    if (o.discount_satang > 0) summary.push({ label: t('L-0057'), value: baht(-o.discount_satang), strong: false });
    if (o.credit_value_satang > 0) summary.push({ label: t('L-new.receipt_credit_used'), value: baht(-o.credit_value_satang), strong: false });
    if (o.wallet_satang > 0) summary.push({ label: t('L-0058'), value: baht(-o.wallet_satang), strong: false });
  }
  summary.push({ label: t('L-0059'), value: baht(isCredit ? r.totalSatang : o.money_satang), strong: true });

  const methodLabel = (m: string) => (m === 'cash' ? t('L-new.receipt_method_cash') : t('L-0050'));
  const paidBy = r.lines.payments.length > 0
    ? { label: t('L-0049'), rows: r.lines.payments.map((p) => ({ label: methodLabel(p.method), value: baht(p.amount_satang) })) }
    : null;

  const notes: string[] = [];
  // The VAT layout is parked (Q4, assumption A-3): a receipt of a VAT club says nothing about VAT status until it is supplied.
  if (!r.vatFlag) notes.push(t('L-0060'));
  notes.push(t('L-0061'));

  return {
    language,
    club: {
      legalName: club.legalName?.trim() || club.nameTh,
      taxLine: taxParts.length ? taxParts.join(' · ') : null,
      addressLines: (club.registeredAddress ?? '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean),
    },
    title: t('L-0017'),
    marks,
    meta: [
      { label: t('L-0047'), value: r.number },
      { label: t('L-0012'), value: t('L-0048', { dayMonthYear: dayMonthYear(r.issuedAt, language) }) },
    ],
    customer: r.customerName ? { label: t('L-0045'), value: t('L-0046', { playerName: r.customerName }) } : null,
    table: { headers: [t('L-0051'), t('L-0052'), t('L-0053'), t('L-0054')], rows },
    summary,
    paidBy,
    statement: isCredit ? t('L-new.receipt_wallet_credited') : null,
    notes,
  };
}
