import { createServer, type IncomingMessage } from 'node:http';
import { randomUUID } from 'node:crypto';
import type { Clock } from '../clock';
import { FakeClock } from '../clock';
import { BeamHmacWire } from './wire';
import {
  type BeamCharge,
  type BeamEventName,
  type BeamWebhookBody,
  type CreateChargeRequest,
  type DeliveryRecord,
  type DeliveryResponse,
  type DeliveryTarget,
  type MerchantConfig,
  type Satang,
  type SignedDelivery,
  type SigningMode,
  type WireFormat,
} from './types';

export interface FakeBeamOptions {
  clock: Clock;
  /** merchantId -> credentials. One entry per club (each club is its own Beam merchant). */
  merchants: Record<string, MerchantConfig>;
  wire?: WireFormat;
  /** Delivery attempts on a non-2xx or an error. Default 1. Beam's own default is 10 (BEAM_MAX_WEBHOOK_ATTEMPTS). */
  maxAttempts?: number;
}

export class FakeBeamRefundCalled extends Error {
  constructor() {
    super('FakeBeam: a refund was requested. BOOQ never refunds as cash (CANCEL-02, PAY-05). This is a bug in the app.');
  }
}

export interface PayOptions {
  /** Amount in the webhook. Default: the charge amount. */
  amount?: Satang;
  signing?: SigningMode;
  /** Key to use for 'wrong-key'. Default: an unrelated key. */
  otherKeyBase64?: string;
  /** false = nothing was paid at Beam (an attacker just posts to the endpoint). Default true. */
  markPaid?: boolean;
  /** false = the charge succeeds at Beam but no webhook is sent (D73: the callback never arrives). Default true. */
  deliver?: boolean;
  /** End of the hold, as the app set it. Beam does not know it; the fake records afterHoldEnd from it. */
  holdEndsAt?: string;
}

/**
 * In-process Beam, also servable over HTTP. App facing: createCharge, getCharge, refund trap.
 * Test facing: pay, fail, deliver, deliverParallel, records.
 */
export class FakeBeam {
  private readonly clock: Clock;
  private readonly merchants: Record<string, MerchantConfig>;
  private readonly wire: WireFormat;
  private readonly maxAttempts: number;
  private readonly charges = new Map<string, BeamCharge>();
  private readonly idempotency = new Map<string, { chargeId: string; at: number }>();
  readonly deliveries: DeliveryRecord[] = [];
  readonly refundAttempts: Array<{ at: string; body?: unknown }> = [];
  /** Every create-charge request body as received, for D76 (only the order reference may be sent). */
  readonly createRequests: unknown[] = [];

  constructor(opts: FakeBeamOptions) {
    this.clock = opts.clock;
    this.merchants = opts.merchants;
    this.wire = opts.wire ?? new BeamHmacWire();
    this.maxAttempts = opts.maxAttempts ?? 1;
  }

  // ---------- app facing: what the app's Beam adapter calls (POST /api/v1/charges, GET /api/v1/charges/{id}) ----------

  /** DOC: idempotency key (header x-beam-idempotency-key) is kept 12 hours; the response to a repeat is GUESS: same charge. */
  createCharge(merchantId: string, req: CreateChargeRequest, idempotencyKey?: string): BeamCharge {
    if (!(merchantId in this.merchants)) throw new Error(`FakeBeam: unknown merchant ${merchantId}`);
    if (!Number.isInteger(req.amount) || req.amount <= 0) throw new Error(`FakeBeam: amount must be a positive integer of satang, got ${req.amount}`);
    this.createRequests.push(structuredClone(req));
    const now = this.clock.now();
    if (idempotencyKey) {
      const prior = this.idempotency.get(`${merchantId}:${idempotencyKey}`);
      if (prior && now.getTime() - prior.at < 12 * 3_600_000) return this.getCharge(prior.chargeId);
    }
    const expiry = req.paymentMethod.qrPromptPay.expiryTime;
    const charge: BeamCharge = {
      chargeId: `ch_${randomUUID().replace(/-/g, '')}`,
      merchantId,
      referenceId: req.referenceId,
      status: 'PENDING',
      currency: 'THB',
      amount: req.amount,
      paymentMethod: req.paymentMethod,
      actionRequired: 'ENCODED_IMAGE',
      encodedImage: { expiry, imageBase64Encoded: 'RkFLRQ==', rawData: `FAKE-PROMPTPAY|${req.amount}|${req.referenceId}` },
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
    };
    this.charges.set(charge.chargeId, charge);
    if (idempotencyKey) this.idempotency.set(`${merchantId}:${idempotencyKey}`, { chargeId: charge.chargeId, at: now.getTime() });
    return structuredClone(charge);
  }

