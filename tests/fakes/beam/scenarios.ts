// Fake Beam scenarios: the five required by the QA brief, plus the variants they need.
// Each scenario has (1) a runner that drives the fake, and (2) a catalogue entry that says what
// the APP must do afterwards. The catalogue is the oracle; it comes from the spec, not from code.
import type { Clock } from '../clock';
import { FakeClock } from '../clock';
import type { FakeBeam } from './fake-beam';
import type { BeamCharge, DeliveryRecord, DeliveryTarget, Satang, SigningMode } from './types';

export interface ScenarioContext {
  beam: FakeBeam;
  clock: Clock;
  /** How a delivery reaches the app: fetch to the callback URL, or a direct handler call. */
  target: DeliveryTarget;
  /** A charge the app created through the fake (the test calls the app's Pay route first). */
  charge: BeamCharge;
}

// ---------- runners ----------

/** 1. Valid payment: correct signature, exact amount, inside the hold. */
export async function validPayment(ctx: ScenarioContext): Promise<DeliveryRecord> {
  return ctx.beam.pay(ctx.charge.id, ctx.target);
}

/** 2. Bad signature. Every variant must leave the app untouched (PAY-02). */
export const BAD_SIGNATURE_MODES: ReadonlyArray<SigningMode> = [
  'wrong-secret',
  'tampered-body',
  'missing',
  'malformed',
  'stale-timestamp',
];

export async function badSignature(ctx: ScenarioContext, mode: SigningMode): Promise<DeliveryRecord> {
  if (mode === 'correct') throw new Error('badSignature: pass a bad mode');
  // markPaid false: from Beam's side nothing was paid. The attacker only has the endpoint.
  return ctx.beam.pay(ctx.charge.id, ctx.target, { signing: mode, markPaid: false });
}

/** 2b. A club A secret used on a club B charge (tenancy, RLS-A12). */
export async function signedWithOtherClubSecret(ctx: ScenarioContext, otherClubSecret: string): Promise<DeliveryRecord> {
  return ctx.beam.pay(ctx.charge.id, ctx.target, { signing: 'wrong-secret', otherSecret: otherClubSecret, markPaid: false });
}

/** 3. Wrong amount. Validly signed, amount differs from the order. */
export type WrongAmountVariant = 'one-satang-less' | 'one-satang-more' | 'baht-for-satang' | 'double';

export function wrongAmountOf(charge: BeamCharge, variant: WrongAmountVariant): Satang {
  switch (variant) {
    case 'one-satang-less':
      return charge.amountSatang - 1;
    case 'one-satang-more':
      return charge.amountSatang + 1;
    case 'baht-for-satang': // 500 sent where 50000 expected: unit confusion
      return Math.round(charge.amountSatang / 100);
    case 'double':
      return charge.amountSatang * 2;
  }
}

export async function wrongAmount(ctx: ScenarioContext, variant: WrongAmountVariant): Promise<DeliveryRecord> {
  return ctx.beam.pay(ctx.charge.id, ctx.target, { amountSatang: wrongAmountOf(ctx.charge, variant) });
}

/** 4. Duplicate callback: same event id twice, one after the other or at the same moment. */
export async function duplicateCallback(ctx: ScenarioContext, how: 'sequential' | 'parallel', copies = 2): Promise<DeliveryRecord[]> {
  const first = await ctx.beam.pay(ctx.charge.id, ctx.target);
  if (how === 'sequential') {
    const rest: DeliveryRecord[] = [];
    for (let i = 1; i < copies; i++) rest.push(await ctx.beam.deliver(first.event, ctx.target));
    return [first, ...rest];
  }
  // parallel: build a fresh event and send all copies at once (first delivery above is dropped from the count by the caller)
  const event = ctx.beam.buildPaidEvent(ctx.charge.id);
  return ctx.beam.deliverParallel(event, ctx.target, copies);
}

/** 4b. Parallel duplicates without a prior sequential delivery (CONC-26). */
export async function duplicateCallbackParallelOnly(ctx: ScenarioContext, copies: number): Promise<DeliveryRecord[]> {
  const event = ctx.beam.buildPaidEvent(ctx.charge.id);
  return ctx.beam.deliverParallel(event, ctx.target, copies);
}

/**
 * 5. Late callback after the hold. The test supplies what happened to the slot in the meantime.
 * `holdSeconds` is the club's hold time (10, 15 or 20 minutes); the clock moves past it.
 */
export type LateVariant =
  | 'slot-still-open' // nobody took it: approved (PAY-03)
  | 'slot-taken-confirmed' // another player confirmed it: value to wallet
  | 'slot-held-by-other' // another player is paying for it right now: value to wallet
  | 'solo-coach-lost' // court free but coach booked: all or nothing, so wallet
  | 'closure-created'; // staff closed the slot meanwhile: wallet (Q-20)

export interface LateOptions {
  holdSeconds: number;
  /** How long after the hold ends the payment arrives. */
  lateBySeconds?: number;
  /** The test makes the slot state match the variant here, using the app's own API. */
  beforePay?: (variant: LateVariant) => Promise<void>;
}

