// Fake Beam scenarios: the five required by the QA brief, plus the variants they need.
// Each scenario has (1) a runner that drives the fake, and (2) a catalogue entry that says what the APP must do.
// The catalogue is the oracle. It comes from the spec and the user's decisions (docs/decisions.md D18 to D26), not from code.
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
  /**
   * When the hold ends (ISO), read from the app's hold row. Lateness is measured from here, not from the QR expiry:
   * the QR expires slightly before the hold ends, by a platform setting (D80). QA does not pick that margin;
   * it comes from the charge the app created (charge.encodedImage.expiry) and the hold the app stored.
   */
  holdEndsAt: string;
}

// ---------- runners ----------

/** 1. Valid payment: correct signature, exact amount, inside the hold. */
export async function validPayment(ctx: ScenarioContext): Promise<DeliveryRecord> {
  return ctx.beam.pay(ctx.charge.chargeId, ctx.target, { holdEndsAt: ctx.holdEndsAt });
}

/** 2. Bad signature. Every variant is rejected, logged and alerted (D24) and changes nothing (PAY-02). */
export const BAD_SIGNATURE_MODES: ReadonlyArray<SigningMode> = ['wrong-key', 'tampered-body', 'reformatted-body', 'missing', 'malformed'];

export async function badSignature(ctx: ScenarioContext, mode: SigningMode): Promise<DeliveryRecord> {
  if (mode === 'correct') throw new Error('badSignature: pass a bad mode');
  // markPaid false: from Beam's side nothing was paid. The sender only has the endpoint address.
  return ctx.beam.pay(ctx.charge.chargeId, ctx.target, { signing: mode, markPaid: false });
}

/** 2b. Club A's webhook key used on a club B charge (tenancy, RLS-A12). */
export async function signedWithOtherClubKey(ctx: ScenarioContext, otherClubKeyBase64: string): Promise<DeliveryRecord> {
  return ctx.beam.pay(ctx.charge.chargeId, ctx.target, { signing: 'wrong-key', otherKeyBase64: otherClubKeyBase64, markPaid: false });
}

/** 3. Wrong amount. Validly signed, amount differs from the order. D24, D36: not confirmed, flagged for the owner, answered 2xx. */
export type WrongAmountVariant = 'one-satang-less' | 'one-satang-more' | 'baht-for-satang' | 'double';

export function wrongAmountOf(charge: BeamCharge, variant: WrongAmountVariant): Satang {
  switch (variant) {
    case 'one-satang-less':
      return charge.amount - 1;
    case 'one-satang-more':
      return charge.amount + 1;
    case 'baht-for-satang': // 500 sent where 50000 expected: unit confusion
      return Math.round(charge.amount / 100);
    case 'double':
      return charge.amount * 2;
  }
}

export async function wrongAmount(ctx: ScenarioContext, variant: WrongAmountVariant): Promise<DeliveryRecord> {
  return ctx.beam.pay(ctx.charge.chargeId, ctx.target, { amount: wrongAmountOf(ctx.charge, variant) });
}

/** 4. Duplicate callback: the same signed bytes again (D24: ignored with success). */
export async function duplicateCallbackSequential(ctx: ScenarioContext, copies = 2): Promise<DeliveryRecord[]> {
  const first = await ctx.beam.pay(ctx.charge.chargeId, ctx.target);
  const rest: DeliveryRecord[] = [];
  for (let i = 1; i < copies; i++) rest.push(await ctx.beam.redeliver(first, ctx.target));
  return [first, ...rest];
}

/** 4b. n identical deliveries at the same moment (CONC-26). The charge is marked paid first. */
export async function duplicateCallbackParallel(ctx: ScenarioContext, copies: number): Promise<DeliveryRecord[]> {
  const body = ctx.beam.webhookBody(ctx.charge.chargeId, { status: 'SUCCEEDED' });
  return ctx.beam.deliverParallel('charge.succeeded', body, ctx.target, copies);
}

/**
 * 5. Late callback. D126, D80, PAY-02-AC2, D25: a payment is late only when Beam reports it AFTER THE HOLD ENDS.
 * The QR expires a little earlier (D80), so there are two different cases:
 *  - 5a `paidAfterQrExpiryInsideHold`: after the QR expiry but before the hold end: NOT late, confirms normally.
 *  - 5b `lateCallbackAfterHold`: after the hold end: late, PAY-03 rules.
 * The test supplies what happened to the slot meanwhile.
 */
