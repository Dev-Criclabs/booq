// F11-T15 A6 Customer profile (ADMIN-07): header, tags, tabs, notes, adjust balance, extend package (owner only), states; Thai and English at
// 1280 and 375 px (CC-5). The API is faked in the browser; no database.
// Run: node --test --test-concurrency=1 'apps/web/e2e/*.e2e.mjs'  (one next dev at a time; Chromium is pre-installed).
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { join } from 'node:path';
import { SHOTS } from './harness.mjs';
import { chromium, DESK_PAGES, noSideways, openAdmin, startApp } from './admin-harness.mjs';

let app;
let browser;
before(async () => {
  app = await startApp(3115);
  browser = await chromium.launch();
});
after(async () => {
  await browser?.close();
  app?.stop();
});

const ID = '00000000-0000-4000-8000-000000000001';
const P = `/staff/customers/${ID}`;
const profile = (over = {}) => ({ customerId: ID, displayName: 'Ploy', fullName: 'Ploy Srisuk', phone: '+66812345678', language: 'en', level: 'beginner', dateOfBirth: '1994-03-14', claimState: null, signedIn: true, active: true, tags: ['Partner gym'], createdAt: '2026-12-01T03:00:00Z', ...over });
const booking = (n, over = {}) => ({ bookingId: `b${n}`, orderId: `o${n}`, type: 'court', courtName: '1', coachName: null, classNameTh: null, classNameEn: null, startAt: `2025-01-0${n}T10:00:00Z`, endAt: `2025-01-0${n}T11:00:00Z`, status: 'confirmed', source: 'online', cancelKind: null, cancelOutcome: null, ...over });
const VALUE = { packages: [{ packageId: 'p1', nameTh: 'แพ็กเกจ 10 ชั่วโมง', nameEn: '10 hour bundle', creditType: 'court_hour', creditsTotal: 10, creditsLeft: 7, status: 'active', purchasedAt: '2027-01-09T03:00:00Z', expiresAt: '2027-04-09T03:00:00Z' }], wallet: { balanceSatang: 50000, ledger: [{ at: '2027-01-10T03:00:00Z', change: 50000, reason: 'cancel', note: null }] }, creditLedger: [] };
const ORDERS = [{ orderId: 'o1', status: 'paid', source: 'online', kind: 'sale', totalSatang: 50000, moneySatang: 50000, creditValueSatang: 0, walletSatang: 0, createdAt: '2027-01-01T03:00:00Z', receipts: ['HTC-2027-000001'] }];

function server(state = {}) {
  const s = { profile: profile(), bookings: [booking(1), booking(2, { status: 'cancelled' }), booking(3, { type: 'class_seat', classNameEn: 'Adult beginner clinic', classNameTh: 'คลินิกมือใหม่ผู้ใหญ่', courtName: '2' })], value: VALUE, notes: [], orders: ORDERS, ...state };
  return (method, path, search, body) => {
    if (path === P && method === 'GET') return { status: 200, body: s.profile };
    if (path === `${P}/bookings`) return { status: 200, body: s.bookings };
    if (path === `${P}/orders`) return { status: 200, body: s.orders };
    if (path === `${P}/credits`) return { status: 200, body: s.value };
    if (path === `${P}/notes` && method === 'GET') return { status: 200, body: s.notes };
    if (path === `${P}/notes` && method === 'POST') { s.notes = [{ noteId: 'n1', note: body.note, by: 'Front desk', at: '2027-01-12T03:00:00Z' }, ...s.notes]; return { status: 200, body: { noteId: 'n1' } }; }
    if (path === `${P}/tags` && method === 'POST') { s.profile = { ...s.profile, tags: [...s.profile.tags, body.tag] }; return { status: 200, body: { ok: true } }; }
    if (path.startsWith(`${P}/tags/`) && method === 'DELETE') { const tag = decodeURIComponent(path.split('/').pop()); s.profile = { ...s.profile, tags: s.profile.tags.filter((x) => x !== tag) }; return { status: 200, body: { ok: true } }; }
    if (path === `${P}/wallet-adjust`) return s.walletAnswer ?? { status: 200, body: { ledgerId: 'l1' } };
    if (path === `${P}/credit-adjust`) return { status: 200, body: { ledgerId: 'l2' } };
    if (path === '/staff/packages/p1/extend') return s.extendAnswer ?? { status: 200, body: { extensionId: 'x1' } };
    return undefined;
  };
}
const open = (api, o) => openAdmin(browser, api, o);
const url = `/c/hunter/admin/customers/${ID}`;

