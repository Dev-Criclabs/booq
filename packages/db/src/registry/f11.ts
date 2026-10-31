import type { Fragment } from './types';

// F11 tables (club admin console). Each F11 migration task adds its tables here.
export const tables: Fragment = {
  'public.customer_tag': { class: 'D', audited: true },   // F11-T04 (1102): a tag a club typed on a customer
  'public.owner_setup_done': { class: 'S', audited: true },   // F11-T09 (1105): the owner said the A0 steps are done; platform staff may read that it was said
};
