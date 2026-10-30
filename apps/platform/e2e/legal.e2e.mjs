// F01 console: the privacy notice and terms (D152): what is published, publishing a new version. D161.
// Run: node --test --test-concurrency=1 'apps/platform/e2e/*.e2e.mjs'  (one next dev at a time; Chromium is pre-installed).
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { join } from 'node:path';
import { chromium, openPage, SHOTS, startApp } from './harness.mjs';

let app;
let browser;
before(async () => {
  app = await startApp(3123);
  browser = await chromium.launch();
});
after(async () => {
  await browser?.close();
  app?.stop();
});

const texts = (tag = 'one') => ({
  privacy: { th: { title: `นโยบาย ${tag}`, body: 'ข้อมูล {legalName}' }, en: { title: `Privacy ${tag}`, body: 'Data held by {legalName} for {clubName}' } },
  terms: { th: { title: `ข้อตกลง ${tag}`, body: 'ข้อความ' }, en: { title: `Terms ${tag}`, body: 'Text' } },
});
const RELEASES = [{ version: 'v2', publishedAt: '2026-12-29T17:05:00.000Z', publishedBy: 'Ada Admin' }, { version: 'v1', publishedAt: '2026-12-01T03:00:00.000Z', publishedBy: 'Ada Admin' }];
const api = ({ role = 'platform_admin', view = { releases: RELEASES, current: { version: 'v2', texts: texts('two') } }, over = {} } = {}) => (method, path, body) => {
  const key = `${method} ${path}`;
  if (over[key]) return typeof over[key] === 'function' ? over[key](body) : over[key];
  if (key === 'GET /auth/me') return { status: 200, body: { id: 'a1', role, displayName: 'Ada', stepUpFresh: true } };
  if (key === 'GET /legal') return { status: 200, body: view };
  if (key === 'POST /legal/releases') return { status: 200, body: { version: 'v3' } };
  return { status: 404, body: { code: 'not_found' } };
};
const fill = async (page, kind, lang, title, body) => {
  await page.locator(`#${kind}-${lang}-title`).fill(title);
  await page.locator(`#${kind}-${lang}-body`).fill(body);
};

