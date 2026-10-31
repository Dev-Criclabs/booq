// F11-T13 A1 Calendar (ADMIN-03): day and week grids from the club's opening hours, the colour key, click an empty hour to create, move a booking by drag or by
// the Move form, refusals named and the grid read again; Thai and English at 1280 and 375 px (CC-5). The API is faked in the browser; no database.
// Run: node --test --test-concurrency=1 'apps/web/e2e/*.e2e.mjs'  (one next dev at a time; Chromium is pre-installed).
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { join } from 'node:path';
import { SHOTS } from './harness.mjs';
import { chromium, noSideways, openAdmin, startApp } from './admin-harness.mjs';

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

const url = '/c/hunter/admin/calendar';
const TODAY = '2027-01-18'; // a Monday
const COURTS = {
  status: 'live', today: TODAY, bookingWindowDays: 14,
  courts: [{ id: 'c1', name: '1', sport: 'tennis' }, { id: 'c2', name: '2', sport: 'tennis' }],
  openingHours: [1, 2, 3, 4, 5, 6].map((weekday) => ({ weekday, open: '08:00', close: '12:00' })),
};
// 10:00 Bangkok is 03:00 UTC.
const at = (hour, day = TODAY) => new Date(`${day}T${String(hour).padStart(2, '0')}:00:00+07:00`).toISOString();
const cell = (over = {}) => ({
  resourceId: 'c1', resourceName: '1', startAt: at(9), endAt: at(10), kind: 'court_booking', state: 'confirmed', holdExpiresAt: null, bookingId: 'b1', bookingStatus: 'confirmed', bookingSource: 'online',
  customerId: 'u1', customerName: 'Pat Player', coachId: null, coachName: null, classSessionId: null, classNameTh: null, classNameEn: null, closureId: null, ...over,
});
const CELLS = [
  cell(),
  cell({ resourceId: 'c2', resourceName: '2', startAt: at(9), endAt: at(10), bookingId: 'b2', bookingSource: 'staff', customerName: 'Walk In' }),
  cell({ startAt: at(10), endAt: at(11), bookingId: 'b3', state: 'held', bookingStatus: 'awaiting_payment', customerName: 'Pending Pam' }),
  cell({ resourceId: 'c2', resourceName: '2', startAt: at(10), endAt: at(11), kind: 'solo_class', bookingId: 'b4', coachName: 'Coach Cat', customerName: 'Sam' }),
  cell({ startAt: at(11), endAt: at(12), kind: 'closure', bookingId: null, closureId: 'x1', customerName: null }),
];

function server(state = {}) {
  const s = { cells: CELLS, move: undefined, ...state };
  return (method, path, search, body) => {
    if (path === '/courts') return { status: 200, body: COURTS };
    if (path === '/staff/calendar') return s.calendar ? s.calendar(search) : { status: 200, body: s.cells };
    if (/^\/staff\/bookings\/[^/]+\/move$/.test(path) && method === 'PUT') return s.move ?? { status: 200, body: { id: path.split('/')[3] } };
    return undefined;
  };
}
const open = (api, o) => openAdmin(browser, api, o);
const moves = (calls) => calls.filter((c) => c.method === 'PUT');

