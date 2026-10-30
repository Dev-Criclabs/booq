import type { Tx } from '../../../db/src/tx';
import type { CodeInput } from './discounts';
import { CheckoutError } from './errors';
import { priceOrder, type EligibleCredit, type PricingInput, type Quote } from './pricing';

// F04-T11: the quote loader (design 4.2, 5.1; R1 to R4, R8, PROMO-01-AC9, CC-2). Inside the caller's club
// transaction it reads the club's prices, the player's date of birth and entitlements, and asks the ports
// for what other features own, then calls the pure engine. The client sends choices only; any amount in
// the body is ignored (CC-2). Every read is scoped by the club of the transaction (app.club_id()).
//
// Ports, until their features exist: F06 credits and wallet, F07 the coach's tier and own price, F14 the
// referral resolver, and the two reads a player has no grant for (the code row with its counts, and the
// club's birthday discount and cancel window), which the Architect provides as definer reads.

export interface QuoteRequest {
  courtId: string;
  hours: string[];
  coachId: string | null;
  coachSource: 'checkout' | 'classes';
  addOnIds: string[];
  code: string | null;
}

export interface QuoteSources {
  /** The club's code with this text, with its counted uses for `customerId`; null when none (AC9). */
  promoCode(tx: Tx, code: string, customerId: string): Promise<CodeInput | null>;
  /** F14: a friend's referral code as the one code of the order; null when it is not one. */
  referralCode(tx: Tx, code: string, customerId: string): Promise<CodeInput | null>;
  /** The club's `birthday_discount` and `cancel_window_hours` settings, null while unset. */
  clubTerms(tx: Tx): Promise<{ birthdayDiscount: { kind: 'percent' | 'fixed'; value: number } | null; cancelWindowHours: number | null }>;
  /** F07: the coach's tier and own price in this club, or null when there is no such coach. */
  coach(tx: Tx, coachId: string): Promise<{ tierId: string; priceSatang: number | null } | null>;
  /** F06: the player's credits that may pay a court hour or a coach line, in the order to use them. */
  eligibleCredits(tx: Tx, customerId: string): Promise<EligibleCredit[]>;
  /** F06: the wallet balance in satang, from the ledger. */
  walletBalance(tx: Tx, customerId: string): Promise<number>;
}

