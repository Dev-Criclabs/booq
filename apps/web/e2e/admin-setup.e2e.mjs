// F11-T24 A0 Setup checklist (ADMIN-02): steps 6 to 8, Tell BOOQ I'm done, the players CSV import (validate, confirm, cancel); Thai and English at
// 1280 and 375 px (CC-5). The API is faked in the browser; no database.
// Run: node --test --test-concurrency=1 'apps/web/e2e/*.e2e.mjs'  (one next dev at a time; Chromium is pre-installed).
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { join } from 'node:path';
import { SHOTS } from './harness.mjs';
import { chromium, noSideways, openAdmin, startApp } from './admin-harness.mjs';

let app;
let browser;
before(async () => {
  app = await startApp(3119);
  browser = await chromium.launch();
});
after(async () => {
  await browser?.close();
  app?.stop();
});

const setup = (done, over = {}) => ({ clubStatus: 'testing', steps: [{ key: 'brand', done: done[0] }, { key: 'products_rules', done: done[1] }, { key: 'people', done: done[2] }], toldAt: null, ...over });
const summary = (over = {}) => ({ id: 'imp1', kind: 'players', status: 'validated', rowsRead: 2, rowsSaved: 0, rowsRejected: 0, fileErrors: [], errors: [], flags: [], ...over });
const CSV = (text) => ({ name: 'players.csv', mimeType: 'text/csv', buffer: Buffer.from(text) });
const url = '/c/hunter/admin/setup';

function server(state = {}) {
  const s = { setup: setup([false, false, false]), ...state };
  return (method, path, search, body) => {
    if (path === '/staff/setup') return { status: 200, body: s.setup };
    if (path === '/staff/setup/done') { s.setup = { ...s.setup, toldAt: '2027-01-12T03:00:00Z' }; return { status: 200, body: { recorded: true } }; }
    if (path === '/imports' && method === 'POST') return s.importStart ? s.importStart(body) : { status: 200, body: summary() };
    if (path === '/imports/imp1/confirm') return s.importConfirm ?? { status: 200, body: summary({ status: 'confirmed', rowsSaved: 2 }) };
    if (path === '/imports/imp1' && method === 'DELETE') return { status: 200, body: summary({ status: 'cancelled' }) };
    return undefined;
  };
}
const open = (api, o) => openAdmin(browser, api, o);

