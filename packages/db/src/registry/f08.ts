import type { Fragment } from './types';

// F08 tables (group classes and waitlist: class D, club data, BOOQ staff never). Each F08 migration task adds its tables here.
export const tables: Fragment = {
  'public.class_template': { class: 'D', audited: true },   // F08-T01 (0901): the owner's weekly class
};
