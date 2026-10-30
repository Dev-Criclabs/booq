export type CsvCell = string | number | boolean | null | undefined;

const RISKY_START = /^[=+\-@\t\r]/;

function cell(v: CsvCell): string {
  if (v === null || v === undefined) return '';
  // A text cell that starts like a formula is prefixed so a spreadsheet shows it as text.
  const s = typeof v === 'string' && RISKY_START.test(v) ? `'${v}` : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** RFC 4180 with LF line ends. Names and notes typed by players are data, never formulas. */
export function toCsv(columns: readonly string[], rows: readonly (readonly CsvCell[])[]): string {
  return [columns.map(cell).join(','), ...rows.map((r) => r.map(cell).join(','))].join('\n') + '\n';
}
