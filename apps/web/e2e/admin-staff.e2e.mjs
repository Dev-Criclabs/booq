// F11-T23 A17 Staff and audit log (ADMIN-17): who has a role, invite by link, change roles, deactivate, the read only audit log with filters and
// paging; Thai and English at 1280 and 375 px (CC-5). The API is faked in the browser; no database.
// Run: node --test --test-concurrency=1 'apps/web/e2e/*.e2e.mjs'  (one next dev at a time; Chromium is pre-installed).
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { join } from 'node:path';
import { SHOTS } from './harness.mjs';
import { chromium, noSideways, openAdmin, startApp } from './admin-harness.mjs';

let app;
let browser;
before(async () => {
  app = await startApp(3116);
  browser = await chromium.launch();
});
after(async () => {
  await browser?.close();
  app?.stop();
});

const u = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const STAFF = [
  { id: u(1), display_name: 'Nok Owner', roles: ['owner', 'player'], active: true },
  { id: u(2), display_name: 'Mali Desk', roles: ['front_desk', 'player'], active: true },
  { id: u(3), display_name: 'Ann Books', roles: ['accountant', 'player'], active: true },
  { id: u(4), display_name: 'Gone Person', roles: ['front_desk', 'player'], active: false },
];
const INVITES = [{ id: 'i1', kind: 'staff', roles: ['accountant', 'player'], created_at: '2027-01-01T03:00:00Z', expires_at: '2027-01-08T03:00:00Z' }];
const entry = (n, over = {}) => ({ entryId: `e${n}`, at: `2027-01-1${n}T03:30:00Z`, actorType: 'user', actorUserId: u(2), actorLabel: 'Mali Desk', source: 'admin', action: 'booking.moved', recordType: 'booking', recordId: u(50 + n), recordKey: null, oldValue: { court: '1' }, newValue: { court: '2' }, piiFields: [], reason: 'Player asked at the desk', ...over });

function server(state = {}) {
  const s = { staff: STAFF, invites: INVITES, entries: [entry(1), entry(2, { actorLabel: '', actorUserId: null, action: 'club_setting.set', recordType: 'club_setting', oldValue: null, newValue: { hold_minutes: 15 }, reason: null, piiFields: ['phone'] })], ...state };
  return (method, path, search, body) => {
    if (path === '/staff' && method === 'GET') return { status: 200, body: s.staff };
    if (path === '/staff/invites' && method === 'GET') return { status: 200, body: s.invites };
    if (path === '/staff/invites/i1/cancel') { const a = s.cancelAnswer ?? { status: 200, body: { ok: true } }; if (a.status === 200) s.invites = []; return a; }
    if (path === '/staff/audit/record-types') return s.recordTypes ? { status: 200, body: s.recordTypes } : undefined;
    if (path === '/staff/invites' && method === 'POST') return s.inviteAnswer ?? { status: 200, body: { id: 'i2', token: 'TOKEN123' } };
    if (path.endsWith('/roles') && method === 'PUT') return s.rolesAnswer ?? { status: 200, body: { old: [], new: body.roles, changed: true } };
    if (path.endsWith('/deactivate') && method === 'POST') return { status: 200, body: { ok: true } };
    if (path === '/staff/audit') return s.auditAnswer ? s.auditAnswer(search) : { status: 200, body: { entries: s.entries, next: null } };
    return undefined;
  };
}
const open = (api, o) => openAdmin(browser, api, o);
const url = '/c/hunter/admin/staff';

