import { describe, expect, it } from 'vitest';
import { createSupabaseAdmin } from './supabase-admin';

// The provider adapter, against a fake fetch: the right paths, the key only in the two headers, no key in any error.
const KEY = 'SERVICE-KEY-MARKER-123';
function fake(answers: Array<{ status: number; body?: unknown }>) {
  const seen: Array<{ method: string; url: string; headers: Record<string, string>; body: string | undefined }> = [];
  const f = (async (url: string, init: RequestInit) => {
    seen.push({ method: init.method ?? 'GET', url, headers: init.headers as Record<string, string>, body: init.body as string | undefined });
    const a = answers.shift() ?? { status: 200 };
    return new Response(a.body === undefined ? '' : JSON.stringify(a.body), { status: a.status });
  }) as unknown as typeof fetch;
  return { seen, admin: createSupabaseAdmin({ url: 'https://proj.example/', serviceRoleKey: KEY, fetch: f }) };
}

describe('Supabase admin adapter', () => {
  it('invites by email and returns the new user id', async () => {
    const { seen, admin } = fake([{ status: 200, body: { id: 'u-1' } }]);
    expect(await admin.inviteUser('a@booq.example')).toEqual({ authUserId: 'u-1' });
    expect(seen[0]).toMatchObject({ method: 'POST', url: 'https://proj.example/auth/v1/invite', body: '{"email":"a@booq.example"}' });
    expect(seen[0]!.headers).toMatchObject({ apikey: KEY, authorization: `Bearer ${KEY}` });
  });
  it('resets by listing the factors and deleting each', async () => {
    const { seen, admin } = fake([{ status: 200, body: [{ id: 'f1' }, { id: 'f2' }] }, { status: 200 }, { status: 200 }]);
    await admin.resetFactors('u-1');
    expect(seen.map((s) => `${s.method} ${s.url}`)).toEqual([
      'GET https://proj.example/auth/v1/admin/users/u-1/factors',
      'DELETE https://proj.example/auth/v1/admin/users/u-1/factors/f1',
      'DELETE https://proj.example/auth/v1/admin/users/u-1/factors/f2',
    ]);
  });
  it('bans and deletes', async () => {
    const { seen, admin } = fake([{ status: 200 }, { status: 200 }]);
    await admin.banUser('u-1');
    await admin.deleteUser('u-1');
    expect(seen[0]).toMatchObject({ method: 'PUT', url: 'https://proj.example/auth/v1/admin/users/u-1', body: '{"ban_duration":"876000h"}' });
    expect(seen[1]).toMatchObject({ method: 'DELETE', url: 'https://proj.example/auth/v1/admin/users/u-1' });
  });
  it('a failed answer throws without the key or the id in the message', async () => {
    const { admin } = fake([{ status: 500 }]);
    const err = await admin.banUser('u-secret-id').catch((e: Error) => e);
    expect((err as Error).message).toBe('identity provider answered 500 for PUT');
    expect((err as Error).message).not.toContain(KEY);
  });
  it('an invite answer without a user id is an error', async () => {
    const { admin } = fake([{ status: 200, body: {} }]);
    await expect(admin.inviteUser('a@booq.example')).rejects.toThrow();
  });
});
