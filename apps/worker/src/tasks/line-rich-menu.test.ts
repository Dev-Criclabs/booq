import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createDb, type Db } from '@booq/db';
import { createTestDatabase, type TestDatabase } from '@booq/db/testing';
import { loadMessageDictionary, type RichMenuApi } from '@booq/line/server';
import { FakeClock, FakeLine } from '../../../../tests/fakes';
import { closeTestDatabase } from '../testing/teardown';
import { buildRichMenu, runRichMenuRequests } from './line-rich-menu';

// F10-T12 buildRichMenu (F10 design 5.5; LINE-02-AC1, AC4, AC8, PLAT-04): render, create the menu with its six tap areas,
// upload the image, make it the default, then supersede and delete the old one; a failure keeps the old menu working,
// marks the new row failed, never touches the club's status, and every call is audited.
const A = '3f2b8f0e-7c1d-4a55-9d0a-1c2e3f4a5b6c';
const LIFF = '2012300015-WIi1jtLB';
const TOKEN = 'tok-a';
const LOCALES = resolve(__dirname, '../../../../locales');
const dictionary = { th: loadMessageDictionary('th', LOCALES), en: loadMessageDictionary('en', LOCALES) };

let tdb: TestDatabase;
let worker: Db;
let line: FakeLine;
let calls: string[];
let failAt: string | null;

/** The rich menu API over the fake LINE: its own create and set default; upload and delete are recorded here. */
function fakeApi(): RichMenuApi {
  return {
    async create(token, menu) {
      calls.push('create');
      if (failAt === 'create') return { ok: false, code: 'http_400' };
      const r = line.createRichMenu(token, menu as never);
      return r.status === 200 ? { ok: true, richMenuId: String(r.body['richMenuId']) } : { ok: false, code: `http_${r.status}` };
    },
    async upload(_token, id, png) {
      calls.push(`upload:${id}:${png.length > 0}`);
      return failAt === 'upload' ? { ok: false, code: 'http_413' } : { ok: true };
    },
    async setDefault(token, id) {
      calls.push(`default:${id}`);
      if (failAt === 'default') return { ok: false, code: 'http_500' };
      const r = line.setDefaultRichMenu(token, id);
      return r.status === 200 ? { ok: true } : { ok: false, code: `http_${r.status}` };
    },
    async remove(_token, id) {
      calls.push(`delete:${id}`);
      return { ok: true };
    },
  };
}
const build = (o: { force?: boolean } = {}) =>
  buildRichMenu(worker, { api: fakeApi(), dictionary, readToken: async () => TOKEN }, A, { force: o.force ?? false });
const menus = async () => (await tdb.query(`select status, line_rich_menu_id, error from public.rich_menu where club_id = $1 order by created_at, status`, [A])).rows;
const notes = async () => (await tdb.query(`select action, new_value as detail from public.audit_entry where club_id = $1 and action like 'rich_menu.%' order by seq`, [A])).rows;

beforeEach(async () => {
  tdb = await createTestDatabase();
  await tdb.query(`insert into public.club (id, slug, name_th, name_en, status) values ($1,'a','ก','A','draft')`, [A]);
  await tdb.query(`insert into public.line_connection (club_id, liff_id) values ($1,$2) on conflict (club_id) do update set liff_id = excluded.liff_id`, [A, LIFF]);
  worker = createDb({ connectionString: tdb.url, max: 2, role: 'booq_worker' });
  line = new FakeLine({ clock: new FakeClock(), channels: [{ clubId: A, channelAccessToken: TOKEN, loginChannelId: '2012300015', liffId: LIFF }] });
  calls = [];
  failAt = null;
});
afterEach(async () => {
  await worker?.end();
  if (tdb) await closeTestDatabase(tdb);
});

