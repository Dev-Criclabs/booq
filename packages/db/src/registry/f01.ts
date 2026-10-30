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
  // Platform schema (F01-T16, migration 0004): BOOQ's own data, no club content.
  'platform.platform_staff': { class: 'P' },
  'platform.staff_assignment': { class: 'P' },
  'platform.support_session': { class: 'P' },
  'platform.audit_log': { class: 'P' },
  'platform.club_usage_daily': { class: 'P' },
  'platform.config': { class: 'P' },
  'platform.template': { class: 'P' },
  'platform.template_item': { class: 'P' },
  'platform.launch_check': { class: 'P' },
  'platform.export_request': { class: 'P' },
  // audit (F01-T10)
  'audit.registry': { class: 'infra' },
  'app.test_tables': { class: 'infra' },   // F01-T26
  'public.audit_entry': { class: 'D' },
  'public.audit_erasure': { class: 'D' },
};
