import { parseCsv } from './csv';

// Players CSV validator (F01-T30; PLAT-06-AC1, AC2, AC5, AC10; D11, D13). Pure: it returns
// parsed values and reason codes (the client maps codes to locale keys). The raw cell text is
// not carried forward and the raw file is never stored. Nothing here writes; a file with any
// error or file level problem is not ok, so the caller saves nothing (all or nothing).
//
// Column names (assumption, D147; design 7.4 says "fixed in design" but lists none): the
// file needs `full_name` and `phone`; `date_of_birth` (YYYY-MM-DD) is optional. Any other
// column, including a club id, is ignored and only its name is reported (AC5).

export type RowErrorCode = 'name_missing' | 'phone_missing' | 'phone_invalid' | 'dob_invalid' | 'dob_future' | 'row_width';
export type FileErrorCode = 'file_empty' | 'column_missing' | 'column_duplicate';
export type RowFlag = 'duplicate_phone';

export interface PlayerValues {
  fullName: string;
  phone: string; // E.164
  dateOfBirth: string | null; // Bangkok calendar date
}
export interface PlayerRowResult {
  rowNo: number; // line number in the file, header is 1
  values: PlayerValues | null;
  errors: RowErrorCode[];
  flags: RowFlag[];
}
export interface PlayersValidation {
  ok: boolean;
  rowsRead: number;
  rows: PlayerRowResult[];
  fileErrors: FileErrorCode[];
  ignoredColumns: string[];
}
export interface ValidatePlayersOptions {
  /** The single phone rule (F02-T08 `packages/domain/phone.ts`). Returns E.164 or null. */
  normalizePhone(raw: string): string | null;
  /** Today's Asia/Bangkok date, YYYY-MM-DD, from the clock. */
  today: string;
}

const KNOWN = ['full_name', 'phone', 'date_of_birth'] as const;

function validDate(s: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return false;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return d.toISOString().slice(0, 10) === s;
}

export function validatePlayersCsv(text: string, opts: ValidatePlayersOptions): PlayersValidation {
  const table = parseCsv(text);
  const result: PlayersValidation = { ok: false, rowsRead: 0, rows: [], fileErrors: [], ignoredColumns: [] };
  if (table.length === 0) return { ...result, fileErrors: ['file_empty'] };

  const header = table[0]!.map((h) => h.trim().toLowerCase());
  const index = new Map<string, number>();
  header.forEach((h, i) => {
    if ((KNOWN as readonly string[]).includes(h)) {
      if (index.has(h)) result.fileErrors.push('column_duplicate');
      else index.set(h, i);
    } else if (h !== '') result.ignoredColumns.push(h);
  });
  if (!index.has('full_name') || !index.has('phone')) result.fileErrors.push('column_missing');
  if (result.fileErrors.length > 0) return result;
  if (table.length === 1) return { ...result, fileErrors: ['file_empty'] };

  const seen = new Map<string, number[]>();
  table.slice(1).forEach((cells, k) => {
    const rowNo = k + 2;
    const errors: RowErrorCode[] = [];
    if (cells.length !== header.length) {
      result.rows.push({ rowNo, values: null, errors: ['row_width'], flags: [] });
      return;
    }
    const get = (name: string) => (cells[index.get(name) ?? -1] ?? '').trim();
    const fullName = get('full_name');
    const rawPhone = get('phone');
    const dob = get('date_of_birth');
    if (fullName === '') errors.push('name_missing');
    let phone: string | null = null;
    if (rawPhone === '') errors.push('phone_missing');
    else {
      phone = opts.normalizePhone(rawPhone);
      if (phone === null) errors.push('phone_invalid');
    }
    if (dob !== '') {
      if (!validDate(dob)) errors.push('dob_invalid');
      else if (dob > opts.today) errors.push('dob_future');
    }
    if (phone !== null) seen.set(phone, [...(seen.get(phone) ?? []), result.rows.length]);
    result.rows.push({
      rowNo,
      values: errors.length === 0 && phone !== null ? { fullName, phone, dateOfBirth: dob === '' ? null : dob } : null,
      errors,
      flags: [],
    });
  });
  for (const at of seen.values()) if (at.length > 1) for (const i of at) result.rows[i]!.flags.push('duplicate_phone');

  result.rowsRead = result.rows.length;
  result.ok = result.rows.every((r) => r.errors.length === 0);
  return result;
}
