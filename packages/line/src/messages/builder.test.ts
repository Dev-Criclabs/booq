import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { checkConfirmedCard, collectActions, collectTexts, textsNotFromLocale, validateFlexLimits } from '../../../../tests/fakes';
import type { MessageLanguage, OutgoingMessage } from '../sender/types';
import { createMessageBuilder, fill, type LinkTarget } from './builder';
import { loadMessageDictionary } from './dictionary';
import type { MessageFacts } from './facts';
import { money } from './format';

// F10-T10: the Flex templates and the text builder (F10 design 5.4, 5.6; LINE-04-AC1 to AC4, LINE-05, TEXT-01, TEXT-03).
const LOCALES = resolve(__dirname, '../../../../locales');
const dict = { th: loadMessageDictionary('th', LOCALES), en: loadMessageDictionary('en', LOCALES) };
const LIFF = '2012300015-WIi1jtLB';
// A stand in for F02's deep link helper (createDeepLinks): the extra path is relative to the club's LIFF endpoint
// (/c/{slug}), so it follows the LIFF id directly and never names the club again.
const links = {
  link: (_club: string, target: LinkTarget) =>
    target.page === 'booking' ? `https://liff.line.me/${LIFF}/bookings/${target.bookingId}`
      : target.page === 'calendar' ? `https://liff.line.me/${LIFF}/bookings/${target.bookingId}/calendar`
        : `https://liff.line.me/${LIFF}/${target.page}`,
};
const builder = createMessageBuilder({ dictionary: (l) => dict[l], links });

const facts = (o: Partial<MessageFacts> = {}): MessageFacts => ({
  clubName: { th: 'ฮันเตอร์ เทนนิส คลับ', en: 'Hunter Tennis Club' },
  firstName: 'Nok',
  hours: [{ bookingId: 'b1', startAt: '2026-12-09T11:00:00Z', endAt: '2026-12-09T12:00:00Z', court: '3', coachName: null, type: 'court' }],
  moneySatang: 50000, walletSatang: 0, creditValueSatang: 0, paidBy: 'beam',
  receiptNumber: 'HTC-2026-000001', amountSatang: null, coachName: null, package: null, status: null, claimMinutes: null, hoursBefore: null, className: null,
  ...o,
});
const message = (kind: string, language: MessageLanguage, f: MessageFacts = facts(), params: Record<string, unknown> = {}): OutgoingMessage =>
  ({ clubId: 'club-a', messageId: 'm1', kind, params, language, facts: f });
const build = (kind: string, language: MessageLanguage, f?: MessageFacts) => builder.build(message(kind, language, f)) as ReturnType<typeof builder.build> & unknown[];
const texts = (msgs: unknown[]) => collectTexts(msgs[0]);
// Thai letters, not the baht sign (U+0E3F sits in the Thai block but is in every amount, in both languages).
const THAI_LETTER = /[\u0E01-\u0E3A\u0E40-\u0E5B]/;

const KINDS = ['booking_confirmed', 'booking_released', 'reminder_24h', 'reminder_2h', 'cancellation_result', 'club_closed_slot', 'coach_changed',
  'waitlist_offer', 'package_expiring', 'birthday_discount', 'referral_reward', 'session_change', 'leave_decision', 'class_below_minimum',
  'late_payment', 'wrong_amount', 'owner_paused', 'owner_cap_paid_over', 'waitlist_ended', 'class_session_changed'];

describe('every kind (LINE-05, TEXT-01)', () => {
  it('covers the whole catalogue of design 5.4', () => {
    expect(KINDS.length).toBe(20);   // 18 of design 5.4 and the two F08 kinds of the coach message hook
  });

  for (const kind of KINDS) {
    for (const lang of ['th', 'en'] as const) {
      it(`${kind} renders in ${lang} as one card within LINE's limits`, () => {
        const f = facts({ amountSatang: 25050, coachName: 'Coach Bee', package: { expiresAt: '2027-01-31T16:59:59Z', creditsLeft: 3 }, status: 'approved', claimMinutes: 30, hoursBefore: 24 });
        const msgs = builder.build(message(kind, lang, f)) as Array<Record<string, unknown>>;
        expect(msgs.length).toBe(1);
        expect(validateFlexLimits(msgs as never)).toEqual([]);
        expect(String(msgs[0]!['altText']).length).toBeGreaterThan(0);
        // The title comes from the language of the message: Thai text in Thai, none in English (the club name aside).
        const all = texts(msgs).filter((s) => s !== f.clubName[lang] && s !== 'Coach Bee');
        expect(all.some((s) => THAI_LETTER.test(s)), all.join(' | ')).toBe(lang === 'th');
      });
    }
  }

  it('an unknown kind or a missing key is an error, never an empty message', () => {
    expect(() => builder.build(message('promo_blast', 'en'))).toThrow(/message_kind_unknown/);
    expect(() => fill({}, 'L-0009', { firstName: 'x' })).toThrow(/message_text_missing:L-0009/);
    expect(() => fill(dict.en, 'L-0009')).toThrow(/message_variable_missing:L-0009:firstName/);
  });
});

