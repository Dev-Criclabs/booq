import { createHmac, timingSafeEqual } from 'node:crypto';

// A signed call between two BOOQ apps (F01-T17b): apps/platform asks apps/staff-invite to invite, reset or deactivate.
// The caller signs `${timestamp}.${body}` with a secret only those two share; the callee refuses a wrong signature, a
// missing one, and a timestamp outside the allowed skew (so a captured call cannot be replayed later). The skew is the
// caller's option: no value is built in. The secret is not a Supabase key.

export const INTERNAL_SIGNATURE = 'x-booq-signature';
export const INTERNAL_TIMESTAMP = 'x-booq-timestamp';

const mac = (secret: string, timestamp: string, body: string) => createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex');

export function signInternalCall(secret: string, now: Date, body: string): Record<string, string> {
  if (!secret) throw new Error('signInternalCall: no secret');
  const ts = String(Math.floor(now.getTime() / 1000));
  return { [INTERNAL_TIMESTAMP]: ts, [INTERNAL_SIGNATURE]: mac(secret, ts, body) };
}

export function verifyInternalCall(secret: string, now: Date, maxSkewSeconds: number, headers: { timestamp: string | null; signature: string | null }, body: string): boolean {
  if (!secret || !headers.timestamp || !headers.signature || !/^\d{1,12}$/.test(headers.timestamp)) return false;
  if (Math.abs(Math.floor(now.getTime() / 1000) - Number(headers.timestamp)) > maxSkewSeconds) return false;
  const want = Buffer.from(mac(secret, headers.timestamp, body), 'hex');
  const got = /^[0-9a-f]{64}$/.test(headers.signature) ? Buffer.from(headers.signature, 'hex') : null;
  return got !== null && got.length === want.length && timingSafeEqual(got, want);
}
