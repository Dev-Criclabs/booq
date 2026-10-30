import { inflateRawSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { createZip } from './zip';
import { toCsv } from './csv';

// F01-T32 (PLAT-06-AC11): a ZIP of CSVs, built here without a dependency.
function readZip(zip: Uint8Array): { name: string; data: string; crcOk: boolean }[] {
  const b = Buffer.from(zip);
  const eocd = b.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  const count = b.readUInt16LE(eocd + 10);
  let p = b.readUInt32LE(eocd + 16);
  const out: { name: string; data: string; crcOk: boolean }[] = [];
  for (let i = 0; i < count; i += 1) {
    expect(b.readUInt32LE(p)).toBe(0x02014b50);
    const method = b.readUInt16LE(p + 10);
    const crc = b.readUInt32LE(p + 16);
    const size = b.readUInt32LE(p + 24);
    const nameLen = b.readUInt16LE(p + 28);
    const extra = b.readUInt16LE(p + 30);
    const comment = b.readUInt16LE(p + 32);
    const local = b.readUInt32LE(p + 42);
    const name = b.subarray(p + 46, p + 46 + nameLen).toString('utf8');
    const lnl = b.readUInt16LE(local + 26);
    const lex = b.readUInt16LE(local + 28);
    const raw = b.subarray(local + 30 + lnl + lex, local + 30 + lnl + lex + size);
    const data = method === 8 ? inflateRawSync(raw) : raw;
    let c = 0xffffffff;
    for (const byte of data) {
      c ^= byte;
      for (let k = 0; k < 8; k += 1) c = c & 1 ? (c >>> 1) ^ 0xedb88320 : c >>> 1;
    }
    out.push({ name, data: data.toString('utf8'), crcOk: (c ^ 0xffffffff) >>> 0 === crc });
    p += 46 + nameLen + extra + comment;
  }
  return out;
}

describe('createZip', () => {
  it('holds each file with its name, content and a correct CRC, Thai text included', () => {
    const files = readZip(createZip([{ name: 'players.csv', data: 'full_name\nสมชาย ใจดี\n' }, { name: 'resources.csv', data: 'name\n1\n' }]));
    expect(files).toEqual([
      { name: 'players.csv', data: 'full_name\nสมชาย ใจดี\n', crcOk: true },
      { name: 'resources.csv', data: 'name\n1\n', crcOk: true },
    ]);
  });
  it('handles an empty file and an empty archive', () => {
    expect(readZip(createZip([{ name: 'e.csv', data: '' }]))).toEqual([{ name: 'e.csv', data: '', crcOk: true }]);
    expect(readZip(createZip([]))).toEqual([]);
  });
});

describe('toCsv', () => {
  it('writes a header, quotes commas, quotes and line breaks, and uses LF', () => {
    expect(toCsv(['a', 'b'], [['x,y', 'say "hi"'], ['l1\nl2', null]])).toBe('a,b\n"x,y","say ""hi"""\n"l1\nl2",\n');
  });
  it('neutralises a cell that a spreadsheet would run as a formula', () => {
    expect(toCsv(['n'], [['=1+1'], ['+1'], ['-1'], ['@SUM(A1)'], ['ok']])).toBe("n\n'=1+1\n'+1\n'-1\n'@SUM(A1)\nok\n");
  });
  it('writes numbers, booleans, dates as given and null as empty', () => {
    expect(toCsv(['a', 'b', 'c'], [[5, true, null]])).toBe('a,b,c\n5,true,\n');
  });
});
