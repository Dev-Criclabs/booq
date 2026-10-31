import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createAdminService } from './admin';
import { adminRoutes } from './routes';
import { createHarness, type Harness } from '../http/testkit';

// Admin routes over HTTP: recorded launch checks (0046), config (0046), the legal notice (0048).
const CLUB = '3f2b8f0e-7c1d-4a55-9d0a-1c2e3f4a5b6c';
let h: Harness;

const TEXTS = {
  privacy: { th: { title: 'นโยบาย {clubName}', body: 'ข้อมูล {legalName}' }, en: { title: 'Privacy {clubName}', body: 'Data {legalName}' } },
  terms: { th: { title: 'ข้อตกลง', body: 'ข้อความ' }, en: { title: 'Terms', body: 'Text' } },
};
const audit = async (action: string) => (await h.tdb.query(`select action, club_id from platform.audit_log where action = $1`, [action])).rows;

beforeEach(async () => {
  h = await createHarness((pdb) => adminRoutes({ admin: createAdminService({ db: pdb }) }));
  await h.tdb.query(`insert into public.club (id, slug, name_th, name_en, status) values ($1,'a','ก','A','testing')`, [CLUB]);
  await h.tdb.query(`insert into platform.staff_assignment (staff_id, club_id) values ($1,$2)`, [h.ids.spec, CLUB]);
});
afterEach(async () => h.close());

describe('recorded launch checks', () => {
  const put = (key: string, body: unknown, init: { as?: 'admin' | 'spec' | 'loner' | null; fresh?: boolean } = {}) =>
    h.call('PUT', `/clubs/${CLUB}/launch/${key}`, { body, as: 'admin', ...init });
  it('an admin records a result on a Testing club and it is written to P6', async () => {
    const r = await put('product_priced', { result: 'pass' });
    expect([r.status, r.body]).toEqual([200, {}]);
    expect((await h.tdb.query(`select result from platform.launch_check where club_id = $1 and check_key = 'product_priced'`, [CLUB])).rows).toEqual([{ result: 'pass' }]);
    expect(await audit('launch_check.recorded')).toHaveLength(1);
  });
  it('a specialist is refused 403, a guest 401, and a stale second factor 403 step_up_required', async () => {
    expect((await put('product_priced', { result: 'pass' }, { as: 'spec' })).status).toBe(403);
    expect((await put('product_priced', { result: 'pass' }, { as: null })).status).toBe(401);
    expect((await put('product_priced', { result: 'pass' }, { fresh: false })).body).toEqual({ code: 'step_up_required' });
    expect((await h.tdb.query(`select count(*)::int as n from platform.launch_check`)).rows[0].n).toBe(0);
  });
  it('a check that is derived, a bad result, an extra field or a Live club is refused', async () => {
    expect((await put('receipt_prefix_set', { result: 'pass' })).body).toEqual({ code: 'not_recorded' });
    expect((await put('product_priced', { result: 'maybe' })).body).toEqual({ code: 'invalid' });
    expect((await put('product_priced', { result: 'pass', checkedBy: 'x' })).status).toBe(400);
    await h.tdb.query(`update public.club set status = 'live' where id = $1`, [CLUB]);
    expect((await put('product_priced', { result: 'pass' })).body).toEqual({ code: 'not_testing' });
  });
  it('an unknown club or a malformed id is 404', async () => {
    expect((await h.call('PUT', `/clubs/99999999-9999-4999-8999-999999999999/launch/product_priced`, { body: { result: 'pass' }, as: 'admin' })).status).toBe(404);
    expect((await h.call('PUT', `/clubs/nope/launch/product_priced`, { body: { result: 'pass' }, as: 'admin' })).status).toBe(404);
  });
});

describe('the launch overview', () => {
  const get = (as: 'admin' | 'spec' | 'loner' | null) => h.call('GET', `/clubs/${CLUB}/launch`, { as });
  it('lists the required checks with their results and which are recorded by hand', async () => {
    await h.tdb.query(`update platform.config set value = $1::jsonb where key = 'required_launch_checks'`, [JSON.stringify([{ key: 'receipt_prefix_set', owed_by: 'booq' }, { key: 'product_priced', owed_by: 'owner' }])]);
    await h.call('PUT', `/clubs/${CLUB}/launch/product_priced`, { body: { result: 'pass' }, as: 'admin' });
    const r = await get('spec');
    expect(r.status).toBe(200);
    expect(r.body.clubStatus).toBe('testing');
    expect(r.body.clubName).toBe('A');
    expect(r.body.items).toEqual([
      { item: 'receipt_prefix_set', result: expect.any(String), owed_by: 'booq', recorded: false },
      { item: 'product_priced', result: 'pass', owed_by: 'owner', recorded: true },
    ]);
  });
  it('the list shipped with the migrations names the recorded checks; an unassigned specialist and an unknown club are 404, a guest 401', async () => {
    expect((await get('loner')).status).toBe(404);
    expect((await get(null)).status).toBe(401);
    expect((await h.call('GET', '/clubs/99999999-9999-4999-8999-999999999999/launch', { as: 'admin' })).status).toBe(404);
    const shipped = (await get('admin')).body.items as Array<{ item: string; recorded: boolean }>;
    expect(shipped.filter((i) => i.recorded).map((i) => i.item).sort()).toEqual(['beam_key_swap', 'owner_signed_in', 'owner_verified', 'product_priced', 'test_booking_completed']);
  });
});

