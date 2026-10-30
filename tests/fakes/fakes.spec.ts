// Self test of the fakes against a tiny reference verifier. Proves the fakes behave as documented
// (docs/qa and tests/fakes/README.md); it is not a test of app code.
import { createHmac } from 'node:crypto';
import { describe, expect, test } from 'vitest';
import {
  BAD_SIGNATURE_MODES,
  FakeBeam,
  FakeClock,
  FakeLine,
  badSignature,
  duplicateCallbackParallel,
  lateCallbackAfterHold,
  paidAfterQrExpiryInsideHold,
  richMenuProblems,
  validPayment,
  wrongAmount,
  type BeamCharge,
  type DeliveryTarget,
} from './index';

// Fixture values for testing the FAKE only. The real hold time and the QR margin are platform settings (D80); QA does not choose them.
const HOLD_SECONDS = 900;
const QR_MARGIN_SECONDS = 30;

const keyA = Buffer.from('key-a').toString('base64');
const keyB = Buffer.from('key-b').toString('base64');

function setup() {
  const clock = new FakeClock();
  const beam = new FakeBeam({ clock, merchants: { mA: { apiKey: 'k', webhookKeyBase64: keyA }, mB: { apiKey: 'k', webhookKeyBase64: keyB } } });
  const done = new Set<string>();
  const seen = { confirmed: 0, wrongAmount: 0, rejected: 0 };
  const target: DeliveryTarget = async (d) => {
    const mac = createHmac('sha256', Buffer.from(keyA, 'base64')).update(Buffer.from(d.rawBody)).digest('base64');
    if (d.headers['x-beam-signature'] !== mac) {
      seen.rejected++;
      return { status: 401 };
    }
    const b = JSON.parse(d.rawBody) as { chargeId: string; amount: number };
    if (b.amount !== 50000) {
      seen.wrongAmount++;
      return { status: 200 };
    }
    if (!done.has(b.chargeId)) {
      done.add(b.chargeId);
      seen.confirmed++;
    }
    return { status: 200 };
  };
  const holdEndsAt = new Date(clock.now().getTime() + HOLD_SECONDS * 1000).toISOString();
  const charge = (): BeamCharge =>
    beam.createCharge('mA', {
      amount: 50000,
      currency: 'THB',
      referenceId: 'order-1',
      paymentMethod: { paymentMethodType: 'QR_PROMPT_PAY', qrPromptPay: { expiryTime: new Date(clock.now().getTime() + (HOLD_SECONDS - QR_MARGIN_SECONDS) * 1000).toISOString() } },
    });
  return { clock, beam, target, seen, charge, holdEndsAt };
}

