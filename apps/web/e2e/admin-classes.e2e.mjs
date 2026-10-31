// F11-T17 A8 Group classes (ADMIN-09): this week's sessions with seats and the waiting count, below minimum with Cancel session, a session's roster and waitlist, the owner's edit and
// resolve, the templates (create, change, end); front desk reads and cancels; Thai and English at 1280 and 375 px (CC-5). The API is faked in the browser; no database.
// Run: node --test --test-concurrency=1 'apps/web/e2e/*.e2e.mjs'  (one next dev at a time; Chromium is pre-installed).
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { join } from 'node:path';
import { SHOTS } from './harness.mjs';
import { chromium, DESK_PAGES, noSideways, openAdmin, startApp } from './admin-harness.mjs';

let app;
let browser;
before(async () => {
  app = await startApp(3129);
  browser = await chromium.launch();
});
after(async () => {
  await browser?.close();
  app?.stop();
});

const url = '/c/hunter/admin/classes';
const at = (hour, day) => new Date(`${day}T${String(hour).padStart(2, '0')}:00:00+07:00`).toISOString();
const COACHES = [{ coachId: 'c1', displayName: 'Coach Cat', tierId: null, active: true, published: true }, { coachId: 'c2', displayName: 'Coach Dan', tierId: null, active: true, published: true }];
const TEMPLATE = { id: 't1', nameTh: 'คลินิกผู้ใหญ่', nameEn: 'Adult clinic', audience: 'adult', level: 'Beginner', coachId: 'c1', resourceId: 'k1', weekday: 2, startTime: '19:00', durationMinutes: 60, minPlayers: 4, maxPlayers: 8, dropInPriceSatang: 30000, active: true, endedOn: null };
const S = (id, over = {}) => ({ id, templateId: 't1', startAt: at(19, '2027-01-19'), endAt: at(20, '2027-01-19'), nameTh: 'คลินิกผู้ใหญ่', nameEn: 'Adult clinic', audience: 'adult', level: 'Beginner', coachId: 'c1', resourceId: 'k1', minPlayers: 4, maxPlayers: 8, dropInPriceSatang: 30000, status: 'scheduled', attentionReason: null, cancelReason: null, edited: false, taken: 6, waiting: 2, ...over });
const SESSIONS = [S('s1'), S('s2', { startAt: at(18, '2027-01-21'), endAt: at(19, '2027-01-21'), taken: 2, waiting: 0 }), S('s3', { startAt: at(19, '2027-01-26'), endAt: at(20, '2027-01-26'), status: 'needs_attention', attentionReason: 'coach_leave' })];

function server(state = {}) {
  const s = { templates: [TEMPLATE], sessions: SESSIONS, ...state };
  return (method, path, search, body) => {
    if (path === '/courts') return { status: 200, body: { status: 'live', today: '2027-01-20', bookingWindowDays: 14, courts: [{ id: 'k1', name: '1', sport: 'tennis' }, { id: 'k2', name: '2', sport: 'tennis' }], openingHours: [] } };
    if (path === '/staff/coaches') return { status: 200, body: COACHES };
    if (path === '/staff/class-templates' && method === 'GET') return { status: 200, body: s.templates };
    if (path === '/staff/class-templates' && method === 'POST') return s.create ?? { status: 200, body: { id: 't2', made: 12, needsAttention: 1 } };
    if (path === '/staff/class-templates/t1' && method === 'PUT') return s.put ?? (body.end ? { status: 200, body: { ended: true, cancelled: 3, failed: 0 } } : { status: 200, body: { rewritten: 2, cancelled: 0, generated: 1 } });
    if (path === '/staff/class-sessions' && method === 'GET') return { status: 200, body: s.sessions.filter((x) => (search.includes('from=2027-01-18') ? x.id !== 's3' : x.id === 's3' || search.includes('to=2027-02'))) };
    if (/^\/staff\/class-sessions\/[^/]+\/roster$/.test(path)) return { status: 200, body: [{ bookingId: 'b1', customerId: 'u1', displayName: 'Pat Player', status: 'confirmed', holdExpiresAt: null }] };
    if (path === '/staff/waitlist') return { status: 200, body: [{ entryId: 'w1', customerId: 'u2', displayName: 'Wait Wan', kind: 'class', sessionId: 's1', resourceId: null, slotStartAt: null, position: 1, status: 'waiting', offerExpiresAt: null }] };
    if (/^\/staff\/class-sessions\/[^/]+\/cancel$/.test(path)) return s.cancel ?? { status: 200, body: { seats: 6, entries: 2 } };
    if (/^\/staff\/class-sessions\/[^/]+\/resolve$/.test(path)) return { status: 200, body: { resolved: true, reason: null } };
    if (/^\/staff\/class-sessions\/[^/]+$/.test(path) && method === 'PUT') return s.edit ?? { status: 200, body: { edited: true } };
    if (path === '/settings') return { status: 200, body: [{ key: 'rest_cap_hours', value: 3, unset: false, required: false, available: true }] };
    return undefined;
  };
}
const open = (api, o) => openAdmin(browser, api, o);
const writes = (calls, re) => calls.filter((c) => c.method !== 'GET' && re.test(c.path));