describe('config', () => {
  it('any staff member reads the values that are set, in key order; a guest does not', async () => {
    await h.call('PUT', '/config/pay_tap_limit_count', { body: { value: 5 }, as: 'admin' });
    const r = await h.call('GET', '/config', { as: 'spec' });
    expect(r.status).toBe(200);
    const keys = (r.body.config as Array<{ key: string }>).map((c) => c.key);
    expect(keys).toEqual([...keys].sort());
    expect(r.body.config).toContainEqual({ key: 'pay_tap_limit_count', value: 5 });
    expect((await h.call('GET', '/config', { as: null })).status).toBe(401);
  });
  it('an admin sets a value and it is audited; a number key must be above zero', async () => {
    expect((await h.call('PUT', '/config/tester_invite_ttl_hours', { body: { value: 48 }, as: 'admin' })).status).toBe(200);
    expect((await h.tdb.query(`select value from platform.config where key = 'tester_invite_ttl_hours'`)).rows[0].value).toBe(48);
    expect(await audit('config.changed')).toHaveLength(1);
    expect((await h.call('PUT', '/config/tester_invite_ttl_hours', { body: { value: 0 }, as: 'admin' })).body).toEqual({ code: 'invalid' });
    expect((await h.call('PUT', '/config/tester_invite_ttl_hours', { body: { value: null }, as: 'admin' })).status).toBe(400);
  });
  it('the Message BOOQ address must be an http or https address (D178)', async () => {
    for (const bad of ['line', 'ftp://x.test/a', 42, '']) expect((await h.call('PUT', '/config/booq_support_line_url', { body: { value: bad }, as: 'admin' })).body, String(bad)).toEqual({ code: 'invalid' });
    expect((await h.call('PUT', '/config/booq_support_line_url', { body: { value: 'https://line.me/R/ti/p/@booq' }, as: 'admin' })).status).toBe(200);
    expect((await h.tdb.query(`select value from platform.config where key = 'booq_support_line_url'`)).rows[0].value).toBe('https://line.me/R/ti/p/@booq');
  });
  it('a specialist and a stale second factor are refused; a malformed key is 404', async () => {
    expect((await h.call('PUT', '/config/invite_ttl_hours', { body: { value: 1 }, as: 'spec' })).status).toBe(403);
    expect((await h.call('PUT', '/config/invite_ttl_hours', { body: { value: 1 }, as: 'admin', fresh: false })).body).toEqual({ code: 'step_up_required' });
    expect((await h.call('PUT', '/config/Bad Key', { body: { value: 1 }, as: 'admin' })).status).toBe(404);
  });
  it('the required launch checks list cannot name an unknown check', async () => {
    expect((await h.call('PUT', '/config/required_launch_checks', { body: { value: [{ key: 'nope', owed_by: 'booq' }] }, as: 'admin' })).body).toEqual({ code: 'invalid' });
  });
});

describe('legal notice', () => {
  it('lists the releases newest first with the texts of the newest, for any staff member; nothing published is an empty list', async () => {
    expect((await h.call('GET', '/legal', { as: 'spec' })).body).toEqual({ releases: [], current: null });
    await h.call('POST', '/legal/releases', { body: { texts: TEXTS }, as: 'admin' });
    const next = { ...TEXTS, terms: { ...TEXTS.terms, en: { title: 'Terms 2', body: 'Text 2' } } };
    await h.call('POST', '/legal/releases', { body: { texts: next }, as: 'admin' });
    const r = await h.call('GET', '/legal', { as: 'spec' });
    expect(r.status).toBe(200);
    expect(r.body.releases.map((x: { version: string }) => x.version)).toEqual(['v2', 'v1']);
    expect(r.body.releases[0].publishedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(r.body.current).toEqual({ version: 'v2', texts: next });
    expect((await h.call('GET', '/legal', { as: null })).status).toBe(401);
  });
  it('an admin publishes a release and gets its version; the next one is v2', async () => {
    const a = await h.call('POST', '/legal/releases', { body: { texts: TEXTS }, as: 'admin' });
    expect([a.status, a.body]).toEqual([200, { version: 'v1' }]);
    expect((await h.call('POST', '/legal/releases', { body: { texts: TEXTS }, as: 'admin' })).body).toEqual({ version: 'v2' });
    expect(await audit('legal.release_published')).toHaveLength(2);
  });
  it('a missing text and an unknown field say which, as values; nothing is published', async () => {
    const missing = { ...TEXTS, terms: { ...TEXTS.terms, en: { title: '', body: 'x' } } };
    expect((await h.call('POST', '/legal/releases', { body: { texts: missing }, as: 'admin' })).body).toEqual({ code: 'invalid', reason: 'missing_text', kind: 'terms', language: 'en' });
    const unknown = { ...TEXTS, privacy: { ...TEXTS.privacy, th: { title: 'a', body: '{secret}' } } };
    expect((await h.call('POST', '/legal/releases', { body: { texts: unknown }, as: 'admin' })).body).toEqual({ code: 'invalid', reason: 'unknown_field', field: 'secret' });
    expect((await h.tdb.query(`select count(*)::int as n from platform.legal_release`)).rows[0].n).toBe(0);
  });
  it('a specialist and a stale second factor are refused', async () => {
    expect((await h.call('POST', '/legal/releases', { body: { texts: TEXTS }, as: 'spec' })).status).toBe(403);
    expect((await h.call('POST', '/legal/releases', { body: { texts: TEXTS }, as: 'admin', fresh: false })).body).toEqual({ code: 'step_up_required' });
  });
});
