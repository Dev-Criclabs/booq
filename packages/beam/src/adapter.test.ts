import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FakeBeam, FakeClock } from '../../../tests/fakes';
import { BEAM_HOSTS, BeamError, beamGateway, probeBeam } from './adapter';

// F05-T03: the Beam adapter against QA's fake Beam over HTTP (PAY-01-AC4, AC10, PAY-02-AC2, PAY-05; D32,
// D76, D80; design 3.1, 5.1). Real Playground keys are not available yet (G-checks are F05-T13).
const KEY = 'sk_test_do_not_log_me_123456';
let clock: FakeClock;
let beam: FakeBeam;
let server: { url: string; close: () => Promise<void> };

beforeEach(async () => {
  clock = new FakeClock();
  beam = new FakeBeam({ clock, merchants: { 'm-hunter': { apiKey: KEY, webhookKeyBase64: Buffer.from('k').toString('base64') } } });
  server = await beam.serve();
});
afterEach(async () => {
  beam.assertNoRefunds();
  await server.close();
});

const gw = (apiKey = KEY) => beamGateway({ set: 'test', merchantId: 'm-hunter', apiKey, baseUrl: server.url });
const charge = { amountSatang: 50000, expiryTime: '2026-12-07T02:14:30.000Z', referenceId: 'pay-1', idempotencyKey: 'pay-1' };

describe('hosts (design 3.1)', () => {
  it('the test set calls the Playground host and the live set the production host; never crossed (PAY-01-AC4)', () => {
    expect(BEAM_HOSTS).toEqual({ test: 'https://playground.api.beamcheckout.com', live: 'https://api.beamcheckout.com' });
    expect(beamGateway({ set: 'test', merchantId: 'm', apiKey: 'k' }).host).toBe(BEAM_HOSTS.test);
    expect(beamGateway({ set: 'live', merchantId: 'm', apiKey: 'k' }).host).toBe(BEAM_HOSTS.live);
  });
});

describe('createCharge', () => {
  it('creates a QR PromptPay charge in satang with Basic auth and the idempotency key, and returns the QR', async () => {
    const r = await gw().createCharge(charge);
    expect(r).toMatchObject({ status: 'PENDING', amountSatang: 50000, qrExpiresAt: charge.expiryTime });
    expect(r.chargeId).toMatch(/^ch_/);
    expect(r.qrImageBase64).toBe('RkFLRQ==');
    expect(beam.getCharge(r.chargeId)).toMatchObject({ amount: 50000, currency: 'THB', referenceId: 'pay-1' });
  });

  it('sends only the order reference: no player data (D76)', async () => {
    await gw().createCharge(charge);
    expect(beam.createRequests).toEqual([
      { amount: 50000, currency: 'THB', paymentMethod: { paymentMethodType: 'QR_PROMPT_PAY', qrPromptPay: { expiryTime: charge.expiryTime } }, referenceId: 'pay-1' },
    ]);
  });

  it('the same idempotency key gives the same charge (G8, D47)', async () => {
    const a = await gw().createCharge(charge);
    const b = await gw().createCharge(charge);
    expect(b.chargeId).toBe(a.chargeId);
  });

  it('refuses an amount that is not whole positive satang before calling Beam', async () => {
    await expect(gw().createCharge({ ...charge, amountSatang: 500.5 })).rejects.toThrow(RangeError);
    await expect(gw().createCharge({ ...charge, amountSatang: 0 })).rejects.toThrow(RangeError);
    expect(beam.createRequests).toEqual([]);
  });
});

describe('getCharge', () => {
  it('returns the status, amount, currency and reference Beam holds now (design 5.3, G5)', async () => {
    const r = await gw().createCharge(charge);
    expect(await gw().getCharge(r.chargeId)).toEqual({ chargeId: r.chargeId, status: 'PENDING', amountSatang: 50000, currency: 'THB', referenceId: 'pay-1' });
  });
  it('an unknown charge is not_found', async () => {
    await expect(gw().getCharge('ch_nope')).rejects.toMatchObject({ kind: 'not_found' });
  });
});

