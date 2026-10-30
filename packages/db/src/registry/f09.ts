import type { Fragment } from './types';

// F09 tables (class D: club data, BOOQ staff never). Each F09 migration task adds its tables here.
export const tables: Fragment = {
  'public.booking_cancel': { class: 'D', audited: true },   // F09-T01 (1001); append only
};
