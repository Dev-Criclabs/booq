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
    if (!res.ok) throw new Error(`identity provider answered ${res.status} for ${method}`);  // i18n-ignore internal error between servers, logged, never shown to a user
    const text = await res.text();
    return text === '' ? null : JSON.parse(text);
  }
  const id = (authUserId: string) => encodeURIComponent(authUserId);
  return {
    // The user is created confirmed and with no email sent: the link that lets them in is our own single-use enrolment
    // link (migration 0055), handed over by the admin, so its life and its use are ours to set and to log.
    async inviteUser(email) {
      const u = (await call('POST', '/admin/users', { email, email_confirm: true })) as { id?: unknown } | null;
      if (!u || typeof u.id !== 'string') throw new Error('identity provider gave no user id');  // i18n-ignore internal error between servers, logged, never shown to a user
      return { authUserId: u.id };
    },
    async resetFactors(authUserId) {
      const factors = (await call('GET', `/admin/users/${id(authUserId)}/factors`)) as Array<{ id?: unknown }> | null;
      for (const f of factors ?? []) if (typeof f.id === 'string') await call('DELETE', `/admin/users/${id(authUserId)}/factors/${encodeURIComponent(f.id)}`);
    },
    async banUser(authUserId) {
      await call('PUT', `/admin/users/${id(authUserId)}`, { ban_duration: BAN_FOR_GOOD });
    },
    async setPassword(authUserId, password) {
      const res = await doFetch(`${base}/auth/v1/admin/users/${id(authUserId)}`, {
        method: 'PUT',
        headers: { apikey: options.serviceRoleKey, authorization: `Bearer ${options.serviceRoleKey}`, 'content-type': 'application/json' },
        body: JSON.stringify({ password }),
      });
      if (res.status === 422) return 'weak'; // the project's own password rule refused it
      if (!res.ok) throw new Error(`identity provider answered ${res.status} for PUT`);  // i18n-ignore internal error between servers, logged, never shown to a user
      return 'ok';
    },
    async removeUnverifiedFactors(authUserId) {
      const factors = (await call('GET', `/admin/users/${id(authUserId)}/factors`)) as Array<{ id?: unknown; status?: unknown }> | null;
      for (const f of factors ?? []) if (typeof f.id === 'string' && f.status !== 'verified') await call('DELETE', `/admin/users/${id(authUserId)}/factors/${encodeURIComponent(f.id)}`);
    },
    async emailOf(authUserId) {
      const u = (await call('GET', `/admin/users/${id(authUserId)}`)) as { email?: unknown } | null;
      return typeof u?.email === 'string' && u.email !== '' ? u.email : null;
    },
    async deleteUser(authUserId) {
      await call('DELETE', `/admin/users/${id(authUserId)}`);
    },
  };
}