  /** DOC: a QR past its expiry may stay PENDING for good; the fake never flips it (what Beam does is GUESS, Q-31). */
  getCharge(chargeId: string): BeamCharge {
    return structuredClone(this.must(chargeId));
  }

  /** The app must never call a refund. Recorded, and assertNoRefunds() fails the test. */
  recordRefundAttempt(body?: unknown): void {
    this.refundAttempts.push({ at: this.clock.now().toISOString(), body });
  }

  /**
   * D76: only the order reference goes to Beam. Returns create-charge fields outside the allowed set
   * (amount, currency, paymentMethod, referenceId, returnUrl). Empty = pass. A name, phone or LINE ID would be listed.
   */
  unexpectedRequestFields(): string[] {
    const allowed = new Set(['amount', 'currency', 'paymentMethod', 'referenceId', 'returnUrl']);
    return this.createRequests.flatMap((r) => Object.keys(r as Record<string, unknown>).filter((k) => !allowed.has(k)));
  }

  assertNoRefunds(): void {
    if (this.refundAttempts.length > 0) throw new FakeBeamRefundCalled();
  }

  // ---------- test facing ----------

  /** The webhook body Beam sends for a charge (the charge object as GET returns it). */
  webhookBody(chargeId: string, overrides: Partial<BeamWebhookBody> = {}): BeamWebhookBody {
    const { encodedImage: _e, actionRequired: _a, ...rest } = this.getCharge(chargeId);
    return { ...rest, ...overrides };
  }

  /** The player pays: the charge succeeds and the webhook is signed and delivered. */
  async pay(chargeId: string, target: DeliveryTarget, opts: PayOptions = {}): Promise<DeliveryRecord> {
    const c = this.must(chargeId);
    const now = this.clock.now().toISOString();
    if (opts.markPaid !== false) {
      c.status = 'SUCCEEDED';
      c.transactionTime = now;
      c.updatedAt = now;
    }
    if (opts.deliver === false) return { at: now, attempt: 0, eventName: 'charge.succeeded', chargeId, signingMode: 'correct', afterQrExpiry: false, delivery: { rawBody: '', headers: {} } };
    const body = this.webhookBody(chargeId, {
      status: 'SUCCEEDED',
      transactionTime: now,
      ...(opts.amount !== undefined ? { amount: opts.amount } : {}),
    });
    const rec = await this.deliver('charge.succeeded', body, target, opts.signing ?? 'correct', opts.otherKeyBase64);
    if (opts.holdEndsAt) rec.afterHoldEnd = Date.parse(rec.at) > Date.parse(opts.holdEndsAt);
    return rec;
  }

  /** charge.failed. failureCode values are not documented in the pages read; pass any string. */
  async fail(chargeId: string, target: DeliveryTarget, failureCode = 'UNKNOWN'): Promise<DeliveryRecord> {
    const c = this.must(chargeId);
    c.status = 'FAILED';
    c.failureCode = failureCode;
    c.updatedAt = this.clock.now().toISOString();
    return this.deliver('charge.failed', this.webhookBody(chargeId, { status: 'FAILED', failureCode }), target);
  }

  /** Sign and deliver, retrying a non-2xx or error up to maxAttempts. Returns the last attempt. */
  async deliver(
    eventName: BeamEventName,
    body: BeamWebhookBody,
    target: DeliveryTarget,
    signing: SigningMode = 'correct',
    otherKeyBase64?: string,
  ): Promise<DeliveryRecord> {
    const delivery = this.prepare(eventName, body, signing, otherKeyBase64);
    return this.send(eventName, body, delivery, signing, target);
  }

  /** Re-send the same signed bytes again (duplicate callback). */
  async redeliver(previous: DeliveryRecord, target: DeliveryTarget): Promise<DeliveryRecord> {
    return this.send(previous.eventName, JSON.parse(previous.delivery.rawBody) as BeamWebhookBody, previous.delivery, previous.signingMode, target);
  }

  /** The same signed delivery sent n times at the same moment (CONC-26). */
  async deliverParallel(eventName: BeamEventName, body: BeamWebhookBody, target: DeliveryTarget, n: number): Promise<DeliveryRecord[]> {
    const delivery = this.prepare(eventName, body, 'correct');
    return Promise.all(Array.from({ length: n }, () => this.send(eventName, body, delivery, 'correct', target)));
  }

  deliveriesFor(chargeId: string): DeliveryRecord[] {
    return this.deliveries.filter((d) => d.chargeId === chargeId);
  }

