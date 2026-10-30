import { serveRoutes } from '@booq/auth';
import { webSource } from '../../../../../server/runtime';

// Every API route of the club apps, under /api/c/{slug}/... One table of declared routes
// (apps/web/src/server/context.ts); serveRoutes finds the route, reads the session cookie and
// answers JSON. A route without a declared permission cannot be in the table (route() requires one).
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = serveRoutes(webSource);
export const POST = serveRoutes(webSource);
export const PUT = serveRoutes(webSource);
export const PATCH = serveRoutes(webSource);
export const DELETE = serveRoutes(webSource);
