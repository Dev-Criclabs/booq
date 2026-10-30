import type { Fragment } from './types';

// F03 tables (class D: club data, BOOQ staff never). Each F03 migration task adds its tables here.
export const tables: Fragment = {
  'public.orders': { class: 'D', audited: true },   // F03-T01 (0201); audit registered in 0203
  'public.booking': { class: 'D', audited: true },  // F03-T01 (0202); audit registered in 0203
  'public.occupancy': { class: 'D' },               // F03-T02 (0203); audited through its booking
  'app.release_handlers': { class: 'infra' },        // F03-T06 (0210)
  'app.coach_rules_hook': { class: 'infra' },        // F03-T09 (0213)
  'public.idempotency_key': { class: 'D' },          // F03-T11 (0215)
  'app.move_handlers': { class: 'infra' },           // F03-T15 (0219)
  'app.coach_rules_move_hook': { class: 'infra' },   // F03-T31 (0227)
};
