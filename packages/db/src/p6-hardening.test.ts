import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createPlatformDb, type PlatformDb } from './platform-tx';
import { createTestDatabase, type TestDatabase } from './testing/harness';

// F01-T23 part c / migration 0036: review T18 R3 (the P6 key filter) and R4 (club and session ownership).
const LIVE = '3f2b8f0e-7c1d-4a55-9d0a-1c2e3f4a5b6c';
const OTHER = '9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d';

let tdb: TestDatabase;
let pdb: PlatformDb;
let admin: string;
let spec: string;

async function staff(email: string, role: string, auth: string, name: string): Promise<string> {
  return (await tdb.query(`insert into platform.platform_staff (auth_user_id, email, display_name, role) values ($1, $2, $3, $4) returning id`, [auth, email, name, role])).rows[0].id;
}
const write = (who: string, action: string, club: string | null, detail: unknown = {}, session: string | null = null, ctxClub = LIVE) =>
  pdb.withPlatformTx({ staffId: who, staffLabel: 'S', clubId: ctxClub }, (tx) => tx.query(`select platform.write_audit($1, $2, 'club', null, $3::jsonb, null, $4)`, [action, club, JSON.stringify(detail), session]));

beforeEach(async () => {
  tdb = await createTestDatabase();
  await tdb.query(`insert into public.club (id, slug, name_th, name_en) values ($1, 'a', 'ก', 'A'), ($2, 'b', 'ข', 'B')`, [LIVE, OTHER]);
  admin = await staff('admin@booq.example', 'platform_admin', '99999999-0000-4000-8000-000000000001', 'Ada Admin');
  spec = await staff('spec@booq.example', 'onboarding_specialist', '99999999-0000-4000-8000-000000000002', 'Sam Specialist');
  await tdb.query(`insert into platform.staff_assignment (staff_id, club_id) values ($1, $2)`, [spec, LIVE]);
  pdb = createPlatformDb({ connectionString: tdb.url, max: 1 });
});
afterEach(async () => {
  await pdb.end();
  await tdb.close();
});

describe('R3: setup keys are not player or secret data', () => {
  it('accepts feature_key, check_key and setting_key at any depth', async () => {
    await write(spec, 'club.setup_changed', LIVE, { feature_key: 'coaching', changed: [{ check_key: 'line_test', setting_key: 'hold_minutes' }] });
    expect((await tdb.query(`select count(*)::int as n from platform.audit_log`)).rows[0].n).toBe(1);
  });
  it('still refuses key on its own, api_key, hmac_key, secret_key and the player words', async () => {
    for (const detail of [{ key: 'x' }, { api_key: 'x' }, { hmac_key: 'x' }, { secret_key: 'x' }, { nested: { player_name: 'x' } }, { wallet_balance: 1 }]) {
      await expect(write(spec, 'club.setup_changed', LIVE, detail), JSON.stringify(detail)).rejects.toThrow(/not allowed/);
    }
  });
});

describe('R4: a log entry names a club and a session the caller may use', () => {
  it('refuses a club the staff member cannot see, and a club that does not exist', async () => {
    await expect(write(spec, 'club.setup_changed', OTHER, {}, null, OTHER)).rejects.toThrow(/club/i);
    await expect(write(admin, 'club.setup_changed', 'aaaaaaaa-0000-4000-8000-0000000000ff')).rejects.toThrow();
    await write(admin, 'club.setup_changed', OTHER, {}, null, OTHER);
    await write(spec, 'club.setup_changed', LIVE);
  });
  it('an entry with no club (a refused attempt, sign in) is still fine', async () => {
    await write(spec, 'support.access_refused', null, { club_ref: 'x' });
    await write(spec, 'auth.sign_in', null);
  });
  it('refuses another staff member\'s support session and an unknown one; accepts their own', async () => {
    const mine = (await tdb.query(`insert into platform.support_session (staff_id, club_id, mode) values ($1, $2, 'edit') returning id`, [spec, LIVE])).rows[0].id;
    const theirs = (await tdb.query(`insert into platform.support_session (staff_id, club_id, mode) values ($1, $2, 'edit') returning id`, [admin, LIVE])).rows[0].id;
    await write(spec, 'support.setup_changed', LIVE, {}, mine);
    await expect(write(spec, 'support.setup_changed', LIVE, {}, theirs)).rejects.toThrow(/session/i);
    await expect(write(spec, 'support.setup_changed', LIVE, {}, 'aaaaaaaa-0000-4000-8000-0000000000ff')).rejects.toThrow(/session/i);
  });
  it('a session must belong to the club it is logged against', async () => {
    const other = (await tdb.query(`insert into platform.support_session (staff_id, club_id, mode) values ($1, $2, 'edit') returning id`, [admin, OTHER])).rows[0].id;
    await expect(write(admin, 'support.setup_changed', LIVE, {}, other)).rejects.toThrow(/session/i);
  });
});
