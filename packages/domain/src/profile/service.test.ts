import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createDb, type Db } from '../../../db/src/tx';
import { createTestDatabase, type TestDatabase } from '../../../db/src/testing/harness';
import { createProfileEditService, ProfileEditError } from './service';

// F02-T14 PUT /me/profile (AUTH-02-AC15 to AC23, AC29; D12). Real Postgres.
const A = '3f2b8f0e-7c1d-4a55-9d0a-1c2e3f4a5b6c';
const ME = '33333333-3333-4333-8333-333333333333';
const OTHER = '55555555-5555-4555-8555-555555555555';
const TODAY = '2026-10-30';

let tdb: TestDatabase;
let db: Db;
const me = { clubId: A, userId: ME, roles: ['player'], source: 'player_app' as const };
const svc = createProfileEditService({ today: () => TODAY });
const run = <T>(fn: (tx: Parameters<Parameters<Db['withClubTx']>[1]>[0]) => Promise<T>, ctx: { clubId: string; userId: string | null; roles: string[]; source: 'player_app' } = me) => db.withClubTx(ctx, fn);
const row = async (id = ME) => (await tdb.query(`select full_name, phone, phone_normalized, date_of_birth::text as dob, level, language from public.app_user where id = $1`, [id])).rows[0];

beforeEach(async () => {
  tdb = await createTestDatabase();
  await tdb.query(`insert into public.club (id, slug, name_th, name_en) values ($1,'a','ก','A')`, [A]);
  for (const [id, line, name] of [[ME, 'L1', 'Somchai Jaidee'], [OTHER, 'L2', 'Other Person']] as const) {
    const c = await tdb.pool.connect();
    try {
      await c.query('begin');
      await c.query(`insert into public.app_user (club_id, id, line_user_id, full_name, phone, phone_normalized, language) values ($1,$2,$3,$4,'0812345678','66812345678','th')`, [A, id, line, name]);
      await c.query(`insert into public.app_user_role (club_id, user_id, role) values ($1,$2,'player')`, [A, id]);
      await c.query('commit');
    } finally {
      c.release();
    }
  }
  db = createDb({ connectionString: tdb.url, max: 2 });
});
afterEach(async () => {
  await db.end();
  await tdb.close();
});

describe('what a player may change (AUTH-02-AC22, AC23)', () => {
  it('name, phone, date of birth, level and language, any subset, answered with the saved profile', async () => {
    const out = await run((tx) => svc.update(tx, me, { fullName: 'Somchai J. Jaidee', phone: '+66 89 999 9999', dateOfBirth: '1994-03-14', level: 'beginner', language: 'en' }));
    expect(out).toEqual({ fullName: 'Somchai J. Jaidee', phone: '+66 89 999 9999', dateOfBirth: '1994-03-14', level: 'beginner', language: 'en', priceGroup: 'adult' });
    expect(await row()).toEqual({ full_name: 'Somchai J. Jaidee', phone: '+66 89 999 9999', phone_normalized: '66899999999', dob: '1994-03-14', level: 'beginner', language: 'en' });
    await run((tx) => svc.update(tx, me, { level: 'advanced' }));
    expect((await row()).level).toBe('advanced');
    expect((await row()).full_name).toBe('Somchai J. Jaidee'); // the rest is untouched
  });
  it('the date of birth and the level can be removed with null', async () => {
    await run((tx) => svc.update(tx, me, { dateOfBirth: '2012-01-01', level: 'new' }));
    const out = await run((tx) => svc.update(tx, me, { dateOfBirth: null, level: null }));
    expect(out).toMatchObject({ dateOfBirth: null, level: null, priceGroup: 'adult' }); // no date of birth: Adult prices (D12)
  });
  it('is never locked: any number of changes is accepted (AC18, AC19)', async () => {
    for (let i = 0; i < 6; i += 1) await run((tx) => svc.update(tx, me, { dateOfBirth: i % 2 ? '2012-05-05' : '1990-05-05' }));
    expect((await row()).dob).toBe('2012-05-05');
  });
});