describe('Booking confirmed card (LINE-04)', () => {
  it('holds court, date, time, amount paid, receipt number and the two buttons, from locale keys (LINE-04-AC1)', () => {
    for (const lang of ['th', 'en'] as const) {
      const msgs = build('booking_confirmed', lang);
      const e = dict[lang];
      const problems = checkConfirmedCard(msgs as never, {
        lang, liffId: LIFF, receiptNumber: 'HTC-2026-000001',
        mustContain: [fill(e, 'L-0011', { court: '3' }), '18:00', '19:00', money(50000), fill(e, 'L-0009', { firstName: 'Nok' })],
      });
      // The club's name is data, not a key; the time range line is a pending key until Content merges it. The fake's
      // language guess counts the baht sign as Thai (reported to QA), so the language is checked here on Thai letters.
      const allowed = [new RegExp(`^${facts().clubName[lang]}$`), /^\d{2}:\d{2} (to|ถึง) \d{2}:\d{2}$/];
      expect(problems.filter((p) => !p.startsWith('card language is') && !allowed.some((re) => re.test(p.replace(/^text not from a locale key: "|"$/g, ''))))).toEqual([]);
      expect(texts(msgs).filter((x) => x !== facts().clubName[lang]).some((x) => THAI_LETTER.test(x))).toBe(lang === 'th');
      expect(textsNotFromLocale(msgs[0] as never, lang, allowed)).toEqual([]);
      expect(collectActions(msgs[0]).map((a) => a.label)).toEqual([fill(e, 'L-0018'), fill(e, 'L-0019')]);
    }
  });

  it('a two hour order is one card listing both hours with one receipt number (BOOK-06)', () => {
    const f = facts({ hours: [
      { bookingId: 'b1', startAt: '2026-12-09T11:00:00Z', endAt: '2026-12-09T12:00:00Z', court: '3', coachName: null, type: 'court' },
      { bookingId: 'b2', startAt: '2026-12-09T12:00:00Z', endAt: '2026-12-09T13:00:00Z', court: '3', coachName: null, type: 'court' },
    ], moneySatang: 100000 });
    const msgs = build('booking_confirmed', 'en', f);
    expect(msgs.length).toBe(1);
    const all = texts(msgs);
    expect(all).toContain(fill(dict.en, 'L-new.msg_time_range', { startTime: '18:00', endTime: '19:00' }));
    expect(all).toContain(fill(dict.en, 'L-new.msg_time_range', { startTime: '19:00', endTime: '20:00' }));
    expect(all.filter((s) => s === 'HTC-2026-000001').length).toBe(1);
    expect(all.filter((s) => s === fill(dict.en, 'L-0011', { court: '3' })).length).toBe(1);
  });

  it('a zero money order shows its receipt and how it was paid, not an amount (D64)', () => {
    const msgs = build('booking_confirmed', 'th', facts({ moneySatang: 0, creditValueSatang: 50000, paidBy: null, receiptNumber: 'HTC-2026-000002' }));
    const all = texts(msgs);
    expect(all).toContain(fill(dict.th, 'L-new.msg_paid_credit'));
    expect(all).toContain('HTC-2026-000002');
    expect(all.some((s) => s.includes(money(50000)))).toBe(false);
  });

  it('cash and wallet show their own way of paying', () => {
    const all = texts(build('booking_confirmed', 'en', facts({ moneySatang: 30000, walletSatang: 20000, paidBy: 'cash' })));
    expect(all).toContain(fill(dict.en, 'L-new.msg_paid_cash', { amount: money(30000) }));
    expect(all).toContain(fill(dict.en, 'L-new.msg_paid_wallet', { amount: money(20000) }));
  });

  it('a Testing club’s card carries the test receipt number (PLAT-07)', () => {
    expect(texts(build('booking_confirmed', 'en', facts({ receiptNumber: 'HTC-T2026-000001' })))).toContain('HTC-T2026-000001');
  });

  it('no first name on record: the title without a name', () => {
    expect(texts(build('booking_confirmed', 'en', facts({ firstName: null })))).toContain(fill(dict.en, 'L-new.msg_booked_title'));
  });

  it('a solo class shows its coach; amounts are whole baht or two decimals (D69)', () => {
    const f = facts({ hours: [{ bookingId: 'b1', startAt: '2026-12-09T11:00:00Z', endAt: '2026-12-09T12:00:00Z', court: '1', coachName: 'Coach Bee', type: 'solo_class' }], moneySatang: 120050 });
    const all = texts(build('booking_confirmed', 'en', f));
    expect(all).toContain('Coach Bee');
    expect(money(120050)).toMatch(/^฿1,200\.50$/);
    expect(money(120000)).toMatch(/^฿1,200$/);
  });

  it('dates use the international year in both languages, never the Buddhist year', () => {
    for (const lang of ['th', 'en'] as const) {
      const all = texts(build('booking_confirmed', lang)).join(' ');
      expect(all).toContain('2026');
      expect(all).not.toContain('2569');
    }
  });

  it('a button with no link is left out, not sent empty', () => {
    const none = createMessageBuilder({ dictionary: (l) => dict[l], links: { link: () => null } });
    expect(collectActions(none.build(message('booking_confirmed', 'en'))[0 as never])).toEqual([]);
  });
});

