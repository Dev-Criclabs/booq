import type { Fragment } from './types';

// F09 tables (class D: club data, BOOQ staff never). Each F09 migration task adds its tables here.
export const tables: Fragment = {
  'public.booking_cancel': { class: 'D', audited: true },   // F09-T01 (1001); append only
  'public.closure': { class: 'D', audited: true },          // F09-T02 (1002)
  'public.closure_resource': { class: 'D', audited: true }, // F09-T02 (1002)
  'app.cancel_handlers': { class: 'infra' },                // F09-T03 (1003)
};
