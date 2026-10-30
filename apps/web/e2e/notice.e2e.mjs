// D152 privacy and terms page shells; AUTH-02-AC8 (the C1 and C2 links land here).
// Run: node --test --test-concurrency=1 'apps/web/e2e/*.e2e.mjs'  (one next dev at a time; Chromium is pre-installed).
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { join } from 'node:path';
import { chromium, openPage, SHOTS, startApp } from './harness.mjs';

let app;
let browser;
before(async () => {
  app = await startApp(3109);
  browser = await chromium.launch();
});
after(async () => {
  await browser?.close();
  app?.stop();
});

describe('privacy and terms (D152)', () => {
  it('the C1 privacy link opens the club privacy page, which says no version is published yet', async () => {
    const { page, context } = await openPage(browser, { liff: { inClient: false, loggedIn: false, idToken: 't', language: 'th' }, lang: 'th' });
    await page.goto(`${app.base}/c/hunter/sign-in?next=%2Fc%2Fhunter`);
    await page.getByRole('link', { name: 'ประกาศความเป็นส่วนตัว' }).click();
    await page.waitForURL((u) => u.pathname === '/c/hunter/privacy');
    await page.getByTestId('notice-unavailable').waitFor();
    assert.match(await page.locator('h1').innerText(), /ประกาศความเป็นส่วนตัว/);
    await page.screenshot({ path: join(SHOTS, 'privacy-unavailable-th.png') });
    await context.close();
  });

  it('the terms page loads for a guest in English', async () => {
    const { page, context, calls } = await openPage(browser, { lang: 'en' });
    await page.goto(`${app.base}/c/hunter/terms`);
    await page.getByTestId('notice-unavailable').waitFor();
    assert.equal(await page.locator('h1').innerText(), 'Terms');
    assert.deepEqual(calls.filter((c) => c.method !== 'GET'), []);
    await context.close();
  });
});
