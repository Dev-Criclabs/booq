import type { Tx } from '../../../db/src/tx';
import { CheckoutError } from './errors';

// F04-T13: GET /orders/{id} (R7-AC2, ROLE-01-AC4, CC-2; design 5.1). The stored snapshot as it was frozen at
// Pay: the amounts and each line with the names copied in, so a later price or name change never shows here.
// The row policies narrow the read: a player sees their own order, owner, front desk and accountant the club's
// (no contact detail is in an order, D35). Anything else, another club's included, is not found.

export interface OrderLineView {
  position: number;
  kind: string;
  descriptionKey: string;
  nameTh: string;
  nameEn: string;
  bookingId: string | null;
  unitPriceSatang: number;
  discountSatang: number;
  netSatang: number;
  creditValueSatang: number;
  walletSatang: number;
  moneySatang: number;
}

export interface OrderView {
  id: string;
  status: string;
  priceGroup: { id: string; name_th: string; name_en: string } | null;
  subtotalSatang: number | null;
  discountSatang: number | null;
  totalSatang: number | null;
  creditValueSatang: number | null;
  walletSatang: number | null;
  moneySatang: number | null;
  promoCodeId: string | null;
  birthdayEntitlement: boolean | null;
  pricedAt: string | null;
  lines: OrderLineView[];
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function readOrder(tx: Tx, id: unknown): Promise<OrderView> {
  if (typeof id !== 'string' || !UUID.test(id)) throw new CheckoutError('order_not_found');
  const o = (await tx.query<{
    id: string; status: string; price_group_snapshot: OrderView['priceGroup']; subtotal_satang: number | null; discount_satang: number | null;
    total_satang: number | null; credit_value_satang: number | null; wallet_satang: number | null; money_satang: number | null;
    promo_code_id: string | null; birthday_entitlement: boolean | null; priced_at: Date | null;
  }>(
    `select id, status, price_group_snapshot, subtotal_satang, discount_satang, total_satang, credit_value_satang, wallet_satang,
            money_satang, promo_code_id, birthday_entitlement, priced_at
       from public.orders where club_id = app.club_id() and id = $1`,
    [id],
  )).rows[0];
  if (!o) throw new CheckoutError('order_not_found');
  const lines = await tx.query<{
    position: number; kind: string; description_key: string; name_th: string; name_en: string; booking_id: string | null;
    unit_price_satang: number; discount_satang: number; net_satang: number; credit_value_satang: number; wallet_satang: number; money_satang: number;
  }>(
    `select position, kind, description_key, name_th, name_en, booking_id, unit_price_satang, discount_satang, net_satang,
            credit_value_satang, wallet_satang, money_satang
       from public.order_line where club_id = app.club_id() and order_id = $1 order by position`,
    [id],
  );
  return {
    id: o.id,
    status: o.status,
    priceGroup: o.price_group_snapshot,
    subtotalSatang: o.subtotal_satang,
    discountSatang: o.discount_satang,
    totalSatang: o.total_satang,
    creditValueSatang: o.credit_value_satang,
    walletSatang: o.wallet_satang,
    moneySatang: o.money_satang,
    promoCodeId: o.promo_code_id,
    birthdayEntitlement: o.birthday_entitlement,
    pricedAt: o.priced_at === null ? null : new Date(o.priced_at).toISOString(),
    lines: lines.rows.map((l) => ({
      position: l.position,
      kind: l.kind,
      descriptionKey: l.description_key,
      nameTh: l.name_th,
      nameEn: l.name_en,
      bookingId: l.booking_id,
      unitPriceSatang: l.unit_price_satang,
      discountSatang: l.discount_satang,
      netSatang: l.net_satang,
      creditValueSatang: l.credit_value_satang,
      walletSatang: l.wallet_satang,
      moneySatang: l.money_satang,
    })),
  };
}
