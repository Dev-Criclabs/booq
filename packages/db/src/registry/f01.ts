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
  'platform.worker_heartbeat': { class: 'P' },   // migration 0007; counts only
  // People (F01-T12, migration 0003): club data, BOOQ staff never.
  'public.app_user': { class: 'D', audited: true },
  'public.app_user_role': { class: 'D', audited: true },
  'public.user_staff_note': { class: 'D', audited: true },
  'public.user_consent': { class: 'D' },     // append-only record
  'public.club_invite': { class: 'D', audited: true },
  'public.club_tester': { class: 'D', audited: true },
  // Connections and secrets (F01-T09, migration 0012). Secrets are write-only.
  'public.line_connection': { class: 'S', audited: true },
  'public.payment_connection': { class: 'S', audited: true, allowColumns: ['webhook_token_hash_test', 'webhook_token_hash_live'] },
  'public.club_secret': { class: 'S', audited: true },
  'public.club_secret_read': { class: 'D' },
  // Import staging, exports, data requests (migration 0007)
  'public.import_job': { class: 'D', audited: true },
  'public.import_row': { class: 'D' },
  'public.data_export': { class: 'D', audited: true },
  'public.data_request': { class: 'D', audited: true },
  // audit (F01-T10)
  'audit.registry': { class: 'infra' },
  'app.test_tables': { class: 'infra' },   // F01-T26
  'public.audit_entry': { class: 'D' },
  'public.audit_erasure': { class: 'D' },
};
