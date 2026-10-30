import { join } from 'node:path';
import { createCopy, loadDictionary, renderReceipt, type Language } from '@booq/receipts';

// The receipt PDF for a route (F13-T12, T13): maps what app.receipt_for_print returns to the renderer and reads the language files
// from the configured folder. The renderer holds every word by key; this file holds none.

export interface PrintData {
  number: string;
  kind: 'sale' | 'wallet_credit';
  status: 'issued' | 'void';
  issued_at: string;
  vat_flag: boolean;
  is_test: boolean;
  customer_name: string | null;
  total_satang: number;
  lines: any; // the stored snapshot, shaped by app.issue_receipt
  void_reason: string | null;
  language: Language;
  club: { legal_name: string | null; name_th: string; tax_id: string | null; tax_branch: string | null; registered_address: string | null };
  original: boolean;
}

export type ReceiptPdf = (data: PrintData, language: Language, copy: boolean) => Promise<Uint8Array>;

/** `localesDir` is the folder with en.json, th.json and pending/. Null means it is not set up: the PDF routes answer 503. */
export function createReceiptPdf(localesDir: string | null): ReceiptPdf | null {
  if (localesDir === null) return null;
  const copies = new Map<Language, ReturnType<typeof createCopy>>();
  const copyFor = (language: Language) => {
    let c = copies.get(language);
    if (!c) {
      c = createCopy(loadDictionary(language, localesDir));
      copies.set(language, c);
    }
    return c;
  };
  return (data, language, copy) =>
    renderReceipt({
      language,
      copy,
      voidReason: data.void_reason,
      t: copyFor(language),
      club: { legalName: data.club.legal_name, nameTh: data.club.name_th, taxId: data.club.tax_id, taxBranch: data.club.tax_branch, registeredAddress: data.club.registered_address },
      receipt: {
        number: data.number, kind: data.kind, status: data.status, issuedAt: data.issued_at, vatFlag: data.vat_flag, isTest: data.is_test,
        customerName: data.customer_name, totalSatang: data.total_satang, lines: data.lines,
      },
    });
}

export const defaultLocalesDir = (root: string) => join(root, 'locales');
