// F03-T24 C4 schedule: BOOK-01-AC6, AC7, AC13, AC14; BOOK-02-AC4; CC-5.
// Run: node --test --test-concurrency=1 'apps/web/e2e/*.e2e.mjs'  (one next dev at a time; Chromium is pre-installed).
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { join } from 'node:path';
import { chromium, openPage, SHOTS, startApp } from './harness.mjs';

const TODAY = '2027-01-09';
const guest = { inClient: false, loggedIn: false, idToken: 't', language: 'th' };
const courts = [{ id: 'c1', name: '1', sport: 'tennis' }, { id: 'c2', name: '2', sport: 'tennis' }];
const info = (over = {}) => ({ status: 'live', today: TODAY, bookingWindowDays: 6, courts, openingHours: [], ...over });
const hour = (date, h, state = 'open', waitlist = false) => ({ start: `${date}T${String(h).padStart(2, '0')}:00:00+07:00`, state, waitlist });
// 16:00 to 24:00 on two courts, every state present on court 1.
const c1States = { 16: 'past', 17: 'taken', 18: 'held', 19: 'open', 20: 'open', 21: 'closed', 22: 'mine', 23: 'open' };
const normalDay = (date) => ({
  date,
  courts: [
    { ...courts[0], hours: Object.entries(c1States).map(([h, s]) => hour(date, Number(h), s, s === 'taken')) },
    { ...courts[1], hours: Object.keys(c1States).map((h) => hour(date, Number(h), Number(h) === 16 ? 'past' : 'open')) },
  ],
  dayFull: false,
  waitlist: false,
});
const fullDay = (date) => ({
  date,
  courts: courts.map((c) => ({ ...c, hours: Object.keys(c1States).map((h) => hour(date, Number(h), Number(h) >= 21 && c.id === 'c1' ? 'closed' : 'taken', !(Number(h) >= 21 && c.id === 'c1'))) })),
  dayFull: true,
  waitlist: true,
});
const days = Array.from({ length: 7 }, (_, i) => {
  const date = new Date(Date.parse(`${TODAY}T00:00:00Z`) + i * 86_400_000).toISOString().slice(0, 10);
  return { date, courts: courts.map((c) => ({ id: c.id, openHours: i === 0 ? 0 : 9 })), dayFull: i === 0, waitlist: i === 0 };
});
const schedule = (over = {}) => ({ courts: info(), days, dayFor: normalDay, ...over });

let app;
let browser;
before(async () => {
  app = await startApp(3113);
  browser = await chromium.launch();
});
after(async () => {
  await browser?.close();
  app?.stop();
});

