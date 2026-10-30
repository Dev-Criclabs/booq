import { createDb } from '@booq/db';
import { createLineVerifier, type ServeSource } from '@booq/auth';
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
