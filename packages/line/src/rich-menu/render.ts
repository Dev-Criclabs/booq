import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { Resvg } from '@resvg/resvg-js';
import * as fontkit from 'fontkit';

// The rich menu image (F10-T11; F10 design 5.5; LINE-02-AC2, AC9; D92): one image for every player of the club, each of
// the six tiles carrying its Thai and its English label together, drawn on the server from the owner's six labels. A pure
// function: the same labels give the same bytes (only the two bundled font files are used, never system fonts), so
// image_sha256 and labels_hash tell a rebuild with nothing changed. The links are not drawn: they are tap areas fixed in
// code (D54, buildRichMenu). Fonts of the design system: Noto Sans Thai for Thai, DM Sans for English, both bold.

/**
 * LINE's limits for a rich menu image (G1, F10 design section 12): a full size menu of 2500 by 1686 pixels, PNG or
 * JPEG, at most 1 MB, as LINE's Messaging API documentation states them. Checked against LINE's documentation and the
 * test Official Account in F10-T01.
 */
export const RICH_MENU_IMAGE = {
  width: 2500,
  height: 1686,
  maxBytes: 1024 * 1024,
  /** Space kept clear on each side of a label inside its tile. */
  padding: 60,
} as const;

export type RichMenuTile = 1 | 2 | 3 | 4 | 5 | 6;
export interface RichMenuLabel {
  tile: RichMenuTile | number;
  th: string;
  en: string;
}
export type RichMenuLabels = readonly RichMenuLabel[];

/** A label the image cannot hold; the code goes back to the owner's save (A16) or to P2 step 4. Never drawn off a tile. */
export class RichMenuLayoutError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = 'RichMenuLayoutError';
  }
}

export interface LaidOutLine {
  text: string;
  /** Font size in pixels. */
  size: number;
  width: number;
  baseline: number;
  /** The font's ascent and descent around the baseline, so marks above and vowels below stay inside. */
  top: number;
  bottom: number;
}
export interface LaidOutTile {
  tile: number;
  x: number;
  y: number;
  width: number;
  height: number;
  th: LaidOutLine;
  en: LaidOutLine;
}

// Sizes in pixels: the size a label starts at and the smallest it may shrink to. 56 px on the 2500 px image is about
// 8.5 pt on a phone, the smallest that stays readable; a label that needs less is refused (rich_menu_label_too_long), so
// about 26 Thai or 23 English characters fit a tile. The Thai line sits above the English one; both baselines are fixed
// per row, so tiles in a row line up whatever their label lengths (one baseline per script).
const TYPE = {
  th: { start: 132, min: 56, baselineAt: 0.47 },
  en: { start: 104, min: 56, baselineAt: 0.72 },
} as const;
const COLUMNS = 3;
const ROWS = 2;
const COLORS = { background: '#FFFFFF', alternate: '#F4F6F5', line: '#DDE2DF', thai: '#14171C', english: '#1F6F4A' } as const;

const require_ = createRequire(import.meta.url);
const FONT_FILES = {
  th: require_.resolve('@expo-google-fonts/noto-sans-thai/700Bold/NotoSansThai_700Bold.ttf'),
  en: require_.resolve('@expo-google-fonts/dm-sans/700Bold/DMSans_700Bold.ttf'),
} as const;
type Script = keyof typeof FONT_FILES;
const fonts = {
  th: fontkit.openSync(FONT_FILES.th) as fontkit.Font,
  en: fontkit.openSync(FONT_FILES.en) as fontkit.Font,
};

// Sara am (U+0E33) is drawn as its two visual parts, nikhahit (U+0E4D) and sara aa (U+0E32): the renderer otherwise
// places the composite badly after some consonants (แนะนำ ran into the next letter). It looks the same; only the image uses it.
const drawable = (script: Script, text: string) => (script === 'th' ? text.replace(/\u0E33/g, '\u0E4D\u0E32') : text);

function measure(script: Script, text: string, size: number): number {
  const f = fonts[script];
  return (f.layout(drawable(script, text)).advanceWidth * size) / f.unitsPerEm;
}

function checkLabels(labels: RichMenuLabels): RichMenuLabel[] {
  const sorted = [...labels].sort((a, b) => Number(a.tile) - Number(b.tile));
  if (sorted.length !== 6 || sorted.some((l, i) => l.tile !== i + 1)) throw new RichMenuLayoutError('rich_menu_tiles');
  for (const l of sorted) {
    for (const s of ['th', 'en'] as const) {
      if (typeof l[s] !== 'string' || l[s].trim() === '') throw new RichMenuLayoutError(`rich_menu_label_missing:${l.tile}:${s}`);
    }
  }
  return sorted.map((l) => ({ tile: l.tile, th: l.th.trim(), en: l.en.trim() }));
}

