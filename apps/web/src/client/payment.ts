import type { Fetched } from './checkout';

// C11 Pay (F05-T11; PAY-01-AC1, AC2, PAY-02-AC6) and C12 Confirmed. The payment screen asks GET /payments/{id} until the state is final (F05
// assumption A-1); the amount, the QR and the hold come from the server only. Nothing here decides whether a booking is paid: only a state
// the server reports as confirmed is shown as booked (PAY-02). No slip upload exists in a Beam club.

export type PaymentState = 'waiting' | 'checking' | 'confirmed' | 'wallet' | 'failed' | 'expired';

export interface PaymentView {
  paymentId: string;
  orderId: string;
  state: PaymentState;
  amountSatang: number;
  qrImageBase64: string | null;
  qrExpiresAt: string | null;
  holdExpiresAt: string | null;
  booking: { courtName: string | null; startAt: string; endAt: string } | null;
  receiptNumber: string | null;
}

/** How often the screen asks while waiting. A UI choice, not in the spec (F05 A-1). */
export const POLL_MS = 3000;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isId = (v: string | null | undefined): v is string => typeof v === 'string' && UUID.test(v);

export async function loadPayment(slug: string, id: string, f: typeof fetch): Promise<Fetched<PaymentView>> {
  try {
    const res = await f(`/api/c/${encodeURIComponent(slug)}/payments/${encodeURIComponent(id)}`, { credentials: 'same-origin', cache: 'no-store' });
    const body = (await res.json().catch(() => ({}))) as PaymentView & { code?: unknown };
    if (res.ok) return { ok: true, value: body };
    return { ok: false, status: res.status, code: typeof body.code === 'string' ? body.code : 'offline' };
  } catch {
    return { ok: false, status: 0, code: 'offline' };
  }
}

/** Whole seconds left until `iso` (never below 0). */
export function secondsLeft(iso: string | null, now: number): number {
  if (!iso) return 0;
  return Math.max(0, Math.ceil((Date.parse(iso) - now) / 1000));
}

/** mm:ss for the hold countdown. */
export function mmss(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

/** The QR as an image source. The server stores the base64 of the image Beam sends; a value that already is a data address is kept. */
export function qrSrc(b64: string): string {
  return b64.startsWith('data:') ? b64 : `data:image/png;base64,${b64}`;
}

/** The address of C12: the payment that confirmed. */
export const confirmedPath = (slug: string, paymentId: string) => `/c/${slug}/confirmed?payment=${encodeURIComponent(paymentId)}`;

/** An ICS file for Add to calendar: one event, Asia/Bangkok. The title is the screen's own text, passed in. */
export function icsFor(title: string, startAt: string, endAt: string, uid: string): string {
  const z = (iso: string) => new Date(iso).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const esc = (s: string) => s.replace(/[\;,]/g, (m) => `\\${m}`).replace(/\r?\n/g, '\\n');
  return ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//BOOQ//C12//EN', 'BEGIN:VEVENT', `UID:${uid}@booq`, `DTSTAMP:${z(new Date().toISOString())}`, `DTSTART:${z(startAt)}`, `DTEND:${z(endAt)}`, `SUMMARY:${esc(title)}`, 'END:VEVENT', 'END:VCALENDAR', ''].join('\r\n');
}
