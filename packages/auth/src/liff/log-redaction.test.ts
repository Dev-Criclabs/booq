import { describe, expect, it } from 'vitest';
import { createRedactingLogger, REDACTED } from './log-redaction';

// F02-T03 (LINE-01-AC13): the token, any access token and the Authorization header
// never reach a log line.
const ID_TOKEN = 'eyJhbGciOiJFUzI1NiJ9.eyJzdWIiOiJVMTIzIn0.c2lnbmF0dXJl';
const ACCESS = 'AccessTokenValue-9f8e7d6c5b4a';
const AUTH = 'Bearer SuperSecretBearerValue-123';

function capture() {
  const lines: string[] = [];
  return { lines, log: createRedactingLogger((line) => lines.push(line)) };
}

describe('log redaction (F02-T03, LINE-01-AC13)', () => {
  it('a request carrying all three secrets produces no line containing any of them', () => {
    const { lines, log } = capture();
    log.info('auth session', {
      body: { idToken: ID_TOKEN, clubSlug: 'hunter' },
      query: { access_token: ACCESS },
      headers: { Authorization: AUTH, 'content-type': 'application/json' },
    });
    const all = lines.join('\n');
    for (const secret of [ID_TOKEN, ACCESS, 'SuperSecretBearerValue-123']) expect(all).not.toContain(secret);
    expect(all).toContain(REDACTED);
    expect(all).toContain('hunter'); // other fields survive
  });

  it.each(['idToken', 'id_token', 'IDTOKEN', 'access_token', 'accessToken', 'authorization', 'AUTHORIZATION'])(
    'redacts the key %s at any depth, including inside arrays',
    (key) => {
      const { lines, log } = capture();
      log.warn('x', { a: [{ b: { [key]: 'leak-me-please' } }] });
      expect(lines.join('')).not.toContain('leak-me-please');
    },
  );

  it('scrubs a token pasted into a message or an error', () => {
    const { lines, log } = capture();
    log.error(`verify failed for ${ID_TOKEN} with header ${AUTH}`, { err: new Error(`bad ${ACCESS}`) });
    const all = lines.join('\n');
    expect(all).not.toContain(ID_TOKEN);
    expect(all).not.toContain('SuperSecretBearerValue-123');
  });

  it('scrubs a token inside a URL query string', () => {
    const { lines, log } = capture();
    log.info('GET', { url: `/cb?code=1&access_token=${ACCESS}&state=s` });
    expect(lines.join('')).not.toContain(ACCESS);
  });

  it('survives circular references and does not mutate its input', () => {
    const { lines, log } = capture();
    const input: Record<string, unknown> = { idToken: ID_TOKEN };
    input.self = input;
    log.info('loop', input);
    expect(input.idToken).toBe(ID_TOKEN);
    expect(lines.join('')).not.toContain(ID_TOKEN);
  });
});