describe('C4 schedule (F03-T24)', () => {
  it('BOOK-01-AC6: a guest sees the date strip from today to the window and both courts by the hour', async () => {
    const { page, context, calls } = await openPage(browser, { stubCheckout: true, liff: guest, lang: 'en', schedule: schedule() });
    await page.goto(`${app.base}/c/hunter/book`);
    await page.getByTestId('grid').waitFor();
    assert.deepEqual(await page.locator('.date-chip').evaluateAll((els) => els.map((e) => e.dataset.date)), days.map((d) => d.date));
    assert.deepEqual(await page.locator('.court-head').allInnerTexts(), ['Court 1', 'Court 2']);
    assert.equal(await page.locator('.time').count(), 8);
    assert.equal(calls.filter((c) => c.path.endsWith('/me/profile') || c.method !== 'GET').length, 0, 'no sign in, nothing created');
    await page.screenshot({ path: join(SHOTS, 'C4-schedule-en.png') });
    await context.close();
  });

  it('BOOK-01-AC7: every state is told apart without colour (word and icon), and only open hours can be chosen', async () => {
    const { page, context } = await openPage(browser, { stubCheckout: true, liff: guest, lang: 'th', schedule: schedule() });
    await page.goto(`${app.base}/c/hunter/book`);
    await page.getByTestId('grid').waitFor();
    // Turn colour off entirely: the states must still differ by text and icon shape.
    await page.addStyleTag({ content: '* { color: #000 !important; background: #fff !important; border-color: #000 !important; filter: grayscale(1) !important; }' });
    const cells = await page.locator('.grid [data-state]').evaluateAll((els) => els.map((e) => ({ state: e.dataset.state, text: e.querySelector('.slot-text').textContent, icon: e.querySelector('svg').innerHTML, button: e.tagName === 'BUTTON' })));
    const per = new Map(cells.map((c) => [c.state, c]));
    assert.deepEqual([...per.keys()].sort(), ['closed', 'held', 'mine', 'open', 'past', 'taken']);
    assert.equal(new Set([...per.values()].map((c) => c.text)).size, 6);
    assert.equal(new Set([...per.values()].map((c) => c.icon)).size, 6);
    for (const c of cells) assert.equal(c.button, c.state === 'open', `${c.state} must ${c.state === 'open' ? '' : 'not '}be a button`);
    await page.screenshot({ path: join(SHOTS, 'C4-schedule-th-no-colour.png') });
    await context.close();
  });

  it('selecting non-consecutive hours is not possible; Continue carries the chosen block to checkout', async () => {
    const { page, context } = await openPage(browser, { stubCheckout: true, liff: guest, lang: 'en', schedule: schedule() });
    await page.goto(`${app.base}/c/hunter/book`);
    await page.getByTestId('grid').waitFor();
    const cell = (court, h) => page.getByRole('button', { name: `Court ${court} · ${h}:00 ·` });
    await cell(2, 18).click();
    await cell(2, 19).click();
    await cell(2, 21).click(); // a gap: starts a new choice at 21:00
    assert.equal(await page.locator('[data-state=selected]').count(), 1);
    await cell(2, 20).click(); // next to 21: extends
    await cell(1, 23).click(); // another court: starts again there
    assert.equal(await page.locator('[data-state=selected]').count(), 1);
    await cell(2, 19).click();
    await cell(2, 20).click();
    assert.match(await page.getByTestId('summary').innerText(), /Court 2 · Sat 9 Jan · 19:00 to 21:00/);
    await page.screenshot({ path: join(SHOTS, 'C4-schedule-en-selected.png') });
    await page.getByTestId('continue').click();
    await page.waitForURL((u) => u.pathname === '/c/hunter/checkout');
    const q = new URL(page.url()).searchParams;
    assert.deepEqual([q.get('court'), q.get('courtId'), q.get('date'), q.get('from'), q.get('to')], ['2', 'c2', TODAY, '19:00', '21:00']);
    await context.close();
  });

  it('BOOK-01-AC14: a full day shows Day full with Join waitlist and a way to the next open date', async () => {
    const { page, context } = await openPage(browser, { stubCheckout: true, liff: guest, lang: 'en', schedule: schedule({ dayFor: (d) => (d === TODAY ? fullDay(d) : normalDay(d)) }) });
    await page.goto(`${app.base}/c/hunter/book`);
    await page.getByTestId('day-full').waitFor();
    assert.match(await page.getByTestId('day-full').innerText(), /Sat 9 Jan is fully booked from 16:00\.\s+Sun 10 Jan has 18 open hours\./);
    assert.ok((await page.getByText('Join waitlist').count()) > 0);
    await page.screenshot({ path: join(SHOTS, 'C4-day-full-en.png') });
    await page.getByTestId('see-next').click();
    await page.getByTestId('grid').waitFor();
    assert.equal(new URL(page.url()).searchParams.get('date'), '2027-01-10');
    assert.equal(await page.locator('.date-chip[aria-selected=true]').getAttribute('data-date'), '2027-01-10');
    await context.close();
  });

  it('BOOK-01-AC13: while loading the grid shows the loading state; a failed read shows offline with Try again', async () => {
    const slow = await openPage(browser, { stubCheckout: true, liff: guest, lang: 'en', schedule: schedule({ delayMs: 1500 }) });
    await slow.page.goto(`${app.base}/c/hunter/book`);
    await slow.page.getByTestId('loading').waitFor();
    await slow.page.screenshot({ path: join(SHOTS, 'C4-loading-en.png') });
    await slow.page.getByTestId('grid').waitFor();
    await slow.context.close();
    const down = await openPage(browser, { stubCheckout: true, liff: guest, lang: 'th', schedule: { offline: true } });
    await down.page.goto(`${app.base}/c/hunter/book`);
    await down.page.getByTestId('offline').waitFor();
    assert.match(await down.page.getByTestId('offline').innerText(), /ลองอีกครั้ง/);
    assert.deepEqual(down.calls.filter((c) => c.method !== 'GET'), []);
    await down.context.close();
  });

  it('BOOK-02-AC4: a paused club shows C4 as paused, with Bookings still in the nav', async () => {
    const { page, context } = await openPage(browser, { stubCheckout: true, liff: guest, lang: 'en', schedule: schedule({ courts: info({ status: 'paused' }) }) });
    await page.goto(`${app.base}/c/hunter/book`);
    await page.getByTestId('paused').waitFor();
    assert.equal(await page.getByTestId('grid').count(), 0);
    assert.equal(await page.locator('.bottom-nav a[href="/c/hunter/bookings"]').count(), 1);
    await context.close();
  });

  it('CC-5: at 320 px with the longest strings, nothing scrolls sideways and Continue stays on one line', async () => {
    for (const lang of ['th', 'en']) {
      const { page, context } = await openPage(browser, { stubCheckout: true, liff: guest, lang, width: 320, height: 568, schedule: schedule({ courts: info({ courts: [{ id: 'c1', name: '12A', sport: 'tennis' }, { id: 'c2', name: '12B', sport: 'tennis' }] }), dayFor: (d) => { const x = normalDay(d); x.courts[0].name = '12A'; x.courts[1].name = '12B'; return x; } }) });
      await page.goto(`${app.base}/c/hunter/book`);
      await page.getByTestId('grid').waitFor();
      await page.locator('[data-state=open]').last().click();
      await page.getByTestId('continue').waitFor();
      await page.evaluate(() => document.fonts.ready);
      const r = await page.evaluate(() => {
        const btn = document.querySelector('[data-testid=continue]');
        const s = btn.querySelector('span');
        const lh = parseFloat(getComputedStyle(s).lineHeight) || parseFloat(getComputedStyle(s).fontSize) * 1.6;
        return { sideways: document.documentElement.scrollWidth > window.innerWidth, lines: Math.round(s.getBoundingClientRect().height / lh), cut: s.scrollWidth > s.clientWidth + 1 };
      });
      assert.equal(r.sideways, false, `${lang}: sideways scroll`);
      assert.equal(r.lines, 1, `${lang}: Continue wraps`);
      assert.equal(r.cut, false, `${lang}: Continue is cut`);
      await page.screenshot({ path: join(SHOTS, `C4-schedule-${lang}-320-longest.png`) });
      await context.close();
    }
  });
});

