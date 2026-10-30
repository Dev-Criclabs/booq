import { describe, expect, it } from 'vitest';
import { INTERNAL_SIGNATURE, INTERNAL_TIMESTAMP, verifyInternalCall } from '@booq/auth';
import { createStaffInviteClient } from './staff-invite-client';

// apps/platform's side of F01-T17b: it signs the call and turns the answer into a code. It holds a shared signing secret
// and the other app's address, never a provider key.
const SECRET = 'shared-secret';
const NOW = new Date('2026-10-30T10:00:00Z');
function fake(status: number, body: unknown) {
  const seen: Array<{ url: string; raw: string; ok: boolean }> = [];
  const f = (async (url: string, init: RequestInit) => {
    const h = init.headers as Record<string, string>;
    seen.push({ url, raw: String(init.body), ok: verifyInternalCall(SECRET, NOW, 30, { timestamp: h[INTERNAL_TIMESTAMP] ?? null, signature: h[INTERNAL_SIGNATURE] ?? null }, String(init.body)) });
    return new Response(JSON.stringify(body), { status });
  }) as unknown as typeof fetch;
  return { seen, client: createStaffInviteClient({ url: 'https://invite.internal/', signingSecret: SECRET, fetch: f, now: () => NOW }) };
}
const actor = { staffId: 'aaaaaaaa-0000-4000-8000-000000000001', stepUpFresh: true };

describe('staff-invite client', () => {
  it('signs each call and sends the actor, the fresh second factor flag and the fields', async () => {
    const { seen, client } = fake(200, { staffId: 's-1' });
    expect(await client.invite(actor, { email: 'a@booq.example', displayName: 'A', role: 'onboarding_specialist' })).toEqual({ ok: true, staffId: 's-1' });
    expect(seen[0]!.url).toBe('https://invite.internal/invite');
    expect(seen[0]!.ok).toBe(true);
    expect(JSON.parse(seen[0]!.raw)).toEqual({ actorStaffId: actor.staffId, stepUpFresh: true, email: 'a@booq.example', displayName: 'A', role: 'onboarding_specialist' });
  });
  it('reset and deactivate go to their paths with the target', async () => {
    const { seen, client } = fake(200, { ok: true });
    expect(await client.resetFactor(actor, 't-1')).toEqual({ ok: true });
    expect(await client.deactivate(actor, 't-1')).toEqual({ ok: true });
    expect(seen.map((s) => s.url)).toEqual(['https://invite.internal/reset-factor', 'https://invite.internal/deactivate']);
    expect(JSON.parse(seen[0]!.raw)).toMatchObject({ targetStaffId: 't-1' });
  });
  it('an answer with a code is that code; anything unreadable is provider_failed', async () => {
    expect(await fake(409, { code: 'same_person' }).client.resetFactor(actor, 't-1')).toEqual({ ok: false, code: 'same_person' });
    expect(await fake(403, { code: 'forbidden' }).client.deactivate(actor, 't-1')).toEqual({ ok: false, code: 'forbidden' });
    expect(await fake(502, 'x').client.deactivate(actor, 't-1')).toEqual({ ok: false, code: 'provider_failed' });
    const down = createStaffInviteClient({ url: 'https://x', signingSecret: SECRET, fetch: (async () => { throw new Error('down'); }) as unknown as typeof fetch, now: () => NOW });
    expect(await down.deactivate(actor, 't-1')).toEqual({ ok: false, code: 'unreachable' });
  });
});
