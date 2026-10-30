import { randomUUID } from 'node:crypto';
import type { Clock } from '../clock';
import { PlaceholderHmacWire } from './wire';
import type {
  BeamCharge,
  BeamEvent,
  CreateChargeRequest,
  DeliveryRecord,
  DeliveryResponse,
  DeliveryTarget,
  Satang,
  SignedDelivery,
  SigningMode,
  WireFormat,
} from './types';

export interface FakeBeamOptions {
  clock: Clock;
  /** merchantId -> webhook secret. One entry per club (each club is its own Beam merchant). */
  merchants: Record<string, string>;
  wire?: WireFormat;
  /** Retry on a 5xx or a thrown error, like a real gateway would. Attempts include the first. Default 1 = no retry. */
  maxAttempts?: number;
}

export class FakeBeamRefundCalled extends Error {
  constructor() {
    super('FakeBeam: refund() was called. BOOQ never refunds as cash (CANCEL-02, PAY-05). This is a bug in the app.');
  }
}

export interface PayOptions {
  /** Amount in the callback. Default: the charge amount. */
  amountSatang?: Satang;
  signing?: SigningMode;
  /** Reuse an event id to build a duplicate. Default: new id. */
  eventId?: string;
  /** Deliver even if the charge is expired (late payment). Default true: the fake is permissive. */
  allowExpired?: boolean;
  /** Secret to use for 'wrong-secret'. Default: an unrelated string. */
  otherSecret?: string;
  /** Force status of the charge to paid in the fake's own books. Default true. */
  markPaid?: boolean;
}

/**
 * In-process Beam. Two sides:
 *  - app facing: createCharge(), getCharge(), refund() (must never be called)
 *  - test facing: pay(), expire(), deliver(), records
 */
export class FakeBeam {
  private readonly clock: Clock;
  private readonly merchants: Record<string, string>;
  private readonly wire: WireFormat;
  private readonly maxAttempts: number;
  private readonly charges = new Map<string, BeamCharge>();
  readonly deliveries: DeliveryRecord[] = [];
  readonly refundAttempts: Array<{ at: string; chargeId?: string }> = [];

  constructor(opts: FakeBeamOptions) {
    this.clock = opts.clock;
    this.merchants = opts.merchants;
    this.wire = opts.wire ?? new PlaceholderHmacWire();
    this.maxAttempts = opts.maxAttempts ?? 1;
  }

  // ---------- app facing (what the app's Beam adapter calls) ----------

