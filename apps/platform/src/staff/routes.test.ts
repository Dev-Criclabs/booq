import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { staffRoutes } from './routes';
import { createStaffInviteClient } from './staff-invite-client';
import { createTeamService } from './list';
import { createHarness, type Harness } from '../http/testkit';

// The staff management routes: admin only, thin over the signed calls to apps/staff-invite, sessions ended after a reset or deactivation.
const NOW = new Date('2026-10-30T10:00:00Z');
let h: Harness;
let sent: Array<{ path: string; body: Record<string, unknown> }>;
let ended: string[];
let answerWith: { status: number; json: unknown };

beforeEach(async () => {
  sent = [];
  ended = [];
  answerWith = { status: 200, json: { ok: true } };
  const fake = (async (url: string, init: { body: string }) => {
    sent.push({ path: new URL(url).pathname, body: JSON.parse(init.body) });
    return new Response(JSON.stringify(answerWith.json), { status: answerWith.status });
  }) as unknown as typeof fetch;
  h = await createHarness((pdb) => staffRoutes({ staff: createStaffInviteClient({ url: 'https://invite.internal', signingSecret: 's'.repeat(40), fetch: fake, now: () => NOW, endSessionsFor: async (id) => void ended.push(id) }), consoleBaseUrl: 'https://console.example/', team: createTeamService({ db: pdb }) }));
});
afterEach(async () => h.close());

describe('staff management', () => {
  it('an admin invites; the actor and the freshness of their second factor go to the other app', async () => {
    answerWith = { status: 200, json: { staffId: 'new-staff', enrolmentToken: 'TOKEN-for-the-new-teammate' } };
    const r = await h.call('POST', '/staff', { body: { email: 'n@booq.example', displayName: 'New', role: 'onboarding_specialist' }, as: 'admin' });
    expect([r.status, r.body]).toEqual([200, { staffId: 'new-staff', enrolmentLink: 'https://console.example/enrol#TOKEN-for-the-new-teammate' }]);
    expect(sent[0]).toEqual({ path: '/invite', body: { actorStaffId: h.ids.admin, stepUpFresh: true, email: 'n@booq.example', displayName: 'New', role: 'onboarding_specialist' } });
    await h.call('POST', '/staff', { body: { email: 'n@booq.example', displayName: 'New', role: 'onboarding_specialist' }, as: 'admin', fresh: false });
    expect(sent[1]!.body['stepUpFresh']).toBe(false);
  });
  it('reset and deactivate name the teammate and end that teammate\'s console sessions; a reset answers with a new enrolment link', async () => {
    answerWith = { status: 200, json: { ok: true, enrolmentToken: 'RESET-token-for-the-teammate' } };
    const reset = await h.call('POST', `/staff/${h.ids.spec}/reset-factor`, { body: {}, as: 'admin' });
    expect([reset.status, reset.body]).toEqual([200, { enrolmentLink: 'https://console.example/enrol#RESET-token-for-the-teammate' }]);
    answerWith = { status: 200, json: { ok: true } };
    expect((await h.call('POST', `/staff/${h.ids.spec}/deactivate`, { body: {}, as: 'admin' })).status).toBe(200);
    expect(sent.map((s) => s.path)).toEqual(['/reset-factor', '/deactivate']);
    expect(ended).toEqual([h.ids.spec, h.ids.spec]);
  });
  it('a refusal from the other app is its code and status, and ends no session', async () => {
    answerWith = { status: 409, json: { code: 'same_person' } };
    const r = await h.call('POST', `/staff/${h.ids.admin}/reset-factor`, { body: {}, as: 'admin' });
    expect([r.status, r.body]).toEqual([409, { code: 'same_person' }]);
    answerWith = { status: 409, json: { code: 'last_admin' } };
    expect((await h.call('POST', `/staff/${h.ids.spec}/deactivate`, { body: {}, as: 'admin' })).body).toEqual({ code: 'last_admin' });
    answerWith = { status: 409, json: { code: 'email_taken' } };
    expect((await h.call('POST', '/staff', { body: { email: 'n@booq.example', displayName: 'N', role: 'platform_admin' }, as: 'admin' })).status).toBe(409);
    expect(ended).toEqual([]);
  });
  it('a specialist is 403, a guest 401, a bad id 404, a bad body 400; nothing reaches the other app', async () => {
    expect((await h.call('POST', '/staff', { body: { email: 'n@booq.example', displayName: 'N', role: 'platform_admin' }, as: 'spec' })).status).toBe(403);
    expect((await h.call('POST', `/staff/${h.ids.spec}/deactivate`, { body: {}, as: null })).status).toBe(401);
    expect((await h.call('POST', '/staff/nope/deactivate', { body: {}, as: 'admin' })).status).toBe(404);
    expect((await h.call('POST', '/staff', { body: { email: 'n@booq.example', role: 'platform_admin', extra: 1 }, as: 'admin' })).status).toBe(400);
    expect(sent).toEqual([]);
  });
  it('without the other app configured these answer 503 not_configured', async () => {
    const bare = await createHarness((pdb) => staffRoutes({ staff: null, consoleBaseUrl: '', team: createTeamService({ db: pdb }) }));
    try {
      expect((await bare.call('POST', `/staff/${bare.ids.spec}/deactivate`, { body: {}, as: 'admin' })).body).toEqual({ code: 'not_configured' });
    } finally {
      await bare.close();
    }
  });
  it('the team list is admin only and shows roles and whether each can sign in', async () => {
    const r = await h.call('GET', '/staff', { as: 'admin' });
    expect(r.status).toBe(200);
    expect(r.body.team.map((m: { id: string; role: string; active: boolean }) => [m.id, m.role, m.active]).sort()).toEqual(
      [[h.ids.admin, 'platform_admin', true], [h.ids.loner, 'onboarding_specialist', true], [h.ids.spec, 'onboarding_specialist', true]].sort(),
    );
    expect(Object.keys(r.body.team[0]).sort()).toEqual(['active', 'displayName', 'email', 'id', 'role']);
    expect((await h.call('GET', '/staff', { as: 'spec' })).status).toBe(403);
    expect((await h.call('GET', '/staff', { as: null })).status).toBe(401);
  });
});
