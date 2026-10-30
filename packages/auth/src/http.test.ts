import { describe, expect, it } from 'vitest';
import { callerOf, cleanParams, fail, matchPath, readJsonBody } from './http';

// The helpers both HTTP transports share.
describe('matchPath', () => {
  it('binds :params and compares the rest exactly', () => {
    expect(matchPath(['clubs', ':id', 'status'], ['clubs', 'abc', 'status'])).toEqual({ id: 'abc' });
    expect(matchPath(['clubs', ':id'], ['clubs'])).toBeNull();
    expect(matchPath(['clubs'], ['pubs'])).toBeNull();
    expect(matchPath(['clubs', ':id'], ['clubs', 'a%20b'])).toEqual({ id: 'a b' });
  });
  it('a malformed escape does not match, instead of throwing', () => {
    expect(matchPath(['clubs', ':id'], ['clubs', '%E0%A4%A'])).toBeNull();
  });
});

describe('readJsonBody', () => {
  const req = (body: string | undefined, type = 'application/json') => new Request('https://x.example/', { method: 'POST', ...(body === undefined ? {} : { body }), headers: type ? { 'content-type': type } : {} });
  it('returns the object, or the response to send', async () => {
    expect(await readJsonBody(req('{"a":1}'), 100)).toEqual({ a: 1 });
    expect(await readJsonBody(req(''), 100)).toEqual({});
    const bad = await readJsonBody(req('{nope'), 100);
    expect(bad instanceof Response && bad.status).toBe(400);
    const arr = await readJsonBody(req('[1]'), 100);
    expect(arr instanceof Response && arr.status).toBe(400);
    const big = await readJsonBody(req(JSON.stringify({ pad: 'x'.repeat(200) })), 50);
    expect(big instanceof Response && big.status).toBe(413);
    const type = await readJsonBody(req('a=b', 'application/x-www-form-urlencoded'), 100);
    expect(type instanceof Response && type.status).toBe(415);
  });
});

describe('answers', () => {
  it('fail carries only plain, short params', async () => {
    expect(await fail(409, 'limit_reached', { hours: 4, obj: { a: 1 } }).json()).toEqual({ code: 'limit_reached', params: { hours: 4 } });
    expect(cleanParams({ a: 'x'.repeat(300) })).toBeUndefined();
  });
  it('callerOf prefers x-real-ip, then the first forwarded address', () => {
    expect(callerOf(new Request('https://x.example/', { headers: { 'x-real-ip': '1.1.1.1', 'x-forwarded-for': '2.2.2.2' } }))).toBe('1.1.1.1');
    expect(callerOf(new Request('https://x.example/', { headers: { 'x-forwarded-for': ' 2.2.2.2 , 3.3.3.3' } }))).toBe('2.2.2.2');
    expect(callerOf(new Request('https://x.example/'))).toBe('unknown');
  });
});
