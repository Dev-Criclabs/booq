import type { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import PDFDocument from 'pdfkit';
import { buildReceiptDocument, type ReceiptDocument, type RenderInput } from './model';

// renderReceipt (F13 design 4.5; RCPT-01-AC11, AC12; RCPT-02): the receipt as an A4 PDF, drawn from the document model
// of model.ts, which holds every word. The PDF is not stored: the same snapshot always draws the same document, so a file lost
// is a file regenerated. Sarabun (SIL Open Font License) carries both Thai and Latin text, so one font file serves both
// languages and Thai marks are shaped by the font's own tables. The draw code holds no words: only numbers and layout.

// Taken through process.getBuiltinModule so a bundler leaves the lookup to Node at runtime.
const require = (process.getBuiltinModule('node:module') as { createRequire: typeof createRequire }).createRequire(import.meta.url);
// The font folder is found from the package's own package.json, so a bundler sees no .ttf import.
const SARABUN = dirname(require.resolve('@expo-google-fonts/sarabun/package.json'));
const FONT = {
  regular: join(SARABUN, '400Regular', 'Sarabun_400Regular.ttf'),
  bold: join(SARABUN, '700Bold', 'Sarabun_700Bold.ttf'),
};

const PAGE = { width: 595.28, height: 841.89, margin: 48 };
const COL = { item: 0, qty: 262, unit: 312, amount: 412 };   // x offsets inside the content width
const COL_WIDTH = { item: 250, qty: 40, unit: 90, amount: 83 };
const INK = '#1a1a1a';
const MUTED = '#666666';

export async function renderReceipt(input: RenderInput): Promise<Uint8Array> {
  return drawReceipt(buildReceiptDocument(input), new Date(input.receipt.issuedAt), input.receipt.number);
}

export async function drawReceipt(d: ReceiptDocument, issuedAt: Date, number: string): Promise<Uint8Array> {
  const doc = new PDFDocument({
    size: 'A4',
    margins: { top: PAGE.margin, bottom: PAGE.margin, left: PAGE.margin, right: PAGE.margin },
    compress: false,
    info: { Title: number, Producer: 'BOOQ', Creator: 'BOOQ', CreationDate: issuedAt, ModDate: issuedAt },
  });
  const chunks: Buffer[] = [];
  doc.on('data', (c: Buffer) => chunks.push(c));
  const done = new Promise<Uint8Array>((resolve) => doc.on('end', () => resolve(new Uint8Array(Buffer.concat(chunks)))));

  const left = PAGE.margin;
  const width = PAGE.width - PAGE.margin * 2;
  const right = left + width;
  const regular = () => doc.font(FONT.regular).fillColor(INK);
  const bold = () => doc.font(FONT.bold).fillColor(INK);

  // Header: the club on the left, the title and marks on the right.
  let y = PAGE.margin;
  bold().fontSize(14).text(d.club.legalName, left, y, { width: 330 });
  regular().fontSize(9).fillColor(MUTED);
  for (const line of d.club.addressLines) doc.text(line, left, doc.y, { width: 330 });
  if (d.club.taxLine) doc.text(d.club.taxLine, left, doc.y, { width: 330 });
  const leftBottom = doc.y;
  bold().fontSize(22).text(d.title, right - 190, y, { width: 190, align: 'right' });
  let markY = doc.y + 2;
  for (const m of d.marks) {
    regular().fontSize(m.kind === 'original' ? 9 : 10).fillColor(m.kind === 'original' ? MUTED : INK);
    doc.text(m.text, right - 190, markY, { width: 190, align: 'right' });
    markY = doc.y + 1;
  }
  y = Math.max(leftBottom, markY) + 16;

  // Number, date, customer.
  const metaLine = (label: string, value: string) => {
    regular().fontSize(9).fillColor(MUTED).text(label, left, y, { width: 90 });
    bold().fontSize(10).text(value, left + 95, y, { width: 300 });
    y = Math.max(doc.y, y + 14) + 2;
  };
  for (const m of d.meta) metaLine(m.label, m.value);
  if (d.customer) metaLine(d.customer.label, d.customer.value);
  y += 10;

  // Items.
  const cell = (text: string, x: number, w: number, align: 'left' | 'right', yy: number) => doc.text(text, left + x, yy, { width: w, align });
  regular().fontSize(9).fillColor(MUTED);
  const heads: Array<[string, number, number, 'left' | 'right']> = [
    [d.table.headers[0], COL.item, COL_WIDTH.item, 'left'], [d.table.headers[1], COL.qty, COL_WIDTH.qty, 'right'],
    [d.table.headers[2], COL.unit, COL_WIDTH.unit, 'right'], [d.table.headers[3], COL.amount, COL_WIDTH.amount, 'right'],
  ];
  let headH = 0;
  for (const [t, x, w, a] of heads) { cell(t, x, w, a, y); headH = Math.max(headH, doc.y - y); }
  y += headH + 4;
  doc.moveTo(left, y).lineTo(right, y).lineWidth(0.5).strokeColor(MUTED).stroke();
  y += 6;
  const bottomLimit = PAGE.height - PAGE.margin - 90;
  for (const row of d.table.rows) {
    regular().fontSize(10);
    const h = Math.max(doc.heightOfString(row[0], { width: COL_WIDTH.item }), 13);
    if (y + h > bottomLimit) { doc.addPage(); y = PAGE.margin; }
    regular().fontSize(10);
    cell(row[0], COL.item, COL_WIDTH.item, 'left', y);
    cell(row[1], COL.qty, COL_WIDTH.qty, 'right', y);
    cell(row[2], COL.unit, COL_WIDTH.unit, 'right', y);
    cell(row[3], COL.amount, COL_WIDTH.amount, 'right', y);
    y += h + 6;
  }
  doc.moveTo(left, y).lineTo(right, y).lineWidth(0.5).strokeColor(MUTED).stroke();
  y += 8;

  // Totals, right aligned under the amount column.
  const labelX = COL.unit - 90;
  for (const s of d.summary) {
    (s.strong ? bold() : regular()).fontSize(s.strong ? 12 : 10);
    const h = Math.max(doc.heightOfString(s.label, { width: COL.amount - labelX - 8 }), 14);
    if (y + h > bottomLimit) { doc.addPage(); y = PAGE.margin; (s.strong ? bold() : regular()).fontSize(s.strong ? 12 : 10); }
    cell(s.label, labelX, COL.amount - labelX - 8, 'right', y);
    cell(s.value, COL.amount, COL_WIDTH.amount, 'right', y);
    y += h + 4;
  }
  y += 10;

  if (d.paidBy) {
    regular().fontSize(9).fillColor(MUTED).text(d.paidBy.label, left, y, { width: 120 });
    y = doc.y + 2;
    for (const p of d.paidBy.rows) {
      regular().fontSize(10).text(p.label, left, y, { width: 250 });
      cell(p.value, COL.amount, COL_WIDTH.amount, 'right', y);
      y = Math.max(doc.y, y + 13) + 2;
    }
    y += 6;
  }
  if (d.statement) {
    bold().fontSize(10).text(d.statement, left, y, { width });
    y = doc.y + 8;
  }

  // Notes at the foot of the page.
  regular().fontSize(8).fillColor(MUTED);
  const notesH = d.notes.reduce((n, t) => n + doc.heightOfString(t, { width }) + 3, 0);
  let ny = Math.max(y + 12, PAGE.height - PAGE.margin - notesH);
  for (const t of d.notes) {
    doc.text(t, left, ny, { width });
    ny = doc.y + 3;
  }

  // A watermark for a copy, a test or a void, on every page, behind nothing that matters: light and diagonal.
  const stamp = d.marks.filter((m) => m.kind !== 'original');
  const range = doc.bufferedPageRange();
  void range;
  if (stamp.length) {
    const text = stamp[stamp.length - 1]!.text;
    doc.save();
    doc.opacity(0.12);
    bold().fontSize(54);
    doc.rotate(-30, { origin: [PAGE.width / 2, PAGE.height / 2] });
    doc.text(text, PAGE.margin, PAGE.height / 2 - 30, { width: PAGE.width - PAGE.margin * 2, align: 'center', lineBreak: false });
    doc.restore();
  }

  doc.end();
  return done;
}
