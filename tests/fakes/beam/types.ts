// Fake Beam: shared types.
// Shapes follow Beam's public docs (https://docs.beamcheckout.com, read 30 Oct 2026). What the docs state is
// marked DOC. What they do not state is marked GUESS and is listed in docs/qa/open-questions.md Q-31.

/** Money is integer satang (DOC: "smallest unit of the currency"). 500 THB = 50000. Never a float. */
export type Satang = number;

/** DOC: PENDING, SUCCEEDED, FAILED appear in the docs. GUESS: other values and what an expired QR becomes. */
export type ChargeStatus = 'PENDING' | 'SUCCEEDED' | 'FAILED';

export interface MerchantConfig {
  /** DOC: HTTP Basic auth, merchantId:apiKey. */
  apiKey: string;
  /** DOC: the webhook signing key, shown base64 encoded in Lighthouse. Each club is its own merchant. */
  webhookKeyBase64: string;
}

/** DOC: POST /api/v1/charges, QR PromptPay charge. */
export interface CreateChargeRequest {
  amount: Satang;
  currency: 'THB';
  paymentMethod: {
    paymentMethodType: 'QR_PROMPT_PAY';
    /** DOC: ISO 8601 UTC. D18: the app sets it to the end of the hold. */
    qrPromptPay: { expiryTime: string };
  };
  /** DOC: the app's own reference. The app sends the order id. */
  referenceId: string;
  returnUrl?: string;
}

export interface BeamCharge {
  chargeId: string;
  merchantId: string;
  referenceId: string;
  status: ChargeStatus;
  currency: 'THB';
  amount: Satang;
  paymentMethod: { paymentMethodType: 'QR_PROMPT_PAY'; qrPromptPay: { expiryTime: string } };
  /** DOC: response of a QR charge. */
  actionRequired: 'ENCODED_IMAGE';
  encodedImage: { expiry: string; imageBase64Encoded: string; rawData: string };
  createdAt: string;
  updatedAt: string;
  /** DOC: present on a succeeded charge. */
  transactionTime?: string;
  failureCode?: string;
}

/** DOC: x-beam-event header carries the event name. Other event names exist; only these two are used. */
export type BeamEventName = 'charge.succeeded' | 'charge.failed';

/**
 * The webhook body is the charge object as GET would return it (DOC). NOTE: the docs show no event id and no
 * timestamp in the payload or headers, so duplicate detection cannot rely on an event id (Q-31).
 */
export type BeamWebhookBody = Omit<BeamCharge, 'encodedImage' | 'actionRequired'>;

/** What the fake sends to the app's callback endpoint. */
export interface SignedDelivery {
  headers: Record<string, string>;
  /** The exact bytes that were signed (DOC: "exact body ... without formatting"). */
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
  eventName: BeamEventName;
  chargeId: string;
  signingMode: SigningMode;
  /** True when the payment was reported after the QR expiry, i.e. after the hold (D18, PAY-03). */
  afterExpiry: boolean;
  delivery: SignedDelivery;
  response?: DeliveryResponse;
  error?: string;
}

/** How the signature on one delivery is produced. */
export type SigningMode =
  | 'correct' // signed with the merchant's key over the exact body
  | 'wrong-key' // signed with another key (also: club A's key on a club B charge)
  | 'tampered-body' // signed correctly, then the body is changed (amount)
  | 'reformatted-body' // signed correctly, then the same JSON is re-serialised with whitespace: must fail (DOC: exact body)
  | 'missing' // no signature header
  | 'malformed'; // header present, not base64 of a valid digest

export interface WireFormat {
  readonly name: string;
  /** Headers for a delivery: signature over the exact raw body, plus the event name. */
  sign(rawBody: string, keyBase64: string, eventName: BeamEventName): Record<string, string>;
}

/** DOC: "By default, Beam attempts to deliver your webhook 10 times with exponential backoff." Intervals GUESS. */
export const BEAM_MAX_WEBHOOK_ATTEMPTS = 10;