describe('A8 Group classes, sessions', () => {
  it('this week\'s sessions show date, time, court, coach, seats taken of most, the minimum, the waiting count and the status', async () => {
    const { page, context } = await open(server());
    await page.goto(`${app.base}${url}`);
    await page.getByTestId('cls-week').waitFor();
    assert.match(await page.getByTestId('cls-summary').innerText(), /1 templates · 2 sessions this week/);
    const t = await page.getByTestId('session-s1').innerText();
    assert.match(t, /Adult clinic/);
    assert.match(t, /Court 1/);
    assert.match(t, /Coach Cat/);
    assert.match(t, /Group class · 6 of 8/);
    assert.match(t, /needs 4/);
    assert.match(t, /2 waiting/);
    assert.match(await page.getByTestId('status-s1').innerText(), /Scheduled/);
    assert.match(await page.getByTestId('cls-range').innerText(), /18 January 2027 – 24 January 2027/);
    assert.equal(await page.getByTestId('nav-classes').getAttribute('aria-current'), 'page');
    await page.screenshot({ path: join(SHOTS, 'admin-classes.png'), fullPage: true });
    await context.close();
  });

  it('a session below its minimum is listed with Cancel session; cancelling asks, sends below_minimum, and says the seats were given back', async () => {
    const { page, context, calls } = await open(server());
    page.on('dialog', (d) => void d.accept());
    await page.goto(`${app.base}${url}`);
    await page.getByTestId('cls-below').waitFor();
    assert.match(await page.getByTestId('below-s2').innerText(), /2 booked, needs 4/);
    assert.equal(await page.getByTestId('below-s1').count(), 0);
    await page.getByTestId('below-cancel-s2').click();
    await page.getByTestId('cls-msg').waitFor();
    assert.deepEqual(writes(calls, /cancel$/)[0].body, { reason: 'below_minimum' });
    assert.match(await page.getByTestId('cls-msg').innerText(), /6 seats were given back in full/);
    await context.close();
  });

  it('the roster and the waiting list of a session open on demand', async () => {
    const { page, context } = await open(server());
    await page.goto(`${app.base}${url}`);
    await page.getByTestId('roster-s1').click();
    await page.getByTestId('roster-panel-s1').getByText('Pat Player').waitFor();
    assert.match(await page.getByTestId('roster-panel-s1').innerText(), /1\. Wait Wan/);
    await context.close();
  });

  it('the owner edits one session (only what changed is sent), and resolves one that needs attention', async () => {
    const { page, context, calls } = await open(server());
    await page.goto(`${app.base}${url}`);
    await page.getByTestId('edit-s1').click();
    await page.getByTestId('sed-save-s1').click();
    await page.getByTestId('cls-msg').waitFor();
    assert.equal(writes(calls, /class-sessions\/s1$/).length, 0);
    await page.getByTestId('sed-coach-s1').selectOption('c2');
    await page.getByTestId('sed-max-s1').fill('10');
    await page.getByTestId('sed-save-s1').click();
    await page.waitForFunction(() => document.querySelector('[data-testid="cls-msg"]')?.getAttribute('role') === 'status');
    assert.deepEqual(writes(calls, /class-sessions\/s1$/)[0].body, { coachId: 'c2', maxPlayers: 10 });
    await page.getByTestId('cls-next').click();
    await page.getByTestId('resolve-s3').click();
    await page.getByTestId('cls-msg').waitFor();
    assert.equal(writes(calls, /resolve$/).length, 1);
    await context.close();
  });

  it('front desk reads and can cancel, but has no edit, resolve or template buttons', async () => {
    const { page, context } = await open(server(), { pages: DESK_PAGES.concat(['A8']) });
    await page.goto(`${app.base}${url}`);
    await page.getByTestId('cls-week').waitFor();
    assert.equal(await page.getByTestId('edit-s1').count(), 0);
    assert.equal(await page.getByTestId('cancel-s1').count(), 1);
    assert.equal(await page.getByTestId('tpl-new').count(), 0);
    assert.equal(await page.getByTestId('tpl-edit-t1').count(), 0);
    assert.equal(await page.getByTestId('cls-note').count(), 0);
    await context.close();
  });
});

