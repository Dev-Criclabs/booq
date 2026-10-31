import type { LineMessageObject, MessageBuilder, MessageLanguage, OutgoingMessage } from '../sender/types';
import { renderCard, type Card, type CardButton, type CardRow } from './card';
import type { MessageFacts, MessageHour } from './facts';
import { date, dateYear, dayMonthYear, money, time } from './format';

// The message builder (F10-T10; F10 design 5.4 and 5.6; LINE-04, LINE-05, TEXT-01, TEXT-03). One card per message in the
// Booking confirmed card style (D91). Every text comes from locales/* by key with the named variables of
// locales/README.md; the layout is fixed in code (LINE-03-AC3). Keys not yet merged live in locales/pending/f10.json (D81).

export type Dictionary = Readonly<Record<string, string>>;

/** Where a button goes. The deep links (club in the URL, D6) are F02's helper; the builder only names the target. */
export type LinkTarget =
  | { page: 'booking'; bookingId: string }
  | { page: 'calendar'; bookingId: string }
  | { page: 'book' }
  | { page: 'packages' }
  | { page: 'offer'; params: Readonly<Record<string, unknown>> };

export interface MessageLinks {
  /** The URL for a button, or null when there is none (the button is left out). */
  link(clubId: string, target: LinkTarget): string | null;
}

export interface MessageBuilderOptions {
  dictionary(language: MessageLanguage): Dictionary;
  links: MessageLinks;
}

/** A missing key or variable is a bug, never shown: the row stays pending and the error is logged by the sender. */
export class MessageTextError extends Error {
  constructor(code: string) {
    super(code);
    this.name = 'MessageTextError';
  }
}

export function fill(dict: Dictionary, key: string, vars: Readonly<Record<string, string | number>> = {}): string {
  const template = dict[key];
  if (template === undefined) throw new MessageTextError(`message_text_missing:${key}`);
  return template.replace(/\{([A-Za-z][A-Za-z0-9]*)\}/g, (_m, name: string) => {
    const v = vars[name];
    if (v === undefined) throw new MessageTextError(`message_variable_missing:${key}:${name}`);
    return String(v);
  });
}

export function createMessageBuilder(options: MessageBuilderOptions): MessageBuilder {
  return {
    build(message: OutgoingMessage): LineMessageObject[] {
      const dict = options.dictionary(message.language);
      const card = cardFor(message, dict, options.links);
      return [renderCard(card)];
    },
  };
}