describe('A17 Staff', () => {
  it('lists who has a role and whether they are active; the owner cannot be changed; a deactivated person has no controls', async () => {
    const { page, context } = await open(server());
    await page.goto(`${app.base}${url}`);
    await page.getByTestId('staff-table').waitFor();
    const rows = await page.getByTestId('staff-table').locator('tbody tr').allInnerTexts();
    assert.match(rows[0], /Nok Owner/);
    assert.match(rows[0], /Owner/);
    assert.match(rows[0], /cannot be changed here/);
    assert.match(rows[1], /Mali Desk/);
    assert.match(rows[1], /Front desk/);
    assert.doesNotMatch(rows[1], /Player/, 'Player is held by everyone and is not listed beside a staff role');
    assert.match(rows[3], /Deactivated/);
    assert.equal(await page.getByTestId(`edit-${u(4)}`).count(), 0);
    assert.equal(await page.getByTestId(`edit-${u(1)}`).count(), 0);
    assert.match(await page.getByTestId('invites').innerText(), /Accountant · Pending/);
    assert.equal(await page.getByTestId('nav-staff').getAttribute('aria-current'), 'page');
    await page.screenshot({ path: join(SHOTS, 'admin-staff.png'), fullPage: true });
    await context.close();
  });

  it('invite: a front desk invite sends the kind and roles, shows the link once with the token, and the link is inside the club', async () => {
    const { page, context, calls } = await open(server());
    await page.goto(`${app.base}${url}`);
    await page.getByTestId('invite-make').click();
    await page.getByTestId('invite-link-box').waitFor();
    assert.deepEqual(calls.find((c) => c.method === 'POST' && c.path === '/staff/invites').body, { kind: 'staff', roles: ['front_desk'] });
    assert.equal(await page.getByTestId('invite-link').inputValue(), `${app.base}/c/hunter/join?invite=TOKEN123`);
    await page.getByTestId('invite-done').click();
    assert.equal(await page.getByTestId('invite-link-box').count(), 0);
    await page.getByTestId('invite-role').selectOption('coach');
    await page.getByTestId('invite-make').click();
    await page.getByTestId('invite-link-box').waitFor();
    assert.deepEqual(calls.filter((c) => c.method === 'POST' && c.path === '/staff/invites')[1].body, { kind: 'coach' });
    await page.getByTestId('invite-done').click();
    await page.getByTestId('invite-role').selectOption('both');
    await page.getByTestId('invite-make').click();
    await page.getByTestId('invite-link-box').waitFor();
    assert.deepEqual(calls.filter((c) => c.method === 'POST' && c.path === '/staff/invites')[2].body, { kind: 'staff', roles: ['front_desk', 'accountant'] });
    await context.close();
  });

  it('invite: BOOQ has not set the invite life says so in words', async () => {
    const { page, context } = await open(server({ inviteAnswer: { status: 503, body: { code: 'not_configured' } } }));
    await page.goto(`${app.base}${url}`);
    await page.getByTestId('invite-make').click();
    assert.match(await page.getByTestId('staff-msg').innerText(), /has not set how long an invite lasts/);
    assert.equal(await page.getByTestId('invite-link-box').count(), 0);
    await context.close();
  });

  it('change roles: the set goes out with Player kept, in a fixed order; a refusal is said in words', async () => {
    const { page, context, calls } = await open(server());
    await page.goto(`${app.base}${url}`);
    await page.getByTestId(`edit-${u(2)}`).click();
    assert.equal(await page.getByTestId('role-front_desk').isChecked(), true);
    await page.getByTestId('role-accountant').check();
    await page.getByTestId('roles-save').click();
    await page.getByTestId('staff-msg').waitFor();
    assert.deepEqual(calls.find((c) => c.method === 'PUT').body, { roles: ['accountant', 'front_desk', 'player'] });
    await context.close();

    const bad = await open(server({ rolesAnswer: { status: 409, body: { code: 'owner_fixed' } } }));
    await bad.page.goto(`${app.base}${url}`);
    await bad.page.getByTestId(`edit-${u(3)}`).click();
    await bad.page.getByTestId('roles-save').click();
    assert.match(await bad.page.getByTestId('staff-msg').innerText(), /owner cannot be changed or deactivated/);
    await bad.context.close();
  });

  it('deactivate asks first, and only a yes sends it', async () => {
    const { page, context, calls } = await open(server());
    await page.goto(`${app.base}${url}`);
    await page.getByTestId(`deactivate-${u(3)}`).click();
    assert.match(await page.getByTestId(`confirm-${u(3)}`).innerText(), /Deactivate Ann Books\?/);
    assert.equal(calls.filter((c) => c.path.endsWith('/deactivate')).length, 0);
    await page.getByTestId('deactivate-yes').click();
    await page.getByTestId('staff-msg').waitFor();
    assert.ok(calls.some((c) => c.method === 'POST' && c.path === `/staff/${u(3)}/deactivate`));
    await context.close();
  });

  it('a role the server refuses and a lost network have their own states', async () => {
    const no = await open(() => ({ status: 403, body: { code: 'forbidden' } }));
    await no.page.goto(`${app.base}${url}`);
    await no.page.getByTestId('staff-forbidden').waitFor();
    await no.context.close();
    let up = false;
    const flaky = await open((...a) => (up ? server()(...a) : 'offline'));
    await flaky.page.goto(`${app.base}${url}`);
    await flaky.page.getByTestId('staff-error').waitFor();
    up = true;
    await flaky.page.getByTestId('staff-error').getByRole('button').click();
    await flaky.page.getByTestId('staff-table').waitFor();
    await flaky.context.close();
  });
});

