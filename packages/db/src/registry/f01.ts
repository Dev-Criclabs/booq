import type { Fragment } from './types';

// F01 tables. Each F01 migration task adds its tables here in the same commit.
export const tables: Fragment = {
  // The owner contact is visible to BOOQ staff (decision D2).
  'public.club': { class: 'S', scope: 'self', allowColumns: ['owner_name', 'owner_phone', 'owner_line', 'owner_email'] },
  'public.club_feature': { class: 'S' },
  'public.club_setting': { class: 'S' },
  'public.location': { class: 'S' },
  'public.resource': { class: 'S' },
  'public.opening_hours': { class: 'S' },
  'public.club_pause': { class: 'S' },
  'public.club_status_change': { class: 'D' },
  // audit (F01-T10)
  'audit.registry': { class: 'infra' },
  'public.audit_entry': { class: 'D' },
  'public.audit_erasure': { class: 'D' },
};
