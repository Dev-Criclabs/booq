// F12-T13: K2 Schedule (CPORT-02; CC-5). Boards H-K2-Schedule and T-K2-Schedule.
// Run: node --test --test-concurrency=1 'apps/web/e2e/coach-k2.e2e.mjs'
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { join } from 'node:path';
import { chromium, openPage, SHOTS, startApp } from './harness.mjs';
import { coachFakes, weekItems } from './coach-fakes.mjs';

const liff = { inClient: false, loggedIn: true, idToken: 'id-token', language: 'th' };
const me = { profile: { fullName: 'Coach One', phone: '0812345678', dateOfBirth: null, level: null, language: 'th', priceGroup: 'adult' } };
let app;
let browser;
before(async () => {
  app = await startApp(3132);
  browser = await chromium.launch();
});
after(async () => {
  await browser?.close();
  app?.stop();
});
const open = (opts) => openPage(browser, { liff, me: { ...me }, ...opts });

describe('K2 Schedule', () => {
  it('CPORT-02: the week shows solo and group classes, the leave and the blocked times by day, with the counts', async () => {
    for (const lang of ['th', 'en']) {
      const { page, context } = await open({ lang, extra: coachFakes() });
      await page.goto(`${app.base}/c/hunter/coach/schedule`);
      await page.getByTestId('item').first().waitFor();
      const items = await page.getByTestId('item').evaluateAll((els) => els.map((e) => ({ kind: e.dataset.item === 'session' ? e.dataset.kind : e.dataset.item, text: e.textContent })));
      assert.deepEqual(items.map((i) => i.kind), ['solo', 'group', 'solo', 'leave', 'blocked', 'solo', 'group', 'blocked', 'leave'], lang);
      const days = await page.getByTestId('day').count();
      assert.equal(days, 6);
      const counts = await page.getByTestId('counts').textContent();
      assert.match(counts, lang === 'en' ? /3 solo.*2 group.*2 leave/ : /เดี่ยว 3.*กลุ่ม 2.*ลา 2/);
      assert.match(items[1].text, lang === 'en' ? /Adult beginner clinic · 4 of 6/ : /คลินิกมือใหม่ · 4 จาก 6/);
      assert.match(items[6].text, lang === 'en' ? /Adult beginner clinic · full/ : /คลินิกมือใหม่ · เต็ม/);
      assert.match(items[3].text, lang === 'en' ? /Afternoon off · Approved/ : /Afternoon off · อนุมัติแล้ว/);
      assert.match(items[4].text, lang === 'en' ? /Court 1 · maintenance · until 12:00/ : /Court 1 · maintenance · ถึง 12:00/);
      assert.match(items[7].text, lang === 'en' ? /Not available/ : /ไม่ว่าง/);
      assert.match(items[8].text, lang === 'en' ? /Waiting for the owner/ : /รอเจ้าของพิจารณา/);
      assert.equal(await page.locator('.coach-nav a[aria-current=page]').getAttribute('data-testid'), 'nav-schedule');
      await page.screenshot({ path: join(SHOTS, `K2-schedule-${lang}.png`), fullPage: false });
      await context.close();
    }
  });

  it('the week arrows ask for the week before and after, and the range names the month (or both months)', async () => {
    const asked = [];
    const { page, context } = await open({ lang: 'en', extra: coachFakes({ week: (from, to) => (asked.push([from, to]), weekItems(from)) }) });
    await page.goto(`${app.base}/c/hunter/coach/schedule`);
    await page.getByTestId('item').first().waitFor();
    const [from0] = asked[0];
    assert.equal(new Date(`${from0}T12:00:00Z`).getUTCDay(), 1, 'the week starts on a Monday');
    const first = await page.getByTestId('range').textContent();
    await page.getByTestId('next-week').click();
    await page.waitForFunction((was) => document.querySelector('[data-testid=range]').textContent !== was, first);
    const second = await page.getByTestId('range').textContent();
    const next = asked.at(-1);
    assert.equal(Date.parse(`${next[0]}T12:00:00Z`) - Date.parse(`${from0}T12:00:00Z`), 7 * 86400_000);
    assert.equal(Date.parse(`${next[1]}T12:00:00Z`) - Date.parse(`${next[0]}T12:00:00Z`), 6 * 86400_000);
    await page.getByTestId('prev-week').click();
    await page.getByTestId('prev-week').click();
    await page.waitForFunction((was) => document.querySelector('[data-testid=range]').textContent !== was, second);
    assert.equal(asked.at(-1)[0], new Date(Date.parse(`${from0}T12:00:00Z`) - 7 * 86400_000).toISOString().slice(0, 10));
    await context.close();
  });

  it('a week that crosses a month names both months; an empty week says so', async () => {
    const cross = await open({ lang: 'en', extra: coachFakes() });
    await cross.page.clock.install({ time: new Date('2026-12-30T05:00:00Z') });
    await cross.page.goto(`${app.base}/c/hunter/coach/schedule`);
    await cross.page.getByTestId('item').first().waitFor();
    assert.equal(await cross.page.getByTestId('range').textContent(), '28 December to 3 January');
    await cross.context.close();
    const empty = await open({ lang: 'en', extra: coachFakes({ week: () => [] }) });
    await empty.page.goto(`${app.base}/c/hunter/coach/schedule`);
    await empty.page.getByTestId('empty').waitFor();
    assert.match(await empty.page.getByTestId('counts').textContent(), /0 solo.*0 group.*0 leave/);
    await empty.context.close();
  });

  it('CC-5: at 320 px with the longest names nothing scrolls sideways and the bar stays on screen', async () => {
    for (const lang of ['th', 'en']) {
      const { page, context } = await open({ lang, width: 320, height: 568, extra: coachFakes({ week: (from) => weekItems(from, { long: true }) }) });
      await page.goto(`${app.base}/c/hunter/coach/schedule`);
      await page.getByTestId('item').first().waitFor();
      await page.evaluate(() => document.fonts.ready);
      const r = await page.evaluate(() => ({
        sideways: document.documentElement.scrollWidth > window.innerWidth,
        navBottom: document.querySelector('.coach-nav').getBoundingClientRect().bottom,
        height: window.innerHeight,
        itemsOverflow: [...document.querySelectorAll('.item')].some((e) => e.scrollWidth > e.clientWidth + 1),
        tagsWrap: [...document.querySelectorAll('.tag')].some((e) => e.getBoundingClientRect().height > 30),
      }));
      assert.equal(r.sideways, false, `${lang}: sideways`);
      assert.ok(r.navBottom <= r.height + 1, `${lang}: bar pushed off`);
      assert.equal(r.itemsOverflow, false, `${lang}: an item overflows`);
      assert.equal(r.tagsWrap, false, `${lang}: a tag wraps`);
      await page.screenshot({ path: join(SHOTS, `K2-schedule-${lang}-320.png`) });
      await context.close();
    }
  });
});
