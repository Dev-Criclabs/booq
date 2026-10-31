import type { Fragment } from './types';

// F13 tables (class D: club data, BOOQ staff never). Each F13 migration task adds its tables here.
export const tables: Fragment = {
  'public.receipt': { class: 'D' },           // F13-T01 (0701): append-only; the snapshot holds the customer name and the lines
  'public.receipt_void': { class: 'D' },      // F13-T01 (0701): append-only
  'public.receipt_counter': { class: 'D' },   // F13-T01 (0701): written only by app.issue_receipt
  'public.daily_close': { class: 'D' },       // F13-T07 (0705): append-only, one row per club and Bangkok day
  'public.receipt_print': { class: 'D' },     // F13-T12 (0711): the first print by the customer is the original; append-only
  'public.coach_payout': { class: 'D' },             // F13-T10 (0709): owner and accountant read; changes only through the payout functions, never once paid
  'public.coach_payout_adjustment': { class: 'D' },  // F13-T10 (0709): append-only, a reason on every row
};
