import { describe, expect, it } from 'vitest';
import { auditPath, changeLines, checkQuery } from './audit';
import { adminHasKey } from './i18n';
import { ASSIGNABLE, inviteBody, inviteLink, loadStaff, roleSet, ROLE_KEY, shownRoles, STAFF_ERROR_KEY, staffErrorKey } from './staff';

// F11-T23 A17 Staff and audit log (ADMIN-17).
const reply = (status: number, json: unknown) => (async () => new Response(JSON.stringify(json), { status })) as unknown as typeof fetch;

describe('staff', () => {
  it('a coach invite carries no roles; a staff invite needs front desk, accountant or both', () => {
    expect(inviteBody('coach')).toEqual({ kind: 'coach' });
    expect(inviteBody(['front_desk'])).toEqual({ kind: 'staff', roles: ['front_desk'] });
    expect(inviteBody(['front_desk', 'accountant'])).toEqual({ kind: 'staff', roles: ['front_desk', 'accountant'] });
    expect(inviteBody([])).toBeNull();
  });
  it('the invite link is inside the club and carries the token once', () => {
    expect(inviteLink('https://app.example', 'hunter', 'abc def')).toBe('https://app.example/c/hunter/join?invite=abc%20def');
  });
  it('the role set always holds player, in a fixed order, and never owner', () => {
    expect(roleSet(['front_desk'])).toEqual(['front_desk', 'player']);
    expect(roleSet(['coach', 'accountant', 'owner', 'front_desk'])).toEqual(['accountant', 'coach', 'front_desk', 'player']);
    expect(roleSet([])).toEqual(['player']);
    expect(ASSIGNABLE).not.toContain('owner');
  });
  it('a row shows the staff roles, and Player only when it is all there is', () => {
    expect(shownRoles(['front_desk', 'player'])).toEqual(['front_desk']);
    expect(shownRoles(['player'])).toEqual(['player']);
    expect(shownRoles(['owner', 'player'])).toEqual(['owner']);
  });
  it('a club with no staff row yet answers null and shows as an empty list', async () => {
    expect(await loadStaff('hunter', reply(200, null))).toEqual({ kind: 'ok', body: [] });
    expect(await loadStaff('hunter', reply(403, { code: 'forbidden' }))).toEqual({ kind: 'forbidden' });
  });
  it('each typed refusal has its own words, the rest the general one', () => {
    expect(staffErrorKey({ kind: 'refused', status: 409, code: 'owner_fixed' })).toBe('A-new.staff_err_owner');
    expect(staffErrorKey({ kind: 'refused', status: 400, code: 'invalid_roles' })).toBe('A-new.staff_err_roles');
    expect(staffErrorKey({ kind: 'refused', status: 503, code: 'not_configured' })).toBe('A-new.staff_err_not_configured');
    expect(staffErrorKey({ kind: 'refused', status: 400, code: 'weird' })).toBe('A-new.staff_err_general');
    expect(staffErrorKey({ kind: 'offline' })).toBe('A-new.staff_err_general');
  });
});

describe('audit', () => {
  it('filters are checked before the server is asked: the staff id, the record type, real days and an order', () => {
    expect(checkQuery({ staff: '', type: '', from: '', to: '' })).toEqual({ ok: true });
    expect(checkQuery({ staff: 'nope', type: '', from: '', to: '' })).toEqual({ ok: false, key: 'A-new.audit_bad_staff' });
    expect(checkQuery({ staff: '', type: 'Booking!', from: '', to: '' })).toEqual({ ok: false, key: 'A-new.audit_bad_type' });
    expect(checkQuery({ staff: '', type: '', from: '09/01/2027', to: '' })).toEqual({ ok: false, key: 'A-new.audit_bad_day' });
    expect(checkQuery({ staff: '', type: '', from: '2027-01-09', to: '2027-01-08' })).toEqual({ ok: false, key: 'A-new.audit_bad_range' });
  });
  it('only what was chosen goes in the address', () => {
    expect(auditPath({ staff: '', type: '', from: '', to: '' })).toBe('/staff/audit');
    expect(auditPath({ staff: '00000000-0000-4000-8000-000000000001', type: ' booking ', from: '2027-01-01', to: '2027-01-09', cursor: 'c' })).toBe('/staff/audit?staff=00000000-0000-4000-8000-000000000001&type=booking&from=2027-01-01&to=2027-01-09&cursor=c');
  });
  it('a change is shown field by field, an unchanged field is left out, a personal field is only named by the page', () => {
    expect(changeLines({ oldValue: { hold: 10, same: 1 }, newValue: { hold: 15, same: 1 }, piiFields: [] })).toEqual(['hold: 10 → 15']);
    expect(changeLines({ oldValue: null, newValue: { court: '2' }, piiFields: [] })).toEqual(['court: ∅ → 2']);
    expect(changeLines({ oldValue: 'Cash', newValue: 'QR', piiFields: [] })).toEqual(['Cash → QR']);
    expect(changeLines({ oldValue: null, newValue: null, piiFields: ['phone'] })).toEqual([]);
    expect(changeLines({ oldValue: { note: 'x'.repeat(200) }, newValue: { note: 'y' }, piiFields: [] })[0]!.length).toBeLessThan(120);
  });
});

describe('text', () => {
  it('every key the page uses exists in both languages', () => {
    const keys = ['A-0014', 'A-0075', 'A-0135', 'A-0163', 'A-0193', 'A-0258', 'A-0367', 'A-0368', 'A-0369', 'A-0370', 'A-0372', 'A-0373', 'A-0375', 'A-0376', 'A-0379', 'A-0381', 'A-0385', 'A-0386', 'A-0387', 'A-0388',
      ...Object.values(ROLE_KEY), ...Object.values(STAFF_ERROR_KEY),
      'A-new.staff_title', 'A-new.staff_invite_title', 'A-new.staff_invite_role', 'A-new.staff_invite_pick', 'A-new.staff_link_title', 'A-new.staff_link_once', 'A-new.staff_link_copied', 'A-new.staff_link_done', 'A-new.staff_empty',
      'A-new.staff_invites_title', 'A-new.staff_invites_none', 'A-new.staff_invite_expires', 'A-new.staff_inactive', 'A-new.staff_edit_roles', 'A-new.staff_save_roles', 'A-new.staff_cancel', 'A-new.staff_confirm_deactivate',
      'A-new.staff_confirm_yes', 'A-new.staff_owner_fixed', 'A-new.staff_saved', 'A-new.staff_load_failed', 'A-new.staff_forbidden', 'A-new.staff_err_general', 'A-new.audit_staff_all', 'A-new.audit_type_label',
      'A-new.audit_type_placeholder', 'A-new.audit_from', 'A-new.audit_to', 'A-new.audit_apply', 'A-new.audit_empty', 'A-new.audit_more', 'A-new.audit_load_failed', 'A-new.audit_forbidden', 'A-new.audit_pii',
      'A-new.audit_bad_staff', 'A-new.audit_bad_type', 'A-new.audit_bad_day', 'A-new.audit_bad_range', 'A-new.audit_note', 'A-new.audit_system'];
    for (const lang of ['th', 'en'] as const) for (const k of keys) expect(adminHasKey(lang, k), `${lang} ${k}`).toBe(true);
  });
});