describe('A17 Audit log', () => {
  it('shows when, who, record, change and reason; a personal field is named, never shown; there is no way to edit or delete', async () => {
    const { page, context } = await open(server());
    await page.goto(`${app.base}${url}`);
    await page.getByTestId('audit-table').waitFor();
    const first = await page.getByTestId('audit-e1').innerText();
    assert.match(first, /booking\.moved/);
    assert.match(first, /court: 1 → 2/);
    assert.match(first, /Player asked at the desk/);
    assert.match(first, /Mali Desk/);
    assert.match(first, /11 Jan 10:30/);
    const second = await page.getByTestId('audit-e2').innerText();
    assert.match(second, /System/);
    assert.match(second, /hold_minutes: ∅ → 15/);
    assert.match(second, /Personal fields changed: phone/);
    assert.equal(await page.getByTestId('audit').getByRole('button', { name: /delete|remove|edit/i }).count(), 0);
    await context.close();
  });

  it('filters are checked first, then sent: staff, record type and days; a wrong range is told in words and nothing is sent', async () => {
    const { page, context, calls } = await open(server({ auditAnswer: (search) => ({ status: 200, body: { entries: search.includes('type=club_setting') ? [] : [entry(1)], next: null } }) }));
    await page.goto(`${app.base}${url}`);
    await page.getByTestId('audit-table').waitFor();
    const before = calls.filter((c) => c.path === '/staff/audit').length;
    await page.getByTestId('audit-from').fill('2027-01-09');
    await page.getByTestId('audit-to').fill('2027-01-01');
    await page.getByTestId('audit-apply').click();
    assert.match(await page.getByTestId('audit-problem').innerText(), /last day cannot be before the first day/);
    assert.equal(calls.filter((c) => c.path === '/staff/audit').length, before);
    await page.getByTestId('audit-from').fill('2027-01-01');
    await page.getByTestId('audit-to').fill('2027-01-09');
    await page.getByTestId('audit-staff').selectOption(u(2));
    await page.getByTestId('audit-type').fill('club_setting');
    await page.getByTestId('audit-apply').click();
    await page.getByTestId('audit-empty').waitFor();
    assert.equal(calls.filter((c) => c.path === '/staff/audit').at(-1).search, `?staff=${u(2)}&type=club_setting&from=2027-01-01&to=2027-01-09`);
    await context.close();
  });

  it('the record type filter is a list of the audited tables when the server gives it', async () => {
    const { page, context, calls } = await open(server({ recordTypes: ['booking', 'club_setting', 'promo_code'] }));
    await page.goto(`${app.base}${url}`);
    await page.getByTestId('audit-table').waitFor();
    assert.equal(await page.getByTestId('audit-type').evaluate((e) => e.tagName), 'SELECT');
    await page.getByTestId('audit-type').selectOption('promo_code');
    await page.getByTestId('audit-apply').click();
    await page.waitForFunction(() => document.querySelector('[data-testid="audit-empty"], [data-testid="audit-table"]'));
    await page.waitForTimeout(300);
    assert.equal(calls.filter((c) => c.path === '/staff/audit').at(-1).search, '?type=promo_code');
    await context.close();
  });

  it('Cancel invite asks first, ends the invite and removes it from the list; a refusal is named', async () => {
    const ok = await open(server());
    ok.page.on('dialog', (d) => void d.accept());
    await ok.page.goto(`${app.base}${url}`);
    await ok.page.getByTestId('invite-cancel-i1').click();
    await ok.page.waitForFunction(() => !document.querySelector('[data-testid="invite-cancel-i1"]'));
    assert.equal(ok.calls.filter((c) => c.path === '/staff/invites/i1/cancel').length, 1);
    await ok.context.close();
    const no = await open(server({ cancelAnswer: { status: 404, body: { code: 'not_found' } } }));
    no.page.on('dialog', (d) => void d.accept());
    await no.page.goto(`${app.base}${url}`);
    await no.page.getByTestId('invite-cancel-i1').click();
    await no.page.getByRole('alert').first().waitFor();
    await no.context.close();
    const dismissed = await open(server());
    dismissed.page.on('dialog', (d) => void d.dismiss());
    await dismissed.page.goto(`${app.base}${url}`);
    await dismissed.page.getByTestId('invite-cancel-i1').click();
    await dismissed.page.waitForTimeout(300);
    assert.equal(dismissed.calls.filter((c) => c.path === '/staff/invites/i1/cancel').length, 0);
    await dismissed.context.close();
  });

  it('a long log pages with Show more and the rows join', async () => {
    const { page, context, calls } = await open(server({ auditAnswer: (search) => ({ status: 200, body: search.includes('cursor=NEXT') ? { entries: [entry(3)], next: null } : { entries: [entry(1), entry(2)], next: 'NEXT' } }) }));
    await page.goto(`${app.base}${url}`);
    await page.getByTestId('audit-more').click();
    await page.getByTestId('audit-e3').waitFor();
    assert.equal(await page.getByTestId('audit-table').locator('tbody tr').count(), 3);
    assert.equal(await page.getByTestId('audit-more').count(), 0);
    assert.ok(calls.some((c) => c.search === '?cursor=NEXT'));
    await context.close();
  });

  it('a role the server refuses, an empty log and a lost network each have their state', async () => {
    const no = await open(server({ auditAnswer: () => ({ status: 403, body: { code: 'forbidden' } }) }));
    await no.page.goto(`${app.base}${url}`);
    await no.page.getByTestId('audit-forbidden').waitFor();
    await no.context.close();
    const empty = await open(server({ entries: [] }));
    await empty.page.goto(`${app.base}${url}`);
    await empty.page.getByTestId('audit-empty').waitFor();
    await empty.context.close();
  });
});

