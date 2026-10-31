import { createHash } from 'node:crypto';
import type { Tx } from '../../../db/src/tx';
import { checkCode, planDiscounts, type CodeInput, type CodeRefusal } from './discounts';
import { CheckoutError } from './errors';
import { entitlement, type PlacedOrder } from './pay';
import { groupFor } from './pricing';
import { buyerOf, codeFor, openClub, priceGroupsOf, type QuoteSources } from './quote';

// F04-T22b: a group class seat at Pay (CLASS-01-AC14, AC17; F04 R4; D22, D157; F08 design 4.4, §12 C-2). One
// `class_seat` line priced from the session's drop in price (the snapshot on class_session), the one code (scope
// `group_class`), then in the order of D22: a group credit of the class's audience covers the whole net, else the
// wallet, else money. A null drop in price means the seat is not sold for an amount (D157): only a group credit can
// pay it, and its credit value is 0 (no value is invented). The seat itself is taken by F08's app.take_seat, which
// checks the club, the session, the audience, the capacity under the session lock and the Pay tap limit. Birthday
// discounts do not apply to a group class (R5 names one package and one solo class).

export interface SeatQuoteRequest {
  sessionId: string;
  code: string | null;
}

export interface SeatCredit {
  packageId: string;
}

export interface SeatPricingInput {
  onDate: string;
  dob: string | null;
  /** The session's drop in price; null: none (D157). */
  dropInSatang: number | null;
  /** Group credits of the class's audience, in the order to use them. */
  credits: SeatCredit[];
  walletBalanceSatang: number;
  code?: CodeInput | 'not_found' | null;
}

export interface SeatQuoteLine {
  position: 1;
  kind: 'class_seat';
  unitPriceSatang: number;
  discountSatang: number;
  codeDiscountSatang: number;
  netSatang: number;
  creditPackageId: string | null;
  creditUnits: 0 | 1;
  creditValueSatang: number;
  walletSatang: number;
  moneySatang: number;
}

export interface SeatQuote {
  sessionId: string;
  /** The buyer's price group, snapshotted on the order (null when the club's groups do not place them). */
  priceGroupId: string | null;
  promoCodeId: string | null;
  referralCodeId: string | null;
  codeNotApplied: boolean;
  lines: SeatQuoteLine[];
  subtotalSatang: number;
  discountSatang: number;
  totalSatang: number;
  creditValueSatang: number;
  walletSatang: number;
  moneySatang: number;
  quoteHash: string;
}

export type SeatPricingResult = { ok: true; quote: Omit<SeatQuote, 'sessionId' | 'priceGroupId' | 'quoteHash'> } | { ok: false; code: 'price_not_set' } | CodeRefusal;

/** The price of one seat (pure, integer satang). */
export function priceSeat(input: SeatPricingInput): SeatPricingResult {
  const credit = input.credits[0] ?? null;
  if (input.dropInSatang === null && credit === null) return { ok: false, code: 'price_not_set' };
  const unit = input.dropInSatang ?? 0;
  const lines = [{ kind: 'class_seat' as const, hourIndex: 0, unitPriceSatang: unit }];
  const ctx = { onDate: input.onDate, dob: input.dob };
  let code: { input: CodeInput; inScope: boolean[] } | null = null;
  // A seat with no drop in price has nothing a code could take off: the code is out of scope.
  if (input.code !== undefined && input.code !== null) {
    const checked = checkCode(input.code, lines, ctx);
    if (!checked.ok) return checked;
    code = { input: input.code as CodeInput, inScope: checked.inScope };
  }
  const plan = planDiscounts(lines, code, undefined, ctx);
  const codeDiscount = plan.code[0]!;
  const net = unit - codeDiscount;
  const creditValue = credit !== null ? net : 0;
  const wallet = credit !== null ? 0 : Math.min(Math.max(0, Math.floor(input.walletBalanceSatang)), net);
  const line: SeatQuoteLine = {
    position: 1,
    kind: 'class_seat',
    unitPriceSatang: unit,
    discountSatang: codeDiscount,
    codeDiscountSatang: codeDiscount,
    netSatang: net,
    creditPackageId: credit?.packageId ?? null,
    creditUnits: credit !== null ? 1 : 0,
    creditValueSatang: creditValue,
    walletSatang: wallet,
    moneySatang: net - creditValue - wallet,
  };
  const applied = code !== null && plan.codeApplied ? code.input : null;
  return {
    ok: true,
    quote: {
      promoCodeId: applied?.source === 'promo' ? applied.id : null,
      referralCodeId: applied?.source === 'referral' ? applied.id : null,
      codeNotApplied: input.code !== undefined && input.code !== null && applied === null,
      lines: [line],
      subtotalSatang: unit,
      discountSatang: codeDiscount,
      totalSatang: net,
      creditValueSatang: creditValue,
      walletSatang: wallet,
      moneySatang: line.moneySatang,
    },
  };
}

