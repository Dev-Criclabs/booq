import { describe, expect, it, vi } from 'vitest';
import { continueKey, missing, submitProfile, type ProfileInput } from './profile-setup';

// C2 submit (F02-T20): AUTH-02-AC1 to AC6.

const next = '/c/hunter/checkout?court=2&date=2027-01-09&from=18:00&to=19:00';
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
function input(over: Partial<ProfileInput>, reply: () => Promise<Response> | Response = () => json(200, { state: 'active' })) {
  const f = vi.fn(async () => reply()) as unknown as typeof fetch;
  return { f, input: { slug: 'hunter', next, fullName: 'Ploy Srisuk', phone: '081 234 5678', consent: true, language: 'th' as const, noticeVersion: 'v3' as string | null, fetch: f, ...over } };
}

describe('C2 submit', () => {
  it('AUTH-02-AC1, AC4: sends only full name, phone, consent, notice version and language', async () => {
    const s = input({});
    expect(await submitProfile(s.input)).toEqual({ kind: 'go', url: next });
    const [url, init] = (s.f as unknown as { mock: { calls: [string, RequestInit][] } }).mock.calls[0]!;
    expect(url).toBe('/api/c/hunter/auth/profile');
    expect(JSON.parse(init.body as string)).toEqual({ fullName: 'Ploy Srisuk', phone: '081 234 5678', consent: true, noticeVersion: 'v3', language: 'th' });
  });

  it('AUTH-02-AC3: without consent nothing is sent and the screen says what is missing', async () => {
    const s = input({ consent: false });
    expect(await submitProfile(s.input)).toEqual({ kind: 'fields', errors: { consent: 'P-new.profile_consent_required' } });
    expect(s.f).not.toHaveBeenCalled();
  });

  it('AUTH-02-AC2: missing name and phone are shown before sending', () => {
    expect(missing({ fullName: ' ', phone: '', consent: true })).toEqual({ fullName: 'P-new.profile_name_missing', phone: 'P-new.profile_phone_missing' });
  });

  it('AUTH-02-AC2: server field refusals map to keys', async () => {
    const s = input({}, () => json(400, { code: 'invalid', fields: { fullName: 'name_too_long', phone: 'phone_invalid' } }));
    expect(await submitProfile(s.input)).toEqual({ kind: 'fields', errors: { fullName: 'P-new.profile_name_too_long', phone: 'P-new.profile_phone_invalid' } });
    const c = input({}, () => json(400, { code: 'consent_required' }));
    expect(await submitProfile(c.input)).toEqual({ kind: 'fields', errors: { consent: 'P-new.profile_consent_required' } });
  });

  it('AUTH-02-AC5, AC6: an expired pending sign up signs in again; an existing player carries on with the choice', async () => {
    expect(await submitProfile(input({}, () => json(401, { code: 'unauthenticated' })).input)).toEqual({ kind: 'go', url: `/c/hunter/sign-in?next=${encodeURIComponent(next)}` });
    expect(await submitProfile(input({}, () => json(409, { code: 'not_pending' })).input)).toEqual({ kind: 'go', url: next });
  });

  it('offline keeps the form and shows P-0327', async () => {
    expect(await submitProfile(input({}, () => Promise.reject(new TypeError('net'))).input)).toEqual({ kind: 'error', key: 'P-0327' });
  });

  it('the button reads Continue to payment only on the way to checkout', () => {
    expect(continueKey(next)).toBe('P-0016');
    expect(continueKey('/c/hunter/bookings')).toBe('P-0057');
  });
});

describe('notice version (D152, AUTH-02-AC4)', () => {
  it('sends the current release from the club config, and nothing when none is published', async () => {
    const none = input({ noticeVersion: null });
    expect(await submitProfile(none.input)).toEqual({ kind: 'error', key: 'P-new.notice_unavailable' });
    expect(none.f).not.toHaveBeenCalled();
  });

  it('a release published meanwhile asks for consent again; no release is the unavailable message', async () => {
    expect(await submitProfile(input({}, () => json(409, { code: 'notice_version_stale' })).input)).toEqual({ kind: 'stale' });
    expect(await submitProfile(input({}, () => json(409, { code: 'no_notice' })).input)).toEqual({ kind: 'error', key: 'P-new.notice_unavailable' });
  });
});
