import type { Fragment } from './types';

// F06 tables. Each F06 migration task adds its tables here.
export const tables: Fragment = {
  // Products (F06-T01, migration 0501): class S, setup data shown in the support view (D27)
  'public.package_product': { class: 'S', audited: true },
  // Packages and the wallet anchor (F06-T01, migration 0501): class D, club data, BOOQ staff never
  'public.customer_package': { class: 'D', audited: true },
  'public.package_extension': { class: 'D', audited: true },
  'public.wallet_account': { class: 'D' },               // a lock anchor only: no balance column (FA 2.3)
  // Ledgers (F06-T02, migration 0502): append-only movements, class D
  'public.credit_ledger': { class: 'D', audited: true },
  'public.wallet_ledger': { class: 'D', audited: true },
};