describe('what is refused (AC16)', () => {
  it.each([
    [{ dateOfBirth: '2026-10-31' }, 'dob_future'],
    [{ dateOfBirth: '2027-01-01' }, 'dob_future'],
    [{ dateOfBirth: '31/02/2000' }, 'dob_invalid'],
    [{ dateOfBirth: '2001-02-30' }, 'dob_invalid'],
    [{ dateOfBirth: 5 }, 'dob_invalid'],
    [{ fullName: ' ' }, 'name_missing'],
    [{ phone: '12345' }, 'phone_invalid'],
    [{ level: 'expert' }, 'level_invalid'],
    [{ language: 'fr' }, 'language_invalid'],
  ])('%j -> %s', async (body, code) => {
    const err = await run((tx) => svc.update(tx, me, body)).then(() => null, (e: unknown) => e as ProfileEditError);
    expect(err).toBeInstanceOf(ProfileEditError);
    expect(err!.code).toBe('invalid');
    expect(Object.values(err!.fields ?? {})).toContain(code);
    expect((await row()).dob).toBeNull();
  });
  it('today is allowed (a baby born today is a Student); nothing else but the five fields', async () => {
    expect(await run((tx) => svc.update(tx, me, { dateOfBirth: TODAY }))).toMatchObject({ dateOfBirth: TODAY, priceGroup: 'student' });
    for (const extra of [{ roles: ['owner'] }, { active: false }, { lineUserId: 'x' }, { id: OTHER }, { isTest: true }, { clubId: A }]) {
      await expect(run((tx) => svc.update(tx, me, { fullName: 'Ok Name', ...extra }))).rejects.toMatchObject({ code: 'bad_input' });
    }
    await expect(run((tx) => svc.update(tx, me, {}))).rejects.toMatchObject({ code: 'bad_input' });
    await expect(run((tx) => svc.update(tx, me, 'nope'))).rejects.toMatchObject({ code: 'bad_input' });
  });
  it('a guest has no profile to change', async () => {
    const guest = { clubId: A, userId: null, roles: ['guest'], source: 'player_app' as const };
    await expect(run((tx) => svc.update(tx, guest, { fullName: 'X Y' }), guest)).rejects.toMatchObject({ code: 'forbidden' });
  });
  it('one bad field changes nothing, even if another field was good', async () => {
    await expect(run((tx) => svc.update(tx, me, { fullName: 'Changed Name', dateOfBirth: '2999-01-01' }))).rejects.toMatchObject({ code: 'invalid' });
    expect((await row()).full_name).toBe('Somchai Jaidee');
  });
});

describe('price group (AC13, AC14, AC29, D12)', () => {
  it('an adult adding a date of birth stays Adult', async () => {
    expect(await run((tx) => svc.update(tx, me, { dateOfBirth: '1985-07-01' }))).toMatchObject({ priceGroup: 'adult' });
  });
  it('under 18 on the Bangkok date is Student; the 18th birthday makes Adult', async () => {
    expect(await run((tx) => svc.update(tx, me, { dateOfBirth: '2008-10-31' }))).toMatchObject({ priceGroup: 'student' });
    expect(await run((tx) => svc.update(tx, me, { dateOfBirth: '2008-10-30' }))).toMatchObject({ priceGroup: 'adult' });
  });
  it.todo('a Student package or credit bought earlier stays valid after the date of birth makes the player Adult (AC20): assertion contract with F06, which snapshots the group on customer_package');
});

describe('audit (AC21)', () => {
  it('each change has an entry with the old and the new value and the player as actor; personal values only in the pii columns', async () => {
    await run((tx) => svc.update(tx, me, { dateOfBirth: '1990-01-01' }));
    await run((tx) => svc.update(tx, me, { dateOfBirth: '2000-02-02', fullName: 'MARKER New Name' }));
    const e = (await tdb.query(`select actor_user_id, old_value, new_value, pii_old, pii_new from public.audit_entry where record_type = 'app_user' and record_id = $1 and action like '%update%' order by seq`, [ME])).rows;
    expect(e.length).toBeGreaterThanOrEqual(2);
    expect(e.every((x) => x.actor_user_id === ME)).toBe(true);
    const last = e.at(-1)!;
    expect(last.pii_old).toMatchObject({ date_of_birth: '1990-01-01' });
    expect(last.pii_new).toMatchObject({ date_of_birth: '2000-02-02', full_name: 'MARKER New Name' });
    expect(JSON.stringify([last.old_value, last.new_value])).not.toContain('MARKER');
  });
});

describe('only your own row (CC-1, ROLE-AC4)', () => {
  it('has no way to name another person: the update is on the signed-in id', async () => {
    await run((tx) => svc.update(tx, me, { fullName: 'Only Me' }));
    expect((await row(OTHER)).full_name).toBe('Other Person');
  });
  it('reads the saved profile back', async () => {
    expect(await run((tx) => svc.get(tx, me))).toMatchObject({ fullName: 'Somchai Jaidee', phone: '0812345678', language: 'th', dateOfBirth: null, priceGroup: 'adult' });
  });
});
