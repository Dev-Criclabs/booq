// F11-T19 A10 Promotions (ADMIN-12): promo codes and partners; percent is typed as percent and sent as basis points, a fixed amount in baht as satang; empty
// caps, dates and minimum spend stay unset; owner only; Thai and English at 1280 and 375 px (CC-5). The API is faked in the browser; no database.
// Run: node --test --test-concurrency=1 'apps/web/e2e/*.e2e.mjs'  (one next dev at a time; Chromium is pre-installed).
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { join } from 'node:path';
import { SHOTS } from './harness.mjs';
import { chromium, noSideways, openAdmin, startApp } from './admin-harness.mjs';

let app;
let browser;
before(async () => {
  app = await startApp(3122);
  browser = await chromium.launch();
});
after(async () => {
  await browser?.close();
  app?.stop();
});

const url = '/c/hunter/admin/promotions';
const PARTNER = { id: 'pt1', name: 'Partner cafe', type: 'cafe', contact: null };
const PROMO = {
  id: 'c1', code: 'SPRING10', kind: 'percent', value: 1000, appliesTo: ['court_hour', 'package'], includesAddOns: false, audience: 'any', startsOn: null, endsOn: null, firstTimeOnly: false,
  totalCap: null, perCustomerCap: null, minSpendSatang: null, stackableWithBirthday: false, partnerId: null, active: true,
};
function server(over = {}) {
  const s = { promos: [PROMO], partners: [PARTNER], del: undefined, post: undefined, ...over };
  return (method, path, search, body) => {
    const m = /^\/staff\/setup\/(promo-codes|partners)(?:\/([^/]+))?$/.exec(path);
    if (!m) return undefined;
    if (method === 'GET') return { status: 200, body: m[1] === 'promo-codes' ? s.promos : s.partners };
    if (method === 'DELETE' && s.del) return s.del;
    if (method === 'POST' && s.post) return s.post;
    return { status: 200, body: { id: m[2] ?? 'new', ...body } };
  };
}
const open = (api, o) => openAdmin(browser, api, o);
const writes = (calls, re) => calls.filter((c) => c.method !== 'GET' && re.test(c.path));
const status = (page, scope) => page.waitForFunction((s) => document.querySelector(`[data-testid="${s}"] [data-testid="promo-msg"]`)?.getAttribute('role') === 'status', scope);

