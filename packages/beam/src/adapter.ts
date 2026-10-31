import type { ChargeLookup, ChargeStatus, CreateCharge, CreatedCharge, KeySet, PaymentGateway } from '@booq/domain';

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

export type BeamProbeCode = 'ok' | 'not_configured' | 'key_refused' | 'unreachable' | 'unexpected' | 'hmac_key_invalid';

/** A probe id no charge can have: the read is authenticated and finds nothing. */
const PROBE_CHARGE = 'booq-connection-check';

/**
 * The console's connection check for one key set (F05 design 5.7; PAY-01-AC6, AC7; D32): one authenticated, read-only
 * call to Beam and no charge. A GET for a charge that cannot exist answers 404 once the key is accepted and 401 or 403
 * when it is not. (The design's G9 guessed a list call, GET /charges?limit=1; the single read is used because it is
 * stated by Beam's docs and served by QA's fake Beam. The Playground checks of F05-T13 confirm either.) With `hmacKey`
 * it also checks the webhook key is well formed base64 that decodes to a key. Pass or fail and a code only:
 * never the key, never player data.
 */
export async function probeBeam(creds: BeamCredentials & { hmacKey?: string }): Promise<{ ok: boolean; code: BeamProbeCode }> {
  if (!creds.merchantId || !creds.apiKey) return { ok: false, code: 'not_configured' };
  if (creds.hmacKey !== undefined && !hmacKeyUsable(creds.hmacKey)) return { ok: false, code: 'hmac_key_invalid' };
  try {
    await beamGateway(creds).getCharge(PROBE_CHARGE);
    return { ok: true, code: 'ok' };
  } catch (e) {
    const kind = (e as { kind?: BeamErrorKind }).kind;
    if (kind === 'not_found') return { ok: true, code: 'ok' };
    if (kind === 'unauthorized') return { ok: false, code: 'key_refused' };
    if (kind === 'unreachable') return { ok: false, code: 'unreachable' };
    return { ok: false, code: 'unexpected' };
  }
}

/** The webhook key as Beam shows it: base64 that decodes to a non-empty key (webhook-authentication, stated). */
function hmacKeyUsable(keyBase64: string): boolean {
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(keyBase64) || keyBase64.length % 4 !== 0) return false;
  return Buffer.from(keyBase64, 'base64').length > 0;
}
