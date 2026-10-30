import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createDb, type Db } from './tx';
import { createPlatformDb, type PlatformDb } from './platform-tx';
import { createTestDatabase, type TestDatabase } from './testing/harness';

// D152 / migration 0048: the privacy notice and terms, versioned (docs/architecture/legal-notice.md).
const A = '3f2b8f0e-7c1d-4a55-9d0a-1c2e3f4a5b6c';
let tdb: TestDatabase;
let web: Db;
let pdb: PlatformDb;
let admin: string;
let spec: string;

const texts = (marker = 'x', extra = '') => ({
  privacy: { th: { title: `นโยบาย {clubName} ${marker}`, body: `ผู้ควบคุม {legalName} ${extra}` }, en: { title: `Privacy {clubName} ${marker}`, body: `Controller {legalName} ${extra}` } },
  terms: { th: { title: `ข้อกำหนด ${marker}`, body: `เนื้อหา ${extra}` }, en: { title: `Terms ${marker}`, body: `Body ${extra}` } },
});
const publish = (who: string, t: unknown) =>
  pdb.withPlatformTx({ staffId: who, staffLabel: 'Staff' }, async (tx) => (await tx.query(`select platform.publish_legal_release($1::jsonb) as v`, [JSON.stringify(t)])).rows[0]?.v as string);
const ctx = (club = A) => ({ clubId: club, userId: null, roles: ['guest'] as never, source: 'player_app' as const });
const render = (kind: string, lang: string, club = A) => web.withClubTx(ctx(club), async (tx) => (await tx.query(`select app.render_notice($1, $2) as r`, [kind, lang])).rows[0]?.r);
const config = () => web.withClubTx(ctx(), async (tx) => (await tx.query(`select notice_version from public.public_club_config`)).rows[0]);

beforeEach(async () => {
  tdb = await createTestDatabase();
  await tdb.query(`insert into public.club (id, slug, name_th, name_en, legal_name) values ($1, 'a', 'ฮันเตอร์', 'Hunter', 'ทีที รีครีเอชั่น จำกัด')`, [A]);
  admin = (await tdb.query(`insert into platform.platform_staff (auth_user_id, email, display_name, role) values ('99999999-0000-4000-8000-000000000001', 'admin@booq.example', 'Ada', 'platform_admin') returning id`)).rows[0].id;
  spec = (await tdb.query(`insert into platform.platform_staff (auth_user_id, email, display_name, role) values ('99999999-0000-4000-8000-000000000002', 'spec@booq.example', 'Sam', 'onboarding_specialist') returning id`)).rows[0].id;
  web = createDb({ connectionString: tdb.url, max: 2 });
  pdb = createPlatformDb({ connectionString: tdb.url, max: 2 });
});
afterEach(async () => {
  await web.end();
  await pdb.end();
  await tdb.close();
});

describe('publishing', () => {
  it('a platform admin publishes v1, then v2; the current version is the latest', async () => {
    expect(await publish(admin, texts('a'))).toBe('v1');
    expect(await publish(admin, texts('b'))).toBe('v2');
    expect((await tdb.query(`select app.current_notice_version() as v`)).rows[0].v).toBe('v2');
    expect((await tdb.query(`select count(*)::int as n from platform.legal_text`)).rows[0].n).toBe(8);
  });

  it('only an admin may publish', async () => {
    await expect(publish(spec, texts())).rejects.toThrow(/not_allowed/);
    expect((await tdb.query(`select count(*)::int as n from platform.legal_release`)).rows[0].n).toBe(0);
  });

  it('all four texts are required and nothing is left behind when one is missing', async () => {
    const t = texts();
    delete (t.terms as Record<string, unknown>).en;
    await expect(publish(admin, t)).rejects.toThrow(/missing_text:terms:en/);
    const blank = texts();
    blank.privacy.th.body = '   ';
    await expect(publish(admin, blank)).rejects.toThrow(/missing_text:privacy:th/);
    expect((await tdb.query(`select count(*)::int as n from platform.legal_release`)).rows[0].n).toBe(0);
  });

  it('only the two club fields are allowed; a typo is refused', async () => {
    await expect(publish(admin, texts('x', '{clubname}'))).rejects.toThrow(/unknown_field:clubname/);
    await expect(publish(admin, texts('x', '{address}'))).rejects.toThrow(/unknown_field:address/);
  });

  it('writes a P6 entry with the version and a hash per text, never the text', async () => {
    await publish(admin, texts('secretword'));
    const r = (await tdb.query(`select action, detail from platform.audit_log where action = 'legal.release_published'`)).rows;
    expect(r).toHaveLength(1);
    expect(Object.keys(r[0].detail).sort()).toEqual(['privacy_en_sha256', 'privacy_th_sha256', 'terms_en_sha256', 'terms_th_sha256', 'version']);
    expect(JSON.stringify(r[0])).not.toContain('secretword');
  });

  it('releases are append-only', async () => {
    await publish(admin, texts());
    await expect(tdb.query(`update platform.legal_text set body = 'changed'`)).rejects.toThrow();
    await expect(tdb.query(`delete from platform.legal_release`)).rejects.toThrow();
    await expect(tdb.query(`truncate platform.legal_text`)).rejects.toThrow();
  });
});

describe('reading', () => {
  it('nothing is published: no version, no text', async () => {
    expect((await tdb.query(`select app.current_notice_version() as v`)).rows[0].v).toBeNull();
    expect(await render('privacy', 'en')).toBeNull();
    expect(await config()).toEqual({ notice_version: null });
  });

  it('public_club_config carries the current version', async () => {
    await publish(admin, texts());
    expect(await config()).toEqual({ notice_version: 'v1' });
  });

  it('renders the current text with the club name in the page language and the legal name', async () => {
    await publish(admin, texts('a'));
    await publish(admin, texts('b'));
    expect(await render('privacy', 'th')).toEqual({ version: 'v2', language: 'th', title: 'นโยบาย ฮันเตอร์ b', body: 'ผู้ควบคุม ทีที รีครีเอชั่น จำกัด ' });
    expect(await render('privacy', 'en')).toMatchObject({ title: 'Privacy Hunter b', body: 'Controller ทีที รีครีเอชั่น จำกัด ' });
    expect(await render('terms', 'en')).toMatchObject({ version: 'v2', title: 'Terms b' });
  });

  it('a club without a legal name falls back to its own name; an unknown kind or language gives nothing', async () => {
    await tdb.query(`insert into public.club (id, slug, name_th, name_en) values ('9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d', 'b', 'ข', 'B')`);
    await publish(admin, texts());
    expect(await render('privacy', 'en', '9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d')).toMatchObject({ title: 'Privacy B x', body: 'Controller B ' });
    expect(await render('cookies', 'en')).toBeNull();
    expect(await render('privacy', 'fr')).toBeNull();
  });

  it('exposes the legal name through the function only: a guest still cannot read the column', async () => {
    await publish(admin, texts());
    await expect(web.withClubTx(ctx(), async (tx) => tx.query(`select legal_name from public.club`))).rejects.toThrow(/permission denied/);
    await expect(web.withClubTx(ctx(), async (tx) => tx.query(`select * from platform.legal_text`))).rejects.toThrow(/permission denied/);
  });
});

describe('Draft to Testing', () => {
  it('has a setup step legal_notice, done once a release exists', async () => {
    const owed = async () => (await tdb.query(`select app.setup_step_done(check_fn, $1) as ok from app.setup_steps where step_key = 'legal_notice'`, [A])).rows[0].ok;
    expect(await owed()).toBe(false);
    await publish(admin, texts());
    expect(await owed()).toBe(true);
  });
});
