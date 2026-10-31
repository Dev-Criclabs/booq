import { describe, expect, it } from 'vitest';
import { adminHasKey } from './i18n';
import { checkRange, closeCsvHref, defaultRange, KIND_KEY, listPath, pdfHref, RECEIPT_ERROR_KEY, receiptErrorKey, voidBody } from './receipts';

// F11-T21 A14 Receipts and daily close (ADMIN-15): a void needs a written reason; days are checked before the server; the PDF is in the language chosen.
describe('list', () => {
  it('asks for a date range and a page; the search is trimmed and left out when empty', () => {
    expect(listPath({ q: '', from: '2027-01-01', to: '2027-01-31' })).toBe('/staff/receipts?from=2027-01-01&to=2027-01-31&limit=50&offset=0');
    expect(listPath({ q: ' HTC-2027 ', from: '2027-01-01', to: '2027-01-31', offset: 50 })).toBe('/staff/receipts?from=2027-01-01&to=2027-01-31&limit=50&offset=50&q=HTC-2027');
  });
  it('checks the days; the first view is the last 31 days', () => {
    expect(checkRange({ from: '2027-01-02', to: '2027-01-01' })).toEqual({ ok: false, key: 'A-new.rcpt_err_range' });
    expect(checkRange({ from: '', to: '2027-01-01' })).toEqual({ ok: false, key: 'A-new.rcpt_err_day' });
    expect(checkRange({ from: '2027-01-01', to: '2027-01-01' })).toEqual({ ok: true });
    expect(defaultRange('2027-02-10')).toEqual({ from: '2027-01-11', to: '2027-02-10' });
  });
  it('the PDF and the export are addressed by id, language and day', () => {
    expect(pdfHref('hunter', 'r1', 'th')).toBe('/api/c/hunter/staff/receipts/r1/pdf?lang=th');
    expect(closeCsvHref('hunter', '2027-01-12')).toBe('/api/c/hunter/staff/daily-close/csv?day=2027-01-12');
  });
});

describe('void', () => {
  it('needs a written reason, sent trimmed', () => {
    expect(voidBody('   ')).toEqual({ ok: false, key: 'A-new.rcpt_err_reason' });
    expect(voidBody(' Wrong item ')).toEqual({ ok: true, body: { reason: 'Wrong item' } });
  });
});

describe('refusals and text', () => {
  it('each refusal has its own words', () => {
    expect(receiptErrorKey({ kind: 'refused', status: 409, code: 'already_void' })).toBe('A-new.rcpt_err_void');
    expect(receiptErrorKey({ kind: 'refused', status: 409, code: 'day_not_over' })).toBe('A-new.rcpt_err_not_over');
    expect(receiptErrorKey({ kind: 'refused', status: 409, code: 'zzz' })).toBe('A-new.rcpt_err_general');
    expect(receiptErrorKey({ kind: 'forbidden' })).toBe('A-new.rcpt_err_forbidden');
  });
  it('every key the page uses exists in both languages', () => {
    const keys = ['A-0039', 'A-0057', 'A-0102', 'A-0128', 'A-0299', 'A-0301', 'A-0302', 'A-0303', 'A-0305', 'A-0307', 'A-0308', 'A-0312', 'A-0315', 'A-0316', 'A-0318', 'A-0319', 'A-new.set_retry', 'A-new.audit_from', 'A-new.audit_to', 'A-new.audit_apply', 'A-new.audit_more',
      'A-new.cal_close', 'A-new.prof_col_what', 'A-new.prof_col_status', 'A-new.prof_receipt_pdf', 'A-new.prof_receipt_test', 'A-new.prof_receipt_issued', ...Object.values(KIND_KEY), ...Object.values(RECEIPT_ERROR_KEY),
      ...['voided', 'load_failed', 'none', 'pdf_th', 'pdf_en', 'void_reason', 'void_go', 'close_done', 'close_closed', 'close_open', 'close_failed', 'close_run', 'money_total', 'credit_count', 'err_general', 'err_range', 'err_day'].map((k) => `A-new.rcpt_${k}`)];
    for (const lang of ['th', 'en'] as const) for (const k of keys) expect(adminHasKey(lang, k), `${lang} ${k}`).toBe(true);
  });
});