describe('the privacy notice and terms', () => {
  it('shows the current version and when it was published (Bangkok time), earlier versions, and the form filled from the current texts', async () => {
    const { page, context } = await openPage(browser, api(), { width: 1024, height: 900 });
    await page.goto(`${app.base}/legal`);
    await page.getByTestId('legal-form').waitFor();
    assert.equal(await page.locator('h1').innerText(), 'Privacy notice and terms');
    assert.equal(await page.getByTestId('current').innerText(), 'Current version: v2, published 30 December 2026, 00:05.');
    await page.locator('summary').click();
    assert.match(await page.getByTestId('history').innerText(), /v1 · 1 December 2026, 10:00 · Ada Admin/);
    assert.equal(await page.locator('#privacy-en-title').inputValue(), 'Privacy two');
    assert.equal(await page.locator('#terms-th-title').inputValue(), 'ข้อตกลง two');
    assert.equal(await page.locator('#privacy-th-body').getAttribute('lang'), 'th', 'a Thai field is marked as Thai for screen readers');
    assert.match(await page.locator('main').innerText(), /\{clubName\} and \{legalName\} are filled in for each club/);
    await page.screenshot({ path: join(SHOTS, 'legal.png'), fullPage: true });
    await context.close();
  });

  it('with nothing published it says that nobody can sign up yet and starts from empty fields', async () => {
    const { page, context } = await openPage(browser, api({ view: { releases: [], current: null } }), { width: 1024, height: 900 });
    await page.goto(`${app.base}/legal`);
    await page.getByTestId('none').waitFor();
    assert.match(await page.getByTestId('none').innerText(), /No one can sign up, and a club cannot move from Draft to Testing/);
    assert.equal(await page.locator('#privacy-en-title').inputValue(), '');
    await context.close();
  });

  it('publishing asks first, sends all eight texts as typed, and shows the new version', async () => {
    let published = false;
    const over = { 'POST /legal/releases': () => ((published = true), { status: 200, body: { version: 'v3' } }), 'GET /legal': () => ({ status: 200, body: published ? { releases: [{ version: 'v3', publishedAt: '2026-12-30T03:00:00.000Z', publishedBy: 'Ada Admin' }, ...RELEASES], current: { version: 'v3', texts: texts('three') } } : { releases: RELEASES, current: { version: 'v2', texts: texts('two') } } }) };
    const { page, context, calls } = await openPage(browser, api({ over }), { width: 1024, height: 900 });
    const asked = [];
    page.on('dialog', (d) => { asked.push(d.message()); void d.accept(); });
    await page.goto(`${app.base}/legal`);
    await page.getByTestId('legal-form').waitFor();
    await fill(page, 'privacy', 'th', 'นโยบายใหม่', 'ข้อมูลใหม่ {legalName}');
    await page.getByTestId('publish').click();
    await page.getByTestId('message').waitFor();
    assert.equal(await page.getByTestId('message').innerText(), 'Version v3 was published.');
    assert.deepEqual(asked, ['Publish this as the new version? A published version cannot be changed or deleted.']);
    const sent = calls.find((c) => c.method === 'POST').body.texts;
    assert.equal(sent.privacy.th.title, 'นโยบายใหม่');
    assert.equal(sent.privacy.en.title, 'Privacy two');
    assert.deepEqual(Object.keys(sent).sort(), ['privacy', 'terms']);
    await page.getByTestId('current').filter({ hasText: 'Current version: v3' }).waitFor();
    await context.close();
  });

  it('declining the confirmation sends nothing', async () => {
    const { page, context, calls } = await openPage(browser, api(), { width: 1024, height: 900 });
    page.on('dialog', (d) => void d.dismiss());
    await page.goto(`${app.base}/legal`);
    await page.getByTestId('publish').click();
    assert.equal(calls.filter((c) => c.method === 'POST').length, 0);
    await context.close();
  });

  it('an empty field and a {field} that is not filled in are refused before anything is sent, naming the field', async () => {
    const { page, context, calls } = await openPage(browser, api({ view: { releases: [], current: null } }), { width: 1024, height: 900 });
    page.on('dialog', (d) => void d.accept());
    await page.goto(`${app.base}/legal`);
    await page.getByTestId('legal-form').waitFor();
    await page.getByTestId('publish').click();
    assert.equal(await page.getByTestId('message').innerText(), 'This is empty: Privacy notice, Thai, Title.');
    for (const [k, l] of [['privacy', 'th'], ['privacy', 'en'], ['terms', 'th'], ['terms', 'en']]) await fill(page, k, l, `Title ${k} ${l}`, `Body ${k} ${l}`);
    await page.locator('#terms-en-body').fill('Hello {playerName}');
    await page.getByTestId('publish').click();
    assert.equal(await page.getByTestId('message').innerText(), 'Only {clubName} and {legalName} can be used in the text. Found: {playerName}.');
    assert.equal(calls.filter((c) => c.method === 'POST').length, 0);
    await context.close();
  });

  it('the API refusing the texts is told in words', async () => {
    const over = { 'POST /legal/releases': { status: 400, body: { code: 'invalid', reason: 'invalid_texts' } } };
    const { page, context } = await openPage(browser, api({ over }), { width: 1024, height: 900 });
    page.on('dialog', (d) => void d.accept());
    await page.goto(`${app.base}/legal`);
    await page.getByTestId('publish').click();
    await page.getByTestId('message').waitFor();
    assert.equal(await page.getByTestId('message').innerText(), 'The texts were not accepted. Check every field.');
    await context.close();
  });

  it('a stale second factor opens the step-up and then the same publish runs again, without asking twice', async () => {
    let fresh = false;
    const over = {
      'POST /auth/step-up': () => ((fresh = true), { status: 200, body: { ok: true } }),
      'POST /legal/releases': () => (fresh ? { status: 200, body: { version: 'v3' } } : { status: 403, body: { code: 'step_up_required' } }),
    };
    const { page, context, calls } = await openPage(browser, api({ over }), { width: 1024, height: 900 });
    let dialogs = 0;
    page.on('dialog', (d) => { dialogs += 1; void d.accept(); });
    await page.goto(`${app.base}/legal`);
    await page.getByTestId('publish').click();
    await page.getByTestId('step-up').waitFor();
    await page.locator('#stepup-password').fill('pw');
    await page.locator('#stepup-code').fill('123456');
    await page.getByTestId('step-up-submit').click();
    await page.getByTestId('message').filter({ hasText: 'Version v3 was published.' }).waitFor();
    assert.equal(dialogs, 1);
    assert.equal(calls.filter((c) => c.path === '/legal/releases').length, 2);
    await context.close();
  });

  it('a specialist reads the texts but cannot publish', async () => {
    const { page, context } = await openPage(browser, api({ role: 'onboarding_specialist' }), { width: 1024, height: 900 });
    await page.goto(`${app.base}/legal`);
    await page.getByTestId('admin-only').waitFor();
    assert.equal(await page.getByTestId('publish').count(), 0);
    assert.equal(await page.locator('#privacy-en-title').getAttribute('readonly'), '');
    await context.close();
  });

  it('no session offers the sign-in; an outage says so', async () => {
    const out = await openPage(browser, () => ({ status: 401, body: { code: 'unauthenticated' } }));
    await out.page.goto(`${app.base}/legal`);
    assert.equal(await out.page.getByTestId('sign-in-link').getAttribute('href'), '/sign-in?next=/legal');
    await out.context.close();
    const down = await openPage(browser, () => 'offline');
    await down.page.goto(`${app.base}/legal`);
    await down.page.getByTestId('load-error').waitFor();
    await down.context.close();
  });

  it('fits 320 px with very long Thai and English texts: nothing scrolls sideways', async () => {
    const long = 'ข้อความที่ยาวมากมายเหลือเกินและไม่มีช่องว่างให้ตัดบรรทัดเลยสักนิดเดียวจริงๆ'.repeat(6);
    const view = { releases: RELEASES, current: { version: 'v2', texts: { ...texts('two'), privacy: { th: { title: long, body: long }, en: { title: 'A'.repeat(200), body: 'B'.repeat(400) } } } } };
    const { page, context } = await openPage(browser, api({ view }), { width: 320, height: 640 });
    await page.goto(`${app.base}/legal`);
    await page.getByTestId('legal-form').waitFor();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    assert.ok(overflow <= 0, `page scrolls sideways by ${overflow}px`);
    assert.ok((await page.getByTestId('publish').boundingBox()).height < 60, 'the button is one line');
    await page.screenshot({ path: join(SHOTS, 'legal-320.png'), fullPage: true });
    await context.close();
  });
});
