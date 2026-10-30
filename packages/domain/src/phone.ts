// Name and phone validation (F02-T08; AUTH-02-AC2, AC28; design 6.9, assumption A-12, D11).
// The single place the rules live. Results are codes, never text; the client maps codes to
// locale keys. The phone is typed and never verified by a code (D11).

export type NameErrorCode = 'name_missing' | 'name_too_long' | 'name_invalid';
export type PhoneErrorCode = 'phone_missing' | 'phone_invalid';
export type Checked<V, C extends string> = { ok: true; value: V } | { ok: false; code: C };

const NAME_MAX = 100;
const NAME_PUNCTUATION = new Set([' ', '.', "'", '’', '-']);

/** 1 to 100 characters after trimming; Thai or English letters plus spaces, dots, apostrophes and hyphens. */
export function validateFullName(raw: string): Checked<string, NameErrorCode> {
  const name = raw.trim();
  if (name === '') return { ok: false, code: 'name_missing' };
  if ([...name].length > NAME_MAX) return { ok: false, code: 'name_too_long' };
  let letters = 0;
  for (const ch of name) {
    if (NAME_PUNCTUATION.has(ch)) continue;
    if (/^[\p{L}\p{M}]$/u.test(ch) && /^[\p{Script=Thai}\p{Script=Latin}]$/u.test(ch)) {
      if (/\p{L}/u.test(ch)) letters += 1;
      continue;
    }
    return { ok: false, code: 'name_invalid' };
  }
  return letters === 0 ? { ok: false, code: 'name_invalid' } : { ok: true, value: name };
}

/**
 * Strips spaces, dashes and brackets. A Thai mobile is `0` plus nine digits or `+66` plus nine
 * digits and becomes `+66…`. Any other international number is accepted in `+` form, first digit
 * 1 to 9, at most 15 digits (E.164). A `+66` number that is not nine digits is invalid, not
 * "international". The seven digit minimum for foreign numbers is an assumption.
 */
export function validatePhone(raw: string): Checked<string, PhoneErrorCode> {
  const typed = raw.trim();
  if (typed === '') return { ok: false, code: 'phone_missing' };
  const s = typed.replace(/[\s\-()]/g, '');
  const thai = /^(?:0|\+66)(\d{9})$/.exec(s);
  if (thai) return { ok: true, value: `+66${thai[1]}` };
  if (/^\+66/.test(s)) return { ok: false, code: 'phone_invalid' };
  if (/^\+[1-9]\d{6,14}$/.test(s)) return { ok: true, value: s };
  return { ok: false, code: 'phone_invalid' };
}

/** The injected rule of the import validator (F01-T30). E.164, or null when invalid. */
export function normalizePhone(raw: string): string | null {
  const r = validatePhone(raw);
  return r.ok ? r.value : null;
}