function lineFor(script: Script, text: string, tile: { tile: number; width: number; y: number; height: number }): LaidOutLine {
  const room = tile.width - 2 * RICH_MENU_IMAGE.padding;
  const t = TYPE[script];
  const f = fonts[script];
  const baseline = Math.round(tile.y + tile.height * t.baselineAt);
  for (let size = t.start; size >= t.min; size -= 2) {
    const width = measure(script, text, size);
    const top = baseline - (f.ascent * size) / f.unitsPerEm;
    const bottom = baseline - (f.descent * size) / f.unitsPerEm;
    if (width <= room && top >= tile.y && bottom <= tile.y + tile.height) return { text, size, width, baseline, top, bottom };
  }
  throw new RichMenuLayoutError(`rich_menu_label_too_long:${tile.tile}:${script}`);
}

/** Where each tile and each label goes, three tiles across and two down, covering the whole image. */
export function layoutRichMenu(labels: RichMenuLabels): { tiles: LaidOutTile[] } {
  const sorted = checkLabels(labels);
  const xs = Array.from({ length: COLUMNS + 1 }, (_, i) => Math.round((RICH_MENU_IMAGE.width * i) / COLUMNS));
  const ys = Array.from({ length: ROWS + 1 }, (_, i) => Math.round((RICH_MENU_IMAGE.height * i) / ROWS));
  return {
    tiles: sorted.map((l, i) => {
      const c = i % COLUMNS;
      const r = Math.floor(i / COLUMNS);
      const box = { tile: Number(l.tile), x: xs[c]!, y: ys[r]!, width: xs[c + 1]! - xs[c]!, height: ys[r + 1]! - ys[r]! };
      return { ...box, th: lineFor('th', l.th, box), en: lineFor('en', l.en, box) };
    }),
  };
}

const xml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function svgOf(tiles: LaidOutTile[]): string {
  const parts: string[] = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${RICH_MENU_IMAGE.width}" height="${RICH_MENU_IMAGE.height}" viewBox="0 0 ${RICH_MENU_IMAGE.width} ${RICH_MENU_IMAGE.height}">`,
    `<rect width="100%" height="100%" fill="${COLORS.background}"/>`,
  ];
  for (const t of tiles) {
    const fill = (t.tile + Math.floor((t.tile - 1) / COLUMNS)) % 2 === 0 ? COLORS.alternate : COLORS.background;
    parts.push(`<rect x="${t.x}" y="${t.y}" width="${t.width}" height="${t.height}" fill="${fill}" stroke="${COLORS.line}" stroke-width="4"/>`);
    const cx = t.x + t.width / 2;
    parts.push(`<text x="${cx}" y="${t.th.baseline}" font-family="${fonts.th.familyName}" font-weight="700" font-size="${t.th.size}" fill="${COLORS.thai}" text-anchor="middle">${xml(drawable('th', t.th.text))}</text>`);
    parts.push(`<text x="${cx}" y="${t.en.baseline}" font-family="${fonts.en.familyName}" font-weight="700" font-size="${t.en.size}" fill="${COLORS.english}" text-anchor="middle">${xml(t.en.text)}</text>`);
  }
  parts.push('</svg>');
  return parts.join('');
}

/** sha256 of the six labels in tile order: a label change, and nothing else, changes it. */
export function labelsHash(labels: RichMenuLabels): string {
  const sorted = checkLabels(labels);
  return createHash('sha256').update(JSON.stringify(sorted.map((l) => [l.tile, l.th, l.en]))).digest('hex');
}

export interface RenderedRichMenu {
  png: Buffer;
  imageSha256: string;
  labelsHash: string;
}

export function renderRichMenu(labels: RichMenuLabels): RenderedRichMenu {
  const { tiles } = layoutRichMenu(labels);
  const png = new Resvg(svgOf(tiles), {
    font: { fontFiles: [FONT_FILES.th, FONT_FILES.en], loadSystemFonts: false, defaultFontFamily: fonts.en.familyName },
    fitTo: { mode: 'original' },
  }).render().asPng();
  if (png.length > RICH_MENU_IMAGE.maxBytes) throw new RichMenuLayoutError('rich_menu_image_too_large');
  return { png, imageSha256: createHash('sha256').update(png).digest('hex'), labelsHash: labelsHash(labels) };
}
