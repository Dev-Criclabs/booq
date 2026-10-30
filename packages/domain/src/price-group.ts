import { bangkokDate } from '../../time/src/index';

// Price group (F02-T13; AUTH-02-AC10 to AC14, AC17; D12; design 6.6). Written once here and
// called by F04 and F06; a screen never works it out. Dates are Asia/Bangkok calendar dates
// as YYYY-MM-DD, so the server zone never changes an answer. Results are codes, not text.
//
// Assumption: a 29 February birthday turns a year older on 1 March in a common year.

export type PriceGroup = 'adult' | 'student';
export type StudentItemCheck = { ok: true } | { ok: false; code: 'dob_required' | 'student_too_old' | 'dob_future' };

const STUDENT_UNDER = 18;

/** Whole years between a date of birth and a Bangkok date. Negative when the birth is after the date. */
export function ageOn(dob: string, onDate: string): number {
  const years = Number(onDate.slice(0, 4)) - Number(dob.slice(0, 4));
  return onDate.slice(5) < dob.slice(5) ? years - 1 : years;
}

/** No date of birth gives `adult` (D12). Under 18 on the Bangkok date gives `student`. */
export function priceGroupFor(dob: string | null, onDate: string): PriceGroup {
  if (dob === null) return 'adult';
  return ageOn(dob, onDate) < STUDENT_UNDER ? 'student' : 'adult';
}

/** The same, for an instant: takes its Bangkok date. */
export function priceGroupAt(dob: string | null, at: Date): PriceGroup {
  return priceGroupFor(dob, bangkokDate(at));
}

/** Can this player buy an item sold only at a Student price? */
export function checkStudentItem(dob: string | null, onDate: string): StudentItemCheck {
  if (dob === null) return { ok: false, code: 'dob_required' };
  if (dob > onDate) return { ok: false, code: 'dob_future' };
  return priceGroupFor(dob, onDate) === 'student' ? { ok: true } : { ok: false, code: 'student_too_old' };
}
