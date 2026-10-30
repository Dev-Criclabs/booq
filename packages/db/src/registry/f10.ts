import type { Fragment } from './types';

// F10 tables (LINE messages and rich menu). Each F10 migration task adds its tables here.
export const tables: Fragment = {
  'public.message_outbox': { class: 'D' },                // F10-T02 (0601): the message log, no text, not audited
};