  /** Expose the fake over HTTP so the real Beam adapter can point at it. Paths and auth follow the docs. */
  async serve(port = 0): Promise<{ url: string; close: () => Promise<void> }> {
    const server = createServer((req, res) => {
      void this.handle(req).then(({ status, body }) => {
        res.writeHead(status, { 'content-type': 'application/json' });
        res.end(JSON.stringify(body));
      });
    });
    await new Promise<void>((r) => server.listen(port, '127.0.0.1', r));
    const addr = server.address();
    const p = typeof addr === 'object' && addr ? addr.port : port;
    return { url: `http://127.0.0.1:${p}`, close: () => new Promise<void>((r) => server.close(() => r())) };
  }

  // ---------- internals ----------

  private async handle(req: IncomingMessage): Promise<{ status: number; body: unknown }> {
    const url = new URL(req.url ?? '/', 'http://fake');
    const auth = (req.headers['authorization'] ?? '').toString();
    const [merchantId, apiKey] = Buffer.from(auth.replace(/^Basic\s+/i, ''), 'base64').toString('utf8').split(':');
    const m = merchantId ? this.merchants[merchantId] : undefined;
    if (!m || m.apiKey !== apiKey) return { status: 401, body: { message: 'unauthorized' } };
    const raw = await new Promise<string>((resolve) => {
      const chunks: Buffer[] = [];
      req.on('data', (c: Buffer) => chunks.push(c));
      req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    });
    if (req.method === 'POST' && url.pathname === '/api/v1/charges') {
      const key = req.headers['x-beam-idempotency-key']?.toString();
      return { status: 201, body: this.createCharge(merchantId as string, JSON.parse(raw) as CreateChargeRequest, key) };
    }
    const one = /^\/api\/v1\/charges\/([^/]+)$/.exec(url.pathname);
    if (req.method === 'GET' && one) {
      const c = this.charges.get(one[1] as string);
      return c && c.merchantId === merchantId ? { status: 200, body: c } : { status: 404, body: { message: 'not found' } };
    }
    if (req.method === 'POST' && url.pathname === '/api/v1/refunds') {
      this.recordRefundAttempt(raw ? JSON.parse(raw) : undefined);
      return { status: 403, body: { message: 'FakeBeam: refunds are not allowed in BOOQ tests' } };
    }
    return { status: 404, body: { message: `fake Beam: no route ${req.method} ${url.pathname}` } };
  }

  private prepare(eventName: BeamEventName, body: BeamWebhookBody, mode: SigningMode, otherKeyBase64?: string): SignedDelivery {
    const merchant = this.merchants[body.merchantId];
    if (!merchant) throw new Error(`FakeBeam: unknown merchant ${body.merchantId}`);
    const rawBody = JSON.stringify(body);
    const good = this.wire.sign(rawBody, merchant.webhookKeyBase64, eventName);
    switch (mode) {
      case 'correct':
        return { rawBody, headers: good };
      case 'wrong-key':
        return { rawBody, headers: this.wire.sign(rawBody, otherKeyBase64 ?? Buffer.from('not-the-merchant-key').toString('base64'), eventName) };
      case 'tampered-body':
        return { rawBody: JSON.stringify({ ...body, amount: Math.max(1, body.amount - 1) }), headers: good };
      case 'reformatted-body':
        return { rawBody: JSON.stringify(body, null, 2), headers: good };
      case 'missing': {
        const { 'x-beam-signature': _s, ...rest } = good;
        return { rawBody, headers: rest };
      }
      case 'malformed':
        return { rawBody, headers: { ...good, 'x-beam-signature': '!!not-base64!!' } };
    }
  }

  private async send(eventName: BeamEventName, body: BeamWebhookBody, delivery: SignedDelivery, signing: SigningMode, target: DeliveryTarget): Promise<DeliveryRecord> {
    const charge = this.must(body.chargeId);
    const expiry = Date.parse(charge.encodedImage.expiry);
    let last!: DeliveryRecord;
    for (let attempt = 1; attempt <= this.maxAttempts; attempt++) {
      const rec: DeliveryRecord = {
        at: this.clock.now().toISOString(),
        attempt,
        eventName,
        chargeId: body.chargeId,
        signingMode: signing,
        afterQrExpiry: this.clock.now().getTime() > expiry,
        delivery,
      };
      this.deliveries.push(rec);
      last = rec;
      try {
        const res: DeliveryResponse = await target(delivery);
        rec.response = res;
        if (res.status >= 200 && res.status < 300) break; // DOC: any 2xx stops retrying; anything else retries
      } catch (e) {
        rec.error = e instanceof Error ? e.message : String(e);
      }
      if (this.clock instanceof FakeClock) this.clock.advanceSeconds(2 ** attempt); // backoff intervals are GUESS
    }
    return last;
  }

  private must(id: string): BeamCharge {
    const c = this.charges.get(id);
    if (!c) throw new Error(`FakeBeam: no charge ${id}`);
    return c;
  }
}