describe('buildRichMenu', () => {
  it('six areas with six distinct links, tile 1 opening C4; the menu becomes the club’s default (LINE-02-AC1, AC2)', async () => {
    const r = await build();
    expect(r).toMatchObject({ outcome: 'active' });
    const menu = line.defaultRichMenuOf(A)!;
    expect(menu.areas.length).toBe(6);
    expect(new Set(menu.areas.map((a) => a.action.uri)).size).toBe(6);
    expect(menu.areas[0]!.action.uri).toBe(`https://liff.line.me/${LIFF}/book`);
    expect(calls).toEqual(['create', `upload:${menu.richMenuId}:true`, `default:${menu.richMenuId}`]);
    expect(await menus()).toEqual([{ status: 'active', line_rich_menu_id: menu.richMenuId, error: null }]);
  });

  it('a rebuild after a label change replaces the old menu: superseded here and deleted at LINE', async () => {
    await build();
    const first = line.defaultRichMenuOf(A)!.richMenuId;
    await tdb.query(`insert into public.rich_menu_label (club_id, tile, label_th, label_en) values ($1, 4, 'แพ็กเกจของฉัน', 'My packages')`, [A]);
    calls = [];
    expect(await build()).toMatchObject({ outcome: 'active' });
    const second = line.defaultRichMenuOf(A)!.richMenuId;
    expect(second).not.toBe(first);
    expect(calls.at(-1)).toBe(`delete:${first}`);
    expect((await menus()).map((m) => m.status).sort()).toEqual(['active', 'superseded']);
  });

  it('a failed upload leaves the old menu the default, marks the new row failed, and the club stays Draft (LINE-02-AC8)', async () => {
    await build();
    const old = line.defaultRichMenuOf(A)!.richMenuId;
    await tdb.query(`insert into public.rich_menu_label (club_id, tile, label_th, label_en) values ($1, 2, 'คลาสเดี่ยว', 'Solo')`, [A]);
    failAt = 'upload';
    calls = [];
    expect(await build()).toMatchObject({ outcome: 'failed', code: 'http_413' });
    expect(line.defaultRichMenuOf(A)!.richMenuId).toBe(old);
    const rows = await menus();
    expect(rows.find((m) => m.status === 'active')!.line_rich_menu_id).toBe(old);
    expect(rows.find((m) => m.status === 'failed')).toMatchObject({ error: 'http_413' });
    expect(calls.some((c) => c.startsWith('delete:'))).toBe(true);   // the half-made menu at LINE is removed, not the old one
    expect(calls).not.toContain(`delete:${old}`);
    expect((await tdb.query(`select status from public.club where id = $1`, [A])).rows[0].status).toBe('draft');
  });

  it('a failure to make the default also keeps the old menu', async () => {
    await build();
    const old = line.defaultRichMenuOf(A)!.richMenuId;
    await tdb.query(`insert into public.rich_menu_label (club_id, tile, label_th, label_en) values ($1, 2, 'คลาสเดี่ยว', 'Solo')`, [A]);
    failAt = 'default';
    expect(await build()).toMatchObject({ outcome: 'failed', code: 'http_500' });
    expect(line.defaultRichMenuOf(A)!.richMenuId).toBe(old);
  });

  it('the same labels are not built again unless forced (Redo); the hashes tell (D92)', async () => {
    await build();
    calls = [];
    expect(await build()).toMatchObject({ outcome: 'unchanged' });
    expect(calls).toEqual([]);
    expect(await build({ force: true })).toMatchObject({ outcome: 'active' });
    expect(calls[0]).toBe('create');
  });

  it('no LIFF app or no token: failed with a code, nothing sent to LINE', async () => {
    await tdb.query(`update public.line_connection set liff_id = null where club_id = $1`, [A]);
    expect(await build()).toMatchObject({ outcome: 'failed', code: 'rich_menu_no_liff' });
    await tdb.query(`update public.line_connection set liff_id = $2 where club_id = $1`, [A, LIFF]);
    expect(await buildRichMenu(worker, { api: fakeApi(), dictionary, readToken: async () => null }, A, { force: false })).toMatchObject({ outcome: 'failed', code: 'no_token' });
    expect(calls).toEqual([]);
  });

  it('each call writes an audit row with its outcome (PLAT-04)', async () => {
    await build();
    await build();
    failAt = 'create';
    await build({ force: true });
    expect((await notes()).map((n) => [n.action, n.detail?.code ?? null])).toEqual([
      ['rich_menu.built', null], ['rich_menu.unchanged', null], ['rich_menu.build_failed', 'http_400'],
    ]);
  });
});

describe('the rich_menu_build task', () => {
  it('builds the club in the payload; refuses a payload without a valid club id', async () => {
    const { richMenuBuildTask } = await import('./line-rich-menu');
    const task = richMenuBuildTask(worker, { api: fakeApi(), dictionary, readToken: async () => TOKEN });
    await task({ clubId: A, force: false });
    expect(line.defaultRichMenuOf(A)).toBeDefined();
    await expect(task({ clubId: 'nope' })).rejects.toThrow(/valid club id/);
    await expect(task(null)).rejects.toThrow(/valid club id/);
  });
});

describe('rich menu build requests (D176): polled on the outbox sender tick', () => {
  const deps = () => ({ api: fakeApi(), dictionary, readToken: async () => TOKEN });
  const request = (force = false) => tdb.query(`insert into public.rich_menu_request (club_id, force) values ($1, $2)`, [A, force]);

  it('a waiting request is taken and built once; no request, nothing is called', async () => {
    expect(await runRichMenuRequests(worker, deps())).toMatchObject({ clubs: 0 });
    expect(calls).toEqual([]);
    await request();
    expect(await runRichMenuRequests(worker, deps())).toMatchObject({ clubs: 1, active: 1 });
    expect(line.defaultRichMenuOf(A)).toBeDefined();
    expect((await tdb.query(`select count(*)::int as n from public.rich_menu_request`)).rows[0].n).toBe(0);
    calls = [];
    expect(await runRichMenuRequests(worker, deps())).toMatchObject({ clubs: 0 });
    expect(calls).toEqual([]);
  });

  it('the same labels again: unchanged unless the request is forced (Redo)', async () => {
    await request();
    await runRichMenuRequests(worker, deps());
    await request();
    expect(await runRichMenuRequests(worker, deps())).toMatchObject({ unchanged: 1 });
    await request(true);
    expect(await runRichMenuRequests(worker, deps())).toMatchObject({ active: 1 });
  });

  it('a failed build is a result on the row, and the request is gone (the owner sees the failure in A16)', async () => {
    failAt = 'upload';
    await request();
    expect(await runRichMenuRequests(worker, deps())).toMatchObject({ failed: 1, errors: 0 });
    expect((await menus()).map((m) => m.status)).toEqual(['failed']);
  });
});
