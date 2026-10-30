import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { route } from '@booq/auth';
import { createDb, type Db } from '@booq/db';
import { createTestDatabase, type TestDatabase } from '@booq/db/testing';
import { createFeatureChecker } from './features';

// F01-T25: a route for a feature that is off is refused by the server (PLAT-05-AC2), per club (AC1).
const A = '3f2b8f0e-7c1d-4a55-9d0a-1c2e3f4a5b6c';
const B = '9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d';
const USER = '11111111-2222-4333-8444-555555555555';

let tdb: TestDatabase;
let db: Db;
const session = (clubId: string) => ({ clubId, userId: USER, roles: ['player' as const] });
const setFeature = (club: string, key: string, enabled: boolean) =>
  tdb.query(`insert into public.club_feature (club_id, feature_key, enabled) values ($1, $2, $3) on conflict (club_id, feature_key) do update set enabled = excluded.enabled`, [club, key, enabled]);

beforeEach(async () => {
  tdb = await createTestDatabase();
  await tdb.query(`insert into public.club (id, slug, name_th, name_en, payment_option) values ($1, 'a', 'ก', 'A', 'slip'), ($2, 'b', 'ข', 'B', 'beam')`, [A, B]);
  db = createDb({ connectionString: tdb.url, max: 1 });
});
afterEach(async () => {
  await db.end();
  await tdb.close();
});

describe('route() with the real switch check', () => {
  const handler = async () => 'ok';
  const checkout = route({ method: 'GET', path: '/coach-options', permission: 'club.read', feature: 'coach_add_at_checkout' }, handler);

  it('refuses while the switch is off and runs once it is on, for that club only', async () => {
    const deps = createFeatureChecker(db);
    expect(await checkout.handle({ session: session(A), input: {} }, deps)).toEqual({ ok: false, status: 403, code: 'feature_disabled' });
    await setFeature(A, 'coach_add_at_checkout', true);
    expect(await checkout.handle({ session: session(A), input: {} }, deps)).toEqual({ ok: true, status: 200, body: 'ok' });
    expect(await checkout.handle({ session: session(B), input: {} }, deps)).toEqual({ ok: false, status: 403, code: 'feature_disabled' });
  });

  it('a slip feature is refused for a Beam club even when switched on', async () => {
    const slip = route({ method: 'GET', path: '/slips', permission: 'club.read', feature: 'slip_checking' }, handler);
    const deps = createFeatureChecker(db);
    await setFeature(A, 'slip_checking', true);
    await setFeature(B, 'slip_checking', true);
    expect((await slip.handle({ session: session(A), input: {} }, deps)).ok).toBe(true);
    expect(await slip.handle({ session: session(B), input: {} }, deps)).toEqual({ ok: false, status: 403, code: 'feature_disabled' });
  });

  it('an unknown feature name is off, and a malformed club id fails closed', async () => {
    const deps = createFeatureChecker(db);
    expect(await deps.hasFeature(A, 'gift_vouchers')).toBe(false);
    await expect(deps.hasFeature('nope', 'slip_checking')).rejects.toThrow();
  });
});
