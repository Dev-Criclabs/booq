import { serveWebhook } from '@booq/auth';
import { beamWebhookSource } from '../../../../../server/runtime';

// Beam calls this with the club's webhook token for one key set in the path (F05 design 5.3). Not under a club address:
// the token selects the club and the set, the signature on the raw body authenticates the call. See
// apps/web/src/api/payments/webhook.ts.
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const POST = serveWebhook(beamWebhookSource);
