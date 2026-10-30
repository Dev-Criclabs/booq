import type { Fragment } from './types';

// F07 tables (solo classes and coaches). Each F07 migration task adds its tables here.
export const tables: Fragment = {
  'public.coach': { class: 'D', audited: true },                       // F07-T01 (0801): profile and state; pii columns in the audit log
  'public.coach_availability_rule': { class: 'D', audited: true },     // F07-T01 (0801)
  'public.coach_leave': { class: 'D', audited: true },                 // F07-T01 (0801): type and note are personal data
  'public.coach_price_override': { class: 'D', audited: true },        // F07-T01 (0801): one nullable price per price group
  'public.coach_pay': { class: 'D', audited: true },                    // F07-T02 (0802): owner only
  'public.booking_coach_add': { class: 'D', audited: true },            // F07-T06 (0806): the add order's hold on a coach
};