export type LateVariant =
  | 'slot-still-open' // nobody took it: approved
  | 'slot-taken-confirmed' // another player confirmed it: value to wallet
  | 'slot-held-by-other' // another player is paying for it: value to wallet
  | 'solo-coach-lost' // court free but coach booked: all or nothing, so all to wallet (D25)
  | 'closure-created' // staff closed the slot meanwhile: wallet (D25)
  | 'club-paused' // D107, D109: a late payment is not used to confirm in a paused club: whole value to the wallet
  | 'account-deleted'; // D109: the player's account was deleted meanwhile: whole value to the wallet

export interface LateOptions {
  /** The test makes the slot state match the variant here, after the hold job has run, using the app's own API. */
  beforePay?: (variant: LateVariant) => Promise<void>;
  /** Seconds after the hold end. Any positive value is late; default 1. */
  lateBySeconds?: number;
}

function moveClockTo(clock: Clock, at: number): void {
  if (!(clock instanceof FakeClock)) throw new Error('this scenario needs a FakeClock to move time');
  if (at > clock.now().getTime()) clock.advanceMs(at - clock.now().getTime());
}

export async function lateCallbackAfterHold(ctx: ScenarioContext, variant: LateVariant, opts: LateOptions = {}): Promise<DeliveryRecord> {
  moveClockTo(ctx.clock, Date.parse(ctx.holdEndsAt) + (opts.lateBySeconds ?? 1) * 1000);
  await opts.beforePay?.(variant);
  return ctx.beam.pay(ctx.charge.chargeId, ctx.target, { holdEndsAt: ctx.holdEndsAt });
}

/**
 * 5a. Paid after the QR expiry but inside the hold. The time is the middle of the gap, so no margin value is chosen here.
 * Throws if the app set the QR expiry at or after the hold end: D80 says it must be before it.
 */
export async function paidAfterQrExpiryInsideHold(ctx: ScenarioContext): Promise<DeliveryRecord> {
  const qr = Date.parse(ctx.charge.encodedImage.expiry);
  const hold = Date.parse(ctx.holdEndsAt);
  if (!(qr < hold)) throw new Error(`QR expiry ${ctx.charge.encodedImage.expiry} is not before the hold end ${ctx.holdEndsAt} (D80 wants it slightly before)`);
  moveClockTo(ctx.clock, qr + Math.floor((hold - qr) / 2));
  const rec = await ctx.beam.pay(ctx.charge.chargeId, ctx.target, { holdEndsAt: ctx.holdEndsAt });
  if (!rec.afterQrExpiry || rec.afterHoldEnd) throw new Error('fake clock did not land between QR expiry and hold end');
  return rec;
}

/** 6. D71: a validly signed callback for a charge the app has no order for. The test creates the charge in the fake only. */
export async function unknownCharge(ctx: ScenarioContext): Promise<DeliveryRecord> {
  return ctx.beam.pay(ctx.charge.chargeId, ctx.target);
}

// ---------- catalogue: what the app must do (the oracle) ----------

export interface ExpectedOutcome {
  /** HTTP status the app answers. 'undecided' = open; assert only that it is not 5xx. */
  httpStatus: '2xx' | '4xx' | 'undecided';
  booking: 'confirmed' | 'unchanged' | 'not-confirmed';
  /** Wallet ledger row created automatically by this delivery. */
  walletCredit: 'none' | 'amount-paid';
  /** New receipts issued by this delivery. A late payment that goes to the wallet gets its own receipt for the money received (D37). */
  receipts: 0 | 1;
  confirmedCards: 0 | 1;
  /** A LINE message to the player explaining a late payment that went to the wallet (D25). */
  lateWalletMessage: boolean;
  /** Wrong amount: the player is told in the app and by LINE when it can be sent (D77, D112). */
  playerNotice?: 'app-and-line-when-sendable';
  /** Wrong amount: staff later credit the full amount received; that credit gets its own receipt (D77, D79). Not done by this delivery. */
  /** Bad signature: rejected, logged and alerted (D24). */
  securityAlert: boolean;
  /** Valid signature, wrong amount: flagged for the owner; staff credit the wallet with a reason (D24). */
  ownerFlag: boolean;
  /** Everything not named here (ledger rows, audit entries, pushes) must be zero. */
  nothingElseChanged: boolean;
  open?: string[];
}

export interface ScenarioSpec {
  id: string;
  title: string;
  requirements: string[];
  decisions: string[];
  steps: string[];
  expected: ExpectedOutcome;
}

const BASE: ExpectedOutcome = {
  httpStatus: '2xx',
  booking: 'unchanged',
  walletCredit: 'none',
  receipts: 0,
  confirmedCards: 0,
  lateWalletMessage: false,
  securityAlert: false,
  ownerFlag: false,
  nothingElseChanged: true,
};

