import { describe, expect, it } from 'vitest';
import { parseCsv, parseThbToSatang, validatePlayersCsv } from './index';

// F01-T30 (PLAT-06-AC1, AC2, AC5, AC9, AC10, AC18; D13, D11). Pure: no database, no raw file kept.
const phone = (raw: string) => {
  const d = raw.replace(/[\s-]/g, '');
  return /^0[689]\d{8}$/.test(d) ? `+66${d.slice(1)}` : null;
};
const opts = { normalizePhone: phone, today: '2026-10-30' };
const HEAD = 'full_name,phone,date_of_birth\n';

describe('parseCsv', () => {
  it('handles quotes, commas in fields, CRLF, a BOM and blank trailing lines', () => {
    const rows = parseCsv('﻿a,b\r\n"x, y","say ""hi"""\r\n\r\n');
    expect(rows).toEqual([['a', 'b'], ['x, y', 'say "hi"']]);
  });
});

describe('parseThbToSatang (AC9)', () => {
  it.each([['1500', 150000], ['1,500.50', 150050], ['0.5', 50], ['฿ 20', 2000], ['0.07', 7]])('%s', (s, n) => {
    expect(parseThbToSatang(s)).toBe(n);
  });
  it.each(['', 'abc', '-5', '1.234', '1.2.3'])('rejects %j', (s) => expect(parseThbToSatang(s)).toBeNull());
});

describe('validatePlayersCsv', () => {
  it('a valid file is ok and holds parsed values only', () => {
    const r = validatePlayersCsv(`${HEAD}Somchai Jaidee,081-234 5678,1990-05-01\nMali Rakdee,0899999999,\n`, opts);
    expect(r.ok).toBe(true);
    expect(r.rowsRead).toBe(2);
    expect(r.rows[0]).toMatchObject({ rowNo: 2, errors: [], values: { fullName: 'Somchai Jaidee', phone: '+66812345678', dateOfBirth: '1990-05-01' } });
    expect(r.rows[1]?.values?.dateOfBirth).toBeNull();
    expect(JSON.stringify(r)).not.toContain('081-234 5678'); // the raw cell is not carried forward
  });

  it('one bad row makes the whole file fail, and every bad row is listed with a code', () => {
    const r = validatePlayersCsv(`${HEAD}Ok One,0811111111,\n,0822222222,\nBad Phone,12345,\nFuture Kid,0833333333,2027-01-01\nBad Date,0844444444,31/02/2000\n`, opts);
    expect(r.ok).toBe(false);
    expect(r.rows.filter((x) => x.errors.length).map((x) => [x.rowNo, x.errors])).toEqual([
      [3, ['name_missing']],
      [4, ['phone_invalid']],
      [5, ['dob_future']],
      [6, ['dob_invalid']],
    ]);
  });

  it('a club id column and any unknown column are ignored and reported by name only', () => {
    const r = validatePlayersCsv('club_id,full_name,phone,notes\nother-club,Somchai,0811111111,vip\n', opts);
    expect(r.ok).toBe(true);
    expect(r.ignoredColumns).toEqual(['club_id', 'notes']);
    expect(JSON.stringify(r.rows)).not.toContain('other-club');
  });

  it('flags duplicate phones within the file without failing it (D11)', () => {
    const r = validatePlayersCsv(`${HEAD}A One,0811111111,\nB Two,081 111 1111,\nC Three,0822222222,\n`, opts);
    expect(r.ok).toBe(true);
    expect(r.rows.map((x) => x.flags)).toEqual([['duplicate_phone'], ['duplicate_phone'], []]);
  });

  it.each([
    ['', 'file_empty'],
    ['full_name\nA\n', 'column_missing'],
    ['full_name,phone\n', 'file_empty'],
  ])('file level problem %j -> %s', (text, code) => {
    const r = validatePlayersCsv(text, opts);
    expect(r.ok).toBe(false);
    expect(r.fileErrors).toContain(code);
  });

  it('a row with the wrong number of cells is an error, not a guess', () => {
    const r = validatePlayersCsv(`${HEAD}A One,0811111111\n`, opts);
    expect(r.ok).toBe(false);
    expect(r.rows[0]?.errors).toEqual(['row_width']);
  });

  it('error output holds codes, never user text', () => {
    const r = validatePlayersCsv(`${HEAD},x,\n`, opts);
    for (const e of r.rows.flatMap((x) => x.errors)) expect(e).toMatch(/^[a-z_]+$/);
  });
});
