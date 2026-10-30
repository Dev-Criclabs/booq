import { createHmac } from 'node:crypto';
import type { BeamEventName, WireFormat } from './types';

/**
 * Beam's documented webhook signing (https://docs.beamcheckout.com/webhook-authentication):
 *  1. the key is a base64 string; decode it to bytes;
 *  2. HMAC-SHA256 over the exact request body bytes;
 *  3. base64 encode the digest; it must equal the X-Beam-Signature header.
 * Also documented: header x-beam-event carries the event name.
 * NOT documented (so not simulated): a timestamp, a replay window, an event id.
 * Test vector from the docs is checked in tests/fakes/beam/wire.vector.ts.
 */
export class BeamHmacWire implements WireFormat {
  readonly name = 'beam-documented-hmac-sha256-base64';

  sign(rawBody: string, keyBase64: string, eventName: BeamEventName): Record<string, string> {
    return {
      'content-type': 'application/json',
      'x-beam-event': eventName,
      'x-beam-signature': hmacBase64(rawBody, keyBase64),
    };
  }
}

export function hmacBase64(rawBody: string, keyBase64: string): string {
  return createHmac('sha256', Buffer.from(keyBase64, 'base64')).update(Buffer.from(rawBody, 'utf8')).digest('base64');
}