describe('failures and keys (PAY-01-AC7, design 5.1 steps 1 and 4)', () => {
  it('a wrong key answers unauthorized (the key check failed)', async () => {
    await expect(gw('wrong').createCharge(charge)).rejects.toMatchObject({ kind: 'unauthorized' });
  });
  it('Beam not reachable answers unreachable', async () => {
    const down = beamGateway({ set: 'test', merchantId: 'm-hunter', apiKey: KEY, baseUrl: 'http://127.0.0.1:1' });
    await expect(down.createCharge(charge)).rejects.toMatchObject({ kind: 'unreachable' });
  });
  it('the key never appears in an error, its message or its JSON (keys never reach a log)', async () => {
    const calls = [
      () => gw('wrong').createCharge(charge),
      () => gw().getCharge('ch_nope'),
      () => beamGateway({ set: 'test', merchantId: 'm', apiKey: KEY, baseUrl: 'http://127.0.0.1:1' }).getCharge('x'),
    ];
    for (const call of calls) {
      const e = await call().then(() => null, (x: unknown) => x);
      expect(e).toBeInstanceOf(BeamError);
      const text = `${String(e)} ${JSON.stringify(e)} ${(e as Error).stack ?? ''} ${JSON.stringify(Object.entries(e as object))}`;
      expect(text).not.toContain(KEY);
      expect(text).not.toContain(Buffer.from(`m-hunter:${KEY}`).toString('base64'));
    }
  });
  it('the gateway object carries no refund and does not expose the key', () => {
    const g = gw();
    expect(Object.keys(g).sort()).toEqual(['createCharge', 'getCharge', 'host', 'set']);
    expect(JSON.stringify(g)).not.toContain(KEY);
  });
});

// probeBeam: the console's connection check (F05 design 5.7; PAY-01-AC6, AC7; D32). One authenticated read, no charge.
describe('probeBeam', () => {
  const creds = (over: Partial<Parameters<typeof probeBeam>[0]> = {}) => ({ set: 'test' as const, merchantId: 'm-hunter', apiKey: KEY, baseUrl: server.url, ...over });

  it('a key Beam accepts is ok, and nothing is created', async () => {
    expect(await probeBeam(creds())).toEqual({ ok: true, code: 'ok' });
    expect(beam.createRequests).toEqual([]);
  });
  it('a refused key is key_refused; Beam down is unreachable', async () => {
    expect(await probeBeam(creds({ apiKey: 'wrong' }))).toEqual({ ok: false, code: 'key_refused' });
    expect(await probeBeam(creds({ baseUrl: 'http://127.0.0.1:1' }))).toEqual({ ok: false, code: 'unreachable' });
  });
  it('a missing merchant or key is not configured, without calling Beam', async () => {
    expect(await probeBeam(creds({ merchantId: '' }))).toEqual({ ok: false, code: 'not_configured' });
    expect(await probeBeam(creds({ apiKey: '' }))).toEqual({ ok: false, code: 'not_configured' });
  });
  it('the webhook key, when given, must be well formed base64 that decodes to a key', async () => {
    expect(await probeBeam(creds({ hmacKey: Buffer.from('club-key').toString('base64') }))).toEqual({ ok: true, code: 'ok' });
    expect(await probeBeam(creds({ hmacKey: '' }))).toEqual({ ok: false, code: 'hmac_key_invalid' });
    expect(await probeBeam(creds({ hmacKey: '!!!not base64' }))).toEqual({ ok: false, code: 'hmac_key_invalid' });
  });
  it('the key never comes back in the result', async () => {
    for (const c of [creds(), creds({ apiKey: KEY + 'x' }), creds({ baseUrl: 'http://127.0.0.1:1' })]) {
      expect(JSON.stringify(await probeBeam(c))).not.toContain(KEY);
    }
  });
});