describe('A6 Customer profile', () => {
  it('shows who the customer is, the tiles, the latest bookings with their outcome, and the tabs', async () => {
    const { page, context } = await open(server());
    await page.goto(`${app.base}${url}`);
    await page.getByTestId('profile').waitFor();
    assert.equal(await page.getByTestId('prof-name').innerText(), 'Ploy Srisuk');
    assert.equal(await page.getByTestId('prof-meta').innerText(), '+66812345678 · Born 14 March 1994 · Beginner');
    assert.match(await page.getByTestId('tile-wallet').innerText(), /฿500/);
    assert.match(await page.getByTestId('tile-package').innerText(), /10 hour bundle/i);
    assert.match(await page.getByTestId('tile-package').innerText(), /7 of 10 left/);
    assert.match(await page.getByTestId('tile-package').innerText(), /Expires 9 April 2027/);
    assert.match(await page.getByTestId('tile-visits').innerText(), /2/);
    const recent = await page.getByTestId('prof-recent').innerText();
    assert.match(recent, /Court hour · Court 1/);
    assert.match(recent, /Adult beginner clinic/);
    assert.match(recent, /Cancelled/);
    assert.equal(await page.getByTestId('prof-back').getAttribute('href'), '/c/hunter/admin/customers');
    assert.equal(await page.getByRole('tab').count(), 4);
    await page.screenshot({ path: join(SHOTS, 'admin-profile.png'), fullPage: true });
    await context.close();
  });

  it('Bookings, Purchases (with receipt numbers) and Credits and wallet tabs show their lists', async () => {
    const { page, context } = await open(server());
    await page.goto(`${app.base}${url}`);
    await page.getByTestId('tab-bookings').click();
    await page.getByTestId('bookings-table').waitFor();
    assert.equal(await page.getByTestId('bookings-table').locator('tbody tr').count(), 3);
    await page.getByTestId('tab-purchases').click();
    await page.getByTestId('orders-table').waitFor();
    const o = await page.getByTestId('orders-table').innerText();
    assert.match(o, /HTC-2027-000001/);
    assert.match(o, /฿500/);
    await page.getByTestId('tab-credits').click();
    assert.equal(await page.getByTestId('wallet-balance').innerText(), '฿500');
    assert.match(await page.getByTestId('packages').innerText(), /10 hour bundle · 7 of 10 left/);
    await context.close();
  });

  it('tags: add one (sent as typed, trimmed) and remove one', async () => {
    const { page, context, calls } = await open(server());
    await page.goto(`${app.base}${url}`);
    await page.getByTestId('tag-add').click();
    await page.getByTestId('tag-input').fill(' Influencer ');
    await page.getByTestId('tag-save').click();
    await page.getByTestId('tag-remove-Influencer').waitFor();
    assert.deepEqual(calls.find((c) => c.path === `${P}/tags` && c.method === 'POST').body, { tag: 'Influencer' });
    await page.getByTestId('tag-remove-Partner gym').click();
    await page.waitForFunction(() => !document.querySelector('[data-testid="tag-remove-Partner gym"]'));
    assert.ok(calls.some((c) => c.method === 'DELETE' && c.path === `${P}/tags/Partner%20gym`));
    await context.close();
  });

  it('notes: an empty note is refused before sending, a note is added to the top of the list', async () => {
    const { page, context, calls } = await open(server());
    await page.goto(`${app.base}${url}`);
    await page.getByTestId('prof-note-add').click();
    assert.match(await page.getByTestId('prof-notes').getByTestId('prof-msg').innerText(), /Check the amount or the day/);
    assert.equal(calls.filter((c) => c.method === 'POST' && c.path.endsWith('/notes')).length, 0);
    await page.getByTestId('prof-note-text').fill('Prefers Court 1.');
    await page.getByTestId('prof-note-add').click();
    await page.getByTestId('prof-notes').getByText('Prefers Court 1.').waitFor();
    await context.close();
  });

  it('adjust balance: a reason is required; the wallet change goes out as satang with the reason; the typed refusal below zero is said in words and keeps what was typed', async () => {
    const api = server();
    const { page, context, calls } = await open(api);
    await page.goto(`${app.base}${url}`);
    await page.getByTestId('adjust-amount').fill('+200');
    await page.getByTestId('adjust-save').click();
    assert.match(await page.getByTestId('prof-adjust').getByTestId('prof-msg').innerText(), /Write a reason/);
    assert.equal(calls.filter((c) => c.path.endsWith('/wallet-adjust')).length, 0);
    await page.getByTestId('adjust-reason').fill('Goodwill after a cancelled class');
    await page.getByTestId('adjust-save').click();
    await page.getByText('Saved.').first().waitFor();
    assert.deepEqual(calls.find((c) => c.path.endsWith('/wallet-adjust')).body, { deltaSatang: 20000, note: 'Goodwill after a cancelled class' });
    api.walletAnswer = { status: 409, body: { code: 'below_zero' } };
    const refused = server({ walletAnswer: { status: 409, body: { code: 'below_zero' } } });
    const second = await open(refused);
    await second.page.goto(`${app.base}${url}`);
    await second.page.getByTestId('adjust-amount').fill('-9999');
    await second.page.getByTestId('adjust-reason').fill('Fix');
    await second.page.getByTestId('adjust-save').click();
    await second.page.getByText('This would take the balance below zero.').waitFor();
    assert.equal(await second.page.getByTestId('adjust-amount').inputValue(), '-9999');
    await second.context.close();
    await context.close();
  });

  it('adjust balance for a package credit sends the package and a whole number', async () => {
    const { page, context, calls } = await open(server());
    await page.goto(`${app.base}${url}`);
    await page.getByTestId('adjust-what').selectOption('credit');
    await page.getByTestId('adjust-amount').fill('-1');
    await page.getByTestId('adjust-reason').fill('Used at the front desk');
    await page.getByTestId('adjust-save').click();
    await page.getByText('Saved.').first().waitFor();
    assert.deepEqual(calls.find((c) => c.path.endsWith('/credit-adjust')).body, { packageId: 'p1', delta: -1, note: 'Used at the front desk' });
    await context.close();
  });

  it('extend package: the owner can; front desk sees it disabled with the Owner only mark', async () => {
    const owner = await open(server());
    await owner.page.goto(`${app.base}${url}`);
    await owner.page.getByTestId('extend-day').fill('2027-05-01');
    await owner.page.getByTestId('extend-reason').fill('Injury');
    await owner.page.getByTestId('extend-save').click();
    await owner.page.getByTestId('prof-extend').getByText('Saved.').waitFor();
    assert.deepEqual(owner.calls.find((c) => c.path === '/staff/packages/p1/extend').body, { newExpiresOn: '2027-05-01', reason: 'Injury' });
    await owner.context.close();

    const desk = await open(server(), { pages: DESK_PAGES });
    await desk.page.goto(`${app.base}${url}`);
    await desk.page.getByTestId('prof-extend').waitFor();
    assert.match(await desk.page.getByTestId('prof-extend').innerText(), /Owner only/i);
    assert.equal(await desk.page.getByTestId('extend-save').isDisabled(), true);
    assert.equal(await desk.page.getByTestId('extend-day').isDisabled(), true);
    await desk.context.close();
  });

  it('a customer who is not found, a role the server refuses and a lost network each have their own state', async () => {
    const nf = await open(() => ({ status: 404, body: { code: 'not_found' } }));
    await nf.page.goto(`${app.base}${url}`);
    await nf.page.getByTestId('prof-not-found').waitFor();
    await nf.context.close();
    const no = await open(() => ({ status: 403, body: { code: 'forbidden' } }));
    await no.page.goto(`${app.base}${url}`);
    await no.page.getByTestId('prof-forbidden').waitFor();
    await no.context.close();
    let up = false;
    const flaky = await open((...a) => (up ? server()(...a) : 'offline'));
    await flaky.page.goto(`${app.base}${url}`);
    await flaky.page.getByTestId('prof-error').waitFor();
    up = true;
    await flaky.page.getByTestId('prof-error').getByRole('button').click();
    await flaky.page.getByTestId('profile').waitFor();
    await flaky.context.close();
  });

  it('Thai and English with long names, tags and notes, at 1280 and 375 px: no sideways scroll', async () => {
    const long = server({ profile: profile({ fullName: 'นางสาวสมหญิงจริงใจสุดยอดนามสกุลยาวมากเป็นพิเศษที่สุดในโลกสุดๆ', tags: ['ยิมพาร์ทเนอร์ที่ยาวมากเป็นพิเศษ', 'Influencer', 'Partner gym', 'VIP'] }), notes: [{ noteId: 'n', note: 'บันทึกที่ยาวมากมากมากมากมากมากมากมากมากมากมากมากมากมากมากมากมากมากมากมากมาก '.repeat(3), by: 'พนักงาน', at: '2027-01-12T03:00:00Z' }] });
    for (const lang of ['th', 'en']) {
      for (const width of [1280, 375]) {
        const { page, context } = await open(long, { lang, width });
        await page.goto(`${app.base}${url}`);
        await page.getByTestId('profile').waitFor();
        assert.equal(await noSideways(page), true, `${lang} ${width} overview`);
        await page.getByTestId('tab-purchases').click();
        await page.getByTestId('orders-table').waitFor();
        assert.equal(await noSideways(page), true, `${lang} ${width} purchases`);
        await page.screenshot({ path: join(SHOTS, `admin-profile-${lang}-${width}.png`), fullPage: true });
        await context.close();
      }
    }
  });
});
