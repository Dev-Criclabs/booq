import type { Fragment } from './types';

// F02 tables (class D: club data, BOOQ staff never). Each F02 migration task adds its tables here.
export const tables: Fragment = {
  'public.auth_session': { class: 'D' },   // F02-T02 (0102): hash only, never audited (high volume, no content)
};
