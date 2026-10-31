import type { Fragment } from './types';

// F12 tables (class D: club data, BOOQ staff never). Each F12 migration task adds its tables here.
export const tables: Fragment = {
  'public.coach_attendance': { class: 'D', audited: true },   // F12-T01 (1201): the coach's Present or Absent hint, one row per booking
  'public.coach_note': { class: 'D', audited: true },         // F12-T01 (1201): the coach's private note; the text is personal data about the player
};
