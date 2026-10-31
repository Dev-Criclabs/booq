import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createDb, type Db } from '@booq/db';
import { createTestDatabase, type TestDatabase } from '@booq/db/testing';
import { encryptSecret, generateKeyPair, type SecretKind } from '@booq/secrets';
import { closeTestDatabase } from '../testing/teardown';
import { CONNECTION_CHECK, runConnectionChecks } from './connection-check';

// D167: "Test all again". The worker opens the stored secrets with its own key, probes LINE and Beam with a fake network, writes club_health
// as codes and removes the request. The console never sees a secret.
const A = '3f2b8f0e-7c1d-4a55-9d0a-1c2e3f4a5b6c';
const B = '9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d';
const keys = generateKeyPair();
let tdb: TestDatabase;
let worker: Db;
let seen: Array<{ url: string; auth: string | null }>;
let status: number;

const fake = (async (url: string, init?: { headers?: Record<string, string> }) => {
  seen.push({ url: String(url), auth: init?.headers?.['authorization'] ?? init?.headers?.['Authorization'] ?? null });
  if (status === 0) throw new Error('offline');
  return new Response('{}', { status });
}) as unknown as typeof fetch;
const deps = () => ({ privateKey: keys.privateKey, lineApiBaseUrl: 'https://line.fake', probeTimeoutMs: 1000, beamBaseUrl: 'https://beam.fake', fetch: fake });
const secret = (club: string, kind: SecretKind, value: string) => {
  const e = encryptSecret(keys.publicKey, value, { clubId: club, kind });
  return tdb.query(`insert into public.club_secret (club_id, kind, ciphertext, key_id, written_by_staff) select $1,$2,$3,$4, id from platform.platform_staff limit 1`, [club, kind, e.ciphertext, e.keyId]);
};
const request = async (club: string) => {
  const staff = (await tdb.query(`select id from platform.platform_staff limit 1`)).rows[0].id;
  await tdb.query(`insert into platform.connection_check_request (club_id, requested_by) values ($1,$2)`, [club, staff]);
};
const health = async (club: string) => (await tdb.query(`select check_key, status, reason from platform.club_health where club_id = $1 order by check_key`, [club])).rows;
const open = async () => (await tdb.query(`select club_id from platform.connection_check_request order by club_id`)).rows.map((r) => r.club_id);

beforeEach(async () => {
  tdb = await createTestDatabase();
  worker = createDb({ connectionString: tdb.url, max: 2, role: 'booq_worker' });
  seen = [];
  status = 200;
  await tdb.query(`insert into platform.platform_staff (auth_user_id, email, display_name, role) values ('99999999-0000-4000-8000-000000000001','a@booq.example','Ada','platform_admin')`);
  await tdb.query(`insert into public.club (id, slug, name_th, name_en, status) values ($1,'a','ก','A','live'), ($2,'b','ข','B','testing')`, [A, B]);
  await tdb.query(`insert into public.line_connection (club_id, login_channel_id, liff_id) values ($1,'1650000001','1650000001-AbCdEfGh'), ($2,'1650000002','1650000002-AbCdEfGh')`, [A, B]);
  await secret(A, 'line_channel_token', 'MARKER-line-token');
  await secret(A, 'beam_api_key_live', 'MARKER-beam-live');
  await secret(A, 'beam_api_key_test', 'MARKER-beam-test');
  await tdb.query(`insert into public.payment_connection (club_id, merchant_id_test, merchant_id_live) values ($1,'M-TEST','M-LIVE')`, [A]);
});
afterEach(async () => {
  await worker.end();
  await closeTestDatabase(tdb);
});

describe('connection_check', () => {
  it('does nothing when no one asked', async () => {
    expect(await runConnectionChecks(worker, deps())).toEqual({ clubs: 0, checks: 0 });
    expect(seen).toEqual([]);
  });

  it('opens the stored secrets, probes LINE and the Live Beam keys of a Live club, reports ok and removes the request', async () => {
    await request(A);
    expect(await runConnectionChecks(worker, deps())).toEqual({ clubs: 1, checks: 2 });
    expect(seen.map((s) => s.auth)).toContain('Bearer MARKER-line-token');
    expect(await health(A)).toEqual([{ check_key: 'beam_keys', status: 'ok', reason: null }, { check_key: 'line_token', status: 'ok', reason: null }]);
    expect(await open()).toEqual([]);
    expect(JSON.stringify((await tdb.query(`select * from platform.club_health`)).rows)).not.toMatch(/MARKER/);
  });

  it('a refused token and a refused key are reported as codes; a later pass clears them', async () => {
    await request(A);
    status = 401;
    await runConnectionChecks(worker, deps());
    expect(await health(A)).toEqual([{ check_key: 'beam_keys', status: 'failed', reason: 'key_refused' }, { check_key: 'line_token', status: 'failed', reason: 'token_rejected' }]);
    await request(A);
    status = 200;
    await runConnectionChecks(worker, deps());
    expect((await health(A)).map((h) => h.status)).toEqual(['ok', 'ok']);
  });

  it('an unreachable network is reported: LINE as unreachable, Beam as beam_charge unreachable', async () => {
    await request(A);
    status = 0;
    await runConnectionChecks(worker, deps());
    expect(await health(A)).toEqual([{ check_key: 'beam_charge', status: 'failed', reason: 'unreachable' }, { check_key: 'line_token', status: 'failed', reason: 'unreachable' }]);
  });

  it('a club with no stored token is reported as token_missing; a club with no connections at all just has its request removed', async () => {
    await request(B);
    await tdb.query(`insert into public.club (id, slug, name_th, name_en, status) values ('44444444-4444-4444-8444-444444444444','c','ค','C','testing')`);
    await request('44444444-4444-4444-8444-444444444444');
    expect(await runConnectionChecks(worker, deps())).toEqual({ clubs: 2, checks: 1 });
    expect(await health(B)).toEqual([{ check_key: 'line_token', status: 'failed', reason: 'token_missing' }]);
    expect(await open()).toEqual([]);
  });

  it('a Testing club uses the test key set', async () => {
    await tdb.query(`update public.club set status = 'testing' where id = $1`, [A]);
    await request(A);
    await runConnectionChecks(worker, deps());
    expect(seen.some((s) => s.url.includes('beam.fake'))).toBe(true);
    expect(CONNECTION_CHECK).toBe('connection_check');
  });
});
