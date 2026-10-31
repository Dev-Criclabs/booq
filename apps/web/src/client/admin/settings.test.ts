import { describe, expect, it } from 'vitest';
import { adminHasKey } from './i18n';
import {
  businessDraft, businessPatch, checkCourt, courtChanges, courtDraft, courtLabelDoubles, hoursDraft, hoursPatch, setErrorKey, windowOpen, type Business, type Court,
} from './club-setup';
import { DEFS, draftOf, GROUPS, parseDraft, rowsOf, ruleErrorKey, type SettingRow } from './rules';

// F11-T22 A16 Settings (ADMIN-16): what is typed becomes a value, nothing is supplied, and the court label never doubles.
const biz: Business = { legal_name: 'Hunter Co', tax_id: '0105500000001', tax_branch: '00000', registered_address: '1 Road', receipt_prefix: 'HTC', vat_enabled: false };
const court: Court = { id: 'c1', location_id: 'l1', name: '1', sport: 'tennis', type: 'outdoor', lights: true, max_players: 4, active: true };
const row = (key: string, over: Partial<SettingRow> = {}): SettingRow => ({ key, value: null, unset: true, required: false, available: true, ...over });

describe('business and tax', () => {
  it('sends only what changed; the tax ID is 13 digits and a detail cannot be cleared', () => {
    const was = businessDraft(biz);
    expect(businessPatch(was, { ...was, legal_name: ' New Co ' })).toEqual({ ok: true, body: { legal_name: 'New Co' } });
    expect(businessPatch(was, { ...was, vat: 'on' })).toEqual({ ok: true, body: { vat_enabled: true } });
    expect(businessPatch(was, { ...was, tax_id: '123' })).toMatchObject({ ok: false, field: 'tax_id', key: 'A-new.set_err_tax_id' });
    expect(businessPatch(was, { ...was, tax_branch: '' })).toMatchObject({ ok: false, key: 'A-new.set_err_empty' });
    expect(businessPatch(was, was)).toMatchObject({ ok: false, key: 'A-new.set_nothing_changed' });
  });
  it('a VAT choice nobody made stays unset', () => {
    expect(businessDraft({ ...biz, vat_enabled: null }).vat).toBe('');
  });
});

describe('opening hours', () => {
  const was = hoursDraft([{ weekday: 1, open: '07:00', close: '22:00' }]);
  it('days with no row are closed; only changed days are sent', () => {
    expect(was[2]!.closed).toBe(true);
    expect(hoursPatch(was, { ...was, 1: { open: '08:00', close: '22:00', closed: false } })).toEqual({ ok: true, hours: [{ weekday: 1, open: '08:00', close: '22:00' }] });
    expect(hoursPatch(was, { ...was, 1: { open: '', close: '', closed: true } })).toEqual({ ok: true, hours: [{ weekday: 1, closed: true }] });
  });
  it('close may be 24:00; open must be earlier than close and both are HH:MM', () => {
    expect(hoursPatch(was, { ...was, 1: { open: '07:00', close: '24:00', closed: false } }).ok).toBe(true);
    expect(hoursPatch(was, { ...was, 1: { open: '22:00', close: '07:00', closed: false } })).toMatchObject({ ok: false, key: 'A-new.set_hours_order' });
    expect(hoursPatch(was, { ...was, 1: { open: '7am', close: '22:00', closed: false } })).toMatchObject({ ok: false, key: 'A-new.set_hours_format' });
    expect(hoursPatch(was, { ...was, 2: { open: '07:00', close: '', closed: false } })).toMatchObject({ ok: false, weekday: 2, key: 'A-new.set_hours_both' });
  });
});

describe('courts', () => {
  it('the name holds only the label, so "Court 1" or "คอร์ต 1" is refused (it would show as "Court Court 1")', () => {
    expect(courtLabelDoubles('Court 1')).toBe(true);
    expect(courtLabelDoubles('  court 2')).toBe(true);
    expect(courtLabelDoubles('คอร์ต 3')).toBe(true);
    expect(courtLabelDoubles('1')).toBe(false);
    expect(courtLabelDoubles('Courtside')).toBe(false);
    expect(checkCourt({ ...courtDraft(court), name: 'Court 1' })).toBe('A-new.set_court_doubles');
    expect(checkCourt({ ...courtDraft(court), name: ' ' })).toBe('A-new.set_court_name');
    expect(checkCourt({ ...courtDraft(court), max_players: 'x' })).toBe('A-new.set_court_players');
    expect(checkCourt(courtDraft(court))).toBeNull();
  });
  it('sends only the changed fields', () => {
    const was = courtDraft(court);
    expect(courtChanges(was, was)).toEqual({});
    expect(courtChanges(was, { ...was, name: '2', lights: false, max_players: '6', active: false })).toEqual({ name: '2', lights: false, max_players: 6, active: false });
  });
});

