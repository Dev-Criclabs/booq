import { describe, expect, it } from 'vitest';
import { adminHasKey } from './i18n';
import { COACH_ERROR_KEY, coachBody, coachErrorKey, missing, payBody, payDraft, profileDraft, reasonFor, type CoachFull, type CoachPay, type Group } from './coaches';

// F11-T16 A7 Coaches (ADMIN-08): empty is "not set"; only changes are sent; a percent is basis points and money is satang; a profile is shown only with consent.
const groups: Group[] = [{ id: 'g1', nameTh: 'ผู้ใหญ่', nameEn: 'Adult' }, { id: 'g2', nameTh: 'นักเรียน', nameEn: 'Student' }];
const coach: CoachFull = {
  coachId: 'c1', displayName: 'Coach Cat', tierId: 't1', active: true, published: false, consentAt: null, overrides: [{ priceGroupId: 'g1', priceSatang: 90000 }],
  profile: { bioTh: null, bioEn: 'Hello', certificationsTh: null, certificationsEn: null, specialtiesTh: [], specialtiesEn: ['Serve', 'Volley'], agesLevelsTh: null, agesLevelsEn: null, languages: ['th', 'en'], photoPath: null },
};

describe('profile', () => {
  it('starts from what is stored; an override nobody set is an empty box', () => {
    const d = profileDraft(coach, groups);
    expect(d).toMatchObject({ tierId: 't1', bioEn: 'Hello', specialtiesEn: 'Serve, Volley', languages: 'th, en', consent: false, published: false, active: true });
    expect(d.overrides).toEqual({ g1: '900', g2: '' });
  });
  it('sends only what changed; an emptied text goes as null; lists are split on commas', () => {
    const was = profileDraft(coach, groups);
    expect(coachBody(coach, was, was)).toEqual({ ok: false, key: 'A-new.coach_nothing_changed' });
    expect(coachBody(coach, was, { ...was, bioEn: '', bioTh: ' สวัสดี ', specialtiesEn: 'Serve, Volley, Lob' })).toEqual({ ok: true, body: { profile: { bio_en: null, bio_th: 'สวัสดี', specialties_en: ['Serve', 'Volley', 'Lob'] } } });
    expect(coachBody(coach, was, { ...was, tierId: '', active: false })).toEqual({ ok: true, body: { tierId: null, active: false } });
  });
  it('overrides: a price is baht to satang, an emptied box removes it (null), junk is refused, only changed ones go', () => {
    const was = profileDraft(coach, groups);
    expect(coachBody(coach, was, { ...was, overrides: { g1: '', g2: '1,000.50' } })).toEqual({ ok: true, body: { overrides: [{ priceGroupId: 'g1', priceSatang: null }, { priceGroupId: 'g2', priceSatang: 100050 }] } });
    expect(coachBody(coach, was, { ...was, overrides: { g1: '900', g2: 'x' } })).toEqual({ ok: false, key: 'A-new.coach_err_amount' });
  });
  it('publishing needs the coach\'s consent, which may be given in the same save', () => {
    const was = profileDraft(coach, groups);
    expect(coachBody(coach, was, { ...was, published: true })).toEqual({ ok: false, key: 'A-new.coach_err_consent' });
    expect(coachBody(coach, was, { ...was, published: true, consent: true })).toEqual({ ok: true, body: { consent: true, published: true } });
    const consented = { ...coach, consentAt: '2027-01-01T03:00:00Z' };
    expect(coachBody(consented, profileDraft(consented, groups), { ...profileDraft(consented, groups), published: true })).toEqual({ ok: true, body: { published: true } });
  });
  it('says which half of the public profile has no text', () => {
    expect(missing(coach)).toEqual({ th: true, en: false });
  });
});