describe('A10 Promotions', () => {
  it('lists codes with their discount and partners with their count; unset caps and dates are empty boxes', async () => {
    const { page, context } = await open(server());
    await page.goto(`${app.base}${url}`);
    await page.getByTestId('promotions-page').waitFor();
    assert.match(await page.getByTestId('promo-c1').locator('legend').first().innerText(), /SPRING10 · 10% off/);
    assert.match(await page.getByTestId('promo-partners').innerText(), /Partners · 1/i);
    assert.match(await page.getByTestId('promotions-page').innerText(), /One code per order/);
    assert.equal(await page.getByTestId('c-c1-amount').inputValue(), '10');
    for (const f of ['total', 'per', 'spend', 'starts', 'ends']) assert.equal(await page.getByTestId(`c-c1-${f}`).inputValue(), '', f);
    assert.equal(await page.getByTestId('c-c1-applies-package').isChecked(), true);
    assert.equal(await page.getByTestId('c-c1-applies-coach').isChecked(), false);
    assert.equal(await page.getByTestId('nav-promotions').getAttribute('aria-current'), 'page');
    await page.screenshot({ path: join(SHOTS, 'admin-promotions.png'), fullPage: true });
    await context.close();
  });

  it('a new code: wrong input is refused first; a good one sends percent as basis points, upper case, and leaves empty fields out', async () => {
    const { page, context, calls } = await open(server());
    await page.goto(`${app.base}${url}`);
    await page.getByTestId('new-code').fill('summer');
    await page.getByTestId('new-amount').fill('12.5');
    await page.getByTestId('new-add').click();
    await page.getByTestId('promo-new').getByTestId('promo-msg').waitFor();
    assert.equal(writes(calls, /promo-codes/).length, 0);
    await page.getByTestId('new-applies-court_hour').check();
    await page.getByTestId('new-applies-add_on').check();
    await page.getByTestId('new-audience').selectOption('student');
    await page.getByTestId('new-first').check();
    await page.getByTestId('new-add').click();
    await status(page, 'promo-new');
    const c = writes(calls, /promo-codes/)[0];
    assert.equal(c.method, 'POST');
    assert.deepEqual(c.body, { code: 'SUMMER', kind: 'percent', value: 1250, appliesTo: ['court_hour', 'add_on'], includesAddOns: false, audience: 'student', firstTimeOnly: true, stackableWithBirthday: false, active: true });
    await context.close();
  });

  it('a fixed code sends satang with caps, dates, minimum spend and partner; a change sends only itself, and a cleared cap sends null', async () => {
    const { page, context, calls } = await open(server({ promos: [{ ...PROMO, totalCap: 20 }] }));
    await page.goto(`${app.base}${url}`);
    await page.getByTestId('c-c1-total').fill('');
    await page.getByTestId('c-c1-active').uncheck();
    await page.getByTestId('c-c1-save').click();
    await status(page, 'promo-c1');
    assert.deepEqual(writes(calls, /promo-codes\/c1/)[0].body, { totalCap: null, active: false });
    await page.getByTestId('new-code').fill('FIX50');
    await page.getByTestId('new-kind').selectOption('fixed');
    await page.getByTestId('new-amount').fill('50');
    await page.getByTestId('new-applies-solo_class').check();
    await page.getByTestId('new-starts').fill('2027-01-01');
    await page.getByTestId('new-ends').fill('2027-01-31');
    await page.getByTestId('new-total').fill('100');
    await page.getByTestId('new-spend').fill('500');
    await page.getByTestId('new-partner').selectOption('pt1');
    await page.getByTestId('new-add').click();
    await status(page, 'promo-new');
    assert.deepEqual(writes(calls, /promo-codes$/)[0].body, {
      code: 'FIX50', kind: 'fixed', value: 5000, appliesTo: ['solo_class'], includesAddOns: false, audience: 'any', startsOn: '2027-01-01', endsOn: '2027-01-31', firstTimeOnly: false, totalCap: 100,
      minSpendSatang: 50000, stackableWithBirthday: false, partnerId: 'pt1', active: true,
    });
    await context.close();
  });

  it('a duplicate code and a delete of a used code are refused in words; the typed values stay', async () => {
    const { page, context } = await open(server({ post: { status: 409, body: { code: 'duplicate' } }, del: { status: 409, body: { code: 'in_use' } } }));
    page.on('dialog', (d) => void d.accept());
    await page.goto(`${app.base}${url}`);
    await page.getByTestId('new-code').fill('SPRING10');
    await page.getByTestId('new-amount').fill('10');
    await page.getByTestId('new-applies-package').check();
    await page.getByTestId('new-add').click();
    await page.waitForFunction(() => /already exists/.test(document.querySelector('[data-testid="promo-new"] [data-testid="promo-msg"]')?.textContent ?? ''));
    assert.equal(await page.getByTestId('new-code').inputValue(), 'SPRING10');
    await page.getByTestId('c-c1-delete').click();
    await page.waitForFunction(() => /Switch the code off/.test(document.querySelector('[data-testid="promo-c1"] [data-testid="promo-msg"]')?.textContent ?? ''));
    await context.close();
  });

  it('partners are added with only a name, changed and deleted', async () => {
    const { page, context, calls } = await open(server());
    page.on('dialog', (d) => void d.accept());
    await page.goto(`${app.base}${url}`);
    await page.getByTestId('new-partner-add').click();
    await page.getByTestId('partner-new').getByTestId('promo-msg').waitFor();
    assert.equal(writes(calls, /partners/).length, 0);
    await page.getByTestId('new-partner-name').fill('Gym');
    await page.getByTestId('new-partner-add').click();
    await status(page, 'partner-new');
    assert.deepEqual(writes(calls, /partners$/)[0].body, { name: 'Gym' });
    await page.getByTestId('p-pt1-contact').fill('081');
    await page.getByTestId('p-pt1-save').click();
    await status(page, 'partner-pt1');
    assert.deepEqual(writes(calls, /partners\/pt1/)[0].body, { contact: '081' });
    await page.getByTestId('p-pt1-delete').click();
    await page.waitForFunction(() => document.querySelector('[data-testid="promo-partners"]') && true);
    assert.equal(writes(calls, /partners\/pt1/).at(-1).method, 'DELETE');
    await context.close();
  });
});

describe('A10 states and layout', () => {
  it('a refused role and a lost network have their own states', async () => {
    const no = await open(() => ({ status: 403, body: { code: 'forbidden' } }));
    await no.page.goto(`${app.base}${url}`);
    await no.page.getByTestId('promo-forbidden').waitFor();
    await no.context.close();
    let up = false;
    const flaky = await open((...a) => (up ? server()(...a) : 'offline'));
    await flaky.page.goto(`${app.base}${url}`);
    await flaky.page.getByTestId('promo-error').waitFor();
    up = true;
    await flaky.page.getByTestId('promo-error').getByRole('button').click();
    await flaky.page.getByTestId('promotions-page').waitFor();
    await flaky.context.close();
  });

  for (const lang of ['th', 'en']) {
    for (const width of [1280, 375]) {
      it(`${lang} at ${width}px: no sideways scroll, long names survive`, async () => {
        const long = 'SOFT-OPENING-SPECIAL-FOR-ALL-MEMBERS-AND-GUESTS-OF-THE-CLUB-2027';
        const longName = 'พันธมิตรร้านกาแฟและร้านอาหารสุขภาพใกล้สนามเทนนิสสาขาสุขุมวิทกรุงเทพมหานคร Partner cafe and healthy kitchen';
        const api = server({ promos: [{ ...PROMO, code: long }], partners: [{ ...PARTNER, name: longName }] });
        const { page, context } = await open(api, { lang, width });
        await page.goto(`${app.base}${url}`);
        await page.getByTestId('promotions-page').waitFor();
        assert.equal(await noSideways(page), true);
        await page.screenshot({ path: join(SHOTS, `admin-promotions-${lang}-${width}.png`), fullPage: true });
        await context.close();
      });
    }
  }
});
