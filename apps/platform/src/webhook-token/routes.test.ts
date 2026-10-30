import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createWebhookTokenService } from './webhook-token';
import { webhookTokenRoutes } from './routes';
import { createHarness, type Harness } from '../http/testkit';

// The token action over HTTP: admin only, a fresh second factor, the plain token only in the one answer.
const CLUB = '3f2b8f0e-7c1d-4a55-9d0a-1c2e3f4a5b6c';
let h: Harness;
beforeEach(async () => {
  h = await createHarness((pdb) => webhookTokenRoutes({ webhookTokens: createWebhookTokenService({ db: pdb, baseUrl: 'https://app.booq.example' }) }));
  await h.tdb.query(`insert into public.club (id, slug, name_th, name_en, status) values ($1,'a','ก','A','testing')`, [CLUB]);
  await h.tdb.query(`insert into platform.staff_assignment (staff_id, club_id) values ($1,$2)`, [h.ids.spec, CLUB]);
});
afterEach(async () => h.close());

describe('POST /clubs/:id/webhook-tokens/:kind', () => {
  it('an admin with a fresh second factor gets the token and the address', async () => {
    const r = await h.call('POST', `/clubs/${CLUB}/webhook-tokens/line`, { body: {}, as: 'admin' });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ replaced: false, token: expect.any(String) });
    expect(r.body.url).toBe(`https://app.booq.example/api/webhooks/line/${r.body.token}`);
  });
  it('a specialist is 403, a stale second factor 403 step_up_required, a guest 401', async () => {
    expect((await h.call('POST', `/clubs/${CLUB}/webhook-tokens/line`, { body: {}, as: 'spec' })).status).toBe(403);
    const stale = await h.call('POST', `/clubs/${CLUB}/webhook-tokens/line`, { body: {}, as: 'admin', fresh: false });
    expect([stale.status, stale.body]).toEqual([403, { code: 'step_up_required' }]);
    expect((await h.call('POST', `/clubs/${CLUB}/webhook-tokens/line`, { body: {}, as: null })).status).toBe(401);
  });
  it('an unknown kind is 400 and an unknown club 404', async () => {
    expect((await h.call('POST', `/clubs/${CLUB}/webhook-tokens/slack`, { body: {}, as: 'admin' })).status).toBe(400);
    expect((await h.call('POST', `/clubs/aaaaaaaa-0000-4000-8000-0000000000ff/webhook-tokens/line`, { body: {}, as: 'admin' })).status).toBe(404);
  });
});
