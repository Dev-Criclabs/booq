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
  'platform.legal_release': { class: 'P' },     // D152 (0048): published privacy notice and terms, append-only
  'platform.legal_text': { class: 'P' },
  'platform.template_item': { class: 'P' },
  'platform.launch_check': { class: 'P' },
  'platform.export_request': { class: 'P' },
  'platform.connection_check_request': { class: 'P' },   // migration 0059: a request for the worker to recheck a club's LINE and Beam values (D167)
  'platform.console_session': { class: 'P' },     // 0051: console sign-in state, ids hashed, reached only through definer functions
  'platform.console_challenge': { class: 'P' },
  'platform.console_login_state': { class: 'P' },
  'platform.staff_enrolment': { class: 'P' },     // 0055: single-use first-factor links for BOOQ staff, token stored as a hash
  'platform.worker_heartbeat': { class: 'P' },   // migration 0007; counts only
  // People (F01-T12, migration 0003): club data, BOOQ staff never.
  'public.app_user': { class: 'D', audited: true },
  'public.app_user_role': { class: 'D', audited: true },
  'public.user_staff_note': { class: 'D', audited: true },
  'public.user_consent': { class: 'D' },     // append-only record
  'public.club_invite': { class: 'D', audited: true },
  'public.club_tester': { class: 'D', audited: true },
  // Connections and secrets (F01-T09, migration 0012). Secrets are write-only.
  'public.line_connection': { class: 'S', audited: true, allowColumns: ['webhook_token_hash'] },
  'public.payment_connection': { class: 'S', audited: true, allowColumns: ['webhook_token_hash_test', 'webhook_token_hash_live'] },
  'public.club_secret': { class: 'S', audited: true },
  'public.club_secret_read': { class: 'D' },
  // Import staging, exports, data requests (migration 0007)
  'public.import_job': { class: 'D', audited: true },
  'public.import_row': { class: 'D' },
  'public.data_export': { class: 'D', audited: true },
  'public.data_request': { class: 'D', audited: true },
  // Owner notices of platform changes (migration 0015)
  'public.owner_notice': { class: 'D', audited: true },
  // audit (F01-T10)
  'audit.registry': { class: 'infra' },
  'app.test_tables': { class: 'infra' },
  'app.anonymise_handlers': { class: 'infra' },          // F01-T33 (0019)
  'app.deletion_impact_handlers': { class: 'infra' },   // F01-T33 (0019)
  'public.rate_limit_hit': { class: 'D' },               // migration 0027: hashed sign-in counters, no raw address
  'public.audit_entry': { class: 'D' },
  'public.audit_erasure': { class: 'D' },
  // pause and resume (F01-T22): work to run when a club resumes; written only by migrations
  'app.pause_handlers': { class: 'infra' },
  // setup steps that block Draft to Testing (F01-T23): registered by migrations only
  'app.setup_steps': { class: 'infra' },
  'app.launch_producers': { class: 'infra' },
  // owner contact changes that need a second admin (F01-T23 part b)
  'platform.owner_contact_change': { class: 'P' },
  // the list of feature switches (F01-T25): written by migrations only
  'app.feature_keys': { class: 'infra' },
  // what to copy when a template is applied, for features that own the tables (F01-T24): written by migrations only
  'app.template_handlers': { class: 'infra' },
  // the club settings that can exist (F01-T08): written by migrations only
  'app.setting_keys': { class: 'infra' },
  // which template items a club has been given by a handler (F01-T24 follow-up): only the definer functions write it
  'public.club_template_copy': { class: 'S' },
};
