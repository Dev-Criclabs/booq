import { createHash } from 'node:crypto';
import type { Tx } from '../../../db/src/tx';
import { CheckoutError } from './errors';
import { priceOrder, type QuoteLine } from './pricing';
import { entitlement, type PlacedOrder } from './pay';
import { buyerOf, codeFor, openClub, priceGroupsOf, usedBirthdayKinds, type QuoteSources } from './quote';

// F04-T15: add a coach to a booking already paid (R2-AC9, D111; C12 "Add a coach"; F07 design 5.5). Only the coaching
// portion is priced, as its own order with its own lines and receipt; the court line of the first order is untouched.
// Pay writes the priced order, then F07's app.add_coach_to_booking claims the coach on the booking's occupancy row
// (the coach lock first, then the order, then the booking, FA 3.4; a busy coach is coach_unavailable or rest_rule and
// nothing is created), then the code and the birthday entitlement, the coach line on that booking (0418) and the
// reserve. The add is held by booking_coach_add.hold_expires_at; the QR lives inside it (0418). A coach add with
// nothing to pay is confirmed by add_coach_to_booking and completed here. No solo credit pays it: a solo credit is used
// only through Classes (COACH-03), and this is not that source.

export interface CoachAddRequest {
  bookingId: string;
  coachId: string;
  code: string | null;
}

export interface CoachAddQuote {
  bookingId: string;
  coachId: string;
  priceGroupId: string;
  promoCodeId: string | null;
  referralCodeId: string | null;
  birthdayEntitlement: 'solo_class' | 'package' | null;
  codeNotApplied: boolean;
  lines: QuoteLine[];
  subtotalSatang: number;
  discountSatang: number;
  totalSatang: number;
  creditValueSatang: number;
  walletSatang: number;
  moneySatang: number;
  quoteHash: string;
}

/** The locale key that labels the coach line (the same as on C10: P-0143 "Coaching · 60 min"). */
const COACH_LINE_TEXT_KEY = 'P-0143';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const HASH = /^[0-9a-f]{64}$/;

const uuid = (v: unknown): string => {
  if (typeof v !== 'string' || !UUID.test(v)) throw new CheckoutError('bad_input');
  return v.toLowerCase();
};

export function parseCoachAddRequest(body: unknown): CoachAddRequest {
  const b = (body ?? {}) as Record<string, unknown>;
  const code = b['code'] ?? null;
  if (code !== null && typeof code !== 'string') throw new CheckoutError('bad_input');
  const trimmed = code === null ? '' : code.trim().toUpperCase();
  return { bookingId: uuid(b['bookingId']), coachId: uuid(b['coachId']), code: trimmed === '' ? null : trimmed };
}

export function parseCoachAddPay(body: unknown): { choice: CoachAddRequest; quoteHash: string } {
  const hash = ((body ?? {}) as Record<string, unknown>)['quoteHash'];
  if (typeof hash !== 'string' || !HASH.test(hash.toLowerCase())) throw new CheckoutError('bad_input');
  return { choice: parseCoachAddRequest(body), quoteHash: hash.toLowerCase() };
}

/** Price the coaching portion for the caller's own booking. Throws CheckoutError. */
export async function coachAddQuoteFor(tx: Tx, customerId: string, req: CoachAddRequest, sources: QuoteSources): Promise<CoachAddQuote> {
  const club = await openClub(tx);
  const b = (await tx.query<{ start_at: Date; resource_id: string; status: string; type: string; coach_id: string | null; started: boolean }>(
    `select start_at, resource_id, status, type, coach_id, start_at <= app.now() as started
       from public.booking where club_id = app.club_id() and id = $1 and customer_id = $2`,
    [req.bookingId, customerId],
  )).rows[0];
  if (!b) throw new CheckoutError('booking_not_found');
  if (b.started || b.status !== 'confirmed' || b.type !== 'court' || b.coach_id !== null) throw new CheckoutError('coach_add_not_possible');
  const coach = await sources.coach(tx, req.coachId);
  if (!coach) throw new CheckoutError('coach_price_not_set');
  const person = await buyerOf(tx, customerId, false);
  const tierPrices = await tx.query<{ tier_id: string; price_group_id: string; price_satang: number | null }>(
    `select tier_id, price_group_id, price_satang from public.coach_tier_price where club_id = app.club_id()`,
  );
  const terms = await sources.clubTerms(tx);
  const result = priceOrder({
    onDate: club.today,
    dob: person.dob,
    priceGroups: await priceGroupsOf(tx),
    courtPriceRules: [],
    coachTierPrices: tierPrices.rows.map((p) => ({ tierId: p.tier_id, priceGroupId: p.price_group_id, priceSatang: p.price_satang })),
    addOns: [],
    selection: {
      courtId: b.resource_id,
      hours: [new Date(b.start_at).toISOString()],
      coach: { coachId: req.coachId, tierId: coach.tierId, source: 'checkout', priceSatang: coach.priceSatang },
      addOnIds: [],
      coachOnly: true,
    },
    credits: [],
    walletBalanceSatang: await sources.walletBalance(tx, customerId),
    code: await codeFor(tx, req.code, customerId, sources),
    birthday: { setting: terms.birthdayDiscount, usedKinds: await usedBirthdayKinds(tx, customerId, Number(club.today.slice(0, 4))) },
  });
  if (!result.ok) {
    if (result.code === 'code_below_minimum') throw new CheckoutError(result.code, { amount: result.minSpendSatang });
    throw new CheckoutError(result.code);
  }
  // The booking and the coach are part of what was priced: a quote for another booking or coach is another hash.
  const { quoteHash, ...q } = result.quote;
  return { ...q, bookingId: req.bookingId, coachId: req.coachId, quoteHash: createHash('sha256').update(`${quoteHash}:${req.bookingId}:${req.coachId}`).digest('hex') };
}

