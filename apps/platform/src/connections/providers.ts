import { probeBeam } from '@booq/beam';
// The probe subpath, not '@booq/line/server': that one also loads the rich menu renderer with its native module and fonts, which the console must not bundle.
import { probeLine } from '@booq/line/probe';
import type { BeamProbe, LineProbe } from './connections';

// The real LINE and Beam checks behind the two small interfaces of connections.ts (D167). Both read only: LINE's bot-info call
// and Beam's charge lookup, with the values typed in the same request. A result is a pass or a code; no key, token or answer
// text is passed on. The console never decrypts a stored secret (SR-03); a check of a stored connection is the worker's job.

export function createLineProbe(options: { baseUrl: string; timeoutMs: number; fetch?: typeof fetch }): LineProbe {
  return {
    async check(input) {
      const r = await probeLine(
        { channelAccessToken: input.channelAccessToken, loginChannelId: input.loginChannelId ?? '', liffId: input.liffId ?? '' },
        { baseUrl: options.baseUrl, timeoutMs: options.timeoutMs, ...(options.fetch ? { fetch: options.fetch } : {}) },
      );
      // The Login channel and LIFF checks are about ids not given in this request: they are only judged when given.
      const bad = r.checks.find((c) => !c.ok && !(c.code === 'missing' && ((c.key === 'login' && !input.loginChannelId) || (c.key === 'liff' && !input.liffId))));
      return bad ? { ok: false, code: `${bad.key}_${bad.code}` } : { ok: true };
    },
  };
}

export function createBeamProbe(options: { baseUrl?: string; fetch?: typeof fetch } = {}): BeamProbe {
  return {
    async check(input) {
      const r = await probeBeam({
        set: input.mode, merchantId: input.merchantId, apiKey: input.apiKey,
        ...(options.baseUrl ? { baseUrl: options.baseUrl } : {}), ...(options.fetch ? { fetch: options.fetch } : {}),
      });
      return r.ok ? { ok: true, merchantId: input.merchantId } : { ok: false, code: r.code };
    },
  };
}
