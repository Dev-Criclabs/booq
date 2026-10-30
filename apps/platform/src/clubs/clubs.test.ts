import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createPlatformDb, type PlatformDb } from '@booq/db';
import { createTestDatabase, type TestDatabase } from '@booq/db/testing';
import { createClubService } from './clubs';

// F01-T23 part a: POST /clubs (P2 step 1) and GET /clubs/{id} progress (P3)
// (PLAT-01-AC1, AC2, AC9, ROLE-AC5; design 5.2).
let tdb: TestDatabase;
let pdb: PlatformDb;
let svc: ReturnType<typeof createClubService>;
let admin: string;
let spec: string;
let other: string;
let templateId: string;

async function staff(email: string, role: string, auth: string, name: string): Promise<string> {
  return (await tdb.query(`insert into platform.platform_staff (auth_user_id, email, display_name, role) values ($1, $2, $3, $4) returning id`, [auth, email, name, role])).rows[0].id;
}
const create = (who: string, body: unknown, fresh = true) => svc.createClub({ staffId: who, stepUpFresh: fresh }, body);
const valid = (over: Record<string, unknown> = {}) => ({ slug: 'new-club', name_th: 'ก', name_en: 'New Club', ...over });
const p6 = async () => (await tdb.query(`select action, staff_name_at_time as name, club_id, detail from platform.audit_log order by occurred_at, id`)).rows;

beforeEach(async () => {
  tdb = await createTestDatabase();
  admin = await staff('admin@booq.example', 'platform_admin', '99999999-0000-4000-8000-000000000001', 'Ada Admin');
  spec = await staff('spec@booq.example', 'onboarding_specialist', '99999999-0000-4000-8000-000000000002', 'Sam Specialist');
  other = await staff('other@booq.example', 'onboarding_specialist', '99999999-0000-4000-8000-000000000003', 'Olu Other');
  templateId = (await tdb.query(`select id from platform.template where key = 'tennis'`)).rows[0].id;
  pdb = createPlatformDb({ connectionString: tdb.url, max: 1 });
  svc = createClubService({ db: pdb });
});
afterEach(async () => {
  await pdb.end();
  await tdb.close();
});

