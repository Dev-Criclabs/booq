import type { Tx } from '../../../db/src/tx';
import { CheckoutError } from './errors';
import type { QuoteLine } from './pricing';
import { parseQuoteRequest, quoteFor, type QuoteRequest, type QuoteSources, type QuoteView } from './quote';

// F04-T12a: POST /checkout/pay, steps 1 and 2 (design 4.5; R4-AC9, R8-AC1, R7-AC1, D63). The gate (club
// status, the coach-at-checkout switch) runs in quoteFor; then the order is priced again from the prices of
// this moment. A hash different from the one the player saw creates nothing: the new quote goes back and the
// player confirms again. The limit on repeated Pay taps (D61, F03 4.8) is counted inside reserve_court at the
// claim (F04-T12b), where its refusal too_many_attempts is raised; it is not repeated here.

export interface PayRequest {
  choice: QuoteRequest;
  /** The quote_hash of the quote the player confirmed. */
  quoteHash: string;
}

export type PreparedPay = { kind: 'ready'; quote: QuoteView } | { kind: 'price_changed'; quote: QuoteView };

const HASH = /^[0-9a-f]{64}$/;

/** The Pay body: the same choices as the quote, and the hash of the quote shown. No amount is read (CC-2). */
export function parsePayRequest(body: unknown): PayRequest {
  const hash = ((body ?? {}) as Record<string, unknown>)['quoteHash'];
  if (typeof hash !== 'string' || !HASH.test(hash.toLowerCase())) throw new CheckoutError('bad_input');
  return { choice: parseQuoteRequest(body), quoteHash: hash.toLowerCase() };
}

/** Gate and reprice, inside the Pay transaction. Writes nothing. */
export async function preparePay(tx: Tx, customerId: string, req: PayRequest, sources: QuoteSources): Promise<PreparedPay> {
  const quote = await quoteFor(tx, customerId, req.choice, sources);
  return quote.quoteHash === req.quoteHash ? { kind: 'ready', quote } : { kind: 'price_changed', quote };
}

// F04-T12b: the order, the claim and the lines (design 4.5 step 3; R7-AC1, R3-AC6, BOOK-06; D40, D47, D111).
// The order is written with its frozen amounts before reserve_court, so a zero money order takes no hold
// (0304); the lines follow once the bookings exist (the sum check is deferred to commit). The writes go
// through the Architect's definer functions; the app role has no write on orders or order_line.
// F04-T12c adds, in this order: the code use (app.count_promo_use, under the promo row lock) and the birthday
// entitlement before the claim, so the promo lock is never taken while a claim waits on a slot; then, after the
// lines, F06's reserve_credit_and_wallet, which is keyed by line (F06 design 4.9). The customer's lock is taken
// inside reserve_court. Any refusal rolls the whole transaction back, so nothing is used up.

export interface PlacedOrder {
  orderId: string;
  bookingIds: string[];
  holdExpiresAt: string | null;
  /** A second tap found the caller's live hold for the same selection (D47): nothing new was made. */
  reused: boolean;
  /** Nothing was left to pay: confirmed in this transaction, no hold and no charge (PAY-07). */
  confirmed: boolean;
  /** The receipt of a zero money order (D64); null otherwise. */
  receiptId: string | null;
}

/** The locale key that labels each kind of line on C10, C12 and the receipt (copy-index: H-C10-Checkout). */
export const LINE_TEXT_KEYS = { court_hour: 'P-0076', coach: 'P-0143', add_on: 'P-0071' } as const;

interface Names {
  name_th: string;
  name_en: string;
}

async function lineNames(tx: Tx, choice: QuoteRequest, lines: QuoteLine[], sources: QuoteSources): Promise<Names[]> {
  const court = (await tx.query<{ name: string }>(`select name from public.resource where club_id = app.club_id() and id = $1`, [choice.courtId])).rows[0];
  const addOns = new Map(
    (await tx.query<Names & { id: string }>(`select id, name_th, name_en from public.add_on where club_id = app.club_id()`)).rows.map((a) => [a.id, a]),
  );
  // Until F07's coach names reach this read, a coach line carries its tier's name.
  let coach: Names | undefined;
  if (choice.coachId !== null) {
    const found = await sources.coach(tx, choice.coachId);
    coach = found
      ? (await tx.query<Names>(`select name_th, name_en from public.coach_tier where club_id = app.club_id() and id = $1`, [found.tierId])).rows[0]
      : undefined;
  }
  return lines.map((l) => {
    const n = l.kind === 'court_hour' ? (court ? { name_th: court.name, name_en: court.name } : undefined) : l.kind === 'coach' ? coach : addOns.get(l.addOnId!);
    if (!n) throw new CheckoutError('bad_input');
    return { name_th: n.name_th, name_en: n.name_en };
  });
}