function canonical(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonical).join(',')}]`;
  if (v !== null && typeof v === 'object') {
    const o = v as Record<string, unknown>;
    return `{${Object.keys(o).sort().map((k) => `${JSON.stringify(k)}:${canonical(o[k])}`).join(',')}}`;
  }
  return JSON.stringify(v ?? null);
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A seat request names the session (and optionally the code); null when the body is not a seat. */
export function parseSeatRequest(body: unknown): SeatQuoteRequest | null {
  const b = (body ?? {}) as Record<string, unknown>;
  if (b['sessionId'] === undefined) return null;
  const id = b['sessionId'];
  if (typeof id !== 'string' || !UUID.test(id)) throw new CheckoutError('bad_input');
  const code = b['code'] ?? null;
  if (code !== null && typeof code !== 'string') throw new CheckoutError('bad_input');
  const trimmed = code === null ? '' : code.trim().toUpperCase();
  return { sessionId: id.toLowerCase(), code: trimmed === '' ? null : trimmed };
}

/** The group credits of this class's audience: a price group whose rule ends below 18 is the Student one (as
 *  app.class_visible decides), any other the Adult one. */
async function groupCredits(tx: Tx, customerId: string, audience: string): Promise<SeatCredit[]> {
  const groups = (await tx.query<{ id: string }>(
    `select id from public.price_group
      where club_id = app.club_id()
        and (case when rule ? 'max_age' and (rule ->> 'max_age')::int < 18 then 'student' else 'adult' end) = $1
      order by position, id`,
    [audience],
  )).rows;
  const out: Array<SeatCredit & { expiresAt: string }> = [];
  for (const g of groups) {
    const rows = (await tx.query<{ package_id: string; expires_at: Date }>(
      'select package_id, expires_at from app.eligible_credits($1, $2::jsonb)',
      [customerId, JSON.stringify({ credit_type: 'group_session', price_group_id: g.id })],
    )).rows;
    for (const r of rows) if (!out.some((c) => c.packageId === r.package_id)) out.push({ packageId: r.package_id, expiresAt: new Date(r.expires_at).toISOString() });
  }
  // The credit that ends first is used first (F06 order).
  return out.sort((a, b) => a.expiresAt.localeCompare(b.expiresAt) || a.packageId.localeCompare(b.packageId)).map(({ packageId }) => ({ packageId }));
}

interface SessionRow {
  visible: boolean;
  audience: string;
  drop_in_price_satang: number | null;
  name_th: string;
  name_en: string;
}

/** Price a seat in `sessionId` for `customerId`. Throws CheckoutError. */
export async function seatQuoteFor(tx: Tx, customerId: string, req: SeatQuoteRequest, sources: QuoteSources): Promise<SeatQuote & { names: { th: string; en: string } }> {
  const club = await openClub(tx);
  const person = await buyerOf(tx, customerId, false);
  // The player's read of a session (0916): scheduled, not started, in a club that takes bookings.
  const s = (await tx.query<SessionRow>(
    `select app.class_visible(c.session_id, $2) as visible, c.audience, c.drop_in_price_satang, c.name_th, c.name_en
       from public.public_class_state c where c.session_id = $1`,
    [req.sessionId, customerId],
  )).rows[0];
  if (!s || !s.visible) throw new CheckoutError('session_not_available');
  const result = priceSeat({
    onDate: club.today,
    dob: person.dob,
    dropInSatang: s.drop_in_price_satang,
    credits: await groupCredits(tx, customerId, s.audience),
    walletBalanceSatang: await sources.walletBalance(tx, customerId),
    code: await codeFor(tx, req.code, customerId, sources),
  });
  if (!result.ok) {
    if (result.code === 'code_below_minimum') throw new CheckoutError(result.code, { amount: result.minSpendSatang });
    throw new CheckoutError(result.code);
  }
  const body = { ...result.quote, sessionId: req.sessionId, priceGroupId: groupFor(await priceGroupsOf(tx), person.dob, club.today)?.id ?? null };
  return { ...body, quoteHash: createHash('sha256').update(canonical(body)).digest('hex'), names: { th: s.name_th, en: s.name_en } };
}

/** The caller's live held seat in this session (a second tap, D47), as take_seat finds it. */
export async function findLiveSeat(tx: Tx, sessionId: string, customerId: string): Promise<PlacedOrder | null> {
  const r = (await tx.query<{ order_id: string; id: string; hold_expires_at: Date }>(
    `select order_id, id, hold_expires_at from public.booking
      where club_id = app.club_id() and class_session_id = $1 and customer_id = $2 and created_by = app.user_id()
        and status = 'awaiting_payment' and hold_expires_at > app.now() limit 1`,
    [sessionId, customerId],
  )).rows[0];
  return r ? { orderId: r.order_id, bookingIds: [r.id], holdExpiresAt: new Date(r.hold_expires_at).toISOString(), reused: true, confirmed: false, receiptId: null } : null;
}

/** The locale key that labels a seat line (copy-index: P-0213 "Group class"). */
export const SEAT_LINE_TEXT_KEY = 'P-0213';

/** Write the priced order, take the code, take the seat, write its line and reserve; confirmed when nothing is due. */
export async function placeSeatOrder(tx: Tx, customerId: string, quote: SeatQuote & { names: { th: string; en: string } }, sources: QuoteSources): Promise<PlacedOrder> {
  const line = quote.lines[0]!;
  const group = quote.priceGroupId === null ? undefined
    : (await tx.query<{ id: string; name_th: string; name_en: string }>(`select id, name_th, name_en from public.price_group where club_id = app.club_id() and id = $1`, [quote.priceGroupId])).rows[0];
  await tx.query('savepoint place_seat');
  const orderId = (await tx.query<{ id: string }>('select app.create_priced_order($1, $2::jsonb) as id', [
    customerId,
    JSON.stringify({
      price_group_snapshot: group ?? {},
      subtotal_satang: quote.subtotalSatang,
      discount_satang: quote.discountSatang,
      total_satang: quote.totalSatang,
      credit_value_satang: quote.creditValueSatang,
      wallet_satang: quote.walletSatang,
      money_satang: quote.moneySatang,
      promo_code_id: quote.promoCodeId,
      birthday_entitlement: false,
      quote_hash: quote.quoteHash,
    }),
  ])).rows[0]!.id;
  // Lock order (FA 3.4): the customer (in create_priced_order), the wallet and packages, the promo row, then the seat
  // (take_seat locks the session row).
  await tx.query('select app.lock_wallet_and_packages($1)', [customerId]);
  if (quote.promoCodeId !== null) await entitlement(tx, 'select app.count_promo_use($1, $2)', [quote.promoCodeId, orderId]);
  const seat = (await tx.query<{ r: { order_id: string; booking_ids: string[]; hold_expires_at: string | null; reused?: boolean } }>(
    'select app.take_seat($1, $2) as r',
    [orderId, quote.sessionId],
  )).rows[0]!.r;
  if (seat.reused === true) {
    await tx.query('rollback to savepoint place_seat');
    return { orderId: seat.order_id, bookingIds: seat.booking_ids, holdExpiresAt: seat.hold_expires_at === null ? null : new Date(seat.hold_expires_at).toISOString(), reused: true, confirmed: false, receiptId: null };
  }
  await tx.query('release savepoint place_seat');
  const bookingId = seat.booking_ids[0]!;
  await tx.query('select app.add_order_lines($1, $2::jsonb)', [
    orderId,
    JSON.stringify([{
      position: 1,
      kind: 'class_seat',
      booking_id: bookingId,
      add_on_id: null,
      package_product_id: null,
      description_key: SEAT_LINE_TEXT_KEY,
      name_th: quote.names.th,
      name_en: quote.names.en,
      unit_price_satang: line.unitPriceSatang,
      discount_satang: line.discountSatang,
      net_satang: line.netSatang,
      credit_package_id: line.creditPackageId,
      credit_units: line.creditUnits,
      credit_value_satang: line.creditValueSatang,
      wallet_satang: line.walletSatang,
      money_satang: line.moneySatang,
      scope: { code_discount_satang: line.codeDiscountSatang },
    }]),
  ]);
  if (!(await sources.reserveCreditAndWallet(tx, orderId))) throw new CheckoutError('credit_unavailable');
  if (quote.moneySatang === 0) {
    const done = await tx.query<{ receipt: string }>('select app.complete_zero_money_order($1) as receipt', [orderId]);
    return { orderId, bookingIds: [bookingId], holdExpiresAt: null, reused: false, confirmed: true, receiptId: done.rows[0]!.receipt };
  }
  return { orderId, bookingIds: [bookingId], holdExpiresAt: seat.hold_expires_at === null ? null : new Date(seat.hold_expires_at).toISOString(), reused: false, confirmed: false, receiptId: null };
}