describe('creating a club (PLAT-01-AC1)', () => {
  it('a specialist creates a Draft club, is assigned to it, and sees it afterwards', async () => {
    const r = await create(spec, valid({ owner_name: 'Nok', owner_phone: '0812345678', owner_line: 'U00000000000000000000000000000002', owner_email: 'nok@example.com', template_id: templateId, receipt_prefix: 'HTC' }));
    if (!r.ok) throw new Error(r.code);
    const club = (await tdb.query(`select status, created_by_staff, template_id, receipt_prefix, owner_line from public.club where id = $1`, [r.id])).rows[0];
    expect(club).toEqual({ status: 'draft', created_by_staff: spec, template_id: templateId, receipt_prefix: 'HTC', owner_line: 'U00000000000000000000000000000002' });
    expect((await tdb.query(`select staff_id from platform.staff_assignment where club_id = $1`, [r.id])).rows).toEqual([{ staff_id: spec }]);
    expect((await svc.getProgress(spec, r.id)).ok).toBe(true);
    expect(await svc.getProgress(other, r.id)).toEqual({ ok: false, code: 'not_found' });
  });

  it('an admin creates a club and sees it without an assignment', async () => {
    const r = await create(admin, valid());
    if (!r.ok) throw new Error(r.code);
    expect((await svc.getProgress(admin, r.id)).ok).toBe(true);
    expect((await tdb.query(`select count(*)::int as n from platform.staff_assignment`)).rows[0].n).toBe(0);
  });

  it('is written to P6 with the staff name, and the club audit entry names the staff member', async () => {
    const r = await create(spec, valid());
    if (!r.ok) throw new Error(r.code);
    expect((await p6()).filter((x) => x.action === 'club.created')).toMatchObject([{ name: 'Sam Specialist', club_id: r.id, detail: { slug: 'new-club' } }]);
    const a = await tdb.query(`select actor_type, actor_label from public.audit_entry where club_id = $1 and action = 'insert' and record_type = 'club'`, [r.id]);
    expect(a.rows).toEqual([{ actor_type: 'platform_staff', actor_label: 'Sam Specialist' }]);
  });

  it('starting from Tennis copies its rules and hours into the club; Padel (to build) and an unknown template are refused', async () => {
    const r = await create(spec, valid({ template_id: templateId }));
    if (!r.ok) throw new Error(r.code);
    expect((await tdb.query(`select value from public.club_setting where club_id = $1 and key = 'hold_minutes'`, [r.id])).rows).toEqual([{ value: 15 }]);
    expect((await tdb.query(`select count(*)::int as n from public.opening_hours where club_id = $1`, [r.id])).rows[0].n).toBe(7);
    expect((await p6()).filter((x) => x.action === 'club.template_applied')).toMatchObject([{ name: 'Sam Specialist', club_id: r.id, detail: { template: 'tennis' } }]);
    const padel = (await tdb.query(`select id from platform.template where key = 'padel'`)).rows[0].id;
    expect(await create(spec, valid({ slug: 'other', template_id: padel }))).toEqual({ ok: false, code: 'invalid' });
    expect((await tdb.query(`select count(*)::int as n from public.club where slug = 'other'`)).rows[0].n).toBe(0);
  });

  it('a club always starts as Draft: status and the window cannot be sent', async () => {
    for (const extra of [{ status: 'live' }, { allow_booq_changes_until: '2030-01-01T00:00:00Z' }, { created_by_staff: admin }, { id: 'x' }]) {
      expect(await create(spec, valid(extra)), JSON.stringify(extra)).toEqual({ ok: false, code: 'invalid' });
    }
    expect((await tdb.query(`select count(*)::int as n from public.club`)).rows[0].n).toBe(0);
  });

  it('refuses a bad body: missing names, a slug that is not URL safe, a bad email, a long value, an unknown template', async () => {
    const bad: Array<Record<string, unknown>> = [
      { slug: 'x', name_th: 'ก' }, { ...valid(), slug: 'Bad Slug' }, { ...valid(), slug: '-x' }, { ...valid(), name_en: '' },
      { ...valid(), owner_email: 'not-an-email' }, { ...valid(), name_en: 'x'.repeat(201) }, { ...valid(), template_id: 'aaaaaaaa-0000-4000-8000-0000000000ff' },
      { ...valid(), owner_phone: 5 }, { ...valid(), owner_line: '@nok' }, { ...valid(), owner_line: 'U1' }, { ...valid(), default_language: 'de' },
    ];
    for (const body of bad) expect(await create(spec, body), JSON.stringify(body)).toEqual({ ok: false, code: 'invalid' });
    expect(await create(spec, null)).toEqual({ ok: false, code: 'invalid' });
    expect(await create(spec, [])).toEqual({ ok: false, code: 'invalid' });
  });

  it('a slug in use answers slug_taken; a stale factor step_up_required; a deactivated account not_found', async () => {
    expect((await create(spec, valid())).ok).toBe(true);
    expect(await create(admin, valid())).toEqual({ ok: false, code: 'slug_taken' });
    expect(await create(admin, valid({ slug: 'other' }), false)).toEqual({ ok: false, code: 'step_up_required' });
    await tdb.query(`update platform.platform_staff set active = false where id = $1`, [other]);
    expect(await create(other, valid({ slug: 'third' }))).toEqual({ ok: false, code: 'not_found' });
  });

  it('a failed create leaves nothing behind: no club, no assignment, no P6 entry', async () => {
    await create(spec, valid({ slug: 'BAD' }));
    expect((await tdb.query(`select (select count(*) from public.club)::int as c, (select count(*) from platform.staff_assignment)::int as a, (select count(*) from platform.audit_log)::int as l`)).rows[0]).toEqual({ c: 0, a: 0, l: 0 });
  });
});

describe('progress (P3, PLAT-01-AC2, AC9)', () => {
  it('lists the setup steps and the launch checks with who owes each; a new club has everything open', async () => {
    const r = await create(spec, valid());
    if (!r.ok) throw new Error(r.code);
    const p = await svc.getProgress(spec, r.id);
    if (!p.ok) throw new Error(p.code);
    expect(p.progress.setup.map((s) => [s.item, s.done, s.owed_by])).toEqual([
      ['basics', false, 'booq'], ['plan', false, 'booq'], ['courts_hours', false, 'booq'], ['line', false, 'booq'], ['payments', false, 'booq'], ['legal_notice', false, 'booq'],
    ]);
    expect(p.progress.launch).toHaveLength(10);
    expect(p.progress.launch.every((l) => l.result === (l.item === 'no_open_launch_failure' ? 'pass' : 'pending'))).toBe(true);
  });

  it('an unknown or malformed club id and an unknown staff member answer not_found', async () => {
    expect(await svc.getProgress(admin, 'aaaaaaaa-0000-4000-8000-0000000000ff')).toEqual({ ok: false, code: 'not_found' });
    expect(await svc.getProgress(admin, 'nope')).toEqual({ ok: false, code: 'not_found' });
    expect(await svc.getProgress('aaaaaaaa-1111-4111-8111-111111111111', 'aaaaaaaa-0000-4000-8000-0000000000ff')).toEqual({ ok: false, code: 'not_found' });
  });
});
