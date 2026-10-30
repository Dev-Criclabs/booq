import type { Fragment } from './types';

// F03 tables (class D: club data, BOOQ staff never). Each F03 migration task adds its tables here.
export const tables: Fragment = {
  'public.orders': { class: 'D' },   // F03-T01 (0201)
  'public.booking': { class: 'D' },  // F03-T01 (0202)
};
