import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { collectRegistry } from './registry';
import { checkTableClasses } from './registry/check';
import { createTestDatabase, type TestDatabase } from './testing/harness';

// F10-T04 / migration 0603: rich_menu_label and rich_menu (F10 design 4.1, 5.5). LINE-02-AC1 (six tiles,
// links fixed in code), LINE-02-AC2; D54 (links cannot be edited), D92 (one menu per club).
const A = '3f2b8f0e-7c1d-4a55-9d0a-1c2e3f4a5b6c';
const B = '9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d';
const HASH = 'a'.repeat(64);

let tdb: TestDatabase;
beforeEach(async () => {
  tdb = await createTestDatabase();
  await tdb.query(`insert into public.club (id, slug, name_th, name_en, status) values ($1,'a','ก','A','live'), ($2,'b','ข','B','live')`, [A, B]);
});
afterEach(async () => {
  await tdb.close();
});

const label = (tile: number, th: string | null = 'คอร์ต', en: string | null = 'Court', club = A) =>
  tdb.query(`insert into public.rich_menu_label (club_id, tile, label_th, label_en) values ($1,$2,$3,$4)`, [club, tile, th, en]);
const menu = (status: string, extra: { club?: string; lineId?: string | null; error?: string | null } = {}) =>
  tdb.query(
    `insert into public.rich_menu (club_id, line_rich_menu_id, image_sha256, labels_hash, status, error, rendered_at, uploaded_at)
     values ($1,$2,$3,$3,$4,$5, now(), case when $4 in ('active','superseded') then now() end) returning id`,
    [extra.club ?? A, extra.lineId === undefined ? 'richmenu-' + Math.random().toString(36).slice(2) : extra.lineId, HASH, status, extra.error ?? null],
  );

describe('rich_menu_label (F10-T04, LINE-02-AC1, D54)', () => {
  it('six tiles per club: a seventh tile is refused, by number or by repeat', async () => {
    for (let t = 1; t <= 6; t++) await label(t);
    await expect(label(7)).rejects.toThrow(/rich_menu_label_tile_range/);
    await expect(label(0)).rejects.toThrow(/rich_menu_label_tile_range/);
    await expect(label(3)).rejects.toThrow(/rich_menu_label_one_per_tile/);
    for (let t = 1; t <= 6; t++) await label(t, 'x', 'x', B);
  });

  it('an unset label means the default from the language files; a set label is not blank', async () => {
    await label(1, null, null);
    await expect(label(2, '  ', 'Court')).rejects.toThrow(/rich_menu_label_th_present/);
    await expect(label(2, 'คอร์ต', '')).rejects.toThrow(/rich_menu_label_en_present/);
  });

  it('links are not stored: no column can hold one (they are fixed in code, D54)', async () => {
    for (const table of ['rich_menu_label', 'rich_menu']) {
      const cols = (await tdb.query(`select column_name from information_schema.columns where table_schema = 'public' and table_name = $1`, [table])).rows.map((r) => r.column_name as string);
      expect(cols.filter((c) => /link|url|uri|href|path|action/.test(c)), table).toEqual([]);
    }
    const cols = (await tdb.query(`select column_name from information_schema.columns where table_schema = 'public' and table_name = 'rich_menu_label' order by ordinal_position`)).rows.map((r) => r.column_name);
    expect(cols).toEqual(['club_id', 'id', 'tile', 'label_th', 'label_en']);
  });
});

describe('rich_menu (F10-T04, LINE-02-AC2, D92)', () => {
  it('one active menu per club; two active rows for one club are refused', async () => {
    const first = (await menu('active')).rows[0].id;
    await expect(menu('active')).rejects.toThrow(/rich_menu_one_active/);
    await menu('active', { club: B });
    await menu('building', { lineId: null });
    await tdb.query(`update public.rich_menu set status = 'superseded' where id = $1`, [first]);
    await menu('active');
  });

  it('status takes the design values; a failure has a reason, an active or superseded menu was uploaded', async () => {
    await expect(menu('deleted')).rejects.toThrow(/rich_menu_status_values/);
    await expect(menu('failed')).rejects.toThrow(/rich_menu_failed_has_error/);
    await menu('failed', { error: 'upload_413' });
    await expect(menu('active', { lineId: null })).rejects.toThrow(/rich_menu_uploaded_has_line_id/);
  });

  it('hashes are sha256 hex (no-op rebuild detection, D92)', async () => {
    await expect(tdb.query(`insert into public.rich_menu (club_id, image_sha256, labels_hash, status) values ($1,'abc',$2,'building')`, [A, HASH]))
      .rejects.toThrow(/rich_menu_image_sha256_format/);
    await expect(tdb.query(`insert into public.rich_menu (club_id, image_sha256, labels_hash, status) values ($1,$2,'abc','building')`, [A, HASH]))
      .rejects.toThrow(/rich_menu_labels_hash_format/);
  });

  it('a LINE rich menu id belongs to one row', async () => {
    await menu('superseded', { lineId: 'richmenu-1' });
    await expect(menu('active', { lineId: 'richmenu-1' })).rejects.toThrow(/rich_menu_line_id_unique/);
  });
});

describe('classification', () => {
  it('both are class S (setup), labels audited (LINE-02-AC10), and pass the table class check', async () => {
    const reg = await collectRegistry();
    expect(reg['public.rich_menu_label']).toEqual({ class: 'S', audited: true });
    expect(reg['public.rich_menu']).toEqual({ class: 'S' });
    const res = await checkTableClasses(tdb.pool, reg);
    expect(res.problems.filter((p) => p.table.startsWith('public.rich_menu'))).toEqual([]);
  });

  // Who reaches these tables is F10-T07 (0606, line-grants.test.ts).
});
