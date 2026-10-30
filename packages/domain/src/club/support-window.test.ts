import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createDb, type Db } from '@booq/db';
import { createTestDatabase, type TestDatabase } from '@booq/db/testing';
import { supportWindowRoute } from './support-window';

// F01-T19: PUT /support-window (PLAT-02-AC4, AC5; permission support-window.write).
const CLUB = '3f2b8f0e-7c1d-4a55-9d0a-1c2e3f4a5b6c';
const USER = '11111111-2222-4333-8444-555555555555';
const deps = { hasFeature: async () => true };

let tdb: TestDatabase;
let db: Db;
const session = (...roles: Array<'owner' | 'player' | 'front_desk' | 'accountant' | 'coach'>) => ({ clubId: CLUB, userId: USER, roles });

beforeEach(async () => {
  tdb = await createTestDatabase();
  await tdb.query(`insert into public.club (id, slug, name_th, name_en, status) values ($1, 'a', 'ก', 'A', 'live')`, [CLUB]);
  db = createDb({ connectionString: tdb.url, max: 1 });
});
afterEach(async () => {
  await db.end();
  await tdb.close();
});

describe('PUT /support-window', () => {
  it('is declared with the support-window.write permission', () => {
    expect(supportWindowRoute(db).def).toMatchObject({ method: 'PUT', path: '/support-window', permission: 'support-window.write' });
  });

  it('the owner turns it on for 24 hours and off again', async () => {
    await tdb.setNow('2026-12-29T03:00:00Z');
    const route = supportWindowRoute(db);
    const on = await route.handle({ session: session('owner', 'player'), input: { on: true } }, deps);
    expect(on).toEqual({ ok: true, status: 200, body: { on: true, until: '2026-12-30T03:00:00.000Z' } });
    const off = await route.handle({ session: session('owner', 'player'), input: { on: false } }, deps);
    expect(off).toEqual({ ok: true, status: 200, body: { on: false, until: null } });
  });

  it('refuses every other role on the server, and changes nothing', async () => {
    const route = supportWindowRoute(db);
    for (const roles of [['front_desk', 'player'], ['accountant', 'player'], ['coach', 'player'], ['player']] as const) {
      const r = await route.handle({ session: session(...roles), input: { on: true } }, deps);
      expect(r, roles.join()).toEqual({ ok: false, status: 403, code: 'forbidden' });
    }
    expect((await tdb.query(`select allow_booq_changes_until as u from public.club`)).rows[0].u).toBeNull();
  });

  it('refuses a body that is not exactly { on: boolean }', async () => {
    const route = supportWindowRoute(db);
    for (const input of [{}, { on: 'yes' }, { on: 1 }, null, 'on', { on: true, club: 'x' }]) {
      expect(await route.handle({ session: session('owner'), input }, deps), JSON.stringify(input)).toEqual({ ok: false, status: 400, code: 'invalid_input' });
    }
  });

  it('refuses without a session', async () => {
    expect(await supportWindowRoute(db).handle({ session: null, input: { on: true } }, deps)).toEqual({ ok: false, status: 401, code: 'unauthenticated' });
  });
});