export interface QuoteView extends Quote {
  /** The club's cancel window for the summary's policy line, `{hours}` (R4-AC5); null while unset. */
  cancelWindowHours: number | null;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CODE = /^[A-Z0-9][A-Z0-9_-]{0,63}$/;
// These two only guard the size of a request. They are not club rules or settings: the club's own hour
// limits are applied by F03's reserve_court at Pay.
const MAX_HOURS = 24;
const MAX_ADD_ONS = 50;

const uuid = (v: unknown): string => {
  if (typeof v !== 'string' || !UUID.test(v)) throw new CheckoutError('bad_input');
  return v.toLowerCase();
};

/** The body as choices (CC-2). Unknown fields, amounts among them, are ignored. */
export function parseQuoteRequest(body: unknown): QuoteRequest {
  const b = (body ?? {}) as Record<string, unknown>;
  const hours = b['hours'];
  if (!Array.isArray(hours) || hours.length === 0 || hours.length > MAX_HOURS || hours.some((h) => typeof h !== 'string')) {
    throw new CheckoutError('bad_input');
  }
  const addOns = b['addOnIds'] ?? [];
  if (!Array.isArray(addOns) || addOns.length > MAX_ADD_ONS) throw new CheckoutError('bad_input');
  const source = b['coachSource'] ?? 'checkout';
  if (source !== 'checkout' && source !== 'classes') throw new CheckoutError('bad_input');
  const code = b['code'] ?? null;
  if (code !== null && typeof code !== 'string') throw new CheckoutError('bad_input');
  const trimmed = code === null ? '' : code.trim().toUpperCase();
  return {
    courtId: uuid(b['courtId']),
    hours: hours as string[],
    coachId: b['coachId'] === undefined || b['coachId'] === null ? null : uuid(b['coachId']),
    coachSource: source,
    addOnIds: addOns.map(uuid),
    code: trimmed === '' ? null : trimmed,
  };
}

interface Row<T> {
  rows: T[];
}
const one = <T>(r: Row<T>): T | undefined => r.rows[0];

/** Read everything the engine needs for `customerId` and price the request. Throws CheckoutError. */
export async function quoteFor(tx: Tx, customerId: string, req: QuoteRequest, sources: QuoteSources): Promise<QuoteView> {
  const club = one(await tx.query<{ status: string; today: string }>(
    `select c.status, (app.now() at time zone 'Asia/Bangkok')::date::text as today from public.club c where c.id = app.club_id()`,
  ));
  if (!club) throw new CheckoutError('club_not_available');
  if (club.status === 'paused') throw new CheckoutError('club_paused'); // R4-AC10, D60
  if (club.status !== 'live' && club.status !== 'testing') throw new CheckoutError('club_not_available');

  const court = one(await tx.query<{ active: boolean }>(`select active from public.resource where club_id = app.club_id() and id = $1`, [req.courtId]));
  if (!court || !court.active) throw new CheckoutError('resource_inactive');

  const person = one(await tx.query<{ dob: string | null }>(
    `select date_of_birth::text as dob from public.app_user where club_id = app.club_id() and id = $1`,
    [customerId],
  ));
  if (!person) throw new CheckoutError('bad_input');

  // The price tables are readable by the club's people once it is open (0309); nothing here is invented.
  const groups = await tx.query<{ id: string; min_age: number | null; max_age: number | null }>(
    `select id, (rule ->> 'min_age')::int as min_age, (rule ->> 'max_age')::int as max_age from public.price_group where club_id = app.club_id()`,
  );
  const rules = await tx.query<{ price_group_id: string; day_type: 'any' | 'weekday' | 'weekend'; peak: 'any' | 'peak' | 'off_peak'; price_satang: number }>(
    `select price_group_id, day_type, peak, price_satang from public.court_price_rule where club_id = app.club_id()`,
  );
  const tierPrices = await tx.query<{ tier_id: string; price_group_id: string; price_satang: number | null }>(
    `select tier_id, price_group_id, price_satang from public.coach_tier_price where club_id = app.club_id()`,
  );
  const addOns = await tx.query<{ id: string; price_satang: number | null; active: boolean }>(
    `select id, price_satang, active from public.add_on where club_id = app.club_id()`,
  );
  const used = await tx.query<{ kind: 'package' | 'solo_class' }>(
    `select kind from public.birthday_entitlement_use
      where club_id = app.club_id() and customer_id = $1 and year = $2 and status = 'used'`,
    [customerId, Number(club.today.slice(0, 4))],
  );
  const terms = await sources.clubTerms(tx);

  let coach: PricingInput['selection']['coach'] = null;
  if (req.coachId !== null && req.coachSource === 'checkout') {
    // A coach picked on C10 needs the club's switch; a solo class through Classes does not (F01 feature keys).
    const on = one(await tx.query<{ enabled: boolean }>(
      `select enabled from public.club_feature where club_id = app.club_id() and feature_key = 'coach_add_at_checkout'`,
    ));
    if (!on?.enabled) throw new CheckoutError('coach_at_checkout_disabled');
  }
  if (req.coachId !== null) {
    const found = await sources.coach(tx, req.coachId);
    if (!found) throw new CheckoutError('coach_price_not_set');
    coach = { coachId: req.coachId, tierId: found.tierId, source: req.coachSource, priceSatang: found.priceSatang };
  }

  let code: PricingInput['code'] = null;
  if (req.code !== null) {
    code = CODE.test(req.code)
      ? ((await sources.promoCode(tx, req.code, customerId)) ?? (await sources.referralCode(tx, req.code, customerId)) ?? 'not_found')
      : 'not_found';
  }

  const result = priceOrder({
    onDate: club.today,
    dob: person.dob,
    priceGroups: groups.rows.map((g) => ({ id: g.id, minAge: g.min_age, maxAge: g.max_age })),
    courtPriceRules: rules.rows.map((r) => ({ priceGroupId: r.price_group_id, dayType: r.day_type, peak: r.peak, priceSatang: r.price_satang })),
    coachTierPrices: tierPrices.rows.map((p) => ({ tierId: p.tier_id, priceGroupId: p.price_group_id, priceSatang: p.price_satang })),
    addOns: addOns.rows.map((a) => ({ id: a.id, priceSatang: a.price_satang, active: a.active })),
    selection: { courtId: req.courtId, hours: req.hours, coach, addOnIds: req.addOnIds },
    credits: await sources.eligibleCredits(tx, customerId),
    walletBalanceSatang: await sources.walletBalance(tx, customerId),
    code,
    birthday: { setting: terms.birthdayDiscount, usedKinds: used.rows.map((u) => u.kind) },
  });
  if (!result.ok) {
    if (result.code === 'code_below_minimum') throw new CheckoutError(result.code, { amount: result.minSpendSatang });
    throw new CheckoutError(result.code);
  }
  return { ...result.quote, cancelWindowHours: terms.cancelWindowHours };
}

/** The ports until F06, F07 and F14 exist: no credits, an empty wallet, no coach, no referral codes. */
export const pendingFeatureSources: Pick<QuoteSources, 'referralCode' | 'coach' | 'eligibleCredits' | 'walletBalance'> = {
  referralCode: async () => null,
  coach: async () => null,
  eligibleCredits: async () => [],
  walletBalance: async () => 0,
};

interface PromoRow {
  id: string;
  kind: 'percent' | 'fixed';
  value: number;
  applies_to: CodeInput['appliesTo'];
  includes_add_ons: boolean;
  audience: CodeInput['audience'];
  starts_on: string | null;
  ends_on: string | null;
  first_time_only: boolean;
  total_cap: number | null;
  per_customer_cap: number | null;
  min_spend_satang: number | null;
  stackable_with_birthday: boolean;
  partner_id: string | null;
  active: boolean;
  uses_counted: number;
  customer_uses_counted: number;
  customer_has_paid_booking: boolean;
}

/** The club's own reads: app.quote_promo_code (0315) and public.public_booking_config (0316). */
export const clubQuoteReads: Pick<QuoteSources, 'promoCode' | 'clubTerms'> = {
  async promoCode(tx, code, customerId) {
    const r = one(await tx.query<{ c: PromoRow | null }>('select app.quote_promo_code($1, $2) as c', [code, customerId]));
    const c = r?.c;
    if (!c) return null;
    return {
      source: 'promo',
      id: c.id,
      kind: c.kind,
      value: c.value,
      appliesTo: c.applies_to,
      includesAddOns: c.includes_add_ons,
      audience: c.audience,
      startsOn: c.starts_on,
      endsOn: c.ends_on,
      firstTimeOnly: c.first_time_only,
      totalCap: c.total_cap,
      perCustomerCap: c.per_customer_cap,
      minSpendSatang: c.min_spend_satang,
      stackableWithBirthday: c.stackable_with_birthday,
      partnerId: c.partner_id,
      active: c.active,
      usesCounted: Number(c.uses_counted),
      customerUsesCounted: Number(c.customer_uses_counted),
      customerHasPaidBooking: c.customer_has_paid_booking,
    };
  },
  async clubTerms(tx) {
    const r = one(await tx.query<{ cancel_window_hours: number | null; birthday_discount: { kind: 'percent' | 'fixed'; value: number } | null }>(
      'select cancel_window_hours, birthday_discount from public.public_booking_config',
    ));
    return { birthdayDiscount: r?.birthday_discount ?? null, cancelWindowHours: r?.cancel_window_hours ?? null };
  },
};

/** The quote's sources today: the club's own reads, and the ports of F06, F07 and F14 until they exist. */
export const quoteSources: QuoteSources = { ...pendingFeatureSources, ...clubQuoteReads };
