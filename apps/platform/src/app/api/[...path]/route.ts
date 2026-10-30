import { servePlatform } from '../../../http/server';
import { platformSource } from '../../../server/runtime';

// Every API route of the platform console, under /api/... One table of declared routes
// (apps/platform/src/server/context.ts); servePlatform finds the route, checks the staff cookie and
// the route's access level, and answers JSON. This app has no UI pages yet.
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = servePlatform(platformSource);
export const POST = servePlatform(platformSource);
export const PUT = servePlatform(platformSource);
export const PATCH = servePlatform(platformSource);
export const DELETE = servePlatform(platformSource);
