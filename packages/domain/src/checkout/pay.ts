import type { Tx } from '../../../db/src/tx';
import { CheckoutError } from './errors';
import { parseQuoteRequest, quoteFor, type QuoteRequest, type QuoteSources, type QuoteView } from './quote';

// F04-T12a: POST /checkout/pay, steps 1 and 2 (design 4.5; R4-AC9, R8-AC1, R7-AC1, D63). The gate (club
// status, the coach-at-checkout switch) runs in quoteFor; then the order is priced again from the prices of
// this moment. A hash different from the one the player saw creates nothing: the new quote goes back and the
// player confirms again. The limit on repeated Pay taps (D61, F03 4.8) is counted inside reserve_court at the
// claim (F04-T12b), where its refusal too_many_attempts is raised; it is not repeated here.

export interface PayRequest {
  choice: QuoteRequest;
  /** The quote_hash of the quote the player confirmed. */
  quoteHash: string;
}

export type PreparedPay = { kind: 'ready'; quote: QuoteView } | { kind: 'price_changed'; quote: QuoteView };

const HASH = /^[0-9a-f]{64}$/;

/** The Pay body: the same choices as the quote, and the hash of the quote shown. No amount is read (CC-2). */
export function parsePayRequest(body: unknown): PayRequest {
  const hash = ((body ?? {}) as Record<string, unknown>)['quoteHash'];
  if (typeof hash !== 'string' || !HASH.test(hash.toLowerCase())) throw new CheckoutError('bad_input');
  return { choice: parseQuoteRequest(body), quoteHash: hash.toLowerCase() };
}

/** Gate and reprice, inside the Pay transaction. Writes nothing. */
export async function preparePay(tx: Tx, customerId: string, req: PayRequest, sources: QuoteSources): Promise<PreparedPay> {
  const quote = await quoteFor(tx, customerId, req.choice, sources);
  return quote.quoteHash === req.quoteHash ? { kind: 'ready', quote } : { kind: 'price_changed', quote };
}
