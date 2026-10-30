import { answer } from '../http/answer';
import { platformRoute, type PlatformRoute } from '../http/server';
import type { createHealthService } from './health';

// GET /health (docs/ops/worker.md): counts only (lag, dead jobs, seconds since the last success per
// task), behind a shared token that the external monitor holds. It is not a staff route: the token
// is the credential, sent as `Authorization: Bearer <token>`. No club, player or payment data.

export interface HealthRouteDeps {
  health: ReturnType<typeof createHealthService>;
}

export function healthRoutes(deps: HealthRouteDeps): PlatformRoute[] {
  return [
    platformRoute({ method: 'GET', path: '/health', access: 'public' }, async (ctx) => {
      const header = ctx.request.headers.get('authorization') ?? '';
      const token = /^Bearer (.+)$/.exec(header)?.[1];
      return answer(await deps.health.check(token));
    }),
  ];
}