/** The caller's add on this booking whose hold still runs (a second tap, D47). */
export async function findLiveCoachAdd(tx: Tx, bookingId: string): Promise<PlacedOrder | null> {
  const r = (await tx.query<{ order_id: string; hold_expires_at: Date }>('select order_id, hold_expires_at from app.live_coach_add($1)', [bookingId])).rows[0];
  return r ? { orderId: r.order_id, bookingIds: [], holdExpiresAt: new Date(r.hold_expires_at).toISOString(), reused: true, confirmed: false, receiptId: null } : null;
}

/** Write the priced order, claim the coach, take the entitlements, write the coach line and reserve. */
export async function placeCoachAddOrder(tx: Tx, customerId: string, quote: CoachAddQuote, sources: QuoteSources): Promise<PlacedOrder> {
  const line = quote.lines[0]!;
  const group = (await tx.query<{ id: string; name_th: string; name_en: string }>(
    `select id, name_th, name_en from public.price_group where club_id = app.club_id() and id = $1`,
    [quote.priceGroupId],
  )).rows[0];
  const orderId = (await tx.query<{ id: string }>('select app.create_priced_order($1, $2::jsonb) as id', [
    customerId,
    JSON.stringify({
      price_group_snapshot: group ?? null,
      subtotal_satang: quote.subtotalSatang,
      discount_satang: quote.discountSatang,
      total_satang: quote.totalSatang,
      credit_value_satang: quote.creditValueSatang,
      wallet_satang: quote.walletSatang,
      money_satang: quote.moneySatang,
      promo_code_id: quote.promoCodeId,
      birthday_entitlement: quote.birthdayEntitlement !== null,
      quote_hash: quote.quoteHash,
    }),
  ])).rows[0]!.id;
  // The coach first (inside add_coach_to_booking, after the customer lock of create_priced_order), then the wallet and
  // packages, the promo row and the birthday entitlement.
  await tx.query('select app.add_coach_to_booking($1, $2, $3)', [quote.bookingId, quote.coachId, orderId]);
  await tx.query('select app.lock_wallet_and_packages($1)', [customerId]);
  if (quote.promoCodeId !== null) await entitlement(tx, 'select app.count_promo_use($1, $2)', [quote.promoCodeId, orderId]);
  if (quote.birthdayEntitlement !== null) await entitlement(tx, 'select app.use_birthday_entitlement($1, $2)', [quote.birthdayEntitlement, orderId]);
  // The coach's name for the line, as on C10 until F07's names reach the read: the tier's name.
  const coach = await sources.coach(tx, quote.coachId);
  const names = coach
    ? (await tx.query<{ name_th: string; name_en: string }>(`select name_th, name_en from public.coach_tier where club_id = app.club_id() and id = $1`, [coach.tierId])).rows[0]
    : undefined;
  if (!names) throw new CheckoutError('coach_price_not_set');
  await tx.query('select app.add_order_lines($1, $2::jsonb)', [
    orderId,
    JSON.stringify([{
      position: 1,
      kind: 'coach',
      booking_id: quote.bookingId,
      add_on_id: null,
      package_product_id: null,
      description_key: COACH_LINE_TEXT_KEY,
      name_th: names.name_th,
      name_en: names.name_en,
      unit_price_satang: line.unitPriceSatang,
      discount_satang: line.discountSatang,
      net_satang: line.netSatang,
      credit_package_id: null,
      credit_units: 0,
      credit_value_satang: 0,
      wallet_satang: line.walletSatang,
      money_satang: line.moneySatang,
      scope: { birthday_discount_satang: line.birthdayDiscountSatang, code_discount_satang: line.codeDiscountSatang },
    }]),
  ]);
  if (!(await sources.reserveCreditAndWallet(tx, orderId))) throw new CheckoutError('credit_unavailable');
  if (quote.moneySatang === 0) {
    const done = await tx.query<{ receipt: string }>('select app.complete_zero_money_order($1) as receipt', [orderId]);
    return { orderId, bookingIds: [], holdExpiresAt: null, reused: false, confirmed: true, receiptId: done.rows[0]!.receipt };
  }
  const hold = (await tx.query<{ order_id: string; hold_expires_at: Date }>('select order_id, hold_expires_at from app.live_coach_add($1)', [quote.bookingId])).rows[0];
  return { orderId, bookingIds: [], holdExpiresAt: hold ? new Date(hold.hold_expires_at).toISOString() : null, reused: false, confirmed: false, receiptId: null };
}