/** Write the priced order, claim its hours, then write its lines. Refusals from the claim arrive as BK001. */
export async function placeOrder(tx: Tx, customerId: string, choice: QuoteRequest, quote: QuoteView, sources: QuoteSources): Promise<PlacedOrder> {
  const starts = [...new Set(quote.lines.map((l) => l.startsAt))].sort();
  // A second tap (D47) returns the caller's live hold before anything is counted, so the order's own code use
  // or birthday entitlement never refuses it. reserve_court repeats this lookup under the customer lock.
  const live = await liveHold(tx, choice.courtId, choice.coachId, starts);
  if (live) return live;
  const names = await lineNames(tx, choice, quote.lines, sources);
  const group = (await tx.query<Names & { id: string }>(`select id, name_th, name_en from public.price_group where club_id = app.club_id() and id = $1`, [quote.priceGroupId])).rows[0];
  await tx.query('savepoint place_order');
  const created = await tx.query<{ id: string }>('select app.create_priced_order($1, $2::jsonb) as id', [
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
  ]);
  const orderId = created.rows[0]!.id;
  if (quote.promoCodeId !== null) await entitlement(tx, 'select app.count_promo_use($1, $2)', [quote.promoCodeId, orderId]);
  if (quote.birthdayEntitlement !== null) await entitlement(tx, 'select app.use_birthday_entitlement($1, $2)', [quote.birthdayEntitlement, orderId]);
  const claim = (await tx.query<{ r: { order_id: string; booking_ids: string[]; hold_expires_at: string | null; reused?: boolean } }>(
    'select app.reserve_court($1, $2, $3::timestamptz[], $4) as r',
    [orderId, choice.courtId, starts, choice.coachId],
  )).rows[0]!.r;
  if (claim.reused === true) {
    // The caller's live hold for this selection: drop the order just made and return that one (D47).
    await tx.query('rollback to savepoint place_order');
    return { orderId: claim.order_id, bookingIds: claim.booking_ids, holdExpiresAt: isoOrNull(claim.hold_expires_at), reused: true, confirmed: false, receiptId: null };
  }
  await tx.query('release savepoint place_order');
  // booking_ids are in start order, the same order as the quote's hours.
  await tx.query('select app.add_order_lines($1, $2::jsonb)', [
    orderId,
    JSON.stringify(
      quote.lines.map((l, i) => ({
        position: l.position,
        kind: l.kind,
        booking_id: claim.booking_ids[l.hourIndex],
        add_on_id: l.addOnId,
        package_product_id: null,
        description_key: LINE_TEXT_KEYS[l.kind],
        name_th: names[i]!.name_th,
        name_en: names[i]!.name_en,
        unit_price_satang: l.unitPriceSatang,
        discount_satang: l.discountSatang,
        net_satang: l.netSatang,
        credit_package_id: l.creditPackageId,
        credit_units: l.creditUnits,
        credit_value_satang: l.creditValueSatang,
        wallet_satang: l.walletSatang,
        money_satang: l.moneySatang,
        scope: { birthday_discount_satang: l.birthdayDiscountSatang, code_discount_satang: l.codeDiscountSatang },
      })),
    ),
  ]);
  if (!(await sources.reserveCreditAndWallet(tx, orderId))) throw new CheckoutError('credit_unavailable');
  if (quote.moneySatang === 0) {
    // F04-T12d (PAY-07, D64): reserve_court confirmed the bookings in the claim; the order is paid, its receipt
    // issued in the same series and the Booking confirmed card enqueued, all in this transaction.
    const done = await tx.query<{ receipt: string }>('select app.complete_zero_money_order($1) as receipt', [orderId]);
    return { orderId, bookingIds: claim.booking_ids, holdExpiresAt: null, reused: false, confirmed: true, receiptId: done.rows[0]!.receipt };
  }
  return { orderId, bookingIds: claim.booking_ids, holdExpiresAt: isoOrNull(claim.hold_expires_at), reused: false, confirmed: false, receiptId: null };
}

const isoOrNull = (v: string | Date | null): string | null => (v === null ? null : new Date(v).toISOString());

/** The caller's live hold for exactly this selection, if any (D47). The Pay route asks it before repricing. */
export async function findLiveHold(tx: Tx, choice: QuoteRequest): Promise<PlacedOrder | null> {
  const starts = choice.hours.map((h) => new Date(h)).filter((d) => !Number.isNaN(d.getTime())).map((d) => d.toISOString()).sort();
  return liveHold(tx, choice.courtId, choice.coachId, [...new Set(starts)]);
}

async function liveHold(tx: Tx, courtId: string, coachId: string | null, starts: string[]): Promise<PlacedOrder | null> {
  const r = (await tx.query<{ order_id: string; booking_ids: string[]; hold_expires_at: string }>(
    `select b.order_id, array_agg(b.id order by b.start_at) as booking_ids, min(b.hold_expires_at) as hold_expires_at
       from public.booking b
      where b.club_id = app.club_id() and b.customer_id = app.user_id() and b.created_by = app.user_id()
        and b.status = 'awaiting_payment' and b.hold_expires_at > app.now()
        and b.resource_id = $1 and b.coach_id is not distinct from $2::uuid
      group by b.order_id
     having array_agg(b.start_at order by b.start_at) = $3::timestamptz[]
      limit 1`,
    [courtId, coachId, starts],
  )).rows[0];
  return r ? { orderId: r.order_id, bookingIds: r.booking_ids, holdExpiresAt: new Date(r.hold_expires_at).toISOString(), reused: true, confirmed: false, receiptId: null } : null;
}

// The refusals of count_promo_use ('promo:<code>') and use_birthday_entitlement ('birthday:<code>'), P0001.
const PROMO_CODES = new Set(['code_not_valid', 'code_expired', 'code_used_up', 'code_first_booking_only', 'one_code_per_order']);

async function entitlement(tx: Tx, sql: string, args: unknown[]): Promise<void> {
  try {
    await tx.query(sql, args);
  } catch (e) {
    const m = /^(promo|birthday):(\w+)$/.exec((e as { message?: string }).message ?? '');
    if (m?.[1] === 'promo' && PROMO_CODES.has(m[2]!)) throw new CheckoutError(m[2] as 'code_not_valid');
    if (m?.[1] === 'birthday' && (m[2] === 'not_entitled' || m[2] === 'already_used')) throw new CheckoutError('birthday_not_available');
    throw e;
  }
}