describe('pay', () => {
  const stored: CoachPay = { monthlyBaseSatang: 2000000, soloPayKind: 'percent', soloPayValue: 6000, groupPayKind: 'fixed', groupPayValue: 50000 };
  it('shows baht and percent as typed', () => {
    expect(payDraft(stored)).toEqual({ monthlyBase: '20000', soloKind: 'percent', soloValue: '60', groupKind: 'fixed', groupValue: '500' });
    expect(payDraft({ monthlyBaseSatang: null, soloPayKind: null, soloPayValue: null, groupPayKind: null, groupPayValue: null })).toEqual({ monthlyBase: '', soloKind: '', soloValue: '', groupKind: '', groupValue: '' });
  });
  it('sends the whole set: percent as basis points, fixed as satang, empty as null', () => {
    expect(payBody({ monthlyBase: '20000', soloKind: 'percent', soloValue: '12.5', groupKind: 'fixed', groupValue: '500' })).toEqual({ ok: true, body: { monthlyBaseSatang: 2000000, soloPayKind: 'percent', soloPayValue: 1250, groupPayKind: 'fixed', groupPayValue: 50000 } });
    expect(payBody({ monthlyBase: '', soloKind: '', soloValue: '', groupKind: '', groupValue: '' })).toEqual({ ok: true, body: { monthlyBaseSatang: null, soloPayKind: null, soloPayValue: null, groupPayKind: null, groupPayValue: null } });
  });
  it('a kind and its amount are set together; a percent is at most 100', () => {
    expect(payBody({ monthlyBase: '', soloKind: 'fixed', soloValue: '', groupKind: '', groupValue: '' })).toEqual({ ok: false, key: 'A-new.coach_err_pay' });
    expect(payBody({ monthlyBase: '', soloKind: '', soloValue: '10', groupKind: '', groupValue: '' })).toEqual({ ok: false, key: 'A-new.coach_err_pay' });
    expect(payBody({ monthlyBase: '', soloKind: 'percent', soloValue: '101', groupKind: '', groupValue: '' })).toEqual({ ok: false, key: 'A-new.coach_err_pay' });
    expect(payBody({ monthlyBase: 'x', soloKind: '', soloValue: '', groupKind: '', groupValue: '' })).toEqual({ ok: false, key: 'A-new.coach_err_amount' });
  });
});

describe('substitutes, refusals and text', () => {
  it('a substitution carries the flag\'s reason when the route takes it, else other', () => {
    expect(reasonFor({ reason: 'leave' })).toBe('leave');
    expect(reasonFor({ reason: 'something_else' })).toBe('other');
  });
  it('each refusal has its own words', () => {
    expect(coachErrorKey({ kind: 'refused', status: 409, code: 'coach_unavailable' })).toBe('A-new.coach_err_unavailable');
    expect(coachErrorKey({ kind: 'refused', status: 409, code: 'rest_rule' })).toBe('A-new.coach_err_rest');
    expect(coachErrorKey({ kind: 'refused', status: 400, code: 'xx' })).toBe('A-new.coach_err_general');
    expect(coachErrorKey({ kind: 'forbidden' })).toBe('A-new.coach_err_forbidden');
  });
  it('every key the page uses exists in both languages', () => {
    const keys = ['A-0158', 'A-0168', 'A-0170', 'A-0173', 'A-0174', 'A-0175', 'A-0177', 'A-0178', 'A-0182', 'A-0183', 'A-0184', 'A-0186', 'A-0192', 'A-0193', 'A-0196', 'A-0321', 'A-new.set_retry', 'A-new.set_saved', 'A-new.cal_close', 'A-new.price_baht_unit',
      ...Object.values(COACH_ERROR_KEY),
      ...['load_failed', 'no_name', 'none', 'no_tier', 'state', 'active', 'inactive', 'published', 'unpublished', 'hours', 'full_days', 'approved', 'declined', 'flag_note', 'flag_line', 'pick_sub', 'no_subs', 'away_title', 'away_none', 'status_approved',
        'status_pending', 'status_declined', 'english_missing', 'bio_th', 'bio_en', 'cert_th', 'cert_en', 'spec_th', 'spec_en', 'ages_th', 'ages_en', 'languages', 'consent', 'publish', 'active_label', 'override_hint', 'not_set', 'monthly', 'solo_pay',
        'group_pay', 'pay_value', 'pay_fixed', 'pay_percent', 'pay_hint', 'nothing_changed', 'err_amount', 'err_consent', 'err_pay', 'err_general'].map((k) => `A-new.coach_${k}`)];
    for (const lang of ['th', 'en'] as const) for (const k of keys) expect(adminHasKey(lang, k), `${lang} ${k}`).toBe(true);
  });
});
