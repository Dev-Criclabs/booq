import { describe, expect, it } from 'vitest';
import { createBeamProbe, createLineProbe } from './providers';

// D167: the real checks behind the connection interfaces, with a fake network. Codes only; the typed key never comes back.
const reply = (status: number) => (async () => new Response('{"message":"LINE text"}', { status })) as unknown as typeof fetch;
const down = (async () => { throw new Error('offline'); }) as unknown as typeof fetch;
const LINE = { baseUrl: 'https://line.fake', timeoutMs: 1000 };
const TOKEN = 'MARKER-token-1234';

describe('LINE check', () => {
  it('passes when LINE accepts the token; the ids are judged only when given', async () => {
    const probe = createLineProbe({ ...LINE, fetch: reply(200) });
    expect(await probe.check({ channelAccessToken: TOKEN })).toEqual({ ok: true });
    expect(await probe.check({ channelAccessToken: TOKEN, loginChannelId: '1650000001', liffId: '1650000001-AbCdEfGh' })).toEqual({ ok: true });
  });
  it('says which check failed, in a code: token refused, LINE unreachable, a bad id', async () => {
    expect(await createLineProbe({ ...LINE, fetch: reply(401) }).check({ channelAccessToken: TOKEN })).toEqual({ ok: false, code: 'messaging_api_token_rejected' });
    expect(await createLineProbe({ ...LINE, fetch: down }).check({ channelAccessToken: TOKEN })).toEqual({ ok: false, code: 'messaging_api_unreachable' });
    expect(await createLineProbe({ ...LINE, fetch: reply(200) }).check({ channelAccessToken: TOKEN, loginChannelId: '123' })).toEqual({ ok: false, code: 'login_invalid_format' });
    expect(await createLineProbe({ ...LINE, fetch: reply(200) }).check({ channelAccessToken: TOKEN, loginChannelId: '1650000001', liffId: '1650000009-AbCdEfGh' })).toEqual({ ok: false, code: 'liff_not_in_login_channel' });
  });
  it('never returns the token or LINE\'s answer text', async () => {
    const r = JSON.stringify(await createLineProbe({ ...LINE, fetch: reply(401) }).check({ channelAccessToken: TOKEN }));
    expect(r).not.toMatch(/MARKER|LINE text/);
  });
});

describe('Beam check', () => {
  const input = { apiKey: 'MARKER-beam-key', merchantId: 'M-1', mode: 'test' as const };
  it('a key Beam accepts passes with the merchant given; a refused key and an outage give codes', async () => {
    expect(await createBeamProbe({ baseUrl: 'https://beam.fake', fetch: reply(404) }).check(input)).toEqual({ ok: true, merchantId: 'M-1' });
    expect(await createBeamProbe({ baseUrl: 'https://beam.fake', fetch: reply(401) }).check(input)).toEqual({ ok: false, code: 'key_refused' });
    expect(await createBeamProbe({ baseUrl: 'https://beam.fake', fetch: down }).check(input)).toEqual({ ok: false, code: 'unreachable' });
  });
  it('never returns the key', async () => {
    expect(JSON.stringify(await createBeamProbe({ baseUrl: 'https://beam.fake', fetch: reply(401) }).check(input))).not.toMatch(/MARKER/);
  });
});
