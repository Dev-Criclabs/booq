import type { PermissionFragment } from './types';

// F06 design 7 (D174). Cash at the desk, front desk and owner (F05 PAY-06): F06's desk package sale uses it and F05's cash
// routes reuse it. The A6 adjust and extend routes use F11's customer.adjust and package.extend; value owed is F13's report.read.
export const permissions: PermissionFragment = {
  'payment.cash': ['front_desk', 'owner'],
};