describe('reminders and the waitlist offer (boards L-Msg-Reminder, L-Msg-Waitlist)', () => {
  it('both reminders use the board key L-0021 with their hours (D116, QA-F10-1)', () => {
    expect(texts(build('reminder_2h', 'en', facts({ hoursBefore: 2 })))).toContain(fill(dict.en, 'L-0021', { hours: 2 }));
    expect(texts(build('reminder_24h', 'th', facts({ hoursBefore: 24 })))).toContain(fill(dict.th, 'L-0021', { hours: 24 }));
    expect(fill(dict.en, 'L-0021', { hours: 2 })).not.toBe(fill(dict.en, 'L-0021', { hours: 24 }));
  });

  it('the offer shows the claim time from the club setting, and no claim line when the setting is unset', () => {
    expect(texts(build('waitlist_offer', 'en', facts({ claimMinutes: 20 })))).toContain(fill(dict.en, 'L-0032', { claimMinutes: 20 }));
    expect(texts(build('waitlist_offer', 'en', facts({ claimMinutes: null }))).some((s) => s.includes('20'))).toBe(false);
  });
});

describe('no literal user facing text in the templates (TEXT-01, lint)', () => {
  it('tools/i18n/lint-hardcoded-text.mjs passes on packages/line/src/messages and sender', () => {
    const root = resolve(__dirname, '../../../..');
    const out = execFileSync('node', ['tools/i18n/lint-hardcoded-text.mjs', 'packages/line/src/messages', 'packages/line/src/sender'], { cwd: root, encoding: 'utf8' });
    expect(out).not.toMatch(/error|✗/i);
  });
});

describe('class messages (F08, the coach message hook)', () => {
  const cls = { th: 'ดริลกลาง', en: 'Mid drill' };
  it('a class message names the class in the message language', () => {
    for (const kind of ['class_session_changed', 'waitlist_ended', 'cancellation_result', 'session_change', 'waitlist_offer']) {
      expect(texts(build(kind, 'en', facts({ className: cls }))), kind).toContain('Mid drill');
      expect(texts(build(kind, 'th', facts({ className: cls }))), kind).toContain('ดริลกลาง');
    }
  });

  it('session_change says what happened from params.change (booked, moved, cancelled; F12-T06); anything else keeps the generic title', () => {
    const titles = { booked: 'A new booking for your class', moved: 'A class booking has moved', cancelled: 'A class booking was cancelled' } as const;
    for (const [change, title] of Object.entries(titles)) {
      expect(texts(builder.build(message('session_change', 'en', facts({ className: cls }), { booking_id: 'b1', change })) as unknown[]), change).toContain(title);
      expect(texts(builder.build(message('session_change', 'th', facts({ className: cls }), { booking_id: 'b1', change })) as unknown[]).some((x) => THAI_LETTER.test(x)), change).toBe(true);
    }
    for (const change of [undefined, 'renamed', 7]) {
      expect(texts(builder.build(message('session_change', 'en', facts({ className: cls }), { booking_id: 'b1', change })) as unknown[]), String(change)).toContain('Your schedule has changed');
    }
  });

  it('the coach’s message about a session has no booking button', () => {
    const f = facts({ className: cls, hours: [{ bookingId: null, startAt: '2026-12-10T11:00:00Z', endAt: '2026-12-10T12:00:00Z', court: '2', coachName: 'Coach Bee', type: 'class_session' }] });
    expect(collectActions(build('session_change', 'en', f)[0])).toEqual([]);
  });
});
