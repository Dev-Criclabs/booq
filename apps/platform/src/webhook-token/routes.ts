import { answer } from '../http/answer';
import { actorOf, clubIdOf } from '../clubs/routes';
import { platformRoute, type PlatformRoute } from '../http/server';
import type { createWebhookTokenService } from './webhook-token';

// POST /clubs/:id/webhook-tokens/:kind (F02 design 5.4; kind: line, beam_test, beam_live). Admin only; the service also
// checks the staff role, the fresh second factor and that the club may be edited. The answer carries the plain token
// and the full address once. It is never cached and never logged.

export interface WebhookTokenRouteDeps {
  webhookTokens: ReturnType<typeof createWebhookTokenService>;
}

export function webhookTokenRoutes(deps: WebhookTokenRouteDeps): PlatformRoute[] {
  return [
    platformRoute({ method: 'POST', path: '/clubs/:id/webhook-tokens/:kind', access: 'admin' }, async (ctx) =>
      answer(await deps.webhookTokens.issue(actorOf(ctx), clubIdOf(ctx), ctx.input['kind'])),
    ),
  ];
}