function cardFor(m: OutgoingMessage, dict: Dictionary, links: MessageLinks): Card {
  const lang = m.language;
  const f = m.facts;
  const t = (key: string, vars?: Record<string, string | number>) => fill(dict, key, vars);
  const button = (key: string, target: LinkTarget): CardButton[] => {
    const uri = links.link(m.clubId, target);
    return uri ? [{ label: t(key), uri }] : [];
  };
  const base = { clubName: f.clubName[lang], rows: [] as CardRow[], buttons: [] as CardButton[] };
  const first = f.hours[0];
  const viewBooking = first?.bookingId ? button('L-0018', { page: 'booking', bookingId: first.bookingId }) : [];
  const classRow: CardRow[] = f.className ? [{ label: t('L-0033'), values: [f.className[lang]] }] : [];

  switch (m.kind) {
    case 'booking_confirmed':
      return {
        ...base,
        title: f.firstName ? t('L-0009', { firstName: f.firstName }) : t('L-new.msg_booked_title'),
        rows: [...hourRows(f.hours, lang, t), ...paidRows(f, t), ...(f.receiptNumber ? [{ label: t('L-0017'), values: [f.receiptNumber] }] : [])],
        buttons: first?.bookingId ? [...viewBooking, ...button('L-0019', { page: 'calendar', bookingId: first.bookingId })] : [],
      };
    case 'reminder_24h':
    case 'reminder_2h':
      return {
        ...base,
        title: m.kind === 'reminder_2h' ? t('L-0021') : t('L-new.msg_reminder_title_hours', { hours: f.hoursBefore ?? 0 }),
        rows: hourRows(f.hours, lang, t),
        buttons: viewBooking,
      };
    case 'booking_released':
      return { ...base, title: t('L-new.msg_released_title'), body: t('L-new.msg_released_body'), rows: hourRows(f.hours, lang, t), buttons: button('L-0001', { page: 'book' }) };
    case 'cancellation_result':
      return { ...base, title: t('L-new.msg_cancelled_title'), body: t('L-new.msg_cancelled_body'), rows: [...classRow, ...hourRows(f.hours, lang, t)] };
    case 'club_closed_slot':
      return { ...base, title: t('L-new.msg_closed_title'), body: t('L-new.msg_closed_body'), rows: hourRows(f.hours, lang, t) };
    case 'coach_changed':
      return {
        ...base,
        title: t('L-new.msg_coach_changed_title'),
        rows: [...(f.coachName ? [{ label: t('L-0024'), values: [f.coachName] }] : []), ...hourRows(f.hours, lang, t, { coach: false })],
        buttons: viewBooking,
      };
    case 'session_change':
      return { ...base, title: t('L-new.msg_session_change_title'), rows: [...classRow, ...hourRows(f.hours, lang, t)] };
    case 'class_below_minimum':
      return { ...base, title: t('L-new.msg_below_min_title'), rows: [...classRow, ...hourRows(f.hours, lang, t)] };
    case 'class_session_changed':
      return { ...base, title: t('L-new.msg_class_changed_title'), rows: [...classRow, ...hourRows(f.hours, lang, t)], buttons: viewBooking };
    case 'waitlist_ended':
      return { ...base, title: t('L-new.msg_waitlist_ended_title'), body: t('L-new.msg_waitlist_ended_body'), rows: [...classRow, ...hourRows(f.hours, lang, t)] };
    case 'waitlist_offer':
      return {
        ...base,
        title: t('L-0031'),
        ...(f.claimMinutes ? { subtitle: t('L-0032', { claimMinutes: f.claimMinutes }) } : {}),
        rows: first
          ? [
              ...classRow,
              { label: t('L-0035'), values: [t('L-0036', { date: date(first.startAt, lang), startTime: time(first.startAt), endTime: time(first.endAt) })] },
              ...(first.court ? [{ label: t('L-0010'), values: [t('L-0037', { court: first.court })] }] : []),
            ]
          : [],
        buttons: [...button('L-0040', { page: 'offer', params: m.params }), ...button('L-0041', { page: 'offer', params: m.params })],
      };
    case 'package_expiring':
      return {
        ...base,
        title: t('L-new.msg_package_expiring_title'),
        ...(f.package ? { body: t('L-new.msg_package_expiring_body', { remaining: f.package.creditsLeft, dayMonthYear: dayMonthYear(f.package.expiresAt, lang) }) } : {}),
        buttons: button('L-0004', { page: 'packages' }),
      };
    case 'birthday_discount':
      return { ...base, title: t('L-new.msg_birthday_title'), body: t('L-new.msg_birthday_body'), buttons: button('L-0001', { page: 'book' }) };
    case 'referral_reward':
      return { ...base, title: t('L-new.msg_reward_title'), body: t('L-new.msg_reward_body') };
    case 'leave_decision':
      return { ...base, title: f.status === 'approved' ? t('L-new.msg_leave_approved_title') : t('L-new.msg_leave_declined_title') };
    case 'late_payment':
      return { ...base, title: t('L-new.msg_late_payment_title'), ...(f.amountSatang !== null ? { body: t('L-new.msg_late_payment_body', { amount: money(f.amountSatang) }) } : {}) };
    case 'wrong_amount':
      return { ...base, title: t('L-new.msg_wrong_amount_title'), ...(f.amountSatang !== null ? { body: t('L-new.msg_wrong_amount_body', { amount: money(f.amountSatang) }) } : {}) };
    case 'owner_paused':
      return { ...base, title: t('L-new.msg_paused_title'), body: t('L-new.msg_paused_body') };
    case 'owner_cap_paid_over':
      return { ...base, title: t('L-new.msg_cap_paid_over_title'), body: t('L-new.msg_cap_paid_over_body') };
    default:
      // i18n-ignore internal code, never shown
      throw new MessageTextError(`message_kind_unknown:${m.kind}`);
  }
}

/** Court (or coach), date and time rows for the booked hours: one card for a whole order, one line per hour (BOOK-06). */
function hourRows(hours: MessageHour[], lang: MessageLanguage, t: (k: string, v?: Record<string, string | number>) => string, opts: { coach?: boolean } = {}): CardRow[] {
  if (hours.length === 0) return [];
  const rows: CardRow[] = [];
  const courts = [...new Set(hours.map((h) => h.court).filter((c): c is string => !!c))];
  if (courts.length > 0) rows.push({ label: t('L-0010'), values: courts.map((c) => t('L-0011', { court: c })) });
  const coaches = [...new Set(hours.map((h) => h.coachName).filter((c): c is string => !!c))];
  if (opts.coach !== false && coaches.length > 0) rows.push({ label: t('L-0024'), values: coaches });
  const days = [...new Set(hours.map((h) => dateYear(h.startAt, lang)))];
  rows.push({ label: t('L-0012'), values: days.map((d) => t('L-0013', { dateYear: d })) });
  rows.push({ label: t('L-0014'), values: hours.map((h) => t('L-new.msg_time_range', { startTime: time(h.startAt), endTime: time(h.endAt) })) });
  return rows;
}

/** How the order was paid. A zero money order shows how it was paid instead of an amount (D64). */
function paidRows(f: MessageFacts, t: (k: string, v?: Record<string, string | number>) => string): CardRow[] {
  const values: string[] = [];
  const money0 = f.moneySatang ?? 0;
  if (money0 > 0) values.push(f.paidBy === 'cash' ? t('L-new.msg_paid_cash', { amount: money(money0) }) : t('L-0016', { amount: money(money0) }));
  if ((f.walletSatang ?? 0) > 0) values.push(t('L-new.msg_paid_wallet', { amount: money(f.walletSatang ?? 0) }));
  if ((f.creditValueSatang ?? 0) > 0) values.push(t('L-new.msg_paid_credit'));
  return values.length > 0 ? [{ label: t('L-0015'), values }] : [];
}
