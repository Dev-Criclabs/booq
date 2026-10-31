import { describe, expect, it } from 'vitest';
import { adminHasKey } from './i18n';
import { belowMinimum, blankTemplate, CLASS_ERROR_KEY, classErrorKey, sessionBody, sessionDraft, STATUS_KEY, templateBody, templateDraft, weekOf, type Session, type Template } from './classes';

// F11-T17 A8 Group classes (ADMIN-09): a class is 60 minutes on the hour; a price left empty is not set; only changes are sent; the database decides every clash.
const tpl: Template = { id: 't1', nameTh: 'คลินิก', nameEn: 'Clinic', audience: 'adult', level: 'Beginner', coachId: 'c1', resourceId: 'k1', weekday: 2, startTime: '19:00', durationMinutes: 60, minPlayers: 4, maxPlayers: 8, dropInPriceSatang: 30000, active: true, endedOn: null };
const filled = { ...blankTemplate(), nameTh: 'ก', nameEn: 'A', coachId: 'c1', resourceId: 'k1', weekday: '2', startHour: '19', minPlayers: '4', maxPlayers: '8' };
const session: Session = { id: 's1', templateId: 't1', startAt: '2027-01-19T12:00:00Z', endAt: '2027-01-19T13:00:00Z', nameTh: 'ก', nameEn: 'A', audience: 'adult', level: null, coachId: 'c1', resourceId: 'k1', minPlayers: 4, maxPlayers: 8, dropInPriceSatang: null, status: 'scheduled', attentionReason: null, cancelReason: null, edited: false, taken: 2, waiting: 0 };

describe('weeks and below minimum', () => {
  it('a week runs Monday to Sunday around the server\'s today, and steps by weeks', () => {
    expect(weekOf('2027-01-20', 0)).toEqual({ from: '2027-01-18', to: '2027-01-24' });
    expect(weekOf('2027-01-24', 0)).toEqual({ from: '2027-01-18', to: '2027-01-24' }); // a Sunday belongs to the week before
    expect(weekOf('2027-01-20', 1)).toEqual({ from: '2027-01-25', to: '2027-01-31' });
    expect(weekOf('2027-01-20', -1)).toEqual({ from: '2027-01-11', to: '2027-01-17' });
  });
  it('below minimum is a session still to come, not cancelled, with fewer taken than its minimum', () => {
    expect(belowMinimum(session, '2027-01-18T00:00:00Z')).toBe(true);
    expect(belowMinimum({ ...session, taken: 4 }, '2027-01-18T00:00:00Z')).toBe(false);
    expect(belowMinimum({ ...session, status: 'cancelled' }, '2027-01-18T00:00:00Z')).toBe(false);
    expect(belowMinimum(session, '2027-01-20T00:00:00Z')).toBe(false);
  });
});

describe('templates', () => {
  it('a new template sends every field: 60 minutes on the hour, an empty price not set (null), an empty level null', () => {
    expect(templateBody(undefined, filled)).toEqual({ ok: true, body: { nameTh: 'ก', nameEn: 'A', audience: 'adult', level: null, coachId: 'c1', resourceId: 'k1', weekday: 2, startTime: '19:00', durationMinutes: 60, minPlayers: 4, maxPlayers: 8, dropInPriceSatang: null } });
    expect(templateBody(undefined, { ...filled, dropIn: '300', level: ' Beginner ', weekday: '0', startHour: '7' })).toMatchObject({ ok: true, body: { dropInPriceSatang: 30000, level: 'Beginner', weekday: 0, startTime: '07:00' } });
  });
  it('wrong input is refused before the server', () => {
    expect(templateBody(undefined, { ...filled, nameEn: ' ' })).toEqual({ ok: false, key: 'A-new.cls_err_names' });
    expect(templateBody(undefined, { ...filled, coachId: '' })).toEqual({ ok: false, key: 'A-new.cls_err_coach' });
    expect(templateBody(undefined, { ...filled, resourceId: '' })).toEqual({ ok: false, key: 'A-new.cls_err_court' });
    expect(templateBody(undefined, { ...filled, weekday: '' })).toEqual({ ok: false, key: 'A-new.cls_err_weekday' });
    expect(templateBody(undefined, { ...filled, weekday: '7' })).toEqual({ ok: false, key: 'A-new.cls_err_weekday' });
    expect(templateBody(undefined, { ...filled, startHour: '24' })).toEqual({ ok: false, key: 'A-new.cls_err_hour' });
    expect(templateBody(undefined, { ...filled, minPlayers: '9' })).toEqual({ ok: false, key: 'A-new.cls_err_minmax' });
    expect(templateBody(undefined, { ...filled, maxPlayers: '0' })).toEqual({ ok: false, key: 'A-new.cls_err_players' });
    expect(templateBody(undefined, { ...filled, dropIn: '1.234' })).toEqual({ ok: false, key: 'A-new.cls_err_price' });
  });
  it('a change sends only what changed, never the length; an emptied price goes as null', () => {
    const d = templateDraft(tpl);
    expect(d).toMatchObject({ weekday: '2', startHour: '19', dropIn: '300', audience: 'adult' });
    expect(templateBody(tpl, d)).toEqual({ ok: false, key: 'A-new.cls_nothing_changed' });
    expect(templateBody(tpl, { ...d, maxPlayers: '10', dropIn: '' })).toEqual({ ok: true, body: { maxPlayers: 10, dropInPriceSatang: null } });
  });
});