describe('refusals on C4 (F03-T25)', () => {
  const back = (base, q) => `${base}/c/hunter/book?date=${TODAY}&${q}`;

  it('BOOK-01-AC15, BOOK-04-AC4: a slot taken meanwhile is told in both languages on a fresh grid, and nothing is charged', async () => {
    for (const lang of ['th', 'en']) {
      const { page, context, calls } = await openPage(browser, { stubCheckout: true, liff: guest, lang, schedule: schedule() });
      await page.goto(back(app.base, 'refused=slot_unavailable&by=resource'));
      await page.getByTestId('refusal').waitFor();
      await page.getByTestId('grid').waitFor();
      const text = await page.getByTestId('refusal').innerText();
      assert.match(text, lang === 'en' ? /no longer available.*Nothing was booked or charged/ : /ไม่ว่างแล้ว.*ยังไม่มีการจองหรือเรียกเก็บเงิน/);
      assert.ok(calls.some((c) => c.path.endsWith('/schedule')), 'the grid was read again');
      assert.deepEqual(calls.filter((c) => c.method !== 'GET'), [], 'nothing sent');
      const u = new URL(page.url());
      assert.equal(u.searchParams.get('refused'), null, 'the refusal leaves the address');
      assert.equal(u.searchParams.get('date'), TODAY);
      assert.equal(await page.locator('[data-state=selected]').count(), 0);
      await page.screenshot({ path: join(SHOTS, `C4-refused-slot-${lang}.png`) });
      await context.close();
    }
  });

  it('BOOK-05-AC8, D61: the limit names {hours}, too many attempts names {seconds}, the window names its days', async () => {
    for (const [q, re] of [
      ['refused=limit_reached&hours=4', /up to 4 hours/],
      ['refused=too_many_attempts&seconds=30', /30 seconds/],
      ['refused=outside_window', /up to 6 days ahead/],
      ['refused=hour_started', /already started/],
    ]) {
      const { page, context } = await openPage(browser, { stubCheckout: true, liff: guest, lang: 'en', schedule: schedule() });
      await page.goto(back(app.base, q));
      await page.getByTestId('refusal').waitFor();
      assert.match(await page.getByTestId('refusal').innerText(), re, q);
      await context.close();
    }
  });

  it('an unknown code or a missing value shows nothing, and picking an hour clears the message', async () => {
    const odd = await openPage(browser, { stubCheckout: true, liff: guest, lang: 'en', schedule: schedule() });
    await odd.page.goto(back(app.base, 'refused=not_a_code'));
    await odd.page.getByTestId('grid').waitFor();
    assert.equal(await odd.page.getByTestId('refusal').count(), 0);
    await odd.page.goto(back(app.base, 'refused=limit_reached'));
    await odd.page.getByTestId('grid').waitFor();
    assert.equal(await odd.page.getByTestId('refusal').count(), 0, 'never a raw {hours}');
    await odd.page.goto(back(app.base, 'refused=slot_unavailable'));
    await odd.page.getByTestId('refusal').waitFor();
    await odd.page.locator('[data-state=open]').first().click();
    assert.equal(await odd.page.getByTestId('refusal').count(), 0);
    await odd.context.close();
  });
});
