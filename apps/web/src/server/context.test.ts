import { describe, expect, it } from 'vitest';
import { readWebConfig } from './context';

// The web app's settings: required, no defaults, no value printed on failure.
const ENV = { DATABASE_URL: 'postgres://u:pw@h/db', WEB_SESSION_SECONDS: '3600', WEB_MAX_BODY_BYTES: '100000' };

describe('readWebConfig', () => {
  it('reads the required settings; import limits are optional and come as a pair', () => {
    expect(readWebConfig(ENV)).toEqual({ databaseUrl: ENV.DATABASE_URL, sessionSeconds: 3600, maxBodyBytes: 100000, importLimits: null, signInRateLimit: null });
    expect(readWebConfig({ ...ENV, WEB_SIGNIN_RATE_LIMIT: '10', WEB_SIGNIN_RATE_WINDOW_SECONDS: '60' }).signInRateLimit).toEqual({ limit: 10, windowSeconds: 60 });
    expect(readWebConfig({ ...ENV, IMPORT_MAX_ROWS: '5000', IMPORT_STAGING_HOURS: '24' }).importLimits).toEqual({ maxRows: 5000, stagingHours: 24 });
  });
  it('names the missing settings and never prints a value', () => {
    let message = '';
    try {
      readWebConfig({ DATABASE_URL: 'postgres://secret-user:secret-pw@h/db' });
    } catch (e) {
      message = (e as Error).message;
    }
    expect(message).toContain('WEB_SESSION_SECONDS');
    expect(message).toContain('WEB_MAX_BODY_BYTES');
    expect(message).not.toContain('secret');
  });
  it.each([
    [{ WEB_SESSION_SECONDS: '0' }],
    [{ WEB_MAX_BODY_BYTES: '-1' }],
    [{ WEB_SESSION_SECONDS: 'abc' }],
    [{ IMPORT_MAX_ROWS: '100' }],
    [{ IMPORT_STAGING_HOURS: '24' }],
    [{ IMPORT_MAX_ROWS: '0', IMPORT_STAGING_HOURS: '24' }],
    [{ WEB_SIGNIN_RATE_LIMIT: '10' }],
    [{ WEB_SIGNIN_RATE_WINDOW_SECONDS: '60' }],
    [{ WEB_SIGNIN_RATE_LIMIT: '0', WEB_SIGNIN_RATE_WINDOW_SECONDS: '60' }],
  ])('refuses %j', (extra) => {
    expect(() => readWebConfig({ ...ENV, ...extra })).toThrow();
  });
});
