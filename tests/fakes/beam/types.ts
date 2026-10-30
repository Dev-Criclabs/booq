// Fake Beam: shared types.
// The real Beam wire format is NOT in the spec (open question Q-31, needs Beam sandbox docs).
// Everything here that mirrors Beam (paths, headers, field names) is a PLACEHOLDER behind the
// WireFormat interface, so the real format replaces it in one file.

/** Money is integer satang. 500 THB = 50000. Never a float. */
export type Satang = number;

export type ChargeStatus = 'pending' | 'paid' | 'expired';

export interface CreateChargeRequest {
  /** Beam merchant of the club. Each club is its own merchant, so each has its own webhook secret. */
  merchantId: string;
  /** App side reference: the order id. Echoed back in callbacks. */
  orderRef: string;
  amountSatang: Satang;
  /** How long the QR is valid. Q-02: is this the hold time? The app decides, the fake obeys. */
  expiresInSeconds: number;
}

export interface BeamCharge {
  id: string;
  merchantId: string;
  orderRef: string;
  amountSatang: Satang;
  currency: 'THB';
  status: ChargeStatus;
  /** Stand in for the PromptPay QR payload. */
  qrPayload: string;
  createdAt: string;
  expiresAt: string;
  paidAt?: string;
}

export type BeamEventType = 'charge.succeeded' | 'charge.expired';

export interface BeamEvent {
  /** Idempotency key. Duplicate deliveries carry the same eventId. */
  eventId: string;
  type: BeamEventType;
  chargeId: string;
  orderRef: string;
  amountSatang: Satang;
  currency: 'THB';
  occurredAt: string;
}

/** What the fake sends to the app's callback endpoint. */
export interface SignedDelivery {
  url?: string;
  headers: Record<string, string>;
  rawBody: string;
}

export interface DeliveryResponse {
  status: number;
  body?: string;
}

/** The test decides how a delivery reaches the app: an HTTP call, or a direct handler call. */
export type DeliveryTarget = (delivery: SignedDelivery) => Promise<DeliveryResponse>;

export interface DeliveryRecord {
  at: string;
  attempt: number;
  event: BeamEvent;
  signingMode: SigningMode;
  delivery: SignedDelivery;
  response?: DeliveryResponse;
  error?: string;
}

/** How the signature on one delivery is produced. */
export type SigningMode =
  | 'correct' // signed with the merchant's secret over the exact body
  | 'wrong-secret' // signed with another secret (also: club A secret on a club B charge)
  | 'tampered-body' // signed correctly, then the body is changed
  | 'missing' // no signature header at all
  | 'malformed' // header present, garbage value
  | 'stale-timestamp'; // correct signature but a timestamp outside any replay window

export interface WireFormat {
  readonly name: string;
  /** Headers for a delivery, given the exact body and the secret. */
  sign(rawBody: string, secret: string, timestampSeconds: number): Record<string, string>;
  /** Replay window the fake uses for 'stale-timestamp'. */
  readonly replayWindowSeconds: number;
}
