// Minimal RFC 4180 reader: quoted fields, doubled quotes, CRLF or LF, a leading BOM.
// Blank lines are dropped. The text is parsed and then discarded by the caller (PLAT-06-AC10).
export function parseCsv(text: string): string[][] {
  const src = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  const endRow = () => {
    row.push(cell);
    cell = '';
    if (row.some((c) => c.trim() !== '')) rows.push(row);
    row = [];
  };
  for (let i = 0; i < src.length; i += 1) {
    const ch = src[i]!;
    if (quoted) {
      if (ch === '"' && src[i + 1] === '"') {
        cell += '"';
        i += 1;
      } else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') {
      row.push(cell);
      cell = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && src[i + 1] === '\n') i += 1;
      endRow();
    } else cell += ch;
  }
  if (cell !== '' || row.length > 0) endRow();
  return rows;
}

/** Amounts in a file are baht (PLAT-06-AC9). Returns integer satang, or null when not a clean amount. */
export function parseThbToSatang(raw: string): number | null {
  const s = raw.trim().replace(/^฿\s*/, '').replace(/,/g, '');
  const m = /^(\d+)(?:\.(\d{1,2}))?$/.exec(s);
  if (!m) return null;
  const satang = Number(m[1]) * 100 + Number((m[2] ?? '').padEnd(2, '0') || '0');
  return Number.isSafeInteger(satang) ? satang : null;
}
