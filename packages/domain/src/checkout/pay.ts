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
// The lock order of FA 3.4 starts inside reserve_court (customer, then coach); the wallet, package and
// promo row locks of F04-T12c come after it in this transaction.

export interface PlacedOrder {
  orderId: string;
  bookingIds: string[];
  holdExpiresAt: string | null;
  /** A second tap found the caller's live hold for the same selection (D47): nothing new was made. */
  reused: boolean;
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
  const starts = [...new Set(quote.lines.map((l) => l.startsAt))].sort();
  const claim = (await tx.query<{ r: { order_id: string; booking_ids: string[]; hold_expires_at: string | null; reused?: boolean } }>(
    'select app.reserve_court($1, $2, $3::timestamptz[], $4) as r',
    [orderId, choice.courtId, starts, choice.coachId],
  )).rows[0]!.r;
  if (claim.reused === true) {
    // The caller's live hold for this selection: drop the order just made and return that one (D47).
    await tx.query('rollback to savepoint place_order');
    return { orderId: claim.order_id, bookingIds: claim.booking_ids, holdExpiresAt: claim.hold_expires_at, reused: true };
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
  return { orderId, bookingIds: claim.booking_ids, holdExpiresAt: claim.hold_expires_at, reused: false };
}
