import { serveWebhook } from '@booq/auth';
import { lineWebhookSource } from '../../../../../server/runtime';

// LINE calls this with the club's webhook token in the path (F02 design 5.4). Not under a club address: the token selects the
// club, the signature on the raw body authenticates the call. See apps/web/src/api/line-webhook/webhook.ts.
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const POST = serveWebhook(lineWebhookSource);
