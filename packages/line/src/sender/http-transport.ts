import type { LineTransport, PushInput, PushResult } from './types';

// The Messaging API push (F10-T09; F10 design 5.2 steps 5 and 6; FA 5.3, 5.6). One POST per message row, with the
// club's own channel access token and the row's stable X-Line-Retry-Key, so a retry after a timeout cannot double
// send. The answer is mapped to what the sender does next; LINE's message text is never passed on (it is not a code
// and could carry data). Push to a non friend is answered 200 and simply not delivered (D9, FA 5.3).

export interface LineHttpTransportOptions {
  /** https://api.line.me in production; the fake LINE's URL in tests. */
  baseUrl: string;
  /** How long one push may take before it is treated as a timeout and retried. */
  timeoutMs: number;
  fetch?: typeof fetch;
}

export function createLineHttpTransport(options: LineHttpTransportOptions): LineTransport {
  // i18n-ignore configuration error at start up, never shown to anyone
  if (!options.baseUrl) throw new Error('createLineHttpTransport: a base URL is required');
  // i18n-ignore configuration error at start up, never shown to anyone
  if (!Number.isFinite(options.timeoutMs) || options.timeoutMs <= 0) throw new Error('createLineHttpTransport: a positive timeout is required');
  const base = options.baseUrl.replace(/\/+$/, '');
  const doFetch = options.fetch ?? fetch;

  return {
    async push(input: PushInput): Promise<PushResult> {
      let res: Response;
      try {
        res = await doFetch(`${base}/v2/bot/message/push`, {
          method: 'POST',
          headers: {
            authorization: `Bearer ${input.channelAccessToken}`,
            'content-type': 'application/json',
            'x-line-retry-key': input.retryKey,
          },
          body: JSON.stringify({ to: input.to, messages: input.messages }),
          signal: AbortSignal.timeout(options.timeoutMs),
        });
      } catch (error) {
        const timedOut = error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError');
        return { ok: false, outcome: 'retry', status: 0, code: timedOut ? 'timeout' : 'network' };
      }
      const status = res.status;
      const text = await res.text().catch(() => '');
      if (status === 200) return { ok: true };
      // The retry key was already accepted: the first attempt went through.
      if (status === 409) return { ok: true };
      if (status === 401 || status === 403) return { ok: false, outcome: 'token', status, code: `http_${status}` };
      if (status === 429) {
        // FA 5.6 step 4: "You have reached your monthly limit." is the cap; any other 429 is a rate limit.
        return /monthly limit/i.test(text)
          ? { ok: false, outcome: 'cap', status, code: 'cap' }
          : { ok: false, outcome: 'retry', status, code: 'rate_limited' };
      }
      if (status >= 500) return { ok: false, outcome: 'retry', status, code: `http_${status}` };
      return { ok: false, outcome: 'failed', status, code: `http_${status}` };
    },
  };
}
