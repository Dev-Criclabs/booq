import type { Fragment } from './types';

// F08 tables (group classes and waitlist: class D, club data, BOOQ staff never). Each F08 migration task adds its tables here.
export const tables: Fragment = {
  'public.class_template': { class: 'D', audited: true },   // F08-T01 (0901): the owner's weekly class
  'public.class_session': { class: 'D', audited: true },    // F08-T02 (0902): one dated class, with a snapshot of its template
  'public.waitlist_entry': { class: 'D', audited: true },   // F08-T04 (0904): one player waiting for a session or a court slot
  'public.waitlist_seq': { class: 'D' },                    // F08-T04 (0904): the last position number per club, written only by app.next_waitlist_seq
};