describe('A8 Group classes, templates', () => {
  it('lists a template with its weekday, hour, length, min to max, court, coach and drop-in price; the hours-in-a-row note uses the club\'s own setting', async () => {
    const { page, context } = await open(server());
    await page.goto(`${app.base}${url}`);
    const t = await page.getByTestId('tpl-t1').innerText();
    assert.match(t, /Adult clinic/);
    assert.match(t, /Tue 19:00/);
    assert.match(t, /60 min/);
    assert.match(t, /4 to 8 players/);
    assert.match(t, /฿300/);
    assert.match(await page.getByTestId('cls-note').innerText(), /past 3 hours in a row/);
    await context.close();
  });

  it('a new template is checked first, then sent whole (60 minutes, on the hour); the result says how many sessions were made', async () => {
    const { page, context, calls } = await open(server());
    await page.goto(`${app.base}${url}`);
    await page.getByTestId('tpl-create').click();
    await page.getByTestId('cls-msg').waitFor();
    assert.equal(writes(calls, /class-templates$/).length, 0);
    await page.getByTestId('tn-nameTh').fill('คลินิก');
    await page.getByTestId('tn-nameEn').fill('Clinic');
    await page.getByTestId('tn-coach').selectOption('c1');
    await page.getByTestId('tn-court').selectOption('k2');
    await page.getByTestId('tn-weekday').selectOption('6');
    await page.getByTestId('tn-hour').selectOption('9');
    await page.getByTestId('tn-min').fill('3');
    await page.getByTestId('tn-max').fill('6');
    await page.getByTestId('tpl-create').click();
    await page.waitForFunction(() => /12 sessions were made/.test(document.querySelector('[data-testid="cls-msg"]')?.textContent ?? ''));
    assert.deepEqual(writes(calls, /class-templates$/)[0].body, { nameTh: 'คลินิก', nameEn: 'Clinic', audience: 'adult', level: null, coachId: 'c1', resourceId: 'k2', weekday: 6, startTime: '09:00', durationMinutes: 60, minPlayers: 3, maxPlayers: 6, dropInPriceSatang: null });
    await context.close();
  });

  it('a clash is refused in words with the dates; a change sends only what changed; ending asks first and says how many sessions were cancelled', async () => {
    const clash = await open(server({ create: { status: 409, body: { code: 'template_clash', params: { dates: '2027-01-26,2027-02-02', reasons: 'booking' } } } }));
    await clash.page.goto(`${app.base}${url}`);
    await clash.page.getByTestId('tn-nameTh').fill('ก');
    await clash.page.getByTestId('tn-nameEn').fill('A');
    await clash.page.getByTestId('tn-coach').selectOption('c1');
    await clash.page.getByTestId('tn-court').selectOption('k1');
    await clash.page.getByTestId('tn-weekday').selectOption('2');
    await clash.page.getByTestId('tn-hour').selectOption('19');
    await clash.page.getByTestId('tn-min').fill('3');
    await clash.page.getByTestId('tn-max').fill('6');
    await clash.page.getByTestId('tpl-create').click();
    await clash.page.waitForFunction(() => /would clash on:.*26 January 2027/.test(document.querySelector('[data-testid="cls-msg"]')?.textContent ?? ''));
    await clash.context.close();
    const a = await open(server());
    a.page.on('dialog', (d) => void d.accept());
    await a.page.goto(`${app.base}${url}`);
    await a.page.getByTestId('tpl-edit-t1').click();
    await a.page.getByTestId('te-t1-max').fill('10');
    await a.page.getByTestId('tpl-save-t1').click();
    await a.page.waitForFunction(() => /Template changed/.test(document.querySelector('[data-testid="cls-msg"]')?.textContent ?? ''));
    assert.deepEqual(writes(a.calls, /class-templates\/t1$/)[0].body, { maxPlayers: 10 });
    await a.page.getByTestId('tpl-end-t1').click();
    await a.page.waitForFunction(() => /3 future sessions were cancelled/.test(document.querySelector('[data-testid="cls-msg"]')?.textContent ?? ''));
    assert.deepEqual(writes(a.calls, /class-templates\/t1$/)[1].body, { end: true });
    await a.context.close();
  });

  it('a refused role and a lost network have their own states', async () => {
    const no = await open(() => ({ status: 403, body: { code: 'forbidden' } }));
    await no.page.goto(`${app.base}${url}`);
    await no.page.getByTestId('cls-forbidden').waitFor();
    await no.context.close();
    const off = await open(() => 'offline');
    await off.page.goto(`${app.base}${url}`);
    await off.page.getByTestId('cls-error').waitFor();
    await off.context.close();
  });

  for (const lang of ['th', 'en']) {
    for (const width of [1280, 375]) {
      it(`${lang} at ${width}px: no sideways scroll with long names, the roster and the forms open`, async () => {
        const long = 'คลินิกเทนนิสสำหรับผู้ใหญ่ระดับกลางถึงสูง Adult intermediate to advanced drill clinic with extended name';
        const api = server({ templates: [{ ...TEMPLATE, nameTh: long, nameEn: long }], sessions: [S('s1', { nameTh: long, nameEn: long })] });
        const { page, context } = await open(api, { lang, width });
        await page.goto(`${app.base}${url}`);
        await page.getByTestId('cls-week').waitFor();
        assert.equal(await noSideways(page), true);
        await page.getByTestId('roster-s1').click();
        await page.getByTestId('roster-panel-s1').getByText('Pat Player').waitFor();
        await page.getByTestId('edit-s1').click();
        await page.getByTestId('tpl-edit-t1').click();
        assert.equal(await noSideways(page), true);
        await page.screenshot({ path: join(SHOTS, `admin-classes-${lang}-${width}.png`), fullPage: true });
        await context.close();
      });
    }
  }
});