export const BEAM_SCENARIOS: ScenarioSpec[] = [
  {
    id: 'BEAM-01-valid',
    title: 'Valid payment',
    requirements: ['PAY-02', 'LINE-04', 'RCPT-01'],
    decisions: ['D18'],
    steps: ['Player taps Pay: hold created, charge created for the exact amount, QR expiry = end of hold', 'charge.succeeded, correct signature, exact amount, inside the hold'],
    expected: { ...BASE, booking: 'confirmed', receipts: 1, confirmedCards: 1, nothingElseChanged: false },
  },
  {
    id: 'BEAM-02-bad-signature',
    title: 'Bad signature (wrong key, tampered body, reformatted body, missing, malformed)',
    requirements: ['PAY-02', 'RLS-A12'],
    decisions: ['D24'],
    steps: ['Same setup as BEAM-01', 'Callback with each of BAD_SIGNATURE_MODES'],
    // Beam treats 4xx and 5xx as failure and retries up to 10 times (DOC); rejecting with 4xx is expected.
    expected: { ...BASE, httpStatus: '4xx', securityAlert: true, nothingElseChanged: false },
  },
  {
    id: 'BEAM-03-wrong-amount',
    title: 'Wrong amount (1 satang less, 1 satang more, baht sent for satang, double)',
    requirements: ['PAY-02'],
    decisions: ['D24', 'D36'],
    steps: ['Same setup', 'Validly signed callback whose amount differs from the order'],
    // D36: recorded, flagged for the owner, answered with a success status so Beam stops retrying.
    expected: { ...BASE, httpStatus: '2xx', booking: 'not-confirmed', ownerFlag: true, playerNotice: 'app-and-line-when-sendable', nothingElseChanged: false },
  },
  {
    id: 'BEAM-04-duplicate',
    title: 'Duplicate callback (same bytes again, one after the other and at the same moment)',
    requirements: ['PAY-02', 'RCPT-01', 'LINE-04'],
    decisions: ['D24'],
    steps: ['Valid payment delivered', 'The same signed bytes delivered again; a separate run delivers n copies in parallel'],
    // Beam's payload has no event id (DOC), so the app dedupes on the charge, not an event id (Q-31).
    expected: { ...BASE, booking: 'confirmed', receipts: 1, confirmedCards: 1, nothingElseChanged: false },
  },
  {
    id: 'BEAM-05a-inside-hold',
    title: 'Paid after the QR expiry but inside the hold (not late)',
    requirements: ['PAY-02', 'BOOK-03'],
    decisions: ['D80', 'D126'],
    steps: ['Pay tapped: hold and charge created, QR expiry slightly before the hold end (platform margin)', 'Beam reports the payment between the QR expiry and the hold end'],
    // Only a payment after the hold ends is late (PAY-02-AC2, D25). The hold is still valid, so it confirms normally.
    expected: { ...BASE, booking: 'confirmed', receipts: 1, confirmedCards: 1, nothingElseChanged: false },
  },
  {
    id: 'BEAM-05b-late-open',
    title: 'Late callback after the hold end, slot still open',
    requirements: ['PAY-03', 'BOOK-03', 'LINE-04'],
    decisions: ['D18', 'D25', 'D80'],
    steps: ['Pay tapped, hold ends, release message sent', 'Payment reported after the hold end; no other hold, booking or closure on the slot'],
    expected: { ...BASE, booking: 'confirmed', receipts: 1, confirmedCards: 1, nothingElseChanged: false },
  },
  {
    id: 'BEAM-05c-late-taken',
    title: 'Late callback after the hold end, slot taken or held, coach lost, closure, paused club or deleted account',
    requirements: ['PAY-03', 'BOOK-04'],
    decisions: ['D18', 'D25', 'D37', 'D107', 'D109', 'D80'],
    steps: ['As above, but another hold, booking or closure now covers the slot (solo class: court and coach both must be free), or the club is paused, or the account was deleted', 'Payment reported; the whole value goes to the wallet'],
    // D25, D37: the wallet credit gets its own receipt for the money received.
    expected: { ...BASE, booking: 'not-confirmed', walletCredit: 'amount-paid', receipts: 1, lateWalletMessage: true, nothingElseChanged: false, open: ['Q-25 (receipt number series and year)'] },
  },
  {
    id: 'BEAM-06-unknown-charge',
    title: 'Validly signed callback for a charge the app has no order for',
    requirements: ['PAY-02'],
    decisions: ['D71'],
    steps: ['A charge exists at Beam that the app did not create', 'charge.succeeded with a valid signature'],
    // D71: answered with success and flagged; nothing is confirmed or credited.
    expected: { ...BASE, httpStatus: '2xx', ownerFlag: true, nothingElseChanged: false },
  },
];

export function scenarioById(id: string): ScenarioSpec {
  const s = BEAM_SCENARIOS.find((x) => x.id === id);
  if (!s) throw new Error(`unknown scenario ${id}`);
  return s;
}
