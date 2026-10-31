import type { PermissionFragment } from './types';

// F13 design 7 (receipts, daily close, reports; R2-AC11, RCPT-01-AC9). A player reads their own receipts through the person routes
// (`needsPerson`), not through a permission. Front desk prints a customer's receipt but does not list, search or read reports.
export const permissions: PermissionFragment = {
  'receipt.list': ['owner', 'accountant'],
  'receipt.print': ['owner', 'accountant', 'front_desk'],
  'receipt.void': ['owner'],
  'report.read': ['owner', 'accountant'],
  'daily-close.run': ['owner', 'accountant'],
};
