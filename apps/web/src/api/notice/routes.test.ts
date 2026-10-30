import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createDb, type Db } from '@booq/db';
import { createTestDatabase, type TestDatabase } from '@booq/db/testing';
import { noticeRoutes } from './routes';

// D152 GET /public/notice/:kind: a guest reads the current privacy notice or terms of the club in the path.
const A = '3f2b8f0e-7c1d-4a55-9d0a-1c2e3f4a5b6c';
const B = '4a2b8f0e-7c1d-4a55-9d0a-1c2e3f4a5b6d';
const deps = { hasFeature: async () => true };
let tdb: TestDatabase;
let db: Db;
const clubs: Record<string, string> = { a: A, b: B };
const get = (input: Record<string, unknown>) => noticeRoutes({ db, clubBySlug: async (s) => (clubs[s] ? { clubId: clubs[s]! } : null) })[0]!.handle({ session: null, input }, deps);

beforeEach(async () => {
  tdb = await createTestDatabase();
  await tdb.query(`insert into public.club (id, slug, name_th, name_en) values ($1,'a','ฮันเตอร์','Hunter'), ($2,'b','บี','Bee')`, [A, B]);
  db = createDb({ connectionString: tdb.url, max: 2 });
});
afterEach(async () => {
  await db.end();
  await tdb.close();
});

describe('GET /public/notice/:kind', () => {
  it('is public and declared once', () => {
    const r = noticeRoutes({ db, clubBySlug: async () => null });
    expect(r.map((x) => `${x.def.method} ${x.def.path} ${x.def.public}`)).toEqual(['GET /public/notice/:kind true']);
  });

  it('with nothing published answers no_notice', async () => {
    expect(await get({ slug: 'a', kind: 'privacy', lang: 'th' })).toEqual({ ok: false, status: 404, code: 'no_notice' });
  });

  it('answers the current release for the club in the path and language, with the club name filled', async () => {
    await tdb.seedNotice();
    // A second release (texts are append-only) whose English privacy text names the club fields.
    await tdb.query(`insert into platform.legal_release (seq, published_by) select 2, published_by from platform.legal_release where seq = 1`);
    for (const [kind, lang] of [['privacy', 'th'], ['privacy', 'en'], ['terms', 'th'], ['terms', 'en']]) {
      const named = kind === 'privacy' && lang === 'en';
      await tdb.query(`insert into platform.legal_text (seq, kind, language, title, body) values (2, $1, $2, $3, $4)`, [kind, lang, named ? 'Notice of {clubName}' : 't', named ? 'Controller {legalName}.' : 'b']);
    }
    expect(await get({ slug: 'a', kind: 'privacy', lang: 'en' })).toMatchObject({ ok: true, body: { version: 'v2', language: 'en', title: 'Notice of Hunter', body: 'Controller Hunter.' } });
    const only = (await get({ slug: 'a', kind: 'privacy', lang: 'en' })) as { body: Record<string, unknown> };
    expect(Object.keys(only.body).sort()).toEqual(['body', 'language', 'title', 'version']);
    expect(await get({ slug: 'b', kind: 'privacy', lang: 'en' })).toMatchObject({ ok: true, body: { title: 'Notice of Bee' } });
    expect(await get({ slug: 'a', kind: 'terms', lang: 'th' })).toMatchObject({ ok: true, body: { version: 'v2', language: 'th' } });
  });

  it('refuses an unknown club, kind or language', async () => {
    await tdb.seedNotice();
    expect(await get({ slug: 'zz', kind: 'privacy', lang: 'en' })).toEqual({ ok: false, status: 404, code: 'not_found' });
    expect(await get({ slug: 'a', kind: 'cookies', lang: 'en' })).toEqual({ ok: false, status: 404, code: 'not_found' });
    expect(await get({ slug: 'a', kind: 'privacy', lang: 'fr' })).toEqual({ ok: false, status: 400, code: 'bad_input' });
  });
});
