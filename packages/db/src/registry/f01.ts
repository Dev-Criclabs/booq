import type { Fragment } from './types';

// F01 tables. Each F01 migration task adds its tables here in the same commit.
export const tables: Fragment = {
  // The owner contact is visible to BOOQ staff (decision D2).
  'public.club': { class: 'S', scope: 'self', allowColumns: ['owner_name', 'owner_phone', 'owner_line', 'owner_email'], audited: true },
  'public.club_feature': { class: 'S', audited: true },
  'public.club_setting': { class: 'S', audited: true },
  'public.location': { class: 'S', audited: true },
  'public.resource': { class: 'S', audited: true },
  'public.opening_hours': { class: 'S', audited: true },
  'public.club_pause': { class: 'S', audited: true },
  'public.club_status_change': { class: 'D', audited: true },
  // audit (F01-T10)
  'audit.registry': { class: 'infra' },
  'app.test_tables': { class: 'infra' },   // F01-T26
  'public.audit_entry': { class: 'D' },
  'public.audit_erasure': { class: 'D' },
};