export async function lateCallbackAfterHold(ctx: ScenarioContext, variant: LateVariant, opts: LateOptions): Promise<DeliveryRecord> {
  if (!(ctx.clock instanceof FakeClock)) throw new Error('lateCallbackAfterHold needs a FakeClock to move time');
  ctx.clock.advanceSeconds(opts.holdSeconds + (opts.lateBySeconds ?? 60));
  // Let the app's job release the hold and run any other due jobs before the callback arrives.
  // The test does that between these two lines through beforePay, or by calling runDueJobs() itself.
  await opts.beforePay?.(variant);
  return ctx.beam.pay(ctx.charge.id, ctx.target);
}

// ---------- catalogue: what the app must do (the oracle) ----------

export type OrderEffect = 'paid' | 'unchanged' | 'cancelled-or-wallet';

export interface ExpectedOutcome {
  /** HTTP status the app answers. 'undecided' = open question, assert only that it is not 5xx. */
  httpStatus: number | '2xx' | '4xx' | 'undecided';
  /** Booking state after the callback. */
  booking: 'confirmed' | 'unchanged' | 'not-confirmed-value-to-wallet';
  /** Wallet ledger change. 'amount-paid' = a credit row for the money Beam received. */
  walletCredit: 'none' | 'amount-paid' | 'undecided';
  /** New receipts issued by this delivery. */
  receipts: 0 | 1 | 'undecided';
  /** Booking confirmed Flex cards pushed to the player. */
  confirmedCards: 0 | 1;
  /** Total ledger rows, audit entries and LINE pushes beyond those named here must be zero. */
  nothingElseChanged: boolean;
  /** Open questions that decide fields marked 'undecided'. */
  open?: string[];
}

export interface ScenarioSpec {
  id: string;
  title: string;
  requirements: string[];
  steps: string[];
  expected: ExpectedOutcome;
}

const NO_CHANGE: ExpectedOutcome = {
  httpStatus: 'undecided',
  booking: 'unchanged',
  walletCredit: 'none',
  receipts: 0,
  confirmedCards: 0,
  nothingElseChanged: true,
  open: ['Q-19'],
};

export const BEAM_SCENARIOS: ScenarioSpec[] = [
  {
    id: 'BEAM-01-valid',
    title: 'Valid payment',
    requirements: ['PAY-02', 'LINE-04', 'RCPT-01'],
    steps: [
      'Player taps Pay: hold created, charge created for the exact amount',
      'Fake Beam sends charge.succeeded, correct signature, exact amount, inside the hold',
    ],
    expected: {
      httpStatus: '2xx',
      booking: 'confirmed',
      walletCredit: 'none',
      receipts: 1,
      confirmedCards: 1,
      nothingElseChanged: false,
    },
  },
  {
    id: 'BEAM-02-bad-signature',
    title: 'Bad signature (wrong secret, tampered body, missing, malformed, stale timestamp)',
    requirements: ['PAY-02', 'RLS-A12'],
    steps: ['Same setup as BEAM-01', 'Fake Beam sends the callback with each of BAD_SIGNATURE_MODES'],
    expected: { ...NO_CHANGE, httpStatus: '4xx', open: ['Q-19', 'Q-31'] },
  },
  {
    id: 'BEAM-03-wrong-amount',
    title: 'Wrong amount (1 satang less, 1 satang more, baht sent for satang, double)',
    requirements: ['PAY-02'],
    steps: ['Same setup', 'Validly signed callback whose amount differs from the order'],
    expected: { ...NO_CHANGE, httpStatus: 'undecided', open: ['Q-19'] },
  },
  {
    id: 'BEAM-04-duplicate',
    title: 'Duplicate callback (same event id, one after the other and at the same moment)',
    requirements: ['PAY-02', 'RCPT-01', 'LINE-04'],
    steps: ['Valid payment is delivered', 'The same event is delivered again, and a separate run delivers N copies in parallel'],
    expected: {
      // After all copies: exactly the effect of ONE valid payment.
      httpStatus: '2xx',
      booking: 'confirmed',
      walletCredit: 'none',
      receipts: 1,
      confirmedCards: 1,
      nothingElseChanged: false,
      open: ['Q-19'],
    },
  },
  {
    id: 'BEAM-05a-late-open',
    title: 'Late callback after the hold, slot still open',
    requirements: ['PAY-03', 'BOOK-03', 'LINE-04'],
    steps: ['Pay tapped, hold expires, release message sent', 'Payment arrives after the hold, nobody took the slot'],
    expected: { httpStatus: '2xx', booking: 'confirmed', walletCredit: 'none', receipts: 1, confirmedCards: 1, nothingElseChanged: false, open: ['Q-20'] },
  },
  {
    id: 'BEAM-05b-late-taken',
    title: 'Late callback after the hold, slot taken or held by someone else, or coach lost, or closure',
    requirements: ['PAY-03', 'BOOK-04'],
    steps: ['As above, but the slot is now confirmed or held by another player (or the coach is booked, or a closure covers it)', 'Payment arrives'],
    expected: {
      httpStatus: '2xx',
      booking: 'not-confirmed-value-to-wallet',
      walletCredit: 'amount-paid',
      receipts: 'undecided',
      confirmedCards: 0,
      nothingElseChanged: false,
      open: ['Q-20', 'Q-25'],
    },
  },
];

export function scenarioById(id: string): ScenarioSpec {
  const s = BEAM_SCENARIOS.find((x) => x.id === id);
  if (!s) throw new Error(`unknown scenario ${id}`);
  return s;
}
