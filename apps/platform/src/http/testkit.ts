import { createPlatformDb, type PlatformDb } from '@booq/db';
import { createTestDatabase, type TestDatabase } from '@booq/db/testing';
import { servePlatform, type PlatformHandler, type PlatformRoute } from './server';

// Test helper for the console's route groups: a database, three staff members, and a way to call a
// route table as one of them (the session check itself is tested in auth/routes.test.ts).
export interface Harness {
  tdb: TestDatabase;
  pdb: PlatformDb;
  ids: { admin: string; spec: string; loner: string };
  call(method: string, path: string, init?: { body?: unknown; as?: 'admin' | 'spec' | 'loner' | null; fresh?: boolean; headers?: Record<string, string> }): Promise<{ status: number; body: any; headers: Headers }>;
  close(): Promise<void>;
}

export async function createHarness(routes: (pdb: PlatformDb) => PlatformRoute[]): Promise<Harness> {
  const tdb = await createTestDatabase();
  const staff = async (email: string, role: string, auth: string, name: string) =>
    (await tdb.query(`insert into platform.platform_staff (auth_user_id, email, display_name, role) values ($1,$2,$3,$4) returning id`, [auth, email, name, role])).rows[0].id as string;
  const ids = {
    admin: await staff('admin@booq.example', 'platform_admin', '99999999-0000-4000-8000-000000000001', 'Ada Admin'),
    spec: await staff('spec@booq.example', 'onboarding_specialist', '99999999-0000-4000-8000-000000000002', 'Sam Specialist'),
    loner: await staff('loner@booq.example', 'onboarding_specialist', '99999999-0000-4000-8000-000000000003', 'Lee Loner'),
  };
  const pdb = createPlatformDb({ connectionString: tdb.url, max: 2 });
  const roles = { [ids.admin]: 'platform_admin', [ids.spec]: 'onboarding_specialist', [ids.loner]: 'onboarding_specialist' } as const;
  const names = { [ids.admin]: 'Ada Admin', [ids.spec]: 'Sam Specialist', [ids.loner]: 'Lee Loner' };
  let fresh = true;
  const handler: PlatformHandler = servePlatform(routes(pdb), {
    maxBodyBytes: 100_000,
    authenticate: async (cookie) => {
      const id = cookie.replace(/^as-/, '');
      return roles[id] ? { ok: true, staff: { id, role: roles[id], displayName: names[id] ?? '' }, stepUpFresh: fresh } : { ok: false, code: 'session_invalid' };
    },
  });
  return {
    tdb,
    pdb,
    ids,
    async call(method, path, init = {}) {
      fresh = init.fresh ?? true;
      const cookie = init.as === null || init.as === undefined ? undefined : `__Host-booq-platform=as-${ids[init.as]}`;
      const res = await handler(
        new Request(`https://console.example/api${path}`, {
          method,
          ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
          headers: { ...(init.body === undefined ? {} : { 'content-type': 'application/json' }), ...(cookie ? { cookie } : {}), ...(init.headers ?? {}) },
        }),
        { params: Promise.resolve({ path: path.split('?')[0]!.split('/').filter(Boolean) }) },
      );
      return { status: res.status, body: await res.json().catch(() => ({})), headers: res.headers };
    },
    async close() {
      await pdb.end();
      await tdb.close();
    },
  };
}
