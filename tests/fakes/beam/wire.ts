import { createHmac } from 'node:crypto';
import type { WireFormat } from './types';

/**
 * PLACEHOLDER wire format: HMAC-SHA256 over `${timestamp}.${body}`, hex, in two made-up headers.
 * It is NOT Beam's real scheme (Q-31). It exists so the fake can produce correct and incorrect
 * signatures today. Replace this class when Beam's sandbox documentation is available; no scenario changes.
 */
export class PlaceholderHmacWire implements WireFormat {
  readonly name = 'placeholder-hmac-sha256';
  readonly replayWindowSeconds = 300;

  sign(rawBody: string, secret: string, timestampSeconds: number): Record<string, string> {
    const mac = createHmac('sha256', secret).update(`${timestampSeconds}.${rawBody}`).digest('hex');
    return {
      'x-fake-beam-timestamp': String(timestampSeconds),
      'x-fake-beam-signature': mac,
    };
  }
}
