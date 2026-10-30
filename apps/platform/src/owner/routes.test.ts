import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createOwnerService, createStubInviteMailer, type InviteMail } from './owner';
import { createTesterService } from '../testers/testers';
import { ownerRoutes } from './routes';
import { testerRoutes } from '../testers/routes';
import { createHarness, type Harness } from '../http/testkit';
import { completeSetup } from '../../../../packages/db/src/setup-fixture';

// Owner invite, owner contact and tester routes over HTTP (SR-01, D122, ROLE-02-AC8, PLAT-07-AC5, D4).
const CLUB = '3f2b8f0e-7c1d-4a55-9d0a-1c2e3f4a5b6c';
let h: Harness;
let mails: InviteMail[];

beforeEach(async () => {
  mails = [];
  h = await createHarness((pdb) => [
    ...ownerRoutes({ owner: createOwnerService({ db: pdb, mailer: createStubInviteMailer(mails), baseUrl: 'https://app.example' }) }),
    ...testerRoutes({ testers: createTesterService({ db: pdb, baseUrl: 'https://app.example' }) }),
  ]);
  await h.tdb.query(`insert into public.club (id, slug, name_th, name_en) values ($1,'a','ก','A')`, [CLUB]);
  await h.tdb.query(`insert into platform.staff_assignment (staff_id, club_id) values ($1,$2)`, [h.ids.spec, CLUB]);
  await completeSetup(h.tdb, CLUB);
  await h.tdb.query(`insert into platform.config (key, value) values ('tester_invite_ttl_hours', '720')`);
});
afterEach(async () => h.close());

describe('owner invite (SR-01, D122)', () => {
  it('the link is emailed to the owner and never in the answer; the console sees status only', async () => {
    const r = await h.call('POST', `/clubs/${CLUB}/owner-invite`, { body: {}, as: 'spec' });
    expect([r.status, r.body]).toEqual([200, { status: 'sent' }]);
    expect(mails).toHaveLength(1);
    expect(mails[0]!.to).toBe('nok@example.com');
    expect(JSON.stringify(r.body)).not.toContain('invite=');
    const status = await h.call('GET', `/clubs/${CLUB}/owner-invite`, { as: 'spec' });
    expect(status.status).toBe(200);
    expect(JSON.stringify(status.body)).not.toMatch(/token|invite=|https:/);
  });
  it('needs a fresh second factor; an unassigned specialist gets 404; a guest 401', async () => {
    expect((await h.call('POST', `/clubs/${CLUB}/owner-invite`, { body: {}, as: 'spec', fresh: false })).body).toEqual({ code: 'step_up_required' });
    expect((await h.call('POST', `/clubs/${CLUB}/owner-invite`, { body: {}, as: 'loner' })).status).toBe(404);
    expect((await h.call('POST', `/clubs/${CLUB}/owner-invite`, { body: {}, as: null })).status).toBe(401);
    expect(mails).toHaveLength(0);
  });
  it('without an owner contact the invite is 409 owner_contact_missing', async () => {
    await h.tdb.query(`update public.club set owner_email = null where id = $1`, [CLUB]);
    expect((await h.call('POST', `/clubs/${CLUB}/owner-invite`, { body: {}, as: 'spec' })).body).toEqual({ code: 'owner_contact_missing' });
  });
});

describe('owner contact changes (ROLE-02-AC8)', () => {
  it('a specialist change waits for a second admin; the same admin cannot approve their own', async () => {
    const asked = await h.call('PUT', `/clubs/${CLUB}/owner-contact`, { body: { owner_phone: '+66899999999' }, as: 'spec' });
    expect(asked.status).toBe(200);
    expect(typeof asked.body.applied).toBe('boolean');
    expect((await h.call('PUT', `/clubs/${CLUB}/owner-contact`, { body: { role: 'x' }, as: 'spec' })).status).toBe(400);
    expect((await h.call('PUT', `/clubs/${CLUB}/owner-contact`, { body: { owner_email: 'not-an-email' }, as: 'spec' })).status).toBe(400);
  });
});

describe('testers (PLAT-07-AC5, D4)', () => {
  it('lists, and creates an invite link for a BOOQ tester, which goes to the staff member who asked', async () => {
    await h.tdb.query(`update public.club set status = 'testing' where id = $1`, [CLUB]);
    const made = await h.call('POST', `/clubs/${CLUB}/testers`, { body: {}, as: 'spec' });
    expect(made.status).toBe(200);
    expect(made.body.link).toMatch(/^https:\/\/app\.example\/c\/a\/join\?invite=/);
    const list = await h.call('GET', `/clubs/${CLUB}/testers`, { as: 'spec' });
    expect(list.status).toBe(200);
    expect(list.body.pendingInvites).toBe(1);
  });
  it('an unassigned specialist gets 404; a Live club cannot take a tester invite', async () => {
    expect((await h.call('GET', `/clubs/${CLUB}/testers`, { as: 'loner' })).status).toBe(404);
    await h.tdb.query(`update public.club set status = 'live' where id = $1`, [CLUB]);
    expect((await h.call('POST', `/clubs/${CLUB}/testers`, { body: {}, as: 'spec' })).body).toEqual({ code: 'not_available' });
  });
  it('removing a tester that is not there is 404', async () => {
    expect((await h.call('POST', `/clubs/${CLUB}/testers/99999999-9999-4999-8999-999999999999/remove`, { as: 'spec' })).status).toBe(404);
  });
});
