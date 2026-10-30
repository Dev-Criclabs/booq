import type { Fragment } from './types';

// F10 tables (LINE messages and rich menu). Each F10 migration task adds its tables here.
export const tables: Fragment = {
  'public.message_outbox': { class: 'D' },                // F10-T02 (0601): the message log, no text, not audited
  'public.notification_pref': { class: 'D', audited: true }, // F10-T03 (0602): the two C17 switches; Promotions is an opt in
  'public.rich_menu_label': { class: 'S', audited: true },  // F10-T04 (0603): six tiles, owner labels; links fixed in code (D54)
  'public.rich_menu': { class: 'S' },                       // F10-T04 (0603): one active menu per club (D92)
  'platform.club_line_usage': { class: 'P' },               // F10-T05 (0604): counts per club and Bangkok month; state derived
  'platform.club_health': { class: 'P' },                   // F10-T05 (0604): LINE token and usage health
};