describe('a session edit', () => {
  it('sends only what changed; min above max is refused', () => {
    const d = sessionDraft(session);
    expect(sessionBody(session, d)).toEqual({ ok: false, key: 'A-new.cls_nothing_changed' });
    expect(sessionBody(session, { ...d, coachId: 'c2', minPlayers: '2', dropIn: '250' })).toEqual({ ok: true, body: { coachId: 'c2', minPlayers: 2, dropInPriceSatang: 25000 } });
    expect(sessionBody(session, { ...d, minPlayers: '9' })).toEqual({ ok: false, key: 'A-new.cls_err_minmax' });
  });
});

describe('refusals and text', () => {
  it('each refusal has its own words; a template clash carries its dates', () => {
    expect(classErrorKey({ kind: 'refused', status: 409, code: 'template_clash', params: { dates: '2027-01-19,2027-01-26', reasons: 'booking' } })).toEqual({ key: 'A-new.cls_err_clash', dates: '2027-01-19,2027-01-26' });
    expect(classErrorKey({ kind: 'refused', status: 409, code: 'coach_rest' }).key).toBe('A-new.cls_err_rest');
    expect(classErrorKey({ kind: 'refused', status: 409, code: 'zzz' }).key).toBe('A-new.cls_err_general');
    expect(classErrorKey({ kind: 'forbidden' }).key).toBe('A-new.cls_err_forbidden');
  });
  it('every key the page uses exists in both languages', () => {
    const keys = ['A-0019', 'A-0024', 'A-0015', 'A-0069', 'A-0070', 'A-0159', 'A-0187', 'A-0192', 'A-0200', 'A-0201', 'A-0202', 'A-0204', 'A-0206', 'A-0207', 'A-0208', 'A-0210', 'A-0211', 'A-0212', 'A-0213', 'A-0214', 'A-0218', 'A-0224', 'A-0321',
      'A-new.set_retry', 'A-new.set_saved', 'A-new.cal_close', 'A-new.sell_pick', 'A-new.coach_no_name', 'A-new.coach_not_set', 'A-new.cust_no_name', 'A-new.book_status_confirmed', 'A-new.price_name_th', 'A-new.price_name_en', ...Object.values(STATUS_KEY), ...Object.values(CLASS_ERROR_KEY),
      ...['load_failed', 'below_line', 'prev_week', 'next_week', 'none_week', 'min_line', 'waiting', 'roster', 'roster_none', 'waitlist', 'waitlist_none', 'offered', 'waiting_state', 'resolve', 'resolved', 'not_resolved', 'cancelled', 'min', 'max', 'drop_in', 'start_hour',
        'no_templates', 'min_max', 'end', 'end_confirm', 'created', 'updated', 'ended', 'nothing_changed', 'err_names', 'err_coach', 'err_court', 'err_weekday', 'err_hour', 'err_players', 'err_minmax', 'err_price', 'err_general'].map((k) => `A-new.cls_${k}`)];
    for (const lang of ['th', 'en'] as const) for (const k of keys) expect(adminHasKey(lang, k), `${lang} ${k}`).toBe(true);
  });
});
