import { describe, expect, it } from 'vitest';
import { RICH_MENU_IMAGE, layoutRichMenu, labelsHash, renderRichMenu, RichMenuLayoutError, type RichMenuLabels } from './render';

// F10-T11: renderRichMenu(labels) -> png, one image with the Thai and English labels of the six tiles (F10 design 5.5;
// LINE-02-AC2, AC3, AC9; D92). DM Sans and Noto Sans Thai; hashes for no-op detection. The image limits are G1 (design
// section 12), taken from LINE's Messaging API documentation and checked in F10-T01.

// The six tiles with the Thai terms of Gaps A6 (คลาสเดี่ยว, คลาสกลุ่ม), not the canvas's เรียนเดี่ยว and เรียนกลุ่ม.
const LABELS: RichMenuLabels = [
  { tile: 1, th: 'จองคอร์ต', en: 'Book a court' },
  { tile: 2, th: 'คลาสเดี่ยว', en: 'Solo classes' },
  { tile: 3, th: 'คลาสกลุ่ม', en: 'Group classes' },
  { tile: 4, th: 'แพ็กเกจ', en: 'Packages' },
  { tile: 5, th: 'การจองของฉัน', en: 'My bookings' },
  { tile: 6, th: 'แนะนำเพื่อน', en: 'Refer a friend' },
];
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const pngSize = (png: Buffer) => ({ width: png.readUInt32BE(16), height: png.readUInt32BE(20) });
const withTile = (tile: number, th: string, en: string): RichMenuLabels =>
  LABELS.map((l) => (l.tile === tile ? { tile, th, en } : l)) as unknown as RichMenuLabels;

describe('renderRichMenu (D92)', () => {
  it('is a PNG of the full size rich menu within LINE’s file size limit (G1)', () => {
    const r = renderRichMenu(LABELS);
    expect(r.png.subarray(0, 8).equals(PNG_SIGNATURE)).toBe(true);
    expect(pngSize(r.png)).toEqual({ width: RICH_MENU_IMAGE.width, height: RICH_MENU_IMAGE.height });
    expect(RICH_MENU_IMAGE).toMatchObject({ width: 2500, height: 1686, maxBytes: 1024 * 1024 });
    expect(r.png.length).toBeLessThanOrEqual(RICH_MENU_IMAGE.maxBytes);
  });

  it('the same labels give the same bytes, and the hashes detect a no-op rebuild', () => {
    const a = renderRichMenu(LABELS);
    const b = renderRichMenu([...LABELS].reverse() as unknown as RichMenuLabels);   // tile order in the input does not matter
    expect(a.png.equals(b.png)).toBe(true);
    expect(a.imageSha256).toBe(b.imageSha256);
    expect(a.labelsHash).toBe(b.labelsHash);
    expect(a.imageSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(a.labelsHash).toBe(labelsHash(LABELS));
    const c = renderRichMenu(withTile(4, 'แพ็กเกจของฉัน', 'My packages'));
    expect(c.labelsHash).not.toBe(a.labelsHash);
    expect(c.imageSha256).not.toBe(a.imageSha256);
  });

  it('needs exactly the six tiles 1 to 6, each with a Thai and an English label', () => {
    expect(() => renderRichMenu(LABELS.slice(0, 5) as unknown as RichMenuLabels)).toThrow(/rich_menu_tiles/);
    expect(() => renderRichMenu(withTile(3, ' ', 'Group classes'))).toThrow(/rich_menu_label_missing:3:th/);
    expect(() => renderRichMenu([...LABELS.slice(0, 5), { tile: 5, th: 'x', en: 'x' }] as unknown as RichMenuLabels)).toThrow(/rich_menu_tiles/);
  });
});

describe('Thai drawing', () => {
  it('a label with sara am draws the same as its nikhahit and sara aa form (the renderer misplaces the composite)', () => {
    const a = renderRichMenu(withTile(6, 'แนะนำเพื่อน', 'Refer a friend'));
    const b = renderRichMenu(withTile(6, 'แนะน\u0E4D\u0E32เพื่อน', 'Refer a friend'));
    expect(a.png.equals(b.png)).toBe(true);
    expect(a.labelsHash).not.toBe(b.labelsHash);   // the stored labels are the owner's own text
  });
});

describe('layout (LINE-02-AC2, AC9)', () => {
  it('six tiles, three across and two down, covering the image', () => {
    const l = layoutRichMenu(LABELS);
    expect(l.tiles.map((t) => t.tile)).toEqual([1, 2, 3, 4, 5, 6]);
    const right = Math.max(...l.tiles.map((t) => t.x + t.width));
    const bottom = Math.max(...l.tiles.map((t) => t.y + t.height));
    expect([right, bottom]).toEqual([RICH_MENU_IMAGE.width, RICH_MENU_IMAGE.height]);
    expect(l.tiles[0]).toMatchObject({ x: 0, y: 0 });
    expect(l.tiles[3]).toMatchObject({ x: 0 });
  });

  it('the longest Thai and English labels fit their tile, shrinking when they must', () => {
    // Long labels an owner might type, in both scripts, with Thai tone marks and vowels above and below.
    const long = withTile(5, 'ประวัติการจองทั้งหมดของฉัน', 'My bookings and history');
    const l = layoutRichMenu(long);
    for (const t of l.tiles) {
      for (const line of [t.th, t.en]) {
        expect(line.width, `${t.tile} ${line.text}`).toBeLessThanOrEqual(t.width - 2 * RICH_MENU_IMAGE.padding);
        expect(line.top, `${t.tile} ${line.text}`).toBeGreaterThanOrEqual(t.y);
        expect(line.bottom, `${t.tile} ${line.text}`).toBeLessThanOrEqual(t.y + t.height);
      }
    }
    const tile5 = l.tiles.find((t) => t.tile === 5)!;
    const tile1 = l.tiles.find((t) => t.tile === 1)!;
    expect(tile5.th.size).toBeLessThan(tile1.th.size);   // shrunk to fit
  });

  it('a label too long to fit at the smallest size is refused with a code, not drawn off the tile', () => {
    expect(() => layoutRichMenu(withTile(2, 'คลาสเดี่ยว'.repeat(6), 'Solo classes'))).toThrow(RichMenuLayoutError);
    expect(() => layoutRichMenu(withTile(2, 'คลาสเดี่ยว', 'Solo classes '.repeat(8)))).toThrow(/rich_menu_label_too_long:2:en/);
  });

  it('both scripts share a baseline: every Thai line on one baseline and every English line on another, in each row', () => {
    const l = layoutRichMenu(withTile(5, 'ประวัติการจองทั้งหมดของฉัน', 'My bookings and history'));
    for (const row of [[1, 2, 3], [4, 5, 6]]) {
      const tiles = row.map((n) => l.tiles.find((t) => t.tile === n)!);
      expect(new Set(tiles.map((t) => t.th.baseline)).size, `Thai, row ${row}`).toBe(1);
      expect(new Set(tiles.map((t) => t.en.baseline)).size, `English, row ${row}`).toBe(1);
    }
    // Tone marks above and vowels below the Thai line do not move its baseline (font metrics, not glyph boxes).
    const plain = layoutRichMenu(withTile(1, 'จองคอร์ต', 'Book a court')).tiles[0]!.th.baseline;
    const marks = layoutRichMenu(withTile(1, 'จู่ๆ ก็ได้ที่', 'Book a court')).tiles[0]!.th.baseline;
    expect(marks).toBe(plain);
  });
});