describe('rules', () => {
  it('a setting nobody set shows empty; a list shows as 7, 3', () => {
    expect(draftOf(row('hold_minutes'))).toBe('');
    expect(draftOf(row('package_expiry_reminder_days', { value: [7, 3], unset: false }))).toBe('7, 3');
    expect(draftOf(row('birthday_discount', { value: { kind: 'percent', value: 1000 }, unset: false }))).toBe('percent 10');
    expect(draftOf(row('birthday_discount', { value: { kind: 'fixed', value: 5050 }, unset: false }))).toBe('fixed 50.5');
  });
  it('whole numbers, choices, lists and the discount are turned into values; wrong ones are refused', () => {
    expect(parseDraft(row('booking_window_days'), '14')).toEqual({ ok: true, value: 14 });
    expect(parseDraft(row('booking_window_days'), '0')).toMatchObject({ ok: false, key: 'A-new.set_err_whole' });
    expect(parseDraft(row('booking_window_days'), '1.5')).toMatchObject({ ok: false });
    expect(parseDraft(row('hold_minutes'), '15')).toEqual({ ok: true, value: 15 });
    expect(parseDraft(row('hold_minutes'), '12')).toMatchObject({ ok: false, key: 'A-new.set_err_choice' });
    expect(parseDraft(row('resource_label'), 'table')).toEqual({ ok: true, value: 'table' });
    expect(parseDraft(row('auto_slip_check'), 'true')).toEqual({ ok: true, value: true });
    expect(parseDraft(row('package_expiry_reminder_days'), '7, 3')).toEqual({ ok: true, value: [7, 3] });
    expect(parseDraft(row('package_expiry_reminder_days'), '7, 7')).toMatchObject({ ok: false, key: 'A-new.set_err_days' });
    expect(parseDraft(row('birthday_discount'), 'percent 10')).toEqual({ ok: true, value: { kind: 'percent', value: 1000 } });
    expect(parseDraft(row('birthday_discount'), 'fixed 50')).toEqual({ ok: true, value: { kind: 'fixed', value: 5000 } });
    expect(parseDraft(row('birthday_discount'), 'percent 100.5')).toMatchObject({ ok: false, key: 'A-new.set_err_discount' });
    expect(parseDraft(row('birthday_discount'), 'gift 10')).toMatchObject({ ok: false, key: 'A-new.set_err_discount' });
  });
  it('empty unsets a setting that may be empty and is refused for a required one', () => {
    expect(parseDraft(row('hold_minutes'), '')).toEqual({ ok: true, value: null });
    expect(parseDraft(row('hold_minutes', { required: true }), '')).toMatchObject({ ok: false, key: 'A-new.set_err_empty' });
  });
  it('rows are grouped in the board order and unknown keys are not drawn', () => {
    const all = [row('hold_minutes'), row('booking_window_days'), row('mystery')];
    expect(rowsOf(all, 'booking').map((r) => r.key)).toEqual(['booking_window_days']);
    expect(rowsOf(all, 'payment').map((r) => r.key)).toEqual(['hold_minutes']);
    expect(GROUPS.map((g) => g.id)).toEqual(['booking', 'payment', 'coaches', 'packages', 'other']);
  });
  it('refusals have their own words, the rest the general one', () => {
    expect(ruleErrorKey({ kind: 'refused', status: 400, code: 'invalid_value' })).toBe('A-new.set_err_refused');
    expect(ruleErrorKey({ kind: 'refused', status: 400, code: 'zzz' })).toBe('A-new.set_err_general');
    expect(setErrorKey({ kind: 'refused', status: 409, code: 'live_bookings_exist' })).toBe('A-new.set_err_live_bookings');
    expect(setErrorKey({ kind: 'offline' })).toBe('A-new.set_err_general');
  });
  it('the support window is open only while its time is in the future', () => {
    const now = new Date('2027-01-10T03:00:00Z');
    expect(windowOpen('2027-01-10T04:00:00Z', now)).toBe(true);
    expect(windowOpen('2027-01-10T02:00:00Z', now)).toBe(false);
    expect(windowOpen(null, now)).toBe(false);
  });
});

describe('text', () => {
  it('every key the page uses exists in both languages', () => {
    const keys = new Set<string>(['A-0162', 'A-0320', 'A-0321', 'A-0019', 'A-0362', ...GROUPS.map((g) => g.titleKey), ...Object.values(DEFS).map((d) => d.labelKey)]);
    for (const d of Object.values(DEFS)) {
      const f = d.field;
      if (f.kind === 'choice') f.options.forEach((o) => keys.add(o.labelKey));
      if (f.kind === 'whole' && f.unit) keys.add(f.unit);
    }
    for (const k of ['A-new.set_err_empty', 'A-new.set_err_tax_id', 'A-new.set_nothing_changed', 'A-new.set_hours_both', 'A-new.set_hours_format', 'A-new.set_hours_order', 'A-new.set_court_name', 'A-new.set_court_doubles',
      'A-new.set_court_players', 'A-new.set_court_name_hint', 'A-new.set_err_whole', 'A-new.set_err_choice', 'A-new.set_err_days', 'A-new.set_err_discount', 'A-new.set_err_unknown', 'A-new.set_err_refused', 'A-new.set_err_not_available',
      'A-new.set_err_input', 'A-new.set_err_live_bookings', 'A-new.set_err_forbidden', 'A-new.set_err_not_found', 'A-new.set_err_general', 'A-new.set_saved', 'A-new.set_forbidden', 'A-new.set_load_failed', 'A-new.set_retry',
      'A-new.set_support_on', 'A-new.set_support_off', 'A-new.set_support_turn_on', 'A-new.set_support_turn_off']) keys.add(k);
    for (const lang of ['th', 'en'] as const) for (const k of keys) expect(adminHasKey(lang, k), `${lang} ${k}`).toBe(true);
  });
});
