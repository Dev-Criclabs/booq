// The transport (packages/auth serve.ts) puts the club address into every route's input as `slug`, next to the query, the body and the path
// parameters. A route that checks its input field by field must not mistake that for a field the caller sent. Found over HTTP: PUT /settings/:key,
// PUT /hours, POST and PUT /resources, PUT /support-window were all refused 400 because of it, though their handler tests passed.
export function withoutTransportKeys(input: unknown): unknown {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) return input;
  const { slug: _slug, ...rest } = input as Record<string, unknown>;
  return rest;
}