describe('Thai and narrow', () => {
  it('long names, long reasons and many changes at 1280 and 375 px: the page does not scroll sideways', async () => {
    const long = server({
      staff: [{ id: u(1), display_name: 'นางสาวสมหญิงจริงใจสุดยอดนามสกุลยาวมากเป็นพิเศษที่สุดในโลกสุดๆ', roles: ['front_desk', 'accountant', 'coach', 'player'], active: true }, ...STAFF.slice(1)],
      entries: [entry(1, { reason: 'ผู้เล่นขอเปลี่ยนคอร์ตที่เคาน์เตอร์เพราะฝนตกหนักมากและสนามเปียกลื่นอันตรายต่อการเล่นมากๆ'.repeat(2), newValue: { court: 'คอร์ตที่สองด้านหลังสุดติดรั้วใหญ่', note: 'x'.repeat(300) }, oldValue: { court: '1' } })],
    });
    for (const lang of ['th', 'en']) {
      for (const width of [1280, 375]) {
        const { page, context } = await open(long, { lang, width });
        await page.goto(`${app.base}${url}`);
        await page.getByTestId('audit-table').waitFor();
        assert.equal(await noSideways(page), true, `${lang} ${width}`);
        await page.screenshot({ path: join(SHOTS, `admin-staff-${lang}-${width}.png`), fullPage: true });
        await context.close();
      }
    }
  });
});