describe('fake Beam', () => {
  test('valid payment confirms once', async () => {
    const { beam, clock, target, seen, charge, holdEndsAt } = setup();
    await validPayment({ beam, clock, target, charge: charge(), holdEndsAt });
    expect(seen.confirmed).toBe(1);
  });

  test.each(BAD_SIGNATURE_MODES)('bad signature %s is rejected', async (mode) => {
    const { beam, clock, target, seen, charge, holdEndsAt } = setup();
    const r = await badSignature({ beam, clock, target, charge: charge(), holdEndsAt }, mode);
    expect(r.response?.status).toBe(401);
    expect(seen.confirmed).toBe(0);
  });

  test.each(['one-satang-less', 'one-satang-more', 'baht-for-satang', 'double'] as const)('wrong amount %s does not confirm', async (v) => {
    const { beam, clock, target, seen, charge, holdEndsAt } = setup();
    await wrongAmount({ beam, clock, target, charge: charge(), holdEndsAt }, v);
    expect(seen.wrongAmount).toBe(1);
    expect(seen.confirmed).toBe(0);
  });

  test('ten parallel duplicates give one confirmation', async () => {
    const { beam, clock, target, seen, charge, holdEndsAt } = setup();
    await duplicateCallbackParallel({ beam, clock, target, charge: charge(), holdEndsAt }, 10);
    expect(seen.confirmed).toBe(1);
  });

  test('late callback is measured from the hold end, not the QR expiry (D126)', async () => {
    const { beam, clock, target, charge, holdEndsAt } = setup();
    const r = await lateCallbackAfterHold({ beam, clock, target, charge: charge(), holdEndsAt }, 'slot-still-open');
    expect(r.afterQrExpiry).toBe(true);
    expect(r.afterHoldEnd).toBe(true);
  });

  test('paid after the QR expiry but inside the hold is not late', async () => {
    const { beam, clock, target, seen, charge, holdEndsAt } = setup();
    const r = await paidAfterQrExpiryInsideHold({ beam, clock, target, charge: charge(), holdEndsAt });
    expect(r.afterQrExpiry).toBe(true);
    expect(r.afterHoldEnd).toBe(false);
    expect(seen.confirmed).toBe(1);
  });

  test('the inside-hold scenario refuses a QR that does not expire before the hold end', async () => {
    const { beam, clock, target } = setup();
    const c = beam.createCharge('mA', { amount: 50000, currency: 'THB', referenceId: 'x', paymentMethod: { paymentMethodType: 'QR_PROMPT_PAY', qrPromptPay: { expiryTime: new Date(clock.now().getTime() + HOLD_SECONDS * 1000).toISOString() } } });
    await expect(paidAfterQrExpiryInsideHold({ beam, clock, target, charge: c, holdEndsAt: c.encodedImage.expiry })).rejects.toThrow();
  });

  test('retries a 5xx up to maxAttempts and stops at 2xx', async () => {
    const clock = new FakeClock();
    const beam = new FakeBeam({ clock, maxAttempts: 10, merchants: { mA: { apiKey: 'k', webhookKeyBase64: keyA } } });
    const c = beam.createCharge('mA', { amount: 100, currency: 'THB', referenceId: 'x', paymentMethod: { paymentMethodType: 'QR_PROMPT_PAY', qrPromptPay: { expiryTime: '2026-12-07T10:00:00Z' } } });
    let calls = 0;
    await beam.pay(c.chargeId, async () => ({ status: ++calls < 3 ? 500 : 200 }));
    expect(calls).toBe(3);
  });

  test('a refund attempt fails the test', async () => {
    const { beam } = setup();
    beam.recordRefundAttempt();
    expect(() => beam.assertNoRefunds()).toThrow();
  });
});

describe('fake LINE', () => {
  const channels = [
    { clubId: 'A', channelAccessToken: 'tokA', loginChannelId: 'loginA', liffId: 'liffA' },
    { clubId: 'B', channelAccessToken: 'tokB', loginChannelId: 'loginB', liffId: 'liffB' },
  ];
  const users = [{ lineUserId: 'U1', displayName: 'Ploy', lineAppLanguage: 'th' as const, friendOf: { A: true, B: true } }];

  test('an ID token for club A is refused by club B', () => {
    const line = new FakeLine({ clock: new FakeClock(), channels, users });
    const token = line.issueIdToken('U1', 'A');
    expect(line.verifyIdToken(token, 'loginA').status).toBe(200);
    expect(line.verifyIdToken(token, 'loginB').status).toBe(400);
  });

  test('push needs the club token and is recorded per club', () => {
    const line = new FakeLine({ clock: new FakeClock(), channels, users });
    const msg = { type: 'text', text: 'hello' };
    expect(line.push('wrong', { to: 'U1', messages: [msg] }).status).toBe(401);
    expect(line.push('tokA', { to: 'U1', messages: [msg] }).status).toBe(200);
    expect(line.pushes({ clubId: 'A' })).toHaveLength(1);
    expect(line.pushes({ clubId: 'B' })).toHaveLength(0);
    expect(line.messagesUsedThisMonth('tokA')).toBe(1);
  });

  test('a token fault returns the injected status', () => {
    const line = new FakeLine({ clock: new FakeClock(), channels, users });
    line.injectFault('tokA', { status: 401 });
    expect(line.push('tokA', { to: 'U1', messages: [{ type: 'text', text: 'x' }] }).status).toBe(401);
  });

  test('rich menu check wants six distinct tiles on the club LIFF', () => {
    const area = (i: number) => ({ bounds: { x: 0, y: 0, width: 1, height: 1 }, action: { type: 'uri', uri: `https://liff.line.me/liffA/p${i}` } });
    const menu = { richMenuId: 'r', size: { width: 2500, height: 1686 }, name: 'm', chatBarText: 'c', areas: [0, 1, 2, 3, 4, 5].map(area) };
    expect(richMenuProblems(menu, { liffId: 'liffA', bookCourtLinkContains: 'p0' })).toEqual([]);
    expect(richMenuProblems({ ...menu, areas: menu.areas.slice(0, 5) }, { liffId: 'liffA', bookCourtLinkContains: 'p0' })).not.toEqual([]);
  });
});
