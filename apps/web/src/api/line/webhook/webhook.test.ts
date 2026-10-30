import { createHmac } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { hashInviteToken, serveWebhook } from '@booq/auth';
import { createDb, type Db } from '@booq/db';
import { createTestDatabase, type TestDatabase } from '@booq/db/testing';
import { generateKeyPair, writeSecret } from '@booq/secrets';
import { lineWebhookRoute } from './webhook';

// F02-T17 POST /api/webhooks/line/{token} (LINE-01-AC6 to AC9, AC14; design 5.4; D149): the signature is checked on the raw
// body before anything is read; follow and unfollow change only that club's person; every other event is ignored.
const A = '3f2b8f0e-7c1d-4a55-9d0a-1c2e3f4a5b6c';
const B = '9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d';
const OWNER_A = '11111111-1111-4111-8111-111111111111';
const P_A = '33333333-3333-4333-8333-333333333333';
const P_B = '55555555-5555-4555-8555-555555555555';
const LINE = 'U00000000000000000000000000000009';   // the same LINE id at both clubs
const TOKEN_A = 'token-for-club-a';
const SECRET_A = 'channel-secret-of-club-a';
const keys = generateKeyPair();
let tdb: TestDatabase;
let db: Db;

const sign = (raw: string, secret = SECRET_A) => createHmac('sha256', secret).update(raw).digest('base64');
const hook = () => serveWebhook(lineWebhookRoute({ db, privateKey: () => keys.privateKey }), { maxBodyBytes: 100_000, routeDeps: { hasFeature: async () => true } });
const post = (raw: string, sig: string | null, token = TOKEN_A) =>
  hook()(new Request('https://app.example/api/webhooks/line/' + token, { method: 'POST', body: raw, headers: { 'content-type': 'application/json', ...(sig ? { 'x-line-signature': sig } : {}) } }), { params: Promise.resolve({ token }) });
const events = (...e: unknown[]) => JSON.stringify({ destination: 'Uxxx', events: e });
const friend = async (club: string, user: string) => (await tdb.query(`select line_friend from public.app_user where club_id = $1 and id = $2`, [club, user])).rows[0].line_friend as boolean | null;
const follow = (type: 'follow' | 'unfollow', userId = LINE) => ({ type, mode: 'active', timestamp: 1, source: { type: 'user', userId }, replyToken: 'r' });

async function person(club: string, id: string, line: string, roles: string[]) {
  const c = await tdb.pool.connect();
  try {
    await c.query('begin');
    await c.query(`insert into public.app_user (club_id, id, line_user_id) values ($1,$2,$3)`, [club, id, line]);
    for (const r of roles) await c.query(`insert into public.app_user_role (club_id, user_id, role) values ($1,$2,$3)`, [club, id, r]);
    await c.query('commit');
  } finally {
    c.release();
  }
}

beforeEach(async () => {
  tdb = await createTestDatabase();
  await tdb.query(`insert into public.club (id, slug, name_th, name_en, status) values ($1,'a','ก','A','live'), ($2,'b','ข','B','live')`, [A, B]);
  await person(A, OWNER_A, 'L1', ['owner', 'player']);
  await person(A, P_A, LINE, ['player']);
  await person(B, P_B, LINE, ['player']);
  await tdb.query(`insert into public.line_connection (club_id, webhook_token_hash) values ($1,$2)`, [A, hashInviteToken(TOKEN_A)]);
  db = createDb({ connectionString: tdb.url, max: 2 });
  await db.withClubTx({ clubId: A, userId: OWNER_A, roles: ['owner', 'player'], source: 'admin' }, (tx) => writeSecret(tx, keys.publicKey, A, 'line_channel_secret', SECRET_A));
});
afterEach(async () => {
  await db.end();
  await tdb.close();
});

describe('signature (LINE-01 webhook, FA 5.3)', () => {
  it('a bad, missing or other-secret signature is 401 and changes nothing', async () => {
    const raw = events(follow('follow'));
    for (const sig of [sign(raw, 'wrong-secret'), 'not-base64!', '', null]) {
      const r = await post(raw, sig);
      expect(r.status, String(sig)).toBe(401);
    }
    expect(await friend(A, P_A)).toBeNull();
  });

  it('the signature covers the exact bytes: a changed body with the old signature is refused', async () => {
    const raw = events(follow('follow'));
    const sig = sign(raw);
    expect((await post(raw.replace('"mode":"active"', '"mode": "active"'), sig)).status).toBe(401);
    expect(await friend(A, P_A)).toBeNull();
  });

  it('an unknown token is 404 and a club with no channel secret stored is 401 (nothing can be verified)', async () => {
    const raw = events(follow('follow'));
    expect((await post(raw, sign(raw), 'no-such-token')).status).toBe(404);
    await tdb.query(`delete from public.club_secret where kind = 'line_channel_secret'`);
    expect((await post(raw, sign(raw))).status).toBe(401);
    expect(await friend(A, P_A)).toBeNull();
  });
});

describe('follow and unfollow (LINE-01-AC7, AC8, AC14)', () => {
  it('follow sets the friend flag of that club\'s person only; the same LINE id at another club is untouched', async () => {
    const raw = events(follow('follow'));
    expect((await post(raw, sign(raw))).status).toBe(200);
    expect(await friend(A, P_A)).toBe(true);
    expect(await friend(B, P_B)).toBeNull();
    expect((await tdb.query(`select line_friend_checked_at is not null as c from public.app_user where id = $1`, [P_A])).rows[0].c).toBe(true);
  });

  it('unfollow clears it, and a batch applies in order', async () => {
    const raw = events(follow('follow'), follow('unfollow'));
    expect((await post(raw, sign(raw))).status).toBe(200);
    expect(await friend(A, P_A)).toBe(false);
  });

  it('other events, other sources and a person who has not signed in are ignored without error', async () => {
    const raw = events(
      { type: 'message', source: { type: 'user', userId: LINE }, message: { type: 'text', text: 'hi' } },
      { type: 'follow', source: { type: 'group', groupId: 'G1' } },
      follow('follow', 'Uunknownperson0000000000000000000'),
      { type: 'follow' },
      'nonsense',
    );
    expect((await post(raw, sign(raw))).status).toBe(200);
    expect(await friend(A, P_A)).toBeNull();
  });

  it('an empty events list (the "Verify" call from the LINE console) is 200', async () => {
    const raw = events();
    expect((await post(raw, sign(raw))).status).toBe(200);
  });

  it('a signed body that is not JSON is 400 and changes nothing', async () => {
    const raw = '{nope';
    expect((await post(raw, sign(raw))).status).toBe(400);
  });
});
