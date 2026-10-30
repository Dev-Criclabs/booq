import type { Fragment } from './types';

// F04 tables. Each F04 migration task adds its tables here.
export const tables: Fragment = {
  // Price tables (F04-T01, migration 0301): class S, setup data
  'public.price_group': { class: 'S', audited: true },
  'public.court_price_rule': { class: 'S', audited: true },
  'public.coach_tier': { class: 'S', audited: true },
  'public.coach_tier_price': { class: 'S', audited: true },
  'public.add_on': { class: 'S', audited: true },
  // Promotions and the frozen order (F04-T02 and T03, migrations 0302 and 0303): class D, club data
  'public.partner': { class: 'D', audited: true },
  'public.promo_code': { class: 'D', audited: true },
  'public.promo_redemption': { class: 'D', audited: true },
  'public.birthday_entitlement_use': { class: 'D', audited: true },
  'public.order_line': { class: 'D', audited: true },
};
