import type { SupabaseAdmin } from './handler';

// The identity provider's admin API (Supabase Auth, GoTrue), over fetch. This is the only file that sends the
// service-role key, and only in the two headers the API wants. The key and the user ids never appear in a thrown error.
// Not yet run against a real project (none exists); the DevOps spike confirms the paths and the ban duration form.

export interface SupabaseAdminOptions {
  /** The project's address, for example https://abcd.supabase.co (no trailing slash needed). */
  url: string;
  serviceRoleKey: string;
  fetch?: typeof fetch;
}

const BAN_FOR_GOOD = '876000h';   // a hundred years: the provider's form of "banned until further notice"

export function createSupabaseAdmin(options: SupabaseAdminOptions): SupabaseAdmin {
  const base = options.url.replace(/\/+$/, '');
  const doFetch = options.fetch ?? fetch;
  async function call(method: string, path: string, body?: unknown): Promise<unknown> {
    const res = await doFetch(`${base}/auth/v1${path}`, {
      method,
      headers: { apikey: options.serviceRoleKey, authorization: `Bearer ${options.serviceRoleKey}`, ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    if (!res.ok) throw new Error(`identity provider answered ${res.status} for ${method}`);
    const text = await res.text();
    return text === '' ? null : JSON.parse(text);
  }
  const id = (authUserId: string) => encodeURIComponent(authUserId);
  return {
    async inviteUser(email) {
      const u = (await call('POST', '/invite', { email })) as { id?: unknown } | null;
      if (!u || typeof u.id !== 'string') throw new Error('identity provider gave no user id');
      return { authUserId: u.id };
    },
    async resetFactors(authUserId) {
      const factors = (await call('GET', `/admin/users/${id(authUserId)}/factors`)) as Array<{ id?: unknown }> | null;
      for (const f of factors ?? []) if (typeof f.id === 'string') await call('DELETE', `/admin/users/${id(authUserId)}/factors/${encodeURIComponent(f.id)}`);
    },
    async banUser(authUserId) {
      await call('PUT', `/admin/users/${id(authUserId)}`, { ban_duration: BAN_FOR_GOOD });
    },
    async deleteUser(authUserId) {
      await call('DELETE', `/admin/users/${id(authUserId)}`);
    },
  };
}
