import type { Fragment } from './types';

// F05 tables (class D: club data, BOOQ staff never). Each F05 migration task adds its tables here.
export const tables: Fragment = {
  'public.payment': { class: 'D', audited: true },        // F05-T01 (0401)
  'public.payment_event': { class: 'D' },                 // F05-T01 (0402): append-only, no personal data
  'public.owner_flag': { class: 'D', audited: true },     // F05-T01 (0402)
  'app.payment_ports': { class: 'infra' },                // F05-T05a (0404): F06 and F13 register their ports here
};
