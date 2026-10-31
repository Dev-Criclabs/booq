import type { Db, Tx } from '@booq/db';
import { probeBeam } from '@booq/beam';
import { probeLine } from '@booq/line/probe';
import { readSecret } from '@booq/secrets';
import { recordTaskRun } from '../heartbeat';

// connection_check (D167, PLAT-02-AC8): "Test all again" in the console. BOOQ staff ask (platform.request_connection_check); the console
// itself cannot open a stored secret (SR-03), so this task does: for each club with a request, in that club's context, it reads the
// club's LINE token and the Beam key of the set in use with the worker's private key, runs probeLine and probeBeam, reports each result
// to club_health by app.report_connection_check (a code, never a key) and removes the request. Polled on the outbox sender's tick.
//   LINE   a stored LINE connection is checked; the token result is line_token (token_rejected, unreachable, http_NNN, token_missing);
//          a Login channel or LIFF id of the wrong form has no health row of its own (it is a setup fault, not an outage).
//   Beam   the key set follows the club: Live and Paused clubs use the live keys, Draft and Testing the test keys.
export const CONNECTION_CHECK = 'connection_check';

const SYSTEM_CONTEXT = { clubId: '00000000-0000-0000-0000-000000000000', userId: null, roles: [] } as const;
const DEFAULT_CLUBS = 20;

export interface ConnectionCheckDeps {
  /** The PEM private key that opens club secrets (loadDecryptKey from @booq/secrets). */
  privateKey: string;
  lineApiBaseUrl: string;
  probeTimeoutMs: number;
  /** For tests: the fake network. */
  fetch?: typeof fetch;
  /** Beam's address, for tests only; production uses the hosts of @booq/beam. */
  beamBaseUrl?: string;
  clubs?: number;
}

export interface ConnectionCheckResult {
  clubs: number;
  checks: number;
}

const report = (tx: Tx, check: 'line_token' | 'beam_keys' | 'beam_charge', reason: string | null) => tx.query('select app.report_connection_check($1, $2)', [check, reason]);

interface Facts {
  status: string;
  line: { login_channel_id: string | null; liff_id: string | null } | null;
  payments: { merchant_id_test: string | null; merchant_id_live: string | null } | null;
}

async function checkLine(tx: Tx, clubId: string, facts: Facts, deps: ConnectionCheckDeps): Promise<number> {
  const row = facts.line;
  if (!row) return 0;
  const token = await readSecret(tx, deps.privateKey, clubId, 'line_channel_token', 'worker');
  if (token === null) {
    await report(tx, 'line_token', 'token_missing');
    return 1;
  }
  const r = await probeLine(
    { channelAccessToken: token, loginChannelId: row.login_channel_id ?? '', liffId: row.liff_id ?? '' },
    { baseUrl: deps.lineApiBaseUrl, timeoutMs: deps.probeTimeoutMs, ...(deps.fetch ? { fetch: deps.fetch } : {}) },
  );
  const api = r.checks.find((c) => c.key === 'messaging_api');
  await report(tx, 'line_token', api?.ok ? null : (api?.code ?? 'unexpected').replace(/[^a-z0-9_]/g, '_').slice(0, 40));
  return 1;
}

async function checkBeam(tx: Tx, clubId: string, facts: Facts, deps: ConnectionCheckDeps): Promise<number> {
  const set = facts.status === 'live' || facts.status === 'paused' ? 'live' : 'test';
  if (!facts.payments) return 0;
  const merchant = set === 'live' ? facts.payments.merchant_id_live : facts.payments.merchant_id_test;
  const apiKey = await readSecret(tx, deps.privateKey, clubId, set === 'live' ? 'beam_api_key_live' : 'beam_api_key_test', 'worker');
  const hmacKey = await readSecret(tx, deps.privateKey, clubId, set === 'live' ? 'beam_hmac_key_live' : 'beam_hmac_key_test', 'worker');
  const r = await probeBeam({
    set, merchantId: merchant ?? '', apiKey: apiKey ?? '', ...(hmacKey ? { hmacKey } : {}),
    ...(deps.beamBaseUrl ? { baseUrl: deps.beamBaseUrl } : {}), ...(deps.fetch ? { fetch: deps.fetch } : {}),
  });
  if (r.ok) await report(tx, 'beam_keys', null);
  else if (r.code === 'not_configured') await report(tx, 'beam_keys', 'keys_missing');
  else if (r.code === 'key_refused') await report(tx, 'beam_keys', 'key_refused');
  else if (r.code === 'unreachable') await report(tx, 'beam_charge', 'unreachable');
  else return 1; // an unexpected answer or a malformed webhook key: no health row of its own
  return 1;
}

/** `db` must connect as booq_worker. */
export async function runConnectionChecks(db: Db, deps: ConnectionCheckDeps): Promise<ConnectionCheckResult> {
  return recordTaskRun(db, CONNECTION_CHECK, async () => {
    const clubs = (await db.withClubTx(SYSTEM_CONTEXT, (tx) => tx.query<{ id: string }>('select id from app.due_connection_check_clubs($1) as t(id)', [deps.clubs ?? DEFAULT_CLUBS]))).rows.map((r) => r.id);
    const result: ConnectionCheckResult = { clubs: clubs.length, checks: 0 };
    for (const clubId of clubs) {
      await db.withClubTx({ clubId, userId: null, roles: [], source: 'job', actorLabel: CONNECTION_CHECK }, async (tx) => {
        const facts = (await tx.query<{ f: Facts }>('select app.connection_check_facts() as f')).rows[0]!.f;
        result.checks += await checkLine(tx, clubId, facts, deps);
        result.checks += await checkBeam(tx, clubId, facts, deps);
        await tx.query('select app.finish_connection_check()');
      });
    }
    return result;
  });
}
