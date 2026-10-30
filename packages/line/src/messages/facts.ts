// The display facts of one message, read at send time by app.message_facts (migration 0611) from the ids in the outbox
// row's params, in the club's context. The outbox holds ids only (CC-3); names and amounts are looked up here, when the
// message is built, so they are never stored with it.

export interface MessageHour {
  bookingId: string;
  startAt: string;
  endAt: string;
  /** The court's number or label, without the word "Court" (locales/README.md `{court}`). */
  court: string | null;
  coachName: string | null;
  type: string;
}

export interface MessageFacts {
  clubName: { th: string; en: string };
  /** The recipient's given name, or null when the record has none. */
  firstName: string | null;
  /** The booked hours of the order or booking in params, in start order. */
  hours: MessageHour[];
  moneySatang: number | null;
  walletSatang: number | null;
  creditValueSatang: number | null;
  /** How the money part was paid: beam (PromptPay) or cash; null when no money was due. */
  paidBy: 'beam' | 'cash' | null;
  /** The order's receipt number; a Testing club's carries the test series (F13, PLAT-07). */
  receiptNumber: string | null;
  amountSatang: number | null;
  coachName: string | null;
  package: { expiresAt: string; creditsLeft: number } | null;
  /** params.status, for example a leave decision. */
  status: string | null;
  /** The club's waitlist claim time, when the club has set it. */
  claimMinutes: number | null;
  /** The reminder kind's hours before start (app.message_kinds.hours_before). */
  hoursBefore: number | null;
}