describe('A1 Calendar', () => {
  it('draws one column per court and one row per open hour, with the colour key and the day summary; today comes from the server', async () => {
    const { page, context, calls } = await open(server());
    await page.goto(`${app.base}${url}`);
    await page.getByTestId('cal-grid').waitFor();
    const head = await page.getByTestId('cal-grid').locator('thead').innerText();
    assert.match(head, /court 1/i);
    assert.match(head, /court 2/i);
    assert.equal(await page.getByTestId('cal-grid').locator('tbody tr').count(), 4); // 08:00 to 11:00 starts
    assert.match(await page.getByTestId('cal-summary').innerText(), /Monday 18 January 2027/);
    assert.match(await page.getByTestId('cal-summary').innerText(), /Today · 4 bookings · 1 closed slot/);
    assert.equal(await page.getByTestId('cal-key').locator('li').count(), 6);
    assert.match(await page.getByTestId('cell-b1-9').innerText(), /Pat Player/);
    assert.match(await page.getByTestId('cell-b3-10').innerText(), /Awaiting payment · Pending Pam/);
    assert.match(await page.getByTestId('cell-b4-10').innerText(), /Coach Cat with Sam/);
    assert.match(await page.getByTestId('cell-x1-11').innerText(), /Closed/);
    assert.equal(await page.getByTestId('nav-calendar').getAttribute('aria-current'), 'page');
    assert.deepEqual(calls.find((c) => c.path === '/staff/calendar').search, `?from=${TODAY}&to=${TODAY}`);
    await page.screenshot({ path: join(SHOTS, 'admin-calendar.png'), fullPage: true });
    await context.close();
  });

  it('an empty open hour is a link to create a booking for that court and time', async () => {
    const { page, context } = await open(server());
    await page.goto(`${app.base}${url}`);
    const a = page.getByTestId('new-c1-8');
    await a.waitFor();
    assert.equal(await a.getAttribute('href'), '/c/hunter/admin/bookings/new?court=c1&start=2027-01-18T08%3A00%3A00%2B07%3A00');
    assert.match(await a.getAttribute('aria-label'), /New booking at 08:00/);
    await context.close();
  });

  it('Previous, Next and Today move the day and read it again; Week shows seven days for one court', async () => {
    const { page, context, calls } = await open(server());
    await page.goto(`${app.base}${url}`);
    await page.getByTestId('cal-grid').waitFor();
    await page.getByTestId('cal-next').click();
    await page.waitForFunction(() => /Tuesday 19 January/.test(document.querySelector('[data-testid="cal-summary"]')?.textContent ?? ''));
    await page.getByTestId('cal-today').click();
    await page.waitForFunction(() => /Monday 18 January/.test(document.querySelector('[data-testid="cal-summary"]')?.textContent ?? ''));
    await page.getByTestId('cal-week').click();
    await page.waitForFunction(() => document.querySelector('[data-testid="cal-court"]'));
    await page.waitForFunction(() => document.querySelectorAll('[data-testid="cal-grid"] thead th').length === 8);
    assert.ok(calls.some((c) => c.path === '/staff/calendar' && c.search === '?from=2027-01-18&to=2027-01-24'));
    await page.getByTestId('cal-court').selectOption('c2');
    await page.waitForFunction(() => document.querySelector('[data-testid="cell-b4-10"]'));
    await context.close();
  });

  it('hours the club is closed are shaded and not a link; a day with no hours says so', async () => {
    const { page, context } = await open(server());
    await page.goto(`${app.base}${url}`);
    await page.getByTestId('cal-grid').waitFor();
    await page.getByTestId('cal-week').click();
    await page.waitForFunction(() => document.querySelectorAll('[data-testid="cal-grid"] thead th').length === 8);
    assert.ok((await page.locator('[data-testid^="off-2027-01-24-"]').count()) === 4); // Sunday has no hours
    await context.close();
  });

  it('the Move form moves a booking to another court and hour (Bangkok time), tells the staff, and reads the day again', async () => {
    const { page, context, calls } = await open(server());
    await page.goto(`${app.base}${url}`);
    await page.getByTestId('cell-b1-9').click();
    await page.getByTestId('cal-panel').waitFor();
    assert.match(await page.getByTestId('cal-panel').innerText(), /Pat Player/);
    assert.equal(await page.getByTestId('cal-open').getAttribute('href'), '/c/hunter/admin/bookings/b1');
    await page.getByTestId('move-court').selectOption('c2');
    await page.getByTestId('move-hour').selectOption('8');
    await page.getByTestId('move-do').click();
    await page.getByTestId('cal-msg').waitFor();
    assert.match(await page.getByTestId('cal-msg').innerText(), /was moved/);
    assert.deepEqual(moves(calls)[0].body, { courtId: 'c2', start: '2027-01-18T08:00:00+07:00' });
    assert.equal(moves(calls)[0].path, '/staff/bookings/b1/move');
    assert.ok(calls.filter((c) => c.path === '/staff/calendar').length >= 2);
    await context.close();
  });

  it('a booking can be dragged to an empty hour; a class, a closure and an unpaid hold cannot be moved', async () => {
    const { page, context, calls } = await open(server());
    await page.goto(`${app.base}${url}`);
    await page.getByTestId('cell-b1-9').waitFor();
    assert.equal(await page.getByTestId('cell-b1-9').getAttribute('draggable'), 'true');
    for (const id of ['cell-b3-10', 'cell-b4-10', 'cell-x1-11']) assert.notEqual(await page.getByTestId(id).getAttribute('draggable'), 'true', id);
    await page.getByTestId('cell-b1-9').dragTo(page.getByTestId('free-c2-8'));
    await page.getByTestId('cal-msg').waitFor();
    assert.deepEqual(moves(calls)[0].body, { courtId: 'c2', start: '2027-01-18T08:00:00+07:00' });
    await page.getByTestId('cell-b3-10').click();
    assert.equal(await page.getByTestId('cal-move').count(), 0);
    await context.close();
  });

  it('a move the server refuses is named, and the day is read again; the rest-hours limit shows its number', async () => {
    const taken = await open(server({ move: { status: 409, body: { code: 'slot_unavailable', params: { by: 'booking' } } } }));
    await taken.page.goto(`${app.base}${url}`);
    await taken.page.getByTestId('cell-b1-9').click();
    await taken.page.getByTestId('move-hour').selectOption('8');
    const before = taken.calls.filter((c) => c.path === '/staff/calendar').length;
    await taken.page.getByTestId('move-do').click();
    await taken.page.waitForFunction(() => /just taken/.test(document.querySelector('[data-testid="cal-msg"]')?.textContent ?? ''));
    await taken.page.waitForTimeout(300);
    assert.ok(taken.calls.filter((c) => c.path === '/staff/calendar').length > before);
    await taken.context.close();
    const rest = await open(server({ move: { status: 409, body: { code: 'rest_rule', params: { hours: 6 } } } }));
    await rest.page.goto(`${app.base}${url}`);
    await rest.page.getByTestId('cell-b1-9').click();
    await rest.page.getByTestId('move-hour').selectOption('8');
    await rest.page.getByTestId('move-do').click();
    await rest.page.waitForFunction(() => /limit of 6 hours/.test(document.querySelector('[data-testid="cal-msg"]')?.textContent ?? ''));
    await rest.context.close();
  });

  it('a refused role and a lost network have their own states', async () => {
    const no = await open(() => ({ status: 403, body: { code: 'forbidden' } }));
    await no.page.goto(`${app.base}${url}`);
    await no.page.getByTestId('cal-forbidden').waitFor();
    await no.context.close();
    const off = await open(() => 'offline');
    await off.page.goto(`${app.base}${url}`);
    await off.page.getByTestId('cal-error').waitFor();
    await off.context.close();
  });

  for (const lang of ['th', 'en']) {
    for (const width of [1280, 375]) {
      it(`${lang} at ${width}px: no sideways scroll on the page, long names stay inside their cells`, async () => {
        const long = 'สมชาย ใจดีมากมายหลายประการ Somchai Jaidee-Wongsawat the Third';
        const api = server({ cells: [cell({ customerName: long }), cell({ resourceId: 'c2', startAt: at(9), bookingId: 'b9', customerName: long })] });
        const { page, context } = await open(api, { lang, width });
        await page.goto(`${app.base}${url}`);
        await page.getByTestId('cal-grid').waitFor();
        assert.equal(await noSideways(page), true);
        await page.getByTestId('cal-week').click();
        await page.waitForFunction(() => document.querySelectorAll('[data-testid="cal-grid"] thead th').length === 8);
        assert.equal(await noSideways(page), true);
        await page.getByTestId('cal-day').click();
        await page.getByTestId('cell-b1-9').click();
        await page.getByTestId('cal-panel').waitFor();
        assert.equal(await noSideways(page), true);
        await page.screenshot({ path: join(SHOTS, `admin-calendar-${lang}-${width}.png`), fullPage: true });
        await context.close();
      });
    }
  }
});