describe('A0 Setup checklist', () => {
  it('shows the banner, the steps BOOQ did, the three owner steps with their state and the locked Tell BOOQ button', async () => {
    const { page, context } = await open(server({ setup: setup([true, false, false]) }));
    await page.goto(`${app.base}${url}`);
    await page.getByTestId('setup').waitFor();
    assert.match(await page.getByTestId('setup-banner').innerText(), /Your club isn't live yet/);
    assert.match(await page.getByTestId('setup-banner').innerText(), /2 steps left for you/);
    assert.match(await page.getByTestId('steps-booq').innerText(), /Steps 1 to 5/i);
    assert.equal(await page.getByTestId('state-brand').innerText(), 'Done');
    assert.equal(await page.getByTestId('state-products_rules').innerText(), 'Not done yet');
    assert.match(await page.getByTestId('step-launch').innerText(), /9 Test and launch/i);
    assert.equal(await page.getByTestId('tell-done').isDisabled(), true);
    assert.match(await page.getByTestId('tell-locked').innerText(), /Unlocks when steps 6 to 8 are done/);
    assert.equal(await page.getByTestId('go-staff').getAttribute('href'), '/c/hunter/admin/staff');
    assert.equal(await page.getByTestId('nav-setup').getAttribute('aria-current'), 'page');
    await page.screenshot({ path: join(SHOTS, 'admin-setup.png'), fullPage: true });
    await context.close();
  });

  it('Tell BOOQ unlocks when steps 6 to 8 are done, tells once, and says so', async () => {
    const { page, context, calls } = await open(server({ setup: setup([true, true, true]) }));
    await page.goto(`${app.base}${url}`);
    await page.getByTestId('tell-done').waitFor();
    assert.equal(await page.getByTestId('tell-done').isDisabled(), false);
    await page.getByTestId('tell-done').click();
    await page.getByTestId('setup-told').waitFor();
    assert.equal(calls.filter((c) => c.path === '/staff/setup/done').length, 1);
    assert.equal(await page.getByTestId('tell-done').isDisabled(), true);
    await context.close();
  });

  it('a live club has no checklist; a role the server refuses and a lost network have their own states', async () => {
    const live = await open(server({ setup: setup([true, true, true], { clubStatus: 'live' }) }));
    await live.page.goto(`${app.base}${url}`);
    await live.page.getByTestId('setup-live').waitFor();
    await live.context.close();
    const no = await open(() => ({ status: 403, body: { code: 'forbidden' } }));
    await no.page.goto(`${app.base}${url}`);
    await no.page.getByTestId('setup-forbidden').waitFor();
    await no.context.close();
    let up = false;
    const flaky = await open((...a) => (up ? server()(...a) : 'offline'));
    await flaky.page.goto(`${app.base}${url}`);
    await flaky.page.getByTestId('setup-error').waitFor();
    up = true;
    await flaky.page.getByTestId('setup-error').getByRole('button').click();
    await flaky.page.getByTestId('setup').waitFor();
    await flaky.context.close();
  });
});

describe('the players import', () => {
  it('a clean file is sent as text with its name, shows its summary and saves only after Confirm', async () => {
    const { page, context, calls } = await open(server());
    await page.goto(`${app.base}${url}`);
    await page.getByTestId('import-file').setInputFiles(CSV('full_name,phone\nPloy,0812345678\nNok,0898765432\n'));
    await page.getByTestId('import-summary').waitFor();
    assert.deepEqual(calls.find((c) => c.path === '/imports' && c.method === 'POST').body, { kind: 'players', fileName: 'players.csv', content: 'full_name,phone\nPloy,0812345678\nNok,0898765432\n' });
    assert.match(await page.getByTestId('import-summary').innerText(), /Rows read: 2/);
    assert.match(await page.getByTestId('import-summary').innerText(), /The file is clean\. Confirm to save 2 players/);
    assert.equal(calls.filter((c) => c.path.endsWith('/confirm')).length, 0, 'nothing is saved before Confirm');
    await page.getByTestId('import-confirm').click();
    await page.getByTestId('import-msg').waitFor();
    assert.match(await page.getByTestId('import-msg').innerText(), /2 players were saved\. No bookings were created/);
    await context.close();
  });

  it('a file with a problem cannot be confirmed; the rows and reasons are listed in words; Cancel saves nothing', async () => {
    const bad = summary({ status: 'failed', rowsRead: 3, rowsRejected: 2, errors: [{ rowNo: 2, codes: ['phone_invalid'] }, { rowNo: 3, codes: ['name_missing', 'dob_future'] }], flags: [{ rowNo: 4, flags: ['duplicate_phone'] }] });
    const { page, context, calls } = await open(server({ importStart: () => ({ status: 200, body: bad }) }));
    await page.goto(`${app.base}${url}`);
    await page.getByTestId('import-file').setInputFiles(CSV('full_name,phone\n,x\n'));
    await page.getByTestId('import-errors').waitFor();
    const text = await page.getByTestId('import-summary').innerText();
    assert.match(text, /Row 2 · The phone is not a valid number/);
    assert.match(text, /Row 3 · The name is missing\. · The date of birth is in the future/);
    assert.match(text, /Row 4 · This phone is in the file more than once/);
    assert.equal(await page.getByTestId('import-confirm').isDisabled(), true);
    await page.getByTestId('import-cancel').click();
    await page.getByTestId('import-msg').waitFor();
    assert.match(await page.getByTestId('import-msg').innerText(), /Nothing was saved/);
    assert.equal(calls.filter((c) => c.path.endsWith('/confirm')).length, 0);
    await context.close();
  });

  it('a file-level problem and the server refusals are said in words', async () => {
    const empty = await open(server({ importStart: () => ({ status: 200, body: summary({ status: 'failed', rowsRead: 0, fileErrors: ['column_missing'] }) }) }));
    await empty.page.goto(`${app.base}${url}`);
    await empty.page.getByTestId('import-file').setInputFiles(CSV('a,b\n'));
    await empty.page.getByTestId('import-summary').waitFor();
    assert.match(await empty.page.getByTestId('import-summary').innerText(), /A needed column is missing/);
    await empty.context.close();
    const nc = await open(server({ importStart: () => ({ status: 503, body: { code: 'import_not_configured' } }) }));
    await nc.page.goto(`${app.base}${url}`);
    await nc.page.getByTestId('import-file').setInputFiles(CSV('full_name,phone\nA,1\n'));
    await nc.page.getByTestId('import-msg').waitFor();
    assert.match(await nc.page.getByTestId('import-msg').innerText(), /BOOQ has not set the import limits yet/);
    await nc.context.close();
    const gone = await open(server({ importConfirm: { status: 410, body: { code: 'expired' } } }));
    await gone.page.goto(`${app.base}${url}`);
    await gone.page.getByTestId('import-file').setInputFiles(CSV('full_name,phone\nA,1\n'));
    await gone.page.getByTestId('import-confirm').click();
    await gone.page.getByTestId('import-msg').waitFor();
    assert.match(await gone.page.getByTestId('import-msg').innerText(), /expired or was not found/);
    await gone.context.close();
  });
});

describe('Thai and narrow', () => {
  it('the checklist and a long error list at 1280 and 375 px: no sideways scroll', async () => {
    const many = summary({ status: 'failed', rowsRead: 60, rowsRejected: 60, errors: Array.from({ length: 60 }, (_, i) => ({ rowNo: i + 2, codes: ['phone_invalid', 'name_missing', 'dob_invalid'] })) });
    for (const lang of ['th', 'en']) {
      for (const width of [1280, 375]) {
        const { page, context } = await open(server({ setup: setup([true, false, true]), importStart: () => ({ status: 200, body: many }) }), { lang, width });
        await page.goto(`${app.base}${url}`);
        await page.getByTestId('import-file').setInputFiles(CSV('full_name,phone\n'));
        await page.getByTestId('import-errors').waitFor();
        assert.equal(await noSideways(page), true, `${lang} ${width}`);
        await page.screenshot({ path: join(SHOTS, `admin-setup-${lang}-${width}.png`), fullPage: true });
        await context.close();
      }
    }
  });
});
