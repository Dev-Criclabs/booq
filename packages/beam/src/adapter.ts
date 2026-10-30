import type { ChargeLookup, ChargeStatus, CreateCharge, CreatedCharge, KeySet, PaymentGateway } from '../../domain/src/payments/gateway';

// The Beam adapter (F05-T03; design 3.1, 5.1; FA 6.3). Only what Beam's public docs state: HTTP Basic
// merchantId:apiKey, POST /api/v1/charges for a QR PromptPay charge in satang with x-beam-idempotency-key,
// GET /api/v1/charges/{id}. The host follows the key set, so a key of one set never reaches the other
// environment (PAY-01-AC4). Nothing here returns money (PAY-05). The key lives only in a closure: it is never
// a property, never in an error and never logged.

export const BEAM_HOSTS: Readonly<Record<KeySet, string>> = {
  test: 'https://playground.api.beamcheckout.com',
  live: 'https://api.beamcheckout.com',
};

export type BeamErrorKind = 'unauthorized' | 'not_found' | 'unreachable' | 'rejected' | 'bad_response';

/** A typed failure. It carries the kind and the HTTP status only; never the key or the request. */
export class BeamError extends Error {
  constructor(
    readonly kind: BeamErrorKind,
    readonly status: number | null = null,
  ) {
    super(`beam_${kind}`);
    this.name = 'BeamError';
  }
}

export interface BeamCredentials {
  set: KeySet;
  merchantId: string;
  apiKey: string;
  /** Tests point the adapter at the fake Beam; production uses BEAM_HOSTS[set]. */
  baseUrl?: string;
  fetch?: typeof fetch;
}

export interface BeamGateway extends PaymentGateway {
  readonly set: KeySet;
  readonly host: string;
}

interface BeamCharge {
  chargeId: string;
  status: ChargeStatus;
  amount: number;
  currency: string;
  referenceId: string;
  encodedImage?: { expiry: string; imageBase64Encoded: string };
}

export function beamGateway(creds: BeamCredentials): BeamGateway {
  const host = creds.baseUrl ?? BEAM_HOSTS[creds.set];
  const auth = `Basic ${Buffer.from(`${creds.merchantId}:${creds.apiKey}`).toString('base64')}`;
  const doFetch = creds.fetch ?? fetch;

  async function call(method: 'GET' | 'POST', path: string, body?: unknown, idempotencyKey?: string): Promise<BeamCharge> {
    const headers: Record<string, string> = { authorization: auth, accept: 'application/json' };
    if (body !== undefined) headers['content-type'] = 'application/json';
    if (idempotencyKey !== undefined) headers['x-beam-idempotency-key'] = idempotencyKey;
    let res: Response;
    try {
      res = await doFetch(`${host}${path}`, { method, headers, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
    } catch {
      throw new BeamError('unreachable');
    }
    if (res.status === 401 || res.status === 403) throw new BeamError('unauthorized', res.status);
    if (res.status === 404) throw new BeamError('not_found', res.status);
    if (res.status >= 500 || res.status === 429) throw new BeamError('unreachable', res.status);
    if (res.status < 200 || res.status >= 300) throw new BeamError('rejected', res.status);
    try {
      return (await res.json()) as BeamCharge;
    } catch {
      throw new BeamError('bad_response', res.status);
    }
  }

  const createCharge = async (req: CreateCharge): Promise<CreatedCharge> => {
    if (!Number.isSafeInteger(req.amountSatang) || req.amountSatang <= 0) throw new RangeError('amount must be whole positive satang');
    const c = await call(
      'POST',
      '/api/v1/charges',
      {
        amount: req.amountSatang,
        currency: 'THB',
        paymentMethod: { paymentMethodType: 'QR_PROMPT_PAY', qrPromptPay: { expiryTime: req.expiryTime } },
        referenceId: req.referenceId,
        ...(req.returnUrl !== undefined ? { returnUrl: req.returnUrl } : {}),
      },
      req.idempotencyKey,
    );
    if (typeof c.chargeId !== 'string' || !c.encodedImage) throw new BeamError('bad_response');
    return { chargeId: c.chargeId, status: c.status, amountSatang: c.amount, qrImageBase64: c.encodedImage.imageBase64Encoded, qrExpiresAt: c.encodedImage.expiry };
  };

  const getCharge = async (chargeId: string): Promise<ChargeLookup> => {
    const c = await call('GET', `/api/v1/charges/${encodeURIComponent(chargeId)}`);
    return { chargeId: c.chargeId, status: c.status, amountSatang: c.amount, currency: c.currency, referenceId: c.referenceId };
  };

  return { set: creds.set, host, createCharge, getCharge };
}