  createCharge(req: CreateChargeRequest): BeamCharge {
    if (!Number.isInteger(req.amountSatang) || req.amountSatang <= 0) {
      throw new Error(`FakeBeam: amount must be a positive integer of satang, got ${req.amountSatang}`);
    }
    if (!(req.merchantId in this.merchants)) throw new Error(`FakeBeam: unknown merchant ${req.merchantId}`);
    const now = this.clock.now();
    const charge: BeamCharge = {
      id: `chg_${randomUUID()}`,
      merchantId: req.merchantId,
      orderRef: req.orderRef,
      amountSatang: req.amountSatang,
      currency: 'THB',
      status: 'pending',
      qrPayload: `FAKE-PROMPTPAY|${req.amountSatang}|${req.orderRef}`,
      createdAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + req.expiresInSeconds * 1000).toISOString(),
    };
    this.charges.set(charge.id, charge);
    return { ...charge };
  }

  getCharge(id: string): BeamCharge {
    const c = this.charges.get(id);
    if (!c) throw new Error(`FakeBeam: no charge ${id}`);
    if (c.status === 'pending' && this.clock.now().getTime() >= Date.parse(c.expiresAt)) c.status = 'expired';
    return { ...c };
  }

  /** The app must never call this. The fake throws so any attempt fails loudly, and records it. */
  refund(chargeId?: string): never {
    this.refundAttempts.push({ at: this.clock.now().toISOString(), ...(chargeId ? { chargeId } : {}) });
    throw new FakeBeamRefundCalled();
  }

  // ---------- test facing ----------

  /** Build the event Beam would send when the charge is paid. */
  buildPaidEvent(chargeId: string, opts: PayOptions = {}): BeamEvent {
    const c = this.mustGet(chargeId);
    return {
      eventId: opts.eventId ?? `evt_${randomUUID()}`,
      type: 'charge.succeeded',
      chargeId: c.id,
      orderRef: c.orderRef,
      amountSatang: opts.amountSatang ?? c.amountSatang,
      currency: 'THB',
      occurredAt: this.clock.now().toISOString(),
    };
  }

  /** Simulate the player paying: build the event, sign it and deliver it to the app. */
  async pay(chargeId: string, target: DeliveryTarget, opts: PayOptions = {}): Promise<DeliveryRecord> {
    const c = this.mustGet(chargeId);
    const status = this.getCharge(chargeId).status;
    if (status === 'expired' && opts.allowExpired === false) {
      throw new Error(`FakeBeam: charge ${chargeId} is expired and allowExpired=false`);
    }
    if (opts.markPaid !== false) {
      c.status = 'paid';
      c.paidAt = this.clock.now().toISOString();
    }
    return this.deliver(this.buildPaidEvent(chargeId, opts), target, opts.signing ?? 'correct', opts.otherSecret);
  }

  /** Mark a charge expired and notify, in case the app handles expiry callbacks. */
  async expire(chargeId: string, target: DeliveryTarget): Promise<DeliveryRecord> {
    const c = this.mustGet(chargeId);
    c.status = 'expired';
    const event: BeamEvent = { ...this.buildPaidEvent(chargeId), eventId: `evt_${randomUUID()}`, type: 'charge.expired' };
    return this.deliver(event, target, 'correct');
  }

  /** Sign an event and deliver it, with retries on 5xx or error. Returns the last attempt. */
  async deliver(
    event: BeamEvent,
    target: DeliveryTarget,
    signing: SigningMode = 'correct',
    otherSecret?: string,
  ): Promise<DeliveryRecord> {
    const charge = this.mustGet(event.chargeId);
    const delivery = this.sign(event, this.merchants[charge.merchantId] as string, signing, otherSecret);
    let last: DeliveryRecord | undefined;
    for (let attempt = 1; attempt <= this.maxAttempts; attempt++) {
      const rec: DeliveryRecord = {
        at: this.clock.now().toISOString(),
        attempt,
        event,
        signingMode: signing,
        delivery,
      };
      this.deliveries.push(rec);
      last = rec;
      try {
        const res: DeliveryResponse = await target(delivery);
        rec.response = res;
        if (res.status < 500) break;
      } catch (e) {
        rec.error = e instanceof Error ? e.message : String(e);
      }
    }
    return last as DeliveryRecord;
  }

  /** Deliver the same event n times at once (concurrent duplicate, CONC-26). */
  async deliverParallel(event: BeamEvent, target: DeliveryTarget, n: number): Promise<DeliveryRecord[]> {
    return Promise.all(Array.from({ length: n }, () => this.deliver(event, target, 'correct')));
  }

  deliveriesFor(chargeId: string): DeliveryRecord[] {
    return this.deliveries.filter((d) => d.event.chargeId === chargeId);
  }

  assertNoRefunds(): void {
    if (this.refundAttempts.length > 0) throw new FakeBeamRefundCalled();
  }

  // ---------- internals ----------

  private sign(event: BeamEvent, secret: string, mode: SigningMode, otherSecret?: string): SignedDelivery {
    const rawBody = JSON.stringify(event);
    const nowSec = Math.floor(this.clock.now().getTime() / 1000);
    switch (mode) {
      case 'correct':
        return { rawBody, headers: this.wire.sign(rawBody, secret, nowSec) };
      case 'wrong-secret':
        return { rawBody, headers: this.wire.sign(rawBody, otherSecret ?? 'not-the-merchant-secret', nowSec) };
      case 'tampered-body': {
        const headers = this.wire.sign(rawBody, secret, nowSec);
        const tampered = JSON.stringify({ ...event, amountSatang: Math.max(1, event.amountSatang - 1) });
        return { rawBody: tampered, headers };
      }
      case 'missing':
        return { rawBody, headers: {} };
      case 'malformed': {
        const headers = this.wire.sign(rawBody, secret, nowSec);
        const out: Record<string, string> = {};
        for (const k of Object.keys(headers)) out[k] = k.includes('signature') ? 'zz-not-a-signature' : (headers[k] as string);
        return { rawBody, headers: out };
      }
      case 'stale-timestamp':
        return { rawBody, headers: this.wire.sign(rawBody, secret, nowSec - this.wire.replayWindowSeconds - 60) };
    }
  }

  private mustGet(id: string): BeamCharge {
    const c = this.charges.get(id);
    if (!c) throw new Error(`FakeBeam: no charge ${id}`);
    return c;
  }
}
