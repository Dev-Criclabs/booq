import { createDb } from '@booq/db';
import { createLineVerifier, createRedactingLogger, type ServeSource, type WebhookSource } from '@booq/auth';
import { beamGateway } from '@booq/beam';
import { loadDecryptKey } from '@booq/secrets';
import { lineWebhookRoute } from '../api/line/webhook/webhook';
import { beamWebhookRoute } from '../api/payments/webhook';
import { createWebTable, readWebConfig } from './context';

// The running app's wiring, built once on the first request and shared by every route handler
// (one database pool). Settings come from the environment; none has a default. The LINE API
// address is LINE's own and not a setting.
const LINE_API = 'https://api.line.me';

let built: ServeSource | undefined;

export function webSource(): ServeSource {
  if (built) return built;
  const { databaseUrl, ...config } = readWebConfig(process.env);
  const db = createDb({ connectionString: databaseUrl });
  built = createWebTable({ db, verifier: createLineVerifier({ baseUrl: LINE_API, now: () => new Date() }), now: () => new Date(), config });
  return built;
}

let builtWebhook: WebhookSource | undefined;

/** The LINE webhook (POST /api/webhooks/line/{token}): same database and body limit as the club routes, the decryption key read when a call arrives. */
export function lineWebhookSource(): WebhookSource {
  if (builtWebhook) return builtWebhook;
  const { databaseUrl, maxBodyBytes } = readWebConfig(process.env);
  const db = createDb({ connectionString: databaseUrl });
  builtWebhook = { hook: lineWebhookRoute({ db, privateKey: () => loadDecryptKey() }), deps: { routeDeps: { hasFeature: async () => true }, maxBodyBytes } };
  return builtWebhook;
}

let builtBeamWebhook: WebhookSource | undefined;

/** The Beam webhook (POST /api/webhooks/beam/{token}, F05-T08): the web role finds the club by token; the payment is
 *  applied as the worker (apply_payment is the worker's). P1 alerts (a kind and the club) go to the redacted log. */
export function beamWebhookSource(): WebhookSource {
  if (builtBeamWebhook) return builtBeamWebhook;
  const { databaseUrl, maxBodyBytes } = readWebConfig(process.env);
  const db = createDb({ connectionString: databaseUrl });
  const worker = createDb({ connectionString: databaseUrl, role: 'booq_worker' });
  const log = createRedactingLogger((line) => process.stderr.write(`${line}\n`));
  builtBeamWebhook = {
    hook: beamWebhookRoute({
      db,
      worker,
      privateKey: () => loadDecryptKey(),
      gateway: beamGateway,
      alerts: { p1: (kind, clubId) => log.error('p1_alert', { source: 'beam_webhook', kind, clubId }) },
    }),
    deps: { routeDeps: { hasFeature: async () => true }, maxBodyBytes },
  };
  return builtBeamWebhook;
}
